import fs from "node:fs/promises";
import path from "node:path";

/** Exercise real Shell -> IPC -> WebContentsView geometry while the button is
 * held. No provider request is sent; a retained terminal or unsent draft suffices. */
export async function verifySidebarLiveResize({ window, contents, temp, label, until }) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const view = window.contentView.children.find(child => child.webContents === contents);
  const assert = (condition, message) => { if (!condition) throw new Error(`${label}: ${message}`); };
  const frame = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const snapshot = () => evaluate(`(() => {
    const panel = document.querySelector('.desktop-right-sidebar');
    const inner = panel.querySelector('.desktop-right-sidebar-inner');
    const viewport = panel.querySelector('.desktop-right-sidebar-viewport');
    const handle = panel.querySelector('.desktop-right-sidebar-resizer');
    const style = getComputedStyle(panel);
    const bounds = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
    return { panel:bounds(panel), inner:bounds(inner), viewport:bounds(viewport), handle:bounds(handle), paint:bounds(handle.querySelector("[data-pane-edge-chrome]")),
      borderLeft:parseFloat(style.borderLeftWidth), borderRight:parseFloat(style.borderRightWidth),
      borderColor:style.borderInlineStartColor, dragging:document.body.classList.contains('desktop-right-sidebar-resizing'),
      persisted:localStorage.getItem('puppyone.desktop.rightSidebarWidth') };
  })()`);
  const initial = await snapshot();
  const pid = contents.getOSProcessId();
  const hidden = [];
  const setVisible = view.setVisible.bind(view);
  view.setVisible = visible => { if (!visible) hidden.push(Date.now()); return setVisible(visible); };
  const observations = [];
  const assertBounds = async () => {
    await until(async () => {
      const state = await snapshot();
      const bounds = view.getBounds();
      const paintRight = state.paint.x + state.paint.width;
      const innerRight = state.inner.x + state.inner.width;
      const left = state.paint.x <= state.inner.x && paintRight > state.inner.x ? paintRight : state.inner.x;
      const right = state.paint.x < innerRight && paintRight >= innerRight ? state.paint.x : innerRight;
      return Math.abs(bounds.width - (Math.floor(right) - Math.ceil(left))) <= 1
        && bounds.x >= Math.ceil(state.panel.x + state.borderLeft)
        && bounds.x + bounds.width <= Math.floor(state.panel.x + state.panel.width - state.borderRight);
    }, `${label} native content stays inside frame`);
    const state = await snapshot();
    assert(Math.abs(state.inner.width - (state.panel.width - state.borderLeft - state.borderRight)) < 0.1,
      "Content width includes frame border");
    assert(Math.abs(state.viewport.x - state.inner.x) < 0.1, "Content starts outside clipping viewport");
    assert(state.handle.width === 8, "Resize target changed the 8px overlay contract");
    assert(view.getVisible(), "Held resize hid native content");
    assert(contents.getOSProcessId() === pid, "Resize replaced renderer process");
    observations.push({ ...state, native: view.getBounds(), visible: view.getVisible() });
  };
  const send = (type, point) => {
    const bounds = view.getBounds();
    contents.sendInputEvent({ type, x: Math.round(point.x - bounds.x), y: Math.round(point.y - bounds.y),
      ...(type === "mouseMove" ? { modifiers: ["leftbuttondown"] } : { button: "left", clickCount: 1 }) });
  };
  try {
    window.show(); window.focus();
    await frame();
    await until(() => { contents.focus(); return contents.isFocused(); }, `${label} native focus`);
    await frame(); await assertBounds();
    let state = await snapshot();
    const start = { x: state.handle.x + 3, y: view.getBounds().y + 60 };
    send("mouseDown", start);
    await until(async () => (await snapshot()).dragging, `${label} initial native-covered sash press`);
    await frame(); await assertBounds(); // The original bug blanks even before movement.
    for (const delta of [16, 32, 48, 64, 80]) {
      send("mouseMove", { x: start.x + delta, y: start.y });
      await until(async () => Math.abs((await snapshot()).panel.width - (initial.panel.width - delta)) < 1,
        `${label} live width ${delta}`);
      await frame(); await assertBounds();
      assert((await snapshot()).persisted === initial.persisted, "Preview wrote a width preference");
    }
    await fs.writeFile(path.join(temp, `${label}-held-native.png`), (await contents.capturePage()).toPNG());
    await fs.writeFile(path.join(temp, `${label}-held-shell.png`), (await window.webContents.capturePage()).toPNG());
    send("mouseUp", { x: start.x + 80, y: start.y });
    await until(async () => !(await snapshot()).dragging, `${label} release`);
    await frame(); await assertBounds();
    assert(hidden.length === 0, "Resize called native setVisible(false)");
    // CSS border/content contract also holds with bilateral XP chrome and RTL.
    const appearance = await evaluate("({style:document.documentElement.getAttribute('data-interface-style'),dir:document.documentElement.dir})");
    for (const [style, dir] of [["windows-xp", "ltr"], ["windows-xp", "rtl"], ["default", "rtl"]]) {
      await evaluate(`document.documentElement.setAttribute('data-interface-style',${JSON.stringify(style)}); document.documentElement.dir=${JSON.stringify(dir)}`);
      await frame(); await assertBounds();
    }
    await evaluate(`document.documentElement.setAttribute('data-interface-style',${JSON.stringify(appearance.style)}); document.documentElement.dir=${JSON.stringify(appearance.dir)}`);
    await frame();
    state = await snapshot();
    assert(Number(state.persisted) === Math.round(initial.panel.width - 80), "Release did not commit the final width");
    const siblingResizes = [];
    for (const [selector, bodyClass] of [
      [".desktop-project-switcher-resizer", "desktop-project-switcher-resizing"],
      [".data-explorer-resizer", "data-sidebar-resizing"],
    ]) {
      await evaluate(`(() => {
        const handle = document.querySelector(${JSON.stringify(selector)});
        if (handle?.classList.contains('po-collapsed-pane-edge-handle')) handle.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
      })()`);
      await new Promise(resolve => setTimeout(resolve, 350));
      if (!await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) {
        await evaluate("document.querySelector('.desktop-titlebar-sidebar-expand')?.click()");
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      const geometry = await evaluate(`(() => {
        const handle = document.querySelector(${JSON.stringify(selector)});
        const rect = handle.getBoundingClientRect();
        return { x:rect.x + 3, y:rect.y + 70, value:Number(handle.getAttribute('aria-valuenow')) };
      })()`);
      window.webContents.focus();
      window.webContents.sendInputEvent({ type: "mouseDown", x:Math.round(geometry.x), y:Math.round(geometry.y), button:"left", clickCount:1 });
      await until(async () => evaluate(`document.body.classList.contains(${JSON.stringify(bodyClass)})`), `${selector} held`);
      await frame(); assert(view.getVisible(), `${selector} hid sibling native content on press`);
      window.webContents.sendInputEvent({ type:"mouseMove", x:Math.round(geometry.x + 32), y:Math.round(geometry.y), modifiers:["leftbuttondown"] });
      await until(async () => evaluate(`Number(document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuenow')) > ${geometry.value}`), `${selector} live preview`);
      await frame(); assert(view.getVisible(), `${selector} hid sibling native content on move`);
      window.webContents.sendInputEvent({ type:"mouseUp", x:Math.round(geometry.x + 32), y:Math.round(geometry.y), button:"left", clickCount:1 });
      await until(async () => evaluate(`!document.body.classList.contains(${JSON.stringify(bodyClass)})`), `${selector} released`);
      siblingResizes.push(selector);
    }
    assert(hidden.length === 0, "An unrelated sidebar changed native visibility");
    return { label, pid, noHiddenFrames: hidden.length === 0, siblingResizes, observations };
  } catch (error) {
    console.error(JSON.stringify({ label, state: await snapshot(), native: view.getBounds(), observations }));
    throw error;
  } finally {
    view.setVisible = setVisible;
  }
}

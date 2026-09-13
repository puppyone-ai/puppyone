import fs from "node:fs/promises";
import path from "node:path";

/** Actual window resizing and pointer dragging against the shared DOM pane. */
export async function verifySidebarLiveResize(options) {
  const debuggerSession = options.window.webContents.debugger;
  debuggerSession.attach("1.3");
  try { return await verifyLiveResize(options); }
  finally { if (debuggerSession.isAttached()) debuggerSession.detach(); }
}

async function verifyLiveResize({ window, temp, label, until }) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const assert = (value, message) => { if (!value) throw new Error(`${label}: ${message}`); };
  const frame = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const snapshot = () => evaluate(`(() => {
    const pane = document.querySelector('.desktop-right-sidebar');
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right }; };
    return { pane:rect(pane), content:rect(pane.querySelector('.desktop-right-sidebar-inner')),
      viewport:rect(pane.querySelector('.po-collapsible-pane-viewport')), handle:rect(pane.querySelector('.desktop-right-sidebar-resizer')),
      phase:pane.dataset.panePresentation, visible:pane.dataset.paneContentVisible,
      dragging:document.body.classList.contains('desktop-right-sidebar-resizing'),
      transitionDuration:getComputedStyle(pane).transitionDuration,
      persisted:localStorage.getItem('puppyone.desktop.rightSidebarWidth') };
  })()`);
  window.show(); window.focus(); window.webContents.focus();
  await until(async () => (await snapshot()).phase === "expanded", "expanded DOM pane");
  const original = await snapshot();
  const observations = [];
  const send = (type, x, y) => window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type:type === "mouseMove" ? "mouseMoved" : type === "mouseDown" ? "mousePressed" : "mouseReleased",
    x:Math.round(x), y:Math.round(y), pointerType:"mouse", button:"left",
    buttons:type === "mouseUp" ? 0 : 1,
    ...(type === "mouseMove" ? {} : {clickCount:1}),
  });
  const start = { x:original.handle.x+3, y:original.handle.y+90 };
  await send("mouseDown", start.x, start.y);
  await until(async () => (await snapshot()).dragging, "DOM divider press");
  for (const delta of [16, 32, 48, 64, 80]) {
    await send("mouseMove", start.x+delta, start.y);
    await until(async () => Math.abs((await snapshot()).pane.width-(original.pane.width-delta)) <= 1, "pointer-following width");
    const state = await snapshot();
    assert(state.visible === "true", "Dragging hid content");
    assert(state.transitionDuration.split(",").every(value => parseFloat(value) === 0), "Dragging inherited collapse easing");
    assert(Math.abs(state.content.width-state.viewport.width) <= 1, "Content and viewport diverged while resizing");
    assert(state.persisted === original.persisted, "Pointer preview wrote a preference");
    observations.push(state);
  }
  await send("mouseUp", start.x+80, start.y);
  await until(async () => !(await snapshot()).dragging, "DOM divider release");
  assert(Number((await snapshot()).persisted) === Math.round(original.pane.width-80), "Released width was not retained");

  // CSS owns window constraints; the session's DOM node must survive them.
  await evaluate("window.__sidebarScreen = document.querySelector('.desktop-terminal-contribution-host[aria-hidden=false]');");
  const [width, height] = window.getSize();
  for (const delta of [-180, 60, -100, 0]) {
    window.setSize(width+delta, height);
    await frame();
    const state = await snapshot();
    assert(state.phase === "expanded" && state.visible === "true", "Window resize changed presentation state");
    assert(Math.abs(state.content.width-state.viewport.width) <= 1, "Window resize left content at stale width");
    assert(await evaluate("window.__sidebarScreen === document.querySelector('.desktop-terminal-contribution-host[aria-hidden=false]')"), "Window resize remounted the session");
    observations.push(state);
  }
  const motion = await evaluate(`(async () => {
    const pane = document.querySelector('.desktop-right-sidebar');
    const content = pane.querySelector('.desktop-right-sidebar-inner');
    const screen = window.__sidebarScreen;
    const samples = [];
    for (let i=0;i<2;i++) {
      document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal').click();
      const start=performance.now();
      while (performance.now()-start<450) {
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const r=content.getBoundingClientRect();
        samples.push({width:r.width,right:r.right,frame:pane.getBoundingClientRect().width,visible:pane.dataset.paneContentVisible});
      }
    }
    return {samples, retained:screen===document.querySelector('.desktop-terminal-contribution-host[aria-hidden=false]')};
  })()`);
  const moving = motion.samples.filter(sample => sample.frame > 2);
  assert(moving.length > 2 && moving.every(sample => sample.visible === "true"), "Content disappeared during motion");
  assert(Math.max(...motion.samples.map(s=>s.width))-Math.min(...motion.samples.map(s=>s.width)) <= 1, "Collapse squeezed content");
  assert(Math.max(...motion.samples.map(s=>s.right))-Math.min(...motion.samples.map(s=>s.right)) <= 1, "Collapse translated content");
  assert(motion.retained, "Toggling remounted the session");
  assert(window.contentView.children.length === 0, "Session UI allocated a native view");
  await evaluate("delete window.__sidebarScreen");
  await fs.writeFile(path.join(temp, `${label}-dom.png`), (await window.webContents.capturePage()).toPNG());
  return { label, observations, motion, nativeSessionViews:0 };
}

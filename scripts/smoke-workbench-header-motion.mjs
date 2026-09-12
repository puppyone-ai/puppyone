#!/usr/bin/env electron
// Real Chromium layout and paint, with production Header/Store and a no-network content fixture.
import { app, BrowserWindow } from "electron";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = await mkdtemp(path.join(os.tmpdir(), "puppyone-header-motion-"));
app.setPath("userData", path.join(artifacts, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.on("window-all-closed", () => {});
let window;
const report = [];
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const evaluate = (code) => window.webContents.executeJavaScript(code, true);
const api = "window.__auxiliaryAppearanceSmoke";
const animations = "document.querySelector('.desktop-terminal-subheader').getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition || animation.id === 'workbench-header-layout')";
const contentExpression = `(() => {
  const launcher = [...document.querySelectorAll('.desktop-terminal-launcher')].find(element => element.getClientRects().length);
  if (!launcher) return null;
  const elements = [launcher, ...launcher.querySelectorAll('h2, button, .desktop-terminal-launcher-content, .desktop-terminal-launcher-group')];
  return { history: launcher.classList.contains('is-history'),
    tools: launcher.querySelectorAll('.desktop-terminal-launcher-tool').length,
    animations: launcher.getAnimations({ subtree: true }).map(animation => animation.animationName ?? animation.transitionProperty ?? animation.id),
    opacity: elements.map(element => {
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return opacity;
    }) };
})()`;
function checkContent(content, label) {
  assert(content && (content.history || content.tools > 0), `${label}: launcher content missing`);
  assert(content.animations.length === 0, `${label}: launcher content animated: ${content.animations.join(', ')}`);
  assert(content.opacity.every(opacity => opacity === 1), `${label}: launcher content faded`);
}
async function settle() {
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await evaluate("Promise.allSettled(document.querySelector('.desktop-right-sidebar').getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition || animation.id === 'workbench-header-layout').map(animation => animation.finished))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
const snapshotExpression = `(() => {
    const rail = document.querySelector('.desktop-terminal-tab-rail');
    const box = rail.getBoundingClientRect();
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: document.documentElement.dir === 'rtl' ? box.right - r.right : r.left - box.left,
        y: r.top - box.top, width: r.width, height: r.height, opacity: Number(getComputedStyle(element).opacity) };
    };
    return { content: ${contentExpression}, mode: rail.dataset.layout, motion: rail.dataset.layoutMotion, width: box.width,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transition: getComputedStyle(rail.querySelector('.desktop-terminal-new-button')).transition,
      plus: rect(rail.querySelector('.desktop-terminal-new-button')),
      overflow: rail.querySelector('.desktop-terminal-tab-overflow-wrap') ? rect(rail.querySelector('.desktop-terminal-tab-overflow-wrap')) : null,
      track: rect(rail.querySelector('.desktop-terminal-tabs')),
      tabs: [...rail.querySelectorAll('.desktop-terminal-tab')].map(element => ({
        id: element.dataset.terminalTabSessionId, ...rect(element)
      })), animations: ${animations}.map(animation => ({ property: animation.transitionProperty ?? animation.id, time: animation.currentTime })) };
  })()`;
async function snapshot() {
  return evaluate(snapshotExpression);
}
async function pauseAt(time) {
  await evaluate(`${animations}.forEach(animation => { animation.pause(); animation.currentTime = ${time}; })`);
  return snapshot();
}
async function clickPlus() {
  const point = await evaluate(`(() => { const r = document.querySelector('.desktop-terminal-new-button').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  window.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => { ${animations}.forEach(animation => animation.pause()); resolve(); }))`);
}
function checkGeometry(frame, label) {
  assert(Math.abs(frame.plus.width - 28) < 0.1 && Math.abs(frame.plus.height - 28) < 0.1, `${label}: + changed size`);
  assert(frame.plus.y >= -0.1 && frame.plus.x + 28 <= frame.width + 1, `${label}: + escaped the Header`);
  const tabs = frame.tabs.filter(tab => tab.width > 1 && tab.opacity > 0.05).sort((a, b) => a.x - b.x);
  for (let index = 1; index < tabs.length; index++) {
    assert(tabs[index - 1].x + tabs[index - 1].width <= tabs[index].x + 1, `${label}: tabs overlap`);
  }
  const controls = [frame.overflow, frame.plus].filter(control => control && control.width > 1 && control.opacity > 0.05);
  assert(frame.track.width <= controls[0].x + 1, `${label}: controls overlap the tab strip`);
  if (controls.length === 2) assert(controls[0].x + controls[0].width <= controls[1].x + 1, `${label}: controls overlap`);
}
async function run() {
  for (const [theme, width, direction, reduced] of [
    ["dark", 800, "ltr", false], ["dark", 320, "ltr", false],
    ["light", 280, "ltr", false], ["dark", 420, "rtl", false],
    ["dark", 320, "ltr", true],
  ]) {
    const name = `${theme}-${width}-${direction}${reduced ? "-reduced" : ""}`;
    console.log("Checking Header motion:", name);
    window = new BrowserWindow({ show: true, width: 1000, height: 780,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
    await window.loadURL(pathToFileURL(path.join(repo, "dist/index.html")).href + `?theme=${theme}&header-motion#auxiliary-appearance-smoke`);
    console.log("Fixture loaded");
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
    });
    for (let i = 0; i < 100 && !await evaluate(`Boolean(${api})`); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(await evaluate(`Boolean(${api})`), "Fixture did not load");
    console.log("Fixture ready");
    await evaluate(`${api}.setWidth(${width}); document.documentElement.dir = '${direction}'`);
    await settle();
    console.log("Header measured");
    const before = await snapshot();
    await clickPlus();
    const launcherId = await evaluate(`${api}.snapshot().topology.items.find(item => item.kind === 'launcher')?.id`);
    assert(launcherId, `${name}: real + click did not create a launcher`);
    const frames = [];
    for (const time of [0, 40, 100, 200]) {
      const frame = await pauseAt(time); checkGeometry(frame, name);
      checkContent(frame.content, `${name}: ${time}ms`);
      frames.push({ time, ...frame });
      await writeFile(path.join(artifacts, `${name}-${time}.png`), (await window.capturePage()).toPNG());
    }
    await writeFile(path.join(artifacts, `${name}-frames.json`), JSON.stringify({ before, frames }, null, 2));
    if (reduced) assert(frames.every(frame => frame.animations.length === 0), "Reduced motion still animates");
    else {
      assert(Math.abs(frames[0].plus.x - before.plus.x) < 1, `${name}: + jumped at creation`);
      const start = frames[0].tabs.find(tab => tab.id === launcherId);
      const mid = frames[1].tabs.find(tab => tab.id === launcherId);
      const end = frames[3].tabs.find(tab => tab.id === launcherId);
      assert(start.width < 1 && mid.width > start.width && mid.width < end.width, `${name}: new tab did not expand`);
      assert(frames[0].animations.some(animation => animation.property === "workbench-header-layout"), "No geometry transition");
    }
    await evaluate(`${animations}.forEach(animation => animation.finish())`);
    await settle();
    await clickPlus();
    await evaluate(`${animations}.forEach(animation => animation.finish())`);
    await settle();
    const secondBlankId = await evaluate(`${api}.snapshot().topology.items.filter(item => item.kind === 'launcher').at(-1)?.id`);
    assert(secondBlankId && secondBlankId !== launcherId, "Repeated + reused the first blank tab");
    assert(await evaluate(`document.querySelectorAll('[role="tab"] .lucide-square-dashed').length >= 2`), "Blank tabs did not use neutral icons");
    await evaluate(`${api}.activateItem('${launcherId}')`);
    await evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
    checkContent(await evaluate(contentExpression), `${name}: switch blank tab`);
    await evaluate("[...document.querySelectorAll('.desktop-terminal-launcher-history')].find(element => element.getClientRects().length).click()");
    await evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
    checkContent(await evaluate(contentExpression), `${name}: open history`);
    assert(await evaluate(`(() => {
      const tab = document.querySelector('[data-terminal-tab-session-id="${launcherId}"] [role="tab"]');
      const view = document.querySelector('.desktop-agent-history-view');
      return tab?.textContent?.trim() === view.getAttribute('aria-label') && tab.getAttribute('aria-selected') === 'true' && tab.querySelector('.lucide-history')
        && !view.querySelector('h2, input') && view.querySelectorAll('.desktop-agent-history-option').length === 3
        && !view.querySelector('details').open;
    })()`), `${name}: History tab or compact content header is incorrect`);
    assert(await evaluate(`(() => {
      const toolbar = document.querySelector('.desktop-agent-history-toolbar');
      const search = toolbar.querySelector('.desktop-agent-history-search-slot > button').getBoundingClientRect();
      const refresh = toolbar.querySelector(':scope > button:last-of-type').getBoundingClientRect();
      const gap = document.documentElement.dir === 'rtl' ? search.left - refresh.right : refresh.left - search.right;
      return Math.abs(gap - parseFloat(getComputedStyle(toolbar).columnGap)) < 1 && Math.abs(search.top - refresh.top) < 1;
    })()`), `${name}: Search must sit immediately before Refresh, not in the center`);
    await settle();
    await writeFile(path.join(artifacts, `${name}-history.png`), (await window.capturePage()).toPNG());
    await evaluate("document.querySelector('.desktop-agent-history-search-slot > button').click()");
    await evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
    assert(await evaluate(`(() => {
      const input = document.querySelector('.desktop-agent-history-toolbar input');
      const header = input.closest('header').getBoundingClientRect(), box = input.getBoundingClientRect();
      return document.activeElement === input && box.left >= header.left && box.right <= header.right
        && box.top >= header.top && box.bottom <= header.bottom;
    })()`), `${name}: Search is not focused or escaped the toolbar`);
    window.webContents.insertText("terminal");
    await evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
    assert(await evaluate("document.querySelectorAll('.desktop-agent-history-option').length === 1"), `${name}: Search did not filter rows`);
    await writeFile(path.join(artifacts, `${name}-history-search.png`), (await window.capturePage()).toPNG());
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    assert(await evaluate("!document.querySelector('.desktop-agent-history-view input') && document.querySelectorAll('.desktop-agent-history-option').length === 3 && document.activeElement === document.querySelector('.desktop-agent-history-search-slot > button')"), `${name}: Escape did not reset search and focus`);
    await evaluate("document.querySelector('.desktop-agent-history-toolbar > button:first-of-type').click()");
    await evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
    checkContent(await evaluate(contentExpression), `${name}: back to launcher`);
    assert(await evaluate(`document.querySelector('[data-terminal-tab-session-id="${launcherId}"] [role="tab"] .lucide-square-dashed') !== null`), `${name}: Back did not restore blank tab identity`);
    await evaluate(`${api}.activateItem('${secondBlankId}')`);
    await settle();
    await evaluate(`window.__retainedTab = document.querySelector('[data-terminal-tab-session-id="${launcherId}"]')`);
    const position = await snapshot();
    const runtimeId = await evaluate(`${api}.promoteLauncher('${launcherId}')`);
    await settle();
    assert(runtimeId !== launcherId && await evaluate(`window.__retainedTab === document.querySelector('[data-terminal-tab-session-id="${runtimeId}"]')`), "Launcher replacement recreated the tab DOM");
    const promoted = await snapshot();
    assert(promoted.tabs.length === position.tabs.length && Math.abs(promoted.plus.x - position.plus.x) < 1, "Promotion changed Header geometry");
    assert(await evaluate(`${api}.snapshot().topology.groups.some(group => group.activeItemId === '${secondBlankId}')`), "Background promotion stole the blank tab selection");
    // Retarget while prior transitions are still running; there is no animation queue.
    const rapid = await evaluate(`new Promise(resolve => {
      const frames = []; let count = 0;
      const capture = async () => {
        if ([0, 3, 6, 9].includes(count)) ${api}.newLauncher();
        frames.push(${snapshotExpression});
        if (++count === 24) resolve(frames); else requestAnimationFrame(capture);
      }; requestAnimationFrame(capture);
    })`);
    await writeFile(path.join(artifacts, `${name}-rapid.json`), JSON.stringify(rapid, null, 2));
    rapid.forEach((frame, index) => {
      checkGeometry(frame, `${name}: rapid frame ${index}`);
      checkContent(frame.content, `${name}: rapid frame ${index}`);
    });
    await settle(); checkGeometry(await snapshot(), `${name}: rapid creation`);
    const toClose = await evaluate(`${api}.snapshot().topology.items.at(-1).id`);
    await evaluate(`${api}.closeItem('${toClose}')`);
    await settle(); checkGeometry(await snapshot(), `${name}: close`);
    await writeFile(path.join(artifacts, `${name}-overflow.png`), (await window.capturePage()).toPNG());
    report.push({ name, before, frames, contentImmediate: true, historyNavigation: true, inlineHistorySearch: true, promotion: { runtimeId, stableTab: true, otherBlankPreserved: true }, rapid });
    window.destroy();
  }
  assert(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ ok: true, cases: report, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: report.length, artifacts }));
}
const guard = setTimeout(() => { console.error("Header motion smoke timed out:", artifacts); app.exit(1); }, 120_000);
app.whenReady().then(run).then(() => { clearTimeout(guard); app.exit(0); }).catch(async (error) => {
  console.error(error);
  console.error("Renderer errors:", errors);
  if (window && !window.isDestroyed()) {
    try {
      await writeFile(path.join(artifacts, "failure.png"), (await window.capturePage()).toPNG());
      await writeFile(path.join(artifacts, "failure.json"), JSON.stringify(await snapshot(), null, 2));
    } catch (captureError) { console.error("Failure capture unavailable:", captureError.message); }
  }
  console.error("Motion artifacts:", artifacts);
  clearTimeout(guard);
  app.exit(1);
});

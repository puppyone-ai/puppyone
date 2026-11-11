#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { workspaceFromPath } from "../../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../../shared/desktop-build-identity.mjs";
import { readSourceIdentity } from "../../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-whiteboard-"));
const output = path.join(repo, "artifacts/tests/editor/whiteboard", String(Date.now()));
await fs.mkdir(output, { recursive: true });
const source = await readSourceIdentity(repo);
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
const root = path.join(temporary, "Whiteboard Workspace");
await fs.mkdir(root);
const blank = JSON.stringify({ type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} }, null, 2);
await fs.writeFile(path.join(root, "board.excalidraw"), blank);
await fs.writeFile(path.join(root, "broken.excalidraw"), "{broken");
await fs.writeFile(path.join(root, "note.md"), "# Another file");
await fs.writeFile(path.join(root, "demo.html"), '<!doctype html><button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button>');
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: value => fs.realpath(value), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
process.argv.push(root);
let window, failure;
const steps = [], errors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await wait(100); }
  throw new Error(`Timed out: ${label}`);
}
const disk = async () => await fs.readFile(path.join(root, "board.excalidraw"), "utf8");
async function click(selector) {
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function pointer(type, x, y) {
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
}
async function key(key, modifiers = 0, code = key) {
  for (const type of ["keyDown", "keyUp"]) await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type, key, code, modifiers });
}
async function openBoard() {
  await click('.tree-row.file[aria-label="board.excalidraw"]');
  await until(() => evaluate("!!document.querySelector('.excalidraw canvas')"), "whiteboard canvas");
  await wait(300);
}
const deadline = setTimeout(() => { console.error("Whiteboard acceptance timed out"); app.exit(1); }, 150000);
await import("../../../../../electron/main.mjs");
app.whenReady().then(async () => {
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window");
    window.setSize(1400, 950);
    window.webContents.setBackgroundThrottling(false);
    window.hide();
    window.webContents.on("console-message", (_event, level, message) => { if (level >= 2) errors.push(message); });
    await until(() => evaluate("!!document.querySelector('.app-shell')"), "app ready");
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await evaluate("window.addEventListener('error', event => console.error('Whiteboard error detail: ' + event.error?.stack))");
    await openBoard();
    assert.equal(await disk(), blank, "opening must not rewrite source");
    const primary = await evaluate("getComputedStyle(document.querySelector('.excalidraw')).getPropertyValue('--color-primary').trim()");
    assert.notEqual(primary, "#6965db", "whiteboard chrome uses the product accent");
    const coachmark = await evaluate("!!document.querySelector('.desktop-header-coachmark-actions button')");
    if (coachmark) await click('.desktop-header-coachmark-actions button');
    await click('.excalidraw [data-testid="toolbar-rectangle"]');
    console.log("Whiteboard: drawing");
    const bounds = await evaluate("(()=>{const r=document.querySelector('.excalidraw canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
    const x = Math.round(bounds.x + bounds.width * 0.45), y = Math.round(bounds.y + bounds.height * 0.4);
    await pointer("mousePressed", x, y);
    for (let i = 1; i <= 10; i++) await pointer("mouseMoved", x + i * 15, y + i * 9);
    await pointer("mouseReleased", x + 150, y + 90);
    await key("s", process.platform === "darwin" ? 4 : 2, "KeyS");
    let saved = await until(async () => { const data = JSON.parse(await disk()); return data.elements.some(el => el.type === "rectangle") ? data : null; }, "draw and save rectangle");
    const rectangle = saved.elements.find(el => el.type === "rectangle");
    assert.equal(rectangle.roughness, 0, "first-use shapes default to clean lines");
    assert.equal(rectangle.fillStyle, "solid", "first-use shapes avoid hachure fill");
    assert.equal(rectangle.strokeWidth, 1, "first-use shapes default to thin strokes");
    assert.equal(rectangle.roundness, null, "first-use shapes default to sharp corners");
    const display = selector => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return el?getComputedStyle(el).display:"missing"})()`);
    assert.ok(!["none", "missing"].includes(await display('.excalidraw .panelColumn fieldset:has(input[name="sloppiness"])')), "sloppiness remains available");
    assert.equal(await display(".excalidraw .HintViewer"), "none", "canvas hints stay hidden");
    steps.push("standard file opens without writes; pointer drawing saves through document session");
    const boardWidth = () => evaluate("document.querySelector('.whiteboard-editor').getBoundingClientRect().width");
    const chrome = 1400 - await boardWidth();
    const isMobile = "document.querySelector('.excalidraw').classList.contains('excalidraw--mobile')";
    const box = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r&&{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}})()`);
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const assertBottomToolbar = async label => {
      const [toolbar, footer, properties, board] = await Promise.all([".excalidraw .App-toolbar", ".excalidraw .layer-ui__wrapper__footer-left", ".excalidraw .App-menu__left", ".whiteboard-editor"].map(box));
      assert.ok(board.bottom - toolbar.bottom < 24 && toolbar.top > board.top + board.height / 2, `${label}: the shape toolbar sits on the bottom edge`);
      assert.ok(!overlaps(toolbar, footer) && !overlaps(toolbar, properties), `${label}: the toolbar clears the zoom footer and properties panel`);
    };
    await assertBottomToolbar("wide pane");
    window.setSize(Math.round(chrome + 560), 950);
    await until(async () => Math.abs(await boardWidth() - 560) < 2, "narrow desktop whiteboard");
    await wait(300);
    assert.equal(await evaluate(isMobile), false, "a narrow mouse-driven pane keeps the desktop layout");
    await assertBottomToolbar("narrow pane");
    await fs.writeFile(path.join(output, "whiteboard-narrow.png"), (await window.webContents.capturePage()).toPNG());
    window.setSize(Math.round(chrome + 440), 950);
    await until(() => evaluate(isMobile), "phone layout below 500px");
    await click('.excalidraw .App-bottom-bar button[aria-label="Edit"]');
    await until(() => evaluate("!!document.querySelector('.excalidraw .App-bottom-bar .panelColumn')"), "phone properties sheet");
    const sheet = await box(".excalidraw .App-bottom-bar > .Island"), board = await box(".whiteboard-editor");
    assert.ok(sheet.height <= board.height * 0.56 && sheet.bottom <= board.bottom + 1, "the phone properties sheet leaves the canvas visible");
    await wait(300);
    await fs.writeFile(path.join(output, "whiteboard-phone.png"), (await window.webContents.capturePage()).toPNG());
    await click('.excalidraw .App-bottom-bar button[aria-label="Edit"]');
    window.setSize(1400, 950);
    await until(async () => !(await evaluate(isMobile)), "desktop layout restored");
    await assertBottomToolbar("restored pane");
    steps.push("the shape toolbar sits at the bottom without overlap; narrow panes keep the desktop layout; the phone sheet stays partial");
    await wait(300);
    for (const type of ["mousePressed", "mouseReleased"]) await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x: x + 75, y: y + 45, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 });
    await until(() => evaluate("!!document.querySelector('.excalidraw .context-menu')"), "element context menu");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.excalidraw .context-menu')).borderRadius"), await evaluate("getComputedStyle(document.querySelector('.desktop-overlay-root') ?? document.body).getPropertyValue('--po-menu-radius').trim()"), "context menu uses the product menu surface");
    await wait(200);
    await fs.writeFile(path.join(output, "whiteboard-context-menu.png"), (await window.webContents.capturePage()).toPNG());
    await key("Escape");
    await until(async () => !(await evaluate("!!document.querySelector('.excalidraw .context-menu')")), "context menu closes");
    for (const type of ["mousePressed", "mouseReleased"]) await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x: Math.round(bounds.x + bounds.width - 40), y: Math.round(bounds.y + bounds.height - 30), button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 });
    await until(() => evaluate("!!document.querySelector('.excalidraw .context-menu')"), "canvas context menu");
    await wait(100);
    const fit = await evaluate("(()=>{const menu=document.querySelector('.excalidraw .context-menu').getBoundingClientRect(),editor=document.querySelector('.whiteboard-editor'),root=editor.querySelector('.excalidraw'),board=editor.getBoundingClientRect();return {inside:menu.bottom<=board.bottom+1&&menu.right<=board.right+1,scrolled:editor.scrollTop+root.scrollTop+editor.scrollLeft+root.scrollLeft}})()");
    assert.deepEqual(fit, { inside: true, scrolled: 0 }, "an edge context menu fits the pane without scrolling the editor");
    await key("Escape");
    await until(async () => !(await evaluate("!!document.querySelector('.excalidraw .context-menu')")), "canvas context menu closes");
    steps.push("context menus use the product menu surface and fit the pane");
    const isDark = "document.querySelector('.excalidraw').classList.contains('theme--dark')";
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await until(() => evaluate(isDark), "whiteboard follows dark appearance");
    await fs.writeFile(path.join(output, "whiteboard-dark.png"), (await window.webContents.capturePage()).toPNG());
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await until(async () => !(await evaluate(isDark)), "whiteboard follows light appearance");
    assert.equal(JSON.parse(await disk()).elements.length, saved.elements.length, "appearance changes do not edit the scene");
    steps.push("whiteboard follows the product color mode without rewriting the file");
    await click('.excalidraw [data-testid="toolbar-text"]');
    await pointer("mousePressed", x + 200, y + 150);
    await pointer("mouseReleased", x + 200, y + 150);
    await until(() => evaluate("!!document.querySelector('.excalidraw-wysiwyg')"), "text input");
    await window.webContents.debugger.sendCommand("Input.insertText", { text: "Whiteboard 中文" });
    assert.ok(!["none", "missing"].includes(await display('.excalidraw [data-testid="font-family-hand-drawn"]')), "hand-drawn font remains available");
    // Switching directly, without an explicit save, must flush the in-progress textarea.
    await click('.tree-row.file[aria-label="note.md"]');
    saved = await until(async () => { const data = JSON.parse(await disk()); return data.elements.some(el => el.text === "Whiteboard 中文") ? data : null; }, "text commits on file switch");
    assert.equal(saved.elements.find(el => el.text === "Whiteboard 中文").fontFamily, 9, "first-use text defaults to the neutral Liberation Sans font");
    steps.push("in-progress text including Chinese commits when switching files; clean lines and normal font on first use");
    await click('.tree-row.file[aria-label="note.md"]');
    await openBoard();
    assert.equal(JSON.parse(await disk()).elements.length, saved.elements.length);
    await fs.writeFile(path.join(output, "whiteboard.png"), (await window.webContents.capturePage()).toPNG());
    steps.push("saved scene reopens");
    await click(".excalidraw .main-menu-trigger");
    await click('.excalidraw [data-testid="clear-canvas-button"]');
    const confirm = await until(() => evaluate("(()=>{const el=document.querySelector('#desktop-overlay-root > .excalidraw-modal-container .confirm-dialog .Modal__content');return el&&el.getBoundingClientRect().height})()"), "confirm dialog in the themed overlay root");
    assert.ok(confirm > 80, "the portalled confirm dialog keeps its size");
    await wait(200);
    await fs.writeFile(path.join(output, "whiteboard-confirm.png"), (await window.webContents.capturePage()).toPNG());
    await click(".confirm-dialog-buttons button:last-child");
    await key("s", process.platform === "darwin" ? 4 : 2, "KeyS");
    await until(async () => JSON.parse(await disk()).elements.length === 0, "reset canvas saves an empty scene");
    await click('.excalidraw [data-testid="toolbar-rectangle"]');
    await pointer("mousePressed", x, y);
    for (let i = 1; i <= 10; i++) await pointer("mouseMoved", x + i * 15, y + i * 9);
    await pointer("mouseReleased", x + 150, y + 90);
    await key("s", process.platform === "darwin" ? 4 : 2, "KeyS");
    const afterReset = (await until(async () => JSON.parse(await disk()).elements.find(el => el.type === "rectangle"), "draw after reset"));
    assert.deepEqual([afterReset.roughness, afterReset.strokeWidth, afterReset.roundness], [0, 1, null], "reset canvas restores clean drawing defaults");
    steps.push("reset canvas keeps clean drawing defaults");
    const embed = { ...saved.elements[0], id: "html-demo", type: "embeddable", x: 0, y: 0, width: 400, height: 260, link: "./demo.html", version: 1, versionNonce: 1234, boundElements: null };
    const replacement = { ...saved, elements: [embed], appState: { ...saved.appState, viewBackgroundColor: "#fff4e6" } };
    const replacementText = JSON.stringify(replacement);
    await fs.writeFile(path.join(root, "board.excalidraw"), replacementText);
    await until(() => evaluate("!!document.querySelector('.whiteboard-editor iframe')"), "AI replacement and HTML embed");
    console.log("Whiteboard: embedding");
    const frame = await until(() => window.webContents.mainFrame.frames.find(frame => frame.url.includes("/document-projection/")), "HTML projection frame");
    await until(() => frame.executeJavaScript("!!document.querySelector('#counter')"), "HTML counter");
    assert.equal(await frame.executeJavaScript("document.querySelector('#counter').textContent"), "0");
    await frame.executeJavaScript("document.querySelector('#counter').click()");
    assert.equal(await frame.executeJavaScript("document.querySelector('#counter').textContent"), "1");
    assert.equal(await evaluate("document.querySelector('.whiteboard-editor iframe').sandbox.contains('allow-same-origin')"), false);
    await key("z", process.platform === "darwin" ? 4 : 2, "KeyZ");
    await wait(200);
    assert.equal(await disk(), replacementText, "undo cannot resurrect pre-AI scene");
    await fs.writeFile(path.join(root, "demo.html"), '<!doctype html><h1 id="updated">Updated HTML</h1>');
    await until(async () => {
      for (const frame of window.webContents.mainFrame.frames) {
        if (frame.url.includes("/document-projection/") && await frame.executeJavaScript("!!document.querySelector('#updated')").catch(() => false)) return true;
      }
      return false;
    }, "embedded file watcher refresh");
    await fs.writeFile(path.join(output, "embed.png"), (await window.webContents.capturePage()).toPNG());
    steps.push("real watcher adopts AI edits, clears undo and refreshes sandboxed interactive HTML");
    await click('.tree-row.file[aria-label="broken.excalidraw"]');
    await until(() => evaluate("!!document.querySelector('.whiteboard-editor [role=alert]')"), "invalid file alert");
    await click('.tree-row.file[aria-label="note.md"]');
    assert.equal(await fs.readFile(path.join(root, "broken.excalidraw"), "utf8"), "{broken");
    steps.push("invalid file preserved after closing");
    await click('.desktop-explorer-list-end-create-row');
    await until(() => evaluate("[...document.querySelectorAll('.desktop-create-entry-menu button')].some(b=>b.textContent.trim()==='Whiteboard')"), "default Whiteboard menu item");
    await evaluate("[...document.querySelectorAll('.desktop-create-entry-menu button')].find(b=>b.textContent.trim()==='Whiteboard').click()");
    const created = await until(async () => (await fs.readdir(root)).find(name => name.endsWith('.excalidraw') && !['board.excalidraw','broken.excalidraw'].includes(name)), "new standard file");
    assert.equal(JSON.parse(await fs.readFile(path.join(root, created), 'utf8')).type, 'excalidraw');
    await until(() => evaluate("!!document.querySelector('.excalidraw canvas')"), "new whiteboard opens");
    steps.push("default New menu creates and opens a standard Excalidraw file");
    assert.deepEqual(errors, [], "no renderer errors");
  } catch (error) {
    failure = error; console.error(error);
    if (window && !window.isDestroyed()) {
      await fs.writeFile(path.join(output, "failure.png"), (await window.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(output, "failure-dom.txt"), await evaluate("document.body.innerHTML"));
    }
  } finally {
    clearTimeout(deadline);
    const sourceAfter = await readSourceIdentity(repo);
    if (source.fingerprint !== sourceAfter.fingerprint) failure ??= new Error("Source changed during acceptance");
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: !failure, steps, errors, source, sourceAfter, failure: failure?.stack }, null, 2));
    console.log(`Whiteboard evidence: ${output}`);
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    app.exit(failure ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });

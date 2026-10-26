#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { workspaceFromPath } from "../../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../../shared/desktop-build-identity.mjs";
import { readSourceIdentity } from "../../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-html-app-"));
const artifactRoot = path.join(repo, "artifacts/tests/editor/html-app");
await fs.mkdir(artifactRoot, { recursive: true });
const output = await fs.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
const source = await readSourceIdentity(repo);
app.setAppPath(repo); app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
const root = path.join(temporary, "HTML Workspace"); await fs.mkdir(root);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=', 'base64');
await fs.writeFile(path.join(root, "old.png"), png);
const selectedImage = path.join(temporary, "selected.png"); await fs.writeFile(selectedImage, png);
const original = '<!DOCTYPE html>\r\n<!-- preserved -->\r\n<html><head><style>body{margin:30px}</style></head><body><h1 id="title">Original title</h1><button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button><p>Untouched paragraph</p><img id="cover" src="old.png" width="64" height="64"></body></html>';
await fs.writeFile(path.join(root, "page.html"), original);
await fs.writeFile(path.join(root, "note.md"), "# Another document");
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: value => fs.realpath(value), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
process.argv.push(root);
let window, failure;
const steps = [];
const projectionSources = new Map(), imageResponses = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (channel === "workspace:create-preview-document") projectionSources.set(result.url, args[0].content);
  return result;
});
const handleProtocol = protocol.handle.bind(protocol);
protocol.handle = (scheme, listener) => handleProtocol(scheme, async request => {
  const response = await listener(request);
  if (request.url.endsWith(".png")) imageResponses.push({ url: request.url, status: response.status });
  return response;
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code, true);
const disk = () => fs.readFile(path.join(root, "page.html"), "utf8");
const frame = () => window.webContents.mainFrame.frames.find(child => child.url === "about:srcdoc" || child.url.includes("/document-projection/"));
async function until(read, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await wait(30); }
  throw new Error(`HTML App acceptance: ${label}`);
}
async function click(selector) {
  await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function nativeClick(selector, inFrame = false) {
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const target = inFrame ? frame() : window.webContents;
  let point = await target.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if (inFrame) {
    await until(() => target.executeJavaScript(`document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})?.matches(${JSON.stringify(selector)})`),
      `frame hit target ${selector}`);
    const outer = await evaluate("(()=>{const r=document.querySelector('.html-document-editor iframe').getBoundingClientRect();return {x:r.x,y:r.y}})()");
    point.x += outer.x; point.y += outer.y;
  }
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await evaluate("new Promise(resolve=>requestAnimationFrame(resolve))");
  if (!inFrame) {
    point = await until(async () => {
      const candidate = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r&&{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      if (!candidate) return null;
      const hit = await evaluate(`document.elementFromPoint(${candidate.x},${candidate.y})?.closest(${JSON.stringify(selector)})?.matches(${JSON.stringify(selector)})`);
      if (!hit) await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...candidate });
      return hit ? candidate : null;
    }, `native hit target ${selector}`);
  }
  await window.webContents.capturePage();
  for (const type of ["mousePressed", "mouseReleased"]) await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type, ...point, button: "left", clickCount: 1,
  });
}
async function activate(selector) {
  await nativeClick(selector, true);
  assert.equal(await evaluate("!!document.querySelector('.html-editor-text-input')"), false, "page click is read-only");
  await until(() => evaluate("!!document.querySelector('.html-editor-pencil')"), "pencil entry");
  await nativeClick('.html-editor-pencil');
  await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), "shared block action rail");
  assert.equal(await evaluate("(()=>{const p=document.querySelector('.html-editor-pencil'),t=document.querySelector('.html-floating-toolbar'),v=document.querySelector('.html-visual-editor__viewport');if(p||!t||!v)return false;const tr=t.getBoundingClientRect(),vr=v.getBoundingClientRect();return tr.left>=vr.left&&tr.right<=vr.right&&tr.top>=vr.top&&tr.bottom<=vr.bottom})()"),
    true, "production rail replaces its pencil with a bounded active panel");
}
async function mode(label) {
  await click('.desktop-editor-pane-handle');
  await nativeClick(`[role="menuitemradio"][aria-label="${label}"]`);
  await click('.desktop-editor-pane-handle');
}
async function history(direction) {
  await ready();
  await evaluate("document.querySelector('.html-visual-editor iframe').focus()");
  const modifiers = (process.platform === 'darwin' ? 4 : 2) | (direction === 'redo' ? 8 : 0);
  for (const type of ['keyDown', 'keyUp']) await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers });
}
async function ready() {
  await until(() => evaluate("document.querySelector('.html-visual-editor iframe')?.getAttribute('aria-busy')==='false'"), "editing bridge ready");
}
const deadline = setTimeout(() => { console.error("HTML App acceptance timed out"); app.exit(1); }, 120000);
await import("../../../../../electron/main.mjs");
app.whenReady().then(async () => {
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window"); window.setSize(1200, 850);
    await until(() => evaluate("!!document.querySelector('.app-shell')"), "app ready");
    await evaluate("document.querySelector('.desktop-header-coachmark-actions button')?.click()");
    window.hide();
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await click('.tree-row.file[aria-label="page.html"]');
    await until(() => evaluate("!!document.querySelector('[data-html-interactive=true]')"), "HTML opens in interaction mode from Explorer");
    assert.equal(await evaluate("!!document.querySelector('.html-mode-bar,.html-mode-switch')"), false);
    assert.equal(await evaluate("(()=>{const host=document.querySelector('.html-document-editor').getBoundingClientRect(),frame=document.querySelector('.html-document-editor iframe').getBoundingClientRect();return Math.abs(frame.top-host.top)<1&&Math.abs(frame.bottom-host.bottom)<1})()"), true, 'HTML fills the editor height without an extra header');
    await until(() => evaluate("document.querySelector('[data-html-interactive=true]')?.getAttribute('aria-busy')==='false'"), 'interactive page ready under production CSP');
    await nativeClick('#counter', true);
    assert.equal(await frame().executeJavaScript("document.querySelector('#counter').textContent"), '1', 'page script runs under production CSP');
    assert.equal(await frame().executeJavaScript("typeof require"), 'undefined');
    assert.equal(await frame().executeJavaScript("typeof window.puppyone"), 'undefined');
    assert.equal(await frame().executeJavaScript("(()=>{try{return !!parent.document}catch{return false}})()"), false);
    assert.equal(await disk(), original, 'interaction leaves the original file unchanged');
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(output, "html-interaction.png"), (await window.webContents.capturePage()).toPNG());
    steps.push('default interaction, native scripted button click and isolated page under production CSP');
    await mode("Edit");
    await until(() => evaluate("!!document.querySelector('.html-visual-editor')"), "HTML edit mode selected");
    await until(() => imageResponses.some(response => response.url.endsWith("/old.png") && response.status === 200),
      "safe preview relative image resolves under production CSP");
    assert.equal(await disk(), original);
    await ready();
    await activate('#title');
    await until(() => evaluate("!!document.querySelector('.html-editor-text-input')"), "native text input reached from workbench");
    const routing = frame().routingId;
    await window.webContents.debugger.sendCommand("Input.insertText", { text: "Edited from Explorer 中文" });
    await until(async () => (await disk()).includes("Edited from Explorer 中文"), "production autosave");
    await wait(600);
    assert.equal(frame().routingId, routing, "save echo/resource refresh must not reload the active frame");
    assert.equal(await disk(), original.replace("Original title", "Edited from Explorer 中文"));
    steps.push("Explorer entry, native text input, lossless production autosave and stable frame");
    await mode("Source code");
    await until(() => evaluate("document.querySelector('.cm-content')?.textContent.includes('Edited from Explorer 中文')"), "same source model");
    await mode("Edit"); await ready();
    await history("undo"); await until(async () => await disk() === original, "shared undo");
    await history("redo"); await until(async () => (await disk()).includes("Edited from Explorer 中文"), "shared redo");
    await ready();
    await activate('#cover');
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar input[type=file]')"), "workbench image import capability");
    const { root: domRoot } = await window.webContents.debugger.sendCommand("DOM.getDocument");
    const { nodeId } = await window.webContents.debugger.sendCommand("DOM.querySelector", { nodeId: domRoot.nodeId, selector: ".html-floating-toolbar input[type=file]" });
    await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: [selectedImage] });
    await until(async () => /src="image-[a-z0-9-]+\.png"/.test(await disk()), "URI-routed image import and save");
    await until(() => frame().executeJavaScript("document.querySelector('#cover').naturalWidth===1"), "production image resource rendered");
    assert.ok((await fs.readdir(root)).some(name => /^image-.*\.png$/.test(name)));
    steps.push("production CSP preview resources and URI-routed native image import");
    await fs.writeFile(path.join(output, "html-editor.png"), (await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(root, "page.html"), "<!DOCTYPE html><h1>External replacement</h1>");
    await until(async () => {
      const current = frame();
      return current && await current.executeJavaScript("document.body?.textContent?.includes('External replacement')===true");
    }, "real workspace watcher external update");
    await history("undo"); await wait(200);
    assert.equal(await disk(), "<!DOCTYPE html><h1>External replacement</h1>");
    steps.push("source/visual shared history and real filesystem watcher invalidation");
    await click('.tree-row.file[aria-label="note.md"]');
    await until(() => evaluate("!document.querySelector('.html-document-editor')"), "HTML detached");
    await click('.tree-row.file[aria-label="page.html"]');
    await until(async () => {
      const url = await evaluate("document.querySelector('.html-document-editor iframe')?.src");
      return projectionSources.get(url)?.includes("External replacement");
    }, "HTML reopened");
    assert.equal(window.contentView.children.length, 0);
    steps.push("document switch, reopen and DOM-only pane ownership");
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
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: !failure, source, sourceAfter,
      platform: process.platform, arch: process.arch, electron: process.versions.electron, steps, failure: failure?.stack }, null, 2));
    console.log(`HTML App evidence: ${output}`);
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    app.exit(failure ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });

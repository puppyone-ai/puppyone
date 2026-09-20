#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { registerWorkspaceFileIpcHandlers } from "../../../../../electron/main/ipc/workspace-files-ipc.mjs";
import { createLocalFileCapabilityStore } from "../../../../../electron/main/local-file-capabilities.mjs";
import { parseLocalFileUrl } from "../../../../../electron/main/local-file-protocol.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const temp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-html-native-")));
const workspace = path.join(temp, "workspace");
await fsp.mkdir(workspace);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=';
await fsp.writeFile(path.join(workspace, 'old.png'), Buffer.from(png, 'base64'));
const selectedImage = path.join(temp, 'selected.png');
await fsp.writeFile(selectedImage, Buffer.from(png, 'base64'));
const original = '<!DOCTYPE html>\r\n<!-- keep exactly -->\r\n<html><head><style>body{margin:30px}h1{font-size:28px}#locked{color:red!important}</style><script>window.evil=true;parent.postMessage({type:"attack"},"*")</script></head><body onload="window.evil=true"><h1 id="title">Before</h1><p id="other">Other</p><p id="locked">Locked</p><img id="cover" src="old.png" alt="Old" width="64" height="64"><div style="height:1200px"></div><p id="bottom">Bottom</p></body></html>';
await fsp.writeFile(path.join(workspace, "page.html"), original);
app.setPath("userData", path.join(temp, "user-data"));
protocol.registerSchemesAsPrivileged([{ scheme: "puppyone-local", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win = null, vite = null;
const projectionSources = new Map();
const evaluate = (code) => win.webContents.executeJavaScript(code);
const disk = () => fsp.readFile(path.join(workspace, "page.html"), "utf8");
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { for (let i = 0; i < 250; i++) { if (await predicate()) return; await wait(30); } throw new Error(`Timed out: ${label}`); }
async function button(label) { await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)})?.click()`); }
async function control(selector) {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
}
async function history(direction) {
  await until(() => evaluate("document.querySelector('.html-visual-editor iframe')?.getAttribute('aria-busy')==='false'"), "ready for history");
  await evaluate("document.querySelector('iframe').focus()");
  const modifiers = [process.platform === 'darwin' ? 'meta' : 'control', ...(direction === 'redo' ? ['shift'] : [])];
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers });
}
const preview = () => win.webContents.mainFrame.frames.find(frame => frame.url === "about:srcdoc" || frame.url.includes("/document-projection/"));
async function clickElement(selector, twice = false) {
  const child = preview(); assert.ok(child, "preview frame exists");
  const rect = await child.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const outer = await evaluate(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  const x = Math.round(rect.x + outer.x), y = Math.round(rect.y + outer.y);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: twice ? 2 : 1 });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: twice ? 2 : 1 });
}

app.whenReady().then(async () => {
  let code = 0;
  const timeout = setTimeout(() => { console.error("HTML smoke timed out"); app.exit(1); }, 90000);
  try {
    const localFileCapabilities = createLocalFileCapabilityStore();
    protocol.handle('puppyone-local', async request => {
      const url = new URL(request.url);
      if (url.host === 'file') {
        const capability = localFileCapabilities.resolve(parseLocalFileUrl(request.url));
        if (!capability?.snapshot) return new Response('', { status: 403 });
        return new Response(capability.snapshot.bytes, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'sandbox allow-scripts' } });
      }
      if (url.host !== 'html-test' || !/^\/(?:old|image-[a-z0-9-]+)\.png$/.test(url.pathname)) return new Response('', { status: 403 });
      return new Response(await fsp.readFile(path.join(workspace, url.pathname.slice(1))), { headers: { 'content-type': 'image/png' } });
    });
    const handlers = new Map();
    registerWorkspaceFileIpcHandlers({ app, fs, BrowserWindow, ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, dialog: {}, shell: {},
      localFileCapabilities, authorizeWorkspaceRoot: async (event, root) => {
        assert.equal(event.sender, win.webContents); assert.equal(root, workspace); return workspace;
      } });
    ipcMain.handle("html-test:read", event => handlers.get("workspace:read-file")(event, { rootPath: workspace, path: "page.html" }));
    ipcMain.handle("html-test:projection", async (event, content) => {
      const result = await handlers.get("workspace:create-preview-document")(event, { rootPath: workspace, path: "page.html", content });
      projectionSources.set(result.url, content); return result;
    });
    ipcMain.handle("html-test:revoke", (event, url) => handlers.get("workspace:revoke-file-url")(event, { url }));
    ipcMain.handle("html-test:persist", (event, request) => handlers.get("workspace:write-file")(event,
      { rootPath: workspace, path: request.path, content: request.content, expectedVersion: request.baseVersion }));
    ipcMain.handle("html-test:image", async (event, request) => {
      assert.equal(event.sender, win.webContents); assert.equal(request.sourcePaths[0], selectedImage);
      return handlers.get('workspace:import-entries')(event, { ...request, rootPath: workspace });
    });
    ipcMain.handle("html-test:agent", async (event, content) => { assert.equal(event.sender, win.webContents); await fsp.writeFile(path.join(workspace, "page.html"), content); });
    const { createServer } = await import("vite");
    vite = await createServer({ root: repoRoot, cacheDir: path.join(temp, "vite-cache"), logLevel: "error",
      optimizeDeps: { entries: ["tests/fixtures/editor/formats/html-visual-editor.html"], include: ["jszip", "xlsx"] },
      server: { host: "127.0.0.1", port: 5298, strictPort: false, hmr: false, watch: null } });
    await vite.listen();
    win = new BrowserWindow({ show: true, width: 1100, height: 780, webPreferences: {
      backgroundThrottling: false, sandbox: true, contextIsolation: true,
      preload: path.join(repoRoot, "tests/fixtures/editor/formats/html-visual-editor-preload.cjs"),
    } });
    win.webContents.on("console-message", (details) => { if (details.level === "error") console.error(details.message); });
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/editor/formats/html-visual-editor.html`);
    await until(() => evaluate("!!window.htmlFixture && !!document.querySelector('iframe')"), "initial preview");
    assert.equal(await disk(), original);
    assert.equal(await evaluate("!!document.querySelector('.html-editor-toolbar,.html-editor-inspector')"), false);
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "bridge ready");
    assert.equal(await preview().executeJavaScript("!!window.evil"), false);
    assert.equal(await preview().executeJavaScript("typeof require"), "undefined");
    assert.equal(await preview().executeJavaScript("typeof window.htmlTestDisk"), "undefined");
    assert.equal(await preview().executeJavaScript("(()=>{try{return !!parent.document}catch{return false}})()"), false);
    assert.equal(await evaluate("document.querySelector('iframe').getAttribute('sandbox')"), "allow-scripts");
    const frameId = preview().routingId;
    win.webContents.debugger.attach("1.3");
    win.focus(); win.webContents.focus(); await wait(200);
    await clickElement("#title");
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), "element selection");
    await until(() => evaluate("!!document.querySelector('.html-editor-text-input')"), "text input");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-text-input')).backgroundColor"), "rgba(0, 0, 0, 0)");
    const toolbarInside = () => evaluate("(()=>{const p=document.querySelector('iframe').getBoundingClientRect(),t=document.querySelector('.html-floating-toolbar').getBoundingClientRect();return t.left>=p.left && t.right<=p.right && t.top>=p.top && t.bottom<=p.bottom})()");
    await until(toolbarInside, 'floating toolbar remains in pane');
    await fsp.writeFile('/private/tmp/puppyone-html-inline-text.png', (await win.webContents.capturePage()).toPNG());
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5, replacementStart: 0, replacementEnd: 6 });
    await wait(100);
    assert.equal(await disk(), original, 'unconfirmed composition must not be persisted');
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '你好 😀 & title' });
    await until(async () => (await disk()).includes("你好 😀 &amp; title"), "text persisted");
    assert.equal(preview().routingId, frameId, "typing must not reload the iframe");
    assert.ok((await disk()).startsWith('<!DOCTYPE html>\r\n<!-- keep exactly -->\r\n'));
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter", modifiers: ["meta"] });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter", modifiers: ["meta"] });
    await button("Show code");
    await until(() => evaluate("window.htmlFixture.source()?.includes('你好')"), "shared source model");
    await button("Show page");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "edit reattached");
    await history("undo");
    await until(async () => (await disk()).includes(">Before</h1>"), "shared undo");
    await history("redo");
    await until(async () => (await disk()).includes("你好"), "shared redo");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "history projection");
    await clickElement("#title");
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), "style inspector");
    await control('[aria-label="Text color"]');
    await control('[aria-label="Choose #3b82f6"]');
    await until(async () => (await disk()).includes('style="color: #3b82f6"'), "style persisted");
    assert.equal(await evaluate("document.activeElement?.classList.contains('html-editor-text-input')"), true, 'formatting keeps text focus');
    await until(() => evaluate("getComputedStyle(document.querySelector('.html-editor-text-input')).color==='rgb(59, 130, 246)'"), "inline text mirrors formatting");
    await evaluate("document.querySelector('.html-editor-text-input').blur()");
    await until(() => preview().executeJavaScript("getComputedStyle(document.querySelector('#title')).color==='rgb(59, 130, 246)'"), "rendered text color");
    await clickElement("#locked");
    await until(() => evaluate("document.querySelector('.html-editor-text-input')?.value==='Locked'"), "locked text");
    const beforeLocked = await disk();
    await control('[aria-label="Text color"]');
    await control('[aria-label="Choose #3b82f6"]');
    await wait(150);
    assert.equal(await disk(), beforeLocked, "important stylesheet must reject an ineffective override");
    await clickElement('#cover');
    await until(() => evaluate("!!document.querySelector('input[type=file]')"), 'image inspector');
    const { root: domRoot } = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: domRoot.nodeId, selector: 'input[type=file]' });
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [selectedImage] });
    await until(async () => /src="image-[a-z0-9-]+\.png"/.test(await disk()), 'image source persisted');
    await until(() => preview().executeJavaScript("document.querySelector('#cover').complete && document.querySelector('#cover').naturalWidth===1"), 'imported image rendered');
    const imported = (await disk()).match(/src="(image-[a-z0-9-]+\.png)"/)[1];
    assert.ok((await fsp.stat(path.join(workspace, imported))).size > 0);
    await fsp.writeFile('/private/tmp/puppyone-html-editor.png', (await win.webContents.capturePage()).toPNG());
    await history("undo");
    await until(async () => (await disk()).includes('src="old.png"'), 'image undo');
    assert.ok((await fsp.stat(path.join(workspace, imported))).size > 0, 'undo must not delete shared assets');
    await history("redo");
    await until(async () => (await disk()).includes(imported), 'image redo');
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), 'image redo projection');
    await preview().executeJavaScript("document.querySelector('#bottom').scrollIntoView()");
    await clickElement('#bottom');
    await until(() => evaluate("!!document.querySelector('.html-editor-selection')"), 'scrolled selection');
    const geometry = async () => {
      const child = await preview().executeJavaScript("(()=>{const r=document.querySelector('#bottom').getBoundingClientRect();return {x:r.x,y:r.y}})()");
      const host = await evaluate("(()=>{const frame=document.querySelector('iframe').getBoundingClientRect();const box=document.querySelector('.html-editor-selection').getBoundingClientRect();return {x:box.x-frame.x,y:box.y-frame.y}})()");
      return Math.abs(host.x-child.x)<2 && Math.abs(host.y-child.y)<2;
    };
    await until(geometry, 'selection alignment after scrolling');
    await until(toolbarInside, 'toolbar remains in pane after scrolling');
    win.setSize(440, 600);
    await until(() => evaluate("document.querySelector('iframe').clientWidth===440"), 'narrow viewport settled');
    await preview().executeJavaScript("document.querySelector('#bottom').scrollIntoView()");
    await until(toolbarInside, 'toolbar remains in narrow pane');
    win.setSize(1100, 780);
    win.webContents.setZoomFactor(1.25);
    await until(geometry, 'selection alignment after zoom');
    win.webContents.setZoomFactor(1);
    await evaluate("window.htmlTestDisk.agentWrite('<p>'+ 'x'.repeat(512*1024) +'</p>').then(()=>window.htmlFixture.refresh())");
    await until(() => evaluate("document.body.innerText.includes('Direct editing is unavailable')"), 'bounded visual fallback');
    await button('Show code');
    await until(() => evaluate("window.htmlFixture.source()?.length===512*1024+7"), 'large file source fallback');
    await evaluate("window.htmlTestDisk.agentWrite('<h1>Agent version</h1>').then(()=>window.htmlFixture.refresh())");
    await until(() => evaluate("window.htmlFixture.source()==='<h1>Agent version</h1>'"), "external refresh");
    await button('Show page');
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), 'external editor ready');
    await history("undo"); await wait(100);
    assert.equal(await disk(), '<h1>Agent version</h1>');
    await evaluate("window.htmlFixture.close()");
    await until(() => evaluate("window.htmlFixture.tasks()===0"), "task cleanup");
    await evaluate("window.htmlFixture.reopen()");
    await until(async () => {
      const url = await evaluate("document.querySelector('iframe')?.src");
      return projectionSources.get(url)?.includes("Agent version");
    }, "reopened disk");
    console.log(JSON.stringify({ passed: true, electron: process.versions.electron, platform: process.platform,
      checks: ["safe bridge", "native IME and Unicode input", "lossless source", "stable iframe", "shared source and undo", "style and cascade",
        "native image import and rendering", "image undo preserves asset", "scroll and zoom geometry", "bounded visual fallback", "disk-first external update", "close and reopen"] }));
  } catch (error) {
    code = 1; console.error(error?.stack ?? error);
    if (win) {
      console.error(await evaluate("JSON.stringify({text:document.body.innerText,toolbar:document.querySelector('.html-floating-toolbar')?.getBoundingClientRect(),style:document.querySelector('.html-floating-toolbar')?.getAttribute('style'),frame:document.querySelector('iframe')?.getBoundingClientRect(),selection:document.querySelector('.html-editor-selection')?.getBoundingClientRect()})"));
      await fsp.writeFile('/private/tmp/puppyone-html-native-failure.png', (await win.webContents.capturePage()).toPNG());
    }
  }
  finally { clearTimeout(timeout); win?.destroy(); await vite?.close(); await fsp.rm(temp, { recursive: true, force: true }); app.exit(code); }
});

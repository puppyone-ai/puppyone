#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
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
const original = '<!DOCTYPE html>\r\n<!-- keep exactly -->\r\n<html><head><style>body{margin:30px}h1{font-size:28px}#locked{color:red!important}</style><script>window.evil=true;parent.postMessage({type:"attack"},"*")</script></head><body onload="window.evil=true"><h1 id="title">Before</h1><p id="other">Other</p><p id="locked">Locked</p><img id="cover" src="old.png" alt="Old" width="64" height="64"><section id="card" style="margin-top:24px;padding:24px;height:160px;box-sizing:border-box;border-radius:18px;background:#f7f8fa"><h2 id="card-title" style="margin:0">Card title</h2><p style="margin:0">Card detail</p></section><div style="height:1200px"></div><p id="bottom">Bottom</p></body></html>';
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
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await evaluate("new Promise(resolve=>requestAnimationFrame(resolve))");
  for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
}
async function visibleSelectionBorder() {
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const box = await evaluate("(()=>{const e=document.querySelector('.html-editor-selection'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,color:getComputedStyle(e).borderTopColor.match(/[0-9]+/g).slice(0,3).map(Number)}})()");
  const screenshot = PNG.sync.read((await win.webContents.capturePage()).toPNG());
  const scale = screenshot.width / box.viewportWidth;
  for (const [x, y] of [[box.x + box.width * .8, box.y + 1], [box.x + box.width - 1, box.y + box.height / 2]]) {
    const offset = (Math.floor(y * scale) * screenshot.width + Math.floor(x * scale)) * 4;
    // Native captures can apply the display color profile; distinguish paint from the page background.
    assert.ok(box.color.every((channel, index) => Math.abs(screenshot.data[offset + index] - channel) <= 32),
      `selected block border must be painted: ${JSON.stringify({box, scale, x, y, actual: [...screenshot.data.subarray(offset, offset + 3)]})}`);
  }
}
async function history(direction) {
  await until(() => evaluate("document.querySelector('.html-visual-editor iframe')?.getAttribute('aria-busy')==='false'"), "ready for history");
  await evaluate("document.querySelector('iframe').focus()");
  const modifiers = (process.platform === 'darwin' ? 4 : 2) | (direction === 'redo' ? 8 : 0);
  for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers });
}
const preview = () => win.webContents.mainFrame.frames.find(frame => frame.url === "about:srcdoc" || frame.url.includes("/document-projection/"));
async function clickElement(selector, hover = false) {
  const child = preview(); assert.ok(child, "preview frame exists");
  const rect = await child.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const outer = await evaluate(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  const x = Math.round(rect.x + outer.x), y = Math.round(rect.y + outer.y);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  if (hover) return;
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function editElement(selector) {
  await clickElement(selector);
  await until(() => evaluate("!!document.querySelector('.html-editor-pencil')"), 'pencil available');
  await control('.html-editor-pencil');
  await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), 'explicit edit mode');
}
async function moveAway() {
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 500 });
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
    win = new BrowserWindow({ show: false, width: 1100, height: 780, webPreferences: {
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
    await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await clickElement("#title", true);
    await wait(450);
    assert.equal(await evaluate("!!document.querySelector('.html-editor-selection,.html-editor-pencil,.html-floating-toolbar,.html-editor-text-input')"), false,
      'pointer movement does not reveal or measure editing UI');
    assert.equal(await disk(), original, 'pointer movement is source inert');
    await clickElement("#title");
    await until(() => evaluate("!!document.querySelector('.html-editor-pencil')"), 'click reveals pencil');
    assert.equal(await evaluate("!!document.querySelector('.html-editor-text-input')"), false, 'page click does not start editing');
    assert.equal(await disk(), original);
    const outsideSurface = await evaluate("(()=>{const b=document.querySelector('.html-editor-pencil'),s=getComputedStyle(b),selection=getComputedStyle(document.querySelector('.html-editor-selection'));return {count:document.querySelectorAll('.html-editor-pencil').length,icons:b.querySelectorAll('svg').length,background:s.backgroundColor,shadow:s.boxShadow,border:s.borderTopWidth,borderColor:s.borderTopColor,selectionColor:selection.borderTopColor,width:b.offsetWidth,height:b.offsetHeight,stroke:selection.borderTopWidth}})()");
    assert.equal(outsideSurface.count, 1, 'one edit handle');
    assert.equal(outsideSurface.icons, 1, 'one pencil glyph');
    assert.equal(outsideSurface.background, outsideSurface.selectionColor, 'edit handle uses the block selection color');
    assert.equal(outsideSurface.borderColor, outsideSurface.selectionColor, 'handle border and surface share one theme token');
    assert.notEqual(outsideSurface.shadow, 'none', 'outside surface is visually separated from page content');
    assert.equal(outsideSurface.border, '1px');
    assert.deepEqual([outsideSurface.width, outsideSurface.height], [26, 26], 'edit affordance stays compact');
    assert.equal(outsideSurface.stroke, '2px', 'block stroke remains clear');
    const handleGeometry = () => evaluate("(()=>{const b=document.querySelector('.html-editor-pencil'),s=document.querySelector('.html-editor-selection');return {handle:b.getBoundingClientRect().toJSON(),selection:s.getBoundingClientRect().toJSON(),placement:b.dataset.placement}})()");
    const initialHandle = await handleGeometry();
    assert.equal(initialHandle.placement, 'below', 'the shared horizontal rail uses the available outside edge');
    assert.ok(initialHandle.handle.top >= initialHandle.selection.bottom);
    await visibleSelectionBorder();
    await fsp.writeFile('/private/tmp/puppyone-html-handle-outside-below.png', (await win.webContents.capturePage()).toPNG());
    await control('.html-editor-pencil');
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), "element selection");
    await until(() => evaluate("!!document.querySelector('.html-editor-text-input')"), "text input");
    assert.equal(await evaluate("!!document.querySelector('.html-editor-pencil[aria-pressed=true]')"), true, 'edit affordance remains in the active rail');
    assert.equal(await evaluate("(()=>{const p=document.querySelector('.html-editor-pencil').getBoundingClientRect(),t=document.querySelector('.html-floating-toolbar').getBoundingClientRect();return Math.abs((p.top+p.bottom-t.top-t.bottom)/2)<1})()"), true,
      'pencil and format menu share one vertical center');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-text-input')).backgroundColor"), "rgba(0, 0, 0, 0)");
    const toolbarInside = () => evaluate("(()=>{const frame=document.querySelector('iframe'),toolbar=document.querySelector('.html-floating-toolbar');if(!frame||!toolbar)return false;const p=frame.getBoundingClientRect(),t=toolbar.getBoundingClientRect();return t.left>=p.left && t.right<=p.right && t.top>=p.top && t.bottom<=p.bottom})()");
    await until(toolbarInside, 'floating toolbar remains in pane');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-selection')).borderTopColor"), 'rgb(37, 99, 235)', 'product theme accent');
    await evaluate("document.getElementById('root').style.setProperty('--po-accent','#14b8a6')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-selection')).borderTopColor"), 'rgb(20, 184, 166)', 'selection follows theme changes');
    await until(() => evaluate("getComputedStyle(document.querySelector('.html-editor-pencil')).backgroundColor==='rgb(20, 184, 166)'"), 'edit affordance follows the same theme change');
    await evaluate("document.getElementById('root').style.removeProperty('--po-accent')");
    await visibleSelectionBorder();
    await preview().executeJavaScript("document.body.style.background='#10294c'");
    await visibleSelectionBorder();
    await fsp.writeFile('/private/tmp/puppyone-html-selection-dark.png', (await win.webContents.capturePage()).toPNG());
    await preview().executeJavaScript("document.body.style.background=''");
    await fsp.writeFile('/private/tmp/puppyone-html-inline-text.png', (await win.webContents.capturePage()).toPNG());
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5, replacementStart: 0, replacementEnd: 6 });
    await moveAway(); await wait(600);
    assert.equal(await evaluate("!!document.querySelector('.html-editor-text-input')"), true, 'moving away must not discard IME');
    assert.equal(await disk(), original, 'unconfirmed composition must not be persisted');
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '你好 😀 & title' });
    await until(async () => (await disk()).includes("你好 😀 &amp; title"), "text persisted");
    await until(() => evaluate("!document.querySelector('.html-editor-selection,.html-floating-toolbar,.html-editor-text-input')"), 'commit and dismiss after leaving');
    assert.equal(preview().routingId, frameId, "typing must not reload the iframe");
    assert.ok((await disk()).startsWith('<!DOCTYPE html>\r\n<!-- keep exactly -->\r\n'));
    for (const type of ["keyDown", "keyUp"]) await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 4 });
    await button("Show code");
    await until(() => evaluate("window.htmlFixture.source()?.includes('你好')"), "shared source model");
    await button("Show page");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "edit reattached");
    await history("undo");
    await until(async () => (await disk()).includes(">Before</h1>"), "shared undo");
    await history("redo");
    await until(async () => (await disk()).includes("你好"), "shared redo");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "history projection");
    await editElement("#title");
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), "style inspector");
    const beforeTray = await evaluate("document.querySelector('.html-floating-toolbar').getBoundingClientRect().toJSON()");
    await control('[aria-label="Text color"]');
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar__popover')"), 'color tray');
    await wait(450);
    assert.equal(await evaluate("(()=>{const p=document.querySelector('.html-floating-toolbar__popover').getBoundingClientRect(),t=document.querySelector('.html-floating-toolbar').getBoundingClientRect(),v=document.querySelector('iframe').getBoundingClientRect();return p.bottom<t.top && p.top>=v.top && p.left>=v.left && p.right<=v.right})()"), true, 'separate color tray is above and inside pane');
    assert.deepEqual(await evaluate("document.querySelector('.html-floating-toolbar').getBoundingClientRect().toJSON()"), beforeTray, 'tray never moves toolbar');
    assert.equal(await evaluate("[...document.querySelectorAll('.html-floating-toolbar__swatch')].every(e=>getComputedStyle(e).borderRadius==='50%')"), true, 'circular swatches');
    await fsp.writeFile('/private/tmp/puppyone-html-pencil-palette.png', (await win.webContents.capturePage()).toPNG());
    await control('[aria-label="Choose #2563eb"]');
    await until(async () => (await disk()).includes('style="color: #2563eb"'), "style persisted");
    assert.equal(await evaluate("document.activeElement?.classList.contains('html-editor-text-input')"), true, 'formatting keeps text focus');
    await visibleSelectionBorder();
    await until(() => evaluate("getComputedStyle(document.querySelector('.html-editor-text-input')).color==='rgb(37, 99, 235)'"), "inline text mirrors formatting");
    await evaluate("document.querySelector('.html-editor-text-input').blur()");
    await until(() => preview().executeJavaScript("getComputedStyle(document.querySelector('#title')).color==='rgb(37, 99, 235)'"), "rendered text color");
    await editElement("#locked");
    await until(() => evaluate("document.querySelector('.html-editor-text-input')?.value==='Locked'"), "locked text");
    const beforeLocked = await disk();
    await control('[aria-label="Text color"]');
    await control('[aria-label="Choose #2563eb"]');
    await wait(150);
    assert.equal(await disk(), beforeLocked, "important stylesheet must reject an ineffective override");
    await editElement('#cover');
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
    await clickElement('#card');
    await until(() => evaluate("document.querySelector('.html-editor-pencil')?.dataset.placement==='above'"), 'outside top handle');
    const above = await handleGeometry();
    assert.ok(above.handle.bottom < above.selection.top, 'handle is completely outside the block');
    const start = {x:above.selection.left+above.selection.width*.25,y:above.selection.top+above.selection.height*.5};
    const end = {x:above.handle.x+above.handle.width/2,y:above.handle.y+above.handle.height/2};
    for (let step=0; step<=20; step++) {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved',x:start.x+(end.x-start.x)*step/20,y:start.y+(end.y-start.y)*step/20});
      await wait(40);
    }
    await wait(400);
    assert.equal((await handleGeometry()).selection.y, above.selection.y, 'slow diagonal approach keeps the original block');
    assert.equal(await disk(), beforeLocked.replace('src="old.png"', `src="${imported}"`), 'selection and docking never write the source');
    await fsp.writeFile('/private/tmp/puppyone-html-handle-outside-above.png', (await win.webContents.capturePage()).toPNG());
    // Exercise a flush viewport edge without changing the document model or fixture file.
    await preview().executeJavaScript("document.querySelector('#card').style.cssText='position:fixed;inset:0;margin:0;padding:24px;background:#f7f8fa'");
    await until(() => evaluate("document.querySelector('.html-editor-pencil')?.dataset.placement==='inside'"), 'inside fallback only when both outside edges are unavailable');
    await wait(180);
    const inside = await handleGeometry();
    assert.ok(inside.handle.left >= inside.selection.left && inside.handle.right <= inside.selection.right && inside.handle.top >= inside.selection.top, 'fallback stays in its block');
    assert.equal(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.html-editor-pencil')),selection=getComputedStyle(document.querySelector('.html-editor-selection'));return s.backgroundColor===selection.borderTopColor&&s.borderTopColor===selection.borderTopColor})()"),
      true, 'inside fallback preserves the selection color relationship');
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.ok(await evaluate("(()=>{const b=document.querySelector('.html-editor-pencil'),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.html-editor-pencil')===b})()"), 'inside handle remains reachable beside the standalone source menu');
    await fsp.writeFile('/private/tmp/puppyone-html-handle-inside-fallback.png', (await win.webContents.capturePage()).toPNG());
    await preview().executeJavaScript("document.querySelector('#card').style.cssText='margin-top:24px;padding:24px;height:160px;box-sizing:border-box;border-radius:18px;background:#f7f8fa'");
    await until(() => evaluate("document.querySelector('.html-editor-pencil')?.dataset.placement==='above'"), 'return outside when room becomes available');
    await control('.html-editor-pencil');
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), 'block action menu');
    assert.equal(await evaluate("(()=>{const p=document.querySelector('.html-editor-pencil').getBoundingClientRect(),t=document.querySelector('.html-floating-toolbar').getBoundingClientRect(),s=document.querySelector('.html-editor-selection').getBoundingClientRect();return t.bottom<s.top&&Math.abs((p.top+p.bottom-t.top-t.bottom)/2)<1&&Math.abs((t.left+t.right-s.left-s.right)/2)<2&&Math.abs(p.right-s.right)<2})()"),
      true, 'menu is centered above the block while the aligned pencil stays at its right edge');
    await fsp.writeFile('/private/tmp/puppyone-html-action-rail.png', (await win.webContents.capturePage()).toPNG());
    assert.equal(await evaluate("!!document.querySelector('.html-editor-text-input')"), false, 'container editing keeps its child structure');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-selection')).borderRadius"), '18px', 'border follows card corners');
    await clickElement('#card-title');
    await until(() => evaluate("document.querySelector('.html-editor-text-input')?.value==='Card title'"), 'select text inside the active block');
    await win.webContents.debugger.sendCommand('Input.insertText', { text: 'Card edited' });
    await moveAway();
    await until(() => evaluate("!document.querySelector('.html-floating-toolbar,.html-editor-selection,.html-editor-text-input')"), 'leave normal input');
    await until(async () => (await disk()).includes('>Card edited</h2><p style="margin:0">Card detail</p>'), 'leaving persists only the edited child');
    await preview().executeJavaScript("document.querySelector('#card-title').focus()");
    await until(() => evaluate("document.activeElement?.tagName==='IFRAME'"), 'keyboard focus enters preview');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => evaluate("document.activeElement?.classList.contains('html-editor-pencil')"), 'keyboard reaches pencil');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => evaluate("document.activeElement?.classList.contains('html-editor-text-input')"), 'keyboard activates pencil');
    await clickElement('#card-title', true);
    await moveAway();
    await until(() => evaluate("!document.querySelector('.html-floating-toolbar')"), 'keyboard editing also dismisses on leave');
    await preview().executeJavaScript("document.querySelector('#bottom').scrollIntoView()");
    await editElement('#bottom');
    await until(() => evaluate("!!document.querySelector('.html-editor-selection')"), 'scrolled selection');
    const geometry = async () => {
      const child = await preview().executeJavaScript("(()=>{const r=document.querySelector('#bottom').getBoundingClientRect();return {x:r.x,y:r.y}})()");
      const host = await evaluate("(()=>{const frame=document.querySelector('iframe'),selection=document.querySelector('.html-editor-selection');if(!frame||!selection)return null;const f=frame.getBoundingClientRect(),box=selection.getBoundingClientRect();return {x:box.x-f.x,y:box.y-f.y}})()");
      return !!host && Math.abs(host.x-child.x)<2 && Math.abs(host.y-child.y)<2;
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
      checks: ["pointer movement is idle and click reveals selection", "single compact theme-colored action handle", "shared aligned rail above the selected block with bounded fallbacks", "slow diagonal handle approach without target jumps", "2px clicked border", "click is read-only until pencil activation", "theme inheritance", "nested block editing preserves siblings", "keyboard pencil activation", "leave commits and dismisses; IME is protected", "separate circular palette above with stable toolbar", "safe bridge", "native IME and Unicode input", "lossless source", "stable iframe", "shared source and undo", "style and cascade",
        "native image import and rendering", "image undo preserves asset", "scroll and zoom geometry", "visible block border on light and dark backgrounds while typing and formatting", "bounded visual fallback", "disk-first external update", "close and reopen"] }));
  } catch (error) {
    code = 1; console.error(error?.stack ?? error);
    if (win) {
      console.error(await evaluate("JSON.stringify({text:document.body.innerText,active:document.activeElement?.outerHTML.slice(0,400),pencil:document.querySelector('.html-editor-pencil')?.outerHTML,toolbar:document.querySelector('.html-floating-toolbar')?.getBoundingClientRect(),style:document.querySelector('.html-floating-toolbar')?.getAttribute('style'),frame:document.querySelector('iframe')?.getBoundingClientRect(),selection:document.querySelector('.html-editor-selection')?.getBoundingClientRect()})"));
      await fsp.writeFile('/private/tmp/puppyone-html-native-failure.png', (await win.webContents.capturePage()).toPNG());
    }
  }
  finally { clearTimeout(timeout); win?.destroy(); await vite?.close(); await fsp.rm(temp, { recursive: true, force: true }); app.exit(code); }
});

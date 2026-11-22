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
import { readSourceIdentity } from "../../../../../scripts/release-checks/execution.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const source = await readSourceIdentity(repoRoot);
const artifactRoot = path.join(repoRoot, "artifacts/tests/editor/html-visual-editor");
await fsp.mkdir(artifactRoot, { recursive: true });
const output = process.env.PUPPYONE_HTML_VISUAL_ARTIFACT_DIR
  ? path.resolve(process.env.PUPPYONE_HTML_VISUAL_ARTIFACT_DIR) : await fsp.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
await fsp.mkdir(output, { recursive: true });
const temp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-html-native-")));
const workspace = path.join(temp, "workspace");
await fsp.mkdir(workspace);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=';
await fsp.writeFile(path.join(workspace, 'old.png'), Buffer.from(png, 'base64'));
const selectedImage = path.join(temp, 'selected.png');
await fsp.writeFile(selectedImage, Buffer.from(png, 'base64'));
const original = '<!DOCTYPE html>\r\n<!-- keep exactly -->\r\n<html><head><style>body{margin:30px}h1{font-size:28px}#locked{color:red!important}</style><script>window.evil=true;parent.postMessage({type:"attack"},"*")</script></head><body onload="window.evil=true"><h1 id="title">Before</h1><button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button><input id="interaction-input" placeholder="Type here"><p id="other">Other</p><p id="locked">Locked</p><img id="cover" src="old.png" alt="Old" width="64" height="64"><section id="card" style="margin-top:24px;padding:24px;height:160px;box-sizing:border-box;border-radius:18px;background:#f7f8fa"><h2 id="card-title" style="margin:0">Card title</h2><p style="margin:0">Card detail</p></section><div style="height:1200px"></div><p id="bottom">Bottom</p></body></html>';
await fsp.writeFile(path.join(workspace, "page.html"), original);
app.setPath("userData", path.join(temp, "user-data"));
protocol.registerSchemesAsPrivileged([{ scheme: "puppyone-local", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win = null, vite = null;
app.on("window-all-closed", () => {});
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
async function mode(value) {
  await control('.html-editor-options summary');
  await until(() => evaluate("document.querySelector('.html-editor-options')?.open"), 'HTML view menu open');
  await control(`[data-mode=${value}]`);
  await until(() => evaluate("!document.querySelector('.html-editor-options')?.open"), 'HTML view menu closed');
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
  // Acknowledged projection readiness precedes compositor paint. Measure only
  // after a frame, then check both coordinate spaces before native input.
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const child = preview(); assert.ok(child, "preview frame exists");
  const rect = await child.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const outer = await evaluate(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  const x = Math.round(rect.x + outer.x), y = Math.round(rect.y + outer.y);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  if (hover) return;
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await win.webContents.capturePage();
  await until(async () => await child.executeJavaScript(
    `Boolean(document.elementFromPoint(${rect.x},${rect.y})?.closest(${JSON.stringify(selector)}))`)
    && await evaluate(`document.elementFromPoint(${x},${y})===document.querySelector('iframe')`),
  `painted native hit target ${selector}`);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function editElement(selector) {
  await clickElement(selector);
  await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), 'click edits in place');
}
async function moveAway() {
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 500 });
}

async function settledScroll(top, label) {
  await until(async () => await preview().executeJavaScript('scrollY') === top
    && await evaluate(`window.__htmlScrollReceipt?.frame===document.querySelector('iframe')&&window.__htmlScrollReceipt.top===${top}`), label);
}

app.whenReady().then(async () => {
  let code = 1, failure = null, checks = [];
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
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "interactive page ready");
    assert.equal(await evaluate("document.querySelector('[data-mode=preview]').getAttribute('aria-checked')"), "true");
    assert.equal(await preview().executeJavaScript("!!window.evil"), true, 'page scripts execute in interaction mode');
    assert.equal(await preview().executeJavaScript("typeof require"), "undefined");
    assert.equal(await preview().executeJavaScript("typeof window.htmlTestDisk"), "undefined");
    assert.equal(await preview().executeJavaScript("(()=>{try{return !!parent.document}catch{return false}})()"), false);
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await clickElement('#counter');
    assert.equal(await preview().executeJavaScript("document.querySelector('#counter').textContent"), '1', 'native click reaches page handler');
    await clickElement('#interaction-input');
    await win.webContents.debugger.sendCommand('Input.insertText', { text: 'Interactive input 中文' });
    assert.equal(await preview().executeJavaScript("document.querySelector('#interaction-input').value"), 'Interactive input 中文');
    assert.equal(await disk(), original, 'runtime DOM and form input never save into HTML source');
    await fsp.writeFile(path.join(output, 'puppyone-html-interaction-mode.png'), (await win.webContents.capturePage()).toPNG());
    // Both modes relay scroll only after updating the host's saved viewport.
    // Wait for that real delivery, rather than racing a hidden frame's paint.
    await evaluate("document.addEventListener('puppyone:embedded-scroll',event=>{if(event.target===document.querySelector('iframe'))window.__htmlScrollReceipt={frame:event.target,top:event.detail.top}})");
    await preview().executeJavaScript('scrollTo(0,200)');
    await settledScroll(200, 'interaction scroll delivered to host');
    await mode("edit");
    await until(() => evaluate("document.querySelector('.html-visual-editor iframe')?.getAttribute('aria-busy')==='false'"), 'editing bridge ready');
    await settledScroll(200, 'interaction to edit retains scroll');
    await mode("preview");
    await until(() => evaluate("document.querySelector('[data-html-interactive=true]')?.getAttribute('aria-busy')==='false'"), 'return to interaction');
    await settledScroll(200, 'edit to interaction retains scroll');
    await mode("edit");
    await until(() => evaluate("document.querySelector('.html-visual-editor iframe')?.getAttribute('aria-busy')==='false'"), 'return to editing');
    await preview().executeJavaScript('scrollTo(0,0)');
    await wait(100);
    assert.equal(await preview().executeJavaScript("!!window.evil"), false);
    assert.equal(await preview().executeJavaScript("typeof require"), "undefined");
    assert.equal(await preview().executeJavaScript("typeof window.htmlTestDisk"), "undefined");
    assert.equal(await preview().executeJavaScript("(()=>{try{return !!parent.document}catch{return false}})()"), false);
    assert.equal(await evaluate("document.querySelector('iframe').getAttribute('sandbox')"), "allow-scripts");
    const frameId = preview().routingId;
    await clickElement("#title", true);
    await wait(450);
    assert.equal(await evaluate("!!document.querySelector('.html-editor-selection,.html-editor-pencil,.html-floating-toolbar,.html-editor-text-input')"), false,
      'pointer movement does not reveal or measure editing UI');
    assert.equal(await disk(), original, 'pointer movement is source inert');
    await clickElement("#title");
    // A click selects the block and edits it in the page itself: there is no
    // separate edit handle and no text box over the page.
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), 'click selects and edits in place');
    assert.equal(await evaluate("!!document.querySelector('.html-editor-pencil,.html-editor-text-input')"), false, 'the page is the editing surface');
    await until(() => preview().executeJavaScript("document.activeElement?.id==='title'&&document.activeElement.isContentEditable"), 'the clicked block takes the caret');
    assert.equal(await disk(), original, 'a click writes nothing');
    const selectionStroke = await evaluate("(()=>({count:document.querySelectorAll('.html-editor-selection').length,stroke:getComputedStyle(document.querySelector('.html-editor-selection')).borderTopWidth}))()");
    assert.deepEqual(selectionStroke, { count: 1, stroke: '2px' }, 'one clear block stroke');
    await visibleSelectionBorder();
    await fsp.writeFile(path.join(output, 'puppyone-html-selection.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate("document.getElementById('root').style.setProperty('--po-accent','#14b8a6')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-selection')).borderTopColor"), 'rgb(20, 184, 166)', 'selection follows theme changes');
    await evaluate("document.getElementById('root').style.removeProperty('--po-accent')");
    assert.equal(await evaluate("(()=>{const t=document.querySelector('.html-floating-toolbar').getBoundingClientRect(),s=document.querySelector('.html-editor-selection').getBoundingClientRect();return Math.abs((t.left+t.right-s.left-s.right)/2)<2})()"), true,
      'active format panel owns the visual center');
    const toolbarInside = () => evaluate("(()=>{const frame=document.querySelector('iframe'),toolbar=document.querySelector('.html-floating-toolbar');if(!frame||!toolbar)return false;const p=frame.getBoundingClientRect(),t=toolbar.getBoundingClientRect();return t.left>=p.left && t.right<=p.right && t.top>=p.top && t.bottom<=p.bottom})()");
    await until(toolbarInside, 'floating toolbar remains in pane');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-selection')).borderTopColor"), 'rgb(37, 99, 235)', 'product theme accent');
    await visibleSelectionBorder();
    await preview().executeJavaScript("document.body.style.background='#10294c'");
    await visibleSelectionBorder();
    await fsp.writeFile(path.join(output, 'puppyone-html-selection-dark.png'), (await win.webContents.capturePage()).toPNG());
    await preview().executeJavaScript("document.body.style.background=''");
    await preview().executeJavaScript("getSelection().selectAllChildren(document.querySelector('#title'))");
    await fsp.writeFile(path.join(output, 'puppyone-html-inline-text.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
    await moveAway(); await wait(600);
    assert.equal(await evaluate("!!document.querySelector('.html-floating-toolbar')"), true, 'moving away must not discard IME');
    assert.equal(await disk(), original, 'unconfirmed composition must not be persisted');
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '你好 😀 & title' });
    await mode("preview");
    await until(() => evaluate("document.querySelector('[data-html-interactive=true]')?.getAttribute('aria-busy')==='false'"), 'leave in-page editing for interaction');
    assert.equal(await preview().executeJavaScript("document.querySelector('#title').textContent"), '你好 😀 & title', 'mode switch commits in-page input');
    await mode("edit");
    await until(() => evaluate("document.querySelector('.html-visual-editor iframe')?.getAttribute('aria-busy')==='false'"), 'editing resumes after input commit');
    await until(async () => (await disk()).includes("你好 😀 &amp; title"), "text persisted");
    await until(() => evaluate("!document.querySelector('.html-editor-selection,.html-floating-toolbar,.html-editor-text-input')"), 'commit and dismiss after leaving');
    assert.notEqual(preview().routingId, frameId, "explicit mode changes create a fresh isolated frame");
    assert.ok((await disk()).startsWith('<!DOCTYPE html>\r\n<!-- keep exactly -->\r\n'));
    for (const type of ["keyDown", "keyUp"]) await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 4 });
    await mode("source");
    await until(() => evaluate("window.htmlFixture.source()?.includes('你好')"), "shared source model");
    await mode("edit");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "edit reattached");
    await history("undo");
    await until(async () => (await disk()).includes(">Before</h1>"), "shared undo");
    await history("redo");
    await until(async () => (await disk()).includes("你好"), "shared redo");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), "history projection");
    await editElement("#title");
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), "style inspector");
    const colorCues = await evaluate(`(()=>{
      const text = document.querySelector('[data-color-role="text"]');
      const background = document.querySelector('[data-color-role="background"]');
      const glyph = text?.querySelector('.html-floating-toolbar__text-color-glyph');
      const dot = background?.querySelector('.html-floating-toolbar__background-color-value');
      return {
        controls: document.querySelectorAll('.html-floating-toolbar__color-control').length,
        labels: [text?.getAttribute('aria-label'), background?.getAttribute('aria-label')],
        textGlyph: glyph?.textContent,
        textGlyphColor: glyph && getComputedStyle(glyph).color,
        textHasUnderline: !!text?.querySelector('.html-floating-toolbar__text-color-value'),
        backgroundHasIcon: !!background?.querySelector('svg'),
        dotSize: dot && [getComputedStyle(dot).width, getComputedStyle(dot).height],
        dotRadius: dot && getComputedStyle(dot).borderRadius,
      };
    })()`);
    assert.deepEqual(colorCues, {
      controls: 2,
      labels: ['Text color', 'Background color'],
      textGlyph: 'A',
      textGlyphColor: 'rgb(0, 0, 0)',
      textHasUnderline: false,
      backgroundHasIcon: false,
      dotSize: ['16px', '16px'],
      dotRadius: '50%',
    }, 'the colored A and standalone background dot have distinct compact visual cues');
    const beforeTray = await evaluate("document.querySelector('.html-floating-toolbar').getBoundingClientRect().toJSON()");
    await control('[aria-label="Text color"]');
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar__popover')"), 'color tray');
    await wait(450);
    assert.equal(await evaluate("(()=>{const p=document.querySelector('.html-floating-toolbar__popover').getBoundingClientRect(),t=document.querySelector('.html-floating-toolbar').getBoundingClientRect(),v=document.querySelector('iframe').getBoundingClientRect();return p.bottom<t.top && p.top>=v.top && p.left>=v.left && p.right<=v.right})()"), true, 'separate color tray is above and inside pane');
    assert.deepEqual(await evaluate("document.querySelector('.html-floating-toolbar').getBoundingClientRect().toJSON()"), beforeTray, 'tray never moves toolbar');
    assert.equal(await evaluate("[...document.querySelectorAll('.html-floating-toolbar__swatch')].every(e=>getComputedStyle(e).borderRadius==='50%')"), true, 'circular swatches');
    await fsp.writeFile(path.join(output, 'puppyone-html-pencil-palette.png'), (await win.webContents.capturePage()).toPNG());
    await control('[aria-label="Choose #2563eb"]');
    await until(async () => (await disk()).includes('style="color: #2563eb"'), "style persisted");
    assert.equal(await evaluate("document.activeElement?.tagName==='IFRAME'") && await preview().executeJavaScript("document.activeElement?.id==='title'"), true, 'formatting keeps text focus');
    await visibleSelectionBorder();
    await until(() => preview().executeJavaScript("getComputedStyle(document.querySelector('#title')).color==='rgb(37, 99, 235)'"), "rendered text color");
    await editElement("#locked");
    await until(() => preview().executeJavaScript("document.activeElement?.id==='locked'&&document.activeElement.textContent==='Locked'"), "locked text");
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
    await fsp.writeFile(path.join(output, 'puppyone-html-editor.png'), (await win.webContents.capturePage()).toPNG());
    await history("undo");
    await until(async () => (await disk()).includes('src="old.png"'), 'image undo');
    assert.ok((await fsp.stat(path.join(workspace, imported))).size > 0, 'undo must not delete shared assets');
    await history("redo");
    await until(async () => (await disk()).includes(imported), 'image redo');
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), 'image redo projection');
    await clickElement('#card');
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), 'block action menu');
    assert.equal(await evaluate("(()=>{const t=document.querySelector('.html-floating-toolbar').getBoundingClientRect(),s=document.querySelector('.html-editor-selection').getBoundingClientRect();return t.bottom<s.top&&Math.abs((t.left+t.right-s.left-s.right)/2)<2})()"),
      true, 'active menu is centered above the block');
    assert.equal(await disk(), beforeLocked.replace('src="old.png"', `src="${imported}"`), 'selecting a container never writes the source');
    await fsp.writeFile(path.join(output, 'puppyone-html-action-rail.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(await preview().executeJavaScript("document.querySelector('#card').isContentEditable"), false, 'container editing keeps its child structure');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.html-editor-selection')).borderRadius"), '18px', 'border follows card corners');
    await clickElement('#card-title');
    await until(() => preview().executeJavaScript("document.activeElement?.id==='card-title'&&document.activeElement.isContentEditable"), 'select text inside the active block');
    await preview().executeJavaScript("getSelection().selectAllChildren(document.querySelector('#card-title'))");
    await win.webContents.debugger.sendCommand('Input.insertText', { text: 'Card edited' });
    await until(async () => (await disk()).includes('>Card edited</h2><p style="margin:0">Card detail</p>'), 'in-page input persists only the edited child');
    await moveAway(); await wait(450);
    assert.equal(await evaluate("!!document.querySelector('.html-floating-toolbar')"), true, 'moving away keeps the selection');
    for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => evaluate("!document.querySelector('.html-floating-toolbar,.html-editor-selection')"), 'Escape dismisses editing');
    await preview().executeJavaScript("document.querySelector('#card-title').focus()");
    await until(() => evaluate("document.activeElement?.tagName==='IFRAME'"), 'keyboard focus enters preview');
    await until(() => evaluate("!!document.querySelector('.html-floating-toolbar')"), 'keyboard focus edits the focused block');
    assert.equal(await preview().executeJavaScript("document.querySelector('#card-title').isContentEditable"), true, 'keyboard focus edits in the page');
    for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => evaluate("!document.querySelector('.html-floating-toolbar')"), 'keyboard editing also dismisses on Escape');
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
    await mode("source");
    await until(() => evaluate("window.htmlFixture.source()?.length===512*1024+7"), 'large file source fallback');
    await evaluate("window.htmlTestDisk.agentWrite('<h1>Agent version</h1>').then(()=>window.htmlFixture.refresh())");
    await until(() => evaluate("window.htmlFixture.source()==='<h1>Agent version</h1>'"), "external refresh");
    await mode("edit");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), 'external editor ready');
    await history("undo"); await wait(100);
    assert.equal(await disk(), '<h1>Agent version</h1>');
    await evaluate("window.htmlFixture.close()");
    await until(() => evaluate("!document.querySelector('.html-document-editor')"), "closed document unmounted");
    await until(() => evaluate("window.htmlFixture.tasks()===0"), "task cleanup");
    await evaluate("window.htmlFixture.reopen()");
    await until(() => evaluate("document.querySelector('iframe')?.getAttribute('aria-busy')==='false'"), 'reopened page ready');
    await mode("edit");
    await until(async () => {
      const url = await evaluate("document.querySelector('iframe')?.src");
      return projectionSources.get(url)?.includes("Agent version");
    }, "reopened disk");
    const result = { passed: true, electron: process.versions.electron, platform: process.platform,
      checks: ["default interaction and native page scripts", "interactive form input does not write source", "mode switching commits input and retains scroll", "pointer movement is idle; a click selects and edits in the page", "no edit handle or overlay text box", "a click writes nothing until text changes", "centered active panel above the selected block", "2px clicked border", "theme inheritance", "nested block editing preserves siblings", "keyboard focus edits in place", "Escape dismisses; moving away keeps the selection; IME is protected", "semantic color controls and separate circular palette", "safe bridge", "native IME and Unicode input", "lossless source", "stable iframe", "shared source and undo", "style and cascade",
        "native image import and rendering", "image undo preserves asset", "scroll and zoom geometry", "visible block border on light and dark backgrounds while typing and formatting", "bounded visual fallback", "disk-first external update", "close and reopen"] };
    checks = result.checks; code = 0; console.log(JSON.stringify(result));
  } catch (error) {
    code = 1; failure = String(error?.stack ?? error); console.error(failure);
    if (win && !win.isDestroyed()) {
      console.error(await evaluate("JSON.stringify({host:document.querySelector('.html-document-editor')?.getBoundingClientRect(),menu:document.querySelector('.html-editor-options')?.getBoundingClientRect(),menuPosition:getComputedStyle(document.querySelector('.html-editor-options')).position,text:document.body.innerText,active:document.activeElement?.outerHTML.slice(0,400),pencil:document.querySelector('.html-editor-pencil')?.outerHTML,toolbar:document.querySelector('.html-floating-toolbar')?.getBoundingClientRect(),style:document.querySelector('.html-floating-toolbar')?.getAttribute('style'),frame:document.querySelector('iframe')?.getBoundingClientRect(),selection:document.querySelector('.html-editor-selection')?.getBoundingClientRect()})"));
      await fsp.writeFile(path.join(output, 'puppyone-html-native-failure.png'), (await win.webContents.capturePage()).toPNG());
    }
  }
  finally {
    clearTimeout(timeout);
    try {
      win?.destroy(); await vite?.close(); await fsp.rm(temp, { recursive: true, force: true });
      const sourceAfter = await readSourceIdentity(repoRoot);
      if (JSON.stringify(sourceAfter) !== JSON.stringify(source)) { code = 1; failure = "Source changed during HTML acceptance."; }
      await fsp.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: code === 0, source, sourceAfter,
        platform: process.platform, electron: process.versions.electron, checks, failure }, null, 2));
      console.log(`HTML visual evidence: ${output}`);
    } catch (error) { code = 1; console.error(error?.stack ?? error); }
    finally { app.exit(code); }
  }
});

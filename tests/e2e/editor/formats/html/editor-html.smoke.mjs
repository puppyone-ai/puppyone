#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol, shell } from "electron";
import { workspaceFromPath } from "../../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../../shared/desktop-build-identity.mjs";
import { readSourceIdentity } from "../../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-html-app-"));
const artifactRoot = path.join(repo, "artifacts/tests/editor/html-app");
await fs.mkdir(artifactRoot, { recursive: true });
const output = process.env.PUPPYONE_HTML_APP_ARTIFACT_DIR
  ? path.resolve(process.env.PUPPYONE_HTML_APP_ARTIFACT_DIR) : await fs.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
await fs.mkdir(output, { recursive: true });
const source = await readSourceIdentity(repo);
app.setAppPath(repo); app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
const root = path.join(temporary, "HTML Workspace"); await fs.mkdir(root);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=', 'base64');
await fs.writeFile(path.join(root, "old.png"), png);
const selectedImage = path.join(temporary, "selected.png"); await fs.writeFile(selectedImage, png);
const original = '<!DOCTYPE html>\r\n<!-- preserved -->\r\n<html><head><style>body{margin:30px}nav a{display:inline-block;padding:8px}</style></head><body><h1 id="title">Original title</h1><button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button><nav><a id="external" href="https://example.test/docs">External</a><a id="blank" href="https://example.test/blank" target="_blank">New window</a><a id="top" href="https://example.test/top" target="_top">Top</a><a id="mail" href="mailto:person@example.test">Email</a><a id="local" href="note.md">Note</a><a id="nested" href="unexpanded/other.html">Nested file</a><a id="anchor" href="#destination">Anchor</a><a id="same-file" href="page.html#destination">Same file anchor</a><a id="missing" href="missing.md">Missing</a><a id="unsafe" href="javascript:window.unsafeRan=true">Unsafe</a><a id="handled" href="https://example.test/handled" onclick="event.preventDefault();this.textContent=\'Handled\'">Author handler</a></nav><p>Untouched paragraph</p><img id="cover" src="old.png" width="64" height="64"><h2 id="destination" style="margin-top:1200px">Destination</h2></body></html>';
await fs.writeFile(path.join(root, "page.html"), original);
await fs.writeFile(path.join(root, "note.md"), "# Another document");
await fs.mkdir(path.join(root, "unexpanded"));
await fs.writeFile(path.join(root, "unexpanded/other.html"), '<h1 id="nested-title">Unexpanded document</h1>');
const strict = '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; connect-src \'none\'"><base href="https://example.test/docs/"><a id="strict-external" href="guide.html">Guide</a><a id="strict-anchor" href="#strict-destination">Anchor</a><script>window.authorRan=true</script><h2 id="strict-destination" style="margin-top:1200px">Strict destination</h2>';
await fs.writeFile(path.join(root, "strict.html"), strict);
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: value => fs.realpath(value), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
process.argv.push(root);
let window, failure;
const steps = [];
const openedExternal = [], attemptedExternalFrames = [];
// Spy only at the OS boundary of this isolated application; the real renderer,
// preload, IPC admission and Main external-navigation service remain in use.
shell.openExternal = async href => { openedExternal.push(href); };
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
async function nativeClick(selector, inFrame = false, { button = "left", modifiers = 0 } = {}) {
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
  if (inFrame) {
    // Re-read both coordinate spaces after paint and reject host overlays.
    point = await until(async () => {
      const inner = await target.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r&&{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      if (!inner) return null;
      const outer = await evaluate("(()=>{const f=document.querySelector('.html-document-editor iframe'),r=f?.getBoundingClientRect();return r&&{x:r.x,y:r.y}})()");
      if (!outer) return null;
      const candidate = { x: inner.x + outer.x, y: inner.y + outer.y };
      const hit = await evaluate(`document.elementFromPoint(${candidate.x},${candidate.y})===document.querySelector('.html-document-editor iframe')`);
      return hit ? candidate : null;
    }, `painted frame hit target ${selector}`);
  }
  for (const type of ["mousePressed", "mouseReleased"]) await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type, ...point, button, modifiers, clickCount: 1,
  });
}
async function interactiveReady(selector) {
  await until(async () => await evaluate("document.querySelector('[data-html-interactive=true]')?.getAttribute('aria-busy')==='false'")
    && frame() && await frame().executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`), `interactive ${selector}`);
}
async function reopenPage() {
  await click('.tree-row.file[aria-label="page.html"]');
  await interactiveReady('#external');
}
async function anchorReady(id) {
  await until(() => frame().executeJavaScript(`(()=>{const r=document.getElementById(${JSON.stringify(id)})?.getBoundingClientRect();return scrollY>0&&location.hash===${JSON.stringify(`#${id}`)}&&r&&r.top>=0&&r.bottom<=innerHeight+1})()`), `visible anchor ${id}`);
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
    window.hide();
    window.webContents.debugger.attach("1.3");
    window.webContents.on("will-frame-navigate", event => {
      if (event.url.startsWith("https://example.test/")) {
        attemptedExternalFrames.push(event.url); event.preventDefault();
      }
    });
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await click('.tree-row.file[aria-label="page.html"]');
    await until(() => evaluate("!!document.querySelector('[data-html-interactive=true]')"), "HTML opens in interaction mode from Explorer");
    assert.equal(await evaluate("!!document.querySelector('.html-mode-bar,.html-mode-switch')"), false);
    assert.equal(await evaluate("(()=>{const host=document.querySelector('.html-document-editor').getBoundingClientRect(),frame=document.querySelector('.html-document-editor iframe').getBoundingClientRect();return Math.abs(frame.top-host.top)<1&&Math.abs(frame.bottom-host.bottom)<1})()"), true, 'HTML fills the editor height without an extra header');
    await until(() => evaluate("document.querySelector('[data-html-interactive=true]')?.getAttribute('aria-busy')==='false'"), 'interactive page ready under production CSP');
    await click('.desktop-header-coachmark-actions button');
    await nativeClick('#counter', true);
    assert.equal(await frame().executeJavaScript("document.querySelector('#counter').textContent"), '1', 'page script runs under production CSP');
    assert.equal(await frame().executeJavaScript("typeof require"), 'undefined');
    assert.equal(await frame().executeJavaScript("typeof window.puppyone"), 'undefined');
    assert.equal(await frame().executeJavaScript("(()=>{try{return !!parent.document}catch{return false}})()"), false);
    assert.equal(await disk(), original, 'interaction leaves the original file unchanged');
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(output, "html-interaction.png"), (await window.webContents.capturePage()).toPNG());
    steps.push('default interaction, native scripted button click and isolated page under production CSP');
    const initialFrame = frame().routingId;
    for (const [selector, expected, options] of [
      ['#external', 'https://example.test/docs'], ['#blank', 'https://example.test/blank'],
      ['#top', 'https://example.test/top'], ['#mail', 'mailto:person@example.test'],
      ['#external', 'https://example.test/docs', { button: 'middle' }],
      ['#external', 'https://example.test/docs', { modifiers: process.platform === 'darwin' ? 4 : 2 }],
    ]) {
      const before = openedExternal.length;
      await nativeClick(selector, true, options);
      await until(() => openedExternal.length > before, `external opening ${selector}`);
      assert.equal(openedExternal.length, before + 1);
      assert.equal(openedExternal.at(-1), expected);
      assert.equal(frame().routingId, initialFrame, 'links preserve the active preview');
    }
    await frame().executeJavaScript("document.querySelector('#external').focus()");
    const beforeKeyboard = openedExternal.length;
    for (const type of ['keyDown', 'keyUp']) await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => openedExternal.length === beforeKeyboard + 1, 'keyboard link activation');
    for (const selector of ['#anchor', '#same-file']) {
      await nativeClick(selector, true);
      await anchorReady('destination');
      assert.equal(frame().routingId, initialFrame, 'anchors do not reload the preview');
      await frame().executeJavaScript("scrollTo(0,0)");
    }
    const admittedCount = openedExternal.length;
    await nativeClick('#handled', true);
    assert.equal(await frame().executeJavaScript("document.querySelector('#handled').textContent"), 'Handled');
    for (const [selector, message] of [['#unsafe', 'This link cannot be opened in this view.'], ['#missing', 'Linked file not found.']]) {
      await nativeClick(selector, true);
      await until(() => evaluate(`document.querySelector('.html-editor-notice-stack')?.textContent.includes(${JSON.stringify(message)})`), message);
      await click('.html-editor-notice-stack button');
    }
    assert.equal(await frame().executeJavaScript("window.unsafeRan===true"), false);
    assert.equal(openedExternal.length, admittedCount, 'unsafe and author-handled links never reach the OS');
    assert.deepEqual(attemptedExternalFrames, [], 'no external website is loaded inside the preview');
    assert.equal(await disk(), original);
    steps.push('native external, target blank/top, middle/modifier and keyboard clicks use Main without replacing the iframe; local anchors stay in-page; unsafe/missing links report failures');
    await nativeClick('#local', true);
    await until(() => evaluate("!document.querySelector('.html-document-editor')&&document.body.textContent.includes('Another document')"), 'workspace Markdown navigation');
    await reopenPage();
    await nativeClick('#nested', true);
    await interactiveReady('#nested-title');
    await reopenPage();
    steps.push('HTML links open workspace Markdown and files inside a previously unexpanded directory');
    await click('.tree-row.file[aria-label="strict.html"]');
    await interactiveReady('#strict-external');
    assert.equal(await frame().executeJavaScript("window.authorRan===true"), false, 'author CSP still blocks authored inline code');
    await nativeClick('#strict-external', true);
    await until(() => openedExternal.at(-1) === 'https://example.test/docs/guide.html', 'author base URL');
    await nativeClick('#strict-anchor', true);
    await anchorReady('strict-destination');
    assert.equal(await fs.readFile(path.join(root, 'strict.html'), 'utf8'), strict);
    assert.deepEqual(attemptedExternalFrames, []);
    steps.push('restrictive authored CSP and external base keep link routing and anchors functional without enabling authored scripts or changing source');
    await reopenPage();
    await mode("Edit");
    await until(() => evaluate("!!document.querySelector('.html-visual-editor')"), "HTML edit mode selected");
    await until(() => imageResponses.some(response => response.url.endsWith("/old.png") && response.status === 200),
      "safe preview relative image resolves under production CSP");
    assert.equal(await disk(), original);
    await ready();
    const beforeEdit = openedExternal.length;
    await nativeClick('#external', true);
    assert.equal(openedExternal.length, beforeEdit, 'edit-mode clicks select content instead of opening links');
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
      const current = frame();
      if (current) await fs.writeFile(path.join(output, "failure-frame.json"), JSON.stringify(await current.executeJavaScript("({url:location.href,base:document.baseURI,y:scrollY,html:document.documentElement.outerHTML})"), null, 2));
    }
  } finally {
    clearTimeout(deadline);
    const sourceAfter = await readSourceIdentity(repo);
    if (source.fingerprint !== sourceAfter.fingerprint) failure ??= new Error("Source changed during acceptance");
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: !failure, source, sourceAfter,
      platform: process.platform, arch: process.arch, electron: process.versions.electron, steps, openedExternal,
      attemptedExternalFrames, failure: failure?.stack }, null, 2));
    console.log(`HTML App evidence: ${output}`);
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    app.exit(failure ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });

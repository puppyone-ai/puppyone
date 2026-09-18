#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { app, BrowserWindow, ipcMain, protocol, webContents } from "electron";
import { workspaceFromPath } from "../../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../../shared/desktop-build-identity.mjs";
import { readSourceIdentity } from "../../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-editor-pdf-"));
const artifactRoot = path.join(repo, "artifacts/tests/editor/pdf-app");
await fs.mkdir(artifactRoot, { recursive: true });
const output = process.env.PUPPYONE_PDF_APP_ARTIFACT_DIR ?? await fs.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
await fs.mkdir(output, { recursive: true });
const source = await readSourceIdentity(repo);
const fixture = path.join(repo, "tests/fixtures/editor/formats/samples/sample_document.pdf");
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
const roots = [];
for (const name of ["PDF Project A", "PDF Project B"]) {
  const root = path.join(temporary, name); await fs.mkdir(root);
  await fs.copyFile(fixture, path.join(root, "report.pdf"));
  await fs.copyFile(fixture, path.join(root, "loading.pdf"));
  await fs.writeFile(path.join(root, "note.md"), `# ${name}\n\nNo PDF belongs on this page.`);
  await fs.writeFile(path.join(root, "invalid.pdf"), "<html>Not a PDF</html>");
  await fs.writeFile(path.join(root, "corrupt.pdf"), "%PDF-1.7\nstructurally broken PDF");
  roots.push(await fs.realpath(root));
}
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json",
  canonicalizeWorkspacePath: root => fs.realpath(root), workspaceFromPath });
for (const root of [...roots].reverse()) await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
process.argv.push(roots[0]);
let gate, navigationGate;
const originalProtocolHandle = protocol.handle.bind(protocol);
protocol.handle = (scheme, listener) => originalProtocolHandle(scheme, async request => {
  if (scheme === "puppyone-local" && request.method === "GET" && navigationGate && request.url.includes("report.pdf")) {
    const pending = navigationGate; navigationGate = null; pending.started(); await pending.promise;
  }
  return listener(request);
});
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (channel === "workspace:get-file-url" && gate && args[0]?.path === "loading.pdf") {
    const pending = gate; gate = null; pending.started(); await pending.promise;
  }
  return result;
});
let networkRequests = 0;
const network = createServer((_request, response) => { networkRequests++; response.end("Must not load inside a PDF"); });
await new Promise(resolve => network.listen(0, "127.0.0.1", resolve));
const networkUrl = `http://127.0.0.1:${network.address().port}/forbidden`;
let window, failure, initialContentsCount;
const steps = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(read, label) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await wait(30); }
  throw new Error(`PDF App acceptance: ${label}`);
}
async function click(selector) {
  await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
const openFile = name => click(`.tree-row.file[aria-label="${name}"]`);
function pdfFrames() {
  const pending = [...window.webContents.mainFrame.frames], result = [];
  while (pending.length) {
    const frame = pending.shift();
    if (frame.url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/")) result.push(frame);
    pending.push(...frame.frames);
  }
  return result;
}
async function pdfReady() {
  await until(() => evaluate("Boolean(document.querySelector('.pdf-preview-surface[data-preview-state=embedded] iframe'))"), "DOM attachment");
  // TEST-ONLY probe of this Electron version. Production does not read private
  // Chromium DOM and must not mistake embedded for parsed successfully.
  await until(async () => {
    for (const frame of pdfFrames()) {
      try { if (await frame.executeJavaScript("document.querySelector('pdf-viewer')?.loadState_ === 'success'")) return true; }
      catch { /* OOPIF replacement during load. */ }
    }
    return false;
  }, "real PDFium successful parse");
  assert.equal(pdfFrames().length, 1);
  assert.equal(window.contentView.children.length, 0, "PDF must not allocate a native sibling");
}
async function selectProject(name) {
  await evaluate(`(() => {
    const button=[...document.querySelectorAll('.desktop-project-switcher-rail-project')]
      .find(element=>element.getAttribute('aria-label')?.includes(${JSON.stringify(name)}));
    if(!button) throw new Error('Missing project button'); button.click();
  })()`);
  await until(() => evaluate(`[...document.querySelectorAll('.desktop-project-switcher-rail-project')].some(element=>element.getAttribute('aria-label')?.includes(${JSON.stringify(name)})&&element.getAttribute('aria-current')==='page')`), name);
}
async function noPdf(label) {
  await until(() => evaluate("document.querySelectorAll('.pdf-preview-frame').length===0"), `${label} DOM detach`);
  await until(() => pdfFrames().length === 0, `${label} PDFium teardown`);
  assert.equal(window.contentView.children.length, 0);
  await until(() => webContents.getAllWebContents().length === initialContentsCount, `${label} WebContents ownership`);
  steps.push(label);
}
async function bounds(label) {
  const box = await until(() => evaluate(`(() => {
    const frame=document.querySelector('.pdf-preview-frame'), parent=document.querySelector('.pdf-preview-surface');
    if(!frame||!parent)return null;
    const f=frame.getBoundingClientRect(),p=parent.getBoundingClientRect();
    return f.width>0&&f.height>0?{frame:{x:f.x,y:f.y,width:f.width,height:f.height},parent:{x:p.x,y:p.y,width:p.width,height:p.height}}:null;
  })()`), label);
  for (const key of ["x", "y", "width", "height"]) assert(Math.abs(box.frame[key] - box.parent[key]) < 1, `${label}: ${key}`);
  assert.equal(await evaluate("document.querySelector('.pdf-preview-frame')===window.__retainedPdf"), true, `${label}: replaced PDF`);
  steps.push({ label, ...box });
}
async function capture(label) { await fs.writeFile(path.join(output, `${label}.png`), (await window.webContents.capturePage()).toPNG()); }
async function settled(selector) {
  await evaluate(`Promise.allSettled(document.querySelector(${JSON.stringify(selector)}).getAnimations({subtree:true})
    .filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished))`);
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}
const deadline = setTimeout(() => { console.error("PDF App acceptance timed out"); app.exit(1); }, 180_000);
await import("../../../../../electron/main.mjs");
app.whenReady().then(async () => {
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window");
    window.setSize(1200, 850); window.show(); window.focus();
    await until(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "App ready");
    await evaluate("localStorage.setItem('puppyone.desktop.experimental',JSON.stringify({enableMultiRootWorkspaces:true,enableProjectSwitcherRail:true}));location.reload()");
    await until(() => evaluate("document.querySelectorAll('.desktop-project-switcher-rail-project').length===2"), "projects ready");
    initialContentsCount = webContents.getAllWebContents().length;
    await openFile("report.pdf"); await pdfReady();
    await evaluate("window.__retainedPdf=document.querySelector('.pdf-preview-frame')");
    await capture("pdf-ready"); await bounds("initial");
    window.setSize(950, 700); await wait(150); await bounds("window-resized");
    for (const zoom of [1.25, 0.8, 1]) {
      window.webContents.setZoomFactor(zoom); await wait(150); await bounds(`window-zoom-${zoom}`);
    }
    window.setSize(1200, 850);
    await evaluate("document.querySelector('.data-explorer-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
    await settled(".explorer-column"); await bounds("left-sidebar-resized");
    await evaluate("document.querySelector('.data-explorer-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");
    await until(() => evaluate("document.querySelector('.data-content')?.dataset.explorerCollapsed==='true'"), "left sidebar collapse");
    await settled(".explorer-column"); await bounds("left-sidebar-collapsed");
    await click(".desktop-titlebar-sidebar-expand");
    await until(() => evaluate("document.querySelector('.data-content')?.dataset.explorerCollapsed!=='true'"), "left sidebar expand");
    await settled(".explorer-column"); await bounds("left-sidebar-restored");
    for (const label of ["sidebar-toggled", "sidebar-restored"]) {
      await click(".desktop-titlebar-terminal, .desktop-shell-toolbar-terminal");
      await wait(400); await bounds(label);
    }
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,bubbles:true}))");
    await until(() => evaluate("Boolean(document.querySelector('.desktop-settings-dialog'))"), "real Settings Dialog");
    await settled(".desktop-settings-dialog");
    assert(await evaluate(`(() => {
      const dialog=document.querySelector('.desktop-settings-dialog'),r=dialog.getBoundingClientRect();
      return dialog.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    })()`), "Settings must cover the PDF in DOM hit testing");
    await bounds("settings-preserves-pdf"); await capture("settings-over-pdf");
    const sample = await evaluate(`(() => {
      const dialog=document.querySelector('.desktop-settings-dialog'),r=dialog.getBoundingClientRect(),css=getComputedStyle(dialog);
      return {x:Math.round(r.right-30),y:Math.round(r.bottom-30),width:innerWidth,height:innerHeight,
        color:css.backgroundColor,opacity:css.opacity};
    })()`);
    assert.equal(sample.opacity, "1");
    const expected = sample.color.match(/[\d.]+/g).slice(0,3).map(Number);
    const pixels = (await window.webContents.capturePage()).resize({width:sample.width,height:sample.height}).toBitmap();
    const offset = (sample.y * sample.width + sample.x) * 4;
    const actual = [pixels[offset+2],pixels[offset+1],pixels[offset]];
    assert(actual.every((value,index)=>Math.abs(value-expected[index])<5), `PDF painted over opaque Settings: ${actual} vs ${expected}`);
    steps.push({label:"settings-composited-pixel",expected,actual});
    await click(".desktop-settings-dialog .desktop-dialog-icon-button");
    await until(() => evaluate("!document.querySelector('.desktop-settings-dialog')"), "Settings close");
    await pdfReady(); await bounds("settings-closed");

    const engine = pdfFrames()[0];
    assert.equal(await engine.executeJavaScript("typeof window.puppyoneDesktop"), "undefined");
    assert.equal(await engine.executeJavaScript("typeof require"), "undefined");
    assert.equal(await engine.executeJavaScript(`fetch(${JSON.stringify(networkUrl)}).then(()=>false,()=>true)`), true);
    assert.equal(networkRequests, 0, "PDF network request escaped the session policy");
    assert.equal(await evaluate("navigator.permissions.query({name:'geolocation'}).then(result=>result.state)"), "denied");
    assert.equal(await evaluate("navigator.permissions.query({name:'clipboard-write'}).then(result=>result.state)"), "granted");
    assert.equal(await engine.executeJavaScript("navigator.permissions.query({name:'clipboard-write'}).then(result=>result.state)"), "denied");
    steps.push("real-session-network-and-permission-denial");

    await selectProject("PDF Project B"); await openFile("note.md"); await noPdf("ready-project-switch");
    assert(await evaluate("window.__retainedPdf.isConnected===false"));
    await selectProject("PDF Project A"); await pdfReady();
    const projectASrc = await evaluate("document.querySelector('.pdf-preview-frame').src");
    await selectProject("PDF Project B"); await openFile("report.pdf"); await pdfReady();
    assert.notEqual(await evaluate("document.querySelector('.pdf-preview-frame').src"), projectASrc, "Equal paths in different projects must not share input");
    await openFile("note.md"); await noPdf("same-path-different-project");
    await selectProject("PDF Project A"); await pdfReady();
    let release, started;
    const didStart = new Promise(resolve => { started = resolve; });
    gate = { promise: new Promise(resolve => { release = resolve; }), started };
    await openFile("loading.pdf"); await didStart;
    await selectProject("PDF Project B"); await noPdf("loading-project-switch");
    release(); await wait(250); await noPdf("late-resource-cannot-resurrect-pdf");
    await selectProject("PDF Project A"); await openFile("note.md"); await noPdf("before-navigation-gate");
    let releaseNavigation, navigationStarted;
    const didNavigate = new Promise(resolve => { navigationStarted = resolve; });
    navigationGate = { promise: new Promise(resolve => { releaseNavigation = resolve; }), started: navigationStarted };
    await openFile("report.pdf"); await didNavigate;
    assert(await evaluate("Boolean(document.querySelector('.pdf-preview-frame'))"));
    await selectProject("PDF Project B"); await noPdf("inflight-frame-project-switch");
    releaseNavigation(); await wait(250); await noPdf("late-navigation-cannot-resurrect-pdf");
    for (let cycle = 0; cycle < 3; cycle++) {
      await selectProject("PDF Project A"); await openFile("report.pdf"); await pdfReady();
      await selectProject("PDF Project B"); await noPdf(`repeat-switch-${cycle}`);
    }
    await selectProject("PDF Project A"); await openFile("invalid.pdf");
    await until(() => evaluate("Boolean(document.querySelector('.pdf-preview-shell .editor-state'))"), "invalid resource error");
    await noPdf("invalid-resource-never-attaches");
    await openFile("corrupt.pdf");
    await until(async () => {
      for (const frame of pdfFrames()) {
        try { if (await frame.executeJavaScript("document.querySelector('pdf-viewer')?.loadState_ === 'failed'")) return true; } catch {}
      }
      return false;
    }, "PDFium owns structurally corrupt PDF failure");
    assert.equal(await evaluate("document.querySelector('.pdf-preview-surface')?.dataset.pdfParseState"), "unknown");
    await capture("engine-owned-corrupt-pdf");
    await openFile("report.pdf"); await pdfReady();
    const oldSrc = await evaluate("document.querySelector('.pdf-preview-frame').src");
    await fs.copyFile(fixture, path.join(roots[0], "report.pdf"));
    await until(() => evaluate(`document.querySelector('.pdf-preview-frame')?.src!==${JSON.stringify(oldSrc)}`), "external update resource generation");
    await pdfReady(); steps.push("external-update-reacquires-resource");
    await openFile("note.md"); await noPdf("document-switch");
    await capture("note-no-residual-pdf");
  } catch (error) {
    failure = error; console.error(error);
    if (window && !window.isDestroyed()) {
      await capture("failure");
      await fs.writeFile(path.join(output, "failure-dom.txt"), await evaluate("document.body.innerHTML"));
    }
  } finally {
    clearTimeout(deadline); await new Promise(resolve => network.close(resolve));
    const sourceAfter = await readSourceIdentity(repo);
    if (source.fingerprint !== sourceAfter.fingerprint) failure ??= new Error("Source changed during acceptance");
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: !failure, source, sourceAfter,
      electron: process.versions.electron, platform: process.platform, steps, networkRequests,
      verification: "Full production App; programmatic DOM actions and Chromium composition (not OS-native pointer or cross-monitor acceptance)",
      failure: failure?.stack }, null, 2));
    console.log(`PDF App evidence: ${output}`);
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    app.exit(failure ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });

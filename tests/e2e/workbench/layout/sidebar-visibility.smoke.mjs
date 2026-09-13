#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, webContents } from "electron";
import { workspaceFromPath } from "../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";
import { installFixtureAgent } from "../../../support/agent/install-fixture-agent.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";
import { canCaptureNativeWindow, captureNativeWindow, markNativeSurface, countMarkerPixels, compareEditorRegion } from "../../../support/electron/native-window-visibility.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-sidebar-visibility-"));
const artifactRoot = path.join(repo, "artifacts/tests/workbench/sidebar-visibility");
await fs.mkdir(artifactRoot, { recursive: true });
const output = process.env.PUPPYONE_SIDEBAR_VISIBILITY_ARTIFACT_DIR
  ? path.resolve(process.env.PUPPYONE_SIDEBAR_VISIBILITY_ARTIFACT_DIR) : await fs.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
await fs.mkdir(output, { recursive: true });
const source = await readSourceIdentity(repo);
const nativeInput = process.argv.includes("--native");
const execute = promisify(execFile);
const pointerBinary = path.join(temporary, "native-pointer");
const colors = [];
const captures = [];
let nativeCapture = false;
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
process.env.SHELL = "/bin/sh";
const roots = [];
for (const name of ["Visibility A", "Visibility B"]) {
  const root = path.join(temporary, name); await fs.mkdir(root);
  await fs.writeFile(path.join(root, "note.md"), "# Visible editor\n\n" + "Underlying editor content.\n\n".repeat(100));
  roots.push(await fs.realpath(root));
}
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: root => fs.realpath(root), workspaceFromPath });
for (const root of [...roots].reverse()) await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
process.argv.push(roots[0]);
const restoreProvider = installFixtureAgent(repo);
const creates = [];
let pendingReply = null;
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (["terminal:create", "agent:session-create"].includes(channel)) creates.push({ channel, request: args[0], result });
  if (pendingReply?.channel === channel) { const gate = pendingReply; pendingReply = null; gate.started(); await gate.promise; }
  return result;
});
app.on("window-all-closed", () => {});
const steps = [];
let window;
let failure;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(read, label) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await wait(30); }
  throw new Error(`Sidebar visibility: ${label}`);
}
const toggle = ".desktop-titlebar-terminal, .desktop-shell-toolbar-terminal";
const contributionKind = kind => kind === "agent" ? "agent-chat" : kind;
const isOpen = () => evaluate("document.querySelector('.desktop-right-sidebar')?.classList.contains('is-open')");
async function click(selector) { assert(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function sidebar(open) {
  if (await isOpen() !== open) await click(toggle);
  await until(async () => await isOpen() === open, `sidebar ${open ? "open" : "closed"}`);
  // A pending item has an infinite loading spinner; only await the sidebar's finite transitions.
  await evaluate("Promise.allSettled(document.querySelector('.desktop-right-sidebar').getAnimations({subtree:true}).filter(x=>x.effect?.getComputedTiming().iterations!==Infinity).map(x=>x.finished))");
  await until(() => evaluate(`document.querySelector('.desktop-right-sidebar')?.dataset.panePresentation === ${JSON.stringify(open ? "expanded" : "collapsed")}`), "settled presentation");
}
const host = id => `[data-terminal-session-host-id="${id}"] .desktop-terminal-contribution-host`;
const presented = id => evaluate(`document.querySelector(${JSON.stringify(host(id))})?.getAttribute('aria-hidden')==='false'`);
const visibleItems = () => evaluate("[...document.querySelectorAll('.desktop-terminal-contribution-host[data-item-kind]:not([data-item-kind=launcher])')].filter(e=>e.getAttribute('aria-hidden')==='false').length");
async function hidden(label) {
  assert.equal(await isOpen(), false);
  await until(() => evaluate("document.querySelector('.desktop-right-sidebar')?.dataset.panePresentation==='collapsed'"), `${label}: collapse settled`);
  await wait(100);
  assert.equal(await visibleItems(), 0, `${label}: contribution reappeared`);
  assert.equal(window.contentView.children.length, 0, "Agent/Terminal must not allocate a floating native child");
  assert(await evaluate("Boolean(document.querySelector('.desktop-right-sidebar-inner[inert][aria-hidden=true]'))"), "Collapsed contents must be inert");
  assert(await evaluate("!document.activeElement?.closest('.desktop-right-sidebar-inner')"), "Collapsed contents retained DOM focus");
  const page = await window.webContents.capturePage();
  await fs.writeFile(path.join(output, `${label}-page.png`), page.toPNG());
  assert.equal(Math.max(0, ...colors.map(color => countMarkerPixels(page, color))), 0, `${label}: sidebar DOM paint leaked into the page`);
  if (nativeCapture) {
    const image = await captureNativeWindow(window);
    await fs.writeFile(path.join(output, `${label}-composite.png`), image.toPNG());
    const pixels = Math.max(0, ...colors.map(color => countMarkerPixels(image, color)));
    const comparison = await compareEditorRegion(window, image);
    await fs.writeFile(path.join(output, `${label}-editor-expected.png`), comparison.expected.toPNG());
    await fs.writeFile(path.join(output, `${label}-editor-actual.png`), comparison.actual.toPNG());
    captures.push({ label, markerPixels: pixels, mismatchRatio: comparison.mismatchRatio });
    assert.equal(pixels, 0, `${label}: native content remains in the composed window`);
    assert(comparison.mismatchRatio < 0.005, `${label}: composed Editor contains residual pixels (${comparison.mismatchRatio})`);
  }
  await editorInput(label);
  steps.push({ label, visibleItems: await visibleItems(), nativeChildren: window.contentView.children.length });
}
async function editorInput(label) {
  const point = await evaluate(`(() => {
    const e=document.querySelector('.desktop-editor-pane .cm-scroller'); const r=e.getBoundingClientRect();
    e.scrollTop=0; return {x:r.right-80,y:r.top+150};
  })()`);
  app.focus({ steal: true });
  window.focus();
  if (nativeInput) await until(() => window.isFocused(), `${label}: native window focus`);
  else window.webContents.focus(); // Synthetic input does not perform OS focus routing.
  await evaluate("window.__visibilityEvents=[]");
  const send = async kind => {
    if (nativeInput) {
      const bounds = window.getContentBounds();
      await execute(pointerBinary, [kind, String(Math.round(bounds.x + point.x)), String(Math.round(bounds.y + point.y))], { timeout: 5000 });
    } else {
      const pos = { x: Math.round(point.x), y: Math.round(point.y) };
      window.webContents.sendInputEvent({ type: "mouseMove", ...pos });
      await wait(30);
      if (kind === "click") {
        window.webContents.sendInputEvent({ type: "mouseDown", ...pos, button: "left", clickCount: 1 });
        window.webContents.sendInputEvent({ type: "mouseUp", ...pos, button: "left", clickCount: 1 });
      } else {
        if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
        await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", ...pos, deltaY: 180, deltaX: 0 });
      }
    }
  };
  await send("click");
  await until(() => evaluate("window.__visibilityEvents.some(x=>x.type==='pointerdown'&&x.editor)"), `${label}: underlying editor click`);
  if (nativeInput) await until(() => webContents.getFocusedWebContents()?.id === window.webContents.id, `${label}: hidden child stole focus`);
  else assert(await evaluate("Boolean(document.activeElement?.closest('.desktop-editor-pane'))"), `${label}: editor DOM focus`);
  await send("scroll");
  await until(() => evaluate("document.querySelector('.desktop-editor-pane .cm-scroller').scrollTop>0"), `${label}: underlying editor scroll`);
}
async function opened(id, label) {
  await until(() => presented(id), `${label}: content restored`);
  const color = await markNativeSurface(window.webContents, host(id)); colors.push(color);
  await wait(100);
  const page = await window.webContents.capturePage();
  assert(countMarkerPixels(page, color) > 100, "Opened contribution did not paint");
  const image = nativeCapture ? await captureNativeWindow(window) : page;
  await fs.writeFile(path.join(output, `${label}-composite.png`), image.toPNG());
  const pixels = countMarkerPixels(image, color);
  captures.push({ label, markerPixels: pixels });
  assert(pixels > 100, "Capture omitted the visible contribution; absence checks would be invalid");
}
async function selectProject(name) {
  await evaluate(`[...document.querySelectorAll('.desktop-project-switcher-rail-project')].find(x=>x.title.includes(${JSON.stringify(name)})).click()`);
  await until(() => evaluate(`[...document.querySelectorAll('.desktop-project-switcher-rail-project')].some(x=>x.title.includes(${JSON.stringify(name)})&&x.getAttribute('aria-current')==='page')`), name);
}
async function launch(kind) {
  await sidebar(true);
  if (!await evaluate("[...document.querySelectorAll('.desktop-terminal-launcher-shell')].some(x=>x.getBoundingClientRect().width>0&&x.closest('[aria-hidden]')?.getAttribute('aria-hidden')!=='true')")) await click(".desktop-terminal-new-button");
  const before = await evaluate("[...document.querySelectorAll('.desktop-terminal-contribution-host')].map(e=>e.closest('[data-terminal-session-host-id]').dataset.terminalSessionHostId)");
  if (kind === "terminal") await evaluate("[...document.querySelectorAll('.desktop-terminal-launcher-shell')].find(x=>x.getBoundingClientRect().width>0&&x.closest('[aria-hidden]')?.getAttribute('aria-hidden')!=='true').click()");
  else {
    await until(() => evaluate("[...document.querySelectorAll('.desktop-terminal-launcher-tool')].some(x=>x.textContent.trim()==='Codex'&&x.getBoundingClientRect().width>0&&x.closest('[aria-hidden]')?.getAttribute('aria-hidden')!=='true')"), "fixture Agent launcher");
    await evaluate("[...document.querySelectorAll('.desktop-terminal-launcher-tool')].find(x=>x.textContent.trim()==='Codex'&&x.getBoundingClientRect().width>0&&x.closest('[aria-hidden]')?.getAttribute('aria-hidden')!=='true').click()");
  }
  return until(() => evaluate(`[...document.querySelectorAll('.desktop-terminal-contribution-host[data-item-kind="${contributionKind(kind)}"]')].map(e=>e.closest('[data-terminal-session-host-id]').dataset.terminalSessionHostId).find(id=>!${JSON.stringify(before)}.includes(id))`), `${kind} DOM contribution`);
}
const deadline = setTimeout(() => {
  const failure = "Sidebar visibility exceeded 180 seconds";
  console.error(failure);
  void fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: false, source, steps, captures, failure }, null, 2))
    .finally(() => app.exit(1));
}, 180_000);
await import("../../../../electron/main.mjs");
app.whenReady().then(async () => {
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window");
    window.setSize(1200, 850); window.show(); app.focus({ steal: true }); window.focus();
    await until(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "App ready");
    await evaluate("localStorage.setItem('puppyone.desktop.experimental',JSON.stringify({enableMultiRootWorkspaces:true,enableProjectSwitcherRail:true}));location.reload()");
    await until(() => evaluate("document.querySelectorAll('.desktop-project-switcher-rail-project').length===2"), "projects ready");
    nativeCapture = canCaptureNativeWindow();
    if (nativeInput) {
      assert.equal(process.platform, "darwin", "OS pointer acceptance currently targets macOS");
      assert(nativeCapture, "Native acceptance requires screen capture permission");
      await execute("clang", [path.join(repo, "tests/support/electron/macos-native-pointer.c"), "-framework", "ApplicationServices", "-o", pointerBinary]);
    }
    await until(() => evaluate("Boolean(document.querySelector('.tree-row.file[aria-label=\"note.md\"]'))"), "editor file");
    await click('.tree-row.file[aria-label="note.md"]');
    await until(() => evaluate("Boolean(document.querySelector('.desktop-editor-pane .cm-editor'))"), "real editor");
    await evaluate(`window.__visibilityEvents=[];for(const type of ['pointerdown','wheel']) document.addEventListener(type,event=>window.__visibilityEvents.push({type,editor:Boolean(event.target.closest('.desktop-editor-pane'))}),{capture:true,passive:true})`);
    await sidebar(true);
    const retained = [];
    for (const kind of ["terminal", "agent"]) {
      const id = await launch(kind); retained.push(id);
      await opened(id, `${kind}-open`);
      await evaluate(`window.__retainedNode=document.querySelector(${JSON.stringify(host(id))})`);
      if (kind === "agent") {
        await until(() => evaluate("Boolean(document.querySelector('.desktop-agent-prompt-editor .cm-content[contenteditable=true]'))"), "draft editor");
        await evaluate("document.querySelector('.desktop-agent-prompt-editor .cm-content').focus()");
        await window.webContents.insertText("Retained sidebar draft");
      }
      await sidebar(false); await hidden(`${kind}-closed`);
      await sidebar(true); await until(() => presented(id), `${kind} restored`);
      for (let cycle = 0; cycle < 8; cycle++) { await click(toggle); await wait(12); await click(toggle); await wait(12); }
      await sidebar(false);
      // Old transition completion and late session summaries must not reopen the frame.
      await evaluate("document.querySelector('.desktop-right-sidebar').dispatchEvent(new TransitionEvent('transitionend',{propertyName:'width',bubbles:true}))");
      await hidden(`${kind}-rapid-and-late-transition`);
      await sidebar(true); await until(() => presented(id), `${kind} rapid restore`);
      assert(await evaluate(`window.__retainedNode===document.querySelector(${JSON.stringify(host(id))})`), "Toggle remounted the contribution");
      if (kind === "agent") assert.equal(await evaluate("document.querySelector('.desktop-agent-prompt-editor .cm-content').textContent"), "Retained sidebar draft");
      console.log(`${kind}: collapse, rapid toggles, late transition, editor input and retention passed`);
    }
    const agentId = retained[1];
    await evaluate(`document.querySelector('[data-terminal-tab-session-id="${agentId}"] .desktop-terminal-tab-select').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,shiftKey:true,bubbles:true}))`);
    await until(async () => await visibleItems() === 2, "mixed split visible");
    const terminalCreations = creates.filter(entry => entry.channel === "terminal:create").length;
    await sidebar(false); await hidden("mixed-split-closed");
    await selectProject("Visibility B");
    assert.equal(await visibleItems(), 0);
    await selectProject("Visibility A");
    await hidden("project-switch-while-closed");
    await sidebar(true); await until(async () => (await Promise.all(retained.map(presented))).every(Boolean), "mixed split restored");
    assert.equal(creates.filter(entry => entry.channel === "terminal:create").length, terminalCreations, "Presentation restarted terminal execution");
    assert.equal(await evaluate("document.querySelector('.desktop-agent-prompt-editor .cm-content').textContent"), "Retained sidebar draft");
    console.log("Mixed split and project switching passed");
    for (const kind of ["agent", "terminal"]) {
      let release; let replyStarted = false;
      pendingReply = { channel: kind === "agent" ? "agent:session-create" : "terminal:create",
        promise: new Promise(done => { release = done; }), started: () => { replyStarted = true; } };
      const creating = launch(kind);
      try { await until(() => replyStarted, `${kind}: delayed startup began`); await sidebar(false); }
      finally { release(); pendingReply = null; }
      const late = await creating;
      await until(() => evaluate(`document.querySelector('[data-terminal-tab-session-id="${late}"]')?.dataset.status === ${JSON.stringify(kind === "terminal" ? "running" : "idle")}`), `${kind}: startup completed while hidden`);
      await hidden(`${kind}-finished-loading-while-closed`);
      await sidebar(true); await until(() => presented(late), `late ${kind} shown only on reopen`);
    }
    // Keyboard collapse and the collapsed edge use the same content visibility contract.
    await evaluate("document.querySelector('.desktop-right-sidebar-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");
    await sidebar(false); await hidden("keyboard-collapsed");
    await click(".desktop-right-sidebar-resizer");
    await until(isOpen, "collapsed edge reopens");
    await sidebar(false); await hidden("final-closed");
  } catch (error) { failure = error; console.error(error); }
  finally {
    if (window && !window.isDestroyed()) {
      if (failure) {
        await fs.writeFile(path.join(output, "failure.png"), (await window.webContents.capturePage()).toPNG());
        if (nativeCapture) await fs.writeFile(path.join(output, "failure-composite.png"), (await captureNativeWindow(window)).toPNG());
      }
      for (const created of creates) {
        try {
          const method = created.channel === "terminal:create" ? "closeTerminal" : "closeAgentSession";
          const request = created.channel === "terminal:create" ? { ...created.result, projectContext: created.request.projectContext }
            : { sessionId: created.result.session.id, instanceId: created.result.instanceId, rootPath: created.request.rootPath, projectContext: created.request.projectContext };
          await evaluate(`window.puppyoneDesktop.${method}(${JSON.stringify(request)})`);
        } catch (error) { failure ??= error; }
      }
      if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
      window.destroy();
    }
    restoreProvider(); clearTimeout(deadline);
    try { await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { failure ??= error; }
    const sourceAfter = await readSourceIdentity(repo);
    if (source.fingerprint !== sourceAfter.fingerprint) failure ??= new Error("Source changed during acceptance");
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: !failure, source, sourceAfter, steps, captures,
      compositor: nativeCapture ? "OS composed window capture; DOM contributions, native PDF covered separately" : "not-run: screen permission unavailable",
      input: nativeInput ? "CoreGraphics OS click/wheel" : "Chromium input; native hit testing requires --native", failure: failure?.stack }, null, 2));
    console.log(`Sidebar visibility evidence: ${output}`);
    app.exit(failure ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });

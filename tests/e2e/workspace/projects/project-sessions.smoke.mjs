#!/usr/bin/env electron
// Runs the actual Main, preload and App against disposable projects and app data.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, webContents } from "electron";
import { workspaceFromPath } from "../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

import { verifySidebarBoundaries } from "../../../support/electron/sidebar-boundaries.mjs";

import { verifySidebarLiveResize } from "../../../support/electron/sidebar-live-resize.mjs";

process.env.SHELL = "/bin/sh";
const resizeObservations = [];
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-project-sessions-"));
app.setAppPath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));
const appData = path.join(temp, "app-data");
await fs.mkdir(appData);
app.setPath("appData", appData);
app.setPath("userData", path.join(appData, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.commandLine.appendSwitch("disable-gpu");
const roots = await Promise.all(["Project A", "Project B", "Project C", "Project D"].map(async (name) => {
  const root = path.join(temp, name);
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "note.md"), `# ${name}\n\nProject session smoke.\n`);
  return fs.realpath(root);
}));
const workspaces = await Promise.all(roots.map((root) => workspaceFromPath(root)));
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: (root) => fs.realpath(root), workspaceFromPath });
for (const workspace of [...workspaces].reverse()) await registry.rememberWorkspaceComposition([workspace]);
process.argv.push(roots[0]);
const terminals = [];
const handle = ipcMain.handle.bind(ipcMain);
// Observe the production IPC receipt: PTYs now live in utility processes.
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (channel === "item-display:connect" && result?.pid && !terminals.some((record) => record.pid === result.pid)) {
    const request = await event.sender.executeJavaScript("window.puppyoneItemHost.bootstrap()");
    const record = { pid: result.pid, utilityPid: result.hostPid, rendererPid: event.sender.getOSProcessId(), cwd: request.projectContext.rootPath,
      sender: event.sender, receipt: result, projectContext: request.projectContext };
    Object.defineProperty(record, "exited", { get: () => {
      try { process.kill(record.pid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
    } });
    record.terminal = {
      write: (data) => event.sender.executeJavaScript(
        "window.puppyoneDesktop.writeTerminal(" + JSON.stringify({ ...result, data, projectContext: request.projectContext }) + ")",
        true,
      ).catch((error) => errors.push(error.message)),
      kill: () => { try { process.kill(record.pid, "SIGTERM"); } catch { /* Already closed. */ } },
    };
    terminals.push(record);
  }
  return result;
});
const errors = [];
app.on("window-all-closed", () => {});
app.on("web-contents-created", (_event, contents) => contents.on("console-message", (_event, level, message) => {
  if (level >= 3 && contents.getURL().includes("item-host.html")) errors.push(message);
}));
const guard = setTimeout(() => { console.error("Project session smoke exceeded its time budget."); app.exit(1); }, 180_000);
const localizationDiagnostics = [];
const focusEvents = [];
app.on("browser-window-created", (_event, window) => {
  // Scripted input owns this disposable window; physical cursor movement must
  // not add unrelated moves to the held-button regression.
  window.setIgnoreMouseEvents(true);
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...args) => {
    if (channel === "item-host:event" && args[0]?.type === "focus-changed") focusEvents.push(args[0]);
    return send(channel, ...args);
  };
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
    if (message.startsWith("Localization diagnostic JSON ")) localizationDiagnostics.push(message);
  });
  window.webContents.on("dom-ready", () => {
    void window.webContents.executeJavaScript(`{
      const warn = console.warn.bind(console);
      console.warn = (...args) => args[0] === "Localization diagnostic"
        ? warn("Localization diagnostic JSON " + JSON.stringify(args[1]))
        : warn(...args);
    }`).catch(() => {});
  });
});
await import("../../../../electron/main.mjs");
let window;
app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });
async function run() {
try {
  await until(() => BrowserWindow.getAllWindows().length > 0, "Main window");
  window = BrowserWindow.getAllWindows()[0];
  window.setSize(2000, 1000);
  app.focus({ steal: true });
  await untilRenderer("Boolean(document.querySelector('.app-shell'))", "App mount");
  if (!await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal')?.getAttribute('aria-pressed') === 'true'")) {
    await click(".desktop-titlebar-terminal, .desktop-shell-toolbar-terminal");
  }
  await untilRenderer("Boolean(document.querySelector('[data-agent-mode=chat]'))", "Agent Chat available with fresh preferences");
  assert(window.contentView.children.length === 0, "Default Chat availability allocated native sessions");
  await evaluate(`localStorage.setItem("puppyone.desktop.rightSidebarWidth", "800"); localStorage.setItem("puppyone.desktop.experimental", JSON.stringify({ enableMultiRootWorkspaces: true, enableProjectSwitcherRail: true, enableAgentChat: false, enableAgentCompanion: false })); location.reload();`);
  await untilRenderer("document.querySelectorAll('.desktop-project-switcher-rail-project').length === 4", "Project rail");
  await untilRenderer("Boolean(document.querySelector('.desktop-terminal-panel'))", "project workbench");
  if (!await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal')?.getAttribute('aria-pressed') === 'true'")) {
    await click(".desktop-titlebar-terminal, .desktop-shell-toolbar-terminal");
  }
  await untilRenderer("Boolean(document.querySelector('[data-agent-mode=chat]'))", "Agent Chat ignores retired opt-out preferences");
  await click(".desktop-terminal-launcher-shell");
  await until(() => terminals.length === 1, "A terminal");
  await untilRenderer("document.querySelector('[data-terminal-tab-session-id]')?.dataset.status === 'running'", "A running");
  const a = terminals[0];
  await until(() => nativeView(a.sender)?.getVisible(), "A native presentation");
  assert(new Set([process.pid, window.webContents.getOSProcessId(), a.utilityPid, a.rendererPid, a.pid]).size === 5, "Terminal processes share a failure domain");
  resizeObservations.push(await verifySidebarLiveResize({ window, contents: a.sender, temp, label: "terminal-resize", until }));
  resizeObservations.push(await verifySidebarBoundaries({ window, contents: a.sender, temp, label: "terminal", until }));
  const aTabs = await tabIds();
  const aProject = (await evaluate("window.puppyoneDesktop.readProjectSessions()")).projects.find((entry) => entry.rootPath === roots[0]);
  a.terminal.write("echo PROJECT_A_BEFORE_SWITCH\r");
  await untilTerminal(a, "PROJECT_A_BEFORE_SWITCH", "A output");
  await selectProject("Project B");
  await until(() => nativeView(a.sender)?.getVisible() === false, "hide A native presentation");
  await untilRenderer("document.querySelectorAll('[data-terminal-tab-session-id]').length === 0", "B own empty tabs");
  assert(!a.exited, "Switching to B closed A's terminal");
  a.terminal.write("echo PROJECT_A_WHILE_HIDDEN\r");
  await untilTerminal(a, "PROJECT_A_WHILE_HIDDEN", "background A output");
  await click(".desktop-terminal-launcher-shell");
  await until(() => terminals.length === 2, "B terminal");
  await untilRenderer("document.querySelector('[data-terminal-tab-session-id]')?.dataset.status === 'running'", "B running");
  const b = terminals[1];
  const bTabs = await tabIds();
  await selectProject("Project A");
  await untilRenderer(`JSON.stringify([...document.querySelectorAll('[data-terminal-tab-session-id]')].map(x => x.dataset.terminalTabSessionId)) === ${JSON.stringify(JSON.stringify(aTabs))}`, "restore A tabs");
  assert(terminals.length === 2 && !a.exited && !b.exited, "Switching restarted native resources");
  const restored = (await evaluate("window.puppyoneDesktop.readProjectSessions()")).projects.find((entry) => entry.rootPath === roots[0]);
  assert(restored.generation === aProject.generation, "Presentation changed project generation");
  // xterm's DOM rows prove the retained screen contains output received while hidden.
  await untilTerminal(a, "PROJECT_A_WHILE_HIDDEN", "restored terminal output");
  await until(() => nativeView(a.sender)?.getVisible(), "restore A native presentation");
  await until(() => nativeView(b.sender)?.getVisible() === false, "hide B native presentation");
  await fs.writeFile(path.join(temp, "project-a-restored.png"), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(temp, "terminal-a-restored.png"), (await a.sender.capturePage()).toPNG());
  let agentDraftVerified = false;
  if (process.env.PUPPYONE_SMOKE_CODEX_DRAFT === "1" || process.argv.includes("--agent-draft")) {
    await click(".desktop-terminal-new-button");
    await untilRenderer("[...document.querySelectorAll('.desktop-terminal-launcher-tool')].some(button => button.textContent.trim() === 'Codex')", "Codex launcher");
    await evaluate("[...document.querySelectorAll('.desktop-terminal-launcher-tool')].find(button => button.textContent.trim() === 'Codex').click()");
    await untilAgent("Boolean(document.querySelector('.desktop-agent-prompt-editor .cm-content[contenteditable=true]'))", "Codex draft editor");
    await untilAgent("(() => { const editor=document.querySelector('.desktop-agent-prompt-editor .cm-content[contenteditable=true]'); if (!editor) return false; editor.focus(); return document.activeElement===editor; })()", "focus ready Codex draft editor");
    await (await agentContents()).insertText("UNSENT PROJECT A DRAFT");
    await selectProject("Project B");
    await selectProject("Project A");
    await untilAgent("document.querySelector('.desktop-agent-prompt-editor .cm-content')?.textContent === 'UNSENT PROJECT A DRAFT'", "Codex draft restoration");
    assert(!await (await agentContents()).executeJavaScript("document.body.innerText.includes('Earlier live events are no longer available')"), "False history-loss warning");
    resizeObservations.push(await verifySidebarLiveResize({ window, contents: await agentContents(), temp, label: "agent-resize", until }));
    await untilAgent("document.querySelector('.desktop-agent-prompt-editor .cm-content')?.textContent === 'UNSENT PROJECT A DRAFT'", "draft survives outer resize");
    resizeObservations.push(await verifySidebarBoundaries({ window, contents: await agentContents(), temp, label: "agent", until }));
    agentDraftVerified = true;
    await fs.writeFile(path.join(temp, "agent-draft-restored.png"), (await window.webContents.capturePage()).toPNG());
  }
  if (!agentDraftVerified) {
    const displayCount = window.contentView.children.length;
    for (let index = 0; index < 3; index++) {
      await click(".desktop-terminal-new-button");
      await untilRenderer(`document.querySelectorAll('[data-terminal-tab-session-id]').length === ${index + 2}`, "independent blank tabs");
    }
    const blanks = (await tabIds()).filter((id) => id !== aTabs[0]);
    assert(new Set(blanks).size === 3, "Repeated + reused a blank tab");
    assert(await evaluate("document.querySelectorAll('[role=tab] .lucide-square-dashed').length === 3"), "Blank tab icon is not neutral");
    assert(terminals.length === 2 && window.contentView.children.length === displayCount, "Blank tabs allocated native runtimes or displays");
    await evaluate("Promise.allSettled(document.querySelector('.desktop-terminal-subheader').getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition || animation.id === 'workbench-header-layout').map(animation => animation.finished))");
    await fs.writeFile(path.join(temp, "multiple-blank-tabs.png"), (await window.webContents.capturePage()).toPNG());
    for (const id of blanks.slice(1)) await click(`[data-terminal-tab-session-id="${id}"] .desktop-terminal-tab-close`);
    await untilRenderer("document.querySelectorAll('[data-terminal-tab-session-id]').length === 2", "close only extra blank tabs");
  }
  const movingItem = (await tabIds()).find((id) => id !== aTabs[0]);
  const originalGroup = await evaluate("document.querySelector('[data-terminal-group-pane-id]').dataset.terminalGroupPaneId");
  const nativeIdentity = terminals.map(({ pid }) => pid);
  window.webContents.debugger.attach("1.3");
  try {
    await dragItem(movingItem, originalGroup, "right");
    await untilRenderer("document.querySelectorAll('[data-terminal-group-pane-id]').length === 2", "split mixed workbench");
    await until(() => nativeView(a.sender)?.getVisible(), "native presentation after split");
    window.show(); window.focus();
    await until(() => window.isFocused(), "activate owner window");
    window.webContents.focus();
    await until(() => window.webContents.isFocused(), "focus Shell before native content");
    await click(`[data-terminal-tab-session-id="${movingItem}"] .desktop-terminal-tab-select`);
    await untilRenderer(`document.querySelector('[data-terminal-tab-session-id="${movingItem}"] [role="tab"]')?.getAttribute('aria-selected') === "true"`, "settle tab selection before native focus");
    a.sender.focus();
    await until(() => a.sender.isFocused(), "focus native content");
    a.sender.sendInputEvent({ type: "mouseDown", x: 30, y: 60, button: "left", clickCount: 1 });
    a.sender.sendInputEvent({ type: "mouseUp", x: 30, y: 60, button: "left", clickCount: 1 });
    await untilRenderer(`document.querySelector('[data-terminal-group-pane-id="${originalGroup}"]')?.dataset.focused === "true"`, "native content activates shared Store");
    await until(async () => (await a.sender.executeJavaScript("window.puppyoneItemHost.bootstrap()")).commandTarget === true, "native command target configuration");
    window.webContents.focus();
    a.terminal.write("echo FOCUS_MUST_STAY_IN_SHELL\r");
    await untilTerminal(a, "FOCUS_MUST_STAY_IN_SHELL", "summary update without focus theft");
    assert(window.webContents.isFocused(), "Content summary stole Shell focus");
    assert(await evaluate("!document.querySelector('.desktop-terminal-pane-handle, .desktop-terminal-group-chrome')"), "Group grip or reserved chrome remains");
    await resizeFromNative(a);
    const otherGroup = await evaluate(`[...document.querySelectorAll('[data-terminal-group-pane-id]')].find(group => group.dataset.terminalGroupPaneId !== ${JSON.stringify(originalGroup)}).dataset.terminalGroupPaneId`);
    await dragItem(aTabs[0], otherGroup, "bottom");
    await untilRenderer(`document.querySelector('[data-terminal-split-id]')?.dataset.direction === "vertical"`, "tab drag changes split direction");
    await until(() => nativeView(a.sender)?.getVisible(), "native presentation after tab movement");
    await until(async () => {
      const slot = await evaluate(`(() => {
        const rect = document.querySelector('.desktop-item-host[data-item-id="${aTabs[0]}"]').getBoundingClientRect();
        const paint=document.querySelector('.desktop-right-sidebar [data-pane-edge-chrome]').getBoundingClientRect();
        const left=paint.left<=rect.left && paint.right>rect.left ? paint.right : rect.left;
        const right=paint.left<rect.right && paint.right>=rect.right ? paint.left : rect.right;
        return { x: Math.ceil(left), y: Math.ceil(rect.y), width: Math.floor(right)-Math.ceil(left), height: Math.floor(rect.bottom)-Math.ceil(rect.y) };
      })()`);
      const bounds = nativeView(a.sender).getBounds();
      return Object.keys(bounds).every((key) => Math.abs(bounds[key] - Math.round(slot[key])) <= 1);
    }, "native bounds follow relocated content slot");
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(temp, "sidebar-tab-moved.png"), (await window.webContents.capturePage()).toPNG());
    const retainedGroup = await evaluate(`document.querySelector('[data-terminal-tab-session-id="${aTabs[0]}"]').closest('[data-terminal-group-pane-id]').dataset.terminalGroupPaneId`);
    await dragItem(movingItem, retainedGroup, "bar-end");
    await untilRenderer("document.querySelectorAll('[data-terminal-group-pane-id]').length === 1", "reunite mixed workbench");
    assert(JSON.stringify(terminals.map(({ pid }) => pid)) === JSON.stringify(nativeIdentity) && terminals.every(({ exited }) => !exited), "Layout movement changed native resources");
    if (agentDraftVerified) await untilAgent("document.querySelector('.desktop-agent-prompt-editor .cm-content')?.textContent === 'UNSENT PROJECT A DRAFT'", "draft after drag");
  } finally {
    window.webContents.debugger.detach();
  }
  if (!agentDraftVerified) await click(`[data-terminal-tab-session-id="${movingItem}"] .desktop-terminal-tab-close`);
  else await click(`[data-terminal-tab-session-id="${aTabs[0]}"] .desktop-terminal-tab-select`);
  await until(() => nativeView(a.sender)?.getVisible(), "retained native view after reunion");
  // Open a multi-root Editor composition, then switch away and restore it.
  await evaluate(`window.puppyoneDesktop.attachFolder(${JSON.stringify(roots[1])})`);
  await selectProject("Project C");
  await selectProject("Project A");
  await untilRenderer("document.querySelectorAll('.workspace-folder-root').length === 2", "multi-root Editor");
  const bExplorerRoot = await evaluate("document.querySelector('.workspace-folder-root[aria-label=\"Project B\"]')?.dataset.explorerPath");
  assert(bExplorerRoot, "B root missing from Editor");
  if (!await evaluate("document.querySelector('.workspace-folder-root[aria-label=\"Project B\"]')?.getAttribute('aria-expanded') === 'true'")) await click('.workspace-folder-root[aria-label="Project B"]');
  await untilRenderer(`[...document.querySelectorAll('.tree-row.file')].some(row => row.dataset.explorerPath.startsWith(${JSON.stringify(bExplorerRoot)}) && row.getAttribute('aria-label') === 'note.md')`, "B file");
  await evaluate(`[...document.querySelectorAll('.tree-row.file')].find(row => row.dataset.explorerPath.startsWith(${JSON.stringify(bExplorerRoot)}) && row.getAttribute('aria-label') === 'note.md').click()`);
  await untilRenderer(`JSON.stringify([...document.querySelectorAll('[data-terminal-tab-session-id]')].map(x => x.dataset.terminalTabSessionId)) === ${JSON.stringify(JSON.stringify(bTabs))}`, "Editor focus uses B's tabs");
  assert(terminals.length === 2 && !a.exited && !b.exited, "Editor focus changed native ownership");
  await untilRenderer("document.body.innerText.includes('Project session smoke.')", "B document rendered");
  await fs.writeFile(path.join(temp, "multi-root-editor.png"), (await window.webContents.capturePage()).toPNG());
  // B is already selected through Editor; close its project without touching A.
  assert(JSON.stringify(await tabIds()) === JSON.stringify(bTabs), "B tab state changed");
  await click('.workspace-folder-root[aria-label="Project B"] button[title="Remove Project"]');
  await until(() => b.exited, "explicit B close");
  assert(!a.exited, "Closing B stopped A");
  const remaining = await evaluate("window.puppyoneDesktop.readProjectSessions()");
  assert(remaining.projects.some((entry) => entry.rootPath === roots[0]) && !remaining.projects.some((entry) => entry.rootPath === roots[1]), "project close authority");
  await untilRenderer("Boolean(document.querySelector('.app-shell')) && !document.querySelector('.workspace-folder-root[aria-label=\"Project B\"]') && !document.body.innerText.includes('application render failed')", "Editor after B removal");
  await untilRenderer(`[...document.querySelectorAll('[data-terminal-tab-session-id]')].some(x => x.dataset.terminalTabSessionId === ${JSON.stringify(aTabs[0])})`, "A workbench after B removal");
  assert(errors.length === 0, "Renderer errors after project removal");
  const firstWindow = window;
  await selectProject("Project C");
  await evaluate(`window.puppyoneDesktop.openWorkspaceInNewWindow(${JSON.stringify(roots[3])})`);
  await until(() => BrowserWindow.getAllWindows().length === 2, "second native window");
  const secondWindow = BrowserWindow.getAllWindows().find((candidate) => candidate !== firstWindow);
  window = secondWindow;
  await untilRenderer("Boolean(document.querySelector('.desktop-terminal-launcher-shell'))", "D workbench");
  if (!await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal')?.getAttribute('aria-pressed') === 'true'")) {
    await click(".desktop-titlebar-terminal, .desktop-shell-toolbar-terminal");
  }
  await click(".desktop-terminal-launcher-shell");
  await until(() => terminals.length === 3, "D terminal in second window");
  const d = terminals[2];
  await untilRenderer("document.querySelector('[data-terminal-tab-session-id]')?.dataset.status === 'running'", "D running");
  const otherProjects = await evaluate("window.puppyoneDesktop.readProjectSessions()");
  assert(otherProjects.projects.length === 1 && otherProjects.projects[0].rootPath === roots[3], "Second window acquired another window's Project");
  const focused = await evaluate(`window.puppyoneDesktop.openWorkspaceInCurrentWindow(${JSON.stringify(roots[0])})`);
  assert(focused.status === "focused-existing", "Background A was not routed to its owning window");
  window = firstWindow;
  await untilRenderer("[...document.querySelectorAll('.desktop-project-switcher-rail-project')].some(button => button.title.includes('Project A') && button.getAttribute('aria-current') === 'page')", "foreign request reveals A");
  await untilRenderer(`[...document.querySelectorAll('[data-terminal-tab-session-id]')].some(x => x.dataset.terminalTabSessionId === ${JSON.stringify(aTabs[0])})`, "foreign request restores A tabs");
  assert(!d.exited, "Focusing A stopped D");
  await fs.writeFile(path.join(temp, "separate-window-d.png"), (await secondWindow.webContents.capturePage()).toPNG());
  window.close();
  await until(() => a.exited && window.isDestroyed(), "window close");
  assert(!d.exited && !secondWindow.isDestroyed(), "Closing A's window stopped D");
  window = secondWindow;
  window.close();
  await until(() => d.exited && window.isDestroyed(), "second window close");
  assert(errors.length === 0, "Renderer reported errors");
  const report = { ok: true, temp, roots, resizeObservations, aTabs, bTabs, agentDraftVerified, blankTabsVerified: !agentDraftVerified, nativePresentationRestored: true, nativeFocusActivatesStore: true,
    summaryDoesNotStealFocus: true, groupGripRemoved: true, nativeSashRoutingVerified: true, tabMovementVerified: true,
    splitAndReunionVerified: true, multiRootEditorVerified: true, separateWindowsVerified: true, terminals: terminals.map(({ pid, utilityPid, rendererPid, cwd, exited }) => ({ pid, utilityPid, rendererPid, cwd, exited })), rendererErrors: errors, localizationDiagnostics };
  await fs.writeFile(path.join(temp, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (window && !window.isDestroyed()) {
    await fs.writeFile(path.join(temp, "failure.png"), (await window.webContents.capturePage()).toPNG());
    console.error(await evaluate("document.body.innerText.slice(0, 8000)"));
  }
  console.error(JSON.stringify({ ok: false, temp, error: error.stack, rendererErrors: errors, focusEvents,
    nativeViews: window && !window.isDestroyed() ? window.contentView.children.map((view) => ({ visible: view.getVisible(), bounds: view.getBounds(), id: view.webContents?.id })) : [] }, null, 2));
  process.exitCode = 1;
} finally {
  for (const openWindow of BrowserWindow.getAllWindows()) if (!openWindow.isDestroyed()) openWindow.close();
  await until(() => BrowserWindow.getAllWindows().length === 0, "window cleanup").catch((error) => { console.error(error); process.exitCode = 1; });
  for (const record of terminals) if (!record.exited) record.terminal.kill();
  await until(() => terminals.every((record) => record.exited), "cleanup").catch((error) => { console.error(error); process.exitCode = 1; });
  clearTimeout(guard);
  app.exit(process.exitCode ?? 0);
}
}

function assert(value, message) { if (!value) throw new Error(message); }
function nativeView(contents) { return window.contentView.children.find((view) => view.webContents === contents); }
function evaluate(code) { return window.webContents.executeJavaScript(code, true); }
async function untilTerminal(record, text, label) {
  await until(async () => !record.sender.isDestroyed()
    && await record.sender.executeJavaScript("document.querySelector('.xterm-screen')?.textContent.includes(" + JSON.stringify(text) + ")"), label);
}
async function agentContents() {
  const ids = await tabIds();
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.getURL().includes("item-host.html")) continue;
    const identity = await contents.executeJavaScript("window.puppyoneItemHost.bootstrap()");
    if (identity.kind === "agent" && ids.includes(identity.itemId)) return contents;
  }
  throw new Error("No Agent display in the current project's workbench.");
}
async function untilAgent(code, label) {
  await until(async () => { try { return await (await agentContents()).executeJavaScript(code, true); } catch { return false; } }, label);
}
async function until(check, label, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
function untilRenderer(code, label) { return until(async () => { try { return await evaluate(code); } catch { return false; } }, label); }
async function click(selector) {
  await untilRenderer(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function selectProject(name) {
  await evaluate(`[...document.querySelectorAll('.desktop-project-switcher-rail-project')].find(button => button.title.includes(${JSON.stringify(name)})).click()`);
  await untilRenderer(`[...document.querySelectorAll('.desktop-project-switcher-rail-project')].some(button => button.title.includes(${JSON.stringify(name)}) && button.getAttribute('aria-current') === 'page')`, name);
}
function tabIds() { return evaluate("[...document.querySelectorAll('[data-terminal-tab-session-id]')].map(x => x.dataset.terminalTabSessionId)"); }

async function resizeFromNative(record) {
  const view = nativeView(record.sender);
  const bounds = view.getBounds();
  const before = await evaluate("document.querySelector('[data-terminal-split-id]').style.getPropertyValue('--desktop-terminal-first-track')");
  record.sender.sendInputEvent({ type: "mouseDown", x: bounds.width - 2, y: 60, button: "left", clickCount: 1 });
  await untilRenderer("document.querySelector('.desktop-terminal-splitter')?.dataset.resizing === 'true'", "native-covered sash initial press");
  record.sender.sendInputEvent({ type: "mouseMove", x: bounds.width - 40, y: 60, modifiers: ["leftbuttondown"] });
  await untilRenderer("Number(document.querySelector('.desktop-terminal-splitter')?.getAttribute('aria-valuenow')) < 48", "native sash drag preview");
  record.sender.sendInputEvent({ type: "mouseUp", x: bounds.width - 40, y: 60, button: "left", clickCount: 1 });
  await untilRenderer("!document.querySelector('.desktop-terminal-splitter[data-resizing=true]')", "sash release");
  const after = await evaluate("document.querySelector('[data-terminal-split-id]').style.getPropertyValue('--desktop-terminal-first-track')");
  assert(after !== before, "Native sash press did not commit a resize");
}

async function dragItem(itemId, groupId, destination) {
  const source = `[data-terminal-tab-session-id="${itemId}"] .desktop-terminal-tab-select`;
  const target = destination === "bar-end" ? `[data-terminal-tab-bar-group-id="${groupId}"]` : `[data-terminal-content-drop-group-id="${groupId}"]`;
  const geometry = await evaluate(`(() => {
    const from = document.querySelector(${JSON.stringify(source)}).getBoundingClientRect();
    const to = document.querySelector(${JSON.stringify(target)}).getBoundingClientRect();
    return { from: { x: from.left + from.width / 2, y: from.top + from.height / 2 },
      to: { x: ${destination === "bottom" ? "to.left + to.width / 2" : "to.right - 4"}, y: ${destination === "bottom" ? "to.bottom - 4" : "to.top + to.height / 2"} } };
  })()`);
  const dispatch = (type, point, buttons, extra = {}) => window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type, x: Math.round(point.x), y: Math.round(point.y), buttons, pointerType: "mouse", ...extra,
  });
  await dispatch("mouseMoved", geometry.from, 0);
  await dispatch("mousePressed", geometry.from, 1, { button: "left", clickCount: 1 });
  await dispatch("mouseMoved", { x: (geometry.from.x + geometry.to.x) / 2, y: (geometry.from.y + geometry.to.y) / 2 }, 1);
  await dispatch("mouseMoved", geometry.to, 1);
  await until(() => window.contentView.children.filter((view) => view.webContents?.getURL().includes("item-host.html")).every((view) => !view.getVisible()), "drag preview occludes native content");
  console.log(JSON.stringify({ drag: { itemId, destination, geometry,
    state: await evaluate("({ dragging: document.body.classList.contains('desktop-terminal-session-dragging'), preview: document.querySelector('.desktop-terminal-drop-preview')?.outerHTML, at: document.elementFromPoint(" + Math.round(geometry.to.x) + ", " + Math.round(geometry.to.y) + ")?.className })") } }));
  await dispatch("mouseReleased", geometry.to, 0, { button: "left", clickCount: 1 });
}

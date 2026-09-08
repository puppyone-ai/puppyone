#!/usr/bin/env electron
// Runs the actual Main, preload and App against disposable projects and app data.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import pty from "node-pty";
import { workspaceFromPath } from "../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../shared/desktop-build-identity.mjs";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-project-sessions-"));
app.setAppPath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
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
const spawn = pty.spawn.bind(pty);
pty.spawn = (file, args, options) => {
  const terminal = spawn(file, args, options);
  const record = { pid: terminal.pid, cwd: options.cwd, exited: false, kills: 0, output: "", terminal };
  terminals.push(record);
  terminal.onData((text) => { record.output = (record.output + text).slice(-32_768); });
  terminal.onExit(() => { record.exited = true; });
  const kill = terminal.kill.bind(terminal);
  terminal.kill = (...values) => { record.kills += 1; return kill(...values); };
  return terminal;
};
const errors = [];
const localizationDiagnostics = [];
app.on("browser-window-created", (_event, window) => {
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
await import("../electron/main.mjs");
let window;
app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });
async function run() {
try {
  await until(() => BrowserWindow.getAllWindows().length > 0, "Main window");
  window = BrowserWindow.getAllWindows()[0];
  await untilRenderer("Boolean(document.querySelector('.app-shell'))", "App mount");
  await evaluate(`localStorage.setItem("puppyone.desktop.experimental", JSON.stringify({ enableMultiRootWorkspaces: true, enableProjectSwitcherRail: true, enableAgentChat: true })); location.reload();`);
  await untilRenderer("document.querySelectorAll('.desktop-project-switcher-rail-project').length === 4", "Project rail");
  await untilRenderer("Boolean(document.querySelector('.desktop-terminal-panel'))", "project workbench");
  if (!await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal')?.getAttribute('aria-pressed') === 'true'")) {
    await click(".desktop-titlebar-terminal, .desktop-shell-toolbar-terminal");
  }
  await click(".desktop-terminal-launcher-shell");
  await until(() => terminals.length === 1, "A terminal");
  await untilRenderer("document.querySelector('[data-terminal-tab-session-id]')?.dataset.status === 'running'", "A running");
  const a = terminals[0];
  const aTabs = await tabIds();
  const aProject = (await evaluate("window.puppyoneDesktop.readProjectSessions()")).projects.find((entry) => entry.rootPath === roots[0]);
  a.terminal.write("echo PROJECT_A_BEFORE_SWITCH\r");
  await until(() => a.output.includes("PROJECT_A_BEFORE_SWITCH"), "A output");
  await selectProject("Project B");
  await untilRenderer("document.querySelectorAll('[data-terminal-tab-session-id]').length === 0", "B own empty tabs");
  assert(!a.exited && a.kills === 0, "Switching to B closed A's terminal");
  a.terminal.write("echo PROJECT_A_WHILE_HIDDEN\r");
  await until(() => a.output.includes("PROJECT_A_WHILE_HIDDEN"), "background A output");
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
  await untilRenderer("document.querySelector('.xterm-screen')?.textContent.includes('PROJECT_A_WHILE_HIDDEN')", "restored terminal output");
  await fs.writeFile(path.join(temp, "project-a-restored.png"), (await window.webContents.capturePage()).toPNG());
  let agentDraftVerified = false;
  if (process.env.PUPPYONE_SMOKE_CODEX_DRAFT === "1") {
    await click(".desktop-terminal-new-button");
    await untilRenderer("[...document.querySelectorAll('.desktop-terminal-launcher-tool')].some(button => button.textContent.trim() === 'Codex')", "Codex launcher");
    await evaluate("[...document.querySelectorAll('.desktop-terminal-launcher-tool')].find(button => button.textContent.trim() === 'Codex').click()");
    await untilRenderer("Boolean(document.querySelector('.desktop-agent-prompt-editor .cm-content[contenteditable=true]'))", "Codex draft editor");
    await evaluate("document.querySelector('.desktop-agent-prompt-editor .cm-content').focus()");
    await window.webContents.insertText("UNSENT PROJECT A DRAFT");
    await selectProject("Project B");
    await selectProject("Project A");
    await untilRenderer("document.querySelector('.desktop-agent-prompt-editor .cm-content')?.textContent === 'UNSENT PROJECT A DRAFT'", "Codex draft restoration");
    assert(!await evaluate("document.body.innerText.includes('Earlier live events are no longer available')"), "False history-loss warning");
    agentDraftVerified = true;
    await fs.writeFile(path.join(temp, "agent-draft-restored.png"), (await window.webContents.capturePage()).toPNG());
  }
  if (!agentDraftVerified) await click(".desktop-terminal-new-button");
  const movingItem = (await tabIds()).find((id) => id !== aTabs[0]);
  const originalGroup = await evaluate("document.querySelector('[data-terminal-group-pane-id]').dataset.terminalGroupPaneId");
  const nativeIdentity = terminals.map(({ pid }) => pid);
  window.webContents.debugger.attach("1.3");
  try {
    await dragItem(movingItem, originalGroup, "right");
    await untilRenderer("document.querySelectorAll('[data-terminal-group-pane-id]').length === 2", "split mixed workbench");
    await dragItem(movingItem, originalGroup, "bar-end");
    await untilRenderer("document.querySelectorAll('[data-terminal-group-pane-id]').length === 1", "reunite mixed workbench");
    assert(JSON.stringify(terminals.map(({ pid }) => pid)) === JSON.stringify(nativeIdentity) && terminals.every(({ exited, kills }) => !exited && kills === 0), "Layout movement changed native resources");
    if (agentDraftVerified) await untilRenderer("document.querySelector('.desktop-agent-prompt-editor .cm-content')?.textContent === 'UNSENT PROJECT A DRAFT'", "draft after drag");
  } finally {
    window.webContents.debugger.detach();
  }
  if (!agentDraftVerified) await click(`[data-terminal-tab-session-id="${movingItem}"] .desktop-terminal-tab-close`);
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
  assert(!d.exited && d.kills === 0, "Focusing A stopped D");
  await fs.writeFile(path.join(temp, "separate-window-d.png"), (await secondWindow.webContents.capturePage()).toPNG());
  window.close();
  await until(() => a.exited && window.isDestroyed(), "window close");
  assert(!d.exited && !secondWindow.isDestroyed(), "Closing A's window stopped D");
  window = secondWindow;
  window.close();
  await until(() => d.exited && window.isDestroyed(), "second window close");
  assert(errors.length === 0, "Renderer reported errors");
  const report = { ok: true, temp, roots, aTabs, bTabs, agentDraftVerified, splitAndReunionVerified: true, multiRootEditorVerified: true, separateWindowsVerified: true, terminals: terminals.map(({ terminal: _terminal, ...entry }) => entry), rendererErrors: errors, localizationDiagnostics };
  await fs.writeFile(path.join(temp, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (window && !window.isDestroyed()) {
    await fs.writeFile(path.join(temp, "failure.png"), (await window.webContents.capturePage()).toPNG());
    console.error(await evaluate("document.body.innerText.slice(0, 8000)"));
  }
  console.error(JSON.stringify({ ok: false, temp, error: error.stack, rendererErrors: errors }, null, 2));
  process.exitCode = 1;
} finally {
  for (const openWindow of BrowserWindow.getAllWindows()) if (!openWindow.isDestroyed()) openWindow.close();
  await until(() => BrowserWindow.getAllWindows().length === 0, "window cleanup").catch(() => {});
  for (const record of terminals) if (!record.exited) record.terminal.kill();
  await until(() => terminals.every((record) => record.exited), "cleanup").catch(() => {});
  app.exit(process.exitCode ?? 0);
}
}

function assert(value, message) { if (!value) throw new Error(message); }
function evaluate(code) { return window.webContents.executeJavaScript(code, true); }
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

async function dragItem(itemId, groupId, destination) {
  const source = `[data-terminal-tab-session-id="${itemId}"] .desktop-terminal-tab-select`;
  const target = destination === "bar-end" ? `[data-terminal-tab-bar-group-id="${groupId}"]` : `[data-terminal-content-drop-group-id="${groupId}"]`;
  const geometry = await evaluate(`(() => {
    const from = document.querySelector(${JSON.stringify(source)}).getBoundingClientRect();
    const to = document.querySelector(${JSON.stringify(target)}).getBoundingClientRect();
    return { from: { x: from.left + from.width / 2, y: from.top + from.height / 2 },
      to: { x: to.right - 4, y: to.top + to.height / 2 } };
  })()`);
  const dispatch = (type, point, buttons, extra = {}) => window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type, x: Math.round(point.x), y: Math.round(point.y), buttons, pointerType: "mouse", ...extra,
  });
  await dispatch("mouseMoved", geometry.from, 0);
  await dispatch("mousePressed", geometry.from, 1, { button: "left", clickCount: 1 });
  await dispatch("mouseMoved", { x: (geometry.from.x + geometry.to.x) / 2, y: (geometry.from.y + geometry.to.y) / 2 }, 1);
  await dispatch("mouseMoved", geometry.to, 1);
  console.log(JSON.stringify({ drag: { itemId, destination, geometry,
    state: await evaluate("({ dragging: document.body.classList.contains('desktop-terminal-session-dragging'), preview: document.querySelector('.desktop-terminal-drop-preview')?.outerHTML, at: document.elementFromPoint(" + Math.round(geometry.to.x) + ", " + Math.round(geometry.to.y) + ")?.className })") } }));
  await dispatch("mouseReleased", geometry.to, 0, { button: "left", clickCount: 1 });
}

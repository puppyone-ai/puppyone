#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { workspaceFromPath } from "../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-project-sidebar-"));
const reportDirectory = path.join(repoRoot, "artifacts/tests/project-sidebar", new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(reportDirectory, { recursive: true });
app.setAppPath(repoRoot);
app.setPath("appData", temporaryRoot);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.on("window-all-closed", () => {});
const report = { ok: false, navigationCount: 0, cases: [], error: null };
let window;
let server;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (source) => window.webContents.executeJavaScript(source, true);
const guard = setTimeout(() => { console.error("Project sidebar check timed out"); app.exit(1); }, 150_000);

// Keep the actual navigation IPC, but hold it briefly so every pending frame
// is observable even on a fast local disk. No workspace result is mocked.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  if (channel === "workspace:open-current") await wait(350);
  return listener(event, ...args);
});

async function until(expression, description = expression) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function initialize() {
  const workspaces = [];
  for (const name of ["Project A", "Project B", "Project C"]) {
    const root = path.join(temporaryRoot, name);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "note.md"), `# ${name}\n\nSidebar stability.\n`);
    workspaces.push(await workspaceFromPath(root));
  }
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: (root) => fs.realpath(root), workspaceFromPath });
  for (const workspace of [...workspaces].reverse()) await registry.rememberWorkspaceComposition([workspace]);
  process.argv.push(workspaces[0].path);
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5379, strictPort: false, hmr: false, watch: null, fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules"))] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  app.on("browser-window-created", (_event, owner) => {
    owner.webContents.setBackgroundThrottling(false);
  });
  await import("../../../../electron/main.mjs");
}

async function run() {
  await app.whenReady();
  for (let attempt = 0; attempt < 300 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "production Main created a window");
  window.setContentSize(1200, 800);
  await until("!!document.querySelector('.app-shell')", "App mount");
  for (const expanded of [true, false]) await verifySwitches(expanded);
  report.ok = true;
}

async function verifySwitches(expanded) {
  const mode = expanded ? "expanded" : "compact";
  // A deliberate bootstrap reload installs each presentation's preferences. All
  // reload/navigation counting starts afterwards, before any project switch.
  await evaluate(`localStorage.setItem('puppyone.desktop.experimental', JSON.stringify({ enableProjectSwitcherRail: true })); localStorage.setItem('puppyone.desktop.projectSwitcherExpanded', '${expanded}'); location.reload();`);
  await until("document.querySelectorAll('.desktop-project-switcher-rail-project').length === 3", "Project rail");
  await until(`document.querySelector('.desktop-project-switcher-rail')?.dataset.expanded === '${expanded}'`, `${mode} rail`);
  const recordNavigation = () => { report.navigationCount += 1; };
  window.webContents.on("did-navigate", recordNavigation);
  await evaluate(`window.sidebarDocumentIdentity = crypto.randomUUID();`);
  const documentIdentity = await evaluate("window.sidebarDocumentIdentity");

  for (const name of ["Project B", "Project C", "Project A"]) {
    await evaluate(`(() => {
      const rail = document.querySelector('.desktop-project-switcher-rail');
      const selectors = ['.desktop-project-switcher-rail', '.desktop-project-switcher-rail-create', '.desktop-titlebar-brand-icon'];
      const stable = selectors.map(selector => document.querySelector(selector));
      const rows = [...rail.querySelectorAll('.desktop-project-switcher-rail-project')];
      const target = rows.find(row => row.getAttribute('aria-label').includes(${JSON.stringify(name)}));
      const avatar = target.querySelector('.desktop-project-switcher-rail-avatar');
      const create = stable[1];
      const state = { frames: [], stable: true, recording: true, baselineOpacity: getComputedStyle(create).opacity, paths: rows.map(row => row.getAttribute('aria-label')) };
      window.sidebarObservation = state;
      const sample = () => {
        state.stable &&= selectors.every((selector, index) => document.querySelector(selector) === stable[index] && stable[index].isConnected);
        state.stable &&= rows.every(row => row.isConnected);
        const rect = rail.getBoundingClientRect();
        state.frames.push({ pending: target.getAttribute('aria-busy') === 'true', opacity: getComputedStyle(create).opacity, disabled: create.disabled, avatarOpacity: getComputedStyle(avatar).opacity, animation: getComputedStyle(avatar).animationName, width: rect.width, x: rect.x });
        if (state.recording) requestAnimationFrame(sample);
      };
      sample(); target.click();
    })()`);
    await until("window.sidebarObservation.frames.some(frame => frame.pending)", "pending navigation frame");
    await fs.writeFile(path.join(reportDirectory, `${mode}-${name.replaceAll(" ", "-")}-pending.png`), (await window.webContents.capturePage()).toPNG());
    await until(`[...document.querySelectorAll('.desktop-project-switcher-rail-project')].some(row => row.getAttribute('aria-label').includes(${JSON.stringify(name)}) && row.getAttribute('aria-current') === 'page') && !document.querySelector('.desktop-project-switcher-rail [aria-busy=true]')`, "navigation committed");
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const observation = await evaluate(`window.sidebarObservation.recording = false; window.sidebarObservation`);
    report.cases.push({ name, mode, ...observation });
  }
  window.webContents.removeListener("did-navigate", recordNavigation);
  assert.equal(await evaluate("window.sidebarDocumentIdentity"), documentIdentity, "project switching replaced the renderer document");
  assert.equal(report.navigationCount, 0, "project switching navigated/reloaded the renderer");
  for (const sample of report.cases) {
    assert.ok(sample.stable, `${sample.name}: shell controls remounted`);
    assert.ok(sample.frames.some((frame) => frame.pending), `${sample.name}: pending frames missing`);
    assert.ok(sample.frames.every((frame) => frame.opacity === sample.baselineOpacity && !frame.disabled), `${sample.name}: New Project flashed/disabled`);
    assert.ok(sample.frames.every((frame) => frame.animation === "none" && frame.avatarOpacity === "1"), `${sample.name}: project icon pulsed`);
    assert.ok(sample.frames.every((frame) => frame.x === sample.frames[0].x && frame.width === sample.frames[0].width), `${sample.name}: sidebar geometry changed`);
  }
}

// Main must register privileged protocols before ready; then release the entry
// module before waiting for ready, so Electron can finish startup.
let bootstrapError;
try { await initialize(); } catch (error) { bootstrapError = error; }
void (bootstrapError ? Promise.reject(bootstrapError) : run()).catch((error) => {
  report.error = error instanceof Error ? error.stack : String(error);
  console.error(report.error);
}).finally(async () => {
  clearTimeout(guard);
  await fs.writeFile(path.join(reportDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Project sidebar report: ${reportDirectory}/report.json`);
  window?.destroy();
  await server?.close();
  app.exit(report.ok ? 0 : 1);
});

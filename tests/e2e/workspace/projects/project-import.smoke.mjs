#!/usr/bin/env electron
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { renameSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain } from "electron";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-import-desktop-")));
const home = path.join(fixtureRoot, "home");
const documents = path.join(home, "Documents");
const projectPath = path.join(documents, "PuppyOne", "import-fixture");
const parkedPath = path.join(fixtureRoot, "unavailable-project");
const vault = path.join(home, "Notes");
const obsidianRecord = path.join(home, "Library", "Application Support", "obsidian", "obsidian.json");
const source = path.join(fixtureRoot, "source");
const gitConfig = path.join(fixtureRoot, "gitconfig");
const repositoryUrl = "https://github.com/puppyone-test/import-fixture.git";
const run = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
let server;
let parked = false;
let publications = 0;
const requests = [];
const screenshots = path.join(repoRoot, "artifacts/tests/project-import-desktop");

await fs.mkdir(documents, { recursive: true });
await fs.mkdir(vault);
await fs.writeFile(path.join(vault, "note.md"), "original vault note");
await fs.mkdir(path.dirname(obsidianRecord), { recursive: true });
await fs.writeFile(obsidianRecord, JSON.stringify({ vaults: { notes: { path: vault, ts: 1 } } }));
await fs.writeFile(gitConfig, "");
// Real Git clones a local fixture. Only this child process's config rewrites
// the GitHub URL; no network, user Git configuration, or service mocks are used.
process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
await fs.mkdir(source);
await run("git", ["init", "-q"], { cwd: source });
await fs.writeFile(path.join(source, "README.md"), "# Import fixture\n");
await run("git", ["add", "README.md"], { cwd: source });
await run("git", ["-c", "user.name=Import test", "-c", "user.email=import@example.test", "commit", "-qm", "fixture"], { cwd: source });
await fs.writeFile(gitConfig, `[url "${pathToFileURL(source).href}"]\n\tinsteadOf = ${repositoryUrl}\n`);

app.setAppPath(repoRoot);
app.setPath("home", home);
app.setPath("documents", documents);
app.setPath("appData", fixtureRoot);
app.setPath("userData", path.join(fixtureRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.on("window-all-closed", () => {});
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
  if (channel === "workspace:import-source-current") requests.push(args[0]);
  return listener(event, ...args);
});
app.on("browser-window-created", (_event, owner) => {
  owner.webContents.setBackgroundThrottling(false);
  const send = owner.webContents.send.bind(owner.webContents);
  owner.webContents.send = (channel, progress, ...args) => {
    if (channel === "workspace:import-source-progress" && progress.phase === "complete") {
      publications += 1;
      if (!parked) {
        // A disk/folder becomes unavailable after publication but before open.
        renameSync(projectPath, parkedPath);
        parked = true;
      }
    }
    return send(channel, progress, ...args);
  };
});
let stage = "renderer startup";
const guard = setTimeout(() => { console.error(`Desktop import smoke timed out: ${stage}`); app.exit(1); }, 110_000);
const evaluate = (script) => window.webContents.executeJavaScript(script, true);
async function until(expression) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) throw new Error('Missing or disabled control');
    const bounds = element.getBoundingClientRect();
    return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
}

async function initializeDesktop() {
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(fixtureRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5397, strictPort: false, hmr: false, watch: null,
      fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules")), fixtureRoot] } },
  });
  await server.listen();
  stage = "production Main startup";
  console.log(`Desktop import: ${stage}`);
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  await import("../../../../electron/main.mjs");
  app.commandLine.appendSwitch("remote-debugging-port", "0");
  stage = "Electron ready";
  console.log(`Desktop import: ${stage}`);
}

async function checkDesktopImport() {
  try {
    await app.whenReady();
    for (let attempt = 0; attempt < 300 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
    window = BrowserWindow.getAllWindows()[0];
    assert.ok(window, "production Main created an Electron window");
    stage = "Homepage ready";
    console.log(`Desktop import: ${stage}`);
    window.setContentSize(900, 680);
    await until("!!document.querySelector('[data-onboarding-action=import]') && !document.querySelector('[data-onboarding-empty-state-intro]')");
    stage = "repository import";
    console.log(`Desktop import: ${stage}`);
    await click("[data-onboarding-action=import]");
    await until("!!document.querySelector('button[data-import-source=github]')");
    await click("button[data-import-source=github]");
    await until("!!document.querySelector('input:not(:disabled)')");
    await click("input");
    await window.webContents.insertText(repositoryUrl);
    await until("!!document.querySelector('button[type=submit]:not(:disabled)')");
    await click("button[type=submit]");
    await until("document.querySelector('[role=alert]')?.textContent.includes('imported')");
    stage = "reopening published project";
    console.log(`Desktop import: ${stage}`);
    assert.equal(publications, 1);
    assert.equal(await evaluate("document.querySelector('input').disabled"), true);
    assert.equal(await evaluate("document.querySelector('[role=alert]').textContent.includes('ENOENT')"), false);
    assert.equal(await evaluate("document.querySelector('button[type=submit]').textContent"), "Open imported project");
    // DOM assertions can settle before Chromium paints the updated dialog.
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await fs.mkdir(screenshots, { recursive: true });
    await fs.writeFile(path.join(screenshots, "retry-open.png"), (await window.capturePage()).toPNG());
    await fs.rename(parkedPath, projectPath);
    await fs.writeFile(path.join(projectPath, "README.md"), "edited after import\n");
    await click("button[type=submit]");
    await until("!document.querySelector('.onboarding-entry-dialog') && !document.querySelector('.onboarding-homepage-shell')");
    assert.equal(publications, 1, "retry must not clone or publish again");
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], requests[0], "retry keeps the original task and location grant");
    assert.equal(await fs.readFile(path.join(projectPath, "README.md"), "utf8"), "edited after import\n");
    assert.ok((await fs.stat(path.join(projectPath, ".git"))).isDirectory());
    const before = await evaluate("window.puppyoneDesktop.getLastWorkspace()");
    stage = "recorded app folders";
    console.log(`Desktop import: ${stage}`);
    assert.equal(before.path, projectPath);
    const folders = await evaluate("window.puppyoneDesktop.listAppFolders('obsidian')");
    assert.equal(folders.folders[0].path, vault);
    const denied = await evaluate(`window.puppyoneDesktop.addAppFolders({ app: 'obsidian', paths: [${JSON.stringify(source)}] }).then(() => false, () => true)`);
    assert.equal(denied, true, "Main rejects paths not recorded by the selected app");
    await evaluate(`window.puppyoneDesktop.addAppFolders({ app: 'obsidian', paths: [${JSON.stringify(vault)}] })`);
    const after = await evaluate("window.puppyoneDesktop.getLastWorkspace()");
    assert.equal(after.path, before.path, "adding a folder must not switch the active project");
    const recent = await evaluate("window.puppyoneDesktop.getRecentWorkspaces()");
    assert.ok(recent.workspaces.some((folder) => folder.path === vault));
    assert.equal(await fs.readFile(path.join(vault, "note.md"), "utf8"), "original vault note");
    assert.deepEqual(await fs.readdir(path.dirname(projectPath)), ["import-fixture"], "app folders are not copied into the projects directory");
    await fs.writeFile(obsidianRecord, "corrupt JSON");
    assert.equal(await evaluate("window.puppyoneDesktop.listAppFolders('obsidian').then(() => false, () => true)"), true,
      "a failed app read crosses IPC as an error, not an empty list");
    console.log("Desktop import smoke passed: real Electron Main/preload/UI, Git publication and retry, in-place folders and authorization.");
    console.log(`Screenshots: ${screenshots}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(error);
    if (window && !window.isDestroyed()) console.error(await evaluate("document.body.innerText"));
  } finally {
    clearTimeout(guard);
    window?.destroy();
    await server?.close();
    await fs.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      .catch((error) => console.warn(`Temporary profile cleanup: ${error.message}`));
    app.exit(process.exitCode ?? 0);
  }

}
// Register production protocols before ready, then let the entry module finish
// before the acceptance flow awaits app.ready.
try {
  await initializeDesktop();
  void checkDesktopImport();
} catch (error) {
  clearTimeout(guard);
  console.error(error);
  await server?.close();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  app.exit(1);
}

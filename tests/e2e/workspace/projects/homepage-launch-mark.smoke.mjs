#!/usr/bin/env electron
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-homepage-launch-"));
app.setAppPath(repoRoot);
app.setPath("appData", temporaryRoot);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.on("window-all-closed", () => {});
let window;
let server;
const run = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (source) => window.webContents.executeJavaScript(source, true);
const guard = setTimeout(() => { console.error("Homepage launch mark check timed out"); app.exit(1); }, 110_000);

// Long enough for the mark to be revealed and measured. Everything else is real.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  if (channel === "workspace:hydrate-recent") await wait(1200);
  return listener(event, ...args);
});

const markShown = `(() => {
  const mark = document.querySelector('.onboarding-restoring-mark');
  return Boolean(mark) && getComputedStyle(mark).opacity !== '0';
})()`;
const markOffset = `(() => {
  const mark = document.querySelector('.onboarding-restoring-mark').getBoundingClientRect();
  return { x: mark.x + mark.width / 2 - innerWidth / 2, y: mark.y + mark.height / 2 - innerHeight / 2 };
})()`;

async function until(expression, description = expression) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await evaluate(expression).catch(() => false)) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function assertCentred(moment) {
  await until(markShown, `the mark ${moment}`);
  const offset = await evaluate(markOffset);
  console.log(`Mark ${moment}:`, JSON.stringify(offset));
  assert.ok(Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1, `the mark was off the window's centre ${moment}`);
  assert.equal(await evaluate("!!document.querySelector('.desktop-project-preparation')"), false, `a project's window showed ${moment}`);
}

async function initialize() {
  const root = path.join(temporaryRoot, "Project A");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "note.md"), "# Project A\n");
  await run("git", ["init", "-q"], { cwd: root });
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: async (value) => value });
  await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
  // Known, but not the project this launch returns to.
  const statePath = path.join(app.getPath("userData"), "desktop-workspace-state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  await fs.writeFile(statePath, JSON.stringify({ ...state, lastActiveWorkspacePaths: [] }));
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5392, strictPort: false, hmr: false, watch: null, fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules")), temporaryRoot] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  app.on("browser-window-created", (_event, owner) => owner.webContents.setBackgroundThrottling(false));
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  await import("../../../../electron/main.mjs");
}

async function main() {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  for (let attempt = 0; attempt < 300 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "production Main created a window");
  window.setContentSize(1200, 800);

  await assertCentred("launching to the Homepage");
  await until("!!document.querySelector('.onboarding-project-row-wrap button[aria-label*=\"Project A\"]')", "the Homepage");

  // A window keeps what it launched with, so leaving a project must not leave it expecting one.
  await evaluate("document.querySelector('.onboarding-project-row-wrap button[aria-label*=\"Project A\"]').click()");
  await until("!!document.querySelector('.cm-content')", "Project A");
  await evaluate("document.querySelector('.desktop-titlebar-place-wrap > button').click()");
  await until("!!document.querySelector('[data-window-place=\"home\"]')", "Home in the menu");
  await evaluate("document.querySelector('[data-window-place=\"home\"]').click()");
  await until("!!document.querySelector('.onboarding-project-row-wrap')", "the Homepage again");
  window.webContents.reload();
  await assertCentred("reloading on the Homepage");
  console.log("Homepage launch mark smoke passed.");
}

await initialize();
main().then(async () => {
  clearTimeout(guard);
  await server.close();
  app.exit(0);
}).catch(async (error) => {
  console.error(error.message);
  await server?.close();
  app.exit(1);
});

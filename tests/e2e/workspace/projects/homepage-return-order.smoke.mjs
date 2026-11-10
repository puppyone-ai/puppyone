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
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-homepage-return-"));
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
const guard = setTimeout(() => { console.error("Homepage return check timed out"); app.exit(1); }, 110_000);
const roots = {};

// Dates cost git calls, about this long for a dozen real projects. Everything else is real.
let hydrating = 0;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  if (channel !== "workspace:hydrate-recent") return listener(event, ...args);
  hydrating += 1;
  try {
    await wait(450);
    return await listener(event, ...args);
  } finally {
    hydrating -= 1;
  }
});

/** Every order the Homepage ever puts on screen, and when each part of it arrived, sampled once a frame. */
const observer = `(() => {
  const state = { orders: [], recording: true };
  window.homepageOrders = state;
  const sample = () => {
    if (!state.recording) return;
    const now = performance.now();
    const order = [...document.querySelectorAll('.onboarding-project-row-wrap')]
      .filter((row) => row.getBoundingClientRect().width > 0)
      .map((row) => row.querySelector('.onboarding-project-tile-name, .desktop-menu-item-label')?.textContent).join(' | ');
    if (order && state.orders.at(-1) !== order) state.orders.push(order);
    const mark = document.querySelector('.onboarding-project-list-loading');
    if (document.querySelector('.onboarding-homepage-shell')) state.homeAt ??= now;
    if (mark && getComputedStyle(mark).opacity !== '0') state.markAt ??= now;
    if (order) state.listAt ??= now;
    requestAnimationFrame(sample);
  };
  sample();
})()`;

async function until(expression, description = expression) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function repository(name, date) {
  const root = path.join(temporaryRoot, name);
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "note.md"), `# ${name}\n`);
  const git = (...args) => run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  await git("init", "-q");
  await git("add", ".");
  await git("commit", "-q", "-m", "fixture");
  roots[name] = root;
  return workspaceFromPath(root);
}

async function initialize() {
  const workspaces = [
    await repository("Project A", "2026-09-04T00:00:00Z"), await repository("Project B", "2026-09-03T00:00:00Z"),
    await repository("Project C", "2026-09-02T00:00:00Z"), await repository("Project D", "2026-09-01T00:00:00Z"),
  ];
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: async (value) => value });
  // Most recently opened last here, so the undated list is exactly backwards.
  for (const workspace of workspaces) await registry.rememberWorkspaceComposition([workspace]);
  process.argv.push(workspaces[3].path);
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5382, strictPort: false, hmr: false, watch: null, fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules")), temporaryRoot] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  app.on("browser-window-created", (_event, owner) => owner.webContents.setBackgroundThrottling(false));
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  await import("../../../../electron/main.mjs");
}

/** Works in a project, goes Home, and reports everything shown on the way. */
async function returnHomeFrom(name) {
  // Until the launch's own dates are in, Home is still the launch's first paint.
  while (hydrating > 0) await wait(50);
  await fs.appendFile(path.join(roots[name], "note.md"), "\nJust edited.\n");
  await evaluate(observer);
  await evaluate("document.querySelector('.desktop-titlebar-place-wrap > button').click()");
  await until("!!document.querySelector('[data-window-place=\"home\"]')", "Home in the menu");
  await evaluate("window.homepageOrders.clickedAt = performance.now(); document.querySelector('[data-window-place=\"home\"]').click()");
  await until("document.querySelectorAll('.onboarding-project-row-wrap').length === 4", "the Homepage");
  await wait(1800);
  return evaluate("(() => { window.homepageOrders.recording = false; return window.homepageOrders; })()");
}

/** Home arrives first with the mark in the list's place, then the list, once, in its final order. */
function assertReturn(name, visit, order) {
  const since = (moment) => Math.round(moment - visit.clickedAt);
  console.log(`Leaving ${name} showed:`, JSON.stringify(visit.orders),
    `Home ${since(visit.homeAt)}ms, mark ${visit.markAt ? `${since(visit.markAt)}ms` : "never"}, list ${since(visit.listAt)}ms`);
  assert.deepEqual(visit.orders, [order], "the Homepage showed anything but its final order");
  assert.ok(visit.listAt - visit.homeAt >= 200, "the click on Home waited for the dates instead of arriving first");
  assert.ok(visit.markAt < visit.listAt, "the list's wait showed no loading mark");
}

async function main() {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  for (let attempt = 0; attempt < 300 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "production Main created a window");
  window.setContentSize(1200, 800);

  await until("!!document.querySelector('.cm-content')", "the restored project");
  assertReturn("Project D", await returnHomeFrom("Project D"), "Project D | Project A | Project B | Project C");

  await evaluate("document.querySelector('.onboarding-project-row-wrap[data-project-location=local] button[aria-label*=\"Project B\"]').click()");
  await until("!!document.querySelector('.cm-content')", "Project B");
  assertReturn("Project B", await returnHomeFrom("Project B"), "Project B | Project D | Project A | Project C");
  console.log("Homepage return smoke passed.");
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

#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-project-opening-"));
const reportDirectory = path.join(repoRoot, "artifacts/tests/project-opening", new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(reportDirectory, { recursive: true });
app.setAppPath(repoRoot);
app.setPath("appData", temporaryRoot);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.on("window-all-closed", () => {});
const report = { ok: false, restore: null, opening: null, menu: null, failure: null, error: null };
let window;
let server;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (source) => window.webContents.executeJavaScript(source, true);
const guard = setTimeout(() => { console.error("Project opening check timed out"); app.exit(1); }, 120_000);

// Keep the actual IPC, but hold each wait long enough to be seen on a fast disk.
// Every stage of an open is observed; no workspace or file result is mocked.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  if (channel === "workspace:open-current" || channel === "workspace:read-file") await wait(350);
  if (channel === "workspace:open-current" && String(args[0]).endsWith("Project C")) throw new Error("Fixture folder is unavailable");
  // Well past the restoring mark's delay, so a slow start is the one observed even on a busy machine.
  if (channel === "window:get-initial-workspace") await wait(1500);
  return listener(event, ...args);
});

/** One sample a frame of every visible area mark, and of what surrounds it. */
const observer = `(() => {
  const state = { frames: [], recording: true };
  window.projectOpeningObservation = state;
  const shown = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const sample = () => {
    const pane = document.querySelector('.desktop-editor-pane');
    const marks = [...document.querySelectorAll('.po-loading-mark[data-loading-layout="area"]')]
      .filter((mark) => shown(mark) && Number(getComputedStyle(mark).opacity) > 0)
      .map((mark) => {
        const rect = mark.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width };
      });
    state.frames.push({
      time: performance.now(), marks,
      stage: shown(document.querySelector('.desktop-project-preparation')) ? 'preparation'
        : pane?.dataset.contentState === 'opening' ? 'entering'
        : shown(document.querySelector('.cm-content')) ? 'document'
        : pane?.dataset.contentState === 'document' ? 'loading-document'
        : shown(document.querySelector('.onboarding-homepage')) ? 'homepage' : 'other',
      prompt: Boolean(pane && pane.dataset.contentState === 'empty'),
      region: (() => {
        const region = document.querySelector('.desktop-project-preparation .desktop-project-opening')?.getBoundingClientRect();
        return region ? { x: region.x + region.width / 2, y: region.y + region.height / 2 } : null;
      })(),
      explorer: shown(document.querySelector('.desktop-project-preparation .data-explorer-pane')),
      title: document.querySelector('.desktop-titlebar-workspace-name')?.textContent ?? null,
      shownDocument: [...document.querySelectorAll('.cm-content')].find((content) => shown(content)
        && getComputedStyle(content).visibility === 'visible')?.textContent.slice(0, 24) ?? null,
      // The project being left, which must be retained but out of reach during the wait.
      left: (() => {
        const surface = document.querySelector('.desktop-workspace-location-surface');
        return surface ? getComputedStyle(surface).visibility : null;
      })(),
    });
    if (state.recording) requestAnimationFrame(sample);
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

function summarize(frames) {
  const stages = [];
  for (const { stage } of frames) if (stages.at(-1) !== stage) stages.push(stage);
  const centers = [...new Set(frames.flatMap(({ marks }) => marks.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)))];
  const sizes = [...new Set(frames.flatMap(({ marks }) => marks.map(({ width }) => width)))];
  return {
    frames: frames.length, stages, centers, sizes,
    durationMs: Math.round((frames.at(-1)?.time ?? 0) - (frames[0]?.time ?? 0)),
    multipleMarks: frames.filter(({ marks }) => marks.length > 1).length,
    promptFrames: frames.filter(({ prompt }) => prompt).length,
  };
}

const stop = async () => {
  const frames = await evaluate(`(() => {
    window.projectOpeningObservation.recording = false;
    return window.projectOpeningObservation.frames;
  })()`);
  return frames;
};

function assertOneMark(path, summary) {
  assert.equal(summary.promptFrames, 0, `the empty editor prompt showed during the ${path}`);
  assert.equal(summary.multipleMarks, 0, `two marks showed at once during the ${path}`);
  assert.equal(summary.sizes.length, 1, `the mark changed size during the ${path}: ${summary.sizes.join(" -> ")}`);
  assert.equal(summary.centers.length, 1, `the mark moved during the ${path}: ${summary.centers.join(" -> ")}`);
}

async function chooseFromMenu(name) {
  await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
  await until(`[...document.querySelectorAll('.desktop-project-menu [role=menuitem]')].some(item => item.textContent.includes(${JSON.stringify(name)}))`, `${name} in the project menu`);
  await evaluate(observer);
  await evaluate(`[...document.querySelectorAll('.desktop-project-menu [role=menuitem]')].find(item => item.textContent.includes(${JSON.stringify(name)})).click()`);
}

async function initialize() {
  const workspaces = [];
  for (const name of ["Project A", "Project B", "Project C"]) {
    const root = path.join(temporaryRoot, name);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "note.md"), `# ${name}\n\nOpening mark.\n`);
    workspaces.push(await workspaceFromPath(root));
  }
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: async (value) => value });
  for (const workspace of [...workspaces].reverse()) await registry.rememberWorkspaceComposition([workspace]);
  process.argv.push(workspaces[0].path);
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5381, strictPort: false, hmr: false, watch: null, fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules"))] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  app.on("browser-window-created", (_event, owner) => {
    owner.webContents.setBackgroundThrottling(false);
    owner.webContents.once("dom-ready", () => void owner.webContents.executeJavaScript(observer, true));
  });
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  await import("../../../../electron/main.mjs");
}

async function run() {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  for (let attempt = 0; attempt < 300 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "production Main created a window");
  window.setContentSize(1200, 800);

  // A slowly restored project waits in its own window, in the middle of the editor's place.
  await until("!!document.querySelector('.cm-content')", "restored document");
  const restored = await stop();
  report.restore = summarize(restored);
  const restoreWait = restored.filter(({ stage, marks }) => stage === "preparation" && marks.length);
  assert.ok(restoreWait.length, "the slow start showed no mark in the project's window");
  assert.ok(restoreWait.every(({ explorer }) => explorer), "the slow start's mark had no Explorer column beside it");
  for (const { marks: [mark], region } of restoreWait) {
    assert.ok(Math.abs(mark.x - region.x) <= 1 && Math.abs(mark.y - region.y) <= 1, `the mark left the middle of its region: ${JSON.stringify({ mark, region })}`);
  }
  assert.equal(report.restore.promptFrames, 0, "the empty editor prompt showed during the restore");
  assert.equal(report.restore.multipleMarks, 0, "two marks showed at once during the restore");
  assert.equal(report.restore.sizes.length, 1, `the mark changed size: ${report.restore.sizes.join(" -> ")}`);
  assert.equal(report.restore.centers.length, 1, `the mark moved: ${report.restore.centers.join(" -> ")}`);

  await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
  await until("[...document.querySelectorAll('.desktop-project-menu [role=menuitem]')].some(item => item.textContent.includes('Home'))", "project menu");
  await evaluate("[...document.querySelectorAll('.desktop-project-menu [role=menuitem]')].find(item => item.textContent.includes('Home')).click()");
  await until("!!document.querySelector('.onboarding-homepage button[aria-label*=\"Project B\"]')", "Homepage");

  // A chosen project, from the click until its document is on screen.
  await evaluate(observer);
  await evaluate("document.querySelector('.onboarding-homepage button[aria-label*=\"Project B\"]').click()");
  await until("window.projectOpeningObservation.frames.some(frame => frame.stage === 'preparation')", "project's window");
  // The frame was sampled before it was painted; capture one that has been.
  await wait(120);
  await fs.writeFile(path.join(reportDirectory, "preparation.png"), (await window.webContents.capturePage()).toPNG());
  await until("window.projectOpeningObservation.frames.some(frame => frame.stage === 'loading-document' || frame.stage === 'entering')", "workbench");
  await fs.writeFile(path.join(reportDirectory, "workbench-waiting.png"), (await window.webContents.capturePage()).toPNG());
  await until("!!document.querySelector('.cm-content') && document.querySelector('.cm-content').textContent.includes('Project B')", "opened document");
  await fs.writeFile(path.join(reportDirectory, "document.png"), (await window.webContents.capturePage()).toPNG());
  const frames = await stop();
  report.opening = summarize(frames);

  // Everything after the click: the page the user left must already be gone.
  const after = frames.slice(frames.findIndex(({ stage }) => stage === "preparation"));
  assert.ok(!after.some(({ stage }) => stage === "homepage"), "the Homepage reappeared during the open");
  assert.equal(after.find(({ title }) => title)?.title, "Project B", "the Header named the project from the start");
  assertOneMark("open", report.opening);

  // From the Header menu, with a project on screen.
  await chooseFromMenu("Project A");
  await until("window.projectOpeningObservation.frames.some(frame => frame.stage === 'preparation')", "project's window from the menu");
  await wait(120);
  await fs.writeFile(path.join(reportDirectory, "menu-preparation.png"), (await window.webContents.capturePage()).toPNG());
  await until("!!document.querySelector('.cm-content') && document.querySelector('.cm-content').textContent.includes('Project A')", "document from the menu");
  const menu = await stop();
  report.menu = summarize(menu);
  const waiting = menu.filter(({ stage }) => stage === "preparation");
  assert.ok(waiting.every(({ title }) => title === "Project A"), `the Header kept the project being left: ${[...new Set(waiting.map(({ title }) => title))]}`);
  assert.ok(waiting.every(({ left }) => left === "hidden"), "the project being left stayed visible during the wait");
  const afterWait = menu.slice(menu.findIndex(({ stage }) => stage === "preparation"));
  const shownAfterWait = [...new Set(afterWait.map(({ shownDocument }) => shownDocument).filter(Boolean))];
  report.menu.shownAfterWait = shownAfterWait;
  assert.ok(shownAfterWait.every((text) => text.includes("Project A")), `the project being left showed after the wait: ${shownAfterWait}`);
  assertOneMark("menu switch", report.menu);

  // A failed switch returns to the project on screen, untouched.
  await chooseFromMenu("Project C");
  await until("window.projectOpeningObservation.frames.some(frame => frame.stage === 'preparation')", "failed open started");
  await until("document.body.textContent.includes('Fixture folder is unavailable')", "failure dialog");
  await fs.writeFile(path.join(reportDirectory, "menu-failure.png"), (await window.webContents.capturePage()).toPNG());
  const failed = await stop();
  report.failure = summarize(failed);
  assert.equal(await evaluate("document.querySelector('.desktop-titlebar-workspace-name').textContent"), "Project A", "the Header kept the failed target");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.desktop-workspace-location-surface')).visibility"), "visible", "the project on screen stayed hidden");
  assert.ok(await evaluate("document.querySelector('.cm-content').textContent.includes('Project A')"), "the project on screen lost its document");
  assert.equal(await evaluate("document.querySelector('.desktop-project-preparation')"), null, "the wait outlived the failure");
  report.ok = true;
}

// Main must register privileged protocols before ready; then release the entry
// module before waiting for ready, so Electron can finish startup.
let bootstrapError;
try { await initialize(); } catch (error) { bootstrapError = error; }
void (bootstrapError ? Promise.reject(bootstrapError) : run()).catch(async (error) => {
  report.error = error instanceof Error ? error.stack : String(error);
  console.error(report.error);
  if (!window || window.isDestroyed()) return;
  await fs.writeFile(path.join(reportDirectory, "failure.png"), (await window.webContents.capturePage()).toPNG());
  report.failureStages = await evaluate("window.projectOpeningObservation?.frames.map(({ stage }) => stage).filter((stage, index, all) => stage !== all[index - 1])");
  console.error(`Stages seen: ${report.failureStages}`);
}).finally(async () => {
  clearTimeout(guard);
  await fs.writeFile(path.join(reportDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Project opening report: ${reportDirectory}/report.json`);
  console.log(`Documents shown after the wait: ${JSON.stringify(report.menu?.shownAfterWait)}`);
  console.log(JSON.stringify({ ok: report.ok, restore: report.restore, opening: report.opening, menu: report.menu, failure: report.failure }));
  for (const owner of BrowserWindow.getAllWindows()) owner.destroy();
  await server?.close();
  app.exit(report.ok ? 0 : 1);
});

#!/usr/bin/env electron
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { resolveCliControlEndpoint } from "../../../../electron/main/cli-control/endpoint.mjs";
import { CLI_LAUNCH_ARGUMENT } from "../../../../shared/cli-control-contract/protocol.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

/**
 * `puppyone open` against the real main process. The app is started the way
 * the CLI starts it, with the launch argument, and driven over its socket.
 * PUPPYONE_CLI_BIN, when set, also runs the real CLI against it.
 *
 * Scenarios, chosen with --scenario=<name>: `full` (default), `failed-launch`
 * (a rejected first request quits the app), `no-request` (no request means a
 * normal start).
 */
const scenario = process.argv.find((value) => value.startsWith("--scenario="))?.slice("--scenario=".length) ?? "full";
if (!["full", "failed-launch", "no-request"].includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
const cliBin = process.env.PUPPYONE_CLI_BIN ?? null;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-cli-open-")));
const reportDirectory = path.join(repoRoot, "artifacts/tests/command-line-open", `${scenario}-${new Date().toISOString().replaceAll(":", "-")}`);
await fs.mkdir(reportDirectory, { recursive: true });
app.setAppPath(repoRoot);
app.setPath("appData", temporaryRoot);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
process.argv.push(CLI_LAUNCH_ARGUMENT);

// Real windows, out of the way. Focus is recorded rather than taken.
const focused = new Set();
BrowserWindow.prototype.show = function quietShow() { this.setOpacity(0); this.showInactive(); };
BrowserWindow.prototype.focus = function recordFocus() { focused.add(this); };
app.focus = () => undefined;
dialog.showMessageBox = async () => ({ response: 2 });
// The app decides to quit; the harness records it and exits after its own checks.
if (scenario === "failed-launch") app.quit = () => { report.quitRequested = true; };

const report = { ok: false, scenario, stage: "fixtures", checks: {}, error: null };
const docs = path.join(temporaryRoot, "docs");
const project = path.join(temporaryRoot, "last-project");
const inDocs = (name) => path.join(docs, name);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const guard = setTimeout(() => { console.error(`Command-line open check timed out during: ${report.stage}`); void finish(1); }, 180_000);
const created = [];
app.on("browser-window-created", (_event, window) => {
  created.push(window);
  window.webContents.setBackgroundThrottling(false);
});
let server;

function check(name, actual, expected = true) {
  report.checks[name] = actual;
  assert.deepEqual(actual, expected, name);
}

async function until(probe, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch { /* The page may be mid-navigation; try again. */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await wait(40);
  }
}

const evaluate = (window, source) => window.webContents.executeJavaScript(source, true);
const exists = (window, selector) => evaluate(window, `!!document.querySelector(${JSON.stringify(selector)})`);
const windows = () => BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
const windowNamed = (title) => windows().find((window) => window.getTitle() === title);
const projectWindows = () => windows().filter((window) => window.webContents.getURL() && !window.webContents.getURL().includes("#file-mode"));
const editorText = (window) => evaluate(window, `document.querySelector(".cm-content")?.innerText ?? ""`);

let endpoint;
function send(request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint);
    let data = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    socket.on("error", reject);
  });
}
const open = (paths, activate = true) => send({ protocol: 1, type: "open", paths, activate });
const statuses = (response) => response.results.map((result) => result.error?.code ?? result.status);

function runCli(args) {
  const env = { ...process.env, PUPPYONE_CLI_ENDPOINT: endpoint };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    execFile(process.env.PUPPYONE_CLI_NODE ?? "node", [cliBin, ...args], { cwd: docs, env },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

async function prepareFixtures() {
  await fs.mkdir(docs, { recursive: true });
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "note.md"), "# Last project\n");
  for (const name of ["plan.md", "second.md", "dirty.md"]) await fs.writeFile(inDocs(name), `# ${name}\n`);
  await fs.writeFile(inDocs("main.py"), "print('hi')\n");
  await fs.writeFile(inDocs("big.md"), "x".repeat(1024 * 1024 + 1));
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: async (value) => value });
  await registry.rememberWorkspaceComposition([await workspaceFromPath(project)]);
}

async function startApplication() {
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5383, strictPort: false, hmr: false, watch: null, fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules"))] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  report.stage = "loading the main process";
  await import("../../../../electron/main.mjs");
  endpoint = resolveCliControlEndpoint({ userDataPath: app.getPath("userData"), uid: process.getuid() });
  report.endpoint = endpoint;
}

async function connected() {
  await until(() => fs.stat(endpoint).then(() => true), "the command-line endpoint", 20_000);
  check("the endpoint is private to this user", (await fs.stat(endpoint)).mode & 0o777, 0o600);
}

async function coldStart() {
  const hello = await send({ protocol: 1, type: "hello" });
  check("hello names the app and what it opens", [hello.ok, hello.protocol, hello.open.extensions.includes(".md"), hello.open.maxBytes], [true, 1, true, 1024 * 1024]);
  const first = await open([inDocs("plan.md")]);
  check("a cold launch opens the requested file", statuses(first), ["opened"]);
  const window = await until(() => windowNamed("plan.md"), "the plan.md window");
  await until(() => exists(window, ".cm-editor"), "the document", 90_000);
  await wait(1_500);
  check("a cold launch does not restore the last project", windows().length, 1);
  return window;
}

async function routing(window) {
  check("an open file is focused, not opened again", statuses(await open([inDocs("plan.md")])), ["focused"]);
  check("still one window", windows().length, 1);

  const rejected = await open([inDocs("main.py"), inDocs("big.md"), inDocs("missing.md")]);
  check("paths that cannot open are named", statuses(rejected), ["UNSUPPORTED_TYPE", "FILE_TOO_LARGE", "PATH_NOT_FOUND"]);
  check("a refused path opens no window", windows().length, 1);
  check("relative paths are refused", (await send({ protocol: 1, type: "open", paths: ["relative.md"] })).error.code, "BAD_REQUEST");
  check("other protocol versions are told the range", (await send({ protocol: 9, type: "hello" })).error.code, "PROTOCOL_UNSUPPORTED");

  focused.clear();
  check("a background open opens the file", statuses(await open([inDocs("second.md")], false)), ["opened"]);
  const background = await until(() => windowNamed("second.md"), "the background window");
  await until(() => exists(background, ".cm-editor"), "its document");
  check("a background window is not focused", focused.has(background), false);
  check("a background window is visible", background.isVisible(), true);

  const folder = await open([docs]);
  check("a folder opens its project window", [folder.results[0].status, folder.results[0].window], ["opened", "project"]);
  const projectWindow = await until(() => projectWindows()[0], "the project window");
  await until(() => exists(projectWindow, ".desktop-titlebar-workspace-name"), "the project's title bar", 60_000);
  const count = windows().length;
  check("an open folder is focused, not opened again", statuses(await open([docs])), ["focused"]);
  check("no second project window", windows().length, count);
  projectWindow.close();
  await until(() => projectWindow.isDestroyed(), "the project window to close");
  background.close();
  await until(() => background.isDestroyed(), "the background window to close");
  return window;
}

async function outsideChanges(window) {
  await fs.writeFile(inDocs("plan.md"), "# plan.md\n\nwritten by an Agent\n");
  await until(async () => (await editorText(window)).includes("written by an Agent"), "the change without focus", 10_000);
  check("an outside change shows without returning to the window", true);
  // Replacing the file through a rename, as many editors and Agents save.
  const temporary = inDocs(".plan.md.tmp");
  await fs.writeFile(temporary, "# plan.md\n\nreplaced through a rename\n");
  await fs.rename(temporary, inDocs("plan.md"));
  await until(async () => (await editorText(window)).includes("replaced through a rename"), "the renamed-over file", 10_000);
  check("a save through a rename shows too", true);

  check("the dirty file opens", statuses(await open([inDocs("dirty.md")])), ["opened"]);
  const dirty = await until(() => windowNamed("dirty.md"), "the dirty.md window");
  await until(() => exists(dirty, ".cm-editor"), "its document");
  await evaluate(dirty, `document.querySelector(".cm-content").focus()`);
  dirty.webContents.insertText("mine ");
  await until(() => dirty.isDocumentEdited(), "the edit");
  await fs.appendFile(inDocs("dirty.md"), "theirs\n");
  await wait(1_500);
  await evaluate(dirty, `document.querySelector(".editor-document-session-boundary").dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }))`);
  await wait(800);
  const onDisk = await fs.readFile(inDocs("dirty.md"), "utf8");
  check("an outside change survives a save of older edits", onDisk.includes("theirs"));
  check("the older edits do not overwrite it", onDisk.includes("mine "), false);
  dirty.destroy();
}

async function realCli() {
  if (!cliBin) {
    report.realCli = "skipped: set PUPPYONE_CLI_BIN to run the CLI";
    return;
  }
  const opened = await runCli(["open", "--json", "plan.md"]);
  check("the CLI reports a focused file", [opened.code, JSON.parse(opened.stdout).results?.[0]?.status], [0, "focused"]);
  const second = await runCli(["open", "--background", "second.md"]);
  check("the CLI opens in the background", [second.code, second.stdout.trim()], [0, "Opened second.md in PuppyOne in the background"]);
  const unsupported = await runCli(["open", "--json", "main.py"]);
  check("the CLI refuses an unsupported file with exit code 4", [unsupported.code, JSON.parse(unsupported.stdout).error.code], [4, "UNSUPPORTED_TYPE"]);
  const doctor = await runCli(["doctor", "--json"]);
  check("the CLI doctor is ready", [doctor.code, JSON.parse(doctor.stdout).ready], [0, true]);
}

async function failedLaunch() {
  const response = await open([inDocs("main.py")]);
  check("the only request is refused", statuses(response), ["UNSUPPORTED_TYPE"]);
  await until(() => report.quitRequested, "the app to quit", 10_000);
  check("a refused launch quits without any window", created.length, 0);
}

async function noRequest() {
  const readyAt = Date.now();
  const window = await until(() => projectWindows()[0], "the normal start", 20_000);
  check("a launch by the CLI waits for its request before starting normally", Date.now() - readyAt >= 8_000);
  await until(() => exists(window, ".desktop-titlebar-workspace-name"), "the last project", 60_000);
  check("no request means the last project comes back", windows().length, 1);
}

async function finish(code) {
  clearTimeout(guard);
  await fs.writeFile(path.join(reportDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined);
  for (const window of windows()) window.destroy();
  await server?.close().catch(() => undefined);
  await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(code);
}

async function fail(error) {
  report.error = error instanceof Error ? error.stack : String(error);
  report.windows = windows().map((window) => ({ title: window.getTitle(), url: window.webContents.getURL() }));
  console.error("Command-line open check failed:", report.error);
  await finish(1);
}

async function run() {
  try {
    await app.whenReady();
    Menu.setApplicationMenu(null);
    report.stage = "connecting";
    if (scenario !== "no-request") await connected();
    if (scenario === "failed-launch") {
      report.stage = "failed launch";
      await failedLaunch();
    } else if (scenario === "no-request") {
      report.stage = "no request";
      await noRequest();
    } else {
      report.stage = "cold start";
      const window = await coldStart();
      for (const [stage, step] of Object.entries({ routing, outsideChanges, realCli })) {
        report.stage = stage;
        await step(window);
      }
    }
    report.ok = true;
    console.log(`Command-line open (${scenario}): ${Object.keys(report.checks).length} checks passed. Report: ${reportDirectory}`);
    await finish(0);
  } catch (error) {
    await fail(error);
  }
}

try {
  await prepareFixtures();
  report.stage = "starting the application";
  await startApplication();
  void run();
} catch (error) {
  await fail(error);
}

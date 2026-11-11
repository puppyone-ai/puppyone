#!/usr/bin/env electron
// Full production Main/preload/App, with disposable local repository/userData.
// Authentication and backend facts are isolated; Automation is intentionally unregistered.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, safeStorage, session } from "electron";
import { workspaceFromPath } from "../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../shared/desktop-build-identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const origin = process.env.PUPPYONE_ENTRYPOINT_TEST_ORIGIN;
assert.ok(origin && new URL(origin).hostname === "127.0.0.1" && new URL(origin).protocol === "http:", "Only an isolated loopback fixture is allowed");
const temporaryRoot = process.env.PUPPYONE_ENTRYPOINT_TEST_WORKSPACE
  || await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-entrypoint-window-"));
if (process.env.PUPPYONE_ENTRYPOINT_TEST_WORKSPACE) await fs.mkdir(temporaryRoot);
const artifactDirectory = path.join(root, "artifacts/tests/cloud-entrypoints", new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(artifactDirectory, { recursive: true });
const report = { ok: false, source: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  window_reloads: 0, document_ids: [], blocked_network: [], console_errors: [], error: null,
  evidence_scope: "production Main/preload/App and real BrowserWindow; isolated auth/storage/Provider/queue, no PostgreSQL or installer acceptance" };
let window, server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code, true);
const guard = setTimeout(() => { console.error("Entrypoint window gate timed out"); app.exit(1); }, 210_000);
app.setAppPath(root);
app.setPath("appData", temporaryRoot);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("lang", "en-US");
// Fake test tokens only. Never prompt for or modify a user's OS credential store.
process.env.PUPPYONE_ALLOW_INSECURE_TOKEN_STORAGE = "1";
process.env.VITE_DESKTOP_CLOUD_API_URL = `${origin}/api/v1`;
process.env.VITE_DESKTOP_CLOUD_WEB_URL = origin;
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_TERMINAL_PROMPT = "0";
safeStorage.isEncryptionAvailable = () => false;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== origin) {
    report.blocked_network.push(url.origin + url.pathname);
    throw new Error(`Non-fixture main-process HTTP blocked: ${url.origin}`);
  }
  return nativeFetch(input, init);
};

async function control(route, method = "GET") {
  const result = await nativeFetch(origin + "/__window/" + route, { method });
  assert.ok(result.ok, `Fixture control failed: ${route} ${result.status}`);
  return result.json();
}
async function until(expression, description = expression) {
  for (let n = 0; n < 300; n++) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timed out: ${description}`);
}
async function capture(name) {
  await fs.writeFile(path.join(artifactDirectory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
}
async function reload() {
  const previous = await evaluate("window.__entrypointWindowDocumentNonce ||= crypto.randomUUID()");
  const loaded = new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  window.reload();
  await loaded;
  const next = await evaluate("window.__entrypointWindowDocumentNonce ||= crypto.randomUUID()");
  assert.notEqual(previous, next, "BrowserWindow reload must replace the renderer document");
  report.document_ids.push(next);
  report.window_reloads++;
  await until("!!document.querySelector('.app-shell')", "App after real window reload");
}
async function initialize() {
  await fs.writeFile(path.join(app.getPath("userData"), "desktop-cloud-session.json"), JSON.stringify({
    version: 2, storage: "plaintext-dev", data: { version: 2, user_id: "user-1", user_email: "window@example.test",
      api_origin: `${origin}/api/v1`, refresh_token: "isolated-window-refresh", updated_at: new Date().toISOString() },
  }), { mode: 0o600 });
  const projectPath = path.join(temporaryRoot, "Window project");
  await fs.mkdir(projectPath);
  execFileSync("git", ["init", "-q", projectPath]);
  execFileSync("git", ["-C", projectPath, "-c", "user.name=Window test", "-c", "user.email=window@example.test", "commit", "--allow-empty", "-qm", "Isolated window fixture"]);
  execFileSync("git", ["-C", projectPath, "remote", "add", "origin", `${origin}/git/project-1.git`]);
  const workspace = await workspaceFromPath(projectPath);
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json",
    canonicalizeWorkspacePath: p => fs.realpath(p), workspaceFromPath });
  await registry.rememberWorkspaceComposition([workspace]);
  process.argv.push(projectPath);
  const { createServer } = await import("vite");
  server = await createServer({ root, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: { "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify(`${origin}/api/v1`),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify(origin) },
    // Vite normalizes port 0 to its default; never collide with another owned
    // dev server or stop it. Main and the network gate use our actual bound port.
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  app.on("browser-window-created", (_event, owner) => {
    owner.webContents.setBackgroundThrottling(false);
    owner.webContents.on("console-message", (_event, level, message) => { if (level >= 2) report.console_errors.push(message); });
  });
  void app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const allowed = [origin, process.env.PUPPYONE_DESKTOP_DEV_URL].includes(url.origin)
      || ["data:", "blob:", "about:", "devtools:"].includes(url.protocol);
    if (!allowed) report.blocked_network.push(url.origin + url.pathname);
    callback({ cancel: !allowed });
  }));
  await import("../../../electron/main.mjs");
  app.commandLine.appendSwitch("remote-debugging-port", "0");
}

async function run() {
  await app.whenReady();
  for (let n = 0; n < 300 && !BrowserWindow.getAllWindows().length; n++) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "Production Main created a BrowserWindow");
  window.setContentSize(1280, 900); window.show();
  await until("!!document.querySelector('.app-shell')", "App mount");
  await evaluate("localStorage.setItem('puppyone.desktop.experimental', JSON.stringify({ enableCloudAutomation: true, enableCloudWorkspace: true }));");
  await reload();
  // Automation was explicitly unregistered on 2026-11-01. Stored legacy
  // flags must not resurrect a route or issue writes to retired services.
  const noRetiredControls = `!document.querySelector('.desktop-cloud-service-sidebar, .desktop-cloud-automation-page')
    && ![...document.querySelectorAll('button')].some(e => ['Share', 'Automation'].includes(e.textContent.trim()))`;
  await until("document.body.textContent.includes('Open Cloud project')", "current linked-folder notice");
  assert.ok(await evaluate(noRetiredControls), 'retired Automation is absent');
  await capture("01-current-project");
  await reload();
  await until("document.body.textContent.includes('Open Cloud project')", "linked-folder notice after reload");
  assert.ok(await evaluate(noRetiredControls), 'reload cannot restore retired routes');
  await capture("02-after-reload");
  const final = await control("state");
  assert.deepEqual(final.bindings, []);
  assert.deepEqual(final.runs, []);
  assert.ok(!final.requests.some(r => /\/(synchronize|integrations|connectors)(\/|$)/.test(r.path)), 'no retired service calls');
  report.requests = final.requests;
  report.automation_route_registered = false;
  assert.deepEqual(report.blocked_network, [], "Unexpected external request attempted");
  assert.deepEqual(report.console_errors.filter(message => !message.includes("Electron Security Warning")), [], "Unexpected renderer errors");
  report.ok = true;
}

// Register production protocols before ready; release the entry module before
// awaiting readiness so Electron's ESM bootstrap can finish.
let bootstrapError;
try { await initialize(); } catch (error) { bootstrapError = error; }
void (bootstrapError ? Promise.reject(bootstrapError) : run()).catch(async error => {
  report.error = error.stack || String(error);
  if (window && !window.isDestroyed()) {
    report.visible_text = await evaluate("document.body.innerText").catch(() => null);
    report.buttons = await evaluate("[...document.querySelectorAll('button')].map(e=>({text:e.textContent,label:e.getAttribute('aria-label'),class:e.className}))").catch(() => null);
    await capture("failure").catch(() => {});
  }
  report.server_state = await control('state').catch(() => null);
  console.error(report.error);
}).finally(async () => {
  await fs.writeFile(path.join(artifactDirectory, "report.json"), JSON.stringify(report, null, 2));
  if (process.env.PUPPYONE_ENTRYPOINT_TEST_REPORT) await fs.writeFile(process.env.PUPPYONE_ENTRYPOINT_TEST_REPORT, JSON.stringify(report, null, 2));
  console.log(`Entrypoint window receipt: ${artifactDirectory}/report.json`);
  try {
    if (window && !window.isDestroyed()) window.destroy();
    await server?.close();
    // The Python parent removes its directory after Electron has exited and
    // stopped flushing profile files. Deleting it here races those writes.
    if (!process.env.PUPPYONE_ENTRYPOINT_TEST_WORKSPACE) {
      await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  } catch (error) {
    report.ok = false;
    console.error("Entrypoint window cleanup failed", error);
  } finally {
    clearTimeout(guard);
    app.exit(report.ok ? 0 : 1);
  }
});

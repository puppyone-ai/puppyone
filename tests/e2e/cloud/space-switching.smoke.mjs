#!/usr/bin/env electron
// Production Main/preload/App and two real windows with disposable userData.
// Authentication and backend persistence are isolated fixture facts.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, safeStorage, session } from "electron";
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
  blocked_network: [], console_errors: [], error: null,
  evidence_scope: "production Main/preload/App and two BrowserWindows; isolated auth/backend, no installer acceptance" };
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
async function initialize() {
  await fs.writeFile(path.join(app.getPath("userData"), "desktop-cloud-session.json"), JSON.stringify({
    version: 2, storage: "plaintext-dev", data: { version: 2, user_id: "user-1", user_email: "window@example.test",
      api_origin: `${origin}/api/v1`, refresh_token: "isolated-window-refresh", updated_at: new Date().toISOString() },
  }), { mode: 0o600 });
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
  await until("!!document.querySelector('.desktop-onboarding, .desktop-titlebar')", "Home mount");
  await evaluate("localStorage.setItem('puppyone.desktop.experimental', JSON.stringify({ enableCloudAutomation: true, enableCloudWorkspace: true }));");
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
  await until("document.querySelector('.desktop-space-switcher select')?.value === 'org-1'", "default Space");
  const select = async (owner, id) => {
    await owner.webContents.executeJavaScript(`(() => { const e=document.querySelector('.desktop-space-switcher select'); e.value=${JSON.stringify(id)}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`, true);
  };
  await until("document.body.textContent.includes('Window acceptance')", "Space A project");
  assert.equal(await evaluate("document.body.textContent.includes('Space B only')"), false);
  await select(window, 'org-2');
  await until("document.querySelector('.desktop-space-switcher select')?.value === 'org-2' && document.body.textContent.includes('Space B only')", "Space B Home");
  assert.equal(await evaluate("document.body.textContent.includes('Window acceptance')"), false);
  await capture('01-space-b-home');
  await evaluate("window.puppyoneDesktop.openCloudProjectInNewWindow({projectId:'project-b',userId:'user-1'})");
  for(let i=0;i<200&&BrowserWindow.getAllWindows().length<2;i++)await wait(50);
  const second=BrowserWindow.getAllWindows().find(candidate=>candidate.id!==window.id);
  assert.ok(second, 'Production Main creates a second window');
  for(let i=0;i<500;i++) {
    if(await second.webContents.executeJavaScript("document.querySelector('.desktop-space-switcher select')?.value === 'org-2'"))break;
    await wait(50);
  }
  assert.equal(await second.webContents.executeJavaScript("document.querySelector('.desktop-space-switcher select')?.value"),'org-2');
  await select(second,'org-2');
  await wait(300);
  await select(window,'org-1');
  await until("document.querySelector('.desktop-space-switcher select')?.value === 'org-1' && document.body.textContent.includes('Window acceptance')", 'first window returns A');
  assert.equal(await second.webContents.executeJavaScript("document.querySelector('.desktop-space-switcher select')?.value"),'org-2');
  await select(window,'settings');
  await until("!!document.querySelector('.desktop-space-member-form')", 'current Space member settings');
  assert.ok(await evaluate("document.body.textContent.includes('Studio')"));
  await capture('02-space-a-settings');
  report.ok=true; report.window_count=2; report.current_spaces=['org-1','org-2'];
  assert.deepEqual(report.blocked_network, [], "Unexpected external request attempted");
}
let bootstrapError;
try { await initialize(); } catch (error) { bootstrapError = error; }
void (bootstrapError ? Promise.reject(bootstrapError) : run()).catch(async error => {
  report.error = error.stack || String(error);
  if (window && !window.isDestroyed()) {
    report.visible_text = await evaluate("document.body.innerText").catch(() => null);
    await capture("failure").catch(() => {});
  }
  console.error(report.error);
}).finally(async () => {
  clearTimeout(guard);
  for(const owner of BrowserWindow.getAllWindows())owner.destroy();
  await server?.close().catch(error => console.error(error.message));
  await fs.writeFile(process.env.PUPPYONE_ENTRYPOINT_TEST_REPORT,JSON.stringify(report,null,2));
  await fs.writeFile(path.join(artifactDirectory, "report.json"),JSON.stringify(report,null,2));
  app.exit(report.ok?0:1);
});

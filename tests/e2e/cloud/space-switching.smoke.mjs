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
const evaluate = code => Promise.race([
  window.webContents.executeJavaScript(code, true),
  wait(5000).then(() => { throw new Error('Renderer evaluation timed out'); }),
]);
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
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await wait(150);
  // A newly mounted native view may not have a compositor frame yet.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.writeFile(path.join(artifactDirectory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
      return;
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("UnknownVizError")) throw error;
      await wait(150);
    }
  }
}
async function initialize() {
  const { createWorkspaceStateStore } = await import("../../../electron/main/workspace-state-store.mjs");
  const localPaths = [path.join(temporaryRoot, "This Mac fixture"), path.join(temporaryRoot, "Local working copy")];
  for (const folder of localPaths) {
    await fs.mkdir(folder, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main", folder], { stdio: "ignore" });
    await fs.writeFile(path.join(folder, "README.md"), "Disposable local Space navigation fixture\n");
  }
  execFileSync("git", ["-C", localPaths[1], "remote", "add", "origin", `${origin}/git/project-b.git`]);
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json",
    canonicalizeWorkspacePath: folder => fs.realpath(folder),
    workspaceFromPath: async folder => ({ path: folder, name: path.basename(folder) }) });
  await registry.addRecentWorkspacePaths(localPaths);
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
  await evaluate("localStorage.setItem('puppyone.desktop.experimental', JSON.stringify({ enableCloudAutomation: true, enableCloudWorkspace: true, enableHostDevices: true }));");
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
  const allProjects = "['Window acceptance','Space B only','This Mac fixture','Local working copy'].every(name => document.body.textContent.includes(name))";
  await until(allProjects, "all Space and local projects on Home");
  assert.equal(await evaluate("!!document.querySelector('.onboarding-space-sidebar, .desktop-space-trigger')"), false);
  assert.equal(await evaluate("document.querySelectorAll('[data-project-group^=\"space:\"]').length"), 2);
  assert.equal(await evaluate("document.body.textContent.includes('Other computers')"), false);
  assert.deepEqual(await evaluate("window.puppyoneDesktop.listHostDevices({userId:'user-1',generation:'stale'})"), { devices: [] });
  assert.equal(await evaluate("window.puppyoneDesktop.registerHostFolder({rootPath:'/invalid'}).then(() => false, error => error.message.includes('unavailable in this build'))"), true);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture('00-all-spaces-home');
  window.setContentSize(680, 900);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await capture('00b-all-spaces-home-narrow');
  window.setContentSize(1280, 900);

  const untilOwner = async (owner, expression) => {
    for (let n = 0; n < 300; n++) {
      if (await owner.webContents.executeJavaScript(expression, true)) return;
      await wait(50);
    }
    throw new Error(`Window did not settle: ${expression}`);
  };
  const openPlan = async owner => {
    await owner.webContents.executeJavaScript("document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar').click()", true);
    await untilOwner(owner, "!!document.querySelector('.desktop-settings-dialog')");
    await owner.webContents.executeJavaScript("[...document.querySelectorAll('.desktop-settings-sidebar button')].find(button => button.textContent.trim() === 'Plan').click()", true);
    await untilOwner(owner, "!!document.querySelector('.desktop-settings-space-picker select')");
  };
  const pickPlan = async (owner, id) => {
    await owner.webContents.executeJavaScript(`(() => { const picker=document.querySelector('.desktop-settings-space-picker select'); picker.value=${JSON.stringify(id)}; picker.dispatchEvent(new Event('change',{bubbles:true})); })()`, true);
    await untilOwner(owner, `document.querySelector('.desktop-settings-space-picker select')?.value === ${JSON.stringify(id)}`);
  };
  const closeSettings = async owner => {
    await owner.webContents.executeJavaScript("document.querySelector('.desktop-settings-dialog-header button').click()", true);
    await untilOwner(owner, "!document.querySelector('.desktop-settings-dialog')");
  };
  await openPlan(window);
  assert.equal(await evaluate("document.querySelectorAll('.desktop-settings-space-picker option').length"), 2);
  await pickPlan(window, 'org-2');
  await until("document.querySelector('.desktop-plan-settings').textContent.includes('Research')", 'Plan explicitly targets Research');
  await capture('01-plan-choose-space');
  await evaluate("document.querySelector('.desktop-settings-space-picker button').click()");
  await until("!!document.querySelector('.desktop-dialog-field input')", 'Create space remains available in settings');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
  await until("!document.querySelector('.desktop-dialog-field input') && !!document.querySelector('.desktop-settings-dialog')", 'cancel creation retains settings');
  assert.equal(await evaluate("document.querySelector('.desktop-settings-space-picker select').value"), 'org-2');
  await closeSettings(window);
  assert.ok(await evaluate(allProjects), 'choosing a bill must not filter Home');

  await evaluate("[...document.querySelectorAll('[data-project-open]')].find(button => button.getAttribute('aria-label')?.includes('This Mac fixture')).click()");
  await until("!!document.querySelector('.desktop-shell') && document.body.textContent.includes('README.md')", 'local project files load');
  assert.equal(await evaluate("!!document.querySelector('.desktop-space-trigger, .desktop-sidebar-space-navigation')"), false, 'no global Space control in the project Sidebar');
  await capture('02-project-without-space-switcher');
  await openPlan(window);
  await pickPlan(window, 'org-1');
  assert.ok(await evaluate("document.querySelector('.desktop-titlebar').textContent.includes('This Mac fixture')"));
  await capture('03-plan-over-local-project');

  await evaluate("window.puppyoneDesktop.openCloudProjectInNewWindow({projectId:'project-b',userId:'user-1'})");
  for (let n = 0; n < 200 && BrowserWindow.getAllWindows().length < 2; n++) await wait(50);
  const second = BrowserWindow.getAllWindows().find(candidate => candidate.id !== window.id);
  assert.ok(second, 'second real window');
  // Discovery fixture only: repository hydration is intentionally unavailable.
  await untilOwner(second, allProjects);
  await openPlan(second);
  await pickPlan(second, 'org-2');
  assert.equal(await evaluate("document.querySelector('.desktop-settings-space-picker select').value"), 'org-1');
  assert.equal(await second.webContents.executeJavaScript("document.querySelector('.desktop-settings-space-picker select').value"), 'org-2');
  await evaluate("[...document.querySelectorAll('.desktop-settings-sidebar button')].find(button => button.textContent.trim() === 'Members & settings').click()");
  await until("!!document.querySelector('.desktop-space-member-form input:not(:disabled)')", 'members of the chosen Space');
  await capture('04-space-members');
  await closeSettings(window);
  await evaluate("localStorage.setItem('puppyone.desktop.experimental', JSON.stringify({ enableCloudAutomation: true, enableCloudWorkspace: false }));");
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
  await until("!!document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar')", 'account with Cloud off');
  await evaluate("document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar').click()");
  await until("document.querySelector('.desktop-account-settings-section h2')?.textContent === 'Account'", 'Account stays accessible');
  await capture('05-account-with-cloud-off');
  report.all_spaces_on_home = true;
  report.no_global_space_switcher = true;
  report.plan_explicit_space_selection = true;
  report.local_projects_always_visible = true;
  report.other_computers_rollout_disabled = true;
  report.account_available_without_cloud = true;
  report.ok = true; report.window_count = 2; report.current_spaces = ['org-1', 'org-2'];
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
  for(const owner of BrowserWindow.getAllWindows())owner.destroy();
  server?.httpServer?.closeAllConnections();
  await Promise.race([server?.close().catch(error => console.error(error.message)), wait(3000)]);
  await fs.writeFile(process.env.PUPPYONE_ENTRYPOINT_TEST_REPORT,JSON.stringify(report,null,2));
  await fs.writeFile(path.join(artifactDirectory, "report.json"),JSON.stringify(report,null,2));
  clearTimeout(guard);
  app.exit(report.ok?0:1);
});

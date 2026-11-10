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
  await until("document.body.textContent.includes('Window acceptance')", "default Space Home");
  assert.equal(await evaluate("!!document.querySelector('.onboarding-space-sidebar')"), false, 'Home has no added Sidebar');
  assert.equal(await evaluate("document.querySelector('.onboarding-homepage-shell')?.hasAttribute('data-space-sidebar')"), false);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture('00-home-without-sidebar');
  assert.equal(await evaluate("document.body.textContent.includes('Other computers')"), false);
  assert.deepEqual(await evaluate("window.puppyoneDesktop.listHostDevices({userId:'user-1',generation:'stale'})"), { devices: [] });
  assert.equal(await evaluate("window.puppyoneDesktop.registerHostFolder({rootPath:'/invalid'}).then(() => false, error => error.message.includes('unavailable in this build'))"), true);
  report.other_computers_rollout_disabled = true;
  const openLocal = async owner => {
    await owner.webContents.executeJavaScript("[...document.querySelectorAll('[data-project-open]')].find(button => button.getAttribute('aria-label')?.includes('This Mac fixture')).click()", true);
    for (let n = 0; n < 300; n++) {
      if (await owner.webContents.executeJavaScript("!!document.querySelector('.desktop-shell .desktop-space-trigger')")) return;
      await wait(50);
    }
    throw new Error('Local project Sidebar did not mount');
  };
  const select = async (owner, id) => {
    if (!await owner.webContents.executeJavaScript("!!document.querySelector('.desktop-space-trigger')")) await openLocal(owner);
    await owner.webContents.executeJavaScript("document.querySelector('.desktop-space-trigger').click()", true);
    const selector = id === 'settings' || id === 'invite' ? `[data-space-action="${id}"]` : `[data-space-id="${id}"]`;
    for (let n = 0; n < 100; n++) {
      if (await owner.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`)) break;
      await wait(20);
    }
    await owner.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`, true);
  };

  assert.ok(await evaluate("!!document.querySelector('.onboarding-project-group-head .desktop-space-trigger')"), 'Home exposes Space switching beside cloud projects');
  await select(window, 'org-2');
  await until("document.body.textContent.includes('Space B only')", 'switch from Home without opening a project');
  await capture('00c-home-space-switch');
  await select(window, 'org-1');
  await until("document.body.textContent.includes('Window acceptance')", 'return to Space A from Home');
  window.setContentSize(680, 900);
  await evaluate("document.querySelector('.onboarding-project-group-head .desktop-space-trigger').click()");
  await until("!!document.querySelector('.desktop-space-menu')", 'Home Space menu at narrow width');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.ok(await evaluate("(() => { const r=document.querySelector('.desktop-space-menu').getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8; })()"));
  await capture('00d-home-menu-narrow');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  window.setContentSize(1280, 900);
  await openLocal(window);
  assert.ok(await evaluate("(() => { const name=document.querySelector('.desktop-space-trigger bdi'); return name.clientWidth >= name.scrollWidth - 1; })()"), 'short Space name fits the Sidebar control');
  await evaluate("document.querySelector('.desktop-space-trigger').click()");
  await until("document.activeElement?.getAttribute('data-space-id') === 'org-1'", 'Space menu keyboard focus');
  assert.equal(await evaluate("!!document.querySelector('.desktop-space-menu [aria-haspopup=menu]')"), false);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture('00-account-space-menu');
  window.setContentSize(680, 900);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.ok(await evaluate("(() => { const r=document.querySelector('.desktop-space-menu').getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8; })()"));
  await capture('00b-account-space-menu-narrow');
  window.setContentSize(1280, 900);
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await until("!document.querySelector('.desktop-space-menu')", 'Space menu dismissal');
  assert.equal(await evaluate("document.body.textContent.includes('Space B only')"), false);
  assert.ok(await evaluate("(() => { const trigger = document.querySelector('.desktop-space-trigger').getBoundingClientRect(); const footer = document.querySelector('.desktop-sidebar-bottom-controls').getBoundingClientRect(); return trigger.top > innerHeight * .7 && Math.abs(trigger.right - footer.right) < 10; })()"), 'Space sits at the bottom right of the existing project Sidebar');
  assert.equal(await evaluate("!!document.querySelector('.desktop-titlebar .desktop-space-trigger')"), false);
  await select(window, 'org-2');
  await until("document.body.textContent.includes('Space B only')", "Space B Home");
  assert.equal(await evaluate("document.body.textContent.includes('Window acceptance')"), false);
  assert.ok(await evaluate("document.body.textContent.includes('This Mac fixture') && document.body.textContent.includes('Local working copy')"));
  await capture('01-space-b-home');
  await evaluate("[...document.querySelectorAll('[data-project-open]')].find(button => button.getAttribute('aria-label')?.includes('This Mac fixture')).click()");
  await until("!!document.querySelector('.desktop-shell .desktop-sidebar-space-navigation .desktop-space-trigger')", 'Space switcher in the local project Sidebar');
  assert.equal(await evaluate("document.querySelector('.desktop-space-trigger')?.dataset.currentSpace"), 'org-2');
  await capture('01b-local-project-keeps-space');
  await select(window, 'org-2');
  await until("document.body.textContent.includes('Space B only') && document.body.textContent.includes('This Mac fixture')", 'return Home with local and cloud projects');
  await evaluate("window.puppyoneDesktop.openCloudProjectInNewWindow({projectId:'project-b',userId:'user-1'})");
  for(let i=0;i<200&&BrowserWindow.getAllWindows().length<2;i++)await wait(50);
  const second=BrowserWindow.getAllWindows().find(candidate=>candidate.id!==window.id);
  assert.ok(second, 'Production Main creates a second window');
  for(let i=0;i<500;i++) {
    if(await second.webContents.executeJavaScript("document.body.textContent.includes('Space B only') && !!document.querySelector('[data-project-open]')"))break;
    await wait(50);
  }
  // This fixture supplies project discovery, not repository hydration. Inspect
  // its selected Space in a local workbench after the new window reaches Home.
  await openLocal(second);
  assert.equal(await second.webContents.executeJavaScript("document.querySelector('.desktop-space-trigger')?.dataset.currentSpace"),'org-2');
  assert.equal(await second.webContents.executeJavaScript("document.querySelectorAll('.homepage-cloud-avatar').length"), 1);
  assert.ok(await second.webContents.executeJavaScript("!!document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar')"));

  await select(window,'org-1');
  await until("document.body.textContent.includes('Window acceptance')", 'first window returns A');
  assert.equal(await second.webContents.executeJavaScript("document.querySelector('.desktop-space-trigger')?.dataset.currentSpace"),'org-2');
  await select(window,'invite');
  await until("!!document.querySelector('.desktop-space-member-form input:not(:disabled)')", 'loaded current Space member settings');
  assert.ok(await evaluate("document.body.textContent.includes('Studio')"));
  assert.equal(await evaluate("document.activeElement?.type"), 'email');
  assert.equal(await evaluate("document.querySelectorAll('.homepage-cloud-avatar').length"), 1);
  assert.ok(await evaluate("!!document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar')"));
  assert.equal(await evaluate("!!document.querySelector('.desktop-titlebar-trailing .homepage-cloud-avatar')"), false);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture('02-space-a-settings');
  assert.equal(await evaluate("!!document.querySelector('.desktop-plan-grid')"), false);
  await evaluate("[...document.querySelectorAll('.desktop-settings-sidebar button')].find(button => button.textContent.trim() === 'Plan').click()");
  await until("document.querySelector('.desktop-settings-section h2')?.textContent === 'Plan'", 'separate Plan page');
  assert.equal(await evaluate("!!document.querySelector('.desktop-space-member-form')"), false);
  assert.ok(await evaluate("document.querySelector('.desktop-plan-settings').textContent.includes('Studio')"));
  const pickPlan = async id => evaluate(`(() => { const picker=document.querySelector('.desktop-settings-space-picker select'); picker.value=${JSON.stringify(id)}; picker.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await pickPlan('org-2');
  await until("document.querySelector('.desktop-plan-settings').textContent.includes('Research')", 'Plan switches to Research without leaving Settings');
  assert.equal(await evaluate("document.querySelector('.onboarding-project-group-head .desktop-space-trigger')?.dataset.currentSpace"), 'org-1', 'billing selection does not navigate Home');
  assert.equal(await evaluate("document.querySelectorAll('.desktop-settings-dialog').length"), 1);
  await capture('03b-plan-space-selection');
  await pickPlan('org-1');
  await until("document.querySelector('.desktop-plan-settings').textContent.includes('Studio')", 'Plan returns to Studio');
  await capture('03-space-plan');
  assert.equal(await second.webContents.executeJavaScript("document.querySelector('.desktop-space-trigger')?.dataset.currentSpace"),'org-2');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await until("!document.querySelector('.desktop-settings-dialog')", 'close Plan');
  await evaluate("document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar').click()");
  await until("document.querySelector('.desktop-account-settings-section h2')?.textContent === 'Account'", 'avatar opens Account directly');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture('04-account-from-leading-avatar');
  await evaluate("localStorage.setItem('puppyone.desktop.experimental', JSON.stringify({ enableCloudAutomation: true, enableCloudWorkspace: false }));");
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
  await until("!!document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar') && !document.querySelector('.desktop-space-trigger')", 'account remains available with Cloud off');
  await evaluate("document.querySelector('.desktop-titlebar-left .homepage-cloud-avatar').click()");
  await until("document.querySelector('.desktop-account-settings-section h2')?.textContent === 'Account'", 'Account with Cloud off');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture('05-account-with-cloud-off');
  report.account_available_without_cloud = true;
  report.cloud_only_space_sidebar = true;
  report.home_has_no_added_sidebar = true;
  report.home_inline_space_switching = true;
  report.plan_inline_space_selection = true;
  report.space_at_existing_sidebar_bottom_right = true;
  report.local_projects_always_visible = true;
  report.local_project_keeps_cloud_space = true;
  report.leading_account_and_flat_space_menu = true;
  report.separate_space_and_plan = true;
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
  for(const owner of BrowserWindow.getAllWindows())owner.destroy();
  server?.httpServer?.closeAllConnections();
  await Promise.race([server?.close().catch(error => console.error(error.message)), wait(3000)]);
  await fs.writeFile(process.env.PUPPYONE_ENTRYPOINT_TEST_REPORT,JSON.stringify(report,null,2));
  await fs.writeFile(path.join(artifactDirectory, "report.json"),JSON.stringify(report,null,2));
  clearTimeout(guard);
  app.exit(report.ok?0:1);
});

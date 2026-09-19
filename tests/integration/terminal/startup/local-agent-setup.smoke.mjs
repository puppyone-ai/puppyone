#!/usr/bin/env electron
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLocalAgentSetupService } from "../../../../electron/main/local-agent-installation/setup/setup-service.mjs";
import { registerLocalAgentSetupIpcHandlers } from "../../../../electron/main/ipc/local-agent-setup-ipc.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = path.join(repo, "artifacts/tests/terminal/local-agent-setup");
const source = await readSourceIdentity(repo);
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-setup-profile-")));
app.on("window-all-closed", () => {});
let current = { generation: 1, results: [{ agentId: "codex", status: "not-found" }, { agentId: "cursor", status: "not-found" }] };
const opened = [];
const service = createLocalAgentSetupService({
  installationService: { discover: async () => current, getSnapshot: () => current, isScanning: () => false },
  presenceService: { discover: async () => [{ companionId: "codex", status: "present" }, { companionId: "cursor", status: "present" }], dispose() {} },
  platform: "darwin", openExternal: async (url) => { opened.push(url); },
});
registerLocalAgentSetupIpcHandlers({ ipcMain, setupService: service });
let window;
const results = [];
const evaluate = (code) => window.webContents.executeJavaScript(code, true);
const assert = (value, message) => { if (!value) throw new Error(message); };
const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
async function until(code) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(code)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Unmet UI condition: ${code}`);
}
async function click(label) {
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  await settle();
}
async function capture(name) {
  const metrics = await evaluate(`(() => {
    const panel = document.querySelector('.desktop-terminal-launcher');
    const setup = document.querySelector('.local-agent-setup');
    const context = document.createElement('canvas').getContext('2d');
    context.fillStyle = getComputedStyle(panel).backgroundColor; context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return { overflow: panel.scrollWidth > panel.clientWidth + 1 || setup.scrollWidth > setup.clientWidth + 1,
      brightness: (r + g + b) / 3,
      busyAncestor: Boolean(setup.closest('[aria-busy]')), focused: document.activeElement?.textContent };
  })()`);
  assert(!metrics.overflow && !metrics.busyAncestor, `${name}: overflow or shared busy region`);
  assert(name.startsWith("dark") ? metrics.brightness < 100 : metrics.brightness > 180, `${name}: wrong actual surface palette`);
  await writeFile(path.join(artifacts, `${name}.png`), (await window.capturePage()).toPNG());
  results.push({ name, ...metrics });
}
async function run() {
  await mkdir(artifacts, { recursive: true });
  for (const variant of [
    { theme: "light", width: 420, height: 760, rtl: false },
    { theme: "dark", width: 280, height: 500, rtl: false },
    { theme: "light", width: 280, height: 500, rtl: true },
  ]) {
    current = { generation: 1, results: [{ agentId: "codex", status: "not-found" }, { agentId: "cursor", status: "not-found" }] };
    window = new BrowserWindow({ show: true, width: variant.width + 100, height: variant.height,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
        preload: path.join(repo, "tests/fixtures/platform/local-agent-setup/preload.cjs") } });
    await window.loadURL(pathToFileURL(path.join(repo, "dist/index.html")).href
      + `?scenario=setup&agentMode=chat&theme=${variant.theme}&width=${variant.width}#terminal-launcher-visual-smoke`);
    await until("Boolean(window.__launcherDiscoverySmoke)");
    await evaluate(`document.documentElement.dir = ${JSON.stringify(variant.rtl ? "rtl" : "ltr")}`);
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await evaluate("window.__launcherDiscoverySmoke.setDiscovery({ phase: 'ready', ids: [], completed: 1, refreshing: false, failed: false })");
    await until("Boolean(document.querySelector('.local-agent-setup-card'))");
    const name = `${variant.theme}-${variant.width}-${variant.rtl ? "rtl" : "ltr"}`;
    assert(await evaluate("document.querySelectorAll('.local-agent-setup-card').length === 1"), "Only one recommendation allowed");
    await capture(`${name}-recommendation`);
    await click("Activate Codex");
    assert(await evaluate("document.activeElement.tagName === 'H3'"), "Activation did not focus setup heading");
    await click("Open official setup guide");
    assert(opened.at(-1) === "https://developers.openai.com/codex/cli", "Wrong broker URL");
    assert(await evaluate("document.querySelector('.local-agent-setup-detail').textContent.includes('Install the official Codex CLI')"), "Guide-opened incorrectly marked installed");
    await capture(`${name}-guidance`);
    await evaluate("window.__guideButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Open official setup guide'); window.__guideButton.focus()");
    current = { generation: 2, results: [{ agentId: "codex", status: "found" }, { agentId: "cursor", status: "not-found" }] };
    await evaluate("window.__launcherDiscoverySmoke.setDiscovery({ phase: 'ready', ids: ['codex'], completed: 2, refreshing: false, failed: false })");
    await until("document.querySelector('.local-agent-setup-detail').textContent.includes('CLI detected')");
    assert(await evaluate("document.activeElement === window.__guideButton && window.__guideButton.getAttribute('aria-disabled') === 'true'"), "Detection lost focus or allowed stale action");
    assert(await evaluate("Array.from(document.querySelectorAll('.desktop-terminal-launcher-tool')).some(button => button.textContent === 'Codex' && !button.disabled)"), "Detected Agent not usable");
    await capture(`${name}-detected`);
    await click("Close");
    assert(await evaluate("document.activeElement.textContent === 'Set up Agents'"), "Close did not restore focus");
    assert(await evaluate("!document.querySelector('.local-agent-setup-card')"), "A second recommendation replaced the first");
    await evaluate("document.querySelector('.desktop-terminal-launcher-shell').scrollIntoView({ block: 'nearest' })");
    assert(await evaluate("document.querySelector('.desktop-terminal-launcher-shell').getBoundingClientRect().bottom <= innerHeight"), "Terminal inaccessible at low height");
    window.destroy();
  }
  const sourceAfter = await readSourceIdentity(repo);
  assert(source.fingerprint === sourceAfter.fingerprint, "Source changed during smoke verification");
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: true, source, sourceAfter, results }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: results.length, artifacts }));
}
const watchdog = setTimeout(() => { console.error("Setup smoke timed out"); app.exit(1); }, 60_000);
app.whenReady().then(run).then(() => { clearTimeout(watchdog); service.dispose(); app.exit(0); }).catch(async (error) => {
  console.error(error); clearTimeout(watchdog);
  if (window && !window.isDestroyed()) await writeFile(path.join(artifacts, "failure.png"), (await window.capturePage()).toPNG()).catch(() => {});
  service.dispose(); app.exit(1);
});

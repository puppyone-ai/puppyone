#!/usr/bin/env electron
// Real Electron/IPC/UI, synthetic installation. Never touches user CLIs or login.
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLocalAgentSetupService } from "../../../../electron/main/local-agent-installation/setup/setup-service.mjs";
import { registerLocalAgentSetupIpcHandlers } from "../../../../electron/main/ipc/local-agent-setup-ipc.mjs";
import { createLocalAgentActivationService } from "../../../../electron/main/local-agent-activation/activation-service.mjs";
import { registerLocalAgentActivationIpcHandlers } from "../../../../electron/main/ipc/local-agent-activation-ipc.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = path.join(repo, "artifacts/tests/terminal/local-agent-setup");
const source = await readSourceIdentity(repo);
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-activation-smoke-")));
app.on("window-all-closed", () => {});
let window; let completeInstall; let installed = false;
let current = { generation: 1, results: [{ agentId: "codex", status: "not-found" }, { agentId: "cursor", status: "not-found" }] };
const evaluate = code => window.webContents.executeJavaScript(code, true);
const assert = (value, message) => { if (!value) throw new Error(message); };
const setup = createLocalAgentSetupService({
  installationService: { discover: async () => current, getSnapshot: () => current, isScanning: () => false },
  presenceService: { discover: async () => [{ companionId: "codex", status: "present" }, { companionId: "cursor", status: "present" }], dispose() {} },
  platform: "darwin", openExternal: async () => {},
});
registerLocalAgentSetupIpcHandlers({ ipcMain, setupService: setup });
const activation = createLocalAgentActivationService({
  registry: new Map(["codex", "cursor"].map(id => [id, { id, installationId: id, runtimeId: id, terminalRecipeId: id,
    displayName: id === "codex" ? "Codex" : "Cursor", publisher: "Fixture", recipe: { version: "fixture" } }])),
  resolveInstallation: async () => installed ? { file: "/fixture" } : null,
  createContext: async () => ({ run: async () => ({ code: 0, stdout: "fixture", stderr: "" }) }), journal: { read: async () => [], write: async () => {} }, openExternal: async () => {},
  installer: { install: async (_recipe, { signal, committed }) => {
    await new Promise((resolve, reject) => { completeInstall = resolve; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    signal.throwIfAborted(); installed = true; committed();
  } },
  refreshInstallations: async () => {
    current = { generation: current.generation + 1, results: [{ agentId: "codex", status: "found" }, { agentId: "cursor", status: "not-found" }] };
    if (window && !window.isDestroyed()) await evaluate(`window.__launcherDiscoverySmoke.setDiscovery({ phase:'ready', ids:['codex'], completed:${current.generation}, refreshing:false, failed:false })`);
  },
  publish: snapshot => { if (window && !window.isDestroyed()) window.webContents.send("local-agent-activation:changed", snapshot); },
});
registerLocalAgentActivationIpcHandlers({ ipcMain, service: activation });
const results = [];
async function until(code) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(code)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Unmet UI condition: ${code}`);
}
async function click(label) {
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.title === ${JSON.stringify(label)}).click()`);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
async function capture(name) {
  await evaluate("Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))");
  const metrics = await evaluate(`(() => {
    const panel = document.querySelector('.desktop-terminal-launcher');
    const row = document.querySelector('.local-agent-setup-row');
    const builtin = document.querySelector('.desktop-terminal-launcher-bundled');
    const dialog = document.querySelector('[role=dialog]');
    return { overflow: panel.scrollWidth > panel.clientWidth + 1 || (dialog && dialog.scrollWidth > dialog.clientWidth + 1),
      localFirst: row.getBoundingClientRect().bottom <= builtin.getBoundingClientRect().top,
      font: getComputedStyle(row).fontSize, builtinFont: getComputedStyle(builtin.querySelector('span:last-child')).fontSize,
      opacity: dialog ? getComputedStyle(dialog).opacity : null,
      overlay: dialog ? getComputedStyle(dialog).backgroundColor : null,
      dialogFits: !dialog || (dialog.getBoundingClientRect().top >= 0 && dialog.getBoundingClientRect().bottom <= innerHeight + 1) };
  })()`);
  assert(!metrics.overflow && metrics.localFirst && metrics.dialogFits, `${name}: overflow, order or dialog clipping`);
  assert(metrics.opacity === null || metrics.opacity === '1', `${name}: capture is not settled`);
  assert(metrics.font === metrics.builtinFont, `${name}: inconsistent row typography`);
  await writeFile(path.join(artifacts, `${name}.png`), (await window.capturePage()).toPNG()); results.push({ name, ...metrics });
}
async function run() {
  await mkdir(artifacts, { recursive: true });
  for (const variant of [{ theme: "light", width: 420, height: 760, rtl: false }, { theme: "dark", width: 280, height: 500, rtl: false }, { theme: "light", width: 280, height: 500, rtl: true }]) {
    installed = false;
    current = { generation: 1, results: [{ agentId: "codex", status: "not-found" }, { agentId: "cursor", status: "not-found" }] };
    window = new BrowserWindow({ show: true, width: variant.width + 100, height: variant.height,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
        preload: path.join(repo, "tests/fixtures/platform/local-agent-setup/preload.cjs") } });
    await window.loadURL(pathToFileURL(path.join(repo, "dist/index.html")).href + `?scenario=setup&agentMode=chat&theme=${variant.theme}&width=${variant.width}#terminal-launcher-visual-smoke`);
    await until("Boolean(window.__launcherDiscoverySmoke)");
    await evaluate(`document.documentElement.dir = ${JSON.stringify(variant.rtl ? "rtl" : "ltr")}`);
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await evaluate("window.__launcherDiscoverySmoke.setDiscovery({ phase:'ready', ids:[], completed:1, refreshing:false, failed:false })");
    await until("document.querySelectorAll('.local-agent-setup-row').length === 2");
    const name = `${variant.theme}-${variant.width}-${variant.rtl ? "rtl" : "ltr"}`;
    assert(await evaluate("!document.querySelector('.local-agent-setup-card') && !Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Set up Agents')"), "Extra launcher chrome");
    await capture(`${name}-rows`);
    await click("Activate Cursor Agent"); await until("!Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Install and activate').disabled");
    await capture(`${name}-cursor-confirm`); await click("Cancel");
    await click("Activate Codex"); await until("!Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Install and activate').disabled");
    await capture(`${name}-codex-confirm`); await click("Install and activate");
    await until("document.querySelector('[role=dialog] [role=status]')?.textContent === 'Installing…'"); await capture(`${name}-installing`);
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" }); window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until("!document.querySelector('[role=dialog]')");
    assert((await activation.read()).operations[0].status === "installing", "Escape cancelled background work");
    await click("Stop activating Codex"); await activation.settled(); await click("View Codex activation");
    await until("document.querySelector('[role=dialog] [role=status]')?.textContent === 'Stopped'"); await capture(`${name}-stopped`);
    await click("Try again"); await until("!Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Install and activate').disabled");
    await click("Install and activate"); await until("document.querySelector('[role=dialog] [role=status]')?.textContent === 'Installing…'"); completeInstall(); await activation.settled();
    await until("document.querySelector('[role=dialog] [role=status]')?.textContent === 'Activated'");
    await until("Array.from(document.querySelectorAll('.desktop-terminal-launcher-tool')).some(button => button.textContent === 'Codex' && !button.disabled)");
    assert(await evaluate("document.querySelectorAll('.local-agent-activation-steps li').length === 3 && !document.querySelector('button[aria-label=\"Activate Codex\"]') && !document.body.textContent.includes('Sign-in needed')"), "Installed CLI still requires activation or login");
    await capture(`${name}-ready`);
    // Footer dismisses the receipt; header/Escape only hides the view.
    await evaluate("Array.from(document.querySelectorAll('.desktop-dialog-footer button')).find(button => button.textContent === 'Close').click()");
    await until("!document.querySelector('[role=dialog]')");
    await until("Array.from(document.querySelectorAll('.desktop-terminal-launcher-tool')).some(button => button.textContent === 'Codex' && !button.disabled)");
    assert(await evaluate("!document.querySelector('[aria-label=\"Stop activating Codex\"]')"), "Completed operation left a stop control");
    await capture(`${name}-activated-launcher`);
    window.destroy();
  }
  const sourceAfter = await readSourceIdentity(repo); assert(source.fingerprint === sourceAfter.fingerprint, "Source changed during smoke verification");
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: true, source, sourceAfter, results }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: results.length, artifacts }));
}
const watchdog = setTimeout(() => { console.error("Activation smoke timed out"); app.exit(1); }, 60_000);
app.whenReady().then(run).then(() => { clearTimeout(watchdog); setup.dispose(); activation.dispose(); app.exit(0); }).catch(async error => {
  console.error(error); clearTimeout(watchdog);
  if (window && !window.isDestroyed()) await writeFile(path.join(artifacts, "failure.png"), (await window.capturePage()).toPNG()).catch(() => {});
  setup.dispose(); activation.dispose(); app.exit(1);
});

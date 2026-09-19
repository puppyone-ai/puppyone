#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = process.env.PUPPYONE_DISCOVERY_ARTIFACT_DIR || path.join(repo, "artifacts/tests/terminal/agent-discovery-feedback");
const source = await readSourceIdentity(repo);
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-discovery-profile-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
if (process.env.ELECTRON_DISABLE_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");
app.on("window-all-closed", () => {});
let window;
const results = [];
const assert = (value, message) => { if (!value) throw new Error(message); };
const evaluate = code => window.webContents.executeJavaScript(code, true);
const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
const buttons = 'Array.from(document.querySelectorAll(".desktop-terminal-launcher-tool"))';
const setState = state => evaluate(`window.__launcherDiscoverySmoke.setDiscovery(${JSON.stringify(state)})`).then(settle);
async function capture(name) {
  const bounds = await evaluate(`(() => {
    const panel = document.querySelector('.desktop-terminal-launcher');
    const rows = [...document.querySelectorAll('.desktop-terminal-launcher-tools > *')];
    return { overflow: panel.scrollWidth > panel.clientWidth + 1,
      outsideViewport: panel.getBoundingClientRect().left < 0 || panel.getBoundingClientRect().right > innerWidth + 1,
      clipped: rows.some(row => row.scrollWidth > row.clientWidth + 1),
      scrollable: panel.scrollHeight > panel.clientHeight,
      focus: document.activeElement?.textContent };
  })()`);
  assert(!bounds.overflow && !bounds.clipped && !bounds.outsideViewport, name + ": horizontal overflow");
  await writeFile(path.join(artifacts, name + ".png"), (await window.capturePage()).toPNG());
  results.push({ name, ...bounds });
}

async function run() {
  await mkdir(artifacts, { recursive: true });
  for (const variant of [
    { theme: "light", width: 420, height: 760, reduced: false, rtl: false },
    { theme: "dark", width: 280, height: 360, reduced: false, rtl: false },
    { theme: "light", width: 280, height: 500, reduced: true, rtl: true },
  ]) {
    const label = `${variant.theme}-${variant.width}-${variant.rtl ? "rtl-reduced" : "ltr"}`;
    window = new BrowserWindow({ show: true, width: variant.width + 100, height: variant.height,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadURL(pathToFileURL(path.join(repo, "dist/index.html")).href
      + `?scenario=discovery&agentMode=chat&theme=${variant.theme}&width=${variant.width}#terminal-launcher-visual-smoke`);
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: variant.reduced ? "reduce" : "no-preference" }],
    });
    for (let retry = 0; retry < 100; retry++) {
      if (await evaluate("Boolean(window.__launcherDiscoverySmoke && document.querySelector('.desktop-terminal-launcher-discovery'))")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(await evaluate("Boolean(window.__launcherDiscoverySmoke)"), "Fixture failed to mount");
    await evaluate(`document.documentElement.dir = ${JSON.stringify(variant.rtl ? "rtl" : "ltr")}`);
    await evaluate("document.fonts.ready");
    const brightness = await evaluate(`(() => {
      const color = getComputedStyle(document.querySelector('.desktop-terminal-launcher')).backgroundColor;
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return (r + g + b) / 3;
    })()`);
    assert(variant.theme === "dark" ? brightness < 100 : brightness > 180, label + ": wrong actual surface palette");
    assert(await evaluate(`${buttons}.map(button => button.textContent).join('|') === 'Built-in Agent'`), "Cold scan must retain Built-in Agent");
    assert(await evaluate("document.querySelectorAll('.desktop-terminal-launcher-discovery').length === 1"), "Missing scan feedback");
    assert(await evaluate("!document.querySelector('.desktop-terminal-launcher-discovery').closest('[role=list]')"), "Scan status masquerades as an Agent");
    assert(await evaluate("!document.querySelector('.desktop-terminal-launcher-discovery-count, .desktop-terminal-launcher-discovery .desktop-terminal-activity-grid')"), "Legacy counter or activity grid remains");
    assert(await evaluate("document.querySelector('.desktop-terminal-launcher-discovery').getBoundingClientRect().height < 25"), "Cold scan feedback is not compact");
    assert(await evaluate("!document.querySelector('.local-agent-setup')"), "Empty launcher has setup chrome");
    await capture(label + "-cold");
    const scanning = { phase: "loading", ids: ["codex"], completed: 1, refreshing: false, failed: false };
    await setState(scanning);
    await evaluate(`window.__focusedAgent = ${buttons}.find(button => button.textContent === 'Codex'); window.__focusedAgent.focus()`);
    await setState({ ...scanning, ids: ["codex", "claude"], completed: 2 });
    assert(await evaluate("document.activeElement === window.__focusedAgent && !window.__focusedAgent.disabled"), "Incremental result lost focus or was disabled");
    assert(await evaluate(`${buttons}.map(button => button.textContent).join('|') === 'Claude Code|Codex|Built-in Agent'`), "Unstable display order");
    assert(await evaluate("document.querySelector('[role=status]').textContent === 'Checking local agents…'"), "Progress counts should not churn live announcements");
    if (variant.reduced) assert(await evaluate("Array.from(document.querySelectorAll('.desktop-terminal-launcher-discovered, .desktop-terminal-launcher-discovery-spinner')).every(node => getComputedStyle(node).animationName === 'none')"), "Reduced motion still animates");
    await capture(label + "-incremental");
    window.focus();
    window.webContents.focus();
    await settle();
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await settle();
    assert(await evaluate("document.querySelector('output').textContent === 'chat:codex'"), "Found Agent cannot launch while other detections are pending");
    const ids = ["codex", "claude", "cursor", "hermes", "opencode", "pi", "workbuddy-china", "workbuddy-international"];
    await setState({ ...scanning, phase: "ready", ids, completed: 8 });
    assert(await evaluate("!document.querySelector('.desktop-terminal-launcher-discovery')"), "Feedback survived completion");
    await capture(label + "-complete");
    await evaluate("document.querySelector('.desktop-terminal-launcher-shell').scrollIntoView({ block: 'nearest' })");
    assert(await evaluate(`(() => {
      const panel = document.querySelector('.desktop-terminal-launcher').getBoundingClientRect();
      const shell = document.querySelector('.desktop-terminal-launcher-shell').getBoundingClientRect();
      return shell.top >= panel.top && shell.bottom <= panel.bottom + 1;
    })()`), label + ": low-height list cannot reach Terminal");
    await capture(label + "-complete-bottom");
    await evaluate("document.querySelector('.desktop-terminal-launcher-scan').click()");
    for (let retry = 0; retry < 20; retry++) {
      if (await evaluate("Boolean(document.querySelector('.desktop-terminal-launcher-discovery'))")) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(await evaluate(`${buttons}.filter(button => !button.disabled).length === 9`), "Refresh cleared or disabled usable rows");
    assert(await evaluate("document.querySelector('.desktop-terminal-launcher-discovery').textContent === 'Refreshing agents…'"), "Missing refresh semantics");
    await setState({ ...scanning, phase: "ready", ids, failed: true });
    assert(await evaluate("document.querySelector('.desktop-terminal-launcher-discovery').textContent.includes('Scan again')"), "Missing retry feedback");
    await evaluate("document.querySelector('.desktop-terminal-launcher-discovery').scrollIntoView({ block: 'nearest' })");
    await capture(label + "-partial-failure");
    await setState({ ...scanning, phase: "ready", ids: [], completed: 8 });
    assert(await evaluate("document.querySelector('.desktop-terminal-launcher-discovery').textContent === 'No Agent CLIs found'"), "Missing definitive empty state");
    await capture(label + "-empty");
    window.destroy();
  }
  const sourceAfter = await readSourceIdentity(repo);
  assert(source.fingerprint === sourceAfter.fingerprint, "Source changed during visual verification");
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: true, source, sourceAfter, results }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, artifacts }));
}
const watchdog = setTimeout(() => { console.error("Agent discovery visual verification timed out"); app.exit(1); }, 60_000);
app.whenReady().then(run).then(() => { clearTimeout(watchdog); app.exit(0); }).catch(async error => {
  clearTimeout(watchdog);
  console.error(error);
  if (window && !window.isDestroyed()) {
    await writeFile(path.join(artifacts, "failure.png"), (await window.capturePage()).toPNG()).catch(() => {});
    window.destroy();
  }
  app.exit(1);
});

#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = process.env.PUPPYONE_AUXILIARY_ARTIFACT_DIR
  ? path.resolve(repo, process.env.PUPPYONE_AUXILIARY_ARTIFACT_DIR)
  : await mkdtemp(path.join(os.tmpdir(), "puppyone-auxiliary-appearance-"));
app.setPath("userData", path.join(artifacts, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
if (process.env.ELECTRON_DISABLE_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");
app.on("window-all-closed", () => {});
let window;
const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const evaluate = code => window.webContents.executeJavaScript(code, true);
const settle = async () => {
  await evaluate("document.fonts.ready");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await evaluate('Promise.allSettled(document.querySelector(".desktop-right-sidebar").getAnimations().map(animation => animation.finished))');
  await new Promise(resolve => setTimeout(resolve, 250));
};
async function snapshot() {
  return evaluate(`(() => {
    const api = window.__auxiliaryAppearanceSmoke;
    const session = document.querySelector(".desktop-terminal-session");
    const prompt = document.querySelector(".desktop-agent-prompt-editor .cm-editor");
    const content = prompt.querySelector(".cm-content");
    const composer = document.querySelector(".desktop-agent-composer");
    const chat = document.querySelector(".desktop-agent-boundary");
    const sidebar = document.querySelector(".desktop-right-sidebar");
    const rgb = value => {
      const context = document.createElement("canvas").getContext("2d");
      context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    const rect = session.getBoundingClientRect();
    return {
      count: api.creations.length,
      initial: api.creations[0].defaultColors.background,
      latest: api.updates.at(-1)?.defaultColors.background,
      background: rgb(getComputedStyle(session).backgroundColor),
      sidebar: rgb(getComputedStyle(sidebar).backgroundColor),
      sidebarWidth: sidebar.getBoundingClientRect().width,
      chat: getComputedStyle(chat).backgroundColor,
      promptBackground: getComputedStyle(prompt).backgroundColor,
      font: getComputedStyle(prompt).fontSize,
      padding: getComputedStyle(content).paddingLeft,
      draft: content.textContent,
      overflow: composer.getBoundingClientRect().right > sidebar.getBoundingClientRect().right + 1,
      sample: { x: Math.round(rect.left + 4), y: Math.round(rect.top + 4) },
      screen: (() => { const r = session.querySelector(".xterm-screen").getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.floor(r.width), height: Math.min(70, Math.floor(r.height)) }; })()
    };
  })()`);
}
async function run() {
  await mkdir(artifacts, { recursive: true });
  console.log("Auxiliary appearance artifacts:", artifacts);
  for (const theme of ["light", "dark", "windows-xp"]) {
    window = new BrowserWindow({ show: true, width: 960, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) console.error(message); });
    await window.loadURL(pathToFileURL(path.join(repo, "dist/index.html")).href + "?theme=" + theme + "#auxiliary-appearance-smoke");
    for (let i = 0; i < 100; i++) {
      if (await evaluate("Boolean(window.__auxiliaryAppearanceSmoke)")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(await evaluate("Boolean(window.__auxiliaryAppearanceSmoke)"), theme + ": fixture did not start");
    assert(await evaluate(`(() => {
      const bootstrap = document.querySelector('style[data-po-style-cascade]');
      return bootstrap?.textContent.startsWith('@layer reset, fallback, tokens, primitives, patterns, features,')
        && Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every(link =>
          bootstrap.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
    })()`), "Extracted CSS precedes the canonical cascade registration");
    await evaluate("window.__auxiliaryAppearanceSmoke.split()");
    await settle();
    for (const width of [560, 320]) {
      await evaluate("window.__auxiliaryAppearanceSmoke.setWidth(" + width + ")");
      await settle();
      const value = await snapshot();
      assert(Math.abs(value.sidebarWidth - width) < 1, theme + ": expected sidebar width " + width + ", received " + value.sidebarWidth);
      assert(JSON.stringify(value.initial) === JSON.stringify(value.background), theme + ": initial PTY and displayed background disagree");
      assert(JSON.stringify(value.sidebar) === JSON.stringify(value.background), theme + ": terminal padding differs from workbench");
      assert(value.promptBackground === "rgba(0, 0, 0, 0)", theme + ": prompt editor paints its own background");
      assert(value.font === "14px" && value.padding === "16px", theme + ": CodeMirror defaults defeated adapter metrics");
      assert(!value.overflow, theme + ": composer overflows narrow surface");
      assert(await evaluate('getComputedStyle(document.querySelector(".desktop-terminal-xterm")).visibility === "visible"'), theme + ": terminal content is hidden");
      const capture = await window.capturePage();
      assert(!capture.isEmpty(), "Empty screenshot");
      const viewport = await evaluate("({ width: innerWidth, height: innerHeight })");
      const scale = capture.getSize().width / viewport.width;
      const sample = capture.crop({ x: Math.round(value.sample.x * scale), y: Math.round(value.sample.y * scale), width: 1, height: 1 }).toBitmap();
      const debug = await evaluate('Array.from(document.querySelectorAll(".desktop-terminal-session, .desktop-terminal-xterm, .xterm-screen")).map(e => ({ class: e.className, rect: e.getBoundingClientRect().toJSON(), visibility: getComputedStyle(e).visibility, background: getComputedStyle(e).backgroundColor }))');
      await writeFile(path.join(artifacts, "latest.json"), JSON.stringify({ value, debug, scale, sample: Array.from(sample) }, null, 2));
      // macOS color-managed screenshots can differ from sRGB CSS by a few channel levels.
      assert([sample[2], sample[1], sample[0]].every((channel, index) => Math.abs(channel - value.background[index]) <= 4), theme + ": painted terminal padding disagrees");
      const screen = capture.crop(Object.fromEntries(Object.entries(value.screen).map(([key, value]) => [key, Math.round(value * scale)]))).toBitmap();
      const colors = new Set();
      for (let i = 0; i < screen.length; i += 4) colors.add(screen[i] + ":" + screen[i + 1] + ":" + screen[i + 2]);
      assert(colors.size > 4, theme + ": xterm output is blank");
      await writeFile(path.join(artifacts, theme + "-" + width + ".png"), capture.toPNG());
      results.push({ theme, width, ...value, screenColors: colors.size });
    }
    await evaluate('document.querySelector(".auxiliary-smoke-chat > .desktop-agent-picker .desktop-agent-picker-trigger").click()');
    await settle();
    assert(await evaluate('Boolean(document.querySelector(".desktop-agent-overlay"))'), "Picker did not open through themed portal");
    await evaluate('window.__auxiliaryAppearanceSmoke.setActive(false)');
    await evaluate('window.__auxiliaryAppearanceSmoke.setTheme("' + (theme === "dark" ? "light" : "dark") + '")');
    await settle();
    const changed = await snapshot();
    assert(changed.count === 1, "Theme change restarted the PTY");
    assert(JSON.stringify(changed.background) !== JSON.stringify(results.at(-1).background), "Fixture did not change the actual background");
    assert(changed.draft === "Draft survives theme changes", "Theme change replaced the draft");
    assert(JSON.stringify(changed.latest) === JSON.stringify(changed.background), "Hidden runtime missed appearance revision: " + JSON.stringify(changed));
    assert(await evaluate('document.querySelector("#desktop-overlay-root").dataset.subThemeId === document.querySelector("main").dataset.subThemeId'), "Portal lost owning theme");
    await evaluate('window.__auxiliaryAppearanceSmoke.setActive(true)');
    await settle();
    await writeFile(path.join(artifacts, theme + "-switched.png"), (await window.capturePage()).toPNG());
    await evaluate('window.__auxiliaryAppearanceSmoke.activate("terminal")');
    await settle();
    window.focus();
    await evaluate('document.querySelector(".xterm-helper-textarea").focus()');
    window.webContents.sendInputEvent({ type: "char", keyCode: "x" });
    await settle();
    assert(await evaluate('window.__auxiliaryAppearanceSmoke.input.text.includes("x")'), "Terminal no longer accepts input");
    await evaluate('window.__auxiliaryAppearanceSmoke.newTerminal()');
    await settle();
    assert(await evaluate('JSON.stringify(window.__auxiliaryAppearanceSmoke.creations.at(-1).defaultColors.background) === JSON.stringify(window.__auxiliaryAppearanceSmoke.updates.at(-1).defaultColors.background)'), "New terminal used an old appearance snapshot");
    window.destroy();
  }
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, artifacts }));
}
app.whenReady().then(run).then(() => app.exit(0)).catch(async error => {
  console.error(error);
  if (window && !window.isDestroyed()) {
    try {
      await writeFile(path.join(artifacts, "failure.png"), (await window.capturePage()).toPNG());
      window.destroy();
    } catch { /* The renderer may already have exited. */ }
  }
  app.exit(1);
});

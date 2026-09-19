#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { compileThemeCss } from "../../../../electron/main/themes/theme-css-compiler.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "puppyone-selection-"));
const artifacts = process.env.PUPPYONE_TEXT_SELECTION_ARTIFACT_DIR
  ?? path.join(root, "artifacts/tests/appearance/text-selection", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "user-data"));
app.on("window-all-closed", () => {});
let server;
let window;
let exitCode = 0;
const errors = [];
const source = await readSourceIdentity(root);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function run() {
try {
  server = await createServer({ root, cacheDir: path.join(temporary, "vite-cache"), logLevel: "error",
    optimizeDeps: { entries: ["tests/fixtures/appearance/themes/text-selection.html"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  });
  await server.listen();
  window = new BrowserWindow({ show: true, width: 1200, height: 950, webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true } });
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  app.focus({ steal: true }); window.focus();
  await window.loadURL(`${server.resolvedUrls.local[0]}tests/fixtures/appearance/themes/text-selection.html`);
  let ready = false;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await evaluate("window.selectionFixture?.ready()")) { ready = true; break; }
    await wait(50);
  }
  assert(ready, `Fixture did not mount: ${errors.join("\n")}`);
  window.webContents.debugger.attach("1.3");
  // Keep active-state assertions deterministic when other workbench windows run.
  await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  const id = "com.example.selection";
  const compiledCss = {};
  for (const [target, css] of Object.entries({
    application: ":root { --po-text-selection-bg: rgba(20, 130, 80, .32); --po-terminal-selection: rgba(20, 130, 80, .45) }",
    markdown: ":root { --po-md-selection-bg: rgba(160, 90, 190, .3) }",
    csv: ":root { --po-csv-selection-bg: rgba(190, 120, 20, .3) }",
  })) compiledCss[target] = (await compileThemeCss({ css, target, themeId: id })).css;
  const custom = { id, name: "Selection contract", family: id, version: "1.0.0", contractVersion: 1, source: "installed", compatibleRootThemeIds: ["default"], targets: Object.keys(compiledCss), variants: { light: { compiledCss } } };
  const matrix = await evaluate(`window.selectionFixture.matrix(${JSON.stringify(custom)})`);
  await writeFile(path.join(artifacts, "custom-selection.png"), (await window.webContents.capturePage()).toPNG());
  const { from, to } = await evaluate("window.selectionFixture.prepareDrag()");
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * step / 8, y: from.y, button: "left", buttons: 1 });
  }
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
  await wait(80);
  const drag = await evaluate("window.selectionFixture.dragResult()");
  assert(drag.text.length >= 8, `Native mouse drag did not select text: ${JSON.stringify(drag)}`);
  assert.equal(drag.changes, 0, "Appearance or selection edited source");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right", modifiers: ["shift"] });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Right", modifiers: ["shift"] });
  await wait(80);
  const keyboard = await evaluate("window.selectionFixture.dragResult()");
  assert(keyboard.text.length > drag.text.length, "Shift+Arrow did not extend selection");
  await writeFile(path.join(artifacts, "mouse-selection.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  await wait(100);
  const forced = await evaluate("window.selectionFixture.forced()");
  await writeFile(path.join(artifacts, "forced-colors.png"), (await window.webContents.capturePage()).toPNG());
  const sourceAfter = await readSourceIdentity(root);
  assert.equal(source.fingerprint, sourceAfter.fingerprint, "Source changed during smoke");
  assert.deepEqual(errors, [], "Renderer logged errors");
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify({ source, sourceAfter, matrix, drag, keyboard, forced }, null, 2));
  console.log(`Text selection: ${matrix.length} theme/mode passes, native drag, forced colors. Evidence: ${artifacts}`);
} catch (error) {
  if (window && !window.isDestroyed()) {
    await writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG());
    console.error(await evaluate("({focus:document.hasFocus(),body:document.body.innerText.slice(0,1000)})"));
  }
  console.error(error, errors); exitCode = 1;
} finally {
  window?.destroy(); await server?.close();
  await rm(temporary, { recursive: true, force: true });
  app.exit(exitCode);
}
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });

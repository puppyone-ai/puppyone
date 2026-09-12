#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const statusPath = process.env.PUPPYONE_AGENT_RENDER_STABILITY_STATUS_PATH || null;
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-render-stability-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");

let ownerWindow = null;
let renderProcessFailure = null;
let unresponsive = false;

async function runSmoke() {
  await fsp.access(indexPath);
  ownerWindow = new BrowserWindow({
    // Real-frame and native-input checks need a mapped window. CI presents it
    // inside Xvfb; a never-shown Linux window can advance rAF at a reduced rate.
    show: true,
    width: 960,
    height: 800,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  ownerWindow.webContents.on("render-process-gone", (_event, details) => {
    renderProcessFailure = `${details.reason}:${details.exitCode}`;
  });
  ownerWindow.on("unresponsive", () => { unresponsive = true; });
  await ownerWindow.loadURL(`${pathToFileURL(indexPath).toString()}#agent-render-stability-smoke`);
  const result = await pollForResult(ownerWindow);
  console.log("Agent render stability renderer result:", JSON.stringify(result, null, 2));
  if (renderProcessFailure) throw new Error(`Agent render smoke renderer exited: ${renderProcessFailure}`);
  if (unresponsive) throw new Error("Agent render smoke renderer became unresponsive.");
  const artifactRoot = process.env.PUPPYONE_AGENT_RENDER_ARTIFACT_DIR || path.join(repoRoot, "artifacts/tests/agent/render-stability");
  if (artifactRoot) {
    await fsp.mkdir(artifactRoot, { recursive: true });
    await fsp.writeFile(path.join(artifactRoot, "result.json"), JSON.stringify(result, null, 2));
    await fsp.writeFile(path.join(artifactRoot, "render.png"), (await ownerWindow.webContents.capturePage()).toPNG());
  }
  if (!result.passed || result.error) throw new Error(result.error || "Agent render stability smoke failed.");
  if (result.errors.length) throw new Error(result.errors.join(" | "));
  console.log(JSON.stringify({
    schema: "puppyone-agent-render-stability/v1",
    platform: process.platform,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    ...result,
  }, null, 2));
}

async function pollForResult(window) {
  let lastInputId = 0;
  // The 27-case matrix measures more than 1,500 real animation frames. A 30s
  // deadline depends on the host refresh rate and is too short for 60Hz CI.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (renderProcessFailure) throw new Error(`Agent render smoke renderer exited: ${renderProcessFailure}`);
    const { result, input } = await window.webContents.executeJavaScript(
      "({ result: window.__PUPPYONE_AGENT_RENDER_STABILITY_SMOKE_RESULT__ || null, input: window.__PUPPYONE_AGENT_RENDER_INPUT__ || null })",
      true,
    );
    if (result) return result;
    if (input && Number.isInteger(input.id) && input.id > lastInputId) {
      lastInputId = input.id;
      // Electron requires a focused owner for sendInputEvent. All input still
      // targets only this isolated test WebContents, never another application.
      window.focus();
      window.webContents.focus();
      if (input.type === "wheel") {
        window.webContents.sendInputEvent({ type: "mouseWheel", x: input.x, y: input.y,
          deltaY: input.deltaY, deltaX: 0, hasPreciseScrollingDeltas: true });
      } else if (input.type === "move") {
        window.webContents.sendInputEvent({ type: "mouseMove", x: input.x, y: input.y });
      } else if (input.type === "key" && input.keyCode === "PageUp") {
        window.webContents.focus();
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: input.keyCode });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: input.keyCode });
      } else throw new Error("Unsupported renderer smoke input");
      await window.webContents.executeJavaScript(`window.__PUPPYONE_AGENT_RENDER_INPUT_ACK__ = ${lastInputId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const progress = await window.webContents.executeJavaScript(
    "window.__PUPPYONE_AGENT_RENDER_STABILITY_SMOKE_PROGRESS__ || null",
  );
  throw new Error(`Agent render stability smoke exceeded 90 seconds; last progress: ${JSON.stringify(progress)}.`);
}

async function finish(exitCode, error = null) {
  const artifactRoot = process.env.PUPPYONE_AGENT_RENDER_ARTIFACT_DIR || path.join(repoRoot, "artifacts/tests/agent/render-stability");
  if (error && artifactRoot && ownerWindow && !ownerWindow.isDestroyed()) {
    try {
      await fsp.mkdir(artifactRoot, { recursive: true });
      const diagnostics = await ownerWindow.webContents.executeJavaScript(`({
        progress: window.__PUPPYONE_AGENT_RENDER_STABILITY_SMOKE_PROGRESS__ || null,
        result: window.__PUPPYONE_AGENT_RENDER_STABILITY_SMOKE_RESULT__ || null,
        visibility: document.visibilityState,
        readyState: document.readyState,
        text: document.body.innerText.slice(0, 3000)
      })`);
      await fsp.writeFile(path.join(artifactRoot, "failure.json"), JSON.stringify({
        error: String(error?.stack || error), renderProcessFailure, unresponsive, ...diagnostics,
      }, null, 2));
      await fsp.writeFile(path.join(artifactRoot, "failure.png"), (await ownerWindow.webContents.capturePage()).toPNG());
    } catch (captureError) { console.error("Could not retain Agent smoke failure evidence:", captureError); }
  }
  if (statusPath) {
    await fsp.writeFile(statusPath, `${JSON.stringify({
      exitCode,
      error: error instanceof Error ? error.stack || error.message : error ? String(error) : null,
    })}\n`, "utf8");
  }
  ownerWindow?.destroy();
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1, error);
});

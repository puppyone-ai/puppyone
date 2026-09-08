#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const statusPath = process.env.PUPPYONE_AGENT_TOOL_STABILITY_STATUS_PATH || null;
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-tool-stability-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");

let ownerWindow = null;
let renderProcessFailure = null;
let unresponsive = false;

async function runSmoke() {
  await fsp.access(indexPath);
  ownerWindow = new BrowserWindow({
    // Frame measurements require a mapped compositor surface (Xvfb in CI).
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
  await ownerWindow.loadURL(`${pathToFileURL(indexPath).toString()}#agent-tool-stability-smoke`);
  const result = await pollForResult(ownerWindow);
  console.log("Agent tool stability renderer result:", JSON.stringify(result, null, 2));
  if (renderProcessFailure) throw new Error(`Agent tool smoke renderer exited: ${renderProcessFailure}`);
  if (unresponsive) throw new Error("Agent tool smoke renderer became unresponsive.");
  const artifactRoot = process.env.PUPPYONE_AGENT_TOOL_ARTIFACT_DIR;
  if (artifactRoot) {
    await fsp.mkdir(artifactRoot, { recursive: true });
    await fsp.writeFile(path.join(artifactRoot, "result.json"), JSON.stringify(result, null, 2));
    await fsp.writeFile(path.join(artifactRoot, "render.png"), (await ownerWindow.webContents.capturePage()).toPNG());
  }
  if (!result.passed || result.error) throw new Error(result.error || "Agent tool stability smoke failed.");
  if (result.uncaughtErrors.length > 0) throw new Error(`Uncaught renderer errors: ${result.uncaughtErrors.join(" | ")}`);
  if (result.longTasks.some((duration) => duration > 250)) {
    throw new Error(`Agent tool disclosure produced a long task over 250ms: ${Math.max(...result.longTasks)}ms.`);
  }
  console.log(JSON.stringify({
    schema: "puppyone-agent-tool-stability/v1",
    platform: process.platform,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    ...result,
  }, null, 2));
}

async function pollForResult(window) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (renderProcessFailure) throw new Error(`Agent tool smoke renderer exited: ${renderProcessFailure}`);
    const result = await window.webContents.executeJavaScript(
      "window.__PUPPYONE_AGENT_TOOL_STABILITY_SMOKE_RESULT__ || null",
      true,
    );
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Agent tool stability smoke did not publish a result within 30 seconds.");
}

async function finish(exitCode, error = null) {
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

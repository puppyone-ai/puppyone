#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-markdown-line-geometry-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-gpu");

let window = null;

async function runSmoke() {
  await fsp.access(indexPath);
  window = new BrowserWindow({
    show: false,
    width: 900,
    height: 620,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(
    `${pathToFileURL(indexPath).toString()}#markdown-line-geometry-smoke`,
  );

  const result = await pollForResult(window);
  if ("error" in result) throw new Error(result.error);
  if (result.ok !== true || !result.presentation || result.scenarios.length !== 3) {
    throw new Error("Markdown line-geometry smoke returned an incomplete result.");
  }
  console.log(JSON.stringify(result, null, 2));
}

async function pollForResult(ownerWindow) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await ownerWindow.webContents.executeJavaScript(
      "window.__PUPPYONE_MARKDOWN_LINE_GEOMETRY_SMOKE_RESULT__ || null",
      true,
    );
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Markdown line-geometry smoke did not publish a result within 20 seconds.");
}

async function finish(exitCode) {
  window?.destroy();
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1);
});

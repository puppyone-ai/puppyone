#!/usr/bin/env electron
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { createServer } from "vite";
import { createWorkspaceResourceResolver } from "../../../../electron/main/workspace-resource-resolver.mjs";
import { createSenderWorkspaceAuthorization } from "../../../../electron/main/workspace-authorization.mjs";
import { loadMacosResourceDrag } from "../../../../electron/main/platform/macos/resource-drag.mjs";
import { registerResourceTransferIpcHandlers } from "../../../../electron/main/ipc/resource-transfer-ipc.mjs";

// Manual OS smoke: drag the three source rows to the other native window, Finder
// or Terminal. The separate receiver records genuine native File objects.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "puppyone-resource-smoke-"));
const editorMode = process.argv.includes("--editor");
app.setPath("userData", path.join(temporaryRoot, "user-data"));
app.whenReady().then(async () => {
  await fs.mkdir(path.join(temporaryRoot, "docs"));
  await fs.writeFile(path.join(temporaryRoot, "docs", "中文 file.md"), "native drag fixture\n");
  await fs.writeFile(path.join(temporaryRoot, "existing.md"), "# Existing document\n\nDrag the Explorer file into this pane to split it.\n");
  const workspacePath = await fs.realpath(temporaryRoot);
  const folders = [{ path: workspacePath, workspace: { id: "smoke-root", workspaceInstanceId: "smoke-root", name: "Smoke project" } }];
  const windows = [];
  const authorizeWorkspaceRoot = createSenderWorkspaceAuthorization({ getWorkspaceRootsForSender: () => [workspacePath] });
  const resolver = createWorkspaceResourceResolver({ getFoldersForSender: () => folders, authorizeWorkspaceRoot });
  const nativeApi = loadMacosResourceDrag();
  const nativeDrag = Object.fromEntries(["captureGesture", "start", "inspect", "windowNumber"].map((name) => [name, (...args) => {
    const result = nativeApi[name](...args);
    if (editorMode && ["captureGesture", "start"].includes(name)) console.log(JSON.stringify({ nativeStep: name, result }));
    return result;
  }]));
  const transfer = registerResourceTransferIpcHandlers({ ipcMain, resolveWorkspaceResource: resolver, nativeDrag, getWindow: (sender) => BrowserWindow.fromWebContents(sender) });
  app.once("will-quit", () => transfer.dispose());
  const log = async (entry) => {
    console.log(JSON.stringify(entry));
    await fs.appendFile(path.join(temporaryRoot, "events.jsonl"), JSON.stringify(entry) + "\n");
  };
  ipcMain.handle("resource-smoke:config", () => ({ workspacePath }));
  ipcMain.handle("resource-smoke:read", async (event, resource) => {
    const resolved = await resolver(event, resource);
    return { path: resource, name: path.basename(resolved.absolutePath), type: "markdown", mimeType: "text/markdown",
      content: await fs.readFile(resolved.absolutePath, "utf8"), version: "smoke" };
  });
  ipcMain.on("resource-smoke:event", (_event, entry) => { void log(entry); });
  const server = await createServer({ root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), server: { port: 5187, strictPort: true, host: "127.0.0.1" } });
  await server.listen();
  for (const [index, mode] of (editorMode ? ["editor"] : ["source", "receiver"]).entries()) {
    const window = new BrowserWindow({
      title: `Resource transfer smoke — ${mode}`,
      alwaysOnTop: true,
      x: 80 + index * 500, y: 100, width: editorMode ? 1120 : 460, height: editorMode ? 700 : 520,
      webPreferences: { preload: path.join(repoRoot, "tests/fixtures/platform/drag-drop/resource-transfer-preload.cjs"), contextIsolation: true, sandbox: true },
    });
    windows.push(window);
    window.webContents.on("console-message", (_event, _level, message) => { console.log(message); });
    await window.loadURL(`http://127.0.0.1:5187/tests/fixtures/platform/drag-drop/${editorMode ? "editor-resource-drop" : "resource-transfer"}.html?mode=${mode}`);
  }
  app.focus({ steal: true });
  console.log(`RESOURCE_SMOKE_READY ${temporaryRoot}`);
  app.on("window-all-closed", () => { void server.close().then(() => app.quit()); });
}).catch((error) => { console.error(error); app.exit(1); });

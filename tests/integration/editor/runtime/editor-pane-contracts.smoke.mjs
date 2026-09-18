#!/usr/bin/env electron
import assert from "node:assert/strict";
import * as fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { createServer } from "vite";
import { registerWorkspaceFileIpcHandlers } from "../../../../electron/main/ipc/workspace-files-ipc.mjs";
import { registerLocalFileProtocol } from "../../../../electron/main/local-file-protocol.mjs";
import { buildLocalFileCapabilityUrl, createLocalFileCapabilityStore } from "../../../../electron/main/local-file-capabilities.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";

protocol.registerSchemesAsPrivileged([{
  scheme: "puppyone-local",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-pane-contracts-"));
const workspaceRoot = path.join(temporary, "workspace");
await fsp.mkdir(workspaceRoot);
const canonicalWorkspaceRoot = await fsp.realpath(workspaceRoot);
const pdfFixtureName = "sample_document.pdf";
await fsp.copyFile(
  path.join(repoRoot, "tests/fixtures/editor/formats/samples", pdfFixtureName),
  path.join(workspaceRoot, pdfFixtureName),
);
const artifactBase = path.join(repoRoot, "artifacts/tests/editor/pane-contracts");
await fsp.mkdir(artifactBase, { recursive: true });
const outputDirectory = process.env.PUPPYONE_PANE_CONTRACT_ARTIFACT_DIR
  ? path.resolve(process.env.PUPPYONE_PANE_CONTRACT_ARTIFACT_DIR)
  : await fsp.mkdtemp(path.join(artifactBase, `${new Date().toISOString().replaceAll(":", "-")}-`));
await fsp.mkdir(outputDirectory, { recursive: true });
const source = await readSourceIdentity(repoRoot);
const rows = [];
const caseArgument = process.argv.indexOf("--case");
const caseId = caseArgument < 0 ? null : process.argv[caseArgument + 1];
let window, vite, appServer;
let destroyed = 0;
const localFileCapabilities = createLocalFileCapabilityStore();
app.setPath("userData", path.join(temporary, "user-data"));
app.on("window-all-closed", () => {});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pdfReady(contents) {
  const frames = [...contents.mainFrame.frames];
  while (frames.length) {
    const frame = frames.shift();
    if (frame.url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/")) {
      try { return await frame.executeJavaScript("Boolean(document.querySelector('pdf-viewer')?.documentDimensions?.pageDimensions?.length)"); }
      catch { return false; } // PDF OOPIF can be replaced while committing navigation.
    }
    frames.push(...frame.frames);
  }
  return false;
}

function pdfFrameCount(contents) {
  const frames = [...contents.mainFrame.frames];
  let count = 0;
  while (frames.length) {
    const frame = frames.shift();
    if (frame.url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/")) count++;
    frames.push(...frame.frames);
  }
  return count;
}

async function waitForPdfClosed(contents) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (pdfFrameCount(contents) === 0) return;
    await wait(100);
  }
  throw new Error("Closed PDF retained a Chromium Viewer frame.");
}

app.whenReady().then(async () => {
let failed = false;
let failure = null;
const deadline = setTimeout(() => {
  const failure = "Pane contracts exceeded 240 seconds";
  console.error(failure);
  void fsp.writeFile(path.join(outputDirectory, "result.json"), JSON.stringify({ passed: false, source, results: rows, failure }, null, 2))
    .finally(() => process.exit(1));
}, 240_000);
try {
  const appHtml = await fsp.readFile(path.join(repoRoot, "tests/fixtures/editor/runtime/pane-frame.html"));
  appServer = createHttpServer((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end(appHtml); });
  await new Promise(resolve => appServer.listen(0, "127.0.0.1", resolve));
  const appUrl = `http://127.0.0.1:${appServer.address().port}/`;
  ipcMain.handle("pane-contracts:config", (event) => {
    const token = localFileCapabilities.issue({
      senderId: event.sender.id,
      rootPath: workspaceRoot,
      relativePath: pdfFixtureName,
      purpose: "file-preview",
      reuse: true,
    });
    return {
      appUrl,
      caseId,
      pdfUrl: buildLocalFileCapabilityUrl({ relativePath: pdfFixtureName, token }),
    };
  });
  ipcMain.handle("pane-contracts:capture", async (_event, id) => {
    assert(/^[a-z-]+-(horizontal|vertical)$/.test(id));
    if (id.startsWith("app-")) {
      const frame = window.webContents.mainFrame.frames.find(frame => frame.url === appUrl);
      assert(frame, "App frame never navigated to its separate origin");
      assert((await frame.executeJavaScript("document.body.textContent")).includes("Pane app rendered"));
    }
    if (id.startsWith("pdf-")) {
      assert(await pdfReady(window.webContents), "DOM PDF did not expose Chromium's ready Viewer frame");
    }
    await fsp.writeFile(path.join(outputDirectory, `${id}.png`), (await window.webContents.capturePage()).toPNG());
  });
  ipcMain.handle("pane-contracts:verifyClosed", async (_event, id) => {
    assert(/^pdf-(horizontal|vertical)$/.test(id));
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.pdf-preview-frame') === null"), true);
    await waitForPdfClosed(window.webContents);
    destroyed++;
  });
  const handlers = new Map();
  registerWorkspaceFileIpcHandlers({ app, fs, BrowserWindow, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {}, shell: {}, localFileCapabilities,
    authorizeWorkspaceRoot: async (event, root) => {
      assert.equal(event.sender, window.webContents); assert.equal(root, workspaceRoot); return workspaceRoot;
    },
  });
  ipcMain.handle("pane-contracts:seed", async (_event, files) => {
    for (const [name, content] of Object.entries(files)) {
      assert.equal(path.basename(name), name); await fsp.writeFile(path.join(workspaceRoot, name), content);
    }
  });
  ipcMain.handle("pane-contracts:read", (event, resource) => handlers.get("workspace:read-file")(event, { rootPath: workspaceRoot, path: resource }));
  ipcMain.handle("pane-contracts:persist", (event, request) => handlers.get("workspace:write-file")(event,
    { rootPath: workspaceRoot, path: request.path, content: request.content, expectedVersion: request.baseVersion }));
  ipcMain.handle("pane-contracts:input", async (_event, request) => {
    window.focus();
    window.webContents.focus();
    const splitterFocused = await window.webContents.executeJavaScript(`(() => {
      const splitter = document.querySelector('.desktop-editor-splitter');
      splitter?.focus();
      return document.activeElement === splitter;
    })()`);
    assert(splitterFocused, "Split handle did not regain focus before pane input");
    await wait(50);
    const send = async (type, point, pressed = false) => {
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      window.webContents.sendInputEvent({
        type, x, y,
        ...(type === "mouseMove" ? (pressed ? { modifiers: ["leftButtonDown"] } : {}) : { button: "left", clickCount: 1 }),
      });
    };
    await send("mouseMove", request.from);
    await send("mouseDown", request.from, true);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await window.webContents.executeJavaScript("document.querySelector('.desktop-editor-splitter')?.dataset.resizing === 'true'")) break;
      await wait(10);
    }
    assert(await window.webContents.executeJavaScript("document.querySelector('.desktop-editor-splitter')?.dataset.resizing === 'true'"),
      "Split handle did not acquire the pointer stream");
    for (let step = 1; step <= 6; step++) {
      await send("mouseMove", { x: request.from.x + (request.to.x - request.from.x) * step / 6, y: request.from.y + (request.to.y - request.from.y) * step / 6 }, true);
      await wait(20);
    }
    let previewReachedTarget = false;
    const samplePreviewAtTarget = async () => {
      await window.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      return window.webContents.executeJavaScript(
        `Math.abs(Number(document.querySelector('.desktop-editor-splitter')?.getAttribute('aria-valuenow')) - ${Math.round(request.ratio * 100)}) <= 1`,
      );
    };
    for (let delivery = 0; delivery < 3 && !previewReachedTarget; delivery++) {
      await send("mouseMove", request.to, true);
      for (let sample = 0; sample < 8 && !previewReachedTarget; sample++) {
        previewReachedTarget = await samplePreviewAtTarget();
      }
    }
    assert(previewReachedTarget, "Split handle did not publish the final pointer coordinate");
    await send("mouseUp", request.to);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!await window.webContents.executeJavaScript("document.querySelector('.desktop-editor-splitter')?.dataset.resizing === 'true'")) return;
      await wait(10);
    }
    assert(false, "Split handle did not release the pointer stream");
  });
  ipcMain.handle("pane-contracts:record", async (_event, row) => {
    rows.push(row); console.log(`${row.id} ${row.direction}: passed`);
  });
  vite = await createServer({ root: repoRoot, cacheDir: path.join(temporary, "vite-cache"), logLevel: "error",
    optimizeDeps: { entries: ["tests/fixtures/editor/runtime/editor-pane-contracts.html"], include: ["jszip", "xlsx"] },
    server: { host: "127.0.0.1", port: 5199, strictPort: false, hmr: false, watch: null } });
  await vite.listen();
  const rendererUrl = `http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/editor/runtime/editor-pane-contracts.html`;
  registerLocalFileProtocol({
    protocol,
    readWorkspaceFile: (rootPath, relativePath) => fsp.readFile(path.join(rootPath, relativePath)),
    statWorkspaceFile: (rootPath, relativePath) => fsp.stat(path.join(rootPath, relativePath)),
    getMimeType: (relativePath) => relativePath.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
    canonicalizeWorkspacePath: (rootPath) => fsp.realpath(rootPath),
    isOpenWorkspaceRoot: (rootPath) => rootPath === canonicalWorkspaceRoot,
    resolveCapability: localFileCapabilities.resolve,
    applicationUrl: rendererUrl,
  });
  window = new BrowserWindow({ show: true, width: 1100, height: 820, webPreferences: {
    backgroundThrottling: false, contextIsolation: true, sandbox: true, plugins: true,
    preload: path.join(repoRoot, "tests/fixtures/editor/runtime/editor-pane-contracts-preload.cjs"),
  } });
  app.focus({ steal: true }); window.focus();
  window.webContents.on("console-message", (details) => { if (details.level === "error") console.error(details.message); });
  await window.loadURL(rendererUrl);
  const result = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 400 && !window.editorPaneContracts; i++) await new Promise(resolve => setTimeout(resolve, 25));
    if (!window.editorPaneContracts) throw new Error("Pane fixture failed to initialize");
    return window.editorPaneContracts.run();
  })()`);
  assert(result.passed);
  assert.equal(rows.length, result.results.length);
  assert.equal(destroyed, !caseId || caseId === "pdf" ? 2 : 0, "Both PDF directions must confirm DOM-frame teardown");
} catch (error) {
  failed = true; failure = error?.stack ?? String(error); console.error(failure);
  if (window && !window.isDestroyed()) await fsp.writeFile(path.join(outputDirectory, "failure.png"), (await window.webContents.capturePage()).toPNG());
} finally {
  window?.destroy(); await vite?.close();
  if (appServer) await new Promise(resolve => appServer.close(resolve));
  try { await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch (error) { failed = true; failure ??= `Temporary profile cleanup failed: ${error.message}`; }
  const sourceAfter = await readSourceIdentity(repoRoot);
  if (sourceAfter.fingerprint !== source.fingerprint) { failed = true; failure ??= "Source changed during verification"; }
  await fsp.writeFile(path.join(outputDirectory, "result.json"), JSON.stringify({ passed: !failed, source, sourceAfter, platform: process.platform,
    electron: process.versions.electron, selection: caseId ?? "all", input: "Electron sendInputEvent for DOM", results: rows, pdfFramesDestroyed: destroyed,
    failure }, null, 2) + "\n");
  console.log(`Pane contract evidence: ${outputDirectory}`);
  clearTimeout(deadline);
  process.exit(failed ? 1 : 0);
}

}).catch(error => { console.error(error); process.exit(1); });

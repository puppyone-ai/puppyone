#!/usr/bin/env electron
import assert from "node:assert/strict";
import * as fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, session, WebContentsView } from "electron";
import { createServer } from "vite";
import { createEditorSurfaceSessionManager } from "../../../../electron/main/editor-surfaces/session-manager.mjs";
import { createNativeSurfaceOcclusionCoordinator } from "../../../../electron/main/native-surfaces/occlusion-coordinator.mjs";
import { createNativeSurfacePointerPassthroughCoordinator } from "../../../../electron/main/native-surfaces/pointer-passthrough-coordinator.mjs";
import { registerNativeSurfaceOcclusionIpcHandlers } from "../../../../electron/main/ipc/native-surface-occlusion-ipc.mjs";
import { registerNativeSurfacePointerPassthroughIpcHandlers } from "../../../../electron/main/ipc/native-surface-pointer-passthrough-ipc.mjs";
import { registerWorkspaceFileIpcHandlers } from "../../../../electron/main/ipc/workspace-files-ipc.mjs";
import { createLocalFileCapabilityStore } from "../../../../electron/main/local-file-capabilities.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";
import { canCaptureNativeWindow, captureNativeWindow, markNativeSurface, countMarkerPixels, compareEditorRegion } from "../../../support/electron/native-window-visibility.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-pane-contracts-"));
const workspaceRoot = path.join(temporary, "workspace");
await fsp.mkdir(workspaceRoot);
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
let window, vite, surfaces, appServer;
let inputDebugger;
let destroyed = 0;
let compositeClosed = 0;
const markers = new Map();
let nativeCapture = false;
const occlusion = createNativeSurfaceOcclusionCoordinator();
const pointer = createNativeSurfacePointerPassthroughCoordinator();
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
  ipcMain.handle("pane-contracts:config", () => ({ appUrl, caseId }));
  ipcMain.handle("pane-contracts:capture", async (_event, id) => {
    assert(/^[a-z-]+-(horizontal|vertical)$/.test(id));
    if (id.startsWith("app-")) {
      const frame = window.webContents.mainFrame.frames.find(frame => frame.url === appUrl);
      assert(frame, "App frame never navigated to its separate origin");
      assert((await frame.executeJavaScript("document.body.textContent")).includes("Pane app rendered"));
    }
    if (id.startsWith("pdf-")) {
      const entry = surfaces.values()[0];
      assert(entry?.attached && entry.geometryVisible && !entry.occluded, "PDF is not visible in its pane");
      const image = await entry.view.webContents.capturePage();
      assert(!image.isEmpty(), "Native PDF produced no painted frame");
      const bitmap = image.toBitmap();
      const colors = new Set();
      const stride = Math.max(4, Math.floor(bitmap.length / 20_000 / 4) * 4);
      for (let offset = 0; offset + 3 < bitmap.length && colors.size < 3; offset += stride) colors.add(bitmap.subarray(offset, offset + 4).toString("hex"));
      assert(colors.size >= 3, "Native PDF frame contains no document detail");
      await fsp.writeFile(path.join(outputDirectory, `${id}-native.png`), image.toPNG());
      if (nativeCapture) {
        const color = await markNativeSurface(entry.view.webContents);
        markers.set(id, color);
        await wait(100);
        const composite = await captureNativeWindow(window);
        await fsp.writeFile(path.join(outputDirectory, `${id}-composite-open.png`), composite.toPNG());
        assert(countMarkerPixels(composite, color) > 100, "Compositor capture omitted the visible PDF child");
      }
    }
    await fsp.writeFile(path.join(outputDirectory, `${id}.png`), (await window.webContents.capturePage()).toPNG());
  });
  ipcMain.handle("pane-contracts:verifyClosed", async (_event, id) => {
    assert(/^pdf-(horizontal|vertical)$/.test(id));
    assert.equal(surfaces.values().length, 0, "Closed PDF retained a native session");
    if (nativeCapture) {
      assert(markers.has(id), "PDF close has no positive compositor control");
      await wait(100);
      const image = await captureNativeWindow(window);
      await fsp.writeFile(path.join(outputDirectory, `${id}-composite-closed.png`), image.toPNG());
      assert.equal(countMarkerPixels(image, markers.get(id)), 0, "PDF paint survived pane close in the composed window");
      const comparison = await compareEditorRegion(window, image);
      await fsp.writeFile(path.join(outputDirectory, `${id}-editor-expected.png`), comparison.expected.toPNG());
      await fsp.writeFile(path.join(outputDirectory, `${id}-editor-actual.png`), comparison.actual.toPNG());
      assert(comparison.mismatchRatio < 0.005, `Closed PDF occludes the surviving Editor (${comparison.mismatchRatio})`);
      compositeClosed++;
    }
  });
  registerNativeSurfaceOcclusionIpcHandlers({ ipcMain, coordinator: occlusion });
  registerNativeSurfacePointerPassthroughIpcHandlers({ ipcMain, coordinator: pointer });
  const handlers = new Map();
  registerWorkspaceFileIpcHandlers({ app, fs, BrowserWindow, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {}, shell: {}, localFileCapabilities: createLocalFileCapabilityStore(),
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
  const pdfPath = path.join(repoRoot, "tests/fixtures/editor/formats/samples/sample_document.pdf");
  surfaces = createEditorSurfaceSessionManager({ WebContentsView, browserSession: session.fromPartition("persist:pane-contracts-pdf", { cache: false }),
    getOwnerWindow: (id) => id === window?.webContents.id ? window : null,
    nativeSurfaceOcclusion: occlusion,
    // This matrix injects input directly into the owner renderer. Mixing the
    // OS child-surface forwarding stream into synthetic drags can inject
    // unrelated button-up hover events. OS forwarding has its own acceptance
    // suite; native PDF rendering, geometry, occlusion and teardown remain real.
    admitResource: async () => ({ byteLength: (await fsp.stat(pdfPath)).size, navigationUrl: pathToFileURL(pdfPath).href }),
  });
  ipcMain.handle("pane-contracts:surface:activate", (event, request) => surfaces.activate({ ...request, ownerWebContentsId: event.sender.id }));
  ipcMain.handle("pane-contracts:surface:setBounds", (event, request) => surfaces.setBounds(request.sessionId, request.bounds, event.sender.id, request.geometryRevision, request.visible));
  ipcMain.handle("pane-contracts:surface:updateAppearance", (event, request) => surfaces.updateAppearance(request.sessionId, request.appearance, event.sender.id));
  ipcMain.handle("pane-contracts:surface:destroy", async (event, request) => {
    const contents = surfaces.values().find((entry) => entry.sessionId === request.sessionId)?.view.webContents;
    const result = await surfaces.destroy(request.sessionId, event.sender.id);
    if (contents) { assert(contents.isDestroyed(), "PDF close acknowledged before WebContents destruction"); destroyed++; }
    return result;
  });
  ipcMain.handle("pane-contracts:nativeState", async () => ({ destroyed, sessions: await Promise.all(surfaces.values().map(async (entry) => ({
    id: entry.sessionId, bounds: entry.view.getBounds(), ready: await pdfReady(entry.view.webContents),
  }))) }));
  ipcMain.handle("pane-contracts:input", async (_event, request) => {
    // A native child capture can retain focus on Linux. Restore the owner and
    // let Chromium publish that focus change before dispatching the next pane
    // gesture. This keeps the matrix independent of whichever WebContents last
    // painted evidence.
    window.focus();
    window.webContents.focus();
    // CDP dispatch is target-scoped and does not depend on the host OS making
    // this BrowserWindow the foreground application. DOM focus is the useful
    // invariant here; macOS CI can legitimately deny foreground activation.
    const splitterFocused = await window.webContents.executeJavaScript(`(() => {
      const splitter = document.querySelector('.desktop-editor-splitter');
      splitter?.focus();
      return document.activeElement === splitter;
    })()`);
    assert(splitterFocused, "Split handle did not regain focus before pane input");
    await wait(50);
    // Electron's regular renderer input is the closest contract for DOM-only
    // viewers. A visible WebContentsView can intercept that transport on Linux,
    // so native cases use target-scoped CDP input against the owner renderer.
    const nativeSurfaceVisible = surfaces.values().some(entry => entry.attached && entry.geometryVisible);
    const send = async (type, point, pressed = false) => {
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      if (nativeSurfaceVisible) {
        await inputDebugger.sendCommand("Input.dispatchMouseEvent", {
          type: type === "mouseMove" ? "mouseMoved" : type === "mouseDown" ? "mousePressed" : "mouseReleased",
          x, y, pointerType: "mouse", button: "left", buttons: pressed ? 1 : 0,
          ...(type === "mouseMove" ? {} : { clickCount: 1 }),
        });
        return;
      }
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
  window = new BrowserWindow({ show: true, width: 1100, height: 820, webPreferences: {
    backgroundThrottling: false, contextIsolation: true, sandbox: true, preload: path.join(repoRoot, "tests/fixtures/editor/runtime/editor-pane-contracts-preload.cjs"),
  } });
  inputDebugger = window.webContents.debugger;
  inputDebugger.attach("1.3");
  app.focus({ steal: true }); window.focus();
  window.webContents.on("console-message", (details) => { if (details.level === "error") console.error(details.message); });
  await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/editor/runtime/editor-pane-contracts.html`);
  nativeCapture = await canCaptureNativeWindow(window);
  if (process.argv.includes("--require-compositor")) assert(nativeCapture, "Native compositor capture permission is required");
  const result = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 400 && !window.editorPaneContracts; i++) await new Promise(resolve => setTimeout(resolve, 25));
    if (!window.editorPaneContracts) throw new Error("Pane fixture failed to initialize");
    return window.editorPaneContracts.run();
  })()`);
  assert(result.passed);
  assert.equal(rows.length, result.results.length);
  assert.equal(destroyed, !caseId || caseId === "pdf" ? 2 : 0, "Both PDF directions must confirm native teardown");
  if (nativeCapture) assert.equal(compositeClosed, destroyed, "A PDF direction omitted compositor close verification");
} catch (error) {
  failed = true; failure = error?.stack ?? String(error); console.error(failure);
  if (window && !window.isDestroyed()) await fsp.writeFile(path.join(outputDirectory, "failure.png"), (await window.webContents.capturePage()).toPNG());
} finally {
  await surfaces?.destroyAll(); pointer.dispose(); occlusion.dispose();
  if (inputDebugger?.isAttached()) inputDebugger.detach();
  window?.destroy(); await vite?.close();
  if (appServer) await new Promise(resolve => appServer.close(resolve));
  try { await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch (error) { failed = true; failure ??= `Temporary profile cleanup failed: ${error.message}`; }
  const sourceAfter = await readSourceIdentity(repoRoot);
  if (sourceAfter.fingerprint !== source.fingerprint) { failed = true; failure ??= "Source changed during verification"; }
  await fsp.writeFile(path.join(outputDirectory, "result.json"), JSON.stringify({ passed: !failed, source, sourceAfter, platform: process.platform,
    electron: process.versions.electron, selection: caseId ?? "all", input: "Electron sendInputEvent for DOM; target-scoped CDP for native child overlap; not OS input injection", results: rows, nativePdfDestroyed: destroyed,
    compositor: nativeCapture ? { verifiedClosed: compositeClosed } : "not-run: screen permission unavailable", failure }, null, 2) + "\n");
  console.log(`Pane contract evidence: ${outputDirectory}`);
  clearTimeout(deadline);
  process.exit(failed ? 1 : 0);
}

}).catch(error => { console.error(error); process.exit(1); });

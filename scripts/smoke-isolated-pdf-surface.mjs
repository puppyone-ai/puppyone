#!/usr/bin/env electron

import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  nativeImage,
  session as electronSession,
  WebContentsView,
} from "electron";
import { createEditorSurfaceSessionManager } from "../electron/main/editor-surfaces/session-manager.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureIndex = process.argv.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0
  ? path.resolve(process.argv[fixtureIndex + 1] ?? "")
  : path.join(repoRoot, "tests/fixtures/editor-rendering/sample_document.pdf");
const captureDirectoryIndex = process.argv.indexOf("--capture-directory");
const captureDirectory = captureDirectoryIndex >= 0
  ? path.resolve(process.argv[captureDirectoryIndex + 1] ?? "")
  : null;
const scanPages = process.argv.includes("--scan-pages");
const CHROMIUM_PDF_VIEWER_PREFIX = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-native-pdf-smoke-"));
const userDataPath = path.join(tempRoot, "user-data");
const lifecycle = [];
let ownerWindow = null;
let manager = null;

app.setPath("userData", userDataPath);
await fsp.access(fixturePath);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPaintedPixels(image) {
  if (image.isEmpty()) return false;
  const bitmap = image.toBitmap();
  const sampledColors = new Set();
  const stride = Math.max(4, Math.floor(bitmap.length / 20_000 / 4) * 4);
  for (let offset = 0; offset + 3 < bitmap.length; offset += stride) {
    sampledColors.add(bitmap.subarray(offset, offset + 4).toString("hex"));
    if (sampledColors.size >= 3) break;
  }
  return sampledColors.size >= 3;
}

function assertPainted(image, label) {
  assert(!image.isEmpty(), `${label} capture was empty.`);
  assert(hasPaintedPixels(image), `${label} capture did not contain a rendered PDF frame.`);
}

async function captureNativeSurface(webContents) {
  const deadline = Date.now() + 8_000;
  let lastImage = nativeImage.createEmpty();
  do {
    lastImage = await captureNativeSurfaceOnce(webContents);
    if (hasPaintedPixels(lastImage)) return lastImage;
    await wait(150);
  } while (Date.now() < deadline);
  return lastImage;
}

async function captureNativeSurfaceOnce(webContents) {
  try {
    const image = await webContents.capturePage();
    if (hasPaintedPixels(image)) return image;
  } catch (error) {
    if (!String(error?.message ?? error).includes("display surface not available")) throw error;
    // Fall through to the DevTools capture path. Chromium's OOPIF-backed PDF
    // surface can briefly be unavailable through webContents.capturePage().
  }
  const ownsDebugger = !webContents.debugger.isAttached();
  if (ownsDebugger) webContents.debugger.attach("1.3");
  try {
    const { data } = await webContents.debugger.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    return nativeImage.createFromBuffer(Buffer.from(data, "base64"));
  } finally {
    if (ownsDebugger && webContents.debugger.isAttached()) webContents.debugger.detach();
  }
}

function findChromiumPdfViewerFrame(webContents) {
  const pending = [...webContents.mainFrame.frames];
  while (pending.length > 0) {
    const frame = pending.shift();
    if (frame.url.startsWith(CHROMIUM_PDF_VIEWER_PREFIX)) return frame;
    pending.push(...frame.frames);
  }
  return null;
}

async function readChromiumPdfViewerState(webContents) {
  const frame = findChromiumPdfViewerFrame(webContents);
  if (!frame) return null;
  const state = await frame.executeJavaScript(`(() => {
    const viewer = document.querySelector('pdf-viewer');
    const pageDimensions = viewer?.documentDimensions?.pageDimensions;
    if (!viewer?.viewport || !Array.isArray(pageDimensions) || pageDimensions.length === 0) return null;
    const toolbar = viewer.shadowRoot?.querySelector('#toolbar');
    const sidenav = viewer.shadowRoot?.querySelector('#sidenav');
    const isVisuallyHidden = (element) => !element
      || element.hidden
      || getComputedStyle(element).display === 'none'
      || element.getBoundingClientRect().width === 0
      || element.getBoundingClientRect().height === 0;
    return {
      pageCount: pageDimensions.length,
      currentPageIndex: viewer.viewport.getMostVisiblePage(),
      documentHeight: viewer.documentDimensions.height,
      toolbarHidden: isVisuallyHidden(toolbar),
      sidenavHidden: isVisuallyHidden(sidenav),
    };
  })()`);
  return state ? { frame, ...state } : null;
}

async function waitForChromiumPdfViewer(webContents, predicate = () => true) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const state = await readChromiumPdfViewerState(webContents);
      if (state && predicate(state)) return state;
    } catch {
      // The extension frame can be replaced while Chromium commits the PDF.
    }
    await wait(100);
  }
  throw new Error("Chromium PDF Viewer did not expose a ready document frame.");
}

async function run() {
  let failed = false;
  try {
    ownerWindow = new BrowserWindow({
      show: true,
      x: 20,
      y: 20,
      width: 1_100,
      height: 760,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await ownerWindow.loadURL("data:text/html,<title>Native PDF Surface Host</title>");
    app.focus({ steal: true });
    ownerWindow.show();
    ownerWindow.focus();

    const fixtureUrl = pathToFileURL(fixturePath).toString();
    const browserSession = electronSession.fromPartition(
      "persist:puppyone-native-pdf-smoke",
      { cache: false },
    );
    browserSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    browserSession.setPermissionCheckHandler(() => false);
    manager = createEditorSurfaceSessionManager({
      WebContentsView,
      browserSession,
      getOwnerWindow: (ownerWebContentsId) => (
        ownerWebContentsId === ownerWindow.webContents.id ? ownerWindow : null
      ),
      admitResource: async () => ({
        byteLength: (await fsp.stat(fixturePath)).size,
        navigationUrl: fixtureUrl,
      }),
      navigationTimeoutMs: 20_000,
      onStateChange: (event) => lifecycle.push(event),
    });

    const session = await manager.activate({
      ownerWebContentsId: ownerWindow.webContents.id,
      viewerId: "pdf-preview",
      documentPath: path.basename(fixturePath),
      documentRevision: "smoke:1",
      resourceUrl: "puppyone-local://file/smoke/file-preview/sample_document.pdf",
      title: path.basename(fixturePath),
      safeMode: false,
      bounds: { x: 0, y: 0, width: 900, height: 700 },
      geometryRevision: 1,
      visible: true,
      appearance: { dark: true, direction: "ltr", attributes: {}, variables: {} },
    });
    assert.equal(session.status, "ready");
    assert.equal(session.safeMode, false);

    const entry = manager.values().find((candidate) => candidate.sessionId === session.sessionId);
    assert(entry, "Native PDF Surface session was unavailable.");
    const expectedViewerUrl = `${fixtureUrl}#toolbar=0&navpanes=0`;
    assert.equal(entry.navigationUrl, expectedViewerUrl);
    assert.equal(entry.view.webContents.getURL(), expectedViewerUrl);
    assert.notEqual(
      entry.view.webContents.getOSProcessId(),
      ownerWindow.webContents.getOSProcessId(),
      "PDF Surface shared the App Shell renderer process.",
    );

    await wait(1_500);
    const pdfViewerState = await waitForChromiumPdfViewer(entry.view.webContents);
    assert.equal(pdfViewerState.toolbarHidden, true, "Chromium's PDF toolbar remained visible.");
    assert.equal(pdfViewerState.sidenavHidden, true, "Chromium's PDF sidenav remained visible.");
    const firstFrame = await captureNativeSurface(entry.view.webContents);
    assertPainted(firstFrame, "Initial native PDF");
    if (captureDirectory) {
      await fsp.mkdir(captureDirectory, { recursive: true });
      await fsp.writeFile(path.join(captureDirectory, "first-page.png"), firstFrame.toPNG());
    }

    manager.setBounds(
      session.sessionId,
      { x: 0, y: 0, width: 700, height: 700 },
      ownerWindow.webContents.id,
      2,
      true,
    );
    await wait(500);
    const resizedFrame = await captureNativeSurface(entry.view.webContents);
    assertPainted(resizedFrame, "Resized native PDF");
    assert(resizedFrame.getSize().width < firstFrame.getSize().width);
    if (captureDirectory) {
      await fsp.writeFile(path.join(captureDirectory, "resized-page.png"), resizedFrame.toPNG());
    }

    let bottomFrame = null;
    if (scanPages) {
      const finalPageIndex = pdfViewerState.pageCount - 1;
      assert(finalPageIndex > 0, "Long-document scan requires a multi-page PDF fixture.");
      await pdfViewerState.frame.executeJavaScript(`
        document.querySelector('pdf-viewer').viewport.goToPage(${finalPageIndex})
      `);
      await waitForChromiumPdfViewer(
        entry.view.webContents,
        (state) => state.currentPageIndex === finalPageIndex,
      );
      await wait(1_000);
      bottomFrame = await captureNativeSurface(entry.view.webContents);
      assertPainted(bottomFrame, "Bottom native PDF");
      assert.notDeepEqual(bottomFrame.toPNG(), resizedFrame.toPNG());
      if (captureDirectory) {
        await fsp.writeFile(path.join(captureDirectory, "last-page.png"), bottomFrame.toPNG());
      }
    }

    entry.view.webContents.forcefullyCrashRenderer();
    await wait(500);
    assert.equal(manager.values().length, 0, "Crashed PDF Surface was not contained.");
    assert.equal(ownerWindow.isDestroyed(), false, "PDF crash escaped into the App Shell.");

    console.log(JSON.stringify({
      ok: true,
      engine: "chromium-pdfium",
      fixturePath,
      url: fixtureUrl,
      firstFrame: firstFrame.getSize(),
      resizedFrame: resizedFrame.getSize(),
      bottomFrame: bottomFrame?.getSize() ?? null,
      pageCount: pdfViewerState.pageCount,
      documentHeight: pdfViewerState.documentHeight,
      lifecycle,
      crashContained: true,
    }, null, 2));
  } catch (error) {
    console.error(error);
    console.error(JSON.stringify({ lifecycle }, null, 2));
    failed = true;
  } finally {
    manager?.destroyAll();
    if (ownerWindow && !ownerWindow.isDestroyed()) ownerWindow.destroy();
    await fsp.rm(tempRoot, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  }
}

app.whenReady().then(run).catch(async (error) => {
  console.error(error);
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  process.exit(1);
});

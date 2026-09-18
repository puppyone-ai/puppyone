#!/usr/bin/env electron

import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeImage, net, protocol } from "electron";
import { registerLocalFileProtocol } from "../../../../../electron/main/local-file-protocol.mjs";
import {
  buildLocalFileCapabilityUrl,
  createLocalFileCapabilityStore,
} from "../../../../../electron/main/local-file-capabilities.mjs";

protocol.registerSchemesAsPrivileged([{
  scheme: "puppyone-local",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const fixtureIndex = process.argv.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0
  ? path.resolve(process.argv[fixtureIndex + 1] ?? "")
  : path.join(repoRoot, "tests/fixtures/editor/formats/samples/sample_document.pdf");
const fixtureRoot = path.dirname(fixturePath);
const fixtureName = path.basename(fixturePath);
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-dom-pdf-smoke-"));
const userDataPath = path.join(tempRoot, "user-data");
const hostPath = path.join(tempRoot, "host.html");
const hostUrl = pathToFileURL(hostPath).toString();
const CHROMIUM_PDF_VIEWER_PREFIX = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";
let ownerWindow = null;

app.setPath("userData", userDataPath);
await fsp.access(fixturePath);
await fsp.writeFile(hostPath, `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #17202a; }
  #editor { position: relative; display: flex; width: 900px; height: 680px; min-width: 0; min-height: 0;
    overflow: hidden; transform-origin: 0 0; background: #f1f3f4; }
  #surface { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
  #surface iframe { display: block; flex: 1; width: 100%; height: 100%; min-width: 0; min-height: 0; border: 0; }
  #overlay { position: absolute; z-index: 10; inset: 140px 120px; display: none; background: rgb(220, 38, 38); }
</style>
<main id="editor"><section id="surface"></section><div id="overlay">DOM overlay</div></main>
<script>
  window.mountPdf = (url) => {
    const surface = document.querySelector('#surface');
    surface.replaceChildren();
    surface.dataset.ready = 'false';
    const frame = document.createElement('iframe');
    frame.title = 'PDF fixture';
    frame.referrerPolicy = 'no-referrer';
    frame.addEventListener('load', () => requestAnimationFrame(() => { surface.dataset.ready = 'true'; }));
    frame.src = url + '#toolbar=0&navpanes=0';
    surface.append(frame);
  };
  window.unmountPdf = () => document.querySelector('#surface').replaceChildren();
</script>`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function descendantFrames(contents) {
  const result = [];
  const pending = [...contents.mainFrame.frames];
  while (pending.length > 0) {
    const frame = pending.shift();
    result.push(frame);
    pending.push(...frame.frames);
  }
  return result;
}

function chromiumPdfFrames(contents) {
  return descendantFrames(contents).filter((frame) => frame.url.startsWith(CHROMIUM_PDF_VIEWER_PREFIX));
}

async function waitForPdfViewer(contents, expectedUrl) {
  const deadline = Date.now() + 12_000;
  let lastState = null;
  while (Date.now() < deadline) {
    const iframeState = await contents.executeJavaScript(`(() => {
      const frame = document.querySelector('#surface iframe');
      return frame ? { ready: document.querySelector('#surface').dataset.ready, src: frame.src } : null;
    })()`);
    const frames = chromiumPdfFrames(contents);
    let frameDocuments = [];
    try {
      frameDocuments = await Promise.all(descendantFrames(contents).map(async (frame) => ({
        url: frame.url,
        document: await frame.executeJavaScript(`({
          title: document.title,
          contentType: document.contentType,
          html: document.documentElement?.outerHTML?.slice(0, 500),
        })`),
      })));
    } catch {
      // A PDF frame may be replaced while diagnostics are sampled.
    }
    lastState = {
      iframeState,
      allFrameUrls: descendantFrames(contents).map((frame) => frame.url),
      frameDocuments,
    };
    if (iframeState?.ready === "true" && iframeState.src === `${expectedUrl}#toolbar=0&navpanes=0` && frames.length === 1) {
      try {
        const ready = await frames[0].executeJavaScript(
          "Boolean(document.querySelector('pdf-viewer')?.documentDimensions?.pageDimensions?.length)",
        );
        if (ready) return frames[0];
      } catch {
        // Chromium may replace the extension frame while committing the PDF.
      }
    }
    await wait(100);
  }
  throw new Error(`DOM-embedded Chromium PDF Viewer did not become ready: ${JSON.stringify(lastState)}`);
}

async function waitForNoPdfViewer(contents) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (chromiumPdfFrames(contents).length === 0) return;
    await wait(100);
  }
  throw new Error("A retired Editor iframe retained its Chromium PDF Viewer frame.");
}

function hasPaintedPixels(image) {
  if (image.isEmpty()) return false;
  const bitmap = image.toBitmap();
  const colors = new Set();
  const stride = Math.max(4, Math.floor(bitmap.length / 20_000 / 4) * 4);
  for (let offset = 0; offset + 3 < bitmap.length; offset += stride) {
    colors.add(bitmap.subarray(offset, offset + 4).toString("hex"));
    if (colors.size >= 3) return true;
  }
  return false;
}

async function captureEditor(contents) {
  const rect = await contents.executeJavaScript(`(() => {
    const rect = document.querySelector('#editor').getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  })()`);
  let image = nativeImage.createEmpty();
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    image = await contents.capturePage(rect);
    if (hasPaintedPixels(image)) return { image, rect };
    await wait(100);
  }
  return { image, rect };
}

async function run() {
  let exitCode = 0;
  try {
    const capabilities = createLocalFileCapabilityStore({
      createToken: (() => {
        let sequence = 0;
        return () => `pdfdom${String(++sequence).padStart(58, "0")}`;
      })(),
    });
    const canonicalFixtureRoot = await fsp.realpath(fixtureRoot);
    registerLocalFileProtocol({
      protocol,
      readWorkspaceFile: async (_rootPath, relativePath) => fsp.readFile(path.join(canonicalFixtureRoot, relativePath)),
      statWorkspaceFile: async (_rootPath, relativePath) => fsp.stat(path.join(canonicalFixtureRoot, relativePath)),
      getMimeType: () => "application/pdf",
      canonicalizeWorkspacePath: (rootPath) => fsp.realpath(rootPath),
      isOpenWorkspaceRoot: (rootPath) => rootPath === canonicalFixtureRoot,
      resolveCapability: capabilities.resolve,
      applicationUrl: hostUrl,
    });

    ownerWindow = new BrowserWindow({
      show: true,
      width: 1_100,
      height: 760,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        plugins: true,
        backgroundThrottling: false,
      },
    });
    await ownerWindow.loadURL(hostUrl);
    const tokenA = capabilities.issue({
      senderId: ownerWindow.webContents.id,
      rootPath: canonicalFixtureRoot,
      relativePath: fixtureName,
      purpose: "file-preview",
      reuse: false,
    });
    const tokenB = capabilities.issue({
      senderId: ownerWindow.webContents.id,
      rootPath: canonicalFixtureRoot,
      relativePath: fixtureName,
      purpose: "file-preview",
      reuse: false,
    });
    const urlA = buildLocalFileCapabilityUrl({ relativePath: fixtureName, token: tokenA });
    const urlB = buildLocalFileCapabilityUrl({ relativePath: fixtureName, token: tokenB });
    const admittedResponse = await net.fetch(urlA);
    assert.equal(admittedResponse.status, 200, "PDF capability protocol rejected the admitted resource.");
    assert.equal(admittedResponse.headers.get("content-type"), "application/pdf");
    assert((await admittedResponse.arrayBuffer()).byteLength > 0, "PDF capability response was empty.");

    await ownerWindow.webContents.executeJavaScript(`window.mountPdf(${JSON.stringify(urlA)})`);
    await waitForPdfViewer(ownerWindow.webContents, urlA);
    const initial = await captureEditor(ownerWindow.webContents);
    assert(hasPaintedPixels(initial.image), "Initial DOM PDF capture did not contain a painted document.");
    assert.equal(initial.rect.width, 900);

    const resized = await ownerWindow.webContents.executeJavaScript(`(async () => {
      const editor = document.querySelector('#editor');
      editor.style.width = '700px';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const frame = document.querySelector('#surface iframe').getBoundingClientRect();
      return { width: Math.round(frame.width), height: Math.round(frame.height) };
    })()`);
    assert.deepEqual(resized, { width: 700, height: 680 }, "PDF iframe did not follow normal Editor resize layout.");

    const transformed = await ownerWindow.webContents.executeJavaScript(`(async () => {
      const editor = document.querySelector('#editor');
      editor.style.transform = 'scale(.8)';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const frame = document.querySelector('#surface iframe').getBoundingClientRect();
      return { width: Math.round(frame.width), height: Math.round(frame.height) };
    })()`);
    assert.deepEqual(transformed, { width: 560, height: 544 }, "PDF iframe escaped the Editor transform.");

    const overlayState = await ownerWindow.webContents.executeJavaScript(`(() => {
      const overlay = document.querySelector('#overlay');
      overlay.style.display = 'block';
      const rect = overlay.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { id: top?.id, iframeCount: document.querySelectorAll('#surface iframe').length };
    })()`);
    assert.deepEqual(overlayState, { id: "overlay", iframeCount: 1 }, "A normal DOM overlay did not cover the PDF iframe.");
    assert.equal(chromiumPdfFrames(ownerWindow.webContents).length, 1, "Opening a DOM overlay recreated or hid the PDF Viewer.");

    await ownerWindow.webContents.executeJavaScript(`window.mountPdf(${JSON.stringify(urlB)})`);
    await waitForPdfViewer(ownerWindow.webContents, urlB);
    assert.equal(chromiumPdfFrames(ownerWindow.webContents).length, 1, "A→B replacement retained the old PDF frame.");

    await ownerWindow.webContents.executeJavaScript("window.unmountPdf()");
    const detachedImmediately = await ownerWindow.webContents.executeJavaScript(
      "document.querySelector('#surface iframe') === null",
    );
    assert.equal(detachedImmediately, true, "Closing the Editor pane did not synchronously detach its PDF iframe.");
    await waitForNoPdfViewer(ownerWindow.webContents);

    await ownerWindow.webContents.executeJavaScript(`window.mountPdf(${JSON.stringify(urlA)})`);
    await waitForPdfViewer(ownerWindow.webContents, urlA);
    assert.equal(chromiumPdfFrames(ownerWindow.webContents).length, 1, "A→B→A created an extra Chromium PDF frame.");

    console.log(JSON.stringify({
      passed: true,
      surface: "Editor DOM iframe",
      compute: "Chromium PDF Viewer/PDFium",
      checks: [
        "controlled capability protocol",
        "painted frame",
        "DOM resize",
        "DOM transform",
        "DOM overlay stacking",
        "A→B replacement",
        "synchronous detach",
        "A→B→A single-frame ownership",
      ],
    }, null, 2));
  } catch (error) {
    exitCode = 1;
    console.error(error?.stack ?? error);
  } finally {
    ownerWindow?.destroy();
    try {
      await fsp.rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      exitCode = 1;
      console.error(error);
    }
    app.exit(exitCode);
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error?.stack ?? error);
  app.exit(1);
});

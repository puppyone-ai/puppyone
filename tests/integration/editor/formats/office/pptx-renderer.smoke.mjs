#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const fixturePath = path.join(
  repoRoot,
  "tests/fixtures/editor/formats/samples/puppyone-presentation-fidelity.pptx",
);
const rendererPath = path.join(
  repoRoot,
  "node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js",
);
const jszipPath = path.join(repoRoot, "node_modules/jszip/dist/jszip.min.js");
const requestedOutputIndex = process.argv.indexOf("--output-dir");
const requestedOutputDir = requestedOutputIndex >= 0
  ? path.resolve(process.argv[requestedOutputIndex + 1] ?? "")
  : null;
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-pptx-renderer-smoke-"));
const outputDir = requestedOutputDir ?? path.join(repoRoot, "artifacts/tests/editor/pptx");
const htmlPath = path.join(tempRoot, "index.html");
const rendererCopyPath = path.join(tempRoot, "pptx-renderer.js");
const jszipCopyPath = path.join(tempRoot, "jszip.min.js");
const jszipWrapperPath = path.join(tempRoot, "jszip-wrapper.js");
const userDataPath = path.join(tempRoot, "user-data");
let window;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeScriptString(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const fixtureBase64 = (await fsp.readFile(fixturePath)).toString("base64");
const rendererUrl = "./pptx-renderer.js";
const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <style>
        html, body { width: 100%; height: 100%; margin: 0; }
        body { overflow: hidden; background: #181818; font-family: system-ui, sans-serif; }
        #workspace { box-sizing: border-box; display: grid; width: 100%; height: 100%; grid-template-columns: 168px minmax(0, 1fr); }
        #rail { box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 18px 12px; border-right: 1px solid rgba(255,255,255,.08); overflow: hidden; }
        .thumb { box-sizing: border-box; display: grid; width: 100%; aspect-ratio: 16 / 9; place-items: center; overflow: hidden; border: 1px solid rgba(255,255,255,.12); background: white; }
        #stage { box-sizing: border-box; display: grid; min-width: 0; min-height: 0; place-items: center; padding: 32px; overflow: hidden; }
        #host { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; align-items: center; justify-content: center; overflow: hidden; }
      </style>
    </head>
    <body>
      <main id="workspace"><aside id="rail"></aside><section id="stage"><div id="host"></div></section></main>
      <script>
        window.process = { env: { NODE_ENV: "production" } };
        window.__pptxSmoke = { status: "booting", slideErrors: [], nodeErrors: [] };
      </script>
      <script type="importmap">{"imports":{"jszip":"./jszip-wrapper.js"}}</script>
      <script type="module">
        import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from ${escapeScriptString(rendererUrl)};

        window.__pptxSmoke = { status: "loading", slideErrors: [], nodeErrors: [] };
        window.__pptxThumbnailHandles = [];
        void (async () => {
          try {
            const binary = atob(${escapeScriptString(fixtureBase64)});
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            window.__pptxSmoke.status = "opening";
            const viewer = await PptxViewer.open(bytes.buffer, document.querySelector("#host"), {
              fitMode: "none",
              lazyMedia: true,
              lazySlides: true,
              pdfjs: false,
              renderMode: "slide",
              zipLimits: RECOMMENDED_ZIP_LIMITS,
              onSlideError: (index, error) => window.__pptxSmoke.slideErrors.push({ index, detail: String(error) }),
              onNodeError: (nodeId, error) => window.__pptxSmoke.nodeErrors.push({ nodeId, detail: String(error) }),
            });
            window.__pptxSmoke.status = "fonts";
            await document.fonts?.ready;
            const fitToHost = async () => {
              const host = document.querySelector("#host");
              const scale = Math.min(
                host.clientWidth / viewer.slideWidth,
                host.clientHeight / viewer.slideHeight,
              );
              const zoomPercent = Math.max(10, Math.min(400, Math.floor(scale * 10000) / 100));
              await viewer.setZoom(zoomPercent);
            };
            await fitToHost();
            const resizeObserver = new ResizeObserver(() => void fitToHost());
            resizeObserver.observe(document.querySelector("#host"));
            window.__pptxViewer = viewer;
            window.__pptxFitToHost = fitToHost;
            window.__pptxResizeObserver = resizeObserver;
            window.__pptxSmoke.status = "ready";
            window.__pptxSmoke.slideCount = viewer.slideCount;
          } catch (error) {
            window.__pptxSmoke = { status: "error", detail: error instanceof Error ? error.stack : String(error) };
          }
        })();
      </script>
    </body>
  </html>`;

await fsp.mkdir(userDataPath, { recursive: true });
await fsp.mkdir(outputDir, { recursive: true });
await fsp.copyFile(rendererPath, rendererCopyPath);
await fsp.copyFile(jszipPath, jszipCopyPath);
await fsp.writeFile(jszipWrapperPath, 'import "./jszip.min.js";\nexport default globalThis.JSZip;\n');
await fsp.writeFile(htmlPath, html);
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu");

async function waitForReady() {
  const deadline = Date.now() + 30_000;
  let lastState;
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript("window.__pptxSmoke", true);
    lastState = state;
    if (state?.status === "ready") return state;
    if (state?.status === "error") throw new Error(state.detail);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`PPTX renderer smoke timed out: ${JSON.stringify(lastState)}`);
}

async function inspectSlide(index, { renderThumbnail = true } = {}) {
  return window.webContents.executeJavaScript(`
    (async () => {
      await window.__pptxViewer.goToSlide(${index});
      await document.fonts?.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const host = document.querySelector("#host");
      const child = host.firstElementChild;
      const hostRect = host.getBoundingClientRect();
      const childRect = child?.getBoundingClientRect();
      const thumbHost = document.createElement("div");
      thumbHost.className = "thumb";
      if (${renderThumbnail}) document.querySelector("#rail").append(thumbHost);
      const handle = ${renderThumbnail}
        ? window.__pptxViewer.renderThumbnailToContainer(${index}, thumbHost, { width: 140 })
        : null;
      if (handle) await handle.ready;
      const result = {
        index: ${index},
        text: host.textContent,
        hostWidth: hostRect.width,
        hostHeight: hostRect.height,
        childWidth: childRect?.width ?? 0,
        childHeight: childRect?.height ?? 0,
        overflowX: host.scrollWidth - host.clientWidth,
        overflowY: host.scrollHeight - host.clientHeight,
        thumbnailRendered: thumbHost.childElementCount > 0,
        chartCanvasCount: host.querySelectorAll("canvas").length,
      };
      if (handle) window.__pptxThumbnailHandles.push(handle);
      return result;
    })();
  `, true);
}

async function run() {
  try {
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      backgroundColor: "#181818",
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      console.error(`renderer load failed: ${errorCode} ${errorDescription}`);
    });
    await window.loadFile(htmlPath);
    const ready = await waitForReady();
    assert(ready.slideCount === 3, `expected 3 slides, received ${ready.slideCount}`);
    assert(ready.slideErrors.length === 0, `slide errors: ${JSON.stringify(ready.slideErrors)}`);

    const expectedText = ["让演示文稿保持原来的样子", "项目状态一览", "渲染覆盖随版本稳步提升"];
    const slides = [];
    for (let index = 0; index < ready.slideCount; index += 1) {
      const result = await inspectSlide(index);
      assert(result.text.includes(expectedText[index]), `slide ${index + 1} lost expected text`);
      assert(result.childWidth > 0 && result.childHeight > 0, `slide ${index + 1} has no rendered surface`);
      assert(result.childWidth <= result.hostWidth + 1, `slide ${index + 1} exceeded host width`);
      assert(result.childHeight <= result.hostHeight + 1, `slide ${index + 1} exceeded host height`);
      assert(result.overflowX <= 1 && result.overflowY <= 1, `slide ${index + 1} overflowed its host`);
      assert(result.thumbnailRendered, `slide ${index + 1} thumbnail did not render`);
      assert(!result.text.includes("Chart not found"), `slide ${index + 1} lost its native chart`);
      if (index === 2) assert(result.chartCanvasCount > 0, "native chart did not create a canvas");
      const capture = await window.capturePage();
      const screenshotPath = path.join(outputDir, `slide-${String(index + 1).padStart(2, "0")}.png`);
      await fsp.writeFile(screenshotPath, capture.toPNG());
      slides.push({ ...result, screenshotPath });
    }

    window.setSize(1280, 420);
    const shortViewport = await window.webContents.executeJavaScript(`
      (async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await window.__pptxFitToHost();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      })();
    `, true).then(() => inspectSlide(0, { renderThumbnail: false }));
    assert(
      shortViewport.childHeight <= shortViewport.hostHeight + 1,
      `short viewport cropped the slide: ${shortViewport.childHeight} > ${shortViewport.hostHeight}`,
    );

    const finalState = await window.webContents.executeJavaScript("window.__pptxSmoke", true);
    assert(finalState.slideErrors.length === 0, `slide errors: ${JSON.stringify(finalState.slideErrors)}`);
    console.log(JSON.stringify({ ok: true, nodeErrors: finalState.nodeErrors, slides, shortViewport }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    const exitCode = process.exitCode ?? 0;
    window?.destroy();
    if (!requestedOutputDir) {
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    app.exit(exitCode);
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});

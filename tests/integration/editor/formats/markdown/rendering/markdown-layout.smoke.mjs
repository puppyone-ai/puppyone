#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { execFileSync } from "node:child_process";
import { createServer as createPortReservation } from "node:net";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "",
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
};
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-layout-"));
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
let window, vite;
const errors = [];
const results = [];
const artifactBase = path.join(root, "artifacts/tests/editor/layout");
await fs.mkdir(artifactBase, { recursive: true });
const artifactDirectory = process.env.PUPPYONE_MARKDOWN_LAYOUT_ARTIFACT_DIR
  || await fs.mkdtemp(path.join(artifactBase, "run-"));
await fs.mkdir(artifactDirectory, { recursive: true });
let failure = null;
let scenario = "initialization";

app.whenReady().then(async () => {
  try {
    // Vite treats port: 0 as its configured/default port. Reserve an actual
    // ephemeral port so an open development app cannot attach to this fixture.
    const reservation = createPortReservation();
    await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error",
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
    await vite.listen();
    window = new BrowserWindow({ width: 1100, height: 760, show: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.webContents.on("console-message", details => {
      if ((details.level === "error" || details.level === "warning") && !details.message.includes("Electron Security Warning")) {
        errors.push(`${scenario}: ${details.message}`);
        console.error(errors.at(-1));
      }
    });
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/workbench/focus/markdown-layout.html`);
    const evaluate = source => window.webContents.executeJavaScript(source);
    await evaluate(`(async () => {
      for (let i = 0; i < 800 && !window.markdownLayoutFixture?.ready; i++) await new Promise(resolve => setTimeout(resolve, 10));
      if (!window.markdownLayoutFixture?.ready) throw new Error('Fixture did not initialize');
      window.probe = window.markdownLayoutFixture.probe;
      const warn = console.warn;
      console.warn = (...args) => warn(...args, new Error().stack);
    })()`);
    const record = async name => {
      const result = await evaluate(`window.probe.stop(${name === "document-map"})`);
      results.push({ name, ...result });
      console.log(JSON.stringify({ name, frames: result.frames, maxError: result.maxError, maxWidthLag: result.maxWidthLag }));
      assert(result.frames >= 3, `${name}: no continuous frame samples`);
      assert(result.maxError <= 1, `${name}: reading anchor drifted ${result.maxError}px`);
      assert(result.maxWidthLag <= 1, `${name}: viewport width lagged ${result.maxWidthLag}px`);
    };
    scenario = "async-image";
    await evaluate(`(async () => {
      for (const view of window.markdownLayoutFixture.views) view.scrollDOM.scrollTop = 600;
      await new Promise(resolve => setTimeout(resolve, 150));
      if (document.querySelectorAll('.cm-md-image-placeholder.is-loading').length !== 2) throw new Error('Delayed widgets did not mount');
      window.probe.track();
      window.probe.start();
      window.markdownLayoutFixture.releaseImage();
      for (let i = 0; i < 200 && document.querySelectorAll('img[data-preview-state="ready"]').length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
      if (document.querySelectorAll('img[data-preview-state="ready"]').length !== 2) throw new Error('Delayed widgets did not load');
    })()`);
    await record("async-image");
    for (const name of ["fast", "slow", "typography", "document-map", "top", "bottom"]) {
      scenario = name;
      await evaluate(`window.probe.prepare(${name === "top" ? "'start'" : name === "bottom" ? "'end'" : "null"})`);
      await evaluate("window.probe.start()");
      if (name === "typography") await evaluate("window.probe.typography()");
      else if (name === "document-map") await evaluate("window.probe.insertAbove()");
      else await evaluate(`window.probe.resize(${name === "slow" ? 150 : 20})`);
      await record(name);
    }
    scenario = "window-resize";
    await evaluate("window.probe.prepare()");
    await evaluate("window.probe.start()");
    for (const width of [1000, 900, 1100, 1200, 1100]) {
      window.setContentSize(width, 732);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await record("window-resize");
    scenario = "host-transition";
    await evaluate("window.probe.prepare()");
    await evaluate("window.probe.start()");
    await evaluate(`(async () => {
      const root = document.getElementById('root');
      root.style.transition = 'width 150ms linear';
      root.style.width = 'calc(100% - 260px)';
      await new Promise(resolve => setTimeout(resolve, 180));
      root.style.width = '100%';
      await new Promise(resolve => setTimeout(resolve, 180));
      root.style.transition = '';
    })()`);
    await record("host-transition");
    scenario = "pointer-split";
    window.show();
    app.focus({ steal: true });
    window.focus();
    await evaluate("window.probe.prepare()");
    const handle = await evaluate(`(() => {
      const handle = document.querySelector('.desktop-editor-splitter');
      const rect = handle.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    await evaluate("window.probe.start()");
    window.webContents.sendInputEvent({ type: "mouseMove", ...handle });
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...handle });
    for (const dx of [30, 70, 110, 180, 230, 170, 100, 40, 0]) {
      window.webContents.sendInputEvent({ type: "mouseMove", modifiers: ["leftButtonDown"], x: handle.x + dx, y: handle.y });
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...handle });
    await record("pointer-split");
    assert(results.at(-1).widths.every(widths => widths.length > 3), "Native pointer never resized the panes");
    scenario = "after-user-scroll";
    const beforeWheel = await evaluate("window.markdownLayoutFixture.views[0].scrollDOM.scrollTop");
    const point = await evaluate(`(() => {
      const rect = window.markdownLayoutFixture.views[0].scrollDOM.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    window.webContents.sendInputEvent({ type: "mouseWheel", ...point, deltaY: -300, canScroll: true });
    await new Promise(resolve => setTimeout(resolve, 250));
    const afterWheel = await evaluate("window.markdownLayoutFixture.views[0].scrollDOM.scrollTop");
    assert(Math.abs(afterWheel - beforeWheel) >= 100, "User wheel scroll was overridden");
    await evaluate("window.probe.track(); window.probe.start(); window.probe.resize(20)");
    await record("after-user-scroll");
    scenario = "after-navigation";
    await evaluate("window.probe.navigate()");
    await evaluate("window.probe.start(); window.probe.resize(20)");
    await record("after-navigation");
    scenario = "virtual-table";
    await evaluate("window.probe.prepareTable()");
    await evaluate("window.probe.start(); window.probe.typography()");
    await record("virtual-table");
    scenario = "source-mode";
    await evaluate("window.probe.switchToSource()");
    await evaluate("window.probe.prepare()");
    await evaluate("window.probe.start(); window.probe.resize(20)");
    await record("source-mode");
    assert.equal(await evaluate("window.markdownLayoutFixture.readCount"), 2, "Geometry or mode changes reloaded a file");
    assert.equal(errors.length, 0, errors.join("\n"));

  } catch (error) {
    failure = error?.stack ?? String(error);
    if (window && !window.isDestroyed()) await fs.writeFile(path.join(artifactDirectory, "failure.png"), (await window.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    await fs.writeFile(path.join(artifactDirectory, "result.json"), JSON.stringify({ passed: !failure, source, results, errors, failure }, null, 2));
    console.log(`Layout evidence: ${artifactDirectory}`);
    window?.destroy();
    await vite?.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

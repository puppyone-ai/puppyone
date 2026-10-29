#!/usr/bin/env electron
// Chromium geometry/hit-test regression; --manual also leaves an isolated
// window open for native mouse dragging, with move events recorded to stdout.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-header-drag-"));
app.setPath("userData", path.join(temporary, "user-data"));
const manual = process.argv.includes("--manual");
let server;
let window;
const observations = [];
const guard = setTimeout(() => app.exit(1), 300_000);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.on("window-all-closed", () => {});
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });

async function run() {
try {
  server = await createServer({ root: repo, cacheDir: path.join(temporary, "vite-cache"),
    server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/platform/native-surfaces/titlebar-drag.html`;
  window = new BrowserWindow({ title: "Header drag regression", width: 996, height: 600,
    x: 180, y: 120, show: manual, titleBarStyle: "hiddenInset",
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function ready() {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await evaluate("Boolean(document.querySelector('[data-drag-fixture]'))")) {
        await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
        return;
      }
      await wait(50);
    }
    throw new Error("Header fixture did not mount");
  }
  for (const width of [996, 640]) for (const centered of [false, true]) for (const mode of ["empty-host", "none", "files", "overflow", "chat", "terminal"]) {
    window.setContentSize(width, 600);
    await window.loadURL(`${base}?mode=${mode}&cloud=true&centered=${centered}`);
    await ready();
    const result = await evaluate(`(() => {
      const fill = document.querySelector('.desktop-titlebar-drag-fill');
      const rect = fill.getBoundingClientRect();
      const exclusions = [...document.querySelectorAll('.desktop-titlebar *')].filter(el =>
        getComputedStyle(el).getPropertyValue('-webkit-app-region') === 'no-drag');
      const blocked = (x, y) => exclusions.filter(el => {
        const r = el.getBoundingClientRect();
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (/(hidden|auto|scroll|clip)/.test(style.overflowX) && (x < clip.left || x >= clip.right)) return false;
          if (/(hidden|auto|scroll|clip)/.test(style.overflowY) && (y < clip.top || y >= clip.bottom)) return false;
        }
        return r.width && r.height && getComputedStyle(el).visibility !== 'hidden'
          && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      }).map(el => el.className);
      const blankX = rect.right - 16, y = rect.top + rect.height / 2;
      const buttons = [...document.querySelectorAll('.desktop-titlebar button')];
      return { width: innerWidth, mode: document.querySelector('[data-drag-fixture]').dataset.dragFixture,
        fillWidth: rect.width, blank: { x: blankX, y }, blocked: blocked(blankX, y),
        controlsExcluded: buttons.every(el => getComputedStyle(el).getPropertyValue('-webkit-app-region') === 'no-drag'),
        emptyCenterBlocked: blocked(rect.left + rect.width / 2, y) };
    })()`);
    observations.push({ ...result, centered });
    assert(result.fillWidth >= 32, `No usable drag space (${centered}): ${JSON.stringify(result)}`);
    assert.deepEqual(result.blocked, [], `Header blank space is excluded: ${JSON.stringify(result)}`);
    assert(result.controlsExcluded, `Header buttons must remain clickable: ${JSON.stringify(result)}`);
    if (!centered && ["empty-host", "none"].includes(mode)) assert.deepEqual(result.emptyCenterBlocked, []);
  }
  console.log(JSON.stringify({ ok: true, observations }));
  if (manual) {
    window.setContentSize(996, 600);
    await window.loadURL(`${base}?mode=empty-host&cloud=true`);
    await ready();
    const record = async () => {
      const bounds = window.getBounds();
      console.log(JSON.stringify({ nativeWindowBounds: bounds }));
      await evaluate(`document.querySelector('#native-bounds').textContent = ${JSON.stringify(JSON.stringify(bounds))}`);
    };
    window.on("moved", record);
    window.show();
    await record();
    console.log(`HEADER_DRAG_READY ${temporary}`);
    await new Promise(resolve => window.once("closed", resolve));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(guard);
  if (window && !window.isDestroyed()) window.destroy();
  await server?.close();
  app.exit(process.exitCode || 0);
}
}

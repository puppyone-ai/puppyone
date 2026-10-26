#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer as reservePort } from "node:net";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-table-move-"));
const artifacts = process.env.PUPPYONE_TABLE_MOVE_ARTIFACT_DIR || await (async () => {
  const directory = path.join(root, "artifacts/tests/editor/table-move-selection");
  await fs.mkdir(directory, { recursive: true });
  return fs.mkdtemp(path.join(directory, "run-"));
})();
await fs.mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "",
  electron: process.versions.electron, chromium: process.versions.chrome,
};
const results = [], errors = [];
const cases = [
  { axis: "row", row: 0, column: 0, label: "Move row down", text: "Project files", entry: "menu" },
  { axis: "row", row: 1, column: 0, label: "Move row up", text: "Workspace", entry: "menu" },
  { axis: "column", row: 0, column: 0, label: "Move column right", text: "Order", entry: "menu" },
  { axis: "column", row: 0, column: 1, label: "Move column left", text: "Area", entry: "menu" },
  { axis: "row", row: 0, column: 0, label: "Move row down", text: "Project files", entry: "keyboard" },
  { axis: "column", row: 0, column: 0, label: "Move column right", text: "Order", entry: "keyboard" },
  { axis: "row", row: 0, column: 0, text: "Project files", entry: "drag" },
  { axis: "column", row: 0, column: 0, text: "Order", entry: "drag" },
];
const wait = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));
let browser, vite, failure;

function assertSelection(metrics, axis, text) {
  assert(metrics.outline, "move lost the structural outline");
  assert.equal(metrics.axis, axis);
  assert(metrics.structuralTarget?.text?.includes(text), "selection did not follow the moved content");
  assert.equal(metrics.activeTableCell, null, "move entered cell editing");
  assert.equal(metrics.focusedTableCellCount, 0, "move painted a cell focus ring");
  const near = (a, b) => assert(Math.abs(a - b) <= 1, `outline geometry: ${a} vs ${b}`);
  if (axis === "row") {
    near(metrics.outline.y, metrics.target.y);
    near(metrics.outline.height, metrics.target.height);
    near(metrics.outline.width, metrics.table.width);
  } else {
    near(metrics.outline.x, metrics.target.x);
    near(metrics.outline.width, metrics.target.width);
    near(metrics.outline.height, metrics.table.height);
  }
}

app.whenReady().then(async () => {
  try {
    const reservation = reservePort();
    await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error",
      // Pre-bundle the fixture's whole graph: with HMR off, a dependency found
      // mid-run re-optimizes and later page loads get outdated (504) chunks.
      optimizeDeps: { entries: ["tests/fixtures/editor/tables/table-interaction.html"] },
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
    await vite.listen();
    const url = `http://127.0.0.1:${port}/tests/fixtures/editor/tables/table-interaction.html`;
    // Each case gets a fresh renderer. Reloading one renderer with ~1,500
    // unbundled dev modules exhausts Chromium's per-process request budget on
    // Linux (net::ERR_INSUFFICIENT_RESOURCES), and the fixture never loads.
    const openFixtureWindow = async () => {
      if (browser && !browser.isDestroyed()) browser.destroy();
      browser = new BrowserWindow({ width: 1150, height: 1100, show: false,
        webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      browser.webContents.on("console-message", details => {
        if (details.level === "error" && !details.message.includes("Electron Security Warning")) errors.push(details.message);
      });
      await browser.loadURL(url);
      browser.webContents.debugger.attach("1.3");
      await browser.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    };
    const evaluate = code => browser.webContents.executeJavaScript(code);
    let leftButtonDown = false;
    const mouse = (type, point) => {
      if (type === "mouseDown") leftButtonDown = true;
      browser.webContents.sendInputEvent({ type, ...point,
        modifiers: leftButtonDown ? ["leftButtonDown"] : [],
        ...(type === "mouseMove" ? {} : { button: "left", clickCount: 1 }) });
      if (type === "mouseUp") leftButtonDown = false;
    };
    const click = async point => { mouse("mouseMove", point); mouse("mouseDown", point); mouse("mouseUp", point); await wait(); };
    const key = async keyCode => {
      browser.webContents.sendInputEvent({ type: "keyDown", keyCode });
      if (keyCode === "Enter") browser.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      browser.webContents.sendInputEvent({ type: "keyUp", keyCode });
      await wait(30);
    };
    for (const theme of ["light", "dark"]) for (const kind of ["csv", "markdown"]) for (const test of cases) {
      await openFixtureWindow();
      // A cold Vite compile on a CI runner can take longer than five seconds.
      await evaluate("(async () => { for(let i=0;i<3000&&!window.tableFixture;i++) await new Promise(r=>setTimeout(r,10)); if(!window.tableFixture) throw new Error('Table fixture did not load within 30s'); await window.tableFixture.ready(); })()");
      await evaluate(`window.tableFixture.mode('${theme}')`);
      const metrics = () => evaluate(`window.tableFixture.metrics('${kind}')`);
      const before = await metrics();
      const point = await evaluate(`window.tableFixture.cellPoint('${kind}', ${test.row}, ${test.column})`);
      // Begin with a real in-table editing focus; a move must end it.
      await click(point);
      mouse("mouseMove", point); await wait();
      const handle = await evaluate(`window.tableFixture.point('${kind}', '.po-editable-table-${test.axis}-handle')`);
      if (test.entry === "drag") {
        const target = await evaluate(`window.tableFixture.cellPoint('${kind}', ${test.axis === "row" ? 3 : 0}, ${test.axis === "column" ? 3 : 0})`);
        mouse("mouseMove", handle); mouse("mouseDown", handle);
        for (let step = 1; step <= 8; step++) {
          mouse("mouseMove", { x: Math.round(handle.x + (target.x - handle.x) * step / 8),
            y: Math.round(handle.y + (target.y - handle.y) * step / 8) });
          await wait(20);
        }
        mouse("mouseUp", target);
      } else {
        await click(handle);
        const selector = kind === "csv" ? ".csv-table-editor__context-menu" : ".cm-md-table-context-menu";
        assert.equal(await evaluate(`document.querySelector('${selector}').querySelectorAll('.desktop-menu-section-label').length`), 0);
        if (test.entry === "keyboard") {
          for (let step = 0; step < 20 && await evaluate("document.activeElement.getAttribute('aria-label')") !== test.label; step++) await key("Right");
          assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), test.label);
          await key("Enter");
        } else {
          const button = await evaluate(`(() => { const r=document.querySelector('${selector} [aria-label="${test.label}"]').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()`);
          await click(button);
        }
        assert.equal(await evaluate(`!!document.querySelector('${selector}')`), false);
      }
      await wait(700);
      // The move settles over a few frames; a loaded runner may need longer than 700ms.
      let after = await metrics();
      for (let attempt = 0; attempt < 40; attempt++) {
        try { assertSelection(after, test.axis, test.text); break; }
        catch (error) { if (attempt === 39) throw error; await wait(50); after = await metrics(); }
      }
      assert.notEqual(kind === "csv" ? after.csvSource : after.markdown, kind === "csv" ? before.csvSource : before.markdown);
      const name = `${theme}-${kind}-${test.entry}-${test.label ?? test.axis}`.replaceAll(" ", "-");
      await fs.writeFile(path.join(artifacts, `${name}.png`), (await browser.webContents.capturePage()).toPNG());
      // Escape clears a completed structural selection without a source edit.
      await key("Escape");
      // Escape is applied on the renderer's next frames; wait for it rather than racing a slow runner.
      let cleared = await metrics();
      for (let attempt = 0; attempt < 40 && cleared.outline !== null; attempt++) { await wait(50); cleared = await metrics(); }
      assert.equal(cleared.outline, null);
      assert.equal(kind === "csv" ? cleared.csvSource : cleared.markdown, kind === "csv" ? after.csvSource : after.markdown);
      results.push({ theme, kind, ...test, structuralTarget: after.structuralTarget, outline: after.outline,
        focusedTableCellCount: after.focusedTableCellCount, sourceChanged: true, escapeCleared: true });
      console.log(`PASS ${name}`);
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error.stack ?? String(error);
    if (browser && !browser.isDestroyed()) await fs.writeFile(path.join(artifacts, "failure.png"), (await browser.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: !failure, source, results, errors, failure }, null, 2) + "\n");
    browser?.destroy(); await vite?.close(); await fs.rm(temporary, { recursive: true, force: true });
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

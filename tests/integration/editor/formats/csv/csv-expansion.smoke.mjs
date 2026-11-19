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

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-csv-expansion-"));
const artifactRoot = path.join(root, "artifacts/tests/editor/csv-expansion");
await fs.mkdir(artifactRoot, { recursive: true });
const artifacts = await fs.mkdtemp(path.join(artifactRoot, "run-"));
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
const source = { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "",
  electron: process.versions.electron, chrome: process.versions.chrome };
const results = [], errors = [];
let window, vite, failure;
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { console.error("CSV verification timed out"); app.exit(1); }, 60000);
  try {
    const reservation = reservePort();
    await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error",
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
    await vite.listen();
    window = new BrowserWindow({ show: false, width: 1100, height: 800,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    window.webContents.on("console-message", details => {
      if (details.level === "error") errors.push(details.message);
    });
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const metrics = () => evaluate("window.csvExpansionFixture.metrics()");
    const settle = () => evaluate("window.csvExpansionFixture.settle()");
    const screenshot = async name => fs.writeFile(path.join(artifacts, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    await window.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/tables/csv-expansion.html`);
    await evaluate(`(async () => { for(let i=0;i<500&&!window.csvExpansionFixture;i++) await new Promise(r=>setTimeout(r,10)); await window.csvExpansionFixture.ready(); })()`);
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    const mouse = (type, point, down) => window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type, ...point, button: "left", buttons: down ? 1 : 0, clickCount: 1,
    });
    const startDrag = async (dx, dy) => {
      const from = await evaluate("window.csvExpansionFixture.corner()");
      const to = { x: from.x + dx, y: from.y + dy };
      await mouse("mousePressed", from, true);
      for(let step=1;step<=6;step++) await mouse("mouseMoved", {
        x: from.x + dx * step / 6, y: from.y + dy * step / 6,
      }, true);
      await settle();
      return to;
    };
    const release = async point => { await mouse("mouseReleased", point, false); await settle(); };
    const assertShape = (value, rows, columns) => {
      assert.equal(value.modelRows, rows); assert.equal(value.modelColumns, columns);
      assert.equal(value.rows, rows, "rendered rows diverged from source");
      assert.equal(value.columns, columns, "rendered columns diverged from source");
      assert.equal(value.previews, 0); assert(value.mountedCells <= 2_000);
    };
    for(const mode of ["light", "dark"]) {
      for(const [axis, dx, dy, rows, columns] of [["rows", 0, 93, 5, 2], ["columns", 288, 0, 2, 5], ["both", 288, 93, 5, 5]]) {
        await evaluate(`window.csvExpansionFixture.reset('${mode}')`);
        const to = await startDrag(dx, dy);
        const preview = await metrics();
        assert.equal(preview.localEdits, 0, "preview mutated the document");
        assert(preview.previews > 0, "real mouse drag did not preview expansion");
        await release(to);
        const immediate = await metrics();
        assertShape(immediate, rows, columns); assert.equal(immediate.localEdits, 1);
        await new Promise(resolve => setTimeout(resolve, 220));
        assertShape(await metrics(), rows, columns);
        await screenshot(`${mode}-${axis}`);
        await evaluate("window.csvExpansionFixture.history(false)");
        assertShape(await metrics(), 2, 2);
        await evaluate("window.csvExpansionFixture.history(true)");
        assertShape(await metrics(), rows, columns);
        const repeatTarget = await startDrag(96, 31);
        const repeatPreview = await metrics();
        await release(repeatTarget);
        const repeated = await metrics();
        assertShape(repeated, rows + 1, columns + 1); assert.equal(repeated.localEdits, 4);
        await evaluate("window.csvExpansionFixture.visitAwayAndBack()");
        const returned = await metrics();
        assertShape(returned, rows + 1, columns + 1); assert.equal(returned.source, repeated.source);
        assert.equal(returned.localEdits, repeated.localEdits);
        results.push({ mode, axis, immediate, repeatPreview, repeated, returned });
      }
      await evaluate(`window.csvExpansionFixture.reset('${mode}', 500)`);
      const before = await metrics();
      const to = await startDrag(0, 31);
      const preview = await metrics();
      assert.equal(preview.previewTracks, preview.tracks, "wide preview created untracked columns");
      assert(preview.previewCells < 30, "wide preview bypassed column virtualization");
      assert(Math.abs(preview.width - before.width) <= 1, "row preview changed the table width");
      assert.equal(preview.localEdits, 0);
      await screenshot(`${mode}-wide-preview`);
      await release(to);
      const committed = await metrics();
      assert.equal(committed.modelRows, 3); assert.equal(committed.modelColumns, 500);
      assert.equal(committed.rows, 3); assert.equal(committed.localEdits, 1);
      assert.equal(committed.previews, 0); assert(committed.mountedCells <= 2_000);
      results.push({ mode, axis: "wide-row-preview", before, preview, committed });
      for (const rtl of [false, true]) {
        await evaluate(`window.csvExpansionFixture.reset('${mode}', 20, ${rtl})`);
        const from = await evaluate("window.csvExpansionFixture.corner()");
        const initial = await metrics();
        const edge = { x: rtl ? initial.scroll.left - 12 : initial.scroll.right + 12, y: from.y };
        await mouse("mousePressed", from, true);
        await mouse("mouseMoved", edge, true);
        // Keep the pointer stationary: edge scrolling must continue without more events.
        for(let attempt=0;attempt<100;attempt++) {
          if((await metrics()).previewColumns >= 5) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        await screenshot(`${mode}-edge-${rtl ? "rtl" : "ltr"}`);
        const edgePreview = await metrics();
        assert(edgePreview.previewColumns >= 5, "full viewport blocked further expansion");
        assert(edgePreview.scrollOffset > initial.scrollOffset + 100, "viewport did not follow the preview");
        assert.equal(edgePreview.modelColumns, 20); assert.equal(edgePreview.localEdits, 0);
        assert(edgePreview.mountedCells <= 2_000);
        assert(edgePreview.columns > 0, "edge preview lost the existing column projection");
        await release(edge);
        const edgeCommit = await metrics();
        assert.equal(edgeCommit.modelColumns, 20 + edgePreview.previewColumns);
        assert.equal(edgeCommit.localEdits, 1); assert.equal(edgeCommit.previews, 0);
        assert.equal(edgeCommit.lastColumn, edgeCommit.modelColumns - 1, "new columns were not visible after release");
        assert(Math.abs(edgeCommit.scrollOffset - edgePreview.scrollOffset) < 48, `commit jumped away from the new columns: ${edgePreview.scrollOffset}→${edgeCommit.scrollOffset}`);
        await evaluate("window.csvExpansionFixture.history(false)");
        assert.equal((await metrics()).modelColumns, 20);
        await evaluate("window.csvExpansionFixture.history(true)");
        assert.equal((await metrics()).modelColumns, edgeCommit.modelColumns);
        await evaluate("window.csvExpansionFixture.visitAwayAndBack()");
        assert.equal((await metrics()).source, edgeCommit.source);
        results.push({ mode, axis: "edge-scroll", rtl, initial, edgePreview, edgeCommit });
      }
      await evaluate(`window.csvExpansionFixture.reset('${mode}', 20)`);
      const cancelFrom = await evaluate("window.csvExpansionFixture.corner()");
      const cancelInitial = await metrics();
      const cancelEdge = { x: cancelInitial.scroll.right + 12, y: cancelFrom.y };
      await mouse("mousePressed", cancelFrom, true); await mouse("mouseMoved", cancelEdge, true);
      await new Promise(resolve => setTimeout(resolve, 500));
      assert((await metrics()).previewColumns >= 2);
      await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await release(cancelEdge); await new Promise(resolve => setTimeout(resolve, 220));
      const cancelled = await metrics();
      assert.equal(cancelled.source, cancelInitial.source); assert.equal(cancelled.localEdits, 0);
      assert.equal(cancelled.previews, 0); assert(Math.abs(cancelled.scrollOffset - cancelInitial.scrollOffset) <= 1);
      results.push({ mode, axis: "edge-cancel", cancelled });
    }
    assert.deepEqual(errors, [], "renderer errors during expansion");
    console.log(JSON.stringify({ passed: true, cases: results.length, artifacts }));
  } catch(error) {
    failure = String(error.stack || error);
    console.error(error);
    if(window) await fs.writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG());
  } finally {
    await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: !failure, source, results, errors, failure }, null, 2));
    clearTimeout(watchdog); window?.destroy(); await vite?.close();
    await fs.rm(temporary, { recursive: true, force: true }); app.exit(failure ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });

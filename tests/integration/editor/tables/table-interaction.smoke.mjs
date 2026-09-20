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
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-table-style-"));
const artifacts = process.env.PUPPYONE_TABLE_INTERACTION_ARTIFACT_DIR || await (async () => {
  const directory = path.join(root, "artifacts/tests/editor/table-interaction");
  await fs.mkdir(directory, { recursive: true }); return fs.mkdtemp(path.join(directory, "run-"));
})();
await fs.mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
const source = { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "",
  electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform };
const results = [], errors = [];
let window, vite, failure;
const wait = () => new Promise(resolve => setTimeout(resolve, 160));
const near = (a, b, message) => assert(Math.abs(a - b) <= 1, `${message}: ${a} vs ${b}`);
app.whenReady().then(async () => {
  try {
    const reservation = reservePort(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error",
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
    await vite.listen();
    window = new BrowserWindow({ width: 1100, height: 970, show: true,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.webContents.on("console-message", details => {
      if ((details.level === "error" || details.level === "warning") && !details.message.includes("Electron Security Warning")) errors.push(details.message);
    });
    const evaluate = code => window.webContents.executeJavaScript(code);
    const screenshot = async name => fs.writeFile(path.join(artifacts, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    const click = async point => {
      window.webContents.sendInputEvent({ type: "mouseMove", ...point });
      window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point }); await wait();
    };
    const escape = async () => { window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" }); window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" }); await wait(); };
    await window.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/tables/table-interaction.html`);
    await evaluate(`(async () => { for (let i=0; i<500 && !window.tableFixture; i++) await new Promise(r=>setTimeout(r,10)); await window.tableFixture.ready(); })()`);
    window.webContents.debugger.attach("1.3");
    const reducedMotion = value => window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: value ? "reduce" : "no-preference" }],
    });
    for (const mode of ["light", "dark"]) {
      await evaluate(`window.tableFixture.mode('${mode}')`);
      await screenshot(`${mode}-rest`);
      for (const kind of ["markdown", "csv"]) {
        const metrics = () => evaluate(`window.tableFixture.metrics('${kind}')`);
        const baseline = await metrics();
        assert.equal(baseline.radius, "0px", `${kind} must have square corners`);
        assert.equal(baseline.border, "1px", `${kind} outer stroke`);
        assert.equal(baseline.cellBorder, "1px", `${kind} cell stroke`);
        near(baseline.grip.width, 22, "compact grip width"); near(baseline.grip.height, 14, "compact grip height");
        assert.equal(baseline.gripShadow, "none", "grip must not look raised");
        assert.deepEqual(baseline.dots, { width: "12px", height: "4px" }, "column handle needs a single line of three dots");
        for (const reduced of [false, true]) {
          await reducedMotion(reduced);
          window.webContents.sendInputEvent({ type: "mouseMove", x: 3, y: 3 }); await wait();
          window.webContents.sendInputEvent({ type: "mouseMove", ...await evaluate(`window.tableFixture.cellPoint('${kind}', 0, 0)`) });
          const reveal = await evaluate(`window.tableFixture.captureHandleMotion('${kind}')`);
          assert.equal(reveal.properties.length, 0, "first reveal flew in from a stale cell");
          await wait();
          window.webContents.sendInputEvent({ type: "mouseMove", ...await evaluate(`window.tableFixture.cellPoint('${kind}', 3, 2)`) });
          const motion = await evaluate(`window.tableFixture.captureHandleMotion('${kind}')`);
          if (reduced) assert.equal(motion.properties.length, 0, "reduced motion still glides");
          else {
            assert(motion.properties.includes("left") && motion.properties.includes("top"), "row/column pointer following lost its animation");
            for (const [index, axis] of [[0, "x"], [1, "y"]]) {
              const [start, middle, end] = motion.frames.map(frame => frame.handles[index][axis]);
              assert(end - start > 10 && middle > start + 1 && middle < end - 1, `${kind} ${axis} handle did not glide between cells`);
            }
          }
          if (!reduced) {
            window.webContents.sendInputEvent({ type: "mouseMove", ...await evaluate(`window.tableFixture.cellPoint('${kind}', 0, 0)`) });
            const interrupted = await evaluate(`window.tableFixture.captureHandleMotion('${kind}', true)`);
            assert(interrupted.properties.length > 0, "rapid retarget fixture never started moving");
            window.webContents.sendInputEvent({ type: "mouseMove", ...await evaluate(`window.tableFixture.cellPoint('${kind}', 2, 1)`) });
            const retargeted = await evaluate(`window.tableFixture.captureHandleMotion('${kind}')`);
            for (const [index, axis] of [[0, "x"], [1, "y"]]) {
              near(retargeted.frames[0].handles[index][axis], interrupted.held[index][axis], `${kind} rapid retarget jumped away from its visible position`);
            }
            results.push({ mode, kind, state: "handle-rapid-retarget", interrupted, retargeted });
          }
          results.push({ mode, kind, state: "handle-motion", reduced, reveal, motion });
        }
        await reducedMotion(false);
        const point = await evaluate(`window.tableFixture.point('${kind}')`);
        window.webContents.sendInputEvent({ type: "mouseMove", ...point }); await wait();
        assert.deepEqual((await metrics()).backgrounds, baseline.backgrounds, "hover tinted cells");
        await click(point);
        await evaluate(`window.tableFixture.selectText('${kind}')`); await wait();
        const focused = await metrics();
        assert.deepEqual(focused.backgrounds, baseline.backgrounds, "text editing/selection tinted cells");
        assert.notEqual(focused.textSelectionBackground, "rgba(0, 0, 0, 0)", "cell editing lost product text selection");
        assert.match(focused.cellFocus, /2px/, "focused cell needs a crisp outline");
        near(focused.table.width, baseline.table.width, "focus changed column geometry");
        await screenshot(`${mode}-${kind}-editing`);
        for (const axis of ["column", "row"]) {
          const handle = await evaluate(`window.tableFixture.point('${kind}', '.po-editable-table-${axis}-handle')`);
          await click(handle);
          const selected = await metrics();
          assert(selected.outline && selected.target, `${kind}: ${axis} selection perimeter missing`);
          assert.equal(selected.axis, axis);
          assert.equal(selected.outlineBorder, "2px");
          assert.equal(selected.textSelectionBackground, "rgba(0, 0, 0, 0)", "structural selection painted a second text highlight");
          assert.deepEqual(selected.backgrounds, baseline.backgrounds, `${axis} selection tinted cells`);
          if (axis === "column") {
            near(selected.outline.x, selected.target.x, `${kind} column left`);
            near(selected.outline.width, selected.target.width, `${kind} column width`);
            near(selected.outline.height, selected.table.height, `${kind} column height`);
          } else {
            near(selected.outline.y, selected.target.y, `${kind} row top`);
            near(selected.outline.height, selected.target.height, `${kind} row height`);
            near(selected.outline.width, selected.table.width, `${kind} row width`);
          }
          await screenshot(`${mode}-${kind}-${axis}`);
          results.push({ mode, kind, state: axis, ...selected });
          await escape();
          assert.equal((await metrics()).outline, null, "closed menu left a stale perimeter");
        }
        // Native pointer capture + Escape must remove the perimeter without a source edit.
        window.webContents.sendInputEvent({ type: "mouseMove", ...point }); await wait();
        const grip = await evaluate(`window.tableFixture.point('${kind}', '.po-editable-table-column-handle')`);
        window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...grip });
        window.webContents.sendInputEvent({ type: "mouseMove", ...grip, x: grip.x + 60 }); await wait();
        assert((await metrics()).outline, "drag source perimeter missing");
        assert.deepEqual((await metrics()).backgrounds, baseline.backgrounds, "drag tinted source cells");
        const frames = await evaluate(`window.tableFixture.layoutFrames('${kind}')`);
        assert(frames.some(frame => frame.scrollLeft > 0), "fixture did not exercise horizontal overflow");
        for (const frame of frames) {
          assert(frame.outline && frame.target, "layout lost the semantic selection target");
          near(frame.outline.x, frame.target.x, "resize/scroll perimeter origin");
          near(frame.outline.width, frame.target.width, "resize/scroll perimeter extent");
        }

        results.push({ mode, kind, state: "drag-layout-frames", frames });
        await escape();
        window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...grip }); await wait();
        assert.equal((await metrics()).outline, null, "cancel left a stale drag perimeter");
        if (kind === "markdown") {
          app.focus({ steal: true }); window.focus(); window.webContents.focus();
          await evaluate("window.tableFixture.selectMarkdownTable()"); await wait();
          const block = await metrics();
          results.push({ mode, kind, state: "block", ...block });
          assert(block.blockSelected, "whole Markdown table was not selected");
          assert.equal(block.textSelectionBackground, "rgba(0, 0, 0, 0)");
          assert.match(block.tableShadow, /1px/, "block perimeter missing");
          assert.deepEqual(block.backgrounds, baseline.backgrounds, "block selection tinted cells");
          await screenshot(`${mode}-markdown-block`);
          await click(point);
        }
        results.push({ mode, kind, state: "editing-drag-cancel-block", ...focused });
        assert.equal((await metrics()).markdown, baseline.markdown, "styling altered Markdown source");
        assert.equal((await metrics()).csvSource, baseline.csvSource, "styling altered CSV source");
      }
    }
    for (const kind of ["markdown", "csv"]) {
      await click(await evaluate(`window.tableFixture.point('${kind}')`));
      await evaluate(`window.tableFixture.selectText('${kind}')`);
      await window.webContents.insertText("Edited");
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" }); await wait();
      const edited = await evaluate(`window.tableFixture.metrics('${kind}')`);
      assert((kind === "markdown" ? edited.markdown : edited.csvSource).includes("Edited"), `${kind} edit did not reach source`);
      results.push({ kind, state: "source-edit", ...edited });
    }
    assert.equal(errors.length, 0, errors.join("\n"));
  } catch (error) {
    failure = error?.stack ?? String(error);
    if (window && !window.isDestroyed()) await fs.writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: !failure, source, results, errors, failure }, null, 2));
    console.log(`Table interaction evidence: ${artifacts}`);
    window?.destroy(); await vite?.close(); await fs.rm(temporary, { recursive: true, force: true });
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

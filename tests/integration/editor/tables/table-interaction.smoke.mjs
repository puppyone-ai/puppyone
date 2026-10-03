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
const assertActiveHandle = (metrics, axis, phase) => {
  const handle = metrics.handleStates.find(handle => handle.axis === axis);
  assert(metrics.outline, `${phase}: missing selection perimeter`);
  assert.equal(handle.background, metrics.outlineColor, `${phase}: handle face lagged behind the selection stroke`);
  assert.equal(handle.border, metrics.outlineColor, `${phase}: handle rim must use the same blue as the perimeter`);
  assert.equal(handle.color, "rgb(255, 255, 255)", `${phase}: selected grip dots must be legible`);
  assert.equal(handle.backgroundAlpha, 255, `${phase}: active grip must remain opaque`);
  assert.equal(handle.transitionDuration, "0s", `${phase}: active feedback must not fade in independently`);
};
app.whenReady().then(async () => {
  try {
    const reservation = reservePort(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error",
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
    await vite.listen();
    window = new BrowserWindow({ width: 1100, height: 970,
      show: process.env.PUPPYONE_TABLE_INTERACTION_HIDDEN !== "1",
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
        assert.equal(baseline.gripStyles.length, 2, "row and column grips must share the table style");
        for (const gripStyle of baseline.gripStyles) {
          assert.equal(gripStyle.radius, "2px", `${kind} grip must have a small corner radius`);
          assert.equal(gripStyle.border, baseline.border, `${kind} grip stroke must match the table`);
          assert.equal(gripStyle.backgroundAlpha, 255, `${kind} grip must have a fully opaque background`);
          assert(gripStyle.backgroundImage.includes(baseline.borderColor), `${kind} grip tint must use the table border color`);
          assert.equal(gripStyle.backgroundClip, "padding-box, border-box", `${kind} opaque base must cover the face and rim`);
          assert.notEqual(gripStyle.borderColor, gripStyle.backgroundColor, `${kind} grip rim must remain distinct from its fill`);
        }
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
        await screenshot(`${mode}-${kind}-handles-visible`);
        for (const axis of ["column", "row"]) {
          window.webContents.sendInputEvent({ type: "mouseMove", ...await evaluate(`window.tableFixture.point('${kind}', '.po-editable-table-${axis}-handle')`) });
          await wait();
          assert.deepEqual((await metrics()).gripStyles, baseline.gripStyles, `${kind} ${axis} hover must keep the table palette and radius`);
          if (kind === "markdown") {
            await evaluate("new Promise(resolve => setTimeout(resolve, 500))");
            assert.equal(await evaluate("document.querySelector('[role=tooltip]') !== null"), false, "Markdown handle hover opened a hint bubble");
          }
        }
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
          window.webContents.sendInputEvent({ type: "mouseMove", ...handle });
          window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...handle });
          await evaluate("new Promise(requestAnimationFrame)");
          const pressed = await metrics();
          assertActiveHandle(pressed, axis, `${kind} ${axis} pointer-down`);
          assert.equal(pressed.handleStates.find(handle => handle.axis === axis).pressed, true);
          assert.equal(pressed.handleStates.find(handle => handle.axis === axis).dragging, false);
          assert.deepEqual(pressed.backgrounds, baseline.backgrounds, "press tinted cells");
          results.push({ mode, kind, state: `${axis}-pressed`, ...pressed });
          await screenshot(`${mode}-${kind}-${axis}-pressed`);
          window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...handle });
          await wait();
          const selected = await metrics();
          const placement = await evaluate(`window.tableFixture.menuPlacement('${kind}', '${axis}')`);
          if (axis === "row") {
            near(placement.menu.x, placement.grip.x, `${kind} row menu must align with the grip's inline start`);
            assert(placement.menu.y >= placement.grip.y + placement.grip.height + 3,
              `${kind} row menu must open below the grip instead of beside the selected row`);
          }
          assertActiveHandle(selected, axis, `${kind} ${axis} menu-open`);
          assert.equal(selected.handleStates.find(handle => handle.axis === axis).pressed, false);
          assert.equal(selected.handleStates.find(handle => handle.axis === axis).menuActive, true);
          assert(selected.outline && selected.target, `${kind}: ${axis} selection perimeter missing`);
          assert.equal(selected.axis, axis);
          assert.equal(selected.outlineBorder, "2px");
          if (kind === "markdown") {
            const menuHints = await evaluate(`(() => {
              const menu = document.querySelector('.cm-md-table-context-menu');
              return { disabled: menu.dataset.tooltipDisabled, hints: menu.querySelectorAll('[data-tooltip], [title]').length,
                bubble: document.querySelector('[role=tooltip]') !== null };
            })()`);
            assert.deepEqual(menuHints, { disabled: "true", hints: 0, bubble: false }, "Markdown menu focus opened a redundant hint bubble");
            const menu = await evaluate("window.tableFixture.menuMetrics()");
            assert.equal(menu.headings, 0, "Markdown menu must not render section headings");
            near(menu.bounds.width, menu.requiredWidth, "menu has surplus right-side width");
            assert.equal(menu.buttons, axis === "column" ? 8 : 6);
            assert.deepEqual(menu.groups, axis === "column" ? ["Columns", "Alignment"] : ["Rows"]);
            assert.deepEqual(menu.radios, axis === "column" ? [
              { label: "Align left", checked: "true" }, { label: "Align center", checked: "false" },
              { label: "Align right", checked: "false" },
            ] : []);
            results.push({ mode, kind, state: `${axis}-menu-layout`, ...menu });
          }
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
          const closed = await metrics();
          assert.equal(closed.outline, null, "closed menu left a stale perimeter");
          assert(closed.handleStates.every(handle => !handle.pressed && !handle.dragging && !handle.menuActive), "menu left active handle state");
        }
        if (kind === "markdown") {
          await evaluate("window.tableFixture.openMenuAtEdge()"); await wait();
          const menu = await evaluate("window.tableFixture.menuMetrics()");
          near(menu.bounds.width, menu.requiredWidth, "cell menu does not hug its longest row");
          assert.equal(menu.headings, 0);
          assert.equal(menu.buttons, 15);
          assert(menu.bounds.x >= 8 && menu.bounds.y >= 8, "edge menu overflowed viewport origin");
          assert(menu.bounds.x + menu.bounds.width <= menu.viewport.width - 8, "edge menu overflowed right viewport");
          assert(menu.bounds.y + menu.bounds.height <= menu.viewport.height - 8, "edge menu overflowed bottom viewport");
          results.push({ mode, kind, state: "cell-menu-edge", ...menu });
          await screenshot(`${mode}-markdown-cell-edge`);
          await escape();
        }
        // Native pointer capture + Escape must remove the perimeter without a source edit.
        window.webContents.sendInputEvent({ type: "mouseMove", ...point }); await wait();
        const grip = await evaluate(`window.tableFixture.point('${kind}', '.po-editable-table-column-handle')`);
        window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...grip });
        window.webContents.sendInputEvent({ type: "mouseMove", ...grip, x: grip.x + 60 }); await wait();
        const dragging = await metrics();
        assertActiveHandle(dragging, "column", `${kind} dragging`);
        assert.equal(dragging.handleStates.find(handle => handle.axis === "column").pressed, true);
        assert.equal(dragging.handleStates.find(handle => handle.axis === "column").dragging, true);
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
        const canceled = await metrics();
        assert.equal(canceled.outline, null, "cancel left a stale drag perimeter");
        assert(canceled.handleStates.every(handle => !handle.pressed && !handle.dragging && !handle.menuActive), "cancel left a highlighted handle");
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
    // A successful reorder keeps structural selection on the moved row or
    // column. It must not collapse to a destination cell or disappear.
    for (const kind of ["markdown", "csv"]) {
      const beforeRowDrop = await evaluate(`window.tableFixture.metrics('${kind}')`);
      const rowDrop = await evaluate(`window.tableFixture.drag('${kind}', 'row', 3, 0)`);
      assert.notEqual(kind === "markdown" ? rowDrop.markdown : rowDrop.csvSource,
        kind === "markdown" ? beforeRowDrop.markdown : beforeRowDrop.csvSource,
        `${kind} row reorder did not commit`);
      assert(rowDrop.outline, `${kind} row drop cleared the structural perimeter`);
      assert.equal(rowDrop.axis, "row", `${kind} row drop selected the wrong structural axis`);
      assert.match(rowDrop.structuralTarget?.text ?? "", /Project files/,
        `${kind} row selection did not follow the moved row`);
      assert.equal(rowDrop.activeTableCell, null, `${kind} row drop focused a destination cell`);
      assert.equal(rowDrop.focusedTableCellCount, 0, `${kind} row drop painted a cell focus ring`);
      results.push({ mode: "dark", kind, state: "row-drop-selected", ...rowDrop });
      await screenshot(`dark-${kind}-row-drop-selected`);

      const beforeColumnDrop = await evaluate(`window.tableFixture.metrics('${kind}')`);
      const columnDrop = await evaluate(`window.tableFixture.drag('${kind}', 'column', 0, 3)`);
      assert.notEqual(kind === "markdown" ? columnDrop.markdown : columnDrop.csvSource,
        kind === "markdown" ? beforeColumnDrop.markdown : beforeColumnDrop.csvSource,
        `${kind} column reorder did not commit`);
      assert(columnDrop.outline, `${kind} column drop cleared the structural perimeter`);
      assert.equal(columnDrop.axis, "column", `${kind} column drop selected the wrong structural axis`);
      assert.match(columnDrop.structuralTarget?.text ?? "", /Order/,
        `${kind} column selection did not follow the moved column`);
      assert.equal(columnDrop.activeTableCell, null, `${kind} column drop focused a destination cell`);
      assert.equal(columnDrop.focusedTableCellCount, 0, `${kind} column drop painted a cell focus ring`);
      results.push({ mode: "dark", kind, state: "column-drop-selected", ...columnDrop });
      await screenshot(`dark-${kind}-column-drop-selected`);
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

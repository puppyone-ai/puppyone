#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer as reservePort } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-block-drag-"));
const artifacts = process.env.PUPPYONE_BLOCK_DRAG_ARTIFACT_DIR || temporary;
await fs.mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const results = [];
let vite, port;

async function openFixture(query) {
  // Linux stops frames and CodeMirror measurement for a hidden window, so the
  // pointer scenarios need a shown one there, as the other editor gates do.
  const window = new BrowserWindow({ width: 1200, height: 800, useContentSize: true,
    show: process.platform === "linux" || process.env.PUPPYONE_BLOCK_DRAG_SHOW === "1", paintWhenInitiallyHidden: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await window.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/formats/markdown/block-drag.html?${query}`);
  const evaluate = code => window.webContents.executeJavaScript(code);
  await evaluate("(async () => { for (let i = 0; i < 3000 && !window.blockDragFixture; i++) await new Promise(r => setTimeout(r, 10)); await window.blockDragFixture.ready(); })()");
  const call = (name, ...values) => evaluate(`window.blockDragFixture.${name}(${values.map(value => JSON.stringify(value)).join(",")})`);
  const send = event => window.webContents.sendInputEvent({ ...event, x: Math.round(event.x ?? 0), y: Math.round(event.y ?? 0) });
  const hover = async (x, y) => {
    send({ type: "mouseMove", x: 4, y: 4 }); await sleep(30);
    send({ type: "mouseMove", x, y }); await sleep(60);
    return call("handle");
  };
  const press = async handle => {
    send({ type: "mouseMove", x: handle.x, y: handle.y }); await sleep(30);
    send({ type: "mouseDown", button: "left", clickCount: 1, x: handle.x, y: handle.y }); await sleep(30);
  };
  const dragTo = async (x, y) => { send({ type: "mouseMove", button: "left", modifiers: ["leftButtonDown"], x, y }); await sleep(30); };
  const release = async (x, y) => { send({ type: "mouseUp", button: "left", clickCount: 1, x, y }); await sleep(90); };
  const shot = async (name, rect) => fs.writeFile(path.join(artifacts, `${name}.png`), (await window.webContents.capturePage(rect)).toPNG());
  // A widget that just scrolled in may still be mounting, so wait for the handle
  // here. Scenarios that assert its absence keep using `hover`.
  const hoverUntilHandle = async (x, y, attempts = 12) => {
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      const handle = await hover(x, y);
      if (handle) return handle;
      await sleep(100);
    }
    return hover(x, y);
  };
  return { window, call, send, hover, hoverUntilHandle, press, dragTo, release, shot };
}

const scenarios = {
  async "every part of a row targets that row"(page) {
    const rail = await page.call("rail");
    for (const [text, kind] of [["Heading 1", "root"], ["Short paragraph 1", "root"], ["item a1", "list-item"],
      ["nested b1", "list-item"], ["nested b2", "list-item"], ["item c1", "list-item"], ["quote one 1", "root"]]) {
      const row = await page.call("row", text);
      const y = (row.top + Math.min(row.bottom, row.top + 30)) / 2;
      for (const [zone, x] of [["left gutter", rail.left - 60], ["text", rail.left + 8], ["blank space", rail.right - 12]]) {
        const handle = await page.hover(x, y);
        assert(handle, `${text} ${zone}: no handle`);
        assert.equal(handle.kind, kind, `${text} ${zone}: wrong target kind`);
        assert(handle.y >= row.top - 1 && handle.y <= row.bottom + 1, `${text} ${zone}: handle y ${handle.y} is off row ${row.top}..${row.bottom}`);
      }
    }
  },
  async "a lone list item is movable"(page) {
    const row = await page.call("row", "only item");
    assert((await page.hover(400, (row.top + row.bottom) / 2))?.kind, "no handle on a single-item list");
  },
  async "the gap between blocks keeps the handle"(page) {
    const above = await page.call("row", "Short paragraph 1"), below = await page.call("row", "Long paragraph 1");
    const nearAbove = await page.hover(400, above.bottom + 2), nearBelow = await page.hover(400, below.top - 2);
    assert(nearAbove && nearAbove.y < below.top, "gap: expected the block above");
    assert(nearBelow && nearBelow.y > above.bottom, "gap: expected the block below");
  },
  async "a nested item's handle sits beside its own marker"(page) {
    const rail = await page.call("rail");
    const row = await page.call("row", "nested b2"), top = await page.call("row", "item a1");
    const nested = await page.hover(rail.left + 100, (row.top + row.bottom) / 2);
    const outer = await page.hover(rail.left + 100, (top.top + top.bottom) / 2);
    assert(nested.x > outer.x + 16, `nested handle ${nested.x} should indent past ${outer.x}`);
    assert(Math.abs(outer.x - (rail.left - 13)) <= 2, `root item handle ${outer.x} should sit on the rail`);
  },
  async "the handle measures its marker offset in document text"(page) {
    const rail = await page.call("rail"), row = await page.call("row", "item a1");
    await page.hover(rail.left + 100, (row.top + row.bottom) / 2);
    const [handle, text] = await page.window.webContents.executeJavaScript(`[".cm-md-block-drag-handle", ".cm-content"]
      .map(selector => getComputedStyle(document.querySelector(selector)).fontSize)`);
    assert.equal(handle, text, "the handle's em offsets should resolve against the document text size");
  },
  async "widgets are reachable and align to their first row"(page) {
    await page.call("setScrollTop", 560); await sleep(160);
    for (const selector of [".cm-md-code-widget", ".cm-md-table-widget-wrap", ".cm-md-hr-widget"]) {
      const widget = await page.call("widget", selector);
      for (const fraction of [.25, .5, .85]) {
        const handle = await page.hoverUntilHandle(widget.left + 40, widget.top + (widget.bottom - widget.top) * fraction);
        assert(handle, `${selector} at ${fraction}: no handle`);
        assert(handle.y >= widget.top - 1 && handle.y <= widget.top + 40, `${selector}: handle y ${handle.y} is not on the first row of ${widget.top}`);
      }
    }
    await page.shot("widget-handle");
  },
  async "the handle scrolls with its block without help"(page) {
    const row = await page.call("row", "Short paragraph 1");
    const handle = await page.hover(400, (row.top + row.bottom) / 2);
    const placed = await page.call("handleTransform");
    assert(await page.call("scrollerContainsHandle"), "handle must live inside the scroller");
    await page.call("setScrollTop", 8); await sleep(120);
    const moved = await page.call("handle");
    assert.equal(await page.call("handleTransform"), placed, "scrolling should not reposition the handle from script");
    assert(Math.abs(handle.y - moved.y - 8) <= 1, `handle should move 8px with the text, moved ${handle.y - moved.y}`);
  },
  async "a drag shows the source, a preview, and a stable drop line"(page) {
    await page.call("setCaret", 2);
    const before = await page.call("doc");
    const rail = await page.call("rail");
    const row = await page.call("row", "Short paragraph 1"), target = await page.call("row", "item a1");
    const handle = await page.hover(400, (row.top + row.bottom) / 2);
    await page.press(handle);
    await page.dragTo(handle.x + 2, handle.y + 2);
    assert.equal(await page.call("ghost"), null, "drag started inside the threshold");
    await page.dragTo(handle.x + 40, handle.y + 30);
    const ghost = await page.call("ghost"), source = await page.call("source");
    assert.equal(ghost?.text, "Short paragraph 1.", "preview should show the block");
    assert(Math.abs(ghost.top - (row.top + 30)) <= 2, `preview should lift from its block and follow the pointer, got ${ghost.top} for row ${row.top}`);
    assert(Math.abs(ghost.left - (rail.left + 40)) <= 2, `preview should keep its grip offset, got ${ghost.left}`);
    assert(source && source.top <= row.top + 1 && source.bottom >= row.bottom - 1, "source block is not marked");
    const long = await page.call("row", "Long paragraph 1");
    await page.dragTo(handle.x + 40, long.bottom - 20); await sleep(140);
    const indicator = await page.call("indicator");
    assert(indicator, "no drop line after the long paragraph");
    assert(Math.abs(indicator.left - rail.left) <= 1, "root drop line should start on the rail");
    assert(indicator.top > long.bottom - 1 && indicator.bottom < target.top + 1, `drop line ${indicator.top} should sit in the gap ${long.bottom}..${target.top}`);
    assert.equal(await page.call("activeIsEditor"), true, "the press moved focus off the editor");
    await page.shot("mid-drag");
    await page.release(handle.x + 40, long.bottom - 20);
    const after = await page.call("doc");
    assert.notEqual(after, before, "drop did not move the block");
    assert(after.indexOf("Short paragraph 1.") > after.indexOf("Long paragraph 1"), "block landed in the wrong place");
    assert.equal(await page.call("ghost"), null, "preview outlived the drag");
    assert.equal(await page.call("source"), null, "source mark outlived the drag");
  },
  async "a preview is a still copy of even a live widget"(page) {
    await page.call("setScrollTop", 560); await sleep(160);
    const rail = await page.call("rail"), table = await page.call("widget", ".cm-md-table-widget-wrap");
    const handle = await page.hover(table.left + 40, (table.top + table.bottom) / 2);
    await page.press(handle); await page.dragTo(handle.x + 60, handle.y + 120); await sleep(160);
    const audit = await page.call("ghostAudit");
    assert.equal(audit.tables, 1, "preview should show the table");
    assert.deepEqual([audit.editable, audit.ids, audit.focusable], [0, 0, 0], "preview kept live instance state");
    assert(Math.abs(audit.width - (rail.right - rail.left)) <= 1, `preview width ${audit.width} should match the rail`);
    await page.shot("drag-table");
    await page.release(handle.x + 60, handle.y + 120);
    assert.equal(await page.call("ghost"), null, "preview outlived the drag");
  },
  async "the handle has its resting, hover, and dragging looks"(page) {
    const row = await page.call("row", "Short paragraph 1");
    const handle = await page.hover(400, (row.top + row.bottom) / 2);
    await sleep(160); await page.shot("handle-rest");
    const resting = await page.call("handleLook");
    assert.deepEqual([resting.dots, resting.width, resting.height], [6, 8, 13], "grip should be six dots on a whole-pixel box");
    assert(Math.abs(resting.opacity - .62) < .01, `resting opacity ${resting.opacity} should match the product's grips`);
    await page.hover(handle.x, handle.y);
    page.send({ type: "mouseMove", x: handle.x + 1, y: handle.y }); await sleep(160);
    assert.equal((await page.call("handleLook")).opacity, 1, "hover should bring the handle to full strength");
    await page.shot("handle-hover", { x: Math.round(handle.x) - 40, y: Math.round(handle.y) - 28, width: 240, height: 56 });
    const nested = await page.call("row", "nested b2");
    await page.hover(400, (nested.top + nested.bottom) / 2); await sleep(160); await page.shot("handle-nested");
    const item = await page.call("row", "item b1");
    const held = await page.hover(400, (item.top + item.bottom) / 2);
    const first = await page.call("row", "item b1"), last = await page.call("row", "nested b2");
    await page.press(held);
    await page.dragTo(held.x + 70, held.y + 130); await sleep(180); await page.shot("drag-list");
    assert((await page.call("selectionColor")).length > 0, "selection token must reach the overlay");
    assert((await page.call("sourceBackground")).includes("linear-gradient"), "source tint should come from the selection token");
    const { height } = await page.call("ghostAudit");
    assert(Math.abs(height - (last.bottom - first.top)) <= 2, `preview height ${height} should match its block ${last.bottom - first.top}`);
    await page.release(held.x + 70, held.y + 130);
  },
  async "escape cancels a drag cleanly"(page) {
    const before = await page.call("doc");
    const row = await page.call("row", "Short paragraph 1");
    const handle = await page.hover(400, (row.top + row.bottom) / 2);
    await page.press(handle); await page.dragTo(handle.x, handle.y + 200);
    assert(await page.call("ghost"), "drag did not start");
    page.send({ type: "keyDown", keyCode: "Escape" }); await sleep(40);
    assert.equal(await page.call("ghost"), null, "escape left the preview up");
    await page.release(handle.x, handle.y + 200);
    assert.equal(await page.call("doc"), before, "escape still moved the block");
  },
  async "selecting text never summons the handle"(page) {
    const row = await page.call("row", "Long paragraph 1");
    const y = row.top + 12;
    page.send({ type: "mouseMove", x: 400, y }); await sleep(40);
    page.send({ type: "mouseDown", button: "left", clickCount: 1, x: 400, y }); await sleep(30);
    await page.dragTo(700, y + 40);
    assert.equal(await page.call("handle"), null, "handle shown during a text selection");
    await page.release(700, y + 40);
  },
  async "turning it off leaves nothing behind"(page) {
    assert((await page.call("dragDomCount")) > 0, "add-on was not installed");
    await page.call("setEnabled", false); await sleep(60);
    assert.equal(await page.call("dragDomCount"), 0, "add-on DOM survived being switched off");
    const row = await page.call("row", "Short paragraph 1");
    assert.equal(await page.hover(400, (row.top + row.bottom) / 2), null);
    await page.call("setEnabled", true); await sleep(60);
    assert((await page.hover(400, (row.top + row.bottom) / 2))?.kind, "add-on did not come back");
  },
};

const darkScenarios = {
  async "the dark theme carries the same looks"(page) {
    const row = await page.call("row", "Short paragraph 1");
    const handle = await page.hover(400, (row.top + row.bottom) / 2);
    await sleep(160); await page.shot("dark-handle");
    await page.press(handle);
    await page.dragTo(handle.x + 60, handle.y + 180); await sleep(180); await page.shot("dark-drag");
    await page.release(handle.x + 60, handle.y + 180);
  },
};

const longDocumentScenarios = {
  async "a drop stays where the pointer left it, far from the caret"(page) {
    await page.call("setCaret", 0);
    await page.call("scrollToRow", "Short paragraph 8."); await sleep(300);
    await page.call("scrollToRow", "Short paragraph 8."); await sleep(300);
    const row = await page.call("row", "Short paragraph 8.");
    const handle = await page.hover(400, (row.top + row.bottom) / 2);
    assert.equal(handle?.kind, "root", "expected a root block in the scrolled document");
    const before = await page.call("scrollTop"), source = await page.call("doc");
    await page.press(handle);
    for (let y = handle.y; y <= handle.y + 280; y += 20) await page.dragTo(handle.x, y);
    await page.release(handle.x, handle.y + 280); await sleep(200);
    assert.notEqual(await page.call("doc"), source, "drop did not move the block");
    assert(Math.abs((await page.call("scrollTop")) - before) < 400, `drop jumped from ${before} to ${await page.call("scrollTop")}`);
  },
  async "a drag that outruns the parser still lands"(page) {
    const parsedAtStart = await page.call("parsedTo");
    assert(parsedAtStart < await page.call("length"), "fixture must outrun the parser");
    const row = await page.call("row", "Short paragraph 1");
    const handle = await page.hover(400, (row.top + row.bottom) / 2);
    await page.press(handle);
    await page.dragTo(handle.x, handle.y + 40);
    assert(await page.call("ghost"), "drag did not start");
    await page.call("setScrollTop", 40000); await sleep(700);
    assert((await page.call("parsedTo")) > parsedAtStart, "parser did not advance during the drag");
    assert(await page.call("ghost"), "the drag died when the parser advanced");
    await page.dragTo(handle.x, 400);
    await page.release(handle.x, 400);
    const moved = await page.call("doc");
    assert(moved.indexOf("Short paragraph 1.") > parsedAtStart, "block did not land past the original parse horizon");
  },
  async "hovering stays out of CodeMirror's measure loop"(page) {
    await page.call("setScrollTop", 9000); await sleep(300);
    await page.call("instrument");
    for (let step = 0; step < 200; step += 1) {
      page.send({ type: "mouseMove", x: 300 + (step % 40) * 4, y: 60 + (step * 3.4) % 680 }); await sleep(8);
    }
    await sleep(100);
    const measures = await page.call("measureCount");
    assert(measures <= 60, `hover measured ${measures} times for 200 moves`);
    return { measures };
  },
};

const imageScenarios = {
  async "a block image's handle sits on the image"(page) {
    await page.call("imageReady");
    const block = await page.call("blockImage");
    assert(block, "the fixture did not render a block image");
    const imageHeight = block.widget.bottom - block.widget.top;
    const lineHeight = block.line.bottom - block.line.top;
    // Only the line's own bottom padding may exceed the image.
    assert(lineHeight - imageHeight <= 8,
      `the image line wasted ${lineHeight - imageHeight}px around a ${imageHeight}px image`);
    const handle = await page.hoverUntilHandle(block.widget.left + 40, block.widget.top + 20);
    assert(handle, "no handle for a block image");
    assert(handle.y >= block.widget.top - 1,
      `handle y ${handle.y} floats above the image top ${block.widget.top}`);
    assert(handle.y <= block.widget.top + 26,
      `handle y ${handle.y} sits below the image's first row`);
    assert.equal(block.display, "inline-flex", "a block image must stay inline-level inside its line");
  },

  async "a block image keeps its neighbours' spacing"(page) {
    await page.call("imageReady");
    const block = await page.call("blockImage");
    const heading = await page.call("row", "健身营养");
    const paragraph = await page.call("row", "ATP-CP");
    // The heading and paragraph gap tokens own the outer rhythm (~30px in the
    // default theme). The phantom-row guard is what happens inside the image's
    // own line: it may only carry the source-line gap, never a blank text row.
    assert(block.widget.top - block.line.top <= 8,
      `the image line pads ${block.widget.top - block.line.top}px above the image`);
    assert(block.line.bottom - block.widget.bottom <= 8,
      `the image line pads ${block.line.bottom - block.widget.bottom}px below the image`);
    assert(block.widget.top >= heading.bottom, "the image overlaps the heading");
    assert(paragraph.top >= block.line.bottom, "the following paragraph overlaps the image line");
    assert(block.widget.top - heading.bottom <= 40,
      `the gap above the image is ${block.widget.top - heading.bottom}px`);
    assert(paragraph.top - block.widget.bottom <= 40,
      `the gap below the image is ${paragraph.top - block.widget.bottom}px`);
  },

  async "dragging a block image marks the image only"(page) {
    await page.call("imageReady");
    const block = await page.call("blockImage");
    const handle = await page.hoverUntilHandle(block.widget.left + 40, block.widget.top + 20);
    await page.press(handle);
    await page.dragTo(handle.x + 40, handle.y + 40);
    const source = await page.call("source");
    assert(source, "no source mark during the drag");
    assert((source.bottom - source.top) - (block.widget.bottom - block.widget.top) <= 8,
      `the source mark is ${(source.bottom - source.top)}px for a ${block.widget.bottom - block.widget.top}px image`);
    page.send({ type: "keyDown", keyCode: "Escape" }); await sleep(40);
    await page.release(handle.x + 40, handle.y + 40);
  },

  async "a narrow pane still keeps the handle on the image"(page) {
    page.window.setContentSize(420, 800); await sleep(300);
    await page.call("imageReady");
    const block = await page.call("blockImage");
    assert(block.widget.right - block.widget.left <= 420, "the block image overflowed the narrow pane");
    const handle = await page.hoverUntilHandle(block.widget.left + 40, block.widget.top + 20);
    assert(handle, "no handle in a narrow pane");
    assert(handle.x < block.widget.left, "the handle should sit in the rail left of the image");
    assert(handle.y >= block.widget.top - 1, "the handle floated above the image in a narrow pane");
  },
};

const imagePendingScenarios = {
  async "a loading placeholder adds no phantom row"(page) {
    await sleep(300);
    const block = await page.call("blockImage");
    assert(block, "the placeholder did not render");
    const height = block.line.bottom - block.line.top;
    const widgetHeight = block.widget.bottom - block.widget.top;
    assert(height - widgetHeight <= 8, `the loading line wasted ${height - widgetHeight}px`);
  },
};

const imageRtlScenarios = {
  async "a right-to-left block image keeps the handle on its image"(page) {
    await page.call("imageReady");
    const rail = await page.call("rail");
    const block = await page.call("blockImage");
    const handle = await page.hoverUntilHandle(rail.left + 100, block.widget.top + 20);
    assert(handle, "no handle for a right-to-left block image");
    assert(handle.x > rail.right, `handle ${handle.x} should sit past the right rail ${rail.right}`);
    assert(handle.y >= block.widget.top - 1, `handle y ${handle.y} floats above the image`);
  },
};

const rightToLeftScenarios = {
  async "a right-to-left document puts the handle on its start side"(page) {
    const rail = await page.call("rail");
    const row = await page.call("row", "פסקה שנייה");
    const handle = await page.hover(rail.left + 100, (row.top + row.bottom) / 2);
    assert(handle.x > rail.right, `handle ${handle.x} should sit past the right rail ${rail.right}`);
  },
};

const frontmatterScenarios = {
  async "frontmatter offers no handle"(page) {
    const row = await page.call("row", "title: Hello");
    if (row) assert.equal(await page.hover(400, (row.top + row.bottom) / 2), null, "frontmatter is draggable");
    const body = await page.call("row", "Second paragraph");
    assert((await page.hover(400, (body.top + body.bottom) / 2))?.kind, "body lost its handle");
  },
};

async function runAll(query, group) {
  for (const [name, scenario] of Object.entries(group)) {
    const page = await openFixture(query);
    try {
      const detail = await scenario(page);
      results.push({ name, ok: true, ...detail });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
    page.window.destroy();
  }
}

async function run() {
  const reservation = reservePort(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error",
    optimizeDeps: { entries: ["tests/fixtures/editor/formats/markdown/block-drag.html"] },
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
  await vite.listen();
  await runAll("doc=mixed", scenarios);
  await runAll("doc=mixed&theme=dark", darkScenarios);
  await runAll("doc=long", longDocumentScenarios);
  await runAll("doc=rtl", rightToLeftScenarios);
  await runAll("doc=frontmatter", frontmatterScenarios);
  await runAll("doc=image", imageScenarios);
  await runAll("doc=imagePending", imagePendingScenarios);
  await runAll("doc=imageRtl", imageRtlScenarios);
}

const failures = () => results.filter(result => !result.ok);
const finish = async code => {
  await Promise.race([vite?.close(), sleep(1500)]);
  await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  app.exit(code);
};
setTimeout(() => { console.error("markdown-block-drag smoke timed out"); app.exit(3); }, 240_000).unref();
app.whenReady().then(run).then(async () => {
  for (const result of results) console.log(`${result.ok ? "pass" : "FAIL"}  ${result.name}${result.error ? `\n      ${result.error}` : ""}${result.measures == null ? "" : ` (${result.measures} measures)`}`);
  console.log(`${results.length - failures().length}/${results.length} scenarios passed`);
  await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ results }, null, 2));
  await finish(failures().length ? 1 : 0);
}).catch(async error => { console.error(error); await finish(1); });

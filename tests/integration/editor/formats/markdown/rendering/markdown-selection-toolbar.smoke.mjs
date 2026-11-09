import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { createServer as reservePort } from "node:net";
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-text-handle-smoke-"));
const artifacts = path.join(root, "artifacts/tests/text-handle");
await fs.mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, window;
const results = [];
async function run() {
try {
  const reservation = reservePort();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const reservedPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  server = await createServer({ root, cacheDir: path.join(temporary, "vite"), optimizeDeps: { entries: ["tests/fixtures/editor/formats/markdown/selection-toolbar.html"] }, server: { host: "127.0.0.1", port: reservedPort, strictPort: true, hmr: false, watch: null }, logLevel: "error" }); await server.listen();
  const port = server.httpServer.address().port;
  for (const config of ["", "theme=dark", "source=1", "locale=zh-Hans", "readonly=1"]) {
    window = new BrowserWindow({ width: 1000, height: 700, show: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    await window.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/formats/markdown/selection-toolbar.html?${config}`);
    const evaluate = code => window.webContents.executeJavaScript(code);
    const call = (method, ...args) => evaluate(`window.selectionToolbarFixture.${method}(${args.map(value => JSON.stringify(value)).join(",")})`);
    const until = async (predicate, label) => { for (let n = 0; n < 150; n++) { if (await predicate()) return; await delay(20); } throw new Error(label + " " + JSON.stringify(await call("state"))); };
    await until(() => evaluate("!!window.selectionToolbarFixture"), "fixture ready"); await call("ready");
    window.focus(); window.webContents.focus();
    await until(() => evaluate("document.hasFocus()"), "test window focused");
    const state = () => call("state");
    const click = async point => {
      const p = { x: Math.round(point.x), y: Math.round(point.y) };
      window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...p });
      window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...p });
      await delay(80);
    };
    const key = async (keyCode, modifiers = []) => { window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers }); window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers }); await delay(80); };
    assert.equal((await state()).visible, false);
    if (config === "readonly=1") {
      await call("select", "选中这段文字");
      await delay(100); assert.equal((await state()).visible, false); results.push("read-only selection stays passive"); window.destroy(); continue;
    }
    const points = await call("coords", "选中这段文字");
    const send = (type, point, extra = {}) => window.webContents.sendInputEvent({ type, button: "left", clickCount: 1, x: Math.round(point.x), y: Math.round(point.y), ...extra });
    send("mouseDown", points.from); send("mouseMove", points.to, { modifiers: ["leftButtonDown"] });
    await delay(80); assert.equal((await state()).visible, false, "toolbar waits for selection drag to finish");
    send("mouseUp", points.to);
    await until(async () => (await state()).visible, "toolbar appears above selection");
    assert.equal((await state()).position, "absolute");
    assert.equal((await state()).iconWidth, 18);
    const before = (await state()).text;
    await click(await call("button", "strong"));
    await until(async () => (await state()).text.includes("**选中这段文字**"), "native click formats original selection");
    assert.equal((await state()).selected, "选中这段文字");
    assert((await state()).active.includes("strong"));
    await call("undo"); assert.equal((await state()).text, before);
    await key("F10", ["alt"]); assert.equal((await state()).activeElement, "BUTTON");
    await key("Escape"); assert.equal((await state()).visible, false); assert.equal((await state()).selected, "选中这段文字");
    await call("select", "Different teams"); await until(async () => (await state()).visible, "new selection reopens toolbar");
    await fs.writeFile(path.join(artifacts, `toolbar-${config || "light"}.png`), (await window.webContents.capturePage()).toPNG());
    await call("outside"); await until(async () => !(await state()).visible, "focus elsewhere dismisses toolbar");
    await call("select", "A bullet list item");
    await until(async () => (await state()).visible, "list selection toolbar ready");
    for (const type of ["heading1", "heading2", "orderedList"]) {
      await click(await call("control", '[data-toolbar-menu="block"]'));
      assert.equal((await call("menu")).visible, true, "native block menu click stays open");
      assert((await state()).visible);
      assert((await call("menu")).labels.includes(config === "locale=zh-Hans" ? "1 级标题" : "Heading 1"));
      await click(await call("control", `[data-block-type="${type}"]`));
      const prefix = { heading1: "# ", heading2: "## ", orderedList: "1. " }[type];
      assert((await state()).text.includes(prefix + "A bullet list item")); await call("undo");
      await until(async () => (await state()).visible, "undo restores toolbar");
    }
    await call("select", "Different teams");
    const plain = (await state()).text;
    for (const color of ["yellow", "pink"]) {
      await click(await call("button", "highlight"));
      assert.equal((await call("menu")).visible, true);
      await click(await call("control", `[data-highlight-color="${color}"]`));
      assert((await state()).text.includes('background-color: ' + (color === "yellow" ? "#fff2a8" : "#ffd6e7")));
      assert.equal((await state()).selected, "Different teams");
      if (config !== "source=1") assert.equal((await call("mark")).background, color === "yellow" ? "rgb(255, 242, 168)" : "rgb(255, 214, 231)");
    }
    await click(await call("button", "highlight"));
    await fs.writeFile(path.join(artifacts, `colors-${config || "light"}.png`), (await window.webContents.capturePage()).toPNG());
    await click(await call("control", '[data-highlight-color="none"]'));
    assert.equal((await state()).text, plain);
    assert.equal(await evaluate(`!!document.querySelector('[data-markdown-command="clearFormat"]')`), false);

    window.setSize(450, 700); await call("select", "Different teams");
    await until(async () => { const s = await state(); return s.visible && s.toolbar.right <= s.pane.right + 1 && s.toolbar.left >= s.pane.left; }, "toolbar stays inside narrow editor");
    await call("scroll", 1000); await until(async () => !(await state()).visible, "offscreen selection hides toolbar");
    results.push(`${config || "light"}: native click, selection, undo, Escape, focus, block conversion, narrow pane, scroll`);
    window.destroy();
  }
  console.log(JSON.stringify({ passed: results }, null, 2));
} catch (error) {
  console.error(error); process.exitCode = 1;
  if (window && !window.isDestroyed()) await fs.writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG());
} finally {
  if (window && !window.isDestroyed()) window.destroy();
  await server?.close(); app.exit(process.exitCode ?? 0);
}

}
setTimeout(() => { console.error("Selection toolbar smoke timed out"); app.exit(3); }, 120_000).unref();
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });

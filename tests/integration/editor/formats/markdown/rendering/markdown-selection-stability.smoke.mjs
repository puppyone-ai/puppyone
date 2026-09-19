#!/usr/bin/env electron
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-md-selection-"));
app.setPath("userData", path.join(tempRoot, "profile"));
// Destroying the last window must not quit with Electron's default success
// code before async cleanup finishes and we publish the assertion exit code.
app.on("window-all-closed", () => {});
let owner;
let vite;
let focusLease;
const report = { cases: [], sidebar: null, interactions: null, ignoredKeyboardEvents: 0, focusChanges: [], error: null };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (body) => owner.webContents.executeJavaScript(`(async () => { const f = window.markdownSelectionFixture; ${body} })()`, true);
async function point(pos) {
  return evaluate(`const r = f.view.coordsAtPos(${pos}); return { x: Math.round(r.left), y: Math.round((r.top + r.bottom) / 2) };`);
}
async function input(type, point, extra = {}) {
  owner.webContents.sendInputEvent({ type, ...point, button: "left", clickCount: 1, ...(type === "mouseMove" ? { modifiers: ["leftButtonDown"] } : {}), ...extra });
  await wait(40);
}

async function run() {
  const { createServer } = await import("vite");
  vite = await createServer({ root: repoRoot, logLevel: "error", server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  owner = new BrowserWindow({ show: false, width: 850, height: 760, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  // This fixture injects mouse input only. Do not let physical keyboard
  // input edit the synthetic source while its transparent window owns focus.
  owner.webContents.on("before-input-event", (event) => {
    report.ignoredKeyboardEvents += 1;
    event.preventDefault();
  });
  owner.on("focus", () => report.focusChanges.push({ focused: true, at: Date.now() }));
  owner.on("blur", () => report.focusChanges.push({ focused: false, at: Date.now() }));
  owner.webContents.on("console-message", (details) => { if (details.level === "error") console.error(details.message); });
  await owner.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/editor/formats/markdown/selection-stability.html`);
  if (process.argv.includes("--self-test-failure")) assert.fail("Intentional runner exit-code verification");
  owner.setOpacity(0);
  // Exercise Chromium input without accepting unrelated physical pointer
  // movement from the user's desktop through the transparent fixture window.
  owner.setIgnoreMouseEvents(true);
  owner.setAlwaysOnTop(true, "screen-saver");
  owner.show();
  if (process.platform === "darwin") app.focus({ steal: true });
  owner.focus();
  focusLease = setInterval(() => {
    if (owner.isDestroyed() || owner.isFocused()) return;
    if (process.platform === "darwin") app.focus({ steal: true });
    owner.focus();
    owner.webContents.focus();
  }, 100);
  await wait(600);
  const cases = report.cases;
  for (const [name, token, offset, delta] of [
    ["bold backward character", "abcdefghijklmno", 7, -1],
    ["bold forward character", "abcdefghijklmno", 7, 1],
    ["plain text below revealed link", "Target paragraph", 23, -1],
    ["CJK backward character", "中文反向单字选中", 5, -1],
    ["backward across paragraphs", "Target paragraph", 10, null],
  ]) {
    await evaluate(`f.view.dispatch({ selection: { anchor: 0 } }); f.view.focus();`);
    await wait(60);
    if (name.startsWith("plain")) {
      await evaluate(`f.view.dispatch({ selection: { anchor: f.source.indexOf('long editable label') + 3 } });`);
      await wait(60);
    }
    const anchor = await evaluate(`return f.source.indexOf(${JSON.stringify(token)}) + ${offset};`);
    const head = delta === null ? await evaluate("return f.source.indexOf('abcdefghijklmno') + 3;") : anchor + delta;
    const start = await point(anchor);
    const end = await point(head);
    const before = await evaluate("return f.snapshot();");
    await input("mouseDown", start);
    const down = await evaluate("return f.snapshot();");
    await input("mouseMove", end);
    const move = await evaluate("return f.snapshot();");
    // Repeated samples at the same screen coordinate used to oscillate as
    // delimiters appeared/disappeared beneath the pointer.
    await input("mouseMove", end);
    await input("mouseUp", end);
    const after = await evaluate("return f.snapshot();");
    cases.push({ name, expected: { anchor, head }, before, down, move, after });
  }
  for (const sample of cases) {
    for (const [phase, snapshot] of Object.entries({ before: sample.before, down: sample.down, move: sample.move, after: sample.after })) {
      assert.ok(snapshot.sourceUnchanged, `${sample.name}: source changed during ${phase}`);
      assert.ok(snapshot.hasFocus, `${sample.name}: fixture lost focus during ${phase}`);
    }
    assert.equal(sample.move.anchor, sample.expected.anchor, `${sample.name}: moving anchor`);
    assert.equal(sample.move.head, sample.expected.head, `${sample.name}: moving head`);
    assert.equal(sample.after.anchor, sample.expected.anchor, `${sample.name}: anchor`);
    assert.equal(sample.after.head, sample.expected.head, `${sample.name}: head`);
    assert.deepEqual(sample.down.reveal, sample.before.reveal, `${sample.name}: mousedown geometry`);
    assert.deepEqual(sample.after.reveal, sample.before.reveal, `${sample.name}: release geometry`);
    assert.equal(sample.after.selecting, false, `${sample.name}: gesture ended`);
  }
  await evaluate("f.view.dispatch({ selection: { anchor: 0 } });");
  await wait(60);
  const caret = await evaluate("return f.source.indexOf('abcdefghijklmno') + 7;");
  const clickPoint = await point(caret);
  await input("mouseDown", clickPoint);
  assert.equal((await evaluate("return f.snapshot();")).reveal, null, "single click defers reveal while held");
  await input("mouseUp", clickPoint);
  const clicked = await evaluate("return f.snapshot();");
  assert.equal(clicked.anchor, caret);
  assert.ok(clicked.reveal, "ordinary click still reveals editable source after release");
  await input("mouseDown", await point(caret));
  await input("mouseUp", { x: 700, y: 650 });
  assert.equal((await evaluate("return f.snapshot();")).selecting, false, "release outside editor ends gesture");
  await input("mouseDown", await point(caret));
  await evaluate("f.view.contentDOM.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));");
  await wait(40);
  assert.equal((await evaluate("return f.snapshot();")).selecting, false, "pointer cancellation ends gesture");
  await input("mouseUp", { x: 700, y: 650 });

  await evaluate("f.view.dispatch({ changes: { from: 0, to: f.view.state.doc.length, insert: 'Body [External](https://example.com) tail' }, selection: { anchor: 0 } });");
  await wait(60);
  const linkPoint = await point(10);
  await input("mouseDown", linkPoint);
  await input("mouseUp", linkPoint);
  assert.deepEqual(await evaluate("return f.openedUrls;"), ["https://example.com/"], "link click navigates once");
  assert.equal((await evaluate("return f.snapshot();")).selecting, false, "handled link mouseup ends gesture");
  await input("mouseDown", linkPoint);
  await input("mouseMove", await point(8));
  await input("mouseUp", await point(8));
  assert.equal(await evaluate("return f.openedUrls.length;"), 1, "dragging link text does not navigate");
  report.interactions = { singleClick: true, outsideRelease: true, cancel: true, linkClick: true, linkDrag: true };

  const sidebar = await evaluate(`
    f.view.dispatch({ changes: { from: 0, to: f.view.state.doc.length, insert: '| Name | Value |\\n| --- | --- |\\n| one | unchanged |\\n\\nText below the table.' }, selection: { anchor: 0 } });
    const table = f.view.dom.querySelector('.cm-md-table-widget');
    await new Promise(resolve => setTimeout(resolve, 60));
    const text = Array.from(f.view.contentDOM.querySelectorAll('.cm-line')).find(line => line.textContent.includes('Text below'));
    const baseline = text.getBoundingClientRect().top;
    const samples = [];
    for (let i = 0; i < 8; i++) {
      document.querySelector('#folder').click();
      await new Promise(requestAnimationFrame);
      samples.push(text.getBoundingClientRect().top);
    }
    return { tableMounted: !!table, tableRetained: f.view.dom.querySelector('.cm-md-table-widget') === table, baseline, samples };
  `);
  report.sidebar = sidebar;
  assert.ok(sidebar.tableMounted, "sidebar scenario has a real table");
  assert.ok(sidebar.tableRetained, "loading unrelated folder entries must retain the table DOM");
  assert.ok(sidebar.samples.every((top) => Math.abs(top - sidebar.baseline) < 0.75), "paragraph geometry remains stable across folder loads");
  console.log(JSON.stringify({ ok: true, selections: cases.map(({ name, after }) => ({ name, anchor: after.anchor, head: after.head })), sidebar, interactions: report.interactions }, null, 2));
}
app.whenReady().then(run).then(() => finish(0), (error) => {
  report.error = error instanceof Error ? error.stack : String(error);
  console.error(error);
  return finish(1);
}).catch((error) => { console.error(error); app.exit(1); });
async function finish(code) {
  clearInterval(focusLease);
  const reportDir = process.env.PUPPYONE_MARKDOWN_SELECTION_ARTIFACT_DIR
    ?? path.join(repoRoot, "artifacts/tests/markdown-selection", new Date().toISOString().replaceAll(":", "-"));
  await fsp.mkdir(reportDir, { recursive: true });
  await fsp.writeFile(path.join(reportDir, "report.json"), JSON.stringify({ ok: code === 0, ...report }, null, 2));
  console.log(`Markdown selection report: ${path.relative(repoRoot, reportDir)}/report.json`);
  owner?.destroy();
  await vite?.close();
  await fsp.rm(tempRoot, { recursive: true, force: true });
  app.exit(code);
}

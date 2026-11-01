#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer as reservePort } from "node:net";
import { app, BrowserWindow, nativeTheme } from "electron";
import { createServer } from "vite";

// Layout, image selection, and real input are what a DOM stub cannot answer:
// list indent, `prefers-color-scheme`, intrinsic sizes, and caret motion.
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-html-run-"));
const artifacts = process.env.PUPPYONE_MARKDOWN_HTML_RUN_ARTIFACT_DIR || await (async () => {
  const directory = path.join(root, "artifacts/tests/editor/markdown-html-run");
  await fs.mkdir(directory, { recursive: true });
  return fs.mkdtemp(path.join(directory, "run-"));
})();
await fs.mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});

const sourceIdentity = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "",
  electron: process.versions.electron,
  chromium: process.versions.chrome,
};
const results = [];
const errors = [];
let browser, vite, failure;

const near = (actual, expected, label, tolerance = 1) => {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not near ${expected}`);
};

/** Runs in Chromium against the production editor DOM. */
function measure() {
  const fixture = window.htmlRunFixture;
  const content = fixture.view().contentDOM;
  const box = (element) => {
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  };
  const line = (text) => [...content.querySelectorAll(".cm-line")].find((item) => item.textContent.includes(text));
  const cards = [...content.querySelectorAll(".cm-md-html-run [data-md-href] picture img")];
  const itemText = line("Get puppyone.").querySelector(".cm-md-syntax-strong") ?? line("Get puppyone.");
  const centered = content.querySelector(".cm-md-html-run.is-block");
  const centeredDiv = centered?.querySelector("div");
  const table = content.querySelector(".cm-md-html-rendered-surface table");
  return {
    prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
    assets: fixture.assets,
    rawTags: /<(?:picture|source|img|a|div|ol|table)\b/.test(content.textContent),
    rawLinkSyntax: content.textContent.includes("](") || content.textContent.includes("!["),
    cards: cards.map((image) => ({
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      currentSrc: image.currentSrc,
      alt: image.alt,
      box: box(image),
      lineBox: box(image.closest(".cm-line")),
    })),
    itemTextLeft: box(itemText).left,
    inlineBadge: (() => {
      const image = [...content.querySelectorAll(".cm-md-html-run img")].find(({ alt }) => alt === "Inline badge");
      return image ? { complete: image.complete, naturalWidth: image.naturalWidth } : null;
    })(),
    linkedBadge: Boolean(content.querySelector(".cm-md-link-label .cm-md-image-widget")),
    centered: centeredDiv ? {
      textAlign: getComputedStyle(centeredDiv).textAlign,
      width: box(centered).width,
      lineWidth: box(centered.closest(".cm-line")).width,
    } : null,
    percent: (() => {
      const image = [...content.querySelectorAll(".cm-md-html-rendered-surface img")].find(({ alt }) => alt === "Half width");
      return image ? { width: box(image).width, parent: box(image.parentElement).width } : null;
    })(),
    float: (() => {
      const image = [...content.querySelectorAll(".cm-md-html-rendered-surface img")].find(({ alt }) => alt === "Floated");
      return image ? getComputedStyle(image).float : null;
    })(),
    orderedStart: content.querySelector(".cm-md-html-rendered-surface ol")?.start ?? null,
    table: table ? { left: box(table).left, right: box(table).right, parent: box(table.parentElement) } : null,
    cell: table ? {
      width: box(table.querySelector("td")).width,
      verticalAlign: getComputedStyle(table.querySelector("td")).verticalAlign,
    } : null,
  };
}

app.whenReady().then(async () => {
  try {
    const reservation = reservePort();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    vite = await createServer({
      root,
      cacheDir: path.join(temporary, "vite"),
      logLevel: "error",
      optimizeDeps: { entries: ["tests/fixtures/editor/formats/markdown/html-run.html"] },
      server: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        hmr: false,
        watch: null,
        fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] },
      },
    });
    await vite.listen();

    browser = new BrowserWindow({
      width: 1000,
      height: 1100,
      show: process.env.PUPPYONE_MARKDOWN_HTML_RUN_HIDDEN !== "1",
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    browser.webContents.on("console-message", (details) => {
      if (details.level === "error" && !details.message.includes("Electron Security Warning")) errors.push(details.message);
    });
    const evaluate = (code) => browser.webContents.executeJavaScript(code);
    const settle = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))))");

    for (const mode of ["light", "dark"]) {
      // The app drives the same switch from its theme preference.
      nativeTheme.themeSource = mode;
      await browser.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/formats/markdown/html-run.html?theme=${mode}`);
      browser.webContents.debugger.isAttached() || browser.webContents.debugger.attach("1.3");
      await browser.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await evaluate(`(async () => {
        for (let attempt = 0; attempt < 3000; attempt += 1) {
          const images = [...document.querySelectorAll(".cm-md-html-run picture img")];
          if (images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0)) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Download cards never loaded");
      })()`);
      await settle();

      const metrics = await evaluate(`(${measure.toString()})()`);
      assert.equal(metrics.prefersDark, mode === "dark");
      assert.equal(metrics.rawTags, false, "HTML tags are visible");
      assert.equal(metrics.rawLinkSyntax, false, "badge link syntax is visible");
      assert.equal(metrics.cards.length, 2);
      const expected = metrics.assets[`assets/card-${mode}.svg`];
      for (const item of metrics.cards) {
        assert.equal(item.currentSrc, expected, `${item.alt} chose the wrong theme candidate`);
        near(item.box.width, 196, `${item.alt} width`);
        near(item.box.left, metrics.itemTextLeft, `${item.alt} lost its list indent`);
        assert(item.lineBox.top <= item.box.top + 1 && item.lineBox.bottom >= item.box.bottom - 1, `${item.alt} overflows its line`);
      }
      assert(metrics.cards[1].box.top >= metrics.cards[0].box.bottom - 1, "cards overlap");
      assert(metrics.inlineBadge?.naturalWidth > 0, "inline image did not load");
      assert.equal(metrics.linkedBadge, true, "badge lost its link");
      assert.equal(metrics.centered?.textAlign, "center");
      near(metrics.centered.width, metrics.centered.lineWidth, "block run width", 48);
      near(metrics.percent?.width, metrics.percent?.parent / 2, "percent image width", 2);
      assert.equal(metrics.float, "right");
      assert.equal(metrics.orderedStart, 3);
      assert(metrics.table.left - metrics.table.parent.left > 10, "table did not honor align=center");
      near(metrics.table.left - metrics.table.parent.left, metrics.table.parent.right - metrics.table.right, "table centering", 2);
      near(metrics.cell.width, 200, "cell width", 2);
      assert.equal(metrics.cell.verticalAlign, "top");

      await fs.writeFile(path.join(artifacts, `html-run-${mode}.png`), (await browser.webContents.capturePage()).toPNG());
      results.push({ name: `projection-${mode}`, metrics });
      console.log(`PASS projection-${mode}`);
    }

    const click = async (x, y) => {
      for (const type of ["mouseDown", "mouseUp"]) {
        browser.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 });
      }
      await settle();
    };
    const press = async (keyCode) => {
      browser.webContents.sendInputEvent({ type: "keyDown", keyCode });
      browser.webContents.sendInputEvent({ type: "keyUp", keyCode });
      await settle();
    };
    const centerOf = (selector) => evaluate(`(() => {
      const { left, top, width, height } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: left + width / 2, y: top + height / 2 };
    })()`);
    const runCount = () => evaluate("document.querySelectorAll('.cm-md-html-run').length");
    const documentText = () => evaluate("window.htmlRunFixture.view().state.doc.toString()");
    const original = await evaluate("window.htmlRunFixture.source");
    const baseline = await runCount();

    browser.focus();
    await evaluate("window.htmlRunFixture.view().focus()");
    let point = await centerOf(".cm-md-html-run [data-md-href]");
    await click(point.x, point.y);
    assert.deepEqual(await evaluate("window.htmlRunFixture.opened"), ["https://www.puppyone.ai/download"]);
    assert.equal(await runCount(), baseline, "following a link revealed its source");

    point = await centerOf(".cm-md-html-run:not(:has([data-md-href])) img");
    await click(point.x, point.y);
    assert.equal(await runCount(), baseline - 1, "clicking an unlinked run did not reveal it");
    assert(await evaluate("window.htmlRunFixture.view().contentDOM.textContent.includes('<img src=\"assets/badge.svg\" alt=\"Inline badge\">')"));

    await evaluate(`(() => {
      const view = window.htmlRunFixture.view();
      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Text before") + 2 } });
    })()`);
    await settle();
    assert.equal(await runCount(), baseline, "leaving a run did not fold it");
    const caret = await evaluate(`(() => {
      const view = window.htmlRunFixture.view();
      const from = view.state.doc.toString().indexOf('<img src="assets/badge.svg" alt="Inline badge">');
      view.dispatch({ selection: { anchor: from - 1 } });
      return from;
    })()`);
    await settle();
    await press("Right");
    assert.equal(await evaluate("window.htmlRunFixture.view().state.selection.main.head"), caret);
    assert.equal(await runCount(), baseline - 1, "arrow key did not reveal the run edge");
    await press("Right");
    assert.equal(await evaluate("window.htmlRunFixture.view().state.selection.main.head"), caret + 1, "caret cannot enter the revealed source");
    assert.equal(await documentText(), original);

    await press("Backspace");
    const edited = await documentText();
    assert.equal(edited.length, original.length - 1, "Backspace must remove one character");
    results.push({ name: "interaction" });
    console.log("PASS interaction");
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error.stack ?? String(error);
    if (browser && !browser.isDestroyed()) await fs.writeFile(path.join(artifacts, "failure.png"), (await browser.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: !failure, source: sourceIdentity, results, errors, failure }, null, 2) + "\n");
    console.log(`ARTIFACTS ${artifacts}`);
    browser?.destroy();
    await vite?.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });

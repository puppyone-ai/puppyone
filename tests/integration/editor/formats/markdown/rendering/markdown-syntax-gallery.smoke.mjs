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

// Block widgets, line decorations, and fold state only prove themselves with a
// real layout: this renders one document holding every construct at once.
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-syntax-gallery-"));
const artifacts = process.env.PUPPYONE_MARKDOWN_GALLERY_ARTIFACT_DIR || await (async () => {
  const directory = path.join(root, "artifacts/tests/editor/markdown-syntax-gallery");
  await fs.mkdir(directory, { recursive: true });
  return fs.mkdtemp(path.join(directory, "run-"));
})();
await fs.mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});

const results = [];
const errors = [];
let browser, vite, failure;

function measure() {
  const gallery = window.syntaxGallery;
  const content = gallery.view().contentDOM;
  const root = gallery.view().dom;
  const one = (selector) => root.querySelector(selector);
  const box = (element) => {
    const { left, width, height } = element.getBoundingClientRect();
    return { left, width, height };
  };
  const color = (element) => getComputedStyle(element).color;
  const noteTitle = one(".cm-md-callout-note.is-title");
  const warning = one(".cm-md-callout-warning.is-title");
  const body = [...content.querySelectorAll(".cm-line")].find((line) => line.textContent.includes("Plain"));
  const details = one(".cm-md-html-rendered-surface details");
  const svg = one(".cm-md-html-run svg");
  const figure = one(".cm-md-html-run img");
  return {
    visible: content.innerText,
    frontMatter: [...root.querySelectorAll(".cm-md-front-matter-table dt")].map((node) => node.textContent),
    runFontColor: color(one(".cm-md-html-run font") ?? content),
    details: details ? {
      open: details.open,
      item: details.querySelector("li strong")?.textContent ?? null,
      summary: details.querySelector("summary")?.textContent ?? null,
      height: box(details).height,
    } : null,
    centered: (() => {
      const strong = [...root.querySelectorAll(".cm-md-html-rendered-surface strong")].find((node) => node.textContent === "Centered");
      return strong ? getComputedStyle(strong.closest("div")).textAlign : null;
    })(),
    svg: svg ? box(svg) : null,
    inlineImage: figure ? { width: box(figure).width, loaded: figure.naturalWidth > 0 } : null,
    note: noteTitle ? {
      background: getComputedStyle(noteTitle).backgroundColor,
      header: noteTitle.querySelector(".cm-md-callout-header")?.textContent ?? null,
      icon: Boolean(noteTitle.querySelector(".cm-md-callout-icon svg")),
      bodyLeft: body ? box(body).left : null,
      left: box(noteTitle).left,
    } : null,
    noteColor: noteTitle ? color(noteTitle) : null,
    warningColor: warning ? color(warning) : null,
    warningText: warning?.textContent ?? null,
    foldedBodyHidden: !content.innerText.includes("Hidden body"),
    link: [...content.querySelectorAll("[data-md-href]")].map((node) => node.dataset.mdHref),
    reference: [...content.querySelectorAll(".cm-md-link-label")].some((node) => node.textContent === "reference"),
    footnote: one(".cm-md-footnote-reference")?.textContent ?? null,
    footnoteDefinition: one(".cm-md-footnote-definition")?.textContent ?? null,
    highlight: one(".cm-md-syntax-highlight") ? getComputedStyle(one(".cm-md-syntax-highlight")).backgroundColor : null,
    comments: [...content.querySelectorAll(".cm-md-comment")].map((node) => node.textContent),
    math: content.querySelectorAll(".katex").length,
    table: (() => {
      const table = one(".cm-md-table-widget table") ?? one("table.cm-md-table") ?? one("table");
      const image = table?.querySelector("img");
      return table ? { width: box(table).width, images: table.querySelectorAll("img, .cm-md-image-placeholder").length, imageWidth: image ? box(image).width : 0 } : null;
    })(),
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
      optimizeDeps: { entries: ["tests/fixtures/editor/formats/markdown/syntax-gallery.html"] },
      server: {
        host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null,
        fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] },
      },
    });
    await vite.listen();
    browser = new BrowserWindow({
      width: 1000,
      height: 1900,
      show: process.env.PUPPYONE_MARKDOWN_GALLERY_HIDDEN !== "1",
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    browser.webContents.on("console-message", (details) => {
      if (details.level === "error" && !details.message.includes("Electron Security Warning")) errors.push(details.message);
    });
    const evaluate = (code) => browser.webContents.executeJavaScript(code);
    nativeTheme.themeSource = "dark";
    await browser.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/formats/markdown/syntax-gallery.html`);
    browser.webContents.debugger.attach("1.3");
    await browser.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    const settle = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))))");
    await evaluate(`(async () => {
      for (let attempt = 0; attempt < 3000; attempt += 1) {
        const image = document.querySelector(".cm-md-html-run img");
        if (window.syntaxGallery && image?.complete && image.naturalWidth > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Gallery never settled");
    })()`);
    await settle();

    // A short display leaves the lower half outside CodeMirror's viewport, so
    // each half is measured while it is actually mounted.
    const scrollTo = async (text) => {
      await evaluate(`(() => {
        const view = window.syntaxGallery.view();
        const position = view.state.doc.toString().indexOf(${JSON.stringify(text)});
        view.scrollDOM.scrollTop = view.lineBlockAt(position).top;
      })()`);
      await settle();
      await settle();
    };
    const upper = await evaluate(`(${measure.toString()})()`);
    await scrollTo("## Syntax");
    const lower = await evaluate(`(${measure.toString()})()`);
    await scrollTo("---");
    const metrics = {
      ...upper,
      visible: `${upper.visible}\n${lower.visible}`,
      link: lower.link,
      reference: lower.reference,
      footnote: lower.footnote,
      footnoteDefinition: lower.footnoteDefinition,
      highlight: lower.highlight,
      comments: lower.comments,
      math: lower.math,
      table: lower.table,
    };
    await fs.writeFile(path.join(artifacts, "gallery.json"), JSON.stringify(metrics, null, 2));
    assert.doesNotMatch(metrics.visible, /<(?:details|summary|div|img|font|svg)\b/, "HTML tags are visible");
    assert.doesNotMatch(metrics.visible, /\[!|\[\^1\]|&copy;|:smile:|~gone~|==mark==/, "Markdown syntax is visible");
    assert.deepEqual(metrics.frontMatter, ["title", "tags"]);
    assert.equal(metrics.runFontColor, "rgb(255, 0, 0)");
    assert.equal(metrics.details?.item, "two");
    assert.equal(metrics.details?.summary, "Open me");
    assert.equal(metrics.details?.open, false);
    assert.equal(metrics.centered, "center");
    assert.equal(Math.round(metrics.svg?.width ?? 0), 60);
    assert.equal(metrics.inlineImage?.loaded, true);
    assert.equal(Math.round(metrics.inlineImage?.width ?? 0), 60);
    assert.notEqual(metrics.note?.background, "rgba(0, 0, 0, 0)", "callout has no tint");
    assert.equal(metrics.note?.header, "Note");
    assert.equal(metrics.note?.icon, true);
    assert.match(metrics.warningText ?? "", /Custom title/);
    assert.equal(metrics.warningColor, "rgb(236, 117, 0)", "callout lost its family color");
    assert.notEqual(metrics.noteColor, metrics.warningColor, "callouts share one color");
    assert.equal(metrics.foldedBodyHidden, true);
    assert(metrics.link.includes("https://example.com"));
    assert.equal(metrics.reference, true);
    assert.equal(metrics.footnote, "1");
    assert.equal(metrics.footnoteDefinition, "1");
    assert.notEqual(metrics.highlight, "rgba(0, 0, 0, 0)", "highlight has no paint");
    assert(metrics.comments.some((text) => text.includes("%%note%%")));
    assert(metrics.math >= 2, "math forms did not render");
    assert(metrics.table.images >= 2, "table images are missing");
    assert(metrics.table.width < 600, `table tracks grew from source length: ${metrics.table.width}`);
    await fs.writeFile(path.join(artifacts, "gallery.png"), (await browser.webContents.capturePage()).toPNG());
    results.push({ name: "projection", metrics });
    console.log("PASS projection");

    const click = async (selector) => {
      const point = await evaluate(`(() => {
        const element = window.syntaxGallery.view().dom.querySelector(${JSON.stringify(selector)});
        element.scrollIntoView({ block: "center" });
        const { left, top, width, height } = element.getBoundingClientRect();
        return { x: Math.round(left + width / 2), y: Math.round(top + height / 2) };
      })()`);
      await settle();
      for (const type of ["mouseDown", "mouseUp"]) {
        browser.webContents.sendInputEvent({ type, ...point, button: "left", clickCount: 1 });
      }
      await settle();
    };

    await click(".cm-md-html-rendered-surface summary");
    assert.equal(await evaluate("document.querySelector('.cm-md-html-rendered-surface details').open"), true, "details did not open");
    assert.equal(await evaluate("[...document.querySelectorAll('.cm-md-html-rendered-surface details li')].length"), 2);

    await click(".cm-md-callout-fold");
    assert(await evaluate("window.syntaxGallery.view().contentDOM.innerText.includes('Hidden body')"), "callout did not unfold");

    await scrollTo("## Syntax");
    await click(".cm-md-footnote-reference");
    const source = await evaluate("window.syntaxGallery.source");
    assert.equal(await evaluate("window.syntaxGallery.view().state.selection.main.head"), source.indexOf("[^1]:"), "footnote did not jump");
    assert.equal(await evaluate("window.syntaxGallery.view().state.doc.toString()"), source);
    results.push({ name: "interaction" });
    console.log("PASS interaction");
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error.stack ?? String(error);
    if (browser && !browser.isDestroyed()) await fs.writeFile(path.join(artifacts, "failure.png"), (await browser.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: !failure, results, errors, failure }, null, 2) + "\n");
    console.log(`ARTIFACTS ${artifacts}`);
    browser?.destroy();
    await vite?.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });

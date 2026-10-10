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

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-quote-colors-"));
const artifacts = process.env.PUPPYONE_MARKDOWN_QUOTE_ARTIFACT_DIR || await (async () => {
  const directory = path.join(root, "artifacts/tests/editor/markdown-quote-colors");
  await fs.mkdir(directory, { recursive: true });
  return fs.mkdtemp(path.join(directory, "run-"));
})();
await fs.mkdir(artifacts, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
app.on("window-all-closed", () => {});
const sourceIdentity = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "",
  electron: process.versions.electron, chromium: process.versions.chrome,
};
const source = [
  "Ordinary **bold**, `body code`, [link](https://example.com).",
  "",
  "> Quote **bold** *italic* ~~strike~~ <b>HTML bold</b> <i>HTML italic</i>.",
  "> 1. First **bold**",
  "> 2. Second",
  "> > 3. Nested *italic*",
  "> **[bold link](https://example.com)** and `quoted code` <code>inline HTML code</code>.",
  "> [`code link`](https://example.com) and **`bold code`**.",
  "",
  "1. Outside **bold**",
  "2. Second outside",
  "",
  "<div><blockquote><p>HTML quote <strong>bold</strong> <em>italic</em> <del>strike</del> <code>HTML code</code> <strong><code>bold code</code></strong> <code><em>italic code</em></code> <kbd>kbd</kbd> <a href=\"https://example.com\"><strong>bold link</strong> <code>code link</code></a></p><ol><li>HTML first</li><li>HTML second</li></ol></blockquote><ol><li>Outside HTML first</li></ol><pre><code>Block code control</code></pre></div>",
  "",
  "| Inline renderer |",
  "| --- |",
  "| `widget code` |",
  "",
  "End",
].join("\n");
const results = [], errors = [];
let browser, vite, failure;

// Runs in Chromium against production CodeMirror and Safe HTML DOM, including
// native list pseudo-elements. JSDOM cannot resolve this token/marker cascade.
function readColors() {
  const host = document.querySelector("#markdown .markdown-codemirror-editor");
  const quotes = [...host.querySelectorAll(".cm-md-blockquote")];
  const htmlQuote = host.querySelector(".cm-md-html-rendered-surface blockquote");
  if (!htmlQuote || quotes.length < 3) throw new Error("Missing production Markdown/Safe HTML quote projections");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const color = (element, pseudo) => {
    if (!element) throw new Error("Missing production color target");
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(element, pseudo).color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const emphasis = ".cm-md-syntax-strong, .cm-md-syntax-emphasis, .cm-md-syntax-strikethrough, strong, b, em, i, del, s";
  const linkSelector = ".cm-md-syntax-link, [data-md-link-interaction=navigate], a";
  const quoteEmphasis = quotes.flatMap(quote => [...quote.querySelectorAll(emphasis)]
    .filter(element => !element.matches(".cm-md-syntax-link, .cm-md-syntax-markup, .cm-md-markup, .cm-md-emphasis-mark, [class*='cm-md-source-syntax']")
      && !element.closest(linkSelector) && !element.querySelector(linkSelector))
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(quote) })));
  const htmlEmphasis = [...htmlQuote.querySelectorAll(emphasis)]
    .filter(element => !element.closest("a"))
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(htmlQuote) }));
  const quotedMarkers = quotes.flatMap(quote => [...quote.querySelectorAll(".cm-md-syntax-list.cm-md-syntax-markup")]
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(quote) })));
  const quoteColor = color(quotes[0]);
  const nativeMarkers = [...host.querySelectorAll(".cm-md-list-line:not(.cm-md-task-line)")]
    .map(element => ({ text: getComputedStyle(element, "::before").content,
      actual: color(element, "::before"), expected: quoteColor }));
  const htmlMarkers = [...host.querySelectorAll(".cm-md-html-rendered-surface li")]
    .map(element => ({ text: element.textContent, actual: color(element, "::marker"), expected: quoteColor }));
  const bodyLine = host.querySelector(".cm-line");
  const link = bodyLine.querySelector(linkSelector);
  const quotedLinks = [...host.querySelectorAll(".cm-md-blockquote .cm-md-syntax-link, .cm-md-html-rendered-surface blockquote a strong")]
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(link) }));
  const bodyCode = bodyLine.querySelector(".cm-md-syntax-monospace");
  const codeSelector = ".cm-md-syntax-monospace, .cm-md-inline-code, code.cm-md-inline-html";
  const quoteCode = quotes.flatMap(quote => [...quote.querySelectorAll(codeSelector)]
    .filter(element => !element.matches(".cm-md-syntax-link, .cm-md-syntax-markup, .cm-md-markup, [class*='cm-md-source-syntax']")
      && !element.closest(linkSelector) && !element.querySelector(linkSelector))
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(quote),
      font: getComputedStyle(element).fontFamily })));
  const htmlCode = [...htmlQuote.querySelectorAll("code, kbd")]
    .filter(element => !element.closest("a, pre"))
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(htmlQuote),
      font: getComputedStyle(element).fontFamily }));
  const widgetCode = [...host.querySelectorAll(".cm-md-table-cell-content .cm-md-inline-code")]
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(bodyCode),
      font: getComputedStyle(element).fontFamily }));
  const htmlLinkedCode = htmlQuote.querySelector("a code");
  quotedLinks.push({ text: htmlLinkedCode.textContent, actual: color(htmlLinkedCode), expected: color(link) });
  const blockCode = host.querySelector(".cm-md-html-rendered-surface pre code");
  return { editing: Boolean(host.querySelector(".cm-editor.cm-focused")), quoteColor, bodyColor: color(bodyLine), ordinaryStrongColor: color(bodyLine.querySelector(".cm-md-syntax-strong")),
    ordinaryStrongWeight: getComputedStyle(bodyLine.querySelector(".cm-md-syntax-strong")).fontWeight,
    quoteStrongWeight: getComputedStyle(quotes[0].querySelector(".cm-md-syntax-strong")).fontWeight,
    ordinaryCodeColor: color(bodyCode), codeFont: getComputedStyle(bodyCode).fontFamily,
    quoteCodeBackground: getComputedStyle(quotes.map(quote => quote.querySelector(".cm-md-syntax-monospace")).find(Boolean)).backgroundColor,
    ordinaryCodeBackground: getComputedStyle(bodyCode).backgroundColor,
    blockCodeColor: color(blockCode), blockColor: color(blockCode.parentElement),
    quoteEmphasis, htmlEmphasis, quoteCode, htmlCode, widgetCode, quotedMarkers, nativeMarkers, htmlMarkers, quotedLinks };
}

function assertColors(metrics, override) {
  assert.notDeepEqual(metrics.quoteColor, metrics.bodyColor, "quote lost its supporting color");
  assert.notDeepEqual(metrics.ordinaryStrongColor, metrics.quoteColor, "quote changed ordinary strong styling");
  assert.equal(metrics.quoteStrongWeight, metrics.ordinaryStrongWeight, "quote lost its emphasis weight");
  assert.equal(metrics.quoteCodeBackground, metrics.ordinaryCodeBackground, "quote changed the inline code chip background");
  assert.deepEqual(metrics.blockCodeColor, metrics.blockColor, "inline code foreground leaked into a code block");
  if (override) {
    assert.deepEqual(metrics.quoteColor, [88, 115, 102, 255], "quote host token did not propagate");
    assert.deepEqual(metrics.ordinaryStrongColor, [217, 0, 113, 255], "ordinary strong user override was lost");
    assert.deepEqual(metrics.ordinaryCodeColor, [20, 122, 150, 255], "ordinary code host override was lost");
  }
  const minimums = { quoteEmphasis: 8, htmlEmphasis: 3, quoteCode: 3, htmlCode: 4, widgetCode: 1, quotedMarkers: 3, nativeMarkers: 2, htmlMarkers: 3, quotedLinks: 3 };
  for (const [group, minimum] of Object.entries(minimums)) {
    assert(metrics[group].length >= minimum, `${group} fixture coverage is missing`);
    for (const item of metrics[group]) assert.deepEqual(item.actual, item.expected, `${group}: ${item.text}`);
  }
  for (const group of ["quoteCode", "htmlCode", "widgetCode"]) for (const item of metrics[group]) {
    assert.equal(item.font, metrics.codeFont, `${group} lost its product monospace font: ${item.text}`);
  }
}

app.whenReady().then(async () => {
  try {
    const reservation = reservePort();
    await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    vite = await createServer({ root, cacheDir: path.join(temporary, "vite"), logLevel: "error",
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
    await vite.listen();
    browser = new BrowserWindow({ width: 1080, height: 1500, show: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    browser.webContents.on("console-message", details => {
      if (details.level === "error" && !details.message.includes("Electron Security Warning")) errors.push(details.message);
    });
    const evaluate = code => browser.webContents.executeJavaScript(code);
    await browser.loadURL(`http://127.0.0.1:${port}/tests/fixtures/editor/tables/table-interaction.html`);
    browser.webContents.debugger.attach("1.3");
    await browser.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    // The desktop content-surface host supplies this boundary in the app;
    // this fixture mounts the lower-level editor directly.
    await evaluate("(async () => { for(let i=0;i<500&&!window.tableFixture;i++) await new Promise(r=>setTimeout(r,10)); await window.tableFixture.ready(); const section=document.querySelector('#markdown'); section.style.height='1300px'; section.dataset.poThemeSurface='markdown'; })()");
    await evaluate(`window.tableFixture.setMarkdownSource(${JSON.stringify(source)})`);
    for (const mode of ["light", "dark"]) for (const theme of [null, "default.newspaper"]) for (const override of [false, true]) {
      await evaluate(`(async () => {
        await window.tableFixture.mode('${mode}'); await window.tableFixture.theme(${JSON.stringify(theme)});
        const host = document.querySelector('#markdown .markdown-codemirror-editor');
        for (const token of ['--po-user-md-strong-color', '--po-host-md-inline-code-color', '--po-host-md-blockquote-color']) host.style.removeProperty(token);
        if (${override}) { host.style.setProperty('--po-user-md-strong-color', '#d90071'); host.style.setProperty('--po-host-md-inline-code-color', '#147a96'); host.style.setProperty('--po-host-md-blockquote-color', '#587366'); }
        document.activeElement?.blur();
      })()`);
      for (const entry of ["preview", "emphasis", "inline-code"]) {
        const focused = entry !== "preview";
        if (focused) {
          const selector = entry === "inline-code"
            ? "#markdown .cm-md-blockquote .cm-md-syntax-monospace:not(.cm-md-syntax-markup)"
            : "#markdown .cm-md-blockquote .cm-md-syntax-strong:not(.cm-md-syntax-markup)";
          const point = await evaluate(`(() => { const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}; })()`);
          browser.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
          browser.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
        }
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const metrics = await evaluate(`(${readColors.toString()})()`);
        assert.equal(metrics.editing, focused, "native caret focus was not applied");
        assertColors(metrics, override);
        const name = `${mode}-${theme ?? "default"}-${override ? "override" : "standard"}-${entry}`;
        results.push({ name, metrics });
        await fs.writeFile(path.join(artifacts, `${name}.png`), (await browser.webContents.capturePage()).toPNG());
        console.log(`PASS ${name}`);
      }
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error.stack ?? String(error);
    if (browser && !browser.isDestroyed()) await fs.writeFile(path.join(artifacts, "failure.png"), (await browser.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: !failure, source: sourceIdentity, results, errors, failure }, null, 2) + "\n");
    browser?.destroy(); await vite?.close(); await fs.rm(temporary, { recursive: true, force: true });
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });

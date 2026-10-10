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
import postcss from "postcss";
import { createHash } from "node:crypto";
import { createThemeService } from "../../../../../../electron/main/themes/theme-service.mjs";

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
const structuredSource = [
  "Body `inline code` and <code>HTML inline code</code>.", "",
  "> Supporting quote 引用文字", "",
  '```ts file="src/example.ts" lines="1-2"',
  'const example = "代码示例";', 'console.log(example);', "```", "",
  "```text", "Plain code 代码文字", "long line " + "x".repeat(180), "```", "",
  "```", "Unlabelled code", "```", "",
  "| Table 表格 | Value |", "| --- | --- |", "| Plain text | **Bold** `mono` [link](https://example.com) |", "",
  "<div><table><thead><tr><th>HTML table</th></tr></thead><tbody><tr><td><strong>Bold</strong> <code>mono</code></td></tr></tbody></table><pre><code>HTML block code</code></pre><p><code>HTML prose code</code></p></div>", "", "End",
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
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(element.closest("td")),
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
  assert.equal(metrics.quoteCodeBackground, "rgba(0, 0, 0, 0)", "quoted inline code retained its background");
  assert.equal(metrics.ordinaryCodeBackground, "rgba(0, 0, 0, 0)", "body inline code retained its background");
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

function readStructuredContent() {
  const host = document.querySelector("#markdown .markdown-codemirror-editor");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const color = element => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data];
  };
  const rect = element => {
    const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  const tableCell = host.querySelector(".cm-md-table-widget tbody td");
  const tableStyle = getComputedStyle(tableCell);
  const quote = host.querySelector(".cm-md-blockquote");
  const blocks = [...host.querySelectorAll(".cm-md-code-widget")].map(widget => {
    const editor = widget.querySelector("textarea"), highlight = widget.querySelector("pre");
    const language = widget.querySelector(".cm-md-code-language");
    const metadata = widget.querySelector(".cm-md-code-metadata");
    const editorStyle = getComputedStyle(editor), highlightStyle = getComputedStyle(highlight);
    return { language: language.value, placeholder: language.placeholder,
      languageOpacity: getComputedStyle(language).opacity, metadataPosition: getComputedStyle(metadata).position,
      widget: rect(widget), metadata: rect(metadata), panel: rect(widget.querySelector(".cm-md-code-panel")),
      surface: rect(widget.querySelector(".cm-md-code-surface")), color: color(highlight),
      font: editorStyle.fontFamily, highlightFont: highlightStyle.fontFamily,
      size: editorStyle.fontSize, highlightSize: highlightStyle.fontSize,
      editorPadding: editorStyle.padding, highlightPadding: highlightStyle.padding,
      editorLineHeight: editorStyle.lineHeight, highlightLineHeight: highlightStyle.lineHeight,
      editor: rect(editor), highlight: rect(highlight), scrollWidth: editor.scrollWidth, clientWidth: editor.clientWidth,
      sourceReference: widget.querySelector(".cm-md-code-source-reference")?.textContent ?? null,
    };
  });
  const cells = [...host.querySelectorAll(".cm-md-table-widget :is(th,td), .cm-md-html-rendered-surface table :is(th,td)")]
    .map(element => ({ text: element.textContent, color: color(element), size: getComputedStyle(element).fontSize }));
  const inline = [...host.querySelectorAll(".cm-md-syntax-monospace:not(.cm-md-syntax-markup), .cm-md-inline-code, code.cm-md-inline-html, .cm-md-html-rendered-surface code:not(pre code)")]
    .map(element => ({ text: element.textContent, background: getComputedStyle(element).backgroundColor }));
  const emphasis = [...host.querySelectorAll(".cm-md-table-cell-content :is(strong,code), .cm-md-html-rendered-surface table :is(strong,code)")]
    .map(element => ({ text: element.textContent, color: color(element), size: getComputedStyle(element).fontSize }));
  const htmlBlock = host.querySelector(".cm-md-html-rendered-surface pre code");
  const csvCell = document.querySelector("#csv tbody td[data-csv-column]");
  const csvProbe = document.createElement("span"); csvProbe.style.color = "var(--po-text)";
  csvCell.appendChild(csvProbe); const csvExpected = color(csvProbe); csvProbe.remove();
  return { blocks, cells, inline, emphasis, quoteColor: color(quote), tableSize: tableStyle.fontSize,
    bodySize: getComputedStyle(host.querySelector(".cm-line")).fontSize,
    htmlBlockColor: color(htmlBlock), htmlBlockSize: getComputedStyle(htmlBlock).fontSize,
    csvColor: color(csvCell), csvExpected,
    headerCount: host.querySelectorAll(".cm-md-code-header").length };
}

function assertStructuredContent(metrics, scale, inlineBackground = "rgba(0, 0, 0, 0)") {
  assert.equal(metrics.blocks.length, 3, "known, plain and unlabelled code blocks must mount");
  assert.equal(metrics.headerCount, 0, "code header still occupies a row");
  assert(parseFloat(metrics.tableSize) < parseFloat(metrics.bodySize), "structured content must be smaller than body copy");
  if (scale) assert.equal(metrics.tableSize, "11px", "file table size override was lost");
  for (const block of metrics.blocks) {
    assert.deepEqual(block.color, metrics.quoteColor, "code foreground must follow the supporting quote role");
    assert.equal(block.size, metrics.tableSize, "code editor and table font sizes drifted");
    assert.equal(block.highlightSize, block.size, "highlight and editing text sizes drifted");
    assert.equal(block.highlightFont, block.font, "highlight and editing fonts drifted");
    assert.equal(block.editorPadding, block.highlightPadding, "highlight padding drifted");
    assert.equal(block.editorLineHeight, block.highlightLineHeight, "highlight line height drifted");
    assert.deepEqual(block.editor, block.highlight, "highlight and editing geometry drifted");
    assert.equal(block.placeholder, "", "empty language must never show a Code prompt");
    assert.equal(block.metadataPosition, "absolute", "language metadata participates in block flow");
    assert.equal(block.languageOpacity, "1", "known language is gated on hover");
    assert.equal(block.panel.y, block.surface.y, "language metadata reserves a header row");
    assert(block.metadata.y + block.metadata.height <= block.surface.y, "language badge overlaps code text");
  }
  assert.equal(metrics.blocks[0].sourceReference, "src/example.ts · L1–2");
  assert(metrics.blocks[1].scrollWidth > metrics.blocks[1].clientWidth, "long code lines lost horizontal scrolling");
  assert(metrics.cells.length >= 5 && metrics.emphasis.length >= 3 && metrics.inline.length >= 5, "missing production rendering adapters");
  for (const cell of [...metrics.cells, ...metrics.emphasis]) {
    assert.deepEqual(cell.color, metrics.quoteColor, `table supporting foreground: ${cell.text}`);
    assert.equal(cell.size, metrics.tableSize, `table typography: ${cell.text}`);
  }
  for (const code of metrics.inline) assert.equal(code.background, inlineBackground, `inline code background: ${code.text}`);
  assert.deepEqual(metrics.htmlBlockColor, metrics.quoteColor, "Safe HTML code foreground drifted");
  assert.equal(metrics.htmlBlockSize, metrics.tableSize, "Safe HTML code font size drifted");
  assert.deepEqual(metrics.csvColor, metrics.csvExpected, "Markdown supporting role leaked into CSV");
}

function readFileAuthority() {
  const host = document.querySelector("#markdown .markdown-codemirror-editor");
  const css = element => getComputedStyle(element);
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d", { willReadFrequently: true });
  const color = value => {
    context.clearRect(0,0,1,1); context.fillStyle=value; context.fillRect(0,0,1,1);
    return "#" + [...context.getImageData(0,0,1,1).data].slice(0,3).map(v=>v.toString(16).padStart(2,"0")).join("");
  };
  const editor = host.querySelector(".cm-editor");
  const blocks = [...host.querySelectorAll(".cm-md-code-widget")].map(widget => {
    const textarea=css(widget.querySelector("textarea")), pre=css(widget.querySelector("pre"));
    return { size: textarea.fontSize, highlightSize: pre.fontSize, font: textarea.fontFamily, highlightFont: pre.fontFamily,
      padding: textarea.padding, highlightPadding: pre.padding, lineHeight: textarea.lineHeight, highlightLineHeight: pre.lineHeight,
      color: color(pre.color), background: color(css(widget.querySelector(".cm-md-code-panel")).backgroundColor) };
  });
  const htmlPre = css(host.querySelector(".cm-md-html-rendered-surface pre"));
  return { bodyColor: color(css(editor).color), bodySize: css(editor).fontSize, bodyLineHeight: css(host.querySelector(".cm-scroller")).lineHeight,
    bodyFont: css(editor).fontFamily, headingSize: css(host.querySelector(".cm-md-heading-1")).fontSize,
    peerColor: color(css(document.querySelector("#peer .cm-editor")).color), blocks,
    cells: [...host.querySelectorAll(".cm-md-table-widget :is(th,td), .cm-md-html-rendered-surface table :is(th,td)")].map(element => ({
      header: element.tagName === "TH", color: color(css(element).color), size: css(element).fontSize, font: css(element).fontFamily })),
    inline: [...host.querySelectorAll(".cm-md-syntax-monospace:not(.cm-md-syntax-markup), .cm-md-inline-code, code.cm-md-inline-html, .cm-md-html-rendered-surface code:not(pre code)")].map(element => ({ text: element.textContent, background: color(css(element).backgroundColor) })),
    htmlBlock: { color: color(htmlPre.color), size: htmlPre.fontSize, padding: htmlPre.padding, background: color(htmlPre.backgroundColor) },
    mermaid: window.tableFixture.mermaidTheme(),
    session: window.tableFixture.markdownSessionRetained(),
  };
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
    await evaluate(`window.tableFixture.setMarkdownSource(${JSON.stringify(structuredSource)})`);
    for (const mode of ["light", "dark"]) for (const theme of [null, "default.newspaper"]) for (const scale of [false, true]) for (const override of [false, true]) {
      await evaluate(`(async () => {
        await window.tableFixture.mode('${mode}'); await window.tableFixture.theme(${JSON.stringify(theme)});
        const host = document.querySelector('#markdown .markdown-codemirror-editor');
        for (const token of ['--po-user-md-strong-color', '--po-host-md-inline-code-color', '--po-host-md-blockquote-color', '--po-host-md-table-font-size', '--po-type-editor-data', '--po-type-editor-code', '--po-host-md-inline-code-background']) host.style.removeProperty(token);
        if (${scale}) { host.style.setProperty('--po-host-md-table-font-size', '11px'); host.style.setProperty('--po-type-editor-data', '27px'); host.style.setProperty('--po-type-editor-code', '19px'); }
        if (${override}) { host.style.setProperty('--po-host-md-blockquote-color', '#587366'); host.style.setProperty('--po-host-md-inline-code-background', '#ff0000'); }
        document.activeElement?.blur();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      const before = await evaluate(`(${readStructuredContent.toString()})()`);
      assertStructuredContent(before, scale, override ? "rgb(255, 0, 0)" : undefined);
      const empty = before.blocks[2].widget;
      browser.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(empty.x + empty.width - 24), y: Math.round(empty.y + 7) });
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const after = await evaluate(`(${readStructuredContent.toString()})()`);
      assertStructuredContent(after, scale, override ? "rgb(255, 0, 0)" : undefined);
      assert.deepEqual(after.blocks, before.blocks, "hover changed language visibility or code layout");
      const name = `structured-${mode}-${theme ?? "default"}-${scale ? "scaled" : "standard"}-${override ? "override" : "default"}`;
      results.push({ name, metrics: after });
      await fs.writeFile(path.join(artifacts, `${name}.png`), (await browser.webContents.capturePage()).toPNG());
      console.log(`PASS ${name}`);
    }
    // Metadata is outside the panel visually, but remains inside the same
    // editing session. Native focus transitions must not commit half a draft.
    for (const mode of ["light", "dark"]) {
      await evaluate(`(async () => {
        await window.tableFixture.mode('${mode}'); await window.tableFixture.theme(null);
        const host = document.querySelector('#markdown .markdown-codemirror-editor');
        for (const token of ['--po-host-md-table-font-size', '--po-type-editor-data', '--po-type-editor-code', '--po-host-md-blockquote-color', '--po-host-md-inline-code-background']) host.style.removeProperty(token);
        await window.tableFixture.setMarkdownSource(${JSON.stringify(structuredSource)});
      })()`);
      const click = async selector => {
        const point = await evaluate(`(() => { const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}; })()`);
        browser.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
        browser.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      };
      // This isolated BrowserWindow has no application Edit menu translating
      // platform accelerators. Use Chromium's actual edit command instead.
      const selectAll = async () => {
        browser.webContents.selectAll();
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const selected = await evaluate("(() => { const input=document.activeElement; return {value:input.value, start:input.selectionStart, end:input.selectionEnd}; })()");
        assert.equal(selected.start, 0, "native Select All did not reach the focused input");
        assert.equal(selected.end, selected.value.length, "native Select All did not select the entire draft");
      };
      await click("#markdown .cm-md-code-widget .cm-md-code-language"); await selectAll();
      await browser.webContents.insertText("tsx");
      await click("#markdown .cm-md-code-widget .cm-md-code-textarea");
      assert.equal(await evaluate("window.tableFixture.markdownSource()"), structuredSource, "language-to-code focus committed a partial draft");
      await selectAll(); const updatedCode = 'const changed = "' + "x".repeat(180) + '";';
      await browser.webContents.insertText(updatedCode);
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(await evaluate("window.tableFixture.markdownSource()"), structuredSource, "code draft committed before composite blur");
      const metrics = await evaluate(`(${readStructuredContent.toString()})()`); assertStructuredContent(metrics, false);
      const scroll = await evaluate(`(() => { const widget=document.querySelector('#markdown .cm-md-code-widget'); const editor=widget.querySelector('textarea'); editor.scrollLeft=120; editor.dispatchEvent(new Event('scroll')); return {editor:editor.scrollLeft, highlight:widget.querySelector('pre').scrollLeft}; })()`);
      assert(scroll.editor > 0); assert.equal(scroll.editor, scroll.highlight, "horizontal scroll desynchronized the highlight layer");
      await click("#markdown .cm-line");
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const expected = structuredSource.replace('```ts file=', '```tsx file=').replace('const example = "代码示例";\nconsole.log(example);', updatedCode);
      assert.equal(await evaluate("window.tableFixture.markdownSource()"), expected, "composite blur lost code, language or source metadata");
      const name = `code-edit-${mode}`; results.push({ name, metrics, scroll }); console.log(`PASS ${name}`);
      await fs.writeFile(path.join(artifacts, `${name}.png`), (await browser.webContents.capturePage()).toPNG());
    }
    // Exercise the real single-file registration pipeline, not inline CSS
    // pretending to be a theme. Reloading the same id must update all adapters
    // while retaining the CodeMirror view, document, selection and scroll.
    const themeService = createThemeService({ userDataPath: path.join(temporary, "themes-profile"),
      shell: { openPath: async () => "", showItemInFolder: () => {} } });
    const primary = await themeService.createTheme();
    const peer = await themeService.createTheme();
    const primaryFile = path.join(temporary, "themes-profile/themes/custom-theme/theme.css");
    const peerFile = path.join(temporary, "themes-profile/themes/custom-theme-2/theme.css");
    const original = await fs.readFile(primaryFile, "utf8");
    const originalPeer = await fs.readFile(peerFile, "utf8");
    const setRole = (css, name, value) => css.replace(new RegExp(`(${name}:) [^;]+;`, "g"), `$1 ${value};`);
    const fileProfile = (css, revision, isPeer = false) => {
      const roles = {
        "--po-md-content-font": '"Georgia", serif',
        "--po-md-content-size": revision ? "22px" : "18px",
        "--po-md-content-line-height": revision ? "33px" : "29px",
        "--po-md-h1-size": revision ? "42px" : "38px",
        "--po-md-code-font": '"Courier New", monospace',
        "--po-md-table-font-size": revision ? "14px" : "12px",
        "--po-md-table-line-height": "1.6",
        "--po-md-code-block-line-height": revision ? "23px" : "21px",
        "--po-md-code-block-padding": "17px 19px",
        "--po-md-code-block-radius": "9px",
        "--po-md-inline-code-padding": "1px 3px",
        "--po-md-inline-code-radius": "5px",
        "--po-md-mermaid-accent": "#b25696",
      };
      for (const [name, value] of Object.entries(roles)) css = setRole(css, name, value);
      // Explicit light/dark values live in the file. Public references remain
      // late-bound on the document rather than computed at the outer app root.
      css = setRole(css, "--po-md-content-color", isPeer ? "#126b54" : revision ? "#643354" : "#253b52");
      css = setRole(css, "--po-md-blockquote-color", revision ? "#84655c" : "#627b6d");
      css = setRole(css, "--po-md-table-header-color", "#915331");
      css = setRole(css, "--po-md-table-body-color", "#526693");
      css = setRole(css, "--po-md-inline-code-background", revision ? "#d1bbcd" : "#e9dde5");
      css = setRole(css, "--po-md-code-block-background", revision ? "#efddcf" : "#e3eaf4");
      const dark = css.indexOf(".dark .theme-root", css.indexOf("@puppyone markdown"));
      const lightCss = css.slice(0, dark), darkCss = css.slice(dark);
      const authored = postcss.parse(lightCss + setRole(setRole(setRole(darkCss,
        "--po-md-content-color", isPeer ? "#7ad4bd" : revision ? "#ecd2e3" : "#d0e0f1"),
        "--po-md-code-block-background", revision ? "#3b2b20" : "#202f44"),
        "--po-md-inline-code-background", revision ? "#57404f" : "#44313b"));
      authored.walkAtRules("puppyone", block => {
        if (block.params !== "markdown") return;
        const darkRule = postcss.rule({ selector: ".dark .theme-root" });
        darkRule.append(postcss.decl({ prop: "--po-md-inline-code-background", value: revision ? "#57404f" : "#44313b" }));
        block.append(darkRule);
      });
      return authored.toString();
    };
    for (const mode of ["light", "dark"]) for (const revision of [0, 1]) {
      const authoredCss = fileProfile(original, revision);
      await fs.writeFile(primaryFile, authoredCss);
      await fs.writeFile(peerFile, fileProfile(originalPeer, revision, true));
      const snapshot = await themeService.listThemes();
      assert.deepEqual(snapshot.diagnostics, []);
      await evaluate(`(async () => {
        await window.tableFixture.mode('${mode}');
        await window.tableFixture.registerThemes(${JSON.stringify(snapshot)});
        await window.tableFixture.theme(${JSON.stringify(primary.themeId)});
        await window.tableFixture.peerTheme(${JSON.stringify(peer.themeId)});
        const host = document.querySelector('#markdown .markdown-codemirror-editor');
        host.removeAttribute('style');
        ${revision === 0 ? `await window.tableFixture.setMarkdownSource(${JSON.stringify("# File heading\n\n" + structuredSource + "\n\n" + Array(25).fill("Trailing line").join("\n"))});` : ""}
        await document.fonts.ready;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      if (revision === 0) await evaluate("window.tableFixture.checkpointMarkdownSession()");
      const metrics = await evaluate(`(${readFileAuthority.toString()})()`);
      assert.equal(metrics.bodySize, revision ? "22px" : "18px");
      assert.equal(metrics.bodyLineHeight, revision ? "33px" : "29px");
      assert.equal(metrics.headingSize, revision ? "42px" : "38px");
      assert(metrics.bodyFont.includes("Georgia"));
      assert.equal(metrics.bodyColor, mode === "dark" ? revision ? "#ecd2e3" : "#d0e0f1" : revision ? "#643354" : "#253b52");
      assert.equal(metrics.peerColor, mode === "dark" ? "#7ad4bd" : "#126b54", "nested appearance boundary leaked a theme");
      const size = revision ? "14px" : "12px";
      for (const block of metrics.blocks) {
        assert.equal(block.size, size); assert.equal(block.highlightSize, size);
        assert(block.font.includes("Courier New")); assert.equal(block.font, block.highlightFont);
        assert.equal(block.lineHeight, revision ? "23px" : "21px");
        assert.equal(block.lineHeight, block.highlightLineHeight);
        assert.equal(block.padding, "17px 19px"); assert.equal(block.padding, block.highlightPadding);
        assert.equal(block.color, "#" + (revision ? "84655c" : "627b6d"));
        assert.equal(block.background, mode === "dark" ? revision ? "#3b2b20" : "#202f44" : revision ? "#efddcf" : "#e3eaf4");
      }
      for (const cell of metrics.cells) {
        assert.equal(cell.size, size); assert(cell.font.includes("Georgia"));
        assert.equal(cell.color, cell.header ? "#915331" : "#526693");
      }
      const inlineBg = mode === "dark" ? revision ? "#57404f" : "#44313b" : revision ? "#d1bbcd" : "#e9dde5";
      assert(metrics.inline.length >= 5);
      for (const inline of metrics.inline) assert.equal(inline.background, inlineBg, `file inline background: ${inline.text}`);
      assert.equal(metrics.htmlBlock.size, size); assert.equal(metrics.htmlBlock.padding, "17px 19px");
      assert.equal(metrics.htmlBlock.color, revision ? "#84655c" : "#627b6d");
      assert.equal(metrics.htmlBlock.background, metrics.blocks[0].background);
      assert.equal(metrics.mermaid.themeVariables.primaryTextColor, metrics.bodyColor);
      assert.equal(metrics.mermaid.themeVariables.pie1, "#b25696");
      assert.equal(metrics.mermaid.fontSize, revision ? 22 : 18);
      assert.equal(metrics.session.viewRetained, true); assert.equal(metrics.session.sourceRetained, true); assert.equal(metrics.session.selectionRetained, true);
      assert.equal(metrics.session.scrollRetained, true);
      const name = `file-authority-${mode}-revision-${revision}`;
      results.push({ name, sourceFileHash: createHash("sha256").update(authoredCss).digest("hex"), metrics });
      console.log(`PASS ${name}`);
      await fs.writeFile(path.join(artifacts, `${name}.png`), (await browser.webContents.capturePage()).toPNG());
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

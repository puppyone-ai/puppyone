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
  "Ordinary **bold**, `body code`, <code>body HTML code</code>, [link](https://example.com).",
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
  "<div><p>HTML prose <code>HTML body code</code></p><blockquote><p>HTML quote <strong>bold</strong> <em>italic</em> <del>strike</del> <code>HTML code</code> <strong><code>bold code</code></strong> <code><em>italic code</em></code> <kbd>kbd</kbd> <a href=\"https://example.com\"><strong>bold link</strong> <code>code link</code></a></p><ol><li>HTML first</li><li>HTML second</li></ol></blockquote><ol><li>Outside HTML first</li></ol><pre><code>Block code control</code></pre></div>",
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
      actual: color(element, "::before"), expected: quoteColor, weight: getComputedStyle(element, "::before").fontWeight,
      align: getComputedStyle(element, "::before").justifyContent, numeric: getComputedStyle(element, "::before").fontVariantNumeric }));
  const htmlMarkers = [...host.querySelectorAll(".cm-md-html-rendered-surface li")]
    .map(element => ({ text: element.textContent, actual: color(element, "::before"), expected: quoteColor,
      weight: getComputedStyle(element, "::before").fontWeight, align: getComputedStyle(element, "::before").justifyContent,
      numeric: getComputedStyle(element, "::before").fontVariantNumeric }));
  const bodyLine = host.querySelector(".cm-line");
  const link = bodyLine.querySelector(linkSelector);
  const quotedLinks = [...host.querySelectorAll(".cm-md-blockquote .cm-md-syntax-link, .cm-md-html-rendered-surface blockquote a strong")]
    .map(element => ({ text: element.textContent, actual: color(element), expected: color(link) }));
  const bodyCode = bodyLine.querySelector(".cm-md-syntax-monospace");
  const bodyCodes = [...host.querySelectorAll(".cm-md-syntax-monospace:not(.cm-md-syntax-markup), .cm-md-inline-code, code.cm-md-inline-html, .cm-md-html-rendered-surface code:not(pre code)")]
    .filter(element => !element.closest(".cm-md-blockquote, blockquote, .cm-md-table-widget, table, .cm-md-code-widget, pre, .cm-md-syntax-link, a, [data-md-link-interaction=navigate]"))
    .map(element => ({ text: element.textContent, actual: color(element), size: getComputedStyle(element).fontSize,
      weight: getComputedStyle(element).fontWeight }));
  const probe = document.createElement("span"); probe.style.color = "var(--po-md-surface-background)";
  host.appendChild(probe); const surfaceColor = color(probe); probe.remove();
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
  return { editing: Boolean(host.querySelector(".cm-editor.cm-focused")), selectedThemeId: document.querySelector("#surface").dataset.subThemeId,
    quoteColor, surfaceColor, bodyCodes, bodyColor: color(bodyLine), bodySize: getComputedStyle(bodyLine).fontSize,
    bodyWeight: getComputedStyle(bodyLine).fontWeight, ordinaryStrongColor: color(bodyLine.querySelector(".cm-md-syntax-strong")),
    paragraphBefore: getComputedStyle(bodyLine).paddingTop, paragraphAfter: getComputedStyle(bodyLine).paddingBottom,
    ordinaryStrongWeight: getComputedStyle(bodyLine.querySelector(".cm-md-syntax-strong")).fontWeight,
    quoteStrongWeight: getComputedStyle(quotes[0].querySelector(".cm-md-syntax-strong")).fontWeight,
    ordinaryCodeColor: color(bodyCode), codeFont: getComputedStyle(bodyCode).fontFamily,
    quoteCodeBackground: getComputedStyle(quotes.map(quote => quote.querySelector(".cm-md-syntax-monospace")).find(Boolean)).backgroundColor,
    ordinaryCodeBackground: getComputedStyle(bodyCode).backgroundColor,
    blockCodeColor: color(blockCode), blockColor: color(blockCode.parentElement), blockWeight: getComputedStyle(blockCode).fontWeight,
    quoteEmphasis, htmlEmphasis, quoteCode, htmlCode, widgetCode, quotedMarkers, nativeMarkers, htmlMarkers, quotedLinks };
}

function assertColors(metrics, override) {
  assert.equal(metrics.paragraphBefore, "0px", "built-in theme added paragraph leading space");
  assert.equal(metrics.paragraphAfter, "0px", "built-in theme added paragraph trailing space");
  assert.notDeepEqual(metrics.quoteColor, metrics.bodyColor, "quote lost its supporting color");
  assert.notDeepEqual(metrics.ordinaryStrongColor, metrics.quoteColor, "quote changed ordinary strong styling");
  assert.equal(metrics.quoteStrongWeight, metrics.ordinaryStrongWeight, "quote lost its emphasis weight");
  assert.equal(metrics.quoteCodeBackground, "rgba(0, 0, 0, 0)", "quoted inline code retained its background");
  assert.equal(metrics.ordinaryCodeBackground, "rgba(0, 0, 0, 0)", "body inline code retained its background");
  assert.deepEqual(metrics.blockCodeColor, metrics.blockColor, "inline code foreground leaked into a code block");
  assert.equal(metrics.blockWeight, "500", "fenced/Safe HTML blocks lost their medium reading weight");
  if (override) {
    assert.deepEqual(metrics.quoteColor, [88, 115, 102, 255], "quote host token did not propagate");
    assert.deepEqual(metrics.ordinaryStrongColor, [217, 0, 113, 255], "ordinary strong user override was lost");
    assert.deepEqual(metrics.ordinaryCodeColor, [20, 122, 150, 255], "ordinary code host override was lost");
  } else {
    assert.notDeepEqual(metrics.ordinaryCodeColor, metrics.bodyColor, "inline code lost its softer foreground");
    assert.notDeepEqual(metrics.ordinaryCodeColor, metrics.quoteColor, "inline code must stay readable above supporting quote text");
    for (let channel = 0; channel < 3; channel++) {
      assert(metrics.ordinaryCodeColor[channel] >= Math.min(metrics.bodyColor[channel], metrics.quoteColor[channel]) - 1
        && metrics.ordinaryCodeColor[channel] <= Math.max(metrics.bodyColor[channel], metrics.quoteColor[channel]) + 1,
      "inline code must remain in its theme's body/quote palette");
    }
    const luminance = color => color.slice(0, 3).map(value => value / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const foreground = luminance(metrics.ordinaryCodeColor), background = luminance(metrics.surfaceColor);
    assert((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) >= 4.5,
      "muted inline code lost readable contrast");
  }
  assert(metrics.bodyCodes.length >= 3, "native, inline HTML and Safe HTML body code must render");
  for (const code of metrics.bodyCodes) {
    assert.deepEqual(code.actual, metrics.ordinaryCodeColor, `body inline adapter foreground: ${code.text}`);
    assert.equal(code.size, metrics.bodySize, `body inline code gained a private font size: ${code.text}`);
    assert.equal(code.weight, metrics.bodyWeight, `body inline code gained a private bold weight: ${code.text}`);
  }
  const minimums = { quoteEmphasis: 8, htmlEmphasis: 3, quoteCode: 3, htmlCode: 4, widgetCode: 1, quotedMarkers: 3, nativeMarkers: 2, htmlMarkers: 3, quotedLinks: 3 };
  for (const [group, minimum] of Object.entries(minimums)) {
    assert(metrics[group].length >= minimum, `${group} fixture coverage is missing`);
    for (const item of metrics[group]) assert.deepEqual(item.actual, item.expected, `${group}: ${item.text}`);
  }
  for (const group of ["quoteCode", "htmlCode", "widgetCode"]) for (const item of metrics[group]) {
    assert.equal(item.font, metrics.codeFont, `${group} lost its product monospace font: ${item.text}`);
  }
  for (const item of [...metrics.nativeMarkers, ...metrics.htmlMarkers]) {
    assert.equal(item.weight, "400", "list markers regained their heavy emphasis");
    assert.equal(item.align, "end", "ordered marker suffixes lost their alignment");
    assert.equal(item.numeric, "tabular-nums", "ordered markers lost tabular figures");
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
      weight: editorStyle.fontWeight, highlightWeight: highlightStyle.fontWeight,
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
    htmlBlockWeight: getComputedStyle(htmlBlock).fontWeight,
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
    assert.equal(block.weight, "500", "standalone code editing text is too thin");
    assert.equal(block.highlightWeight, block.weight, "highlight and editing text weights drifted");
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
  assert.equal(metrics.htmlBlockWeight, "500", "Safe HTML code weight drifted");
  assert.deepEqual(metrics.csvColor, metrics.csvExpected, "Markdown supporting role leaked into CSV");
}

// Measure production block boxes and the CodeMirror height map, rather than
// merely asserting CSS declarations. The paragraph immediately after every
// heading deliberately has no blank source line to supply accidental spacing.
function readHeadingRhythm() {
  const host = document.querySelector("#markdown .markdown-codemirror-editor");
  const read = element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element);
    const textRects = [...range.getClientRects()].filter(rect => rect.height > 0 && rect.width > 0);
    return { text: element.textContent, size: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight),
      before: parseFloat(style.paddingTop), after: parseFloat(style.paddingBottom),
      marginBefore: parseFloat(style.marginTop), marginAfter: parseFloat(style.marginBottom),
      height: rect.height, top: rect.top, bottom: rect.bottom,
      textTop: Math.min(...textRects.map(rect => rect.top)), textBottom: Math.max(...textRects.map(rect => rect.bottom)),
      nextTextTop: (() => { const next = element.nextElementSibling, range = document.createRange(); range.selectNodeContents(next); return range.getBoundingClientRect().top; })(),
    };
  };
  return { native: [...host.querySelectorAll(".cm-line.cm-md-heading")].map(read),
    html: [...host.querySelectorAll(".cm-md-html-rendered-surface :is(h1,h2,h3,h4,h5,h6)")].map(read),
    geometry: window.tableFixture.markdownLineGeometry() };
}

function assertHeadingRhythm(metrics, newspaper, wrapped = false) {
  const before = newspaper ? [20,17.5,15,12.5,10,10] : [16,14,12,10,8,8];
  const after = newspaper ? [12,9.6,8.4,7.2,6,6] : [10,8,7,6,5,5];
  const near = (actual, expected, label) => assert(Math.abs(actual-expected) < .6, `${label}: ${actual} vs ${expected}`);
  assert.equal(metrics.native.length, 6); assert.equal(metrics.html.length, 6);
  for (let index=0;index<6;index++) {
    const native=metrics.native[index], html=metrics.html[index];
    near(native.before, before[index], `H${index+1} before`); near(native.after, after[index], `H${index+1} after`);
    near(html.marginBefore, before[index], `HTML H${index+1} before`); near(html.marginAfter, after[index], `HTML H${index+1} after`);
    near(native.size, html.size, "shared heading size"); near(native.lineHeight, native.size*1.5, "heading line height");
    near(native.lineHeight, html.lineHeight, "shared heading line height");
    assert(native.nextTextTop-native.textBottom >= after[index], "following paragraph touched heading text");
    assert(html.nextTextTop-html.textBottom >= after[index]-.6, "following HTML paragraph touched heading text");
    const line=metrics.geometry.lines.find(line => line.text.startsWith("#".repeat(index+1)+" "));
    assert(line, "heading source line is missing"); near(line.height, native.height, "CodeMirror height map");
    const rows=(native.height-native.before-native.after)/native.lineHeight;
    near(rows, Math.round(rows), "heading row count");
    if(wrapped) assert(rows >= 2, "long heading did not wrap"); else near(rows, 1, "short heading row count");
  }
}

function readBlockRhythm() {
  const host=document.querySelector('#markdown .markdown-codemirror-editor');
  const geometry=window.tableFixture.markdownLineGeometry();
  const textRects=element => {
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT), rects=[];
    while(walker.nextNode()) {
      const node=walker.currentNode;
      if(!node.textContent.trim() || node.parentElement.closest('button,.cm-md-hidden-syntax')) continue;
      const range=document.createRange();range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter(rect=>rect.width>2&&rect.height>2).map(rect=>({x:rect.x,y:rect.y,width:rect.width,height:rect.height})));
    }
    return rects;
  };
  const read=element => {
    const css=getComputedStyle(element), pseudo=getComputedStyle(element,'::before'), rect=element.getBoundingClientRect();
    const text=textRects(element);
    const sourceLine=geometry.lines.find(line=>line.text.trim()===element.textContent.trim() || line.text.includes(element.textContent.trim()));
    return {text:element.textContent, classes:element.className, x:rect.x,y:rect.y,height:rect.height, size:parseFloat(css.fontSize),
      ordered:element.classList.contains('cm-md-ordered-list-line')||element.matches('ol > li'),
      orderedGroup:element.matches('ol > li') ? [...host.querySelectorAll('.cm-md-html-rendered-surface ol')].indexOf(element.parentElement) : null,
      before:parseFloat(css.paddingTop),after:parseFloat(css.paddingBottom),indent:parseFloat(css.paddingInlineStart),
      marginBefore:parseFloat(css.marginTop),marginAfter:parseFloat(css.marginBottom),
      depth:Number(css.getPropertyValue('--md-list-depth')),columns:Number(css.getPropertyValue('--md-list-marker-columns')),
      marker:{content:pseudo.content,left:parseFloat(pseudo.insetInlineStart),top:parseFloat(pseudo.insetBlockStart),width:parseFloat(pseudo.width),height:parseFloat(pseudo.height),align:pseudo.justifyContent,
        weight:pseudo.fontWeight,numeric:pseudo.fontVariantNumeric,
        box:{x:rect.x+parseFloat(pseudo.insetInlineStart),y:rect.y+parseFloat(pseudo.insetBlockStart),width:parseFloat(pseudo.width),height:parseFloat(pseudo.height)}},
      textRects:text,sourceLine,
      checkbox:(()=>{const button=element.querySelector('.cm-md-task-checkbox-widget');if(!button)return null;const box=button.getBoundingClientRect();return {x:box.x-rect.x,y:box.y-rect.y,width:box.width,height:box.height};})()};
  };
  return { paragraphs:[...host.querySelectorAll('.cm-line.cm-md-paragraph-start, .cm-line.cm-md-paragraph-end')].map(read),
    lists:[...host.querySelectorAll('.cm-line.cm-md-list-line')].map(read),
    htmlParagraphs:[...host.querySelectorAll('.cm-md-html-rendered-surface > div > p')].map(read),
    htmlLists:[...host.querySelectorAll('.cm-md-html-rendered-surface li')].map(read),
    htmlOrderedColumns:host.querySelector('.cm-md-html-rendered-surface ol').style.getPropertyValue('--md-list-marker-columns'),
    htmlOrderedStart:host.querySelector('.cm-md-html-rendered-surface ol').start,
    selectedLine:geometry.selectedLine, sourceLines:geometry.lines };
}

function assertBlockRhythm(metrics) {
  const near=(a,b,label)=>assert(Math.abs(a-b)<.7,`${label}: ${a} vs ${b}`);
  const paragraph=metrics.paragraphs.find(line=>line.text.startsWith('P1'));
  const continuation=metrics.paragraphs.find(line=>line.text.startsWith('Continued paragraph'));
  assert(paragraph && continuation,'missing multiline paragraph');
  near(paragraph.before,0,'paragraph before');near(paragraph.after,3,'soft source line padding');
  near(continuation.before,3,'continuation padding');near(continuation.after,0,'paragraph after');
  const next=metrics.paragraphs.find(line=>line.text.startsWith('P2'));
  const spaced=metrics.paragraphs.find(line=>line.text.startsWith('P3'));
  for(const [before,after,count] of [[continuation,next,1],[next,spaced,3]]) {
    assert(before && after,'missing source-spaced paragraphs');
    const blankLines=metrics.sourceLines.filter(line=>line.number>before.sourceLine.number && line.number<after.sourceLine.number);
    assert.equal(blankLines.length,count);assert(blankLines.every(line=>line.text===''),'source blank lines were collapsed');
    near(after.y-before.y-before.height,blankLines.reduce((sum,line)=>sum+line.height,0),'paragraph gap must equal its source blank lines');
    near(after.before,0,'single-line paragraph before');near(after.after,0,'single-line paragraph after');
  }
  for(const line of [...metrics.paragraphs,...metrics.lists]) near(line.height,line.sourceLine.height,'CodeMirror block height');
  const bullet=metrics.lists.find(line=>line.text.includes('Bullet first'));
  assert(bullet.textRects.length>=2,'long bullet did not wrap');
  near(bullet.indent,bullet.size*1.875,'character-relative indent');near(bullet.marker.left,bullet.size*.25,'inset marker');
  near(bullet.marker.width,bullet.size*1.25,'marker slot');assert.equal(bullet.marker.align,'center');
  near(bullet.marker.top,bullet.before,'marker tracks first line padding');
  for(const rect of bullet.textRects) near(rect.x-bullet.x,bullet.indent,'wrapped hanging indent');
  const continued=metrics.lists.find(line=>line.text.includes('Continued list item'));
  assert(continued.classes.includes('cm-md-list-continuation'));
  near(continued.indent,bullet.indent,'source continuation indent');
  for(const rect of continued.textRects)near(rect.x-continued.x,continued.indent,'hidden continuation prefix');
  const nested=metrics.lists.find(line=>line.text.includes('Nested bullet'));
  assert.equal(nested.depth,1);near(nested.indent-bullet.indent,Math.max(bullet.size*1.5,bullet.marker.width+bullet.size*.375),'semantic nested step');
  const ordered=metrics.lists.filter(line=>/Ordered (nine|ten|hundred)/.test(line.text));
  assert.equal(ordered.length,3);
  for(const line of ordered){
    assert.equal(line.columns,4);near(line.indent,ordered[0].indent,'shared ordered column');assert.equal(line.marker.align,'end');
    assert.equal(line.marker.weight,'400');assert.equal(line.marker.numeric,'tabular-nums');
    near(line.indent-line.marker.left-line.marker.width,line.size*.375,'stable ordered text gap');
    for(const rect of line.textRects)near(rect.x-line.x,line.indent,'ordered hanging text');
  }
  assert(ordered[0].textRects.length>=2,'ordered body must wrap');
  const nestedOrdered=metrics.lists.filter(line=>line.text.includes('Nested numbered'));
  assert.equal(nestedOrdered.length,3);
  for(const line of nestedOrdered){
    assert.equal(line.columns,5);assert.equal(line.depth,1);assert.equal(line.marker.align,'end');
    near(line.indent-ordered[0].indent,Math.max(line.size*1.5,line.marker.width+line.size*.375),'nested ordered step');
    assert(line.x+line.marker.left >= ordered[0].x+ordered[0].indent-.7,'nested marker escaped its parent text column');
  }
  const grandchild=metrics.lists.find(line=>line.text.includes('Nested under wide number'));
  assert.equal(grandchild.depth,2);near(grandchild.indent-nestedOrdered[0].indent,Math.max(grandchild.size*1.5,grandchild.marker.width+grandchild.size*.375),'mixed nesting step');
  const task=metrics.lists.find(line=>line.text.includes('Task item'));
  near(task.indent,bullet.indent,'shared task text column');
  near(task.checkbox.x+task.checkbox.width/2,bullet.marker.left+bullet.marker.width/2,'centered checkbox');
  near(task.checkbox.y+task.checkbox.height/2,task.before+bullet.marker.height/2,'checkbox first line center');
  assert.equal(metrics.htmlParagraphs.length,2);
  for(const line of metrics.htmlParagraphs){near(line.marginBefore,0,'HTML paragraph before');near(line.marginAfter,0,'HTML paragraph after');}
  for(const line of metrics.htmlLists){assert.equal(line.marker.align,line.ordered?'end':'center');assert(line.marker.width>0,'HTML marker lost its slot');assert.equal(line.marker.weight,'400');}
  const htmlRoots=metrics.htmlLists.filter(line=>line.orderedGroup===0),htmlChildren=metrics.htmlLists.filter(line=>line.orderedGroup===1);
  assert.equal(htmlRoots.length,12);assert.equal(htmlChildren.length,12);
  for(const line of htmlRoots)near(line.x,htmlRoots[0].x,'HTML ordered body column');
  for(const line of htmlChildren){
    near(line.x-htmlRoots[0].x,Math.max(line.size*1.5,line.marker.width+line.size*.375),'HTML nested ordered step');
    assert(line.x+line.marker.left >= htmlRoots[0].x-.7,'HTML nested marker escaped its parent text column');
  }
  assert.equal(metrics.htmlOrderedColumns,'3');assert.equal(metrics.htmlOrderedStart,1);
}

// Capture the painted pseudo-elements: computed justify-content alone cannot
// prove that punctuation actually lands on the same pixel column.
async function readMarkerInk(dataUrl, crop) {
  const image=new Image();image.src=dataUrl;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
  const {data}=context.getImageData(0,0,image.width,image.height),background=[...data.slice(0,3)];
  let left=image.width,right=-1,count=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const offset=(y*image.width+x)*4;
    if(data[offset+3] && Math.max(...background.map((value,channel)=>Math.abs(data[offset+channel]-value)))>25){
      left=Math.min(left,x);right=Math.max(right,x);count++;
    }
  }
  const scale=image.width/crop.width;
  return {left:crop.x+left/scale,right:crop.x+(right+1)/scale,count};
}

async function captureOrderedMarkerInk(browser,evaluate,metrics,name) {
  const groups=[metrics.lists.filter(line=>/Ordered (nine|ten|hundred)/.test(line.text)),
    metrics.lists.filter(line=>line.text.includes('Nested numbered')),
    ...[0,1].map(group=>metrics.htmlLists.filter(line=>line.orderedGroup===group))];
  const samples=[];
  for(let group=0;group<groups.length;group++){
    const lines=groups[group].length>3 ? [groups[group][0],groups[group][8],groups[group][9],groups[group].at(-1)] : groups[group];
    const inks=[];
    for(let index=0;index<lines.length;index++){
      const box=lines[index].marker.box,crop={x:Math.floor(box.x),y:Math.floor(box.y),width:Math.ceil(box.width)+2,height:Math.ceil(box.height)+1};
      const image=await browser.webContents.capturePage(crop);
      const ink=await evaluate(`(${readMarkerInk.toString()})(${JSON.stringify(image.toDataURL())},${JSON.stringify(crop)})`);
      assert(ink.count>10,'painted ordered marker is missing');
      inks.push(ink);await fs.writeFile(path.join(artifacts,`${name}-marker-${group}-${index}.png`),image.toPNG());
    }
    assert(Math.max(...inks.map(ink=>ink.right))-Math.min(...inks.map(ink=>ink.right))<1.3,'ordered punctuation is not aligned in painted pixels');
    samples.push(inks);
  }
  return samples;
}

function readFileAuthority() {
  const host = document.querySelector("#markdown .markdown-codemirror-editor");
  for (const selector of ['.cm-md-heading-1','.cm-md-heading-2','.cm-md-paragraph-start','.cm-md-paragraph-end','.cm-md-list-line','.cm-md-html-rendered-surface pre']) {
    if(!host.querySelector(selector)) throw new Error(`Registered-file fixture missing measured projection: ${selector}`);
  }
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
      weight: textarea.fontWeight, highlightWeight: pre.fontWeight,
      padding: textarea.padding, highlightPadding: pre.padding, lineHeight: textarea.lineHeight, highlightLineHeight: pre.lineHeight,
      color: color(pre.color), background: color(css(widget.querySelector(".cm-md-code-panel")).backgroundColor) };
  });
  const htmlPre = css(host.querySelector(".cm-md-html-rendered-surface pre"));
  return { bodyColor: color(css(editor).color), bodySize: css(editor).fontSize, bodyLineHeight: css(host.querySelector(".cm-scroller")).lineHeight,
    bodyFont: css(editor).fontFamily, headingSize: css(host.querySelector(".cm-md-heading-1")).fontSize,
    headingLineHeight: css(host.querySelector(".cm-md-heading-1")).lineHeight,
    headingBefore: css(host.querySelector(".cm-md-heading-1")).paddingTop,
    headingAfter: css(host.querySelector(".cm-md-heading-1")).paddingBottom,
    subheadingBefore: css(host.querySelector(".cm-md-heading-2")).paddingTop,
    paragraphBefore: css(host.querySelector(".cm-md-paragraph-start")).paddingTop,
    paragraphAfter: css(host.querySelector(".cm-md-paragraph-end")).paddingBottom,
    listIndent: css(host.querySelector(".cm-md-list-line")).paddingInlineStart,
    listMarkerInset: getComputedStyle(host.querySelector(".cm-md-list-line"), "::before").insetInlineStart,
    orderedMarker:(()=>{const marker=getComputedStyle(host.querySelector('.cm-md-ordered-list-line'),'::before');return {weight:marker.fontWeight,numeric:marker.fontVariantNumeric,align:marker.justifyContent};})(),
    peerColor: color(css(document.querySelector("#peer .cm-editor")).color), blocks,
    cells: [...host.querySelectorAll(".cm-md-table-widget :is(th,td), .cm-md-html-rendered-surface table :is(th,td)")].map(element => ({
      header: element.tagName === "TH", color: color(css(element).color), size: css(element).fontSize, font: css(element).fontFamily })),
    inline: [...host.querySelectorAll(".cm-md-syntax-monospace:not(.cm-md-syntax-markup), .cm-md-inline-code, code.cm-md-inline-html, .cm-md-html-rendered-surface code:not(pre code)")].map(element => ({ text: element.textContent, background: color(css(element).backgroundColor), color: color(css(element).color),
      supportingContext: Boolean(element.closest(".cm-md-blockquote, blockquote, .cm-md-table-widget, table, .cm-md-syntax-link, a, [data-md-link-interaction=navigate]")) })),
    htmlBlock: { color: color(htmlPre.color), size: htmlPre.fontSize, weight: htmlPre.fontWeight, padding: htmlPre.padding, background: color(htmlPre.backgroundColor) },
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
        document.querySelector('#markdown .cm-content').blur();
        for(let frame=0;frame<30&&host.querySelector('.cm-editor.cm-focused');frame++) await new Promise(resolve=>requestAnimationFrame(resolve));
        if(host.querySelector('.cm-editor.cm-focused')) throw new Error('Native Markdown blur did not settle');
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
    // Neutral/Newspaper above cover native editing and explicit overrides.
    // Check every other built-in file in its supported modes, including the
    // actual XP appearance family rather than a fallback Default theme.
    for (const theme of ["default.warm", "default.graphite", "default.github", "windows-xp.luna-blue"]) {
      for (const mode of theme === "windows-xp.luna-blue" ? ["light"] : ["light", "dark"]) {
        await evaluate(`(async () => {
          await window.tableFixture.mode('${mode}'); await window.tableFixture.theme('${theme}', '${theme.startsWith("windows-xp") ? "windows-xp" : "default"}');
          const host = document.querySelector('#markdown .markdown-codemirror-editor');
          for (const token of ['--po-user-md-strong-color', '--po-host-md-inline-code-color', '--po-host-md-blockquote-color']) host.style.removeProperty(token);
          document.querySelector('#markdown .cm-content').blur();
          for(let frame=0;frame<30&&host.querySelector('.cm-editor.cm-focused');frame++) await new Promise(resolve=>requestAnimationFrame(resolve));
        })()`);
        const metrics = await evaluate(`(${readColors.toString()})()`);
        assert.equal(metrics.selectedThemeId, theme, "built-in test selected a fallback theme");
        assert.equal(metrics.editing, false);
        assertColors(metrics, false);
        const name = `inline-tone-${mode}-${theme}`;
        results.push({ name, metrics }); console.log(`PASS ${name}`);
        await fs.writeFile(path.join(artifacts, `${name}.png`), (await browser.webContents.capturePage()).toPNG());
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
    // All six levels, first HTML heading, consecutive blocks without blank
    // lines, wrapped headings and actual pointer editing share one rhythm.
    for (const mode of ["light", "dark"]) for (const theme of [null, "default.newspaper"]) for (const wrapped of [false, true]) {
      const title = level => wrapped ? `Heading ${level} ` + "wrapped 标题节奏 ".repeat(18) : `Heading ${level}`;
      const headings = Array.from({length:6}, (_, index) => `${index ? "Before\n" : ""}${"#".repeat(index+1)} ${title(index+1)}\nAfter`).join("\n");
      const html = "<div>" + Array.from({length:6}, (_, index) => `<h${index+1}>${title(index+1)}</h${index+1}><p>After HTML</p>`).join("") + "</div>";
      await evaluate(`(async () => {
        await window.tableFixture.mode('${mode}'); await window.tableFixture.theme(${JSON.stringify(theme)});
        document.querySelector('#markdown .markdown-codemirror-editor').removeAttribute('style');
        document.querySelector('#markdown').style.height='4800px';
        await window.tableFixture.setMarkdownSource(${JSON.stringify(headings+"\n\n"+html+"\n\nEnd")});
        await document.fonts.ready; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      // Hidden Chromium still uses the native viewport for virtualization.
      await browser.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width:1080, height:5200, deviceScaleFactor:1, mobile:false });
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const metrics = await evaluate(`(${readHeadingRhythm.toString()})()`);
      assertHeadingRhythm(metrics, theme === "default.newspaper", wrapped);
      if (!wrapped) for (let index=0;index<6;index++) {
        const point=await evaluate(`(() => { const heading=document.querySelectorAll('#markdown .cm-line.cm-md-heading')[${index}]; const range=document.createRange(); range.selectNodeContents(heading); const rect=[...range.getClientRects()].find(rect=>rect.height>0&&rect.width>0); return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}; })()`);
        browser.webContents.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...point});
        browser.webContents.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...point});
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const edited=await evaluate(`(${readHeadingRhythm.toString()})()`);
        assertHeadingRhythm(edited, theme === "default.newspaper");
        const expectedLine=edited.geometry.lines.find(line=>line.text.startsWith("#".repeat(index+1)+" ")).number;
        assert.equal(edited.geometry.selectedLine, expectedLine, "pointer landed outside the heading source line");
        assert.equal(edited.native[index].height, metrics.native[index].height, "revealing heading syntax shifted row geometry");
      }
      if (!wrapped) {
        await evaluate("window.tableFixture.preview(false)");
        const sourceMetrics=await evaluate(`(() => {
          const host=document.querySelector('#markdown .markdown-codemirror-editor');
          const body=getComputedStyle(host.querySelector('.cm-line'));
          return {bodySize:body.fontSize, bodyLineHeight:body.lineHeight,
            headings:[...host.querySelectorAll('.cm-line')].filter(line=>/^#{1,6} /.test(line.textContent)).map(line=>{
              const css=getComputedStyle(line); return {size:css.fontSize, lineHeight:css.lineHeight, before:css.paddingTop, after:css.paddingBottom};
            })};
        })()`);
        assert.equal(sourceMetrics.headings.length,6);
        for (const heading of sourceMetrics.headings) {
          assert.equal(heading.size,sourceMetrics.bodySize); assert.equal(heading.lineHeight,sourceMetrics.bodyLineHeight);
          assert.equal(heading.before,"0px"); assert.equal(heading.after,"0px");
        }
        metrics.sourceMode=sourceMetrics;
        await evaluate("window.tableFixture.preview(true)");
        assertHeadingRhythm(await evaluate(`(${readHeadingRhythm.toString()})()`), theme === "default.newspaper");
      }
      const name=`heading-rhythm-${mode}-${theme ?? "default"}-${wrapped ? "wrapped" : "short"}`;
      results.push({name,metrics}); console.log(`PASS ${name}`);
      const contentBottom=await evaluate("document.querySelector('#markdown .cm-content').getBoundingClientRect().bottom");
      await fs.writeFile(path.join(artifacts, `${name}.png`), (await browser.webContents.capturePage({x:0,y:0,width:1080,height:Math.ceil(contentBottom+24)})).toPNG());
    }
    await browser.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
    await evaluate("document.querySelector('#markdown').style.height='1300px'");
    const blockSource=[
      'P1 paragraph ' + 'readable 正文 '.repeat(10),
      'Continued paragraph in the same semantic block.', '', 'P2 next paragraph.', '', '', '', 'P3 after three source blank lines.', '',
      '- Bullet first ' + 'wrapped 列表正文 '.repeat(12),
      '  Continued list item on a second source line.',
      '    - Nested bullet', '- Bullet next', '',
      '9. Ordered nine ' + 'wrapped 编号正文 '.repeat(12), '10. Ordered ten', '100. Ordered hundred',
      '     9. Nested numbered nine','     10. Nested numbered ten','     1000. Nested numbered thousand','           - Nested under wide number',
      '', '- [ ] Task item', '',
      '<div><p>HTML paragraph one.</p><p>HTML paragraph two.</p><ul><li>HTML bullet<ul><li>HTML nested</li></ul></li><li>HTML next</li></ul><ol>'
        + Array.from({length:12},(_,i)=>`<li>HTML ordered ${i+1}${i===11?'<ol>'+Array.from({length:12},(_,j)=>`<li>HTML child ${j+1}</li>`).join('')+'</ol>':''}</li>`).join('')+'</ol></div>', '', 'End',
    ].join('\n');
    for(const mode of ['light','dark'])for(const theme of [null,'default.newspaper'])for(const width of [1080,760]) {
      await browser.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height:4000,deviceScaleFactor:1,mobile:false});
      await evaluate(`(async()=>{
        await window.tableFixture.mode('${mode}');await window.tableFixture.theme(${JSON.stringify(theme)});
        document.querySelector('#markdown').style.height='3500px';
        document.querySelector('#markdown .markdown-codemirror-editor').removeAttribute('style');
        await window.tableFixture.setMarkdownSource(${JSON.stringify(blockSource)});
        await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      })()`);
      const metrics=await evaluate(`(${readBlockRhythm.toString()})()`);assertBlockRhythm(metrics);
      const name=`block-rhythm-${mode}-${theme??'default'}-${width}`;
      metrics.markerInk=await captureOrderedMarkerInk(browser,evaluate,metrics,name);
      const point=metrics.lists.find(line=>line.text.includes('Bullet first')).textRects[0];
      const inputPoint={x:Math.round(point.x+point.width/2),y:Math.round(point.y+point.height/2)};
      browser.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...inputPoint});
      browser.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...inputPoint});
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const edited=await evaluate(`(${readBlockRhythm.toString()})()`);assertBlockRhythm(edited);
      assert.equal(edited.selectedLine,edited.lists.find(line=>line.text.includes('Bullet first')).sourceLine.number,'pointer missed hanging list text');
      const numbered=edited.lists.find(line=>line.text.includes('Ordered nine')).textRects[0];
      const numberedPoint={x:Math.round(numbered.x+numbered.width/2),y:Math.round(numbered.y+numbered.height/2)};
      browser.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...numberedPoint});
      browser.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...numberedPoint});
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const numberedEditing=await evaluate(`(${readBlockRhythm.toString()})()`);assertBlockRhythm(numberedEditing);
      assert.equal(numberedEditing.selectedLine,numberedEditing.lists.find(line=>line.text.includes('Ordered nine')).sourceLine.number,'pointer missed numbered body');
      assert.equal(await evaluate('window.tableFixture.markdownSource()'),blockSource,'presentation changed canonical source');
      await evaluate('window.tableFixture.preview(false)');
      const sourceMode=await evaluate(`(()=>{
        const host=document.querySelector('#markdown .markdown-codemirror-editor');
        return {projectedLists:host.querySelectorAll('.cm-md-list-line').length,
          lines:[...host.querySelectorAll('.cm-line')].map(line=>{const css=getComputedStyle(line);return {before:css.paddingTop,after:css.paddingBottom,indent:css.paddingInlineStart};})};
      })()`);
      assert.equal(sourceMode.projectedLists,0);
      for(const line of sourceMode.lines){assert.equal(line.before,'0px');assert.equal(line.after,'0px');assert.equal(line.indent,'0px');}
      metrics.sourceMode=sourceMode;
      await evaluate('window.tableFixture.preview(true)');
      assertBlockRhythm(await evaluate(`(${readBlockRhythm.toString()})()`));
      results.push({name,metrics});console.log(`PASS ${name}`);
      const bottom=await evaluate("document.querySelector('#markdown .cm-content > .cm-line:last-child').getBoundingClientRect().bottom+48");
      await fs.writeFile(path.join(artifacts,`${name}.png`),(await browser.webContents.capturePage({x:0,y:0,width,height:Math.ceil(bottom+24)})).toPNG());
    }
    await browser.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
    await evaluate("document.querySelector('#markdown').style.height='1300px'");
    // Custom font/spacing profiles are taller than the neutral document.
    // Keep every measured structured adapter inside this fixture's viewport.
    await browser.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1080,height:3200,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('#markdown').style.height='2800px'");
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
        "--po-md-heading-gap-before": revision ? "44px" : "36px",
        "--po-md-h1-gap-before": revision ? "49px" : "37px",
        "--po-md-h1-gap-after": revision ? "25px" : "17px",
        "--po-md-heading-line-height": revision ? "1.6" : "1.4",
        "--po-md-paragraph-gap-before": revision ? "11px" : "7px",
        "--po-md-paragraph-gap-after": revision ? "27px" : "19px",
        "--po-md-list-inset": revision ? "15px" : "9px",
        "--po-md-list-marker-width": revision ? "calc(28px + 0%)" : "28px",
        "--po-md-list-marker-gap": revision ? "12px" : "8px",
        "--po-md-list-marker-weight": revision ? "450" : "350",
        "--po-md-list-marker-numeric-variant": revision ? "tabular-nums" : "proportional-nums",
        "--po-md-ordered-marker-align": revision ? "end" : "start",
        "--po-md-code-font": '"Courier New", monospace',
        "--po-md-table-font-size": revision ? "14px" : "12px",
        "--po-md-table-line-height": "1.6",
        "--po-md-code-block-line-height": revision ? "23px" : "21px",
        "--po-md-code-block-font-weight": revision ? "600" : "450",
        "--po-md-code-block-padding": "17px 19px",
        "--po-md-code-block-radius": "9px",
        "--po-md-inline-code-padding": "1px 3px",
        "--po-md-inline-code-radius": "5px",
        "--po-md-inline-code-color": revision ? "#786592" : "#596c87",
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
        ${revision === 0 ? `await window.tableFixture.setMarkdownSource(${JSON.stringify("# File heading\n\n## File subheading\nAfter subheading\n\n- File list item\n- Second file list item\n\n1. File ordered one\n2. File ordered two\n\n" + structuredSource + "\n\n" + Array(25).fill("Trailing line").join("\n"))});` : ""}
        await document.fonts.ready;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      if (revision === 0) await evaluate("window.tableFixture.checkpointMarkdownSession()");
      const metrics = await evaluate(`(${readFileAuthority.toString()})()`);
      assert.equal(metrics.bodySize, revision ? "22px" : "18px");
      assert.equal(metrics.bodyLineHeight, revision ? "33px" : "29px");
      assert.equal(metrics.headingSize, revision ? "42px" : "38px");
      assert.equal(metrics.headingBefore, revision ? "49px" : "37px");
      assert.equal(metrics.headingAfter, revision ? "25px" : "17px");
      assert.equal(metrics.paragraphBefore,revision ? "11px" : "7px");
      assert.equal(metrics.paragraphAfter,revision ? "27px" : "19px");
      assert.equal(metrics.listIndent,revision ? "55px" : "45px");
      assert.equal(metrics.listMarkerInset,revision ? "15px" : "9px");
      assert.deepEqual(metrics.orderedMarker,{weight:revision?'450':'350',numeric:revision?'tabular-nums':'proportional-nums',align:revision?'end':'start'},'registered marker styles were not applied');
      assert.equal(metrics.subheadingBefore, revision ? "38.5px" : "31.5px", "per-level gap lost its file-owned base reference");
      assert(Math.abs(parseFloat(metrics.headingLineHeight)-(revision ? 42*1.6 : 38*1.4)) < .01, "file heading line-height was lost");
      assert(metrics.bodyFont.includes("Georgia"));
      assert.equal(metrics.bodyColor, mode === "dark" ? revision ? "#ecd2e3" : "#d0e0f1" : revision ? "#643354" : "#253b52");
      assert.equal(metrics.peerColor, mode === "dark" ? "#7ad4bd" : "#126b54", "nested appearance boundary leaked a theme");
      const size = revision ? "14px" : "12px";
      for (const block of metrics.blocks) {
        assert.equal(block.size, size); assert.equal(block.highlightSize, size);
        assert.equal(block.weight, revision ? "600" : "450"); assert.equal(block.highlightWeight, block.weight);
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
      const bodyInline = metrics.inline.filter(inline => !inline.supportingContext);
      assert(bodyInline.length >= 3, "file body inline adapters are missing");
      for (const inline of bodyInline) assert.equal(inline.color, revision ? "#786592" : "#596c87", `file inline foreground: ${inline.text}`);
      assert.equal(metrics.htmlBlock.size, size); assert.equal(metrics.htmlBlock.padding, "17px 19px");
      assert.equal(metrics.htmlBlock.weight, revision ? "600" : "450");
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

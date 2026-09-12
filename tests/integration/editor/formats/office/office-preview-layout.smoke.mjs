#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-office-preview-smoke-"));
const userDataPath = path.join(tempRoot, "user-data");
const windows = [];

await fsp.mkdir(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu");

const officeCss = await fsp.readFile(
  path.join(repoRoot, "packages/shared-ui/src/styles/editor/media-office-preview.css"),
  "utf8",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNear(actual, expected, message, tolerance = 1.25) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected} ± ${tolerance}, received ${actual}`);
  }
}

function documentHtml(markup) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          :root {
            --po-border: rgba(255, 255, 255, 0.14);
            --po-border-subtle: rgba(255, 255, 255, 0.08);
            --po-control-hover: rgba(255, 255, 255, 0.09);
            --po-divider: rgba(255, 255, 255, 0.09);
            --po-editor-bg: #181818;
            --po-file-accent-html: #2463eb;
            --po-file-accent-presentation: #f07a43;
            --po-file-accent-sheet: #8dc149;
            --po-focus-ring: rgba(96, 165, 250, 0.45);
            --po-font-ui: system-ui, sans-serif;
            --po-hover: rgba(255, 250, 242, 0.052);
            --po-panel: #202020;
            --po-panel-raised: #292929;
            --po-scrollbar-thumb: rgba(255, 255, 255, 0.18);
            --po-shadow: rgba(0, 0, 0, 0.45);
            --po-shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.24);
            --po-selected: rgba(255, 250, 242, 0.095);
            --po-text: #f5f5f5;
            --po-text-muted: #aaa;
            --po-text-subtle: #777;
          }
          html, body, #root {
            width: 100%;
            height: 100%;
            margin: 0;
          }
          body {
            overflow: hidden;
            background: var(--po-editor-bg);
            font-family: var(--po-font-ui);
          }
          ${officeCss}
        </style>
      </head>
      <body><div id="root">${markup}</div></body>
    </html>`;
}

function spreadsheetMarkup() {
  const columns = Array.from(
    { length: 8 },
    (_, index) => `<col style="width:${index === 0 ? 180 : 130}px">`,
  ).join("");
  const headers = Array.from(
    { length: 8 },
    (_, index) => `<th class="office-spreadsheet-grid__column-header" ${index === 1 ? 'data-selected="true"' : ""}>${String.fromCharCode(65 + index)}</th>`,
  ).join("");
  const rows = Array.from({ length: 60 }, (_, rowIndex) => {
    const cells = Array.from({ length: 8 }, (_, columnIndex) => {
      const numeric = columnIndex > 0;
      const selected = rowIndex === 8 && columnIndex === 1;
      const styled = rowIndex === 0 && columnIndex === 0;
      return `<td
        data-cell-kind="${numeric ? "number" : "text"}"
        ${selected ? 'data-selected="true"' : ""}
        ${styled ? 'style="background:#0b2545;color:#fff;font-size:19px;font-weight:700"' : ""}
      ><span>${selected ? "0.00%" : numeric ? rowIndex * 100 + columnIndex : `Record ${rowIndex + 1}`}</span></td>`;
    }).join("");
    return `<tr style="--office-sheet-row-height:28px"><th class="office-spreadsheet-grid__row-header" ${rowIndex === 8 ? 'data-selected="true"' : ""}>${rowIndex + 1}</th>${cells}</tr>`;
  }).join("");

  return `
    <section class="office-preview" data-office-kind="spreadsheet">
      <div class="office-preview__body">
        <div class="office-spreadsheet-preview" style="--office-sheet-default-font-family:Arial,sans-serif;--office-sheet-default-font-size:15px">
          <div class="office-spreadsheet-formula-bar">
            <output class="office-spreadsheet-formula-bar__name">B9</output>
            <span class="office-spreadsheet-formula-bar__fx">ƒx</span>
            <output class="office-spreadsheet-formula-bar__value">=IFERROR(B6/B5,0)</output>
          </div>
          <div class="office-spreadsheet-grid-wrap" data-po-scrollbar="content" tabindex="0">
            <table class="office-spreadsheet-grid" data-display-scale="0.85" data-show-grid-lines="true" style="zoom:0.85">
              <colgroup><col class="office-spreadsheet-grid__row-header-col">${columns}</colgroup>
              <thead><tr><th class="office-spreadsheet-grid__corner"></th>${headers}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="office-spreadsheet-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="true">Overview</button>
            <button type="button" role="tab" aria-selected="false">Rows</button>
          </div>
        </div>
      </div>
    </section>`;
}

function presentationMarkup() {
  const thumbnails = Array.from({ length: 5 }, (_, index) => `
    <button class="office-pptx-thumbnail" type="button" aria-selected="${index === 1}">
      <span class="office-pptx-thumbnail__number">${index + 1}</span>
      <span class="office-pptx-thumbnail__frame"></span>
    </button>`).join("");

  return `
    <section class="office-preview" data-office-kind="presentation">
      <div class="office-preview__body">
        <div class="office-presentation-preview">
          <div class="office-pptx-render-preview">
            <div class="office-pptx-workspace">
              <aside class="office-pptx-thumbnail-rail">${thumbnails}</aside>
              <div class="office-pptx-stage" tabindex="0">
                <div class="office-pptx-render-host"><div style="width:70%;aspect-ratio:16/9;background:#fff"></div></div>
                <div class="office-pptx-navigation">
                  <button type="button">‹</button><span>2 / 5</span><button type="button">›</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

async function createWindow(width, markup) {
  const window = new BrowserWindow({
    show: false,
    width,
    height: 480,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  windows.push(window);
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentHtml(markup))}`);
  return window;
}

async function measureSpreadsheet() {
  const window = await createWindow(900, spreadsheetMarkup());
  return window.webContents.executeJavaScript(`
    (async () => {
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await nextFrame();
      const wrap = document.querySelector('.office-spreadsheet-grid-wrap');
      const formulaBar = document.querySelector('.office-spreadsheet-formula-bar');
      const header = document.querySelector('.office-spreadsheet-grid__column-header');
      const rowHeader = document.querySelector('tbody .office-spreadsheet-grid__row-header');
      const textCell = document.querySelector('tbody tr:nth-child(2) td[data-cell-kind="text"]');
      const numberCell = document.querySelector('tbody td[data-cell-kind="number"]');
      const nextRowCell = document.querySelector('tbody tr:nth-child(3) td');
      const tabs = document.querySelector('.office-spreadsheet-tabs');
      const preview = document.querySelector('.office-spreadsheet-preview');
      const selectedCell = document.querySelector('td[data-selected="true"]');
      const selectedHeader = document.querySelector('.office-spreadsheet-grid__column-header[data-selected="true"]');
      const styledCell = document.querySelector('tbody tr:first-child td:first-of-type');
      const firstCell = textCell.getBoundingClientRect();
      const rowHeight = textCell.getBoundingClientRect().height;

      wrap.scrollTop = 196;
      wrap.scrollLeft = 180;
      await nextFrame();
      await nextFrame();

      return {
        canvas: getComputedStyle(preview).backgroundColor,
        formulaBarHeight: formulaBar.getBoundingClientRect().height,
        formulaValue: formulaBar.querySelector('.office-spreadsheet-formula-bar__value').textContent,
        formulaValueFontSize: getComputedStyle(formulaBar.querySelector('.office-spreadsheet-formula-bar__value')).fontSize,
        formulaValueFontWeight: getComputedStyle(formulaBar.querySelector('.office-spreadsheet-formula-bar__value')).fontWeight,
        textAlign: getComputedStyle(textCell).textAlign,
        defaultFontFamily: getComputedStyle(textCell).fontFamily,
        defaultFontSize: getComputedStyle(textCell).fontSize,
        numberAlign: getComputedStyle(numberCell).textAlign,
        firstRowBackground: getComputedStyle(textCell).backgroundColor,
        secondRowBackground: getComputedStyle(nextRowCell).backgroundColor,
        rowHeight,
        headerTop: header.getBoundingClientRect().top - wrap.getBoundingClientRect().top,
        rowHeaderLeft: rowHeader.getBoundingClientRect().left - wrap.getBoundingClientRect().left,
        tabsBottom: preview.getBoundingClientRect().bottom - tabs.getBoundingClientRect().bottom,
        scrolled: wrap.scrollTop > 0 && wrap.scrollLeft > 0,
        firstCellWidth: firstCell.width,
        selectedCellShadow: getComputedStyle(selectedCell).boxShadow,
        selectedHeaderBackground: getComputedStyle(selectedHeader).backgroundColor,
        styledCellBackground: getComputedStyle(styledCell).backgroundColor,
      };
    })();
  `, true);
}

async function measurePresentation(width) {
  const window = await createWindow(width, presentationMarkup());
  return window.webContents.executeJavaScript(`
    (async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const workspace = document.querySelector('.office-pptx-workspace');
      const rail = document.querySelector('.office-pptx-thumbnail-rail');
      const stage = document.querySelector('.office-pptx-stage');
      const host = document.querySelector('.office-pptx-render-host');
      const navigation = document.querySelector('.office-pptx-navigation');
      const selected = document.querySelector('.office-pptx-thumbnail[aria-selected="true"]');
      const selectedNumber = selected.querySelector('.office-pptx-thumbnail__number');
      const selectedFrame = selected.querySelector('.office-pptx-thumbnail__frame');
      const unselected = document.querySelector('.office-pptx-thumbnail[aria-selected="false"]');
      const unselectedFrame = unselected.querySelector('.office-pptx-thumbnail__frame');
      const stageRect = stage.getBoundingClientRect();
      const navigationRect = navigation.getBoundingClientRect();
      return {
        workspaceBackground: getComputedStyle(workspace).backgroundColor,
        railBackground: getComputedStyle(rail).backgroundColor,
        stageBackground: getComputedStyle(stage).backgroundColor,
        railWidth: rail.getBoundingClientRect().width,
        hostOverflow: getComputedStyle(host).overflow,
        navigationInsideStage: navigationRect.bottom < stageRect.bottom && navigationRect.top > stageRect.top,
        selectedBorder: getComputedStyle(selected).borderColor,
        selectedBackground: getComputedStyle(selected).backgroundColor,
        selectedNumberColor: getComputedStyle(selectedNumber).color,
        selectedFrameBorder: getComputedStyle(selectedFrame).borderColor,
        unselectedBackground: getComputedStyle(unselected).backgroundColor,
        unselectedFrameBorder: getComputedStyle(unselectedFrame).borderColor,
      };
    })();
  `, true);
}

async function run() {
  try {
    const spreadsheet = await measureSpreadsheet();
    assert(spreadsheet.canvas === "rgb(255, 255, 255)", `worksheet canvas is not white: ${spreadsheet.canvas}`);
    assertNear(spreadsheet.formulaBarHeight, 42, "worksheet formula bar height");
    assert(spreadsheet.formulaValue === "=IFERROR(B6/B5,0)", "worksheet formula bar lost the source formula");
    assert(
      spreadsheet.formulaValueFontSize === "12px",
      `worksheet formula text does not use the product meta size: ${spreadsheet.formulaValueFontSize}`,
    );
    assert(
      spreadsheet.formulaValueFontWeight === "400",
      `worksheet formula text is heavier than product reading text: ${spreadsheet.formulaValueFontWeight}`,
    );
    assert(spreadsheet.textAlign === "left", `text cells are not left aligned: ${spreadsheet.textAlign}`);
    assert(spreadsheet.numberAlign === "right", `number cells are not right aligned: ${spreadsheet.numberAlign}`);
    assert(spreadsheet.firstRowBackground === spreadsheet.secondRowBackground, "worksheet still uses zebra striping");
    assert(spreadsheet.defaultFontFamily.startsWith("Arial"), "worksheet did not inherit the workbook font family");
    assert(spreadsheet.defaultFontSize === "15px", "worksheet did not inherit the workbook font size");
    assertNear(spreadsheet.rowHeight, 23.8, "worksheet saved zoom did not scale the complete row");
    assertNear(spreadsheet.headerTop, 0, "sticky column header position");
    assertNear(spreadsheet.rowHeaderLeft, 0, "sticky row header position");
    assertNear(spreadsheet.tabsBottom, 0, "sheet tabs are not anchored to the bottom");
    assert(spreadsheet.scrolled, "worksheet smoke fixture did not become scrollable");
    assert(spreadsheet.firstCellWidth >= 150, "worksheet column widths were not preserved at saved zoom");
    assert(spreadsheet.selectedCellShadow !== "none", "selected worksheet cell has no selection outline");
    assert(spreadsheet.selectedHeaderBackground === "rgb(220, 234, 251)", "selected worksheet header is not highlighted");
    assert(spreadsheet.styledCellBackground === "rgb(11, 37, 69)", "source cell fill was not preserved");

    const widePresentation = await measurePresentation(900);
    assert(
      widePresentation.workspaceBackground === widePresentation.stageBackground
      && widePresentation.stageBackground === widePresentation.railBackground,
      "PowerPoint workspace, stage, and thumbnail rail do not share one canvas",
    );
    assertNear(widePresentation.railWidth, 162, "wide PowerPoint thumbnail rail width");
    assert(widePresentation.hostOverflow === "hidden", "PowerPoint stage host exposes an extra scrollbar");
    assert(widePresentation.navigationInsideStage, "PowerPoint navigation is outside the slide stage");
    assert(
      widePresentation.selectedBorder === "rgba(0, 0, 0, 0)",
      `PowerPoint selected row still has a colored outer border: ${widePresentation.selectedBorder}`,
    );
    assert(
      widePresentation.selectedBackground !== widePresentation.unselectedBackground,
      "PowerPoint selected row has no visible selection surface",
    );
    assert(
      widePresentation.selectedNumberColor === "rgb(240, 122, 67)",
      `PowerPoint selected slide number does not use its file accent: ${widePresentation.selectedNumberColor}`,
    );
    assert(
      widePresentation.selectedFrameBorder !== widePresentation.unselectedFrameBorder,
      "PowerPoint selected slide frame has no quiet focus boundary",
    );

    const compactPresentation = await measurePresentation(640);
    assertNear(compactPresentation.railWidth, 112, "compact PowerPoint thumbnail rail width");

    console.log(JSON.stringify({ ok: true, spreadsheet, widePresentation, compactPresentation }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    const exitCode = process.exitCode ?? 0;
    for (const window of windows) window.destroy();
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    app.exit(exitCode);
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});

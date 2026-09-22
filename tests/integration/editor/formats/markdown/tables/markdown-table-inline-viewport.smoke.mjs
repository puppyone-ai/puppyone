#!/usr/bin/env electron

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-markdown-table-inline-"));
const windows = [];

app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-gpu");
// Cleanup must preserve a failing exit status after the last window closes.
app.on("window-all-closed", () => {});

const [scrollbarsCss, markdownEditorCss, markdownContentCss, editableTableCss, markdownTableCss] = await Promise.all([
  fsp.readFile(
    path.join(repoRoot, "src/styles/scrollbars.css"),
    "utf8",
  ),
  fsp.readFile(
    path.join(repoRoot, "packages/shared-ui/src/styles/editor/markdown-editor.css"),
    "utf8",
  ),
  fsp.readFile(
    path.join(repoRoot, "packages/shared-ui/src/styles/editor/markdown-content.css"),
    "utf8",
  ),
  fsp.readFile(
    path.join(repoRoot, "packages/shared-ui/src/styles/editor/editable-table.css"),
    "utf8",
  ),
  fsp.readFile(
    path.join(repoRoot, "packages/shared-ui/src/styles/editor/markdown-table-widget.css"),
    "utf8",
  ),
]);

function assertNear(actual, expected, label, tolerance = 1.5) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} ± ${tolerance}, received ${actual}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tableMarkup(direction) {
  const columns = Array.from({ length: 12 }, () => '<col style="width:180px">').join("");
  const cells = Array.from(
    { length: 12 },
    (_, index) => `<th><span class="cm-md-table-cell-content">Column ${index + 1}</span></th>`,
  ).join("");
  return `
    <div class="cm-md-table-widget-wrap po-editable-table-interaction-root" dir="${direction}" data-md-table-inline-viewport="true">
      <div class="cm-md-table-scrollport" dir="${direction}" data-po-scrollbar="hidden" data-md-table-scrollport="true">
        <div class="cm-md-table-frame" data-md-table-scroll-track="true">
          <div class="cm-md-table-surface" data-md-table-surface="true">
            <table class="cm-md-table-widget is-windowed" dir="${direction}" style="width:2160px">
              <colgroup>${columns}</colgroup>
              <thead><tr>${cells}</tr></thead>
            </table>
            <button class="cm-md-table-structure-button cm-md-table-add-column po-editable-table-structure-button po-editable-table-add-column" type="button">
              <span class="cm-md-table-structure-button-visual po-editable-table-structure-button-visual"></span>
            </button>
            <div class="cm-md-table-drag-layer po-editable-table-drag-layer">
              <button class="cm-md-table-drag-handle cm-md-table-column-handle po-editable-table-drag-handle po-editable-table-column-handle is-visible" style="left:90px;top:0" type="button">
                <span class="cm-md-table-drag-handle-visual po-editable-table-drag-handle-visual"></span>
              </button>
              <button class="cm-md-table-drag-handle cm-md-table-row-handle po-editable-table-drag-handle po-editable-table-row-handle is-visible" style="${direction === "rtl" ? "right:0" : "left:0"};top:48px" type="button">
                <span class="cm-md-table-drag-handle-visual po-editable-table-drag-handle-visual"></span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="cm-md-table-scrollbar-rail" dir="${direction}" data-po-scrollbar="horizontal" data-md-table-scrollbar-rail="true" aria-hidden="true">
        <div class="cm-md-table-scrollbar-content" data-md-table-scrollbar-content="true"></div>
      </div>
    </div>`;
}

function fixtureHtml(direction, reserveVerticalScrollbar) {
  return `<!doctype html>
    <html dir="${direction}">
      <head>
        <meta charset="utf-8">
        <style>
          :root {
            --po-accent: #4c70ff;
            --po-border: #d8dbe2;
            --po-control: #eef0f4;
            --po-divider: #d6d9df;
            --po-editor-bg: #fff;
            --po-editor-content-edge-inset: 64px;
            --po-font-sans: system-ui, sans-serif;
            --po-panel: #fff;
            --po-scrollbar-thumb: #aeb4bf;
            --po-text: #20232a;
            --po-text-muted: #626873;
          }
          html, body, #root {
            width: 100%;
            height: 100%;
            margin: 0;
          }
          body { overflow: hidden; }
          .markdown-codemirror-editor { width: 100%; height: 100%; }
          .cm-editor, .cm-scroller { width: 100%; height: 100%; }
          .cm-scroller {
            overflow-y: ${reserveVerticalScrollbar ? "scroll" : "auto"};
            overflow-x: auto;
            scrollbar-gutter: ${reserveVerticalScrollbar ? "stable" : "auto"};
          }
          ${reserveVerticalScrollbar ? ".cm-scroller::-webkit-scrollbar { width: 12px; }" : ""}
          .cm-line { display: block; }
          ${markdownEditorCss}
          ${markdownContentCss}
          ${editableTableCss}
          ${markdownTableCss}
        </style>
      </head>
      <body>
        <div id="root" class="markdown-codemirror-editor" data-live-preview="true">
          <div class="cm-editor">
            <div class="cm-scroller">
              <div class="cm-content">
                <div class="cm-line cm-md-heading cm-md-heading-1">Heading</div>
                <div class="cm-line"><span class="cm-md-hr-widget"></span></div>
                <div class="cm-line">${tableMarkup(direction)}</div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>`;
}

async function measureScenario(viewportWidth, direction, reserveVerticalScrollbar = false) {
  const browserWindow = new BrowserWindow({
    show: false,
    width: viewportWidth,
    height: 360,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  windows.push(browserWindow);
  await browserWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml(direction, reserveVerticalScrollbar))}`,
  );

  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await nextFrame();
      await nextFrame();
      const direction = ${JSON.stringify(direction)};
      const root = document.querySelector(".markdown-codemirror-editor");
      const outer = document.querySelector(".cm-scroller");
      const content = document.querySelector(".cm-content");
      const wrapper = document.querySelector(".cm-md-table-widget-wrap");
      const viewport = document.querySelector(".cm-md-table-scrollport");
      const scrollbar = document.querySelector(".cm-md-table-scrollbar-rail");
      const scrollbarContent = document.querySelector(".cm-md-table-scrollbar-content");
      const frame = document.querySelector(".cm-md-table-frame");
      const table = document.querySelector(".cm-md-table-widget");
      const heading = document.querySelector(".cm-md-heading-1");
      const divider = document.querySelector(".cm-md-hr-widget");
      const thirdColumn = table.rows[0].cells[2];
      const firstColumn = table.rows[0].cells[0];
      const addColumn = document.querySelector(".cm-md-table-add-column");
      const columnHandle = document.querySelector(".cm-md-table-column-handle");
      const rowHandle = document.querySelector(".cm-md-table-row-handle");
      await nextFrame();
      const viewportMaximum = viewport.scrollWidth - viewport.clientWidth;
      scrollbarContent.style.inlineSize = scrollbar.clientWidth + viewportMaximum + "px";
      await nextFrame();
      const rootRect = root.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const scrollbarRect = scrollbar.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const columnHandleRect = columnHandle.getBoundingClientRect();
      const rowHandleRect = rowHandle.getBoundingClientRect();
      const leadingInset = direction === "rtl"
        ? viewportRect.right - tableRect.right
        : tableRect.left - viewportRect.left;
      const initial = {
        rootLeft: rootRect.left,
        rootRight: rootRect.right,
        contentLeft: contentRect.left,
        contentRight: contentRect.right,
        wrapperLeft: wrapperRect.left,
        wrapperRight: wrapperRect.right,
        viewportLeft: viewportRect.left,
        viewportRight: viewportRect.right,
        viewportTop: viewportRect.top,
        scrollbarLeft: scrollbarRect.left,
        scrollbarRight: scrollbarRect.right,
        scrollbarScrollWidth: scrollbar.scrollWidth,
        scrollbarClientWidth: scrollbar.clientWidth,
        tableLeft: tableRect.left,
        tableRight: tableRect.right,
        tableWidth: tableRect.width,
        tableTop: tableRect.top,
        columnHandleTop: columnHandleRect.top,
        columnHandleBottom: columnHandleRect.bottom,
        rowHandleLeft: rowHandleRect.left,
        rowHandleRight: rowHandleRect.right,
        leadingInset,
        framePaddingInlineStart: Number.parseFloat(
          direction === "rtl" ? getComputedStyle(frame).paddingRight : getComputedStyle(frame).paddingLeft,
        ),
        framePaddingInlineEnd: Number.parseFloat(
          direction === "rtl" ? getComputedStyle(frame).paddingLeft : getComputedStyle(frame).paddingRight,
        ),
        outerScrollLeft: outer.scrollLeft,
        outerScrollWidth: outer.scrollWidth,
        outerClientWidth: outer.clientWidth,
        outerClientLeft: outer.getBoundingClientRect().left + outer.clientLeft,
        bodyScrollWidth: document.body.scrollWidth,
        viewportScrollWidth: viewport.scrollWidth,
        viewportClientWidth: viewport.clientWidth,
        headingRuleWidth: getComputedStyle(heading).borderBottomWidth,
        headingPaddingBottom: getComputedStyle(heading).paddingBottom,
        dividerColor: getComputedStyle(divider, "::before").backgroundColor,
        dividerWidth: getComputedStyle(divider, "::before").height,
        tableBorderColor: getComputedStyle(table).borderTopColor,
        tableBorderWidth: getComputedStyle(table).borderTopWidth,
        cellBorderColor: getComputedStyle(firstColumn).borderRightColor,
        cellBorderWidth: getComputedStyle(firstColumn).borderRightWidth,
      };

      const targetLogicalOffset = leadingInset + 360;
      viewport.scrollLeft = direction === "rtl" ? -targetLogicalOffset : targetLogicalOffset;
      await nextFrame();
      await nextFrame();
      const scrolledViewportRect = viewport.getBoundingClientRect();
      const scrolledTableRect = table.getBoundingClientRect();
      const thirdRect = thirdColumn.getBoundingClientRect();
      const scrolled = {
        rawScrollLeft: viewport.scrollLeft,
        tableLeft: scrolledTableRect.left,
        tableRight: scrolledTableRect.right,
        thirdLeft: thirdRect.left,
        thirdRight: thirdRect.right,
        viewportLeft: scrolledViewportRect.left,
        viewportRight: scrolledViewportRect.right,
        outerScrollLeft: outer.scrollLeft,
      };

      const maximum = viewport.scrollWidth - viewport.clientWidth;
      viewport.scrollLeft = direction === "rtl" ? -maximum : maximum;
      await nextFrame();
      await nextFrame();
      const endViewportRect = viewport.getBoundingClientRect();
      const endScrollbarRect = scrollbar.getBoundingClientRect();
      const endTableRect = table.getBoundingClientRect();
      const addRect = addColumn.getBoundingClientRect();
      const end = {
        addLeft: addRect.left,
        addRight: addRect.right,
        scrollbarLeft: endScrollbarRect.left,
        scrollbarRight: endScrollbarRect.right,
        tableLeft: endTableRect.left,
        tableRight: endTableRect.right,
        viewportLeft: endViewportRect.left,
        viewportRight: endViewportRect.right,
        outerScrollLeft: outer.scrollLeft,
      };
      return {
        direction,
        reserveVerticalScrollbar: ${JSON.stringify(reserveVerticalScrollbar)},
        viewportWidth: window.innerWidth,
        initial,
        scrolled,
        end,
      };
    })()
  `, true);
}

function focusStabilityFixtureHtml() {
  const longSource = "**The Game Awards focus source is deliberately wider than its rendered preview**";
  return `<!doctype html>
    <html data-po-scrollbar-mode="product" data-interface-style="default">
      <head>
        <meta charset="utf-8">
        <style>
          :root {
            --po-accent: #4c70ff;
            --po-border: #d8dbe2;
            --po-control: #eef0f4;
            --po-divider: #d6d9df;
            --po-editor-bg: #fff;
            --po-editor-content-edge-inset: 64px;
            --po-font-sans: system-ui, sans-serif;
            --po-panel: #fff;
            --po-scrollbar-size: 12px;
            --po-scrollbar-thumb: #aeb4bf;
            --po-text: #20232a;
            --po-text-muted: #626873;
          }
          html, body, #root { width: 100%; height: 100%; margin: 0; }
          body { overflow: hidden; }
          #root {
            display: grid;
            grid-template-rows: minmax(0, 1fr) 1px minmax(0, 1fr);
          }
          .pane { min-width: 0; min-height: 0; overflow: hidden; }
          .divider { background: var(--po-divider); }
          .markdown-codemirror-editor,
          .cm-editor,
          .cm-scroller { width: 100%; height: 100%; }
          .cm-line { display: block; }
          #focus-expander { height: 0; }
          #bottom-focus { width: 1px; height: 1px; opacity: 0; }
          ${scrollbarsCss}
          ${markdownEditorCss}
          ${markdownContentCss}
          ${editableTableCss}
          ${markdownTableCss}
        </style>
      </head>
      <body>
        <div id="root">
          <section class="pane" id="top-pane">
            <div class="markdown-codemirror-editor" data-live-preview="true">
              <div class="cm-editor">
                <div class="cm-scroller" data-po-scrollbar="content">
                  <div class="cm-content">
                    <div class="cm-line">
                      <div class="cm-md-table-widget-wrap po-editable-table-interaction-root">
                        <div class="cm-md-table-scrollport">
                          <div class="cm-md-table-frame">
                            <div class="cm-md-table-surface">
                              <table class="cm-md-table-widget" id="focus-table">
                                <colgroup><col style="width:150px"><col style="width:150px"></colgroup>
                                <tbody><tr>
                                  <td><span class="cm-md-table-cell-content" id="focus-cell" contenteditable="true"><strong>The Game Awards</strong></span></td>
                                  <td><span class="cm-md-table-cell-content">Value</span></td>
                                </tr></tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div id="focus-expander"></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <div class="divider"></div>
          <section class="pane" id="bottom-pane" tabindex="-1"><button id="bottom-focus">bottom</button></section>
        </div>
        <script>window.__longTableCellSource = ${JSON.stringify(longSource)};</script>
      </body>
    </html>`;
}

async function measureFocusStability() {
  const browserWindow = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  windows.push(browserWindow);
  await browserWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(focusStabilityFixtureHtml())}`,
  );

  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const scroller = document.querySelector(".cm-scroller");
      const content = document.querySelector(".cm-content");
      const table = document.querySelector("#focus-table");
      const cell = document.querySelector("#focus-cell");
      const expander = document.querySelector("#focus-expander");
      const bottom = document.querySelector("#bottom-focus");
      const snapshot = (label) => {
        const contentRect = content.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const style = getComputedStyle(content);
        const paddingLeft = Number.parseFloat(style.paddingLeft);
        const paddingRight = Number.parseFloat(style.paddingRight);
        return {
          label,
          scrollerClientWidth: scroller.clientWidth,
          scrollerOffsetWidth: scroller.offsetWidth,
          scrollerClientHeight: scroller.clientHeight,
          scrollerScrollHeight: scroller.scrollHeight,
          scrollerScrollLeft: scroller.scrollLeft,
          contentLeft: contentRect.left,
          contentRight: contentRect.right,
          readingRailCenter: (
            contentRect.left + paddingLeft
            + contentRect.right - paddingRight
          ) / 2,
          tableLeft: tableRect.left,
          tableWidth: tableRect.width,
          cellLeft: cellRect.left,
          cellWidth: cellRect.width,
        };
      };

      await nextFrame();
      await nextFrame();
      const before = snapshot("before");
      cell.focus({ preventScroll: true });
      cell.textContent = window.__longTableCellSource;
      expander.style.height = "300px";
      await nextFrame();
      await nextFrame();
      const focused = snapshot("focused");
      bottom.focus({ preventScroll: true });
      cell.replaceChildren(Object.assign(document.createElement("strong"), { textContent: "The Game Awards" }));
      expander.style.height = "0";
      await nextFrame();
      await nextFrame();
      const blurred = snapshot("blurred");
      return { before, focused, blurred };
    })()
  `, true);
}

async function runSmoke() {
  const results = [];
  const scenarioSpecs = [
    ...[600, 1000, 1600, 2100].map((viewportWidth) => ({
      reserveVerticalScrollbar: false,
      viewportWidth,
    })),
    ...[600, 1000].map((viewportWidth) => ({
      reserveVerticalScrollbar: true,
      viewportWidth,
    })),
  ];
  for (const direction of ["ltr", "rtl"]) {
    for (const { viewportWidth, reserveVerticalScrollbar } of scenarioSpecs) {
      const result = await measureScenario(
        viewportWidth,
        direction,
        reserveVerticalScrollbar,
      );
      const { initial, scrolled, end } = result;
      const actualViewportWidth = result.viewportWidth;
      const label = `${direction}-${actualViewportWidth}${reserveVerticalScrollbar ? "-vertical-scrollbar" : ""}`;
      const expectedGutter = Math.max(64, (initial.outerClientWidth - 724) / 2);
      const expectedInteractionGutter = 18;
      const expectedWideBlockEdgeInset = 0;
      const expectedViewportInset = Math.min(
        Math.max(0, expectedWideBlockEdgeInset),
        expectedGutter - expectedInteractionGutter,
      );
      const expectedInteractionStartInset = expectedGutter - expectedViewportInset;
      const expectedSafeStart = initial.outerClientLeft + expectedViewportInset;
      const expectedBreakoutEnd = initial.outerClientLeft + initial.outerClientWidth - expectedViewportInset;
      const expectedReadingRailEndInset = expectedInteractionStartInset;

      assert(initial.viewportScrollWidth > initial.viewportClientWidth, `${label}: fixture is not wide`);
      assert(
        initial.tableBorderColor === "rgb(214, 217, 223)"
          && initial.tableBorderColor === initial.cellBorderColor,
        `${label}: table lines must use the shared neutral divider color`,
      );
      assert(
        initial.dividerWidth === "1px"
          && initial.tableBorderWidth === "1px"
          && initial.cellBorderWidth === "1px",
        `${label}: Markdown rule widths diverged`,
      );
      assert(
        initial.headingRuleWidth === "0px" && initial.headingPaddingBottom === "0px",
        `${label}: Markdown heading retained divider spacing`,
      );
      assertNear(
        initial.framePaddingInlineStart,
        initial.leadingInset,
        `${label}: track leading padding`,
      );
      assertNear(
        initial.framePaddingInlineEnd,
        initial.framePaddingInlineStart,
        `${label}: symmetric interaction padding`,
      );
      assertNear(
        initial.viewportLeft - initial.contentLeft,
        initial.contentRight - initial.viewportRight,
        `${label}: symmetric physical clip edges`,
      );
      assertNear(
        initial.viewportScrollWidth - initial.viewportClientWidth,
        Math.max(0, initial.tableWidth - initial.scrollbarClientWidth),
        `${label}: interaction chrome is excluded from semantic range`,
      );
      if (!reserveVerticalScrollbar) {
        assertNear(
          initial.leadingInset,
          expectedInteractionStartInset,
          `${label}: interaction start inset`,
        );
        assertNear(
          initial.framePaddingInlineEnd,
          expectedReadingRailEndInset,
          `${label}: track reading-rail end padding`,
        );
        assertNear(initial.scrollbarLeft, initial.outerClientLeft + expectedGutter, `${label}: scrollbar reading-rail start`);
        assertNear(
          initial.scrollbarRight,
          initial.outerClientLeft + initial.outerClientWidth - expectedGutter,
          `${label}: scrollbar reading-rail end`,
        );
      }
      assertNear(
        initial.scrollbarScrollWidth - initial.scrollbarClientWidth,
        initial.viewportScrollWidth - initial.viewportClientWidth,
        `${label}: scrollbar logical range`,
      );
      assertNear(
        initial.columnHandleTop,
        initial.tableTop - 12,
        `${label}: column hit target is centered on the top border`,
      );
      assert(
        initial.columnHandleBottom > initial.tableTop,
        `${label}: column handle no longer straddles the table border`,
      );
      if (direction === "ltr") {
        if (!reserveVerticalScrollbar) {
          assertNear(initial.viewportLeft, expectedSafeStart, `${label}: editor edge`);
          assertNear(initial.viewportRight, expectedBreakoutEnd, `${label}: editor edge end`);
        }
        assertNear(initial.tableLeft, initial.scrollbarLeft, `${label}: resting reading rail`);
        assertNear(initial.rowHandleLeft, initial.tableLeft - 12, `${label}: row handle table edge`);
        assert(initial.rowHandleLeft >= initial.viewportLeft - 1.5, `${label}: row handle is clipped at editor edge`);
        assert(initial.rowHandleRight > initial.tableLeft, `${label}: row handle no longer straddles table`);
        assertNear(scrolled.thirdLeft, scrolled.viewportLeft, `${label}: later column reaches editor edge`);
        assert(scrolled.tableLeft < scrolled.viewportLeft, `${label}: leading table content did not leave`);
        assertNear(end.tableRight, end.scrollbarRight, `${label}: table and scrollbar reading-rail end`);
        assertNear(end.addLeft, end.tableRight, `${label}: add-column rail follows table edge`);
        assert(end.addRight <= end.viewportRight + 1.5, `${label}: add-column rail is clipped at end`);
        assert(end.addLeft >= end.viewportLeft - 1.5, `${label}: add-column rail is unreachable`);
      } else {
        if (!reserveVerticalScrollbar) {
          assertNear(initial.viewportRight, expectedBreakoutEnd, `${label}: editor edge`);
          assertNear(initial.viewportLeft, expectedSafeStart, `${label}: editor edge end`);
        }
        assertNear(initial.tableRight, initial.scrollbarRight, `${label}: resting reading rail`);
        assertNear(initial.rowHandleRight, initial.tableRight + 12, `${label}: row handle table edge`);
        assert(initial.rowHandleRight <= initial.viewportRight + 1.5, `${label}: row handle is clipped at editor edge`);
        assert(initial.rowHandleLeft < initial.tableRight, `${label}: row handle no longer straddles table`);
        assertNear(scrolled.thirdRight, scrolled.viewportRight, `${label}: later column reaches editor edge`);
        assert(scrolled.tableRight > scrolled.viewportRight, `${label}: leading table content did not leave`);
        assertNear(end.tableLeft, end.scrollbarLeft, `${label}: table and scrollbar reading-rail end`);
        assertNear(end.addRight, end.tableLeft, `${label}: add-column rail follows table edge`);
        assert(end.addLeft >= end.viewportLeft - 1.5, `${label}: add-column rail is clipped at end`);
        assert(end.addRight <= end.viewportRight + 1.5, `${label}: add-column rail is unreachable`);
      }
      assertNear(initial.outerScrollLeft, 0, `${label}: outer horizontal position at rest`);
      assertNear(scrolled.outerScrollLeft, 0, `${label}: outer horizontal position while scrolling`);
      assertNear(end.outerScrollLeft, 0, `${label}: outer horizontal position at end`);
      assert(
        initial.outerScrollWidth <= initial.outerClientWidth,
        `${label}: table created editor-level horizontal overflow`,
      );
      assert(
        initial.bodyScrollWidth <= actualViewportWidth,
        `${label}: table created page-level horizontal overflow`,
      );
      results.push(result);
    }
  }
  const focusStability = await measureFocusStability();
  const { before, focused, blurred } = focusStability;
  assert(
    before.scrollerScrollHeight <= before.scrollerClientHeight,
    "focus-stability: initial pane unexpectedly overflows",
  );
  assert(
    focused.scrollerScrollHeight > focused.scrollerClientHeight,
    "focus-stability: focused pane did not cross the overflow threshold",
  );
  for (const sample of [focused, blurred]) {
    assertNear(sample.scrollerClientWidth, before.scrollerClientWidth, `${sample.label}: scroller width`);
    assertNear(sample.contentLeft, before.contentLeft, `${sample.label}: content left`);
    assertNear(sample.contentRight, before.contentRight, `${sample.label}: content right`);
    assertNear(sample.readingRailCenter, before.readingRailCenter, `${sample.label}: reading rail center`);
    assertNear(sample.tableLeft, before.tableLeft, `${sample.label}: table left`);
    assertNear(sample.tableWidth, before.tableWidth, `${sample.label}: table width`);
    assertNear(sample.cellLeft, before.cellLeft, `${sample.label}: cell left`);
    assertNear(sample.cellWidth, before.cellWidth, `${sample.label}: cell width`);
    assertNear(sample.scrollerScrollLeft, 0, `${sample.label}: outer horizontal position`);
  }
  console.log(JSON.stringify({ ok: true, scenarios: results, focusStability }, null, 2));
}

async function finish(exitCode) {
  for (const browserWindow of windows) {
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
  }
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    await runSmoke();
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    await finish(exitCode);
  }
}).catch(async (error) => {
  console.error(error);
  await finish(1);
});

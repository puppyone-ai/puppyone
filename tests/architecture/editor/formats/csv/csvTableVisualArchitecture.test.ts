import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const csvEditorSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor.tsx", import.meta.url),
  "utf8",
);
const csvControlsSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableControls.tsx", import.meta.url),
  "utf8",
);
const csvMenuSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableMenu.tsx", import.meta.url),
  "utf8",
);
const csvViewSettingsSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvViewSettings.tsx", import.meta.url),
  "utf8",
);
const csvResizeSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableResizeControl.tsx", import.meta.url),
  "utf8",
);
const csvColumnResizeSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvColumnResizeLayer.tsx", import.meta.url),
  "utf8",
);
const csvColumnLayoutSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvColumnLayoutModel.ts", import.meta.url),
  "utf8",
);
const csvDocumentModelSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvDocumentModel.ts", import.meta.url),
  "utf8",
);
const csvViewerSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvViewer.tsx", import.meta.url),
  "utf8",
);
const csvCellEditorSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/csv/CsvCellEditor.tsx", import.meta.url),
  "utf8",
);
const textEditorFrameSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/shared/TextEditorFrame.tsx", import.meta.url),
  "utf8",
);
const editorEntryCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor.css", import.meta.url),
  "utf8",
);
const editorChromeCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/editor-chrome.css", import.meta.url),
  "utf8",
);
const sharedTableCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/editable-table.css", import.meta.url),
  "utf8",
);
const csvTableCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/csv-table-editor.css", import.meta.url),
  "utf8",
);
const markdownTableCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/markdown-table-widget.css", import.meta.url),
  "utf8",
);

describe("CSV table visual architecture", () => {
  it("projects links through the format-neutral navigation port", () => {
    expect(csvEditorSource).toContain("documentNavigation?.resolveReference");
    expect(csvViewerSource).toContain("documentNavigation={context.documentNavigation}");
    expect(csvCellEditorSource).toContain("navigation.openReference(reference)");
    expect(csvCellEditorSource).toContain('className="csv-table-editor__external-reference"');
    expect(csvCellEditorSource).toContain('data-po-content-interaction="navigation"');
    expect(csvCellEditorSource).toContain("event.metaKey || event.ctrlKey");
    expect(csvCellEditorSource).not.toContain("window.open");
    expect(csvCellEditorSource).not.toContain("puppyoneDesktop");
    expect(csvCellEditorSource).not.toContain("<a");
    expect(csvCellEditorSource).not.toContain("ExternalLink");
    expect(csvTableCss).toContain("--po-csv-link-color");
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__external-reference\s*\{[\s\S]*?cursor:\s*pointer;/,
    );
    expect(csvTableCss).toContain(".csv-table-editor__reference-preview");
  });

  it("keeps CSV semantic while sharing the Markdown table language", () => {
    expect(csvEditorSource).toContain("<table");
    expect(csvEditorSource).toContain("<thead>");
    expect(csvEditorSource).toContain("<tbody>");
    expect(csvEditorSource).toContain('scope="col"');
    expect(csvEditorSource).toContain('scope="row"');
    expect(csvEditorSource).toContain("data-csv-row");
    expect(csvEditorSource).toContain("data-csv-record-index");
    expect(csvEditorSource).not.toContain("gridTemplateColumns");

    expect(editorEntryCss.indexOf('editor/editable-table.css')).toBeLessThan(
      editorEntryCss.indexOf('editor/csv-table-editor.css'),
    );
    expect(editorEntryCss.indexOf('editor/editable-table.css')).toBeLessThan(
      editorEntryCss.indexOf('editor/markdown-table-widget.css'),
    );

    for (const token of [
      "--po-editable-table-border",
      "--po-editable-table-cell-border",
      "--po-editable-table-cell-padding",
      "--po-editable-table-cell-focus-shadow",
      "--po-editable-table-row-min-height",
      "--po-editable-table-header-font-weight",
    ]) {
      expect(sharedTableCss).toContain(token);
      expect(csvTableCss).toContain(token);
      expect(markdownTableCss).toContain(token);
    }
    expect(sharedTableCss).toContain("--po-editable-table-structure-hover-background");
    const structureTokenBlock = sharedTableCss.slice(
      sharedTableCss.indexOf("--po-editable-table-structure-background"),
      sharedTableCss.indexOf("}", sharedTableCss.indexOf("--po-editable-table-structure-background")),
    );
    expect(structureTokenBlock).toContain("--po-editable-table-structure-hover-border: transparent");
    expect(structureTokenBlock).toContain("var(--po-accent) 10%");
    const structureButtonStart = sharedTableCss.indexOf(".po-editable-table-structure-button {");
    const structureButtonRule = sharedTableCss.slice(
      structureButtonStart,
      sharedTableCss.indexOf("}", structureButtonStart),
    );
    expect(structureButtonRule).toContain("opacity: 0");
    expect(sharedTableCss).toMatch(
      /\.po-editable-table-structure-button-visual::before\s*\{[^}]*width:\s*7px[^}]*height:\s*1px/s,
    );
    expect(sharedTableCss).toMatch(
      /\.po-editable-table-structure-button-visual::after\s*\{[^}]*width:\s*1px[^}]*height:\s*7px/s,
    );
    expect(csvEditorSource).not.toContain('aria-hidden="true">+</span>');
    expect(csvTableCss).not.toContain(
      ".csv-table-editor__surface:hover .csv-table-editor__table",
    );
    expect(csvTableCss).not.toContain(
      ".csv-table-editor__surface:focus-within .csv-table-editor__table",
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__resize-handle\s*\{[^}]*opacity:\s*0/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__surface:hover \.csv-table-editor__resize-handle,[\s\S]*?\{[^}]*opacity:\s*1/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__resize-handle-visual\s*\{[^}]*color:\s*transparent/s,
    );
  });

  it("assigns the two-axis CSV viewport to exactly one scroll owner", () => {
    expect(csvViewerSource).toContain('liveScrollOwner="viewer"');
    expect(textEditorFrameSource).toContain('liveScrollOwner = "frame"');
    expect(textEditorFrameSource.match(/data-scroll-owner=\{liveScrollOwner\}/g)).toHaveLength(2);
    expect(editorChromeCss).toMatch(
      /\.editor-live-surface\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s,
    );
    expect(editorChromeCss).toMatch(
      /\.editor-live-surface\[data-scroll-owner="viewer"\]\s*\{[^}]*overflow:\s*clip/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__scroll\s*\{[^}]*position:\s*relative[^}]*overflow:\s*auto/s,
    );
  });

  it("keeps resting insets in content while sticky panes target the real viewport edges", () => {
    expect(csvTableCss).not.toContain(".csv-table-editor__toolbar");
    expect(csvTableCss).toMatch(/\.csv-table-editor\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(csvTableCss).toContain(".csv-table-editor__record-index");
    expect(csvTableCss).toContain("position: sticky");
    expect(csvTableCss).toContain("--csv-table-record-index-width: var(--po-editable-table-row-min-height)");
    expect(csvTableCss).toContain("--csv-table-content-inline-start-inset: 32px");
    expect(csvTableCss).toContain("--csv-table-content-inline-end-inset: 32px");
    expect(csvTableCss).toContain("--csv-table-content-block-start-inset: 32px");
    expect(csvTableCss).toContain("--csv-table-content-block-end-inset: 32px");
    expect(csvEditorSource).toContain('toggleAttribute("data-inline-scrolled", inlineScrolled)');
    const scrollRule = csvTableCss.match(/\.csv-table-editor__scroll\s*\{([^}]*)\}/s)?.[1];
    expect(scrollRule).toBeDefined();
    expect(scrollRule).not.toMatch(/\bpadding(?:-|:)/);
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__frame\s*\{[^}]*padding-block:\s*var\(--csv-table-content-block-start-inset\)[^}]*var\(--csv-table-content-block-end-inset\)[^}]*var\(--po-editable-table-action-gutter\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__frame\s*\{[^}]*padding-inline:\s*var\(--csv-table-content-inline-start-inset\)[^}]*var\(--csv-table-content-inline-end-inset\)[^}]*var\(--po-editable-table-action-gutter\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__table thead th\s*\{[^}]*z-index:\s*3[^}]*inset-block-start:\s*0[^}]*var\(--po-editable-table-sticky-header-background\)[^}]*var\(--po-editor-bg\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__table \.csv-table-editor__record-index\s*\{[^}]*z-index:\s*2[^}]*inset-inline-start:\s*0[^}]*var\(--csv-table-record-index-background\)[^}]*var\(--po-editor-bg\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__table \.csv-table-editor__record-index\s*\{[^}]*font-size:\s*var\(--po-text-size-caption, 11px\)[^}]*font-variant-numeric:\s*tabular-nums[^}]*font-weight:\s*var\(--po-text-weight-regular, 400\)/s,
    );
    expect(csvTableCss).not.toMatch(/inset-(?:block|inline)-start:\s*calc\(-1/);
    expect(csvEditorSource).toMatch(
      /className="csv-table-editor__scroll"[\s\S]*?<CsvViewSettings[\s\S]*?className="csv-table-editor__frame"/,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__scroll\[data-inline-scrolled\]\s*\.csv-table-editor__record-index\s*\{[^}]*border-inline-start:\s*1px solid var\(--po-editable-table-border\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__table thead \.csv-table-editor__record-index\s*\{[^}]*z-index:\s*4/s,
    );
    expect(csvTableCss).toMatch(/\.csv-table-editor__record-index-label\s*\{[^}]*min-height:\s*calc\(var\(--po-editable-table-row-min-height\) - 1px\)[^}]*justify-content:\s*center[^}]*padding:\s*0/s);
    expect(csvTableCss).toMatch(/\.csv-table-editor__table th,[\s\S]*?\.csv-table-editor__table td\s*\{[^}]*box-sizing:\s*border-box[^}]*height:\s*var\(--po-editable-table-row-min-height\)/s);
    expect(csvTableCss).toContain("font-size: var(--po-editable-table-font-size, var(--po-type-editor-data, 13px))");
    expect(csvTableCss).toContain(".csv-table-editor__table td:focus-within");
    expect(csvViewSettingsSource).toContain("csv-table-editor__settings-button");
    expect(csvViewSettingsSource).toContain("csv-table-editor__settings-popover");
    expect(csvViewSettingsSource).toContain("csv-table-editor__header-toggle-input");
    expect(csvViewSettingsSource).toContain("csv-table-editor__row-numbers-toggle-input");
    expect(csvViewSettingsSource.match(/role="switch"/g)).toHaveLength(2);
    expect(csvViewSettingsSource).toContain("editor.csv.headerToggle");
    expect(csvViewSettingsSource).toContain("editor.csv.rowNumbersToggle");
    expect(csvViewSettingsSource).toContain("editor.csv.fitToViewport");
    expect(csvViewSettingsSource).toContain("editor.csv.resetColumnWidths");
    expect(csvViewSettingsSource).not.toContain("editor.csv.headerDescription");
    expect(csvTableCss).not.toContain(".csv-table-editor__settings-menu");
    expect(csvTableCss).not.toContain(".csv-table-editor__settings-summary");
    expect(csvEditorSource).toContain("csv-table-editor__add-row");
    expect(csvEditorSource).toContain("csv-table-editor__add-column");
    expect(csvEditorSource).toContain("CsvTableResizeControl");
    expect(csvEditorSource).toContain("data-resize-preview={resizePreview");
    expect(csvEditorSource).toContain("csv-table-editor__expansion-column");
    expect(csvEditorSource).toContain("csv-table-editor__expansion-row");
    expect(csvEditorSource).toContain("csv-table-editor__expansion-cell");
    expect(csvEditorSource).toContain("onPreviewChange={setResizePreview}");
    expect(csvEditorSource).toContain("structuralDataRowCount + previewRowIndex + 1");
    expect(csvResizeSource).not.toContain('className="csv-table-editor__resize-preview"');
    expect(csvResizeSource).not.toContain("getCsvTableResizePreviewGeometry");
    expect(csvResizeSource).toContain("getCsvTableResizeViewportConstraints");
    expect(csvResizeSource).toContain("onPreviewChange");
    expect(csvResizeSource).toContain("csv-table-editor__resize-handle-visual");
    expect(csvResizeSource).toContain("ArrowDownRight");
    expect(csvResizeSource).not.toContain(
      "csv-table-editor__resize-handle-visual po-editable-table-structure-button-visual",
    );
    expect(csvResizeSource).toContain('role="grid"');
    expect(csvResizeSource).toContain("RESIZE_DRAG_ACTIVATION_DISTANCE = 8");
    expect(csvResizeSource).toContain("snapOutwardDistanceToTrackCount");
    expect(csvResizeSource).toContain("outwardDistance + normalizedTrackSize / 2");
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__resize-picker\.desktop-menu-surface\s*\{[^}]*inline-size:\s*200px[^}]*max-inline-size:\s*calc\(100vw - 16px\)/s,
    );
    expect(csvTableCss).not.toMatch(
      /\.csv-table-editor__resize-picker\.desktop-menu-surface\s*\{[^}]*width:\s*max-content/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__resize-picker-summary\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content[^}]*font-variant-numeric:\s*tabular-nums/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__resize-picker-grid\s*\{[^}]*width:\s*max-content[^}]*justify-self:\s*start/s,
    );
    expect(csvTableCss).not.toContain(".csv-table-editor__surface::after");
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__table\s*\{[^}]*border:\s*1px solid var\(--po-editable-table-border\)[^}]*border-radius:\s*0/s,
    );
    expect(csvTableCss).toContain("--po-editable-table-cell-max-width: 560px");
    expect(sharedTableCss).toContain("--po-editable-table-background:");
    expect(csvTableCss).toContain(".csv-table-editor__column-resize-handle");
    expect(csvColumnResizeSource).toContain("onDoubleClick");
    expect(csvColumnLayoutSource).toContain("View-only CSV column geometry");
    expect(csvColumnLayoutSource).toContain("fitToViewport");
    expect(csvDocumentModelSource).not.toContain("columnWidths");
    expect(csvEditorSource).toContain("columnLayoutSnapshot.widths");
    expect(csvTableCss).not.toMatch(
      /\.csv-table-editor__table \.csv-table-editor__record-index\s*\{[^}]*border-inline-end:\s*0/s,
    );
    expect(csvTableCss).toContain(
      ".csv-table-editor__table > thead > tr:first-child > :first-child",
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__surface\[data-resize-preview\] \.csv-table-editor__table\s*\{[^}]*border-color:\s*var\(--csv-table-resize-preview-border\)[^}]*box-shadow:\s*none/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__table \.csv-table-editor__expansion-cell\s*\{[^}]*border-inline-end-color:\s*var\(--csv-table-resize-preview-grid\)[^}]*border-block-end-color:\s*var\(--csv-table-resize-preview-grid\)[^}]*background:\s*var\(--po-editable-table-background\)/s,
    );
    expect(csvTableCss).toContain(".csv-table-editor__expansion-record-index");
    expect(csvTableCss).toContain("--po-editable-table-background");
    expect(csvTableCss).not.toContain(".csv-table-editor__resize-preview {");
    expect(csvTableCss).not.toContain(".csv-table-editor__resize-preview-columns");
    expect(csvTableCss).not.toContain(".csv-table-editor__resize-preview-rows");
    expect(csvTableCss).not.toContain("background-image: linear-gradient");
    expect(csvTableCss).not.toContain("border-inline-end-color: transparent");
    expect(csvTableCss).not.toContain("border-block-end-color: transparent");
    expect(csvTableCss).not.toContain("border: 1px dashed");
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__resize-handle-visual\s*\{[^}]*width:\s*15px[^}]*height:\s*15px[^}]*border:\s*1px solid transparent[^}]*background:\s*var\(--po-editable-table-structure-background\)[^}]*color:\s*transparent/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__resize-handle:hover \.csv-table-editor__resize-handle-visual,[\s\S]*?border-color:\s*var\(--po-editable-table-structure-hover-border\)[^}]*background:\s*var\(--po-editable-table-structure-hover-background\)[^}]*color:\s*var\(--po-editable-table-structure-hover-color\)/s,
    );
    expect(csvTableCss).not.toContain("box-shadow: -3px -3px 0 currentColor");
    expect(csvTableCss).not.toContain("border-inline-end: 1.5px solid currentColor");
    expect(csvTableCss).not.toContain("grid-template-columns: repeat(6, 16px)");
    expect(csvTableCss).not.toContain("var(--csv-table-resize-column-width)");
    expect(csvControlsSource).toContain("po-editable-table-row-handle");
    expect(csvControlsSource).toContain('direction === "rtl" ? rect.right : rect.left');
    expect(sharedTableCss).toMatch(
      /\.po-editable-table-row-handle \.po-editable-table-drag-handle-visual\s*\{[^}]*width:\s*14px[^}]*height:\s*22px/s,
    );
    expect(csvControlsSource).toContain("ROW_HANDLE_OUTER_REACH_PX = 9");
    expect(csvControlsSource).toContain("COLUMN_HANDLE_OUTER_REACH_PX = 9");
    expect(csvControlsSource).toContain('setAttribute("data-row-handle-docked", "")');
    expect(csvControlsSource).toContain('classList.toggle("is-inline-docked", docked)');
    expect(csvControlsSource).toContain("rowNumbersVisible ? recordIndexCell : fallbackCell");
    expect(csvControlsSource).toContain("direction === \"rtl\" ? scrollRect.right : scrollRect.left");
    expect(csvControlsSource).toContain('setAttribute("data-column-handle-docked", "")');
    expect(csvControlsSource).toContain('classList.toggle("is-block-docked", docked)');
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__column-handle\.is-block-docked\s*\{[^}]*transform:\s*translate\(-50%,\s*4px\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__header-cell\[data-column-handle-docked\] input\s*\{[^}]*opacity:\s*0/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__row-handle\.is-inline-docked\s*\{[^}]*transform:\s*translate\(4px,\s*-50%\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__surface\[dir="rtl"\][\s\S]*?\.csv-table-editor__row-handle\.is-inline-docked\s*\{[^}]*transform:\s*translate\(calc\(-100% - 4px\),\s*-50%\)/s,
    );
    expect(csvTableCss).toMatch(
      /\.csv-table-editor__record-index\[data-row-handle-docked\][\s\S]*?\.csv-table-editor__record-index-label\s*\{[^}]*opacity:\s*0/s,
    );
    expect(csvTableCss).not.toContain(
      ".csv-table-editor__row-handle .po-editable-table-drag-handle-visual",
    );
    expect(csvTableCss).not.toContain("is-row-control-active");
    expect(csvControlsSource).toContain("po-editable-table-column-handle");
    expect(csvControlsSource).toContain("getEditableTableDropBoundary");
    expect(csvMenuSource).toContain("po-editable-table-context-menu");
    expect(csvMenuSource).toContain('role="menuitem"');
    expect(markdownTableCss).toContain("po-editable-table");
  });
});

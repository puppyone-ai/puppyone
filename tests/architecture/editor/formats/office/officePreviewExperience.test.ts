import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const officeViewerSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/office/OfficeViewer.tsx", import.meta.url),
  "utf8",
);
const officePreviewCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/media-office-preview.css", import.meta.url),
  "utf8",
);
const wordPreviewSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/office/word/WordDocumentPreview.tsx", import.meta.url),
  "utf8",
);
const officeFontCompatibilitySource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/viewers/office/officeFontCompatibility.ts", import.meta.url),
  "utf8",
);
const viewerTypesSource = readFileSync(
  new URL("../../../../../packages/shared-ui/src/editor/registry/viewerTypes.ts", import.meta.url),
  "utf8",
);
const tokenSource = readFileSync(
  new URL("../../../../../src/styles/tokens.css", import.meta.url),
  "utf8",
);
const paletteTokenSource = [
  tokenSource,
  ...["default-neutral", "default-warm", "default-graphite"].map((name) => readFileSync(
    new URL(`../../../../../sub-themes/${name}/theme.css`, import.meta.url),
    "utf8",
  )),
].join("\n");

describe("lightweight Office preview experience", () => {
  it("keeps the successful preview headerless and read-only", () => {
    expect(officeViewerSource).not.toContain("office-preview__header");
    expect(officeViewerSource).not.toContain("OfficePreviewHeader");
    expect(officeViewerSource).not.toContain("FileGlyphIcon");
    expect(officeViewerSource).toContain("office-preview__floating-controls");
    expect(officeViewerSource).not.toMatch(/Ask Agent|continue editing|继续修改/i);
    expect(officeViewerSource).not.toContain("OfficeEditorViewer");
  });

  it("renders Word on a stable paper surface with visible zoom and font compatibility", () => {
    expect(officeViewerSource).toContain("office-preview__zoom-controls");
    expect(officeViewerSource).toContain("wordResolvedScale");
    expect(wordPreviewSource).toContain("OFFICE_FONT_COMPATIBILITY_CSS");
    expect(officeFontCompatibilitySource).toContain('font-family: "宋体"');
    expect(officeFontCompatibilitySource).toContain('local("Songti SC")');
    expect(wordPreviewSource).toContain("await document.fonts?.ready");
    expect(wordPreviewSource).toContain("sanitizeDocxDom(fragment)");
    expect(wordPreviewSource).toContain("resolveWordPreviewScale");
    expect(wordPreviewSource).toContain('const WORD_PREVIEW_CLASS_NAME = "office-docx"');
    expect(wordPreviewSource).toContain(
      "const WORD_PREVIEW_WRAPPER_SELECTOR = `.${WORD_PREVIEW_CLASS_NAME}-wrapper`;",
    );
    expect(wordPreviewSource).toContain("querySelector<HTMLElement>(WORD_PREVIEW_WRAPPER_SELECTOR)");
    expect(wordPreviewSource).toContain(".office-docx-body ${WORD_PREVIEW_WRAPPER_SELECTOR}");
    expect(officePreviewCss).toContain("office-document-preview--docx");
    expect(officePreviewCss).toMatch(
      /\.office-document-preview--docx\s*\{[^}]*background:\s*var\(--po-editor-bg\)/s,
    );
  });

  it("reserves only an explicit host-owned Office editor action", () => {
    expect(viewerTypesSource).toContain("OfficeEditorActionResolver");
    expect(viewerTypesSource).toContain("activate: () => void | Promise<void>");
    expect(officeViewerSource).toContain("officeEditorActions.map");
    expect(officeViewerSource).not.toContain("officeEditing");
  });

  it("presents PowerPoint as a thumbnail rail and one central slide stage", () => {
    expect(officeViewerSource).toContain('renderMode: "slide"');
    expect(officeViewerSource).toContain('fitMode: "none"');
    expect(officeViewerSource).toContain("getPresentationFitZoomPercent");
    expect(officeViewerSource).toContain("new ResizeObserver(scheduleFit)");
    expect(officeViewerSource).toContain("renderThumbnailToContainer");
    expect(officeViewerSource).toContain("IntersectionObserver");
    expect(officeViewerSource).toContain("settlePresentationFonts(document.fonts?.ready");
    expect(officeViewerSource).toContain("ensureOfficeFontCompatibilityStyles(document)");
    expect(officeViewerSource).toContain("applyOfficeCjkFontFallbacks(element)");
    expect(officeViewerSource).toContain("applyOfficeCjkFontFallbacks(host)");
    expect(officeViewerSource).toContain("onSlideError");
    expect(officeViewerSource).toContain("onSlideRendered");
    expect(officeViewerSource).toContain("office-pptx-slide-error");
    expect(officeViewerSource).toContain('data-render-state={renderStatus}');
    expect(officeViewerSource).toContain("office-pptx-thumbnail-rail");
    expect(officeViewerSource).toContain("office-pptx-stage");
    expect(officeViewerSource).toContain("getPresentationNavigationTarget");
    expect(officeViewerSource).toContain("reducePresentationWheelGesture");
    expect(officeViewerSource.match(/onWheelCapture=\{handleStageWheel\}/g)).toHaveLength(2);
    expect(officeViewerSource).not.toContain('renderMode: "list"');
    expect(officePreviewCss).toMatch(
      /\.office-pptx-workspace\s*\{[^}]*display:\s*flex[^}]*background:\s*var\(--po-editor-bg\)/s,
    );
    expect(officePreviewCss).toMatch(
      /\.office-pptx-thumbnail-rail\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(officePreviewCss).toMatch(
      /\.office-pptx-thumbnail\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--po-selected\)/s,
    );
    expect(officePreviewCss).toMatch(
      /\.office-pptx-thumbnail:hover\s*\{[^}]*background:\s*var\(--po-hover\)/s,
    );
    expect(officePreviewCss).toContain(
      '.office-pptx-thumbnail[aria-selected="true"] .office-pptx-thumbnail__frame',
    );
    expect(officePreviewCss).toMatch(
      /\.office-pptx-thumbnail\[aria-selected="true"\] \.office-pptx-thumbnail__number\s*\{[^}]*color:\s*var\(--po-file-accent-presentation\)/s,
    );
    expect(officePreviewCss).toContain('.office-pptx-thumbnail__frame[data-render-state="error"]');
    expect(officePreviewCss).toContain("prefers-reduced-motion: reduce");
    // Neutral owns the fallback accents; Warm dark and Graphite light/dark
    // redeclare intentional differences. The global layer adds no duplicate.
    expect(paletteTokenSource.match(/--po-file-accent-presentation:/g)).toHaveLength(5);
    expect(paletteTokenSource.match(/--po-file-accent-word:/g)).toHaveLength(5);
    expect(officePreviewCss).not.toMatch(
      /\.office-pptx-workspace\s*\{[^}]*var\(--po-inset\)/s,
    );
  });

  it("keeps spreadsheet navigation familiar and at the bottom of the viewport", () => {
    const gridIndex = officeViewerSource.indexOf("office-spreadsheet-grid-wrap");
    const notesIndex = officeViewerSource.indexOf("previewNotes.length > 0");
    const tabsIndex = officeViewerSource.lastIndexOf("office-spreadsheet-tabs");

    expect(officeViewerSource).toContain("<thead>");
    expect(officeViewerSource).toContain("spreadsheetColumnLabel");
    expect(officeViewerSource).toContain("office-spreadsheet-formula-bar");
    expect(officeViewerSource).toContain("getSpreadsheetNavigationTarget");
    expect(officeViewerSource).toContain("createSpreadsheetCellCssStyle");
    expect(officeViewerSource).toContain('data-cell-kind={cell.kind}');
    expect(officeViewerSource).toContain("aria-rowcount={selectedSheet.rows.length + 1}");
    expect(gridIndex).toBeGreaterThan(-1);
    expect(notesIndex).toBeGreaterThan(gridIndex);
    expect(tabsIndex).toBeGreaterThan(notesIndex);
    expect(officePreviewCss).toMatch(
      /\.office-spreadsheet-grid__column-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s,
    );
    expect(officePreviewCss).toMatch(
      /\.office-spreadsheet-tabs\s*\{[^}]*border-top:/s,
    );
    expect(officePreviewCss).toMatch(
      /\.office-spreadsheet-preview\s*\{[^}]*--office-sheet-canvas:\s*#fff/s,
    );
    expect(officePreviewCss).toContain('.office-spreadsheet-grid td[data-cell-kind="number"]');
    expect(officePreviewCss).toContain('.office-spreadsheet-grid td[data-selected="true"]');
    expect(officePreviewCss).toContain(".office-spreadsheet-formula-bar");
    expect(officePreviewCss).toContain("font-size: var(--po-text-size-meta, 12px)");
    expect(officePreviewCss).toContain("font-weight: var(--po-text-weight-regular, 400)");
    expect(officePreviewCss).not.toMatch(
      /\.office-spreadsheet-formula-bar output\s*\{[^}]*font:\s*inherit/s,
    );
    expect(officePreviewCss).toContain("--office-sheet-default-font-family");
    expect(officePreviewCss).toContain("font-size: var(--office-sheet-default-font-size)");
    expect(officeViewerSource).toContain("createSpreadsheetPresentationCssStyle(result)");
    expect(officeViewerSource).toContain("style={{ zoom: displayScale }}");
    expect(officePreviewCss).not.toContain(".office-spreadsheet-grid tr:nth-child(even) td");
  });
});

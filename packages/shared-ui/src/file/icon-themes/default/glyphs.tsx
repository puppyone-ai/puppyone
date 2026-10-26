import type { ReactNode } from "react";
import type {
  FileIconRenderContext,
  FileIconRendererMap,
} from "../iconThemeTypes";
import {
  AppGlyph,
  DatabaseGlyph,
  ExcelSpreadsheetGlyph,
  HtmlDocumentGlyph,
  PresentationDocumentGlyph,
  SpreadsheetGridGlyph,
  TreasureMapGlyph,
  WordDocumentGlyph,
  WorkflowGlyph,
} from "../shared/semanticGlyphs";
import { FOLDER_ICON_PATHS } from "../../../icons/productIcons";
import { glyphLine } from "../shared/glyphLine";

export const defaultGlyphRenderers = {
  folder: renderDefaultCompactFolderGlyph,
  app: AppGlyph,
  "context-map": TreasureMapGlyph,
  workflow: WorkflowGlyph,
  markdown: renderDefaultDocumentGlyph,
  json: renderDefaultJsonGlyph,
  html: HtmlDocumentGlyph,
  image: renderDefaultImageGlyph,
  audio: renderDefaultAudioGlyph,
  pdf: renderDefaultDocumentGlyph,
  video: renderDefaultVideoGlyph,
  word: renderDefaultWordGlyph,
  excel: renderDefaultExcelGlyph,
  spreadsheet: renderDefaultSpreadsheetGlyph,
  database: DatabaseGlyph,
  presentation: renderDefaultPresentationGlyph,
  archive: renderDefaultDocumentGlyph,
  document: renderDefaultDocumentGlyph,
  binary: renderDefaultBlankPageGlyph,
  code: renderDefaultCodeGlyph,
  text: renderDefaultDocumentGlyph,
  file: renderDefaultBlankPageGlyph,
} satisfies FileIconRendererMap<FileIconRenderContext>;

export function renderDefaultFolderPreviewGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return <DefaultFolderGlyph size={context.size} />;
}

function renderDefaultCompactFolderGlyph({
  size,
}: FileIconRenderContext): ReactNode {
  return <DefaultFolderGlyph size={size} compact />;
}

function DefaultFolderGlyph({
  size,
  compact = false,
}: {
  size: number;
  compact?: boolean;
}) {
  const [body, tabLine] = FOLDER_ICON_PATHS;
  // In rows the folder is drawn like its label: the label's ink at the text's
  // line weight, unfilled. Previews keep their light body and own accent.
  const ink = compact ? "currentColor" : "var(--po-file-accent-default)";
  // In rows the 24-unit folder sits in a 30-unit field, so it carries the same
  // optical weight as the text and code glyphs beside it instead of filling the slot.
  const viewBox = compact ? "-3 -3 30 30" : "0 0 24 24";
  const strokeWidth = compact ? glyphLine(size, 30) : 1.45;

  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" aria-hidden data-product-icon="folder">
      <path
        d={body}
        fill={compact ? "none" : "color-mix(in srgb, var(--po-file-icon-body) 68%, transparent)"}
        stroke={ink}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path
        d={tabLine}
        stroke={ink}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}

function renderDefaultAudioGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M2.6 10.9V7.1h2.25L8.7 4.35v9.3L4.85 10.9H2.6Z" fill={color} />
      <path d="M10.8 6.55c1.05 1.1 1.05 2.8 0 3.9" stroke={color} strokeWidth={glyphLine(size)} strokeLinecap="round" />
      <path d="M12.95 5.05c1.8 1.95 1.8 5.9 0 7.9" stroke={color} strokeWidth={glyphLine(size)} strokeLinecap="round" opacity="0.78" />
    </svg>
  );
}

function renderDefaultImageGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2.75" y="3.75" width="12.5" height="10.5" rx="1.25" stroke={color} strokeWidth={glyphLine(size)} />
      <path d="M3.8 12.5 6.35 9.65l2.05 2.1 2.35-3.05 3.35 3.8" stroke={color} strokeWidth={glyphLine(size)} strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10.85" y="5.6" width="2" height="2" rx="0.35" fill={color} />
    </svg>
  );
}

function renderDefaultVideoGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      data-file-icon-shape="video-player"
    >
      <rect
        x="2.75"
        y="4"
        width="12.5"
        height="10"
        rx="1.5"
        stroke={color}
        strokeWidth={glyphLine(size)}
      />
      <path d="m7.35 6.45 4.55 2.55-4.55 2.55v-5.1Z" fill={color} />
    </svg>
  );
}

function renderDefaultCodeGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="m7.05 5.15-3.5 3.75 3.5 3.75" stroke={color} strokeWidth={glyphLine(size)} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10.95 5.15 3.5 3.75-3.5 3.75" stroke={color} strokeWidth={glyphLine(size)} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function renderDefaultJsonGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <text x="9" y="12.35" textAnchor="middle" fontSize="10" fontWeight="600" fontFamily="var(--po-font-sans)" fill={color}>
        {"{}"}
      </text>
    </svg>
  );
}

function renderDefaultSpreadsheetGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <SpreadsheetGridGlyph
      color={color}
      fill="color-mix(in srgb, var(--po-file-icon-body) 65%, transparent)"
      size={size}
      strokeWidth={glyphLine(size)}
    />
  );
}

function renderDefaultWordGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <WordDocumentGlyph
      color={color}
      fill="color-mix(in srgb, var(--po-file-icon-body) 72%, transparent)"
      size={size}
      strokeWidth={glyphLine(size)}
    />
  );
}

function renderDefaultExcelGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <ExcelSpreadsheetGlyph
      color={color}
      fill="color-mix(in srgb, var(--po-file-icon-body) 72%, transparent)"
      size={size}
      strokeWidth={glyphLine(size)}
    />
  );
}

function renderDefaultPresentationGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <PresentationDocumentGlyph
      color={color}
      fill="color-mix(in srgb, var(--po-file-icon-body) 72%, transparent)"
      size={size}
      strokeWidth={glyphLine(size)}
    />
  );
}

/** A file whose contents cannot be told: a blank page. */
function renderDefaultBlankPageGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden data-file-icon-shape="blank-page">
      <path
        d="M5.1 2.75h5.65l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.35c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z"
        stroke={color}
        strokeWidth={glyphLine(size)}
        strokeLinejoin="round"
      />
      <path d="M10.75 2.95v2.45h2.4" stroke={color} strokeWidth={glyphLine(size)} strokeLinejoin="round" />
    </svg>
  );
}

const DOCUMENT_TEXT_LINES = "M5.85 9.25h5.2M5.85 11.75h3.65";

/**
 * Documents (Markdown, text, PDF, archives): a page with a folded corner and
 * two lines of text, one long and one short, drawn in the same ink and weight
 * as the outline. The ink is the label's for Markdown and text and the
 * format's accent for PDF and archives. Its closed outline reads apart from
 * the open folder chevrons around it.
 */
function renderDefaultDocumentGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden data-file-icon-shape="document">
      <path
        d="M5.1 2.75h5.65l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.35c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z"
        stroke={color}
        strokeWidth={glyphLine(size)}
        strokeLinejoin="round"
      />
      <path d="M10.75 2.95v2.45h2.4" stroke={color} strokeWidth={glyphLine(size)} strokeLinejoin="round" />
      <path d={DOCUMENT_TEXT_LINES} stroke={color} strokeWidth={glyphLine(size)} strokeLinecap="round" />
    </svg>
  );
}

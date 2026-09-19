import type { ReactNode } from "react";
import type {
  FileIconRenderContext,
  FileIconRendererMap,
} from "../iconThemeTypes";
import {
  AppGlyph,
  DatabaseGlyph,
  ExcelSpreadsheetGlyph,
  PresentationDocumentGlyph,
  SpreadsheetGridGlyph,
  TreasureMapGlyph,
  WordDocumentGlyph,
  WorkflowGlyph,
} from "../shared/semanticGlyphs";

export const defaultGlyphRenderers = {
  folder: renderDefaultCompactFolderGlyph,
  app: AppGlyph,
  "context-map": TreasureMapGlyph,
  workflow: WorkflowGlyph,
  markdown: renderDefaultDocumentGlyph,
  json: renderDefaultJsonGlyph,
  html: renderDefaultCodeGlyph,
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
  binary: renderDefaultDocumentGlyph,
  code: renderDefaultCodeGlyph,
  text: renderDefaultDocumentGlyph,
  file: renderDefaultDocumentGlyph,
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
  const strokeWidth = compact ? 1.7 : 1.45;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 6.5c0-1.1.9-2 2-2h4.1l2 2h6.9c1.1 0 2 .9 2 2v8.5c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2V6.5Z"
        fill="color-mix(in srgb, var(--po-file-icon-body) 68%, transparent)"
        stroke="var(--po-file-accent-default)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
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
      <path d="M10.8 6.55c1.05 1.1 1.05 2.8 0 3.9" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
      <path d="M12.95 5.05c1.8 1.95 1.8 5.9 0 7.9" stroke={color} strokeWidth="1.25" strokeLinecap="round" opacity="0.78" />
    </svg>
  );
}

function renderDefaultImageGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2.75" y="3.75" width="12.5" height="10.5" rx="1.25" stroke={color} strokeWidth="1.45" />
      <path d="M3.8 12.5 6.35 9.65l2.05 2.1 2.35-3.05 3.35 3.8" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
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
        fill="color-mix(in srgb, var(--po-file-icon-body) 65%, transparent)"
        stroke={color}
        strokeWidth="1.35"
      />
      <path d="m7.35 6.45 4.55 2.55-4.55 2.55v-5.1Z" fill={color} />
    </svg>
  );
}

function renderDefaultCodeGlyph({
  color,
  kind,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="m7.05 5.15-3.5 3.75 3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10.95 5.15 3.5 3.75-3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
      {kind === "html" && <path d="M9.95 4.95 8.05 12.9" stroke={color} strokeWidth="1.35" strokeLinecap="round" opacity="0.86" />}
    </svg>
  );
}

function renderDefaultJsonGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <text x="9" y="12.35" textAnchor="middle" fontSize="10" fontWeight="800" fontFamily="var(--po-font-sans)" fill={color}>
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
    />
  );
}

function renderDefaultDocumentGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M5.1 2.75h5.65l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.35c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z"
        fill="color-mix(in srgb, var(--po-file-icon-body) 65%, transparent)"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M10.75 2.95v2.45h2.4" stroke={color} strokeWidth="1" strokeLinejoin="round" />
      <path d="M5.85 8.25h5.2M5.85 10.25h5.2M5.85 12.25h3.65" stroke={color} strokeWidth="1.05" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

import type { ReactNode } from "react";
import type {
  FileIconRenderContext,
  FileIconRendererMap,
} from "../iconThemeTypes";
import {
  AppGlyph,
  DatabaseGlyph,
  DocumentLinesSymbol,
  ExcelSpreadsheetGlyph,
  PresentationDocumentGlyph,
  SpreadsheetGridGlyph,
  TreasureMapGlyph,
  WordDocumentGlyph,
  WorkflowGlyph,
} from "../shared/semanticGlyphs";

export const materialGlyphRenderers = {
  folder: renderMaterialCompactFolderGlyph,
  app: AppGlyph,
  "context-map": TreasureMapGlyph,
  workflow: WorkflowGlyph,
  markdown: renderMaterialLinesDocumentGlyph,
  json: renderMaterialJsonDocumentGlyph,
  html: renderMaterialCodeGlyph,
  image: renderMaterialImageGlyph,
  audio: renderMaterialAudioGlyph,
  pdf: renderMaterialPdfDocumentGlyph,
  video: renderMaterialVideoGlyph,
  word: renderMaterialWordGlyph,
  excel: renderMaterialExcelGlyph,
  spreadsheet: renderMaterialSpreadsheetGlyph,
  database: DatabaseGlyph,
  presentation: renderMaterialPresentationGlyph,
  archive: renderMaterialArchiveGlyph,
  document: renderMaterialLinesDocumentGlyph,
  binary: renderMaterialLinesDocumentGlyph,
  code: renderMaterialCodeGlyph,
  text: renderMaterialLinesDocumentGlyph,
  file: renderMaterialLinesDocumentGlyph,
} satisfies FileIconRendererMap<FileIconRenderContext>;

export function renderMaterialFolderPreviewGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return <MaterialFolderGlyph size={context.size} />;
}

function renderMaterialCompactFolderGlyph({
  size,
}: FileIconRenderContext): ReactNode {
  return <MaterialFolderGlyph size={size} compact />;
}

function MaterialFolderGlyph({
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
        d="M3 7.15c0-1.1.9-2 2-2h4.25l2 2H19c1.1 0 2 .9 2 2v7.55c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7.15Z"
        fill="color-mix(in srgb, var(--po-file-accent-default) 24%, var(--po-panel-raised))"
        stroke="var(--po-file-accent-default)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path
        d="M3.25 9.15h17.5"
        stroke="var(--po-file-accent-default)"
        strokeWidth={compact ? 1.35 : 1.15}
        strokeLinecap="round"
        opacity="0.56"
      />
    </svg>
  );
}

function renderMaterialAudioGlyph({
  color,
  size,
}: FileIconRenderContext): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M2.7 10.75v-3.5h2.15l3.65-2.5v8.5l-3.65-2.5H2.7Z" fill={color} />
      <path d="M10.6 6.45c1.2 1.1 1.2 4 0 5.1" stroke={color} strokeWidth="1.55" strokeLinecap="round" />
      <path d="M12.8 5.2c1.85 2 1.85 5.6 0 7.6" stroke={color} strokeWidth="1.25" strokeLinecap="round" opacity="0.72" />
    </svg>
  );
}

function renderMaterialImageGlyph(
  context: FileIconRenderContext,
): ReactNode {
  const tint = getMaterialTint(context.color);
  return (
    <svg width={context.size} height={context.size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2.75" y="3.35" width="12.5" height="11" rx="1.8" fill={tint} stroke={context.color} strokeWidth="1.35" />
      <path d="M3.85 12.7 6.2 9.9l1.95 1.9 2.25-3 3.75 4" stroke={context.color} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11.95" cy="6.25" r="1.05" fill={context.color} />
    </svg>
  );
}

function renderMaterialVideoGlyph(
  context: FileIconRenderContext,
): ReactNode {
  const tint = getMaterialTint(context.color);
  return (
    <svg width={context.size} height={context.size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2.75" y="4" width="12.5" height="10" rx="1.8" fill={tint} stroke={context.color} strokeWidth="1.35" />
      <path d="m7.25 6.6 4.7 2.4-4.7 2.4V6.6Z" fill={context.color} />
    </svg>
  );
}

function renderMaterialCodeGlyph(
  context: FileIconRenderContext,
): ReactNode {
  const tint = getMaterialTint(context.color);
  return (
    <svg width={context.size} height={context.size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2.55" y="3.15" width="12.9" height="11.7" rx="2.05" fill={tint} />
      <path d="m7 5.9-3 3.1 3 3.1" stroke={context.color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m11 5.9 3 3.1-3 3.1" stroke={context.color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      {context.kind === "html" && <path d="M9.95 5.6 8.05 12.4" stroke={context.color} strokeWidth="1.2" strokeLinecap="round" opacity="0.82" />}
    </svg>
  );
}

function renderMaterialSpreadsheetGlyph(
  context: FileIconRenderContext,
): ReactNode {
  const tint = getMaterialTint(context.color);
  return (
    <SpreadsheetGridGlyph
      color={context.color}
      fill={tint}
      size={context.size}
      strokeWidth={1.2}
    />
  );
}

function renderMaterialWordGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return (
    <WordDocumentGlyph
      color={context.color}
      fill={getMaterialTint(context.color)}
      size={context.size}
    />
  );
}

function renderMaterialExcelGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return (
    <ExcelSpreadsheetGlyph
      color={context.color}
      fill={getMaterialTint(context.color)}
      size={context.size}
    />
  );
}

function renderMaterialPresentationGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return (
    <PresentationDocumentGlyph
      color={context.color}
      fill={getMaterialTint(context.color)}
      size={context.size}
    />
  );
}

function renderMaterialArchiveGlyph(
  context: FileIconRenderContext,
): ReactNode {
  const tint = getMaterialTint(context.color);
  return (
    <svg width={context.size} height={context.size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3.4 6.1 9 3.05l5.6 3.05v5.8L9 14.95 3.4 11.9V6.1Z" fill={tint} stroke={context.color} strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M3.65 6.25 9 9.15l5.35-2.9M9 9.15v5.45" stroke={context.color} strokeWidth="1.05" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

function renderMaterialLinesDocumentGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return renderMaterialDocumentGlyph(
    context,
    <DocumentLinesSymbol color={context.color} />,
  );
}

function renderMaterialJsonDocumentGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return renderMaterialDocumentGlyph(
    context,
    <text
      x="8.8"
      y="12.2"
      textAnchor="middle"
      fontSize="8"
      fontWeight="850"
      fontFamily="var(--po-font-sans)"
      fill={context.color}
    >
      {"{}"}
    </text>,
  );
}

function renderMaterialPdfDocumentGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return renderMaterialDocumentGlyph(
    context,
    <text
      x="8.75"
      y="11.65"
      textAnchor="middle"
      fontSize="4"
      fontWeight="850"
      fontFamily="var(--po-font-sans)"
      fill={context.color}
    >
      PDF
    </text>,
  );
}

function renderMaterialDocumentGlyph(
  context: FileIconRenderContext,
  symbol: ReactNode,
): ReactNode {
  const tint = getMaterialTint(context.color);
  return (
    <svg width={context.size} height={context.size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4.6 2.6h6.05l2.75 2.8v9c0 .55-.45 1-1 1H4.6c-.55 0-1-.45-1-1V3.6c0-.55.45-1 1-1Z"
        fill={tint}
        stroke={context.color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M10.65 2.8v2.6h2.55" stroke={context.color} strokeWidth="0.95" strokeLinejoin="round" />
      {symbol}
    </svg>
  );
}

function getMaterialTint(color: string): string {
  return `color-mix(in srgb, ${color} 16%, var(--po-panel-raised))`;
}

import type { ReactNode } from "react";
import {
  getFileAccent,
  type FileVisualKind,
} from "../../fileIconTypes";
import type {
  FileIconRenderContext,
  FileIconRendererMap,
} from "../iconThemeTypes";
import {
  DatabaseGlyph,
  DocumentLinesSymbol,
  ExcelSpreadsheetGlyph,
  PresentationDocumentGlyph,
  SpreadsheetGridGlyph,
  TreasureMapGlyph,
  WordDocumentGlyph,
} from "../shared/semanticGlyphs";

export function renderVsCodeGlyph(
  context: FileIconRenderContext,
): ReactNode {
  const color = getVsCodeAccent(context.kind);
  const fill = getVsCodeFill(context.kind);
  const foldFill = getVsCodeFoldFill(context.kind);

  if (context.kind === "folder") {
    return <VsCodeFolderGlyph size={context.size} />;
  }
  if (context.kind === "context-map") {
    return <TreasureMapGlyph {...context} color={color} />;
  }
  if (context.kind === "database") {
    return <DatabaseGlyph {...context} color={color} />;
  }
  if (context.kind === "spreadsheet") {
    return (
      <SpreadsheetGridGlyph
        color={color}
        fill={fill}
        size={context.size}
        strokeWidth={1.15}
      />
    );
  }
  if (context.kind === "word") {
    return (
      <WordDocumentGlyph
        color={color}
        fill={fill}
        size={context.size}
        strokeWidth={1.05}
      />
    );
  }
  if (context.kind === "excel") {
    return (
      <ExcelSpreadsheetGlyph
        color={color}
        fill={fill}
        size={context.size}
        strokeWidth={1.05}
      />
    );
  }
  if (context.kind === "presentation") {
    return (
      <PresentationDocumentGlyph
        color={color}
        fill={fill}
        size={context.size}
        strokeWidth={1.05}
      />
    );
  }
  const kind = context.kind;

  return (
    <svg width={context.size} height={context.size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4.35 2.25h6.35l3.05 3.05v9.3c0 .62-.5 1.12-1.12 1.12H4.35c-.62 0-1.12-.5-1.12-1.12V3.37c0-.62.5-1.12 1.12-1.12Z"
        fill={fill}
      />
      <path d="M10.7 2.25V5.3h3.05" fill={foldFill} />
      <VsCodeSymbol kind={kind} color={color} label={context.label} />
    </svg>
  );
}

export const vscodeGlyphRenderers = {
  folder: renderVsCodeGlyph,
  app: renderVsCodeGlyph,
  "context-map": renderVsCodeGlyph,
  workflow: renderVsCodeGlyph,
  markdown: renderVsCodeGlyph,
  json: renderVsCodeGlyph,
  html: renderVsCodeGlyph,
  image: renderVsCodeGlyph,
  audio: renderVsCodeGlyph,
  pdf: renderVsCodeGlyph,
  video: renderVsCodeGlyph,
  word: renderVsCodeGlyph,
  excel: renderVsCodeGlyph,
  spreadsheet: renderVsCodeGlyph,
  database: renderVsCodeGlyph,
  presentation: renderVsCodeGlyph,
  archive: renderVsCodeGlyph,
  document: renderVsCodeGlyph,
  binary: renderVsCodeGlyph,
  code: renderVsCodeGlyph,
  text: renderVsCodeGlyph,
  file: renderVsCodeGlyph,
} satisfies FileIconRendererMap<FileIconRenderContext>;

export function renderVsCodeFolderPreviewGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return <VsCodeFolderGlyph size={context.size} />;
}

function VsCodeFolderGlyph({ size }: { size: number }) {
  const tabFill = "color-mix(in srgb, #dcb67a 70%, var(--po-file-icon-body))";
  const bodyFill = "color-mix(in srgb, #c99646 76%, var(--po-file-icon-body))";

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M1.85 5.2c0-.72.58-1.3 1.3-1.3h4.2l1.35 1.45h6.15c.72 0 1.3.58 1.3 1.3v6.25c0 .72-.58 1.3-1.3 1.3H3.15c-.72 0-1.3-.58-1.3-1.3V5.2Z"
        fill={tabFill}
      />
      <path d="M2.05 7h13.9v5.95c0 .7-.57 1.25-1.25 1.25H3.3c-.68 0-1.25-.55-1.25-1.25V7Z" fill={bodyFill} />
    </svg>
  );
}

function VsCodeSymbol({
  kind,
  color,
  label,
}: {
  kind: VsCodeFileKind;
  color: string;
  label: string;
}) {
  return VSCODE_SYMBOL_RENDERERS[kind]({ kind, color, label });
}

type VsCodeFileKind = Exclude<
  FileVisualKind,
  "folder" | "spreadsheet" | "database" | "word" | "excel" | "presentation"
>;

type SymbolContext = {
  kind: VsCodeFileKind;
  color: string;
  label: string;
};

const VSCODE_SYMBOL_RENDERERS = {
  app: ({ color }) => (
    <>
      <path
        d="M5.65 10.6h6.7c.62 0 1.1.42 1.2 1.02l.22 1.2H4.23l.22-1.2c.1-.6.58-1.02 1.2-1.02Z"
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M9.55 10.6 8.85 7.2" stroke={color} strokeWidth="0.95" strokeLinecap="round" />
      <circle cx="8.65" cy="5.95" r="1.35" stroke={color} strokeWidth="1" />
      <circle cx="11.65" cy="11.75" r="0.42" fill={color} opacity="0.78" />
    </>
  ),
  "context-map": ({ color }) => (
    <>
      <circle cx="6" cy="7" r="1.2" stroke={color} strokeWidth="1" />
      <circle cx="11.8" cy="6.2" r="1.2" stroke={color} strokeWidth="1" />
      <circle cx="9.4" cy="12.3" r="1.2" stroke={color} strokeWidth="1" />
      <path d="m7.1 7 3.5-.55M6.65 8.05l2.1 3.15m2.1-3.9-.9 3.8" stroke={color} strokeWidth="0.9" strokeLinecap="round" />
    </>
  ),
  workflow: ({ color }) => (
    <>
      <rect x="5.1" y="5.7" width="3.2" height="3.2" rx="0.8" stroke={color} strokeWidth="1" />
      <path d="M6.7 8.9v2.05c0 .72.58 1.3 1.3 1.3h1.7" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9.7" y="10.5" width="3.2" height="3.2" rx="0.8" stroke={color} strokeWidth="1" />
    </>
  ),
  markdown: ({ color }) => <DocumentLinesSymbol color={color} />,
  json: ({ color }) => (
    <text x="8.75" y="12.15" textAnchor="middle" fontSize="8" fontWeight="850" fontFamily="var(--po-font-sans)" fill={color}>
      {"{}"}
    </text>
  ),
  html: renderVsCodeCodeSymbol,
  code: renderVsCodeCodeSymbol,
  image: ({ color }) => (
    <>
      <rect x="5" y="6.15" width="8" height="6.3" rx="0.75" stroke={color} strokeWidth="1" />
      <path d="m5.55 11.85 1.65-1.75 1.35 1.15 1.6-2.05 2.3 2.65" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11.45" cy="7.65" r="0.58" fill={color} />
    </>
  ),
  audio: ({ color }) => (
    <>
      <path d="M5.15 10.55v-3.1h1.75l2.4-1.75v6.6l-2.4-1.75H5.15Z" fill={color} />
      <path d="M11.25 7.1c.85.9.85 2.9 0 3.8" stroke={color} strokeWidth="1.05" strokeLinecap="round" />
    </>
  ),
  video: ({ color }) => (
    <>
      <rect x="4.95" y="5.95" width="8.1" height="6.6" rx="0.85" stroke={color} strokeWidth="1" />
      <path d="m8.1 7.55 3.05 1.7-3.05 1.7v-3.4Z" fill={color} />
    </>
  ),
  archive: ({ color }) => (
    <>
      <path d="M5.15 7.15 9 5.1l3.85 2.05v4.15L9 13.35 5.15 11.3V7.15Z" stroke={color} strokeWidth="1" strokeLinejoin="round" />
      <path d="M5.35 7.25 9 9.2l3.65-1.95M9 9.2v3.8" stroke={color} strokeWidth="0.8" opacity="0.86" />
    </>
  ),
  pdf: renderVsCodeLabelSymbol,
  document: renderVsCodeLabelSymbol,
  binary: renderVsCodeLabelSymbol,
  text: renderVsCodeLabelSymbol,
  file: renderVsCodeLabelSymbol,
} satisfies Record<VsCodeFileKind, (context: SymbolContext) => ReactNode>;

function renderVsCodeCodeSymbol({
  color,
  kind,
}: SymbolContext): ReactNode {
  return (
    <>
      <path d="m7.1 6.05-2.6 2.85 2.6 2.85" stroke={color} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10.9 6.05 2.6 2.85-2.6 2.85" stroke={color} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      {kind === "html" && <path d="M9.95 5.75 8.05 12.25" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.82" />}
    </>
  );
}

function renderVsCodeLabelSymbol({
  color,
  kind,
  label,
}: SymbolContext): ReactNode {
  return (
    <text
      x="8.75"
      y="11.55"
      textAnchor="middle"
      fontSize={kind === "pdf" ? "4" : "6"}
      fontWeight="850"
      fontFamily="var(--po-font-sans)"
      fill={color}
    >
      {kind === "pdf" ? "PDF" : label}
    </text>
  );
}

function getVsCodeAccent(kind: FileVisualKind): string {
  const overrides: Partial<Record<FileVisualKind, string>> = {
    archive: "var(--po-warning)",
    document: "var(--po-info)",
    binary: "var(--po-file-accent-sheet)",
  };

  return overrides[kind] ?? getFileAccent(kind);
}

function getVsCodeFill(kind: FileVisualKind): string {
  const accent = getVsCodeAccent(kind);
  return `color-mix(in srgb, ${accent} 16%, var(--po-file-icon-body))`;
}

function getVsCodeFoldFill(kind: FileVisualKind): string {
  const accent = getVsCodeAccent(kind);
  return `color-mix(in srgb, ${accent} 13%, var(--po-file-icon-fold))`;
}

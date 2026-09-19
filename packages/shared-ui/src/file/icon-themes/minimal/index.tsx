import type { ReactNode } from "react";
import {
  Database,
  File as LucideFile,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  Folder as LucideFolder,
  Joystick,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { FileVisualKind } from "../../fileIconTypes";
import type {
  FileIconRenderContext,
  FileIconRendererMap,
} from "../iconThemeTypes";
import { createIconTheme } from "../themeFactory";
import {
  DatabaseGlyph,
  ExcelSpreadsheetGlyph,
  PresentationDocumentGlyph,
  SpreadsheetGridGlyph,
  TreasureMapGlyph,
  WordDocumentGlyph,
} from "../shared/semanticGlyphs";

function renderMinimalGlyph(context: FileIconRenderContext): ReactNode {
  if (context.kind === "database") return <DatabaseGlyph {...context} />;
  if (context.kind === "context-map") return <TreasureMapGlyph {...context} />;
  if (context.kind === "spreadsheet") {
    return (
      <SpreadsheetGridGlyph
        color={context.color}
        fill="none"
        size={context.size}
        strokeWidth={1.35}
      />
    );
  }
  if (context.kind === "word") {
    return (
      <WordDocumentGlyph
        color={context.color}
        fill="none"
        size={context.size}
        strokeWidth={1.25}
      />
    );
  }
  if (context.kind === "excel") {
    return (
      <ExcelSpreadsheetGlyph
        color={context.color}
        fill="none"
        size={context.size}
        strokeWidth={1.25}
      />
    );
  }
  if (context.kind === "presentation") {
    return (
      <PresentationDocumentGlyph
        color={context.color}
        fill="none"
        size={context.size}
        strokeWidth={1.25}
      />
    );
  }

  const Icon = getMinimalLucideIcon(context.kind);
  return (
    <Icon
      size={context.size}
      color={context.color}
      strokeWidth={1.85}
      aria-hidden="true"
    />
  );
}

function renderMinimalFolderPreviewGlyph(
  context: FileIconRenderContext,
): ReactNode {
  return (
    <LucideFolder
      size={context.size}
      color="var(--po-file-accent-default)"
      strokeWidth={1.65}
      aria-hidden="true"
    />
  );
}

function getMinimalLucideIcon(kind: FileVisualKind): LucideIcon {
  return MINIMAL_LUCIDE_ICONS[kind];
}

const MINIMAL_LUCIDE_ICONS = {
  folder: LucideFolder,
  app: Joystick,
  "context-map": Workflow,
  workflow: Workflow,
  markdown: FileText,
  json: FileJson,
  html: FileCode,
  image: FileImage,
  audio: FileAudio,
  pdf: FileText,
  video: FileVideo,
  word: FileText,
  excel: LucideFile,
  spreadsheet: LucideFile,
  database: Database,
  presentation: FileText,
  archive: FileArchive,
  document: FileText,
  binary: LucideFile,
  code: FileCode,
  text: FileText,
  file: LucideFile,
} satisfies Record<FileVisualKind, LucideIcon>;

const minimalGlyphRenderers = {
  folder: renderMinimalGlyph,
  app: renderMinimalGlyph,
  "context-map": renderMinimalGlyph,
  workflow: renderMinimalGlyph,
  markdown: renderMinimalGlyph,
  json: renderMinimalGlyph,
  html: renderMinimalGlyph,
  image: renderMinimalGlyph,
  audio: renderMinimalGlyph,
  pdf: renderMinimalGlyph,
  video: renderMinimalGlyph,
  word: renderMinimalGlyph,
  excel: renderMinimalGlyph,
  spreadsheet: renderMinimalGlyph,
  database: renderMinimalGlyph,
  presentation: renderMinimalGlyph,
  archive: renderMinimalGlyph,
  document: renderMinimalGlyph,
  binary: renderMinimalGlyph,
  code: renderMinimalGlyph,
  text: renderMinimalGlyph,
  file: renderMinimalGlyph,
} satisfies FileIconRendererMap<FileIconRenderContext>;

export const minimalTheme = createIconTheme({
  id: "minimal",
  glyphRenderers: minimalGlyphRenderers,
  renderFolderPreviewGlyph: renderMinimalFolderPreviewGlyph,
});

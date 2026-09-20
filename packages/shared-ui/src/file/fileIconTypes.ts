import {
  FILE_SEMANTIC_KINDS,
  type FileSemanticKind,
} from "../core/fileFormats";

export const FILE_VISUAL_KINDS = FILE_SEMANTIC_KINDS;

/**
 * Compatibility name for the icon layer. File semantics are owned by the
 * format registry so classification and theme coverage cannot drift apart.
 */
export type FileVisualKind = FileSemanticKind;

export type FileIconThemeId = "default" | "lines" | "semantic" | "material" | "minimal";

export type FileIconThemeMetadata = {
  id: FileIconThemeId;
};

const KIND_ACCENT = {
  folder: "var(--po-file-accent-default)",
  app: "var(--po-accent)",
  "context-map": "var(--po-accent)",
  workflow: "var(--po-accent)",
  json: "var(--po-file-accent-json)",
  markdown: "var(--po-file-accent-markdown)",
  html: "var(--po-file-accent-html)",
  pdf: "var(--po-file-accent-pdf)",
  image: "var(--po-file-accent-image)",
  audio: "var(--po-file-accent-audio)",
  video: "var(--po-file-accent-video)",
  word: "var(--po-file-accent-word)",
  excel: "var(--po-file-accent-sheet)",
  spreadsheet: "var(--po-file-accent-sheet)",
  database: "var(--po-file-accent-code)",
  presentation: "var(--po-file-accent-presentation)",
  archive: "var(--po-file-accent-pdf)",
  document: "var(--po-file-accent-default)",
  binary: "var(--po-file-accent-default)",
  code: "var(--po-file-accent-code)",
  text: "var(--po-file-accent-default)",
  file: "var(--po-file-accent-default)",
} satisfies Record<FileVisualKind, string>;

export function getFileAccent(kind: FileVisualKind): string {
  return KIND_ACCENT[kind];
}

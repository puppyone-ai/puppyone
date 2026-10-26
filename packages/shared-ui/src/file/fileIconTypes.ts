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

/**
 * Every installed file-icon theme. A new theme adds its id here and one entry
 * in `icon-themes/registry.ts`; the registry's `satisfies` check keeps the two
 * in step. See `icon-themes/README.md` for the plug-in contract.
 */
export type FileIconThemeId = "default";

export type FileIconThemeMetadata = {
  id: FileIconThemeId;
};

/**
 * Glyph ink per kind. Kinds whose colour says what the file is keep a type
 * accent; plain documents take the ink of the label beside them, so they read
 * as part of the row rather than as a second colour.
 */
const LABEL_INK = "currentColor";

const KIND_ACCENT = {
  folder: "var(--po-file-accent-default)",
  app: "var(--po-accent)",
  "context-map": "var(--po-accent)",
  workflow: "var(--po-accent)",
  json: "var(--po-file-accent-json)",
  markdown: LABEL_INK,
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
  document: LABEL_INK,
  binary: LABEL_INK,
  code: "var(--po-file-accent-code)",
  text: LABEL_INK,
  file: LABEL_INK,
} satisfies Record<FileVisualKind, string>;

export function getFileAccent(kind: FileVisualKind): string {
  return KIND_ACCENT[kind];
}

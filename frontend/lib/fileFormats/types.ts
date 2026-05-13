/**
 * File Format Registry — type definitions.
 *
 * The registry is the single source of truth for "given a file
 * (extension + mime), what viewer renders it, what category does it
 * belong to, and how should we ingest it?". Adding a new format =
 * one new entry in `registry.ts` (and matching backend mime entry).
 *
 * Resolution order is **extension first, mime fallback** — extensions
 * are stable user intent, mime is detection (which is unreliable for
 * SaaS sources that send `application/octet-stream`).
 */

/**
 * High-level category of a file. Used by:
 * - `FileImportDialog` for "X text / Y binary" stats
 * - editor chrome for deciding which view-mode toggle to show
 * - `usePathResolver` for deciding whether to pre-fetch text content
 *
 * NOT used for picking the actual viewer — that's `defaultViewer` below.
 */
export type FileCategory =
  | 'image'
  | 'audio'
  | 'video'
  | 'markdown'
  | 'text'
  | 'code'
  | 'data'
  | 'document'
  | 'archive'
  | 'binary';

/**
 * Generic viewers — they all consume the same `ViewerProps` shape
 * (text content + meta) and live in `lib/viewers/registry.tsx`.
 *
 * Adding a generic viewer = add an id here + register in `VIEWERS`.
 */
export type GenericViewerId =
  | 'markdown-editor'
  | 'monaco-code'
  | 'html-artifact'
  | 'image-preview'
  | 'audio-preview'
  | 'video-preview'
  | 'pdf-preview'
  | 'binary-placeholder';

/**
 * Special viewers — they consume non-standard props (e.g. parsed
 * table data, connector handles) and are dispatched directly inside
 * `<EditorArea>`. They do NOT appear in the `VIEWERS` registry.
 */
export type SpecialViewerId = 'json-table';

export type ViewerId = GenericViewerId | SpecialViewerId;

/**
 * How the ingest pipeline should treat this file when it lands in
 * the project. Mirrors `backend/src/ingest/shared/task/normalizers.py::IngestType`.
 */
export type IngestStrategy =
  | 'raw'              // store as-is, no transformation
  | 'parse-text'       // utf-8 text — index for search
  | 'parse-structured' // structured data — extract fields
  | 'ocr';             // pdf/image — run OCR pipeline

export interface FileFormat {
  /** Stable id, e.g. 'png', 'typescript', 'pdf'. */
  id: string;
  /** Human label, e.g. 'PNG Image', 'TypeScript'. */
  label: string;
  /** All extensions that match this format, lowercased, **with leading dot**. */
  extensions: string[];
  /** Exact basename matches (case-insensitive) — for files with no
   *  extension that are still recognizable by name (`Makefile`,
   *  `Dockerfile`, `Rakefile`, `README`, `LICENSE`, …). Filename
   *  match takes priority over extension match. */
  filenames?: string[];
  /** All mime types that match this format. Used as a fallback when
   *  extension lookup misses (e.g. unknown extension but server-detected mime). */
  mimeTypes: string[];
  /** High-level category. */
  category: FileCategory;
  /** Default viewer to render this format. */
  defaultViewer: ViewerId;
  /** Optional alternative viewers the user can switch to (e.g. SVG
   *  can render as image OR as code source). */
  availableViewers?: ViewerId[];
  /** Whether the default viewer supports editing (vs. read-only preview). */
  editable: boolean;
  /** Ingest behavior. */
  ingestStrategy: IngestStrategy;
  /** Monaco language id for code-style viewers. Optional — only set
   *  for `category: 'code'` and `category: 'data'` formats that go
   *  through Monaco. */
  monacoLanguage?: string;
}

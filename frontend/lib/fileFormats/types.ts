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
  /** Human label, e.g. 'PNG Image', 'TypeScript', 'PDF'. */
  label: string;
  /** Exact filename matches, e.g. `Dockerfile`, `Makefile`, `README`. */
  filenames?: string[];
  /** Dot-prefixed extensions, longest suffix wins. */
  extensions?: string[];
  /** MIME fallback from server detection. */
  mimeTypes?: string[];
  /** Broad product category for import stats and viewer chrome. */
  category: FileCategory;
  /** Primary viewer for this format. */
  defaultViewer: ViewerId;
  /** Optional alternate viewers exposed in the file header. */
  availableViewers?: ViewerId[];
  /** Whether the current frontend editor can write this format. */
  editable: boolean;
  /** How ingest should process this file. */
  ingestStrategy: IngestStrategy;
  /** Monaco language id for `code` and `data` formats rendered through Monaco. */
  monacoLanguage?: string;
}

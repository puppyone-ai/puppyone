import type { ReactNode } from "react";
import type { FileFormat } from "../core/fileFormats";

export type EditorDocumentKind =
  | "folder"
  | "markdown"
  | "json"
  | "html"
  | "image"
  | "audio"
  | "pdf"
  | "video"
  | "spreadsheet"
  | "archive"
  | "document"
  | "binary"
  | "code"
  | "text"
  | "file"
  | string;

export type EditorDocument = {
  path: string;
  name: string;
  type: EditorDocumentKind;
  content?: string | null;
  preview?: string | null;
  mimeType?: string | null;
  url?: string | null;
};

export type EditorMode = "live" | "source";
export type EditorSaveMode = "manual" | "auto";
export type EditorSourceRequirement = "content" | "resource" | "content-and-resource" | "none";

export type EditorViewerMatch = {
  document: EditorDocument;
  format: FileFormat;
};

export type EditorViewerContext = EditorViewerMatch & {
  content: string;
  fileUrl?: string | null;
  fileUrlLoading: boolean;
  fileUrlError?: string | null;
  loading: boolean;
  error?: string | null;
  canEdit: boolean;
  hideSourceView: boolean;
  saveMode: EditorSaveMode;
  onSaveContent?: (content: string) => Promise<void>;
};

export type EditorViewer = {
  id: string;
  source: EditorSourceRequirement;
  match: (match: EditorViewerMatch) => boolean;
  allowPreviewContent?: boolean;
  normalizeContent?: (content: string, document: EditorDocument) => string;
  isEditable?: (match: EditorViewerMatch & { content: string }) => boolean;
  render: (context: EditorViewerContext) => ReactNode;
};

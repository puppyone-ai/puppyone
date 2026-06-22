"use client";

import { resolveEditorViewer } from "./viewerRegistry";
import type { EditorDocument, EditorSaveMode } from "./viewerTypes";
import type { FileIconThemeId } from "../file/fileIcons";

export type { EditorDocument, EditorDocumentKind, EditorSaveMode } from "./viewerTypes";

export type PuppyoneEditorHostProps = {
  document: EditorDocument;
  loading?: boolean;
  error?: string | null;
  fileUrlLoading?: boolean;
  fileUrlError?: string | null;
  onSaveContent?: (content: string) => Promise<void>;
  hideSourceView?: boolean;
  fileIconTheme?: FileIconThemeId;
  saveMode?: EditorSaveMode;
};

export function PuppyoneEditorHost({
  document,
  loading = false,
  error = null,
  fileUrlLoading = false,
  fileUrlError = null,
  onSaveContent,
  hideSourceView = false,
  fileIconTheme = "default",
  saveMode = "manual",
}: PuppyoneEditorHostProps) {
  const { viewer, format } = resolveEditorViewer(document);
  const rawContent = viewer.allowPreviewContent === false
    ? document.content ?? ""
    : document.content ?? document.preview ?? "";
  const content = viewer.normalizeContent?.(rawContent, document) ?? rawContent;
  const canEdit = Boolean(onSaveContent && viewer.isEditable?.({ document, format, content }));

  if (viewer.source !== "resource" && loading && !content) {
    return <div className="editor-state">Loading file...</div>;
  }

  if (viewer.source !== "resource" && error && !content) {
    return <div className="editor-state danger">{error}</div>;
  }

  return (
    <>
      {viewer.render({
        document,
        format,
        content,
        fileUrl: document.url,
        fileUrlLoading,
        fileUrlError,
        loading,
        error,
        canEdit,
        hideSourceView,
        fileIconTheme,
        saveMode,
        onSaveContent,
      })}
    </>
  );
}

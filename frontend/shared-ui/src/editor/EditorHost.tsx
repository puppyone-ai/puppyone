import type { DataNode, FileContent } from "../core/types";
import { PuppyoneEditorHost, type EditorSaveMode } from "./PuppyoneEditorHost";

export type EditorHostProps = {
  node: DataNode;
  fileContent?: FileContent | null;
  fileUrl?: string | null;
  fileUrlLoading?: boolean;
  fileUrlError?: string | null;
  loading?: boolean;
  error?: string | null;
  onSaveContent?: (content: string) => Promise<void>;
  hideSourceView?: boolean;
  saveMode?: EditorSaveMode;
};

export function EditorHost({
  node,
  fileContent,
  fileUrl = null,
  fileUrlLoading = false,
  fileUrlError = null,
  loading = false,
  error = null,
  onSaveContent,
  hideSourceView = false,
  saveMode = "manual",
}: EditorHostProps) {
  return (
    <PuppyoneEditorHost
      document={{
        path: node.path,
        name: node.name,
        type: fileContent?.type ?? node.type,
        content: fileContent?.content ?? node.content,
        preview: node.preview,
        mimeType: fileContent?.mimeType,
        url: fileContent?.url ?? fileUrl,
      }}
      loading={loading}
      error={error}
      fileUrlLoading={fileUrlLoading}
      fileUrlError={fileUrlError}
      onSaveContent={onSaveContent}
      hideSourceView={hideSourceView}
      saveMode={saveMode}
    />
  );
}

import type { DataNode, FileContent } from "@puppyone/data-core";
import { PuppyoneEditorHost } from "@puppyone/editor-ui";

export type EditorHostProps = {
  node: DataNode;
  fileContent?: FileContent | null;
  loading?: boolean;
  error?: string | null;
  onSaveContent?: (content: string) => Promise<void>;
};

export function EditorHost({
  node,
  fileContent,
  loading = false,
  error = null,
  onSaveContent,
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
      }}
      loading={loading}
      error={error}
      onSaveContent={onSaveContent}
    />
  );
}

import type { ReactNode } from "react";
import type { DataNode, FileContent } from "../core/types";
import { EditorHost } from "../editor/EditorHost";
import type { EditorSaveMode } from "../editor/PuppyoneEditorHost";
import { FilePreviewIcon } from "../file/fileIcons";

export type FilePreviewProps = {
  node: DataNode | null;
  fileContent?: FileContent | null;
  fileUrl?: string | null;
  fileUrlLoading?: boolean;
  fileUrlError?: string | null;
  loading?: boolean;
  error?: string | null;
  showHeader?: boolean;
  emptySlot?: ReactNode;
  actionSlot?: ReactNode | ((node: DataNode) => ReactNode);
  renderBody?: (node: DataNode) => ReactNode;
  onSaveContent?: (content: string) => Promise<void>;
  hideSourceView?: boolean;
  editorSaveMode?: EditorSaveMode;
};

export function FilePreview({
  node,
  fileContent,
  fileUrl = null,
  fileUrlLoading = false,
  fileUrlError = null,
  loading = false,
  error = null,
  showHeader = true,
  emptySlot,
  actionSlot,
  renderBody,
  onSaveContent,
  hideSourceView = false,
  editorSaveMode = "manual",
}: FilePreviewProps) {
  if (!node) {
    if (emptySlot) return <>{emptySlot}</>;

    return (
      <div className="empty-preview">
        <strong>No file selected</strong>
      </div>
    );
  }

  const actions = typeof actionSlot === "function" ? actionSlot(node) : actionSlot;

  return (
    <div className={`file-preview-shell ${showHeader ? "" : "without-header"}`}>
      {showHeader && (
        <div className="file-preview-header">
          <div className="file-preview-title">
            <FilePreviewIcon
              name={node.name}
              type={node.type}
              size={36}
              snippet={node.preview}
              childrenCount={node.children?.length}
            />
            <div>
              <h2>{node.name}</h2>
              <span>{node.path}</span>
            </div>
          </div>
          <div className="file-preview-actions">
            {node.status && node.status !== "clean" && (
              <span className={`status-pill ${node.status}`}>{node.status}</span>
            )}
            {actions}
          </div>
        </div>
      )}

      <div className="file-preview-body">
        {renderBody ? renderBody(node) : (
          <EditorHost
            node={node}
            fileContent={fileContent}
            fileUrl={fileUrl}
            fileUrlLoading={fileUrlLoading}
            fileUrlError={fileUrlError}
            loading={loading}
            error={error}
            onSaveContent={onSaveContent}
            hideSourceView={hideSourceView}
            saveMode={editorSaveMode}
          />
        )}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import type { DataNode, FileContent } from "@puppyone/data-core";
import { EditorHost } from "./EditorHost";
import { FilePreviewIcon } from "./fileIcons";

export type FilePreviewProps = {
  node: DataNode | null;
  fileContent?: FileContent | null;
  loading?: boolean;
  error?: string | null;
  showHeader?: boolean;
  emptySlot?: ReactNode;
  actionSlot?: ReactNode | ((node: DataNode) => ReactNode);
  renderBody?: (node: DataNode) => ReactNode;
  onSaveContent?: (content: string) => Promise<void>;
};

export function FilePreview({
  node,
  fileContent,
  loading = false,
  error = null,
  showHeader = true,
  emptySlot,
  actionSlot,
  renderBody,
  onSaveContent,
}: FilePreviewProps) {
  if (!node) {
    if (emptySlot) return <>{emptySlot}</>;

    return (
      <div className="empty-preview">
        <div className="empty-preview-icon">
          <FilePreviewIcon name="document.md" type="markdown" size={34} />
        </div>
        <div>
          <strong>No file selected</strong>
          <span>Choose a file from the sidebar to open it here.</span>
        </div>
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
            loading={loading}
            error={error}
            onSaveContent={onSaveContent}
          />
        )}
      </div>
    </div>
  );
}

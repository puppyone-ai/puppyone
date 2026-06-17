import { RotateCcw, Save } from "lucide-react";
import type { DataNode } from "@puppyone/data-core";
import { FilePreviewIcon } from "./fileIcons";

export type FilePreviewProps = {
  node: DataNode | null;
};

export function FilePreview({ node }: FilePreviewProps) {
  if (!node) {
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

  const extension = node.name.includes(".") ? node.name.split(".").pop()?.toUpperCase() : node.type.toUpperCase();

  return (
    <div className="file-preview-shell">
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
          <button className="icon-button" type="button" aria-label="Save snapshot">
            <Save size={15} />
          </button>
          <button className="icon-button" type="button" aria-label="Restore file">
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      <div className="file-preview-body">
        {node.type === "markdown" && <MarkdownPreview content={node.content ?? node.preview ?? ""} />}
        {node.type === "json" && <CodePreview language="JSON" content={node.content ?? "{}"} />}
        {node.type === "file" && node.content && <CodePreview language={extension ?? "TEXT"} content={node.content} />}
        {node.type === "image" && <ImagePreview node={node} />}
        {node.type === "pdf" && <PdfFramePreview node={node} />}
        {node.type === "file" && !node.content && <DocumentPreview node={node} />}
      </div>
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <article className="markdown-preview">
      {content.split("\n").map((line, index) => {
        if (line.startsWith("# ")) return <h1 key={index}>{line.replace("# ", "")}</h1>;
        if (line.startsWith("## ")) return <h2 key={index}>{line.replace("## ", "")}</h2>;
        if (line.startsWith("- ")) return <p key={index} className="bullet-line">{line}</p>;
        if (!line.trim()) return <div key={index} className="preview-spacer" />;
        return <p key={index}>{line}</p>;
      })}
    </article>
  );
}

function CodePreview({ language, content }: { language: string; content: string }) {
  const lines = content.split("\n");
  return (
    <div className="code-preview">
      <div className="code-preview-toolbar">
        <span>{language}</span>
      </div>
      <pre>
        {lines.map((line, index) => (
          <span key={index} className="code-line">
            <span className="line-number">{index + 1}</span>
            <span>{line}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}

function ImagePreview({ node }: { node: DataNode }) {
  return (
    <div className="image-preview">
      <div className="image-preview-name">{node.name}</div>
      <img src="/old-vs-new-world.png" alt={node.name} />
    </div>
  );
}

function PdfFramePreview({ node }: { node: DataNode }) {
  return (
    <div className="pdf-frame-preview">
      <div className="document-page">
        <FilePreviewIcon name={node.name} type={node.type} size={82} snippet={node.preview} />
        <span className="document-title">PDF preview will be rendered from local file access.</span>
      </div>
    </div>
  );
}

function DocumentPreview({ node }: { node: DataNode }) {
  return (
    <div className="document-preview">
      <div className="document-page">
        <FilePreviewIcon name={node.name} type={node.type} size={82} snippet={node.preview} />
        <span className="document-title">{node.content ?? node.preview ?? "Binary file"}</span>
        <span className="doc-line wide" />
        <span className="doc-line" />
        <span className="doc-line short" />
      </div>
    </div>
  );
}

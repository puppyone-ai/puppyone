"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EditorSaveButton, type SaveStatus } from "./EditorSaveButton";
import { PlainTextEditor } from "./PlainTextEditor";

export type EditorDocumentKind =
  | "folder"
  | "markdown"
  | "json"
  | "image"
  | "pdf"
  | "video"
  | "file"
  | string;

export type EditorDocument = {
  path: string;
  name: string;
  type: EditorDocumentKind;
  content?: string | null;
  preview?: string | null;
  mimeType?: string | null;
};

export type PuppyoneEditorHostProps = {
  document: EditorDocument;
  loading?: boolean;
  error?: string | null;
  onSaveContent?: (content: string) => Promise<void>;
};

type EditorMode = "live" | "source";

export function PuppyoneEditorHost({
  document,
  loading = false,
  error = null,
  onSaveContent,
}: PuppyoneEditorHostProps) {
  const content = document.content ?? document.preview ?? "";
  const canEdit = Boolean(onSaveContent && isTextEditable(document, content));
  const extension = getFileExtension(document.name)?.toUpperCase() ?? document.type.toUpperCase();

  if (loading && !content) {
    return <div className="editor-state">Loading file...</div>;
  }

  if (error && !content) {
    return <div className="editor-state danger">{error}</div>;
  }

  if (document.type === "markdown") {
    return (
      <TextEditor
        key={document.path}
        content={content}
        nodeName={document.name}
        defaultMode="live"
        canEdit={canEdit}
        onSaveContent={onSaveContent}
        renderLive={(value) => <MarkdownPreview content={value} />}
      />
    );
  }

  if (document.type === "json") {
    return (
      <TextEditor
        key={document.path}
        content={formatJson(content)}
        nodeName={document.name}
        defaultMode="source"
        canEdit={canEdit}
        onSaveContent={onSaveContent}
        renderLive={(value) => <CodePreview language="JSON" content={value} />}
      />
    );
  }

  if (document.type === "file" && content) {
    return (
      <TextEditor
        key={document.path}
        content={content}
        nodeName={document.name}
        defaultMode="source"
        canEdit={canEdit}
        onSaveContent={onSaveContent}
        renderLive={(value) => <CodePreview language={extension} content={value} />}
      />
    );
  }

  if (document.type === "image") {
    return <ImagePreview document={document} />;
  }

  if (document.type === "pdf") {
    return <DocumentPreview document={document} title="PDF preview will be rendered from file access." />;
  }

  if (document.type === "video") {
    return <DocumentPreview document={document} title="Video preview is not available yet." />;
  }

  return <DocumentPreview document={document} title={content || "Binary file"} />;
}

function TextEditor({
  content,
  nodeName,
  defaultMode,
  canEdit,
  onSaveContent,
  renderLive,
}: {
  content: string;
  nodeName: string;
  defaultMode: EditorMode;
  canEdit: boolean;
  onSaveContent?: (content: string) => Promise<void>;
  renderLive: (content: string) => ReactNode;
}) {
  const [mode, setMode] = useState<EditorMode>(defaultMode);
  const [draft, setDraft] = useState(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = draft !== content;

  useEffect(() => {
    setDraft(content);
    setSaveStatus("clean");
    setSaveError(null);
  }, [content]);

  useEffect(() => {
    if (dirty) setSaveStatus("dirty");
    else if (saveStatus === "dirty" || saveStatus === "error") setSaveStatus("clean");
  }, [dirty, saveStatus]);

  const save = async () => {
    if (!dirty || !onSaveContent) return;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await onSaveContent(draft);
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus((status) => (status === "saved" ? "clean" : status)), 1200);
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="editor-host">
      <div className="editor-save-overlay">
        <EditorSaveButton status={saveStatus} onSave={save} />
      </div>

      {saveError && <div className="editor-inline-error">{saveError}</div>}

      {mode === "live" ? (
        <div className="editor-live-surface">
          {renderLive(draft)}
        </div>
      ) : (
        <PlainTextEditor
          content={draft}
          nodeName={nodeName}
          readOnly={!canEdit}
          onChange={canEdit ? setDraft : undefined}
        />
      )}

      <div className="editor-mode-toggle" aria-label="Editor mode">
        <button
          className={mode === "live" ? "active" : ""}
          type="button"
          onClick={() => setMode("live")}
          title="Live view"
          aria-label="Live view"
        >
          <PencilIcon />
        </button>
        <button
          className={mode === "source" ? "active" : ""}
          type="button"
          onClick={() => setMode("source")}
          title="Source code"
          aria-label="Source code"
        >
          <CodeIcon />
        </button>
      </div>
    </section>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="milkdown-editor puppy-markdown-preview">
      <article className="editor">
        {blocks.length === 0 ? (
          <p className="markdown-empty-placeholder">Start writing...</p>
        ) : (
          blocks.map((block, index) => renderMarkdownBlock(block, index))
        )}
      </article>
    </div>
  );
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string; content: string }
  | { type: "list"; ordered: boolean; items: MarkdownListItem[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" };

type MarkdownListItem = {
  text: string;
  checked?: boolean;
};

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = /^```(\w+)?\s*$/.exec(trimmed);
    if (fenceMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fenceMatch[1] ?? "", content: codeLines.join("\n") });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    if (looksLikeTable(lines, index)) {
      const header = splitTableRow(lines[index]);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const listMatch = parseListLine(line);
    if (listMatch) {
      const ordered = listMatch.ordered;
      const items: MarkdownListItem[] = [];
      while (index < lines.length) {
        const item = parseListLine(lines[index]);
        if (!item || item.ordered !== ordered) break;
        items.push({ text: item.text, checked: item.checked });
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderMarkdownBlock(block: MarkdownBlock, index: number): ReactNode {
  if (block.type === "heading") {
    const Heading = `h${Math.min(block.level, 6)}` as keyof JSX.IntrinsicElements;
    return <Heading key={index}>{renderInlineMarkdown(block.text)}</Heading>;
  }

  if (block.type === "paragraph") {
    return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
  }

  if (block.type === "blockquote") {
    return (
      <blockquote key={index}>
        {block.text.split("\n").map((line, lineIndex) => (
          <p key={lineIndex}>{renderInlineMarkdown(line)}</p>
        ))}
      </blockquote>
    );
  }

  if (block.type === "code") {
    return (
      <pre key={index} data-language={block.language || undefined}>
        <code>{block.content || " "}</code>
      </pre>
    );
  }

  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List key={index}>
        {block.items.map((item, itemIndex) => (
          <li
            key={itemIndex}
            data-item-type={item.checked === undefined ? undefined : "task"}
            data-checked={item.checked === undefined ? undefined : String(item.checked)}
          >
            <p>{renderInlineMarkdown(item.text)}</p>
          </li>
        ))}
      </List>
    );
  }

  if (block.type === "table") {
    return (
      <table key={index}>
        <thead>
          <tr>
            {block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInlineMarkdown(cell)}</th>)}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.header.map((_, cellIndex) => (
                <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return <hr key={index} />;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) tokens.push(text.slice(cursor, match.index));
    const value = match[0];
    const key = `${match.index}:${value}`;

    if (value.startsWith("`")) {
      tokens.push(<code key={key}>{value.slice(1, -1)}</code>);
    } else if (value.startsWith("**")) {
      tokens.push(<strong key={key}>{renderInlineMarkdown(value.slice(2, -2))}</strong>);
    } else if (value.startsWith("~~")) {
      tokens.push(<del key={key}>{renderInlineMarkdown(value.slice(2, -2))}</del>);
    } else if (value.startsWith("*")) {
      tokens.push(<em key={key}>{renderInlineMarkdown(value.slice(1, -1))}</em>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
      if (linkMatch) {
        tokens.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {renderInlineMarkdown(linkMatch[1])}
          </a>,
        );
      }
    }

    cursor = match.index + value.length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) tokens.push(text.slice(cursor));
  return tokens;
}

function looksLikeTable(lines: string[], index: number): boolean {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseListLine(line: string): { ordered: boolean; text: string; checked?: boolean } | null {
  const taskMatch = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line);
  if (taskMatch) {
    return { ordered: false, text: taskMatch[2].trim(), checked: taskMatch[1].toLowerCase() === "x" };
  }

  const unorderedMatch = /^\s*[-*+]\s+(.+)$/.exec(line);
  if (unorderedMatch) return { ordered: false, text: unorderedMatch[1].trim() };

  const orderedMatch = /^\s*\d+[.)]\s+(.+)$/.exec(line);
  if (orderedMatch) return { ordered: true, text: orderedMatch[1].trim() };

  return null;
}

function isBlockStart(lines: string[], index: number): boolean {
  const trimmed = lines[index].trim();
  return Boolean(
    /^```/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    /^(#{1,6})\s+/.test(trimmed) ||
    trimmed.startsWith(">") ||
    looksLikeTable(lines, index) ||
    parseListLine(lines[index]),
  );
}

function CodePreview({ language, content }: { language: string; content: string }) {
  return (
    <div className="code-preview">
      <div className="code-preview-toolbar">
        <span>{language}</span>
      </div>
      <pre>
        {content.split("\n").map((line, index) => (
          <span key={index} className="code-line">
            <span className="line-number">{index + 1}</span>
            <span>{line || " "}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}

function ImagePreview({ document }: { document: EditorDocument }) {
  const imageSource = document.content ?? document.preview ?? null;
  return (
    <div className="image-preview">
      <div className="image-preview-name">{document.name}</div>
      {imageSource ? (
        <img src={imageSource} alt={document.name} />
      ) : (
        <DocumentPreview document={document} title="Image preview is not available yet." />
      )}
    </div>
  );
}

function DocumentPreview({
  document,
  title,
}: {
  document: EditorDocument;
  title: string;
}) {
  return (
    <div className="document-preview">
      <div className="document-page">
        <DocumentIcon />
        <span className="document-title">{title}</span>
        <span className="doc-line wide" />
        <span className="doc-line" />
        <span className="doc-line short" />
        <span className="sr-only">{document.name}</span>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="82" height="82" viewBox="0 0 72 72" fill="none" aria-hidden>
      <path d="M18 10h26l10 10v42H18V10z" fill="var(--po-file-icon-body)" stroke="var(--po-file-icon-stroke)" />
      <path d="M44 10v12h10" fill="var(--po-file-icon-fold)" stroke="var(--po-file-icon-stroke)" />
      <path d="M26 34h20M26 42h20M26 50h13" stroke="var(--po-text-disabled)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function isTextEditable(document: EditorDocument, content: string): boolean {
  if (document.type === "markdown" || document.type === "json") return true;
  if (!content) return false;
  if (document.type !== "file") return false;
  return /\.(txt|md|mdx|json|jsonc|yaml|yml|toml|csv|tsv|log|env|js|jsx|ts|tsx|css|html|xml)$/i.test(document.name);
}

function formatJson(content: string): string {
  if (!content.trim()) return content;
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function getFileExtension(name: string): string | null {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return name.slice(index + 1);
}

import type { EditorViewerContext } from "../viewerTypes";

export function HtmlViewer({
  document,
  content,
  fileUrl,
  fileUrlLoading,
  fileUrlError,
  loading,
  error,
}: EditorViewerContext) {
  if (loading && !content && !fileUrl) return <div className="editor-state">Loading HTML...</div>;
  if (error && !content && !fileUrl) return <div className="editor-state danger">{error}</div>;
  if (content && fileUrlLoading && !fileUrl) return <div className="editor-state">Loading preview...</div>;
  if (fileUrlLoading && !content && !fileUrl) return <div className="editor-state">Loading preview...</div>;
  if (fileUrlError && !content && !fileUrl) {
    return <div className="editor-state danger">Failed to load HTML: {fileUrlError}</div>;
  }

  return (
    <div className="native-preview native-preview-framed">
      <HtmlPreviewFrame
        path={document.path}
        title={document.name}
        content={content || null}
        fileUrl={fileUrl}
      />
    </div>
  );
}

function HtmlPreviewFrame({
  path,
  title,
  content,
  fileUrl,
}: {
  path: string;
  title: string;
  content?: string | null;
  fileUrl?: string | null;
}) {
  const useFileUrl = Boolean(fileUrl);
  const frameKey = [
    path,
    fileUrl ?? "",
    content ? `${content.length}:${hashString(content)}` : "",
  ].join("|");

  return (
    <iframe
      key={frameKey}
      className="native-preview-frame"
      title={title}
      sandbox="allow-scripts allow-popups"
      referrerPolicy="no-referrer"
      src={useFileUrl ? fileUrl ?? undefined : undefined}
      srcDoc={!useFileUrl && content ? buildSandboxedHtml(content, fileUrl) : undefined}
    />
  );
}

const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob: https: puppyone-local:",
  "media-src data: blob: https: puppyone-local:",
  "style-src 'unsafe-inline' https: puppyone-local:",
  "font-src data: https: puppyone-local:",
  "script-src 'unsafe-inline' https: puppyone-local:",
  "connect-src https: puppyone-local:",
  "object-src 'none'",
  "base-uri puppyone-local:",
  "form-action 'none'",
].join("; ");

function buildSandboxedHtml(rawHtml: string, baseHref?: string | null): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;
  const base = baseHref
    ? `<base href="${escapeHtmlAttribute(baseHref)}" target="_blank">`
    : '<base target="_blank">';

  if (/<head[\s>]/i.test(rawHtml)) {
    return rawHtml.replace(/<head([^>]*)>/i, `<head$1>${csp}${base}`);
  }

  if (/<html[\s>]/i.test(rawHtml)) {
    return rawHtml.replace(/<html([^>]*)>/i, `<html$1><head>${csp}${base}</head>`);
  }

  return `<!doctype html><html><head>${csp}${base}</head><body>${rawHtml}</body></html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return String(hash >>> 0);
}

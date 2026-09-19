import { getHtmlPreviewInteractionCss } from "../../htmlPreviewInteraction";
import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes as Tree } from "parse5";
import type { MarkdownHtmlTrustMode } from "../../registry/viewerTypes";
import { useVisibleFrameReadiness } from "../shared/useVisibleFrameReadiness";
import { useEffect, useMemo, useState } from "react";
import { useEditorPreviewServices } from "../../preview-services/EditorPreviewServices";

export function HtmlPreviewFrame({
  path,
  title,
  content,
  fileUrl,
  htmlTrustMode,
}: {
  path: string;
  title: string;
  content?: string | null;
  fileUrl?: string | null;
  htmlTrustMode: MarkdownHtmlTrustMode;
}) {
  const policy = getHtmlPreviewPolicy(htmlTrustMode);
  const hasContentSnapshot = content !== null && content !== undefined;
  const useFileUrl = Boolean(fileUrl && !hasContentSnapshot);
  const frameKey = [
    path,
    htmlTrustMode,
    fileUrl ?? "",
    hasContentSnapshot ? `${content.length}:${hashString(content)}` : "",
  ].join("|");
  const frameReadiness = useVisibleFrameReadiness(frameKey);
  const projectionPort = useEditorPreviewServices().services?.documentProjection;
  const projection = useMemo(() => hasContentSnapshot ? buildHtmlPreviewDocument(content, fileUrl, getHtmlPreviewPolicy(htmlTrustMode)) : null,
    [content, fileUrl, htmlTrustMode, hasContentSnapshot]);
  const [resource, setResource] = useState<{ key: string; url: string | null } | null>(null);
  const useProjection = !!projectionPort && projection !== null && projection.length <= 2 * 1024 * 1024 && /\.html?$/i.test(path);
  useEffect(() => {
    if (!useProjection || !projectionPort || projection === null) return;
    const abort = new AbortController();
    let release: (() => Promise<void>) | undefined;
    // Ordinary previews retain their existing link/interaction policy through the iframe sandbox.
    void projectionPort.create(path, projection, abort.signal, { interactive: true }).then(async (lease) => {
      if (abort.signal.aborted) { await lease.close(); return; }
      release = lease.close;
      setResource({ key: frameKey, url: lease.url });
    }).catch(() => { if (!abort.signal.aborted) setResource({ key: frameKey, url: null }); });
    return () => { abort.abort(); void release?.().catch(() => undefined); };
  }, [projectionPort, projection, useProjection, path, frameKey, htmlTrustMode]);
  const resourceReady = resource?.key === frameKey;
  const projectionUrl = resourceReady ? resource.url : undefined;

  return (
    <iframe
      key={frameKey}
      className="native-preview-frame"
      data-html-trust-mode={htmlTrustMode}
      title={title}
      sandbox={policy.sandbox}
      referrerPolicy="no-referrer"
      src={projectionUrl ?? (useFileUrl ? fileUrl ?? undefined : undefined)}
      srcDoc={!useFileUrl && !projectionUrl && (!useProjection || resourceReady) ? projection ?? undefined : undefined}
      aria-busy={!frameReadiness.ready}
      onLoad={frameReadiness.onFrameLoad}
    />
  );
}

type HtmlPreviewPolicy = {
  sandbox: string;
  csp: string | null;
};

const SAFE_HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob: https: puppyone-local:",
  "media-src data: blob: https: puppyone-local:",
  "style-src 'unsafe-inline' https: puppyone-local:",
  "font-src data: https: puppyone-local:",
  "script-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "base-uri https: puppyone-local:",
  "form-action 'none'",
].join("; ");

function getHtmlPreviewPolicy(htmlTrustMode: MarkdownHtmlTrustMode): HtmlPreviewPolicy {
  if (htmlTrustMode === "localTrusted") {
    return {
      sandbox: "allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts",
      csp: null,
    };
  }

  return {
    sandbox: "allow-popups allow-popups-to-escape-sandbox",
    csp: SAFE_HTML_PREVIEW_CSP,
  };
}

export function buildHtmlPreviewDocument(rawHtml: string, baseHref: string | null | undefined, policy: HtmlPreviewPolicy): string {
  const tree = parse(rawHtml);
  const html = tree.childNodes.find((node): node is Tree.Element => "tagName" in node && node.tagName === "html")!;
  const head = html.childNodes.find((node): node is Tree.Element => "tagName" in node && node.tagName === "head")!;
  let originalBase: string | undefined;
  const pending: Tree.ParentNode[] = [tree];
  while (pending.length) {
    const parent = pending.pop()!;
    parent.childNodes = parent.childNodes.filter((node) => {
      if (policy.csp && "tagName" in node && node.tagName === "meta"
        && node.attrs.some((attr) => attr.name === "http-equiv" && attr.value.toLowerCase() === "refresh")) return false;
      if ("tagName" in node && node.tagName === "base") {
        originalBase ??= node.attrs.find((attr) => attr.name === "href")?.value;
        return false;
      }
      return true;
    });
    // Walk document order: HTML uses the first base href, including malformed documents.
    for (let index = parent.childNodes.length - 1; index >= 0; index--) {
      const node = parent.childNodes[index]!;
      if ("childNodes" in node) pending.push(node);
    }
  }
  let resolvedBase = baseHref;
  if (originalBase !== undefined) {
    try { resolvedBase = new URL(originalBase, baseHref ?? undefined).href; } catch { /* No valid resource base is available. */ }
  }
  const csp = policy.csp
    ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy.csp)}">`
    : "";
  const base = resolvedBase
    ? `<base href="${escapeHtmlAttribute(resolvedBase)}" target="_blank">`
    : '<base target="_blank">';
  const interactionStyle = `<style id="puppyone-html-preview-interaction">${getHtmlPreviewInteractionCss("body")}</style>`;

  head.childNodes.unshift(...parseFragment(`${csp}${base}${interactionStyle}`).childNodes);
  return serialize(tree);
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

import { getHtmlPreviewInteractionCss } from "../../htmlPreviewInteraction";
import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes as Tree } from "parse5";
import type { MarkdownHtmlTrustMode } from "../../registry/viewerTypes";
import { useVisibleFrameReadiness } from "../shared/useVisibleFrameReadiness";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorPreviewServices } from "../../preview-services/EditorPreviewServices";
import { resolveFileFormat } from "../../../core/fileFormats";
import { htmlPageViewportScript, useHtmlPageViewport, type HtmlPageViewport } from "./htmlPageViewport";

export function HtmlPreviewFrame({
  path,
  title,
  content,
  fileUrl,
  htmlTrustMode,
  interactive = false,
  viewportState,
}: {
  path: string;
  title: string;
  content?: string | null;
  fileUrl?: string | null;
  htmlTrustMode: MarkdownHtmlTrustMode;
  interactive?: boolean;
  viewportState?: HtmlPageViewport;
}) {
  const policy = getHtmlPreviewPolicy(htmlTrustMode, interactive);
  const frame = useRef<HTMLIFrameElement>(null);
  const [viewportChannel] = useState(() => crypto.randomUUID());
  const hasContentSnapshot = content !== null && content !== undefined;
  const frameKey = [
    path,
    htmlTrustMode,
    String(interactive),
    fileUrl ?? "",
    hasContentSnapshot ? `${content.length}:${hashString(content)}` : "",
  ].join("|");
  const projectionPort = useEditorPreviewServices().services?.documentProjection;
  const projection = useMemo(() => hasContentSnapshot ? buildHtmlPreviewDocument(content, fileUrl,
    getHtmlPreviewPolicy(htmlTrustMode, interactive), interactive ? viewportChannel : undefined) : null,
    [content, fileUrl, htmlTrustMode, hasContentSnapshot, interactive, viewportChannel]);
  const [resource, setResource] = useState<{ key: string; url: string | null } | null>(null);
  const useProjection = !!projectionPort && projection !== null && projection.length <= 2 * 1024 * 1024
    && resolveFileFormat({ name: path }).defaultViewer === "html-artifact";
  useEffect(() => {
    if (!useProjection || !projectionPort || projection === null) return;
    const abort = new AbortController();
    let release: (() => Promise<void>) | undefined;
    // Ordinary previews retain their existing link/interaction policy through the iframe sandbox.
    void projectionPort.create(path, projection, abort.signal, { interactive: true, baseHref: readHtmlBaseHref(content ?? "") }).then(async (lease) => {
      if (abort.signal.aborted) { await lease.close(); return; }
      release = lease.close;
      setResource({ key: frameKey, url: lease.url });
    }).catch(() => { if (!abort.signal.aborted) setResource({ key: frameKey, url: null }); });
    return () => { abort.abort(); void release?.().catch(() => undefined); };
  }, [projectionPort, projection, useProjection, path, frameKey, htmlTrustMode, content]);
  const resourceReady = resource?.key === frameKey;
  const projectionUrl = resourceReady ? resource.url : undefined;
  const waitingForProjection = useProjection && !resourceReady;
  const visibleFrameKey = `${frameKey}|${projectionUrl ?? String(waitingForProjection)}`;
  const frameReadiness = useVisibleFrameReadiness(visibleFrameKey);
  const onFrameLoad = useHtmlPageViewport({ frame, viewportState, channel: viewportChannel,
    enabled: interactive, waiting: waitingForProjection, onFrameLoad: frameReadiness.onFrameLoad });
  const frameSource = resolveFrameSource({ fileUrl, hasContentSnapshot, projection,
    projectionUrl, waiting: waitingForProjection });

  return (
    <iframe
      ref={frame}
      key={visibleFrameKey}
      className="native-preview-frame"
      data-html-trust-mode={htmlTrustMode}
      data-html-interactive={interactive}
      aria-label={title}
      sandbox={policy.sandbox}
      referrerPolicy="no-referrer"
      {...frameSource}
      aria-busy={waitingForProjection || !frameReadiness.ready}
      onLoad={onFrameLoad}
    />
  );
}

function resolveFrameSource({ fileUrl, hasContentSnapshot, projection, projectionUrl, waiting }: {
  fileUrl?: string | null;
  hasContentSnapshot: boolean;
  projection: string | null;
  projectionUrl?: string | null;
  waiting: boolean;
}) {
  const src = projectionUrl ?? (!hasContentSnapshot ? fileUrl ?? undefined : undefined);
  const srcDoc = hasContentSnapshot && !projectionUrl && !waiting ? projection ?? undefined : undefined;
  return { src, srcDoc };
}

function readHtmlBaseHref(source: string): string | null {
  const pending: Tree.ParentNode[] = [parse(source)];
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node && node.tagName === "base") return node.attrs.find((attribute) => attribute.name === "href")?.value ?? null;
    for (const child of [...node.childNodes].reverse()) if ("childNodes" in child) pending.push(child);
  }
  return null;
}

type HtmlPreviewPolicy = {
  sandbox: string;
  csp: string | null;
  linkTarget?: "_self" | "_blank";
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

export function getHtmlPreviewPolicy(htmlTrustMode: MarkdownHtmlTrustMode, interactive = false): HtmlPreviewPolicy {
  if (interactive) {
    return {
      sandbox: "allow-scripts allow-forms allow-modals allow-downloads allow-popups",
      csp: ["default-src 'none'", "script-src 'unsafe-inline' https: puppyone-local:",
        "style-src 'unsafe-inline' https: puppyone-local:", "img-src data: blob: https: puppyone-local:",
        "media-src data: blob: https: puppyone-local:", "font-src data: https: puppyone-local:",
        "connect-src https: puppyone-local:", "object-src 'none'", "frame-src 'none'",
        "base-uri https: puppyone-local:", "form-action https:"].join("; "),
      linkTarget: "_self",
    };
  }
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

export function buildHtmlPreviewDocument(rawHtml: string, baseHref: string | null | undefined, policy: HtmlPreviewPolicy, viewportChannel?: string): string {
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
  if (policy.csp && resolvedBase) {
    try {
      if (!["https:", "puppyone-local:"].includes(new URL(resolvedBase).protocol)) resolvedBase = null;
    } catch { resolvedBase = null; }
  }
  const csp = policy.csp
    ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy.csp)}">`
    : "";
  const target = policy.linkTarget ?? "_blank";
  const base = resolvedBase
    ? `<base href="${escapeHtmlAttribute(resolvedBase)}" target="${target}">`
    : `<base target="${target}">`;
  const interactionStyle = `<style id="puppyone-html-preview-interaction">${getHtmlPreviewInteractionCss("body")}</style>`;

  head.childNodes.unshift(...parseFragment(`${csp}${base}${interactionStyle}`).childNodes);
  if (viewportChannel) {
    const body = html.childNodes.find((node): node is Tree.Element => "tagName" in node && node.tagName === "body")!;
    body.childNodes.push(...parseFragment(htmlPageViewportScript(viewportChannel)).childNodes);
  }
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

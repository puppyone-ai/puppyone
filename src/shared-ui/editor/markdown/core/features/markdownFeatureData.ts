/**
 * Pure data contracts shared by the Markdown kernel and built-in features.
 *
 * These types deliberately contain no parser, DOM, CodeMirror view, broker,
 * or persistence behavior. A feature owns how the data is produced and
 * rendered; the kernel owns the discriminated contracts that connect those
 * phases without importing a concrete feature implementation.
 */

export type MarkdownCodeSourceReference = {
  path: string;
  startLine: number;
  endLine: number;
};

export type MarkdownTableAlignment = "left" | "center" | "right" | null;

export type MarkdownTableCell = {
  text: string;
  from: number;
  to: number;
  editable: boolean;
};

export type MarkdownTableRow = {
  cells: MarkdownTableCell[];
  header: boolean;
  lineTo: number;
};

export type MarkdownHtmlAttribute = {
  name: string;
  value: string | null;
  from: number;
  to: number;
};

export type MarkdownInlineHtmlStatus = "complete" | "incomplete" | "malformed";

export type MarkdownInlineHtml = {
  kind: "inlineHtml";
  from: number;
  to: number;
  tagName: string;
  openingMarker: { from: number; to: number };
  contentRange: { from: number; to: number } | null;
  closingMarker: { from: number; to: number } | null;
  attributes: readonly MarkdownHtmlAttribute[];
  status: MarkdownInlineHtmlStatus;
  containerFrom: number;
  containerTo: number;
};

export type MarkdownHtmlBlockMetrics = {
  logicalItems: number;
  estimatedDomNodes: number;
  nestingDepth: number;
  assetCount: number;
};

export type MarkdownHtmlBlockStatus =
  | "complete"
  | "incomplete"
  | "malformed"
  | "unsupported";

export type MarkdownHtmlBlockRenderProfile =
  | "safe-block"
  | "safe-block-with-media"
  | "external-web-embed";

export type MarkdownMdxComponentStatus = "complete" | "malformed" | "unsupported";

export type MarkdownMdxTab = {
  label: string;
  content: string;
};

export type MarkdownMdxComponentModel = {
  kind: "tabs" | "unknown";
  name: string;
  status: MarkdownMdxComponentStatus;
  source: string;
  tabs: readonly MarkdownMdxTab[];
  diagnostic: string | null;
  metrics: MarkdownHtmlBlockMetrics;
};

export type MarkdownMediaReferenceKind = "markdown-path" | "wiki-target";
export type MarkdownImageDisplayMode = "inline" | "block";

export type MarkdownVideoSource = {
  href: string;
  type: string | null;
  referenceKind: MarkdownMediaReferenceKind;
};

export type MarkdownVideoModel = {
  sources: readonly MarkdownVideoSource[];
  title: string | null;
  poster: {
    href: string;
    referenceKind: MarkdownMediaReferenceKind;
  } | null;
  width: number | null;
  height: number | null;
  loop: boolean;
  muted: boolean;
  playsInline: boolean;
  preload: "none" | "metadata";
};

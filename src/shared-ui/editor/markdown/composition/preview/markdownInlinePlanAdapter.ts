import type {
  MarkdownInlinePreviewOptions,
  MarkdownInlinePreviewRenderer,
} from "../../shared/preview/markdownInlinePreviewPort";
import { renderMarkdownInlineInto } from "./markdownInlineRenderer";

/**
 * Broker-only options for the isolated-string preview adapter. This adapter
 * does not consume the document's range-indexed `MarkdownElementPlan`: table
 * cells do not own an EditorState or syntax tree. It shares the canonical HTML,
 * URL, and broker policies while its lightweight Markdown tokenizer remains an
 * explicit compatibility boundary.
 */
export type { MarkdownInlinePreviewOptions } from "../../shared/preview/markdownInlinePreviewPort";

/** @deprecated Prefer the contract-accurate MarkdownInlinePreviewOptions name. */
export type MarkdownInlinePlanOptions = MarkdownInlinePreviewOptions;

/**
 * Public isolated-string preview entry for table cells and similar surfaces.
 * Images require the AssetBroker wrapper and all raw/Markdown anchors remain
 * inert unless a LinkBroker-backed `openHref` is supplied. Unsafe hrefs are
 * rejected by the shared URL authority inside the renderer.
 */
export const renderMarkdownInlineFromSharedPolicy: MarkdownInlinePreviewRenderer = (
  target: Node,
  source: string,
  options: MarkdownInlinePreviewOptions = {},
): void => {
  renderMarkdownInlineInto(target, source, {
    markdownLinkGraph: options.markdownLinkGraph ?? null,
    sourcePath: options.sourcePath,
    onLayoutChange: options.onLayoutChange,
    resolveAssetUrl: options.resolveAssetUrl,
    openHref: options.openHref,
    t: options.t,
  });
};

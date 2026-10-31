import type { MessageFormatter } from "@puppyone/localization/core";
import type { MarkdownLinkCommands, MarkdownLinkGraph } from "../../../registry/viewerTypes";

/**
 * Narrow port for rendering an isolated Markdown string (for example a table
 * cell). It is intentionally separate from the document render-plan pipeline:
 * callers have no EditorState or source ranges, and all authority is supplied
 * explicitly through broker-backed callbacks.
 */
export type MarkdownInlinePreviewOptions = {
  markdownLinkGraph?: MarkdownLinkGraph | null;
  markdownLinkCommands?: MarkdownLinkCommands;
  sourcePath?: string;
  onLayoutChange?: () => void;
  resolveAssetUrl?: (
    documentPath: string,
    href: string,
    signal?: AbortSignal,
  ) => string | Promise<string | null> | null;
  openHref?: (href: string) => void;
  t?: MessageFormatter;
};

export type MarkdownInlinePreviewRenderer = (
  target: Node,
  source: string,
  options?: MarkdownInlinePreviewOptions,
) => void;

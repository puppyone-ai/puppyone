import type { MarkdownLinkGraph } from "../../../registry/viewerTypes";
import { findWikiLinkTokens } from "./wikiLinkModel";

/**
 * Graph-dependent identity for isolated-string previews (table cells / tabs).
 * Ordinary Markdown anchors resolve at activation time; wiki labels and wiki
 * media depend on graph queries during rendering. An unrelated Explorer load
 * must not remount these surfaces and restart their layout/media lifecycles.
 * Scan every source fragment, including rows outside a windowed table viewport.
 */
export function getInlinePreviewLinkIdentity(
  sources: Iterable<string>,
  graph: MarkdownLinkGraph | null,
  documentPath: string,
): string {
  const targets = new Set<string>();
  for (const source of sources) {
    // Common table line breaks carry no link dependency. Neither literal
    // brackets nor entity-decoded brackets can appear in these fragments.
    if (!source.includes("[") && !source.includes("&")) continue;
    // Sanitized HTML can decode entities into Markdown text. Keep conservative
    // invalidation for that separate parsing boundary rather than duplicating it.
    if (source.includes("<")) return `html:${graph?.revision ?? "none"}`;
    for (const token of findWikiLinkTokens(source)) targets.add(token.target);
  }
  return JSON.stringify([...targets].map((target) => (
    graph?.resolveWikiLink(documentPath, target) ?? null
  )));
}

import type { MarkdownLinkGraph } from "../../../registry/viewerTypes";
import { resolveMarkdownMediaReference } from "../media/markdownMediaReference";
import type { MarkdownVideoModel } from "./markdownVideoModel";

export type ResolvedMarkdownVideoModel = Omit<MarkdownVideoModel, "sources" | "poster"> & {
  fallbackLabel: string;
  sources: readonly {
    href: string;
    authoredHref: string;
    type: string | null;
  }[];
  poster: {
    href: string;
    authoredHref: string;
  } | null;
};

export function resolveMarkdownVideoModel(
  model: MarkdownVideoModel,
  documentPath: string,
  linkGraph: MarkdownLinkGraph | null,
): ResolvedMarkdownVideoModel {
  return {
    ...model,
    fallbackLabel: model.title ?? model.sources[0]?.href ?? "",
    sources: model.sources.flatMap((source) => {
      const href = resolveMarkdownMediaReference(
        documentPath,
        source.href,
        source.referenceKind,
        linkGraph,
      );
      return href ? [{ href, authoredHref: source.href, type: source.type }] : [];
    }),
    poster: model.poster
      ? resolvePoster(model, documentPath, linkGraph)
      : null,
  };
}

function resolvePoster(
  model: MarkdownVideoModel,
  documentPath: string,
  linkGraph: MarkdownLinkGraph | null,
): ResolvedMarkdownVideoModel["poster"] {
  if (!model.poster) return null;
  const href = resolveMarkdownMediaReference(
    documentPath,
    model.poster.href,
    model.poster.referenceKind,
    linkGraph,
  );
  return href ? { href, authoredHref: model.poster.href } : null;
}

import type { EditorState } from "@codemirror/state";
import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import type { MarkdownImageDisplayMode } from "../../core/features/markdownFeatureData";
import { getObsidianMediaEmbedNodesInRange } from "../media/markdownMediaSyntaxNode";
import { isObsidianImageEmbedSize } from "../media/obsidianMediaEmbed";
import { resolveMarkdownMediaReference } from "../media/markdownMediaReference";
import { ImagePreviewWidget } from "./imagePreviewWidget";
import { compileImageElementPlan } from "./imagePlan";
import { parseMarkdownImageSize, splitMarkdownImageAlt, type MarkdownImageSize } from "./markdownImageSize";
import { findStandardMarkdownImageTokens, type MarkdownImageToken } from "./markdownImageModel";

export const imageFeature = defineMarkdownFeature({
  id: "image",
  semanticKinds: ["image"],
  inlineWidgetKinds: ["image"],
  blockWidgetKinds: [],
  collectRange(state, from, to) {
    return getObsidianMediaEmbedNodesInRange(state, from, to, "image").map((token) => (
      createImageElement({
        from: token.from,
        to: token.to,
        alt: token.alias && !isObsidianImageEmbedSize(token.alias)
          ? token.alias
          : token.target,
        href: token.target,
        title: null,
        referenceKind: "wiki-target",
      }, getImageDisplayModeFromState(state, token.from, token.to), parseMarkdownImageSize(token.alias))
    ));
  },
  collectLine(line) {
    return findStandardMarkdownImageTokens(line.text).map((token) => {
      const { alt, size } = splitMarkdownImageAlt(token.alt);
      return createImageElement(
        {
          ...token,
          alt,
          from: line.from + token.from,
          to: line.from + token.to,
        },
        getImageDisplayModeOnLine(line.text, token.from, token.to),
        size,
      );
    });
  },
  compile(element) {
    return compileImageElementPlan(element);
  },
  createInlineWidget(plan, context) {
    const resolvedSource = resolveMarkdownMediaReference(
      context.documentPath,
      plan.atom.href,
      plan.atom.referenceKind,
      context.markdownLinkGraph,
    );
    return new ImagePreviewWidget(
      plan.sourceRange.from,
      plan.sourceRange.to,
      plan.atom.alt,
      plan.atom.href,
      plan.atom.title,
      context.documentPath,
      resolvedSource,
      plan.atom.displayMode,
      plan.atom.size,
    );
  },
});

function createImageElement(
  token: MarkdownImageToken,
  displayMode: MarkdownImageDisplayMode,
  size: MarkdownImageSize | null,
) {
  return {
    kind: "image" as const,
    from: token.from,
    to: token.to,
    markerRanges: [{ from: token.from, to: token.to }],
    contentRange: { from: token.from, to: token.to },
    blockData: {
      kind: "image" as const,
      alt: token.alt,
      href: token.href,
      title: token.title,
      referenceKind: token.referenceKind,
      displayMode,
      size,
    },
  };
}

function getImageDisplayModeFromState(
  state: EditorState,
  from: number,
  to: number,
): MarkdownImageDisplayMode {
  const line = state.doc.lineAt(from);
  if (to > line.to) return "inline";
  return getImageDisplayModeOnLine(
    line.text,
    from - line.from,
    to - line.from,
  );
}

function getImageDisplayModeOnLine(
  lineText: string,
  from: number,
  to: number,
): MarkdownImageDisplayMode {
  return lineText.slice(0, from).trim().length === 0
    && lineText.slice(to).trim().length === 0
    ? "block"
    : "inline";
}

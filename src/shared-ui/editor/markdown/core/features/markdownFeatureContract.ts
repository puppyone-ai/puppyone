import { Facet, type EditorState, type Extension } from "@codemirror/state";
import type { WidgetType } from "@codemirror/view";
import type { MarkdownConfig } from "@lezer/markdown";
import type {
  MarkdownAssetUrlResolver,
  MarkdownHtmlTrustMode,
  MarkdownLinkGraph,
} from "../../../registry/viewerTypes";
import type {
  BlockEmbedModel,
  InlineAtomModel,
  MarkdownBlockAtomPlan,
  MarkdownElementPlan,
  MarkdownInlineAtomPlan,
} from "../plans/markdownPlanTypes";
import type { MarkdownDocumentProfile } from "../plans/markdownBlockExecution";
import type {
  MarkdownElement,
  MarkdownElementKind,
  MarkdownElementOf,
} from "../syntax/markdownElementTypes";

export type MarkdownFeatureSourceLine = Readonly<{
  from: number;
  to: number;
  number: number;
  text: string;
}>;

export type MarkdownFeatureBlockMatch<
  ElementKind extends MarkdownElementKind = MarkdownElementKind,
> = Readonly<{
  element: MarkdownElementOf<ElementKind>;
  nextLineNumber: number;
}>;

export type MarkdownFeatureCompileContext = Readonly<{
  documentProfile: MarkdownDocumentProfile;
  assetBrokerAvailable: boolean;
}>;

export type MarkdownFeatureWidgetContext = Readonly<{
  htmlTrustMode: MarkdownHtmlTrustMode;
  markdownLinkGraph: MarkdownLinkGraph | null;
  documentPath: string;
  markdownAssetUrlResolver: MarkdownAssetUrlResolver | null;
}>;

export type MarkdownFeatureDefinition<
  ElementKind extends MarkdownElementKind = MarkdownElementKind,
  InlineWidgetKind extends InlineAtomModel["kind"] = never,
  BlockWidgetKind extends BlockEmbedModel["kind"] = never,
> = Readonly<{
  id: string;
  semanticKinds: readonly ElementKind[];
  inlineWidgetKinds: readonly InlineWidgetKind[];
  blockWidgetKinds: readonly BlockWidgetKind[];
  parserExtensions?: readonly MarkdownConfig[];
  livePreviewExtensions?: readonly Extension[];
  collectRange?: (
    state: EditorState,
    from: number,
    to: number,
  ) => readonly MarkdownElementOf<ElementKind>[];
  collectBlock?: (
    state: EditorState,
    line: MarkdownFeatureSourceLine,
  ) => MarkdownFeatureBlockMatch<ElementKind> | null;
  collectLine?: (line: MarkdownFeatureSourceLine) => readonly MarkdownElementOf<ElementKind>[];
  compile?: (
    element: MarkdownElementOf<ElementKind>,
    context: MarkdownFeatureCompileContext,
  ) => MarkdownElementPlan;
  createInlineWidget?: (
    plan: MarkdownInlineAtomPlan<InlineWidgetKind>,
    context: MarkdownFeatureWidgetContext,
  ) => WidgetType;
  createBlockWidget?: (
    plan: MarkdownBlockAtomPlan<BlockWidgetKind>,
    context: MarkdownFeatureWidgetContext,
  ) => WidgetType;
  lineClasses?: (source: string) => readonly string[];
}>;

// The builder erases handler variance only after `defineMarkdownFeature()` has
// checked each leaf definition. All dynamic lookup casts remain confined to
// the immutable composition builder.
export type AnyMarkdownFeatureDefinition = MarkdownFeatureDefinition<any, any, any>;

export type MarkdownFeatureManifestEntry = Readonly<{
  id: string;
  semanticKinds: readonly MarkdownElementKind[];
  inlineWidgetKinds: readonly InlineAtomModel["kind"][];
  blockWidgetKinds: readonly BlockEmbedModel["kind"][];
}>;

export type MarkdownFeatureComposition = Readonly<{
  manifest: readonly MarkdownFeatureManifestEntry[];
  parserExtensions: readonly MarkdownConfig[];
  livePreviewExtensions: readonly Extension[];
  collectRangeElements(
    state: EditorState,
    from: number,
    to: number,
  ): readonly MarkdownElement[];
  collectBlockElement(
    state: EditorState,
    line: MarkdownFeatureSourceLine,
  ): MarkdownFeatureBlockMatch | null;
  collectLineElements(line: MarkdownFeatureSourceLine): readonly MarkdownElement[];
  compileElement(
    element: MarkdownElement,
    context: MarkdownFeatureCompileContext,
  ): MarkdownElementPlan | null;
  createInlineWidget(
    plan: MarkdownInlineAtomPlan,
    context: MarkdownFeatureWidgetContext,
  ): WidgetType | null;
  createBlockWidget(
    plan: MarkdownBlockAtomPlan,
    context: MarkdownFeatureWidgetContext,
  ): WidgetType | null;
  getLineClasses(source: string): readonly string[];
}>;

/**
 * Dependency-inversion port for the immutable built-in Feature Composition.
 * Core collectors, compilers, and decorations know this contract only. The
 * public editor assembly supplies the concrete built-in composition.
 */
export const markdownFeatureCompositionFacet = Facet.define<
  MarkdownFeatureComposition,
  MarkdownFeatureComposition | null
>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : null;
  },
});

/** Static type helper; it performs no registration and owns no global state. */
export function defineMarkdownFeature<
  const ElementKind extends MarkdownElementKind,
  const InlineWidgetKind extends InlineAtomModel["kind"] = never,
  const BlockWidgetKind extends BlockEmbedModel["kind"] = never,
>(
  definition: MarkdownFeatureDefinition<ElementKind, InlineWidgetKind, BlockWidgetKind>,
): MarkdownFeatureDefinition<ElementKind, InlineWidgetKind, BlockWidgetKind> {
  return definition;
}

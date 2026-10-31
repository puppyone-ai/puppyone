import type { WidgetType } from "@codemirror/view";
import {
  markdownFeatureCompositionFacet,
  type AnyMarkdownFeatureDefinition,
  type MarkdownFeatureBlockMatch,
  type MarkdownFeatureComposition,
  type MarkdownFeatureDefinition,
  type MarkdownFeatureManifestEntry,
} from "../core/features/markdownFeatureContract";
import type {
  BlockEmbedModel,
  InlineAtomModel,
  MarkdownBlockAtomPlan,
  MarkdownInlineAtomPlan,
} from "../core/plans/markdownPlanTypes";
import { compileMarkdownElementPlan } from "../core/plans/markdownPlanCompiler";
import type {
  MarkdownElement,
  MarkdownElementKind,
} from "../core/syntax/markdownElementTypes";
import { codeBlockFeature } from "../features/code-block/codeBlockFeature";
import { htmlFeature } from "../features/html/htmlFeature";
import { imageFeature } from "../features/image/imageFeature";
import { mathFeature } from "../features/math/mathFeature";
import { mediaSyntaxFeature } from "../features/media/mediaSyntaxFeature";
import { mermaidFeature } from "../features/mermaid/mermaidFeature";
import { createMdxComponentFeature } from "../features/mdx-component/mdxComponentFeature";
import { createTableFeature } from "../features/table/tableFeature";
import { videoFeature } from "../features/video/videoFeature";
import { renderMarkdownInlineFromSharedPolicy } from "./preview/markdownInlinePlanAdapter";
import type { MarkdownDialectId } from "../../registry/viewerTypes";

/**
 * The only built-in Markdown Feature registration point. The list is static,
 * ordered, and frozen; this is composition, not a runtime plugin registry.
 */
const tableFeature = createTableFeature(renderMarkdownInlineFromSharedPolicy);
const mdxComponentFeature = createMdxComponentFeature(renderMarkdownInlineFromSharedPolicy);

const puppyGfmFeatures = Object.freeze([
  mediaSyntaxFeature,
  codeBlockFeature,
  mathFeature,
  mermaidFeature,
  htmlFeature,
  tableFeature,
  videoFeature,
  imageFeature,
] as const);

const openKnowledgeMdxFeatures = Object.freeze([
  mediaSyntaxFeature,
  codeBlockFeature,
  mathFeature,
  mermaidFeature,
  mdxComponentFeature,
  htmlFeature,
  tableFeature,
  videoFeature,
  imageFeature,
] as const);

export const puppyGfmFeatureComposition = createMarkdownFeatureComposition(
  puppyGfmFeatures,
);

export const openKnowledgeMdxFeatureComposition = createMarkdownFeatureComposition(
  openKnowledgeMdxFeatures,
);

/** Compatibility default for generic `.md` fixtures and public consumers. */
export const markdownFeatureComposition = puppyGfmFeatureComposition;

export function getMarkdownFeatureComposition(
  dialect: MarkdownDialectId,
): MarkdownFeatureComposition {
  return dialect === "openknowledge-mdx"
    ? openKnowledgeMdxFeatureComposition
    : puppyGfmFeatureComposition;
}

/** Compatibility name for tests and the public CodeMirror language assembly. */
export const puppyMarkdownParserExtensions = markdownFeatureComposition.parserExtensions;

/** Install this together with the parser extensions in non-product EditorState fixtures. */
export const puppyMarkdownFeatureCompositionExtension =
  markdownFeatureCompositionFacet.of(markdownFeatureComposition);

export function markdownFeatureCompositionExtension(dialect: MarkdownDialectId) {
  return markdownFeatureCompositionFacet.of(getMarkdownFeatureComposition(dialect));
}

/** Pure built-in compiler entry for fixtures and non-EditorState consumers. */
export function compilePuppyMarkdownElementPlan(element: MarkdownElement) {
  return compileMarkdownElementPlan(element, {
    documentProfile: "normal",
    featureComposition: markdownFeatureComposition,
    assetBrokerAvailable: false,
  });
}

export function createMarkdownFeatureComposition(
  definitions: readonly unknown[],
): MarkdownFeatureComposition {
  // Leaf definitions retain their exact generic types. The builder erases
  // handler variance once, after defineMarkdownFeature() checked each leaf.
  const featureDefinitions = definitions as readonly AnyMarkdownFeatureDefinition[];
  const ids = new Set<string>();
  const compilerByKind = new Map<
    MarkdownElementKind,
    NonNullable<AnyMarkdownFeatureDefinition["compile"]>
  >();
  const inlineWidgetByKind = new Map<
    InlineAtomModel["kind"],
    NonNullable<AnyMarkdownFeatureDefinition["createInlineWidget"]>
  >();
  const blockWidgetByKind = new Map<
    BlockEmbedModel["kind"],
    NonNullable<AnyMarkdownFeatureDefinition["createBlockWidget"]>
  >();
  const rangeCollectors: NonNullable<AnyMarkdownFeatureDefinition["collectRange"]>[] = [];
  const blockCollectors: NonNullable<AnyMarkdownFeatureDefinition["collectBlock"]>[] = [];
  const lineCollectors: NonNullable<AnyMarkdownFeatureDefinition["collectLine"]>[] = [];
  const lineClassProviders: NonNullable<AnyMarkdownFeatureDefinition["lineClasses"]>[] = [];
  const parserExtensions = [];
  const livePreviewExtensions = [];
  const manifest: MarkdownFeatureManifestEntry[] = [];

  for (const definition of featureDefinitions) {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate Markdown feature id: ${definition.id}`);
    }
    ids.add(definition.id);

    const semanticKinds = Object.freeze([...definition.semanticKinds]);
    const inlineWidgetKinds = Object.freeze([...definition.inlineWidgetKinds]);
    const blockWidgetKinds = Object.freeze([...definition.blockWidgetKinds]);
    manifest.push(Object.freeze({
      id: definition.id,
      semanticKinds,
      inlineWidgetKinds,
      blockWidgetKinds,
    }));

    if (semanticKinds.length > 0 && !definition.compile) {
      throw new Error(`Markdown feature ${definition.id} owns semantics without a compiler`);
    }
    for (const kind of semanticKinds) {
      registerUnique(compilerByKind, kind, definition.compile!, "semantic compiler", definition.id);
    }

    if (inlineWidgetKinds.length > 0 && !definition.createInlineWidget) {
      throw new Error(`Markdown feature ${definition.id} owns inline widgets without a factory`);
    }
    for (const kind of inlineWidgetKinds) {
      registerUnique(
        inlineWidgetByKind,
        kind,
        definition.createInlineWidget!,
        "inline widget",
        definition.id,
      );
    }

    if (blockWidgetKinds.length > 0 && !definition.createBlockWidget) {
      throw new Error(`Markdown feature ${definition.id} owns block widgets without a factory`);
    }
    for (const kind of blockWidgetKinds) {
      registerUnique(
        blockWidgetByKind,
        kind,
        definition.createBlockWidget!,
        "block widget",
        definition.id,
      );
    }

    if (definition.collectRange) rangeCollectors.push(definition.collectRange);
    if (definition.collectBlock) blockCollectors.push(definition.collectBlock);
    if (definition.collectLine) lineCollectors.push(definition.collectLine);
    if (definition.lineClasses) lineClassProviders.push(definition.lineClasses);
    if (definition.parserExtensions) parserExtensions.push(...definition.parserExtensions);
    if (definition.livePreviewExtensions) {
      livePreviewExtensions.push(...definition.livePreviewExtensions);
    }
  }

  const composition: MarkdownFeatureComposition = {
    manifest: Object.freeze(manifest),
    parserExtensions: Object.freeze(parserExtensions),
    livePreviewExtensions: Object.freeze(livePreviewExtensions),
    collectRangeElements(state, from, to) {
      return rangeCollectors.flatMap((collect) => collect(state, from, to));
    },
    collectBlockElement(state, line): MarkdownFeatureBlockMatch | null {
      for (const collect of blockCollectors) {
        const match = collect(state, line);
        if (match) return match;
      }
      return null;
    },
    collectLineElements(line) {
      return lineCollectors.flatMap((collect) => collect(line));
    },
    compileElement(element, context) {
      return compilerByKind.get(element.kind)?.(element, context) ?? null;
    },
    createInlineWidget(plan, context): WidgetType | null {
      const factory = inlineWidgetByKind.get(plan.atom.kind);
      if (!factory) return null;
      // Dynamic map lookup cannot preserve the discriminant correlation. Each
      // leaf factory was checked by defineMarkdownFeature; erase only here.
      return factory(plan as MarkdownInlineAtomPlan, context);
    },
    createBlockWidget(plan, context): WidgetType | null {
      const factory = blockWidgetByKind.get(plan.embed.kind);
      if (!factory) return null;
      return factory(plan as MarkdownBlockAtomPlan, context);
    },
    getLineClasses(source) {
      return Array.from(new Set(lineClassProviders.flatMap((provide) => provide(source))));
    },
  };

  return Object.freeze(composition);
}

function registerUnique<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
  capability: string,
  featureId: string,
) {
  if (map.has(key)) {
    throw new Error(`Duplicate Markdown ${capability} ${String(key)} (feature ${featureId})`);
  }
  map.set(key, value);
}

export type { MarkdownFeatureDefinition };

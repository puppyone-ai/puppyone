import type {
  MarkdownCodeSourceReference,
  MarkdownHtmlBlockRenderProfile,
  MarkdownImageDisplayMode,
  MarkdownMediaReferenceKind,
  MarkdownMdxTab,
  MarkdownTableAlignment,
  MarkdownTableRow,
  MarkdownVideoModel,
} from "../features/markdownFeatureData";
import type {
  MarkdownBlockComplexity,
  MarkdownMountedBlockExecution,
} from "./markdownBlockExecution";

export type SourceRange = {
  from: number;
  to: number;
};

export type MarkdownDiagnostic = {
  code: string;
  message: string;
};

export type InlineMarkCapabilities = {
  reveal: boolean;
  atomic: boolean;
  deleteUnits: readonly SourceRange[];
};

export type AtomicInlineCapabilities = {
  reveal: boolean;
  atomic: true;
  deleteUnits: readonly SourceRange[];
  expand: boolean;
};

export type BlockEmbedCapabilities = {
  reveal: false;
  atomic: true;
  deleteUnits: readonly [];
};

export type TypedContentMark = {
  kind: "inlineHtmlMark" | "strong" | "emphasis" | "strike" | "inlineCode" | "link" | "wikiLink";
  tagName?: string;
  className?: string;
  attributes: Readonly<Record<string, string>>;
};

export type InlineAtomModel =
  | { kind: "lineBreak" }
  | {
      kind: "image";
      alt: string;
      href: string;
      title: string | null;
      referenceKind: MarkdownMediaReferenceKind;
      displayMode: MarkdownImageDisplayMode;
    }
  | { kind: "taskCheckbox"; checked: boolean }
  | { kind: "mathInline"; source: string }
  | { kind: "escape" };

export type BlockEmbedModel =
  | {
      kind: "codeBlock";
      language: string;
      sourceReference: MarkdownCodeSourceReference | null;
      code: string;
    }
  | {
      kind: "mermaid";
      language: string;
      sourceReference: MarkdownCodeSourceReference | null;
      code: string;
    }
  | {
      kind: "table";
      alignments: readonly MarkdownTableAlignment[];
      rows: readonly MarkdownTableRow[];
      renderKey: string;
    }
  | { kind: "video"; model: MarkdownVideoModel }
  | {
      kind: "htmlBlock";
      tagName: string | null;
      source: string;
      profile: MarkdownHtmlBlockRenderProfile;
      profileVersion: string;
      requiresAssetBroker: boolean;
      externalHref: string | null;
    }
  | { kind: "mdxComponent"; name: "Tabs"; tabs: readonly MarkdownMdxTab[]; source: string }
  | { kind: "mathBlock"; source: string }
  | { kind: "horizontalRule" };

export type VisibleSourcePlan = {
  presentation: "visibleSource";
  sourceRange: SourceRange;
  diagnostics: readonly MarkdownDiagnostic[];
  capabilities: { reveal: false; atomic: false; deleteUnits: readonly [] };
};

export type InlineMarkPlan = {
  presentation: "inlineMark";
  sourceRange: SourceRange;
  contentRange: SourceRange;
  markerRanges: readonly SourceRange[];
  mark: TypedContentMark;
  diagnostics: readonly MarkdownDiagnostic[];
  capabilities: InlineMarkCapabilities;
};

type DistributedInlineAtomPlan<Atom extends InlineAtomModel> = Atom extends InlineAtomModel
  ? {
      presentation: "inlineAtom";
      sourceRange: SourceRange;
      atom: Atom;
      layout: { lineBreaks: number; estimatedHeight?: number };
      diagnostics: readonly MarkdownDiagnostic[];
      capabilities: AtomicInlineCapabilities;
    }
  : never;

type DistributedBlockAtomPlan<Embed extends BlockEmbedModel> = Embed extends BlockEmbedModel
  ? {
      presentation: "blockAtom";
      sourceRange: SourceRange;
      embed: Embed;
      complexity: MarkdownBlockComplexity;
      execution: MarkdownMountedBlockExecution;
      layout: { estimatedHeight: number };
      diagnostics: readonly MarkdownDiagnostic[];
      capabilities: BlockEmbedCapabilities;
    }
  : never;

export type MarkdownInlineAtomPlan<
  K extends InlineAtomModel["kind"] = InlineAtomModel["kind"],
> = Extract<DistributedInlineAtomPlan<InlineAtomModel>, { atom: { kind: K } }>;

export type MarkdownBlockAtomPlan<
  K extends BlockEmbedModel["kind"] = BlockEmbedModel["kind"],
> = Extract<DistributedBlockAtomPlan<BlockEmbedModel>, { embed: { kind: K } }>;

export type MarkdownElementPlan =
  | VisibleSourcePlan
  | InlineMarkPlan
  | DistributedInlineAtomPlan<InlineAtomModel>
  | DistributedBlockAtomPlan<BlockEmbedModel>;

export function planHasCollapsedMarkerDeletion(plan: MarkdownElementPlan): boolean {
  return plan.capabilities.deleteUnits.length > 0;
}

export function planSupportsReveal(plan: MarkdownElementPlan): boolean {
  return plan.capabilities.reveal;
}

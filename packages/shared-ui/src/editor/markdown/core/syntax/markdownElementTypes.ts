import type {
  MarkdownCodeSourceReference,
  MarkdownHtmlBlockStatus,
  MarkdownHtmlBlockMetrics,
  MarkdownInlineHtml,
  MarkdownImageDisplayMode,
  MarkdownMediaReferenceKind,
  MarkdownMdxComponentModel,
  MarkdownTableAlignment,
  MarkdownTableRow,
  MarkdownVideoModel,
} from "../features/markdownFeatureData";

export type MarkdownMarkerRange = {
  from: number;
  to: number;
};

export type MarkdownElementBase = {
  from: number;
  to: number;
  markerRanges: MarkdownMarkerRange[];
  contentRange?: MarkdownMarkerRange;
  lineFrom?: number;
  lineTo?: number;
  level?: number;
};

export type MarkdownElementBlockData =
  | {
      kind: "fence";
      language: string;
      sourceReference: MarkdownCodeSourceReference | null;
      code: string;
    }
  | {
      kind: "htmlBlock";
      tagName: string | null;
      status: MarkdownHtmlBlockStatus;
      diagnostic: string | null;
      source: string;
      metrics: MarkdownHtmlBlockMetrics;
    }
  | {
      kind: "table";
      alignments: readonly MarkdownTableAlignment[];
      rows: readonly MarkdownTableRow[];
      rowCount: number;
      cellCount: number;
      sourceBytes: number;
      modelComplete: boolean;
      refinementValid: boolean;
    }
  | {
      kind: "mdxComponent";
      component: MarkdownMdxComponentModel;
    }
  | { kind: "mathBlock"; source: string }
  | { kind: "mathInline"; source: string }
  | { kind: "task"; checked: boolean }
  | { kind: "video"; model: MarkdownVideoModel }
  | {
      kind: "image";
      alt: string;
      href: string;
      title: string | null;
      referenceKind: MarkdownMediaReferenceKind;
      displayMode: MarkdownImageDisplayMode;
    };

export type MarkdownElementKind =
  | "blockquote"
  | "emphasis"
  | "escape"
  | "fence"
  | "heading"
  | "htmlBlock"
  | "image"
  | "inlineHtml"
  | "inlineCode"
  | "link"
  | "list"
  | "mathBlock"
  | "mathInline"
  | "mdxComponent"
  | "rule"
  | "strike"
  | "strong"
  | "table"
  | "task"
  | "video"
  | "wikiLink";

type MarkdownPlainElementKind = Exclude<
  MarkdownElementKind,
  "fence" | "htmlBlock" | "image" | "inlineHtml" | "mathBlock" | "mathInline" | "mdxComponent" | "table" | "task" | "video"
>;

export type MarkdownPlainElement<K extends MarkdownPlainElementKind = MarkdownPlainElementKind> =
  MarkdownElementBase & {
    kind: K;
    blockData?: never;
    inlineHtml?: never;
  };

type MarkdownFeatureElement<
  K extends MarkdownElementBlockData["kind"],
> = MarkdownElementBase & {
  kind: K;
  blockData: Extract<MarkdownElementBlockData, { kind: K }>;
  inlineHtml?: never;
};

export type MarkdownInlineHtmlElement = MarkdownElementBase & {
  kind: "inlineHtml";
  inlineHtml: MarkdownInlineHtml;
  blockData?: never;
};

export type MarkdownFenceElement = MarkdownFeatureElement<"fence">;
export type MarkdownHtmlBlockElement = MarkdownFeatureElement<"htmlBlock">;
export type MarkdownImageElement = MarkdownFeatureElement<"image">;
export type MarkdownMathBlockElement = MarkdownFeatureElement<"mathBlock">;
export type MarkdownMathInlineElement = MarkdownFeatureElement<"mathInline">;
export type MarkdownMdxComponentElement = MarkdownFeatureElement<"mdxComponent">;
export type MarkdownTableElement = MarkdownFeatureElement<"table">;
export type MarkdownTaskElement = MarkdownFeatureElement<"task">;
export type MarkdownVideoElement = MarkdownFeatureElement<"video">;

export type MarkdownElement =
  | { [K in MarkdownPlainElementKind]: MarkdownPlainElement<K> }[MarkdownPlainElementKind]
  | MarkdownFenceElement
  | MarkdownHtmlBlockElement
  | MarkdownImageElement
  | MarkdownInlineHtmlElement
  | MarkdownMathBlockElement
  | MarkdownMathInlineElement
  | MarkdownMdxComponentElement
  | MarkdownTableElement
  | MarkdownTaskElement
  | MarkdownVideoElement;

export type MarkdownElementOf<K extends MarkdownElementKind> = Extract<MarkdownElement, { kind: K }>;

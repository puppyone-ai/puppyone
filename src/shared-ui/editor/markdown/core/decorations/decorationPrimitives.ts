import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { HiddenMarkdownSyntaxWidget, type MarkdownSourceSyntaxKind } from "../widgets/inlineWidgets";

export type MarkdownDecorationBuilders = {
  decorations: Range<Decoration>[];
  atomicRanges: Range<Decoration>[];
};

export type InlineRevealRange = {
  from: number;
  to: number;
};

export type OccupiedRange = {
  from: number;
  to: number;
};

export function addReplacementDecoration(
  builders: MarkdownDecorationBuilders,
  decoration: Decoration,
  from: number,
  to: number,
  options: { atomic?: boolean } = {},
) {
  if (from >= to) return;
  const range = decoration.range(from, to);
  builders.decorations.push(range);
  if (options.atomic !== false) builders.atomicRanges.push(range);
}

export function addSourceSyntaxDecoration(
  builders: MarkdownDecorationBuilders,
  from: number,
  to: number,
  kind: MarkdownSourceSyntaxKind,
  revealSourceSyntax: boolean,
) {
  if (from >= to) return;
  if (revealSourceSyntax) {
    builders.decorations.push(
      Decoration.mark({
        class: `cm-md-source-syntax cm-md-source-syntax-${kind}`,
        inclusive: false,
      }).range(from, to),
    );
    return;
  }

  addReplacementDecoration(
    builders,
    Decoration.replace({
      widget: new HiddenMarkdownSyntaxWidget(kind),
      inclusive: false,
    }),
    from,
    to,
  );
}

export function isRevealedInlineRange(from: number, to: number, inlineRevealRange: InlineRevealRange | null): boolean {
  return inlineRevealRange?.from === from && inlineRevealRange.to === to;
}

export function reserveRange(occupied: OccupiedRange[], from: number, to: number): boolean {
  if (from >= to) return false;
  if (occupied.some((range) => from < range.to && to > range.from)) return false;
  occupied.push({ from, to });
  return true;
}

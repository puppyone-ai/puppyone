import {
  Annotation,
  EditorSelection,
  StateEffect,
  Transaction,
  type ChangeSpec,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { invertedEffects, isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  getMarkdownMovableBlockAt,
  getMarkdownMovableBlockGroup,
  type MarkdownMovableBlockRef,
} from "../syntax/markdownBlockBoundaries";
import { getOrderedListRenumberChanges } from "./markdownBlockCommands";

export type MarkdownBlockRelocation = Readonly<{
  oldRange: Readonly<{ from: number; to: number }>;
  newRange: Readonly<{ from: number; to: number }>;
  mapContainedPosition?: (position: number, assoc?: number) => number;
  mapContainedPositionInverse?: (position: number, assoc?: number) => number;
}>;

export const markdownBlockRelocationAnnotation = Annotation.define<MarkdownBlockRelocation>();
export const markdownBlockRelocationEffect = StateEffect.define<MarkdownBlockRelocation>();
export const markdownBlockRelocationHistoryExtension = invertedEffects.of((transaction) => {
  const relocation = transaction.effects.find((effect) => (
    effect.is(markdownBlockRelocationEffect)
  ))?.value;
  if (!relocation) return [];
  return [markdownBlockRelocationEffect.of({
    oldRange: relocation.newRange,
    newRange: relocation.oldRange,
    mapContainedPosition: relocation.mapContainedPositionInverse,
    mapContainedPositionInverse: relocation.mapContainedPosition,
  })];
});

export type MarkdownBlockMoveDirection = "up" | "down";

/**
 * Pure of any scrolling: a drop lands where the pointer already is, and the
 * selection may be far from the moved block. A caller that wants its result
 * revealed asks for that itself.
 */
export function buildMarkdownBlockMoveTransaction(
  state: EditorState,
  requestedSource: MarkdownMovableBlockRef,
  boundary: number,
  userEvent = "move.drop",
): TransactionSpec | null {
  if (state.readOnly) return null;
  const group = getMarkdownMovableBlockGroup(state, requestedSource);
  if (!group || group.blocks.length < 2) return null;
  const { blocks, sourceIndex } = group;
  // Re-read from this state: the caller's reference may predate parser progress.
  const source = blocks[sourceIndex];
  if (!Number.isInteger(boundary) || boundary < 0 || boundary > blocks.length) return null;
  if (isMarkdownBlockMoveNoop(sourceIndex, boundary)) return null;

  const sourceText = state.sliceDoc(source.from, source.to);
  if (!sourceText) return null;

  let changesSpec: ChangeSpec[];
  let insertionPosition: number;
  let insertedBlockOffset: number;

  if (boundary < sourceIndex) {
    const previous = blocks[sourceIndex - 1];
    const separator = state.sliceDoc(previous.to, source.from);
    insertionPosition = blocks[boundary].from;
    insertedBlockOffset = 0;
    changesSpec = [
      { from: insertionPosition, insert: sourceText + separator },
      { from: previous.to, to: source.to },
    ];
  } else {
    const next = blocks[sourceIndex + 1];
    if (!next) return null;
    const separator = state.sliceDoc(source.to, next.from);
    // Insert at the end of the block before the requested boundary. Its
    // existing following separator remains after the moved block; the source
    // block's former following separator is carried before it. Inserting at
    // blocks[boundary].from would put both separators before the moved block
    // and concatenate it with the next block.
    insertionPosition = blocks[boundary - 1].to;
    insertedBlockOffset = separator.length;
    changesSpec = [
      { from: source.from, to: next.from },
      { from: insertionPosition, insert: separator + sourceText },
    ];
  }

  const relocationChanges = state.changes(changesSpec);
  const intermediateBlockFrom = relocationChanges.mapPos(insertionPosition, -1) + insertedBlockOffset;
  const intermediateBlockTo = intermediateBlockFrom + sourceText.length;
  let selection = EditorSelection.create(
    state.selection.ranges.map((range) => {
      if (range.from < source.from || range.to > source.to) return range.map(relocationChanges);
      return EditorSelection.range(
        intermediateBlockFrom + range.anchor - source.from,
        intermediateBlockFrom + range.head - source.from,
        range.goalColumn,
        range.bidiLevel ?? undefined,
        range.assoc,
      );
    }),
    state.selection.mainIndex,
  );

  let changes = relocationChanges;
  let mapContainedPosition: MarkdownBlockRelocation["mapContainedPosition"];
  let mapContainedPositionInverse: MarkdownBlockRelocation["mapContainedPositionInverse"];
  let newBlockFrom = intermediateBlockFrom;
  let newBlockTo = intermediateBlockTo;
  if (source.parentName === "OrderedList") {
    const intermediateState = state.update({ changes: relocationChanges }).state;
    const parentLine = intermediateState.doc.lineAt(source.parentFrom);
    const parentIndent = /^\s*/.exec(parentLine.text)?.[0] ?? "";
    const renumberSpecs = getOrderedListRenumberChanges(intermediateState, {
      from: source.parentFrom,
      to: source.parentTo,
      indent: parentIndent,
    });
    if (renumberSpecs.length > 0) {
      const normalization = intermediateState.changes(renumberSpecs);
      const inverseNormalization = normalization.invert(intermediateState.doc);
      changes = relocationChanges.compose(normalization);
      selection = selection.map(normalization);
      newBlockFrom = normalization.mapPos(intermediateBlockFrom, -1);
      newBlockTo = normalization.mapPos(intermediateBlockTo, 1);
      mapContainedPosition = (position, assoc) => normalization.mapPos(
        intermediateBlockFrom + position - source.from,
        assoc,
      );
      mapContainedPositionInverse = (position, assoc) => (
        source.from
        + inverseNormalization.mapPos(position, assoc)
        - intermediateBlockFrom
      );
    }
  }

  const relocation: MarkdownBlockRelocation = {
    oldRange: { from: source.from, to: source.to },
    newRange: { from: newBlockFrom, to: newBlockTo },
    mapContainedPosition,
    mapContainedPositionInverse,
  };

  return {
    changes,
    selection,
    effects: [markdownBlockRelocationEffect.of(relocation)],
    annotations: [
      Transaction.userEvent.of(userEvent),
      isolateHistory.of("full"),
      markdownBlockRelocationAnnotation.of(relocation),
    ],
  };
}

export function moveMarkdownBlock(
  view: EditorView,
  direction: MarkdownBlockMoveDirection,
): boolean {
  if (view.state.readOnly || view.composing) return false;
  const source = getMarkdownMovableBlockAt(view.state, view.state.selection.main.head);
  if (!source) return false;
  const group = getMarkdownMovableBlockGroup(view.state, source);
  if (!group) return false;
  const boundary = direction === "up" ? group.sourceIndex - 1 : group.sourceIndex + 2;
  const spec = buildMarkdownBlockMoveTransaction(
    view.state,
    source,
    boundary,
    "move.block.keyboard",
  );
  if (!spec) return false;
  // The keyboard moves the block holding the caret, so follow it.
  view.dispatch({ ...spec, scrollIntoView: true });
  return true;
}

export function isMarkdownBlockMoveNoop(sourceIndex: number, boundary: number): boolean {
  return boundary === sourceIndex || boundary === sourceIndex + 1;
}

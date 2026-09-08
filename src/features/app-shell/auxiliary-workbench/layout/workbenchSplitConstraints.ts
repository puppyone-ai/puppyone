import {
  workbenchSplitDefinition,
  workbenchSplitNodeMinimumSize as splitNodeMinimumSize,
  workbenchSplitRatioBounds as splitRatioBounds,
  type WorkbenchSplitDropEdge,
  type WorkbenchSplitMinimumSize,
  type WorkbenchSplitRatioBounds,
} from "@puppyone/shared-ui";
import type {
  AuxiliaryWorkbenchLayoutNode,
  AuxiliaryWorkbenchLayoutSplit,
} from "@puppyone/shared-ui";

export type { WorkbenchSplitMinimumSize, WorkbenchSplitRatioBounds } from "@puppyone/shared-ui";

export const WORKBENCH_SPLIT_DIVIDER_SIZE = 1;
export const WORKBENCH_FALLBACK_MINIMUM_VIEWPORT: WorkbenchSplitMinimumSize = Object.freeze({
  width: 172,
  height: 128,
});
const WORKBENCH_PANE_INLINE_INSET = 16;
const WORKBENCH_PANE_BLOCK_INSET = 30;
const WORKBENCH_GROUP_HEADER_BLOCK_SIZE = 38;

export function workbenchLeafMinimumSize(
  viewport: WorkbenchSplitMinimumSize | null | undefined,
): WorkbenchSplitMinimumSize {
  const measured = viewport ?? WORKBENCH_FALLBACK_MINIMUM_VIEWPORT;
  return Object.freeze({
    width: Math.max(1, measured.width) + WORKBENCH_PANE_INLINE_INSET,
    height: Math.max(1, measured.height)
      + WORKBENCH_PANE_BLOCK_INSET
      + WORKBENCH_GROUP_HEADER_BLOCK_SIZE,
  });
}

export function workbenchSplitNodeMinimumSize(
  node: AuxiliaryWorkbenchLayoutNode,
  getLeafMinimum: (groupId: string) => WorkbenchSplitMinimumSize,
  dividerSize = WORKBENCH_SPLIT_DIVIDER_SIZE,
): WorkbenchSplitMinimumSize {
  return splitNodeMinimumSize(
    node,
    (leaf) => getLeafMinimum(leaf.groupId),
    dividerSize,
  );
}

export function workbenchSplitChildMinimumSizes(
  split: AuxiliaryWorkbenchLayoutSplit,
  getLeafMinimum: (groupId: string) => WorkbenchSplitMinimumSize,
): Readonly<{ first: WorkbenchSplitMinimumSize; second: WorkbenchSplitMinimumSize }> {
  return Object.freeze({
    first: workbenchSplitNodeMinimumSize(split.first, getLeafMinimum),
    second: workbenchSplitNodeMinimumSize(split.second, getLeafMinimum),
  });
}

export function workbenchSplitRatioBounds(
  direction: AuxiliaryWorkbenchLayoutSplit["direction"],
  totalSize: number,
  dividerSize: number,
  firstMinimum: WorkbenchSplitMinimumSize,
  secondMinimum: WorkbenchSplitMinimumSize,
): WorkbenchSplitRatioBounds {
  return splitRatioBounds(
    direction,
    totalSize,
    dividerSize,
    firstMinimum,
    secondMinimum,
  );
}

export function canPlaceWorkbenchSplit(
  targetRect: Pick<DOMRect, "height" | "width">,
  edge: WorkbenchSplitDropEdge,
  sourceMinimum: WorkbenchSplitMinimumSize,
  targetMinimum: WorkbenchSplitMinimumSize,
  dividerSize = WORKBENCH_SPLIT_DIVIDER_SIZE,
): boolean {
  const { direction } = workbenchSplitDefinition(edge);
  if (direction === "horizontal") {
    return targetRect.width >= sourceMinimum.width + dividerSize + targetMinimum.width
      && targetRect.height >= Math.max(sourceMinimum.height, targetMinimum.height);
  }
  return targetRect.height >= sourceMinimum.height + dividerSize + targetMinimum.height
    && targetRect.width >= Math.max(sourceMinimum.width, targetMinimum.width);
}

export function clampWorkbenchRatioToBounds(
  ratio: number,
  bounds: WorkbenchSplitRatioBounds,
): number {
  if (!Number.isFinite(ratio)) return Math.min(bounds.maximum, Math.max(bounds.minimum, 0.5));
  return Math.min(bounds.maximum, Math.max(bounds.minimum, Math.round(ratio * 1_000) / 1_000));
}

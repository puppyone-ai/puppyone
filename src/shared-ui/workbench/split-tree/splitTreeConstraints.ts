import {
  isWorkbenchSplit,
  type WorkbenchSplitDirection,
  type WorkbenchSplitNode,
} from "./splitTreeModel";

export type WorkbenchSplitMinimumSize = Readonly<{
  width: number;
  height: number;
}>;

export type WorkbenchSplitRatioBounds = Readonly<{
  minimum: number;
  maximum: number;
}>;

export function workbenchSplitNodeMinimumSize<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  node: WorkbenchSplitNode<TLeaf>,
  getLeafMinimum: (leaf: TLeaf) => WorkbenchSplitMinimumSize,
  dividerSize: number,
): WorkbenchSplitMinimumSize {
  if (!isWorkbenchSplit(node)) return getLeafMinimum(node);
  const first = workbenchSplitNodeMinimumSize(node.first, getLeafMinimum, dividerSize);
  const second = workbenchSplitNodeMinimumSize(node.second, getLeafMinimum, dividerSize);
  return node.direction === "horizontal"
    ? Object.freeze({
        width: first.width + dividerSize + second.width,
        height: Math.max(first.height, second.height),
      })
    : Object.freeze({
        width: Math.max(first.width, second.width),
        height: first.height + dividerSize + second.height,
      });
}

export function workbenchSplitRatioBounds(
  direction: WorkbenchSplitDirection,
  totalSize: number,
  dividerSize: number,
  firstMinimum: WorkbenchSplitMinimumSize,
  secondMinimum: WorkbenchSplitMinimumSize,
): WorkbenchSplitRatioBounds {
  const available = Math.max(1, totalSize - Math.max(0, dividerSize));
  const first = direction === "horizontal" ? firstMinimum.width : firstMinimum.height;
  const second = direction === "horizontal" ? secondMinimum.width : secondMinimum.height;
  if (first + second > available) {
    const proportional = roundRatio(first / Math.max(1, first + second));
    return Object.freeze({ minimum: proportional, maximum: proportional });
  }
  return Object.freeze({
    minimum: roundRatio(first / available),
    maximum: roundRatio(1 - second / available),
  });
}

function roundRatio(ratio: number) {
  return Math.min(0.99, Math.max(0.01, Math.round(ratio * 1_000) / 1_000));
}

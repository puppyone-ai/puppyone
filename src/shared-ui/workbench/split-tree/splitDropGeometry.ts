import type {
  WorkbenchSplitDirection,
  WorkbenchSplitPlacement,
} from "./splitTreeModel";

export type WorkbenchSplitDropEdge = "left" | "right" | "top" | "bottom";

export type WorkbenchSplitDropDefinition = Readonly<{
  direction: WorkbenchSplitDirection;
  placement: WorkbenchSplitPlacement;
}>;

export function closestWorkbenchSplitDropEdge(
  rect: Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width">,
  x: number,
  y: number,
): WorkbenchSplitDropEdge {
  const distances: ReadonlyArray<readonly [WorkbenchSplitDropEdge, number]> = [
    ["left", Math.abs(x - rect.left) / Math.max(1, rect.width)],
    ["right", Math.abs(rect.right - x) / Math.max(1, rect.width)],
    ["top", Math.abs(y - rect.top) / Math.max(1, rect.height)],
    ["bottom", Math.abs(rect.bottom - y) / Math.max(1, rect.height)],
  ];
  return distances.reduce((closest, candidate) => (
    candidate[1] < closest[1] ? candidate : closest
  ))[0];
}

export function workbenchSplitDefinition(
  edge: WorkbenchSplitDropEdge,
): WorkbenchSplitDropDefinition {
  if (edge === "left") return { direction: "horizontal", placement: "first" };
  if (edge === "right") return { direction: "horizontal", placement: "second" };
  if (edge === "top") return { direction: "vertical", placement: "first" };
  return { direction: "vertical", placement: "second" };
}

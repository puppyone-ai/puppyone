/**
 * A pane accepts two kinds of drop. Near an edge it splits the pane (existing
 * behaviour). In the reading area it may hand the payload to a document target
 * such as the Markdown editor, which inserts the image inline.
 */
export type PaneDropRegion = "edge" | "center";

// Splitting requires an intentional edge drop. Wider bands overlap the first
// reading lines and turn ordinary image insertion into an unexpected split.
export const PANE_DROP_EDGE_RATIO = 0.04;
export const PANE_DROP_EDGE_MIN_PX = 16;
export const PANE_DROP_EDGE_MAX_PX = 24;

/** The edge band is proportional but never swallows the reading area of a
 * small pane, and never grows into the whole pane on a large display. */
export function paneDropEdgeBand(
  rect: Pick<DOMRect, "width" | "height">,
): number {
  const shortest = Math.min(rect.width, rect.height);
  return Math.min(
    shortest / 4,
    PANE_DROP_EDGE_MAX_PX,
    Math.max(PANE_DROP_EDGE_MIN_PX, shortest * PANE_DROP_EDGE_RATIO),
  );
}

export function resolvePaneDropRegion(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">,
  x: number,
  y: number,
): PaneDropRegion {
  const band = paneDropEdgeBand(rect);
  const distance = Math.min(x - rect.left, rect.right - x, y - rect.top, rect.bottom - y);
  return distance < band ? "edge" : "center";
}

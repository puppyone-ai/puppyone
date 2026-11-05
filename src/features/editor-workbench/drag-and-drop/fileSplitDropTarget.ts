export type FileSplitDropEdge = "left" | "right";

/** Only the shell-owned, visible cards can authorize a file split. Markdown
 * content cannot impersonate a target by authoring the same data attributes. */
export function fileSplitDropEdge(surface: HTMLElement, x: number, y: number): FileSplitDropEdge | null {
  const overlay = surface.querySelector<HTMLElement>(":scope > [data-file-split-targets]");
  if (!overlay) return null;
  for (const card of overlay.querySelectorAll<HTMLElement>(":scope > [data-file-split-edge]")) {
    const edge = card.dataset.fileSplitEdge;
    if (edge !== "left" && edge !== "right") continue;
    const rect = card.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0
      && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return edge;
  }
  return null;
}

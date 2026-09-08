import { closestWorkbenchSplitDropEdge } from "@puppyone/shared-ui";

export type WorkbenchContentDropTarget = Readonly<{
  edge: ReturnType<typeof closestWorkbenchSplitDropEdge>;
  groupId: string;
  surface: HTMLElement;
}>;

/** Resolves only the content viewport; Group chrome is intentionally excluded. */
export function resolveWorkbenchContentDropTarget(
  element: Element | null,
  clientX: number,
  clientY: number,
): WorkbenchContentDropTarget | null {
  const surface = element?.closest<HTMLElement>(
    "[data-terminal-content-drop-group-id]",
  );
  const groupId = surface?.dataset.terminalContentDropGroupId;
  if (!surface || !groupId) return null;
  return Object.freeze({
    edge: closestWorkbenchSplitDropEdge(
      surface.getBoundingClientRect(),
      clientX,
      clientY,
    ),
    groupId,
    surface,
  });
}

import { useCallback, useRef, useState, type PointerEvent, type RefObject } from "react";

/**
 * Ghostty-style reveal: editor chrome appears in the leading third of what it
 * belongs to, a project pane or a file window.
 */
export const PANE_HANDLE_REVEAL_RATIO = 1 / 3;

export function useEditorPaneChromeReveal(
  paneRef: RefObject<HTMLElement | null>,
  forcedOpen: boolean,
) {
  const hotRef = useRef(false);
  const [hot, setHot] = useState(false);

  const setHotIfChanged = useCallback((next: boolean) => {
    if (hotRef.current === next) return;
    hotRef.current = next;
    setHot(next);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const pane = paneRef.current;
    if (!pane) return;
    setHotIfChanged(isPointInPaneHandleRevealZone(
      pane.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    ));
  }, [paneRef, setHotIfChanged]);

  const onPointerLeave = useCallback(() => setHotIfChanged(false), [setHotIfChanged]);

  return {
    revealed: hot || forcedOpen,
    onPointerMove,
    onPointerLeave,
  } as const;
}

export function isPointInPaneHandleRevealZone(
  rect: Pick<DOMRect, "left" | "right" | "top" | "height">,
  clientX: number,
  clientY: number,
): boolean {
  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY < rect.top + rect.height * PANE_HANDLE_REVEAL_RATIO;
}

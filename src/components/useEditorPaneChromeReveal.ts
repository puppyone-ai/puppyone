import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { EMBEDDED_POINTER_EVENT, type EmbeddedPointerDetail } from "@puppyone/shared-ui";

/**
 * Ghostty-style reveal: editor chrome appears in the leading third of what it
 * belongs to, a project pane or a file window.
 */
export const PANE_HANDLE_REVEAL_RATIO = 1 / 3;

/**
 * A frame says the pointer left it a moment after this document has already
 * seen the pointer arrive, so a leave that soon after a move here is stale.
 */
const EMBEDDED_LEAVE_GRACE_MS = 150;

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

  const lastMoveHere = useRef(Number.NEGATIVE_INFINITY);
  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const pane = paneRef.current;
    if (!pane) return;
    lastMoveHere.current = performance.now();
    setHotIfChanged(isPointInPaneHandleRevealZone(
      pane.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    ));
  }, [paneRef, setHotIfChanged]);

  // A document drawn in a frame (an HTML page) takes the pointer out of this
  // document's sight; its viewer relays where the pointer is instead.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return undefined;
    const onEmbeddedPointer = (event: Event) => {
      const point = (event as CustomEvent<EmbeddedPointerDetail>).detail;
      if (!point) {
        if (performance.now() - lastMoveHere.current >= EMBEDDED_LEAVE_GRACE_MS) setHotIfChanged(false);
        return;
      }
      setHotIfChanged(isPointInPaneHandleRevealZone(pane.getBoundingClientRect(), point.clientX, point.clientY));
    };
    pane.addEventListener(EMBEDDED_POINTER_EVENT, onEmbeddedPointer);
    return () => pane.removeEventListener(EMBEDDED_POINTER_EVENT, onEmbeddedPointer);
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

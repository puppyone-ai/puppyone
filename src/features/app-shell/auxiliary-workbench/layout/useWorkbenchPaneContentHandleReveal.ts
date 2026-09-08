import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

/** Reveal chrome only from the leading third of the content viewport. */
export const WORKBENCH_PANE_CONTENT_HANDLE_REVEAL_RATIO = 1 / 3;

export function useWorkbenchPaneContentHandleReveal(
  contentRef: RefObject<HTMLElement | null>,
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
    const content = contentRef.current;
    if (!content) return;
    setHotIfChanged(isPointInWorkbenchPaneContentHandleRevealZone(
      content.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    ));
  }, [contentRef, setHotIfChanged]);

  const onPointerLeave = useCallback(() => setHotIfChanged(false), [setHotIfChanged]);

  return {
    revealed: hot || forcedOpen,
    onPointerMove,
    onPointerLeave,
  } as const;
}

export function isPointInWorkbenchPaneContentHandleRevealZone(
  rect: Pick<DOMRect, "left" | "right" | "top" | "height">,
  clientX: number,
  clientY: number,
): boolean {
  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY < rect.top + rect.height * WORKBENCH_PANE_CONTENT_HANDLE_REVEAL_RATIO;
}

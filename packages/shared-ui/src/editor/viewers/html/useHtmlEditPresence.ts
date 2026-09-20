import { useCallback, useEffect, useRef, type RefObject, type PointerEvent } from "react";
import type { HtmlSelectionMessage } from "./htmlBridgeProtocol";
import type { HtmlHandleBounds } from "./HtmlEditHandle";

/** The frame, pencil and floating controls form one transient editing region. */
export function useHtmlEditPresence({ viewport, selection, handleBounds, busy, leave }: {
  viewport: RefObject<HTMLDivElement>; selection: RefObject<HtmlSelectionMessage | null>;
  handleBounds: RefObject<HtmlHandleBounds | null>;
  busy: () => boolean; leave: () => void;
}) {
  const latest = useRef({ busy, leave }); latest.current = { busy, leave };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousPoint = useRef<{ x: number; y: number; id: string } | null>(null);
  const keep = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const away = useCallback(() => {
    if (timer.current) return;
    const finish = () => {
      // Never unmount a composing input or a native chooser while the pointer is outside the app.
      if (latest.current.busy()) { timer.current = setTimeout(finish, 250); return; }
      timer.current = null; latest.current.leave();
    };
    timer.current = setTimeout(finish, 350);
  }, []);
  const move = useCallback((x: number, y: number) => {
    const current = selection.current;
    if (!current) return;
    const { rect, clip } = current;
    const before = previousPoint.current; previousPoint.current = { x, y, id: current.id };
    const handle = handleBounds.current;
    // A slow diagonal approach to an outside handle must not time out halfway there.
    const distance = (point: { x: number; y: number }) => handle
      ? Math.hypot(Math.max(handle.x - point.x, 0, point.x - handle.x - handle.width),
        Math.max(handle.y - point.y, 0, point.y - handle.y - handle.height)) : 0;
    if (x >= rect.x + clip.left - 8 && x <= rect.x + rect.width - clip.right + 8
      && y >= rect.y + clip.top - 8 && y <= rect.y + rect.height - clip.bottom + 8) keep();
    else {
      if (handle && before?.id === current.id && distance(before) > distance({ x, y })) keep();
      away();
    }
  }, [selection, handleBounds, keep, away]);
  const pointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.tagName === "IFRAME") return;
    if (event.target.closest("[data-html-control]")) { previousPoint.current = null; keep(); return; }
    const bounds = viewport.current?.getBoundingClientRect();
    if (bounds) move(event.clientX - bounds.x, event.clientY - bounds.y);
  }, [viewport, keep, move]);
  useEffect(() => {
    window.addEventListener("blur", away);
    return () => { keep(); window.removeEventListener("blur", away); };
  }, [keep, away]);
  return { keep, away, move, pointerMove };
}

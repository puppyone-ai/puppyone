import { useCallback, useEffect, useRef, type RefObject, type PointerEvent } from "react";
import type { HtmlSelectionMessage } from "./htmlBridgeProtocol";

/** The frame, pencil and floating controls form one transient editing region. */
export function useHtmlEditPresence({ viewport, selection, busy, leave }: {
  viewport: RefObject<HTMLDivElement>; selection: RefObject<HtmlSelectionMessage | null>;
  busy: () => boolean; leave: () => void;
}) {
  const latest = useRef({ busy, leave }); latest.current = { busy, leave };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (x >= rect.x + clip.left - 8 && x <= rect.x + rect.width - clip.right + 8
      && y >= rect.y + clip.top - 8 && y <= rect.y + rect.height - clip.bottom + 8) keep();
    else away();
  }, [selection, keep, away]);
  const pointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.tagName === "IFRAME") return;
    if (event.target.closest("[data-html-control]")) { keep(); return; }
    const bounds = viewport.current?.getBoundingClientRect();
    if (bounds) move(event.clientX - bounds.x, event.clientY - bounds.y);
  }, [viewport, keep, move]);
  useEffect(() => {
    window.addEventListener("blur", away);
    return () => { keep(); window.removeEventListener("blur", away); };
  }, [keep, away]);
  return { keep, away, move, pointerMove };
}

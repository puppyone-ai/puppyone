import { useCallback, useEffect, useRef, type RefObject, type PointerEvent } from "react";
import type { HtmlSelectionMessage } from "./htmlBridgeProtocol";
import type { HtmlActionBounds } from "./HtmlBlockActionRail";

/**
 * Selection and floating controls persist once selected until an explicit outside click or Escape,
 * eliminating the 350ms pointer-leave auto-dismiss race condition.
 */
export function useHtmlEditPresence({ viewport, selection, handleBounds, busy, leave }: {
  viewport: RefObject<HTMLDivElement>; selection: RefObject<HtmlSelectionMessage | null>;
  handleBounds: RefObject<HtmlActionBounds | null>;
  busy: () => boolean; leave: () => void;
}) {
  const latest = useRef({ busy, leave }); latest.current = { busy, leave };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const away = useCallback(() => {
    if (latest.current.busy()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current.leave();
  }, []);
  const move = useCallback((_x: number, _y: number) => {
    keep();
  }, [keep]);
  const pointerMove = useCallback((_event: PointerEvent<HTMLDivElement>) => {
    keep();
  }, [keep]);
  useEffect(() => () => { keep(); }, [keep]);
  void viewport; void selection; void handleBounds;
  return { keep, away, move, pointerMove };
}

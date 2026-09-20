import { useLayoutEffect, useState, type MutableRefObject, type RefObject } from "react";
import { Pencil } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { HtmlSelectionMessage } from "./htmlBridgeProtocol";

export type HtmlHandleBounds = { x: number; y: number; width: number; height: number };
type Placement = HtmlHandleBounds & { edge: "above" | "right" | "inside" };
const SIZE = 28, GAP = 4;

function placeHandle(selection: HtmlSelectionMessage, pane: HTMLDivElement | null): Placement | null {
  if (!pane || pane.clientWidth < SIZE + GAP * 2 || pane.clientHeight < SIZE + GAP * 2) return null;
  const { rect, clip } = selection;
  const left = Math.max(GAP, rect.x + clip.left), top = Math.max(GAP, rect.y + clip.top);
  const right = Math.min(pane.clientWidth - GAP, rect.x + rect.width - clip.right);
  const bottom = Math.min(pane.clientHeight - GAP, rect.y + rect.height - clip.bottom);
  if (right <= left || bottom <= top) return null;
  // Standalone providers own a local source menu; pane hosts put it outside this viewport.
  const menu = pane.closest(".html-document-editor")?.querySelector(".html-editor-options")?.getBoundingClientRect();
  const viewport = pane.getBoundingClientRect();
  const avoidMenu = (placement: Placement): Placement => {
    if (!menu || placement.x + SIZE <= menu.left - viewport.left - GAP || placement.x >= menu.right - viewport.left + GAP
      || placement.y + SIZE <= menu.top - viewport.top - GAP || placement.y >= menu.bottom - viewport.top + GAP) return placement;
    const shiftedX = menu.left - viewport.left - SIZE - GAP;
    return placement.edge !== "right" && shiftedX >= left ? { ...placement, x: shiftedX }
      : { ...placement, y: Math.min(menu.bottom - viewport.top + GAP, pane.clientHeight - SIZE - GAP) };
  };
  const x = Math.max(GAP, right - SIZE);
  if (top - SIZE - GAP >= GAP) return avoidMenu({ x, y: top - SIZE - GAP, width: SIZE, height: SIZE, edge: "above" });
  const y = Math.min(top, pane.clientHeight - SIZE - GAP);
  if (right + GAP + SIZE <= pane.clientWidth - GAP) return avoidMenu({ x: right + GAP, y, width: SIZE, height: SIZE, edge: "right" });
  return avoidMenu({ x: Math.max(GAP, right - SIZE - GAP), y: Math.min(top + GAP, pane.clientHeight - SIZE - GAP),
    width: SIZE, height: SIZE, edge: "inside" });
}

/** One small glyph, a restrained translucent surface outside the block, and outside-first docking. */
export function HtmlEditHandle({ selection, viewport, handle, bounds, keep, activate }: {
  selection: HtmlSelectionMessage; viewport: RefObject<HTMLDivElement>; handle: RefObject<HTMLButtonElement>;
  bounds: MutableRefObject<HtmlHandleBounds | null>; keep: () => void; activate: () => void;
}) {
  const { t } = useLocalization();
  const [placement, setPlacement] = useState(() => placeHandle(selection, viewport.current));
  useLayoutEffect(() => {
    const pane = viewport.current;
    if (!pane) return;
    const place = () => { const next = placeHandle(selection, pane); bounds.current = next; setPlacement(next); };
    place();
    const observer = new ResizeObserver(place); observer.observe(pane);
    return () => { observer.disconnect(); bounds.current = null; };
  }, [selection, viewport, bounds]);
  return placement && <button ref={handle} type="button" className="html-editor-pencil" data-html-control
    data-placement={placement.edge} title={t("editor.html.editBlock")} aria-label={t("editor.html.editBlock")}
    style={{ left: placement.x, top: placement.y, width: placement.width, height: placement.height }}
    onPointerEnter={keep} onFocus={keep} onClick={activate}><Pencil size={16} strokeWidth={2} /></button>;
}

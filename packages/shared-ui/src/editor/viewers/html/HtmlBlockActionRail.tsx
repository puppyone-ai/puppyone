import { useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { Pencil } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { HtmlSelectionMessage } from "./htmlBridgeProtocol";

export type HtmlActionBounds = { x: number; y: number; width: number; height: number };
type Dock = "above" | "below" | "inside";
type ActionRailLayout = {
  y: number;
  height: number;
  dock: Dock;
  handle: HtmlActionBounds;
  menu: { x: number; y: number } | null;
};

const HANDLE_SIZE = 26;
const RAIL_HEIGHT = 38;
const PANE_MARGIN = 8;
const BLOCK_GAP = 6;
const ITEM_GAP = 8;
// The color/alt tray opens above the menu. Reserving this once keeps the rail fixed when a tray opens.
const TRAY_TOP_RESERVE = 84;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function sameLayout(left: ActionRailLayout | null, right: ActionRailLayout | null) {
  if (!left || !right) return left === right;
  return left.y === right.y && left.height === right.height && left.dock === right.dock
    && left.handle.x === right.handle.x && left.handle.y === right.handle.y
    && left.handle.width === right.handle.width && left.handle.height === right.handle.height
    && left.menu?.x === right.menu?.x && left.menu?.y === right.menu?.y;
}

function placeRail(selection: HtmlSelectionMessage, pane: HTMLDivElement, menu: HTMLDivElement | null, active: boolean): ActionRailLayout | null {
  if (pane.clientWidth < HANDLE_SIZE + PANE_MARGIN * 2 || pane.clientHeight < RAIL_HEIGHT + PANE_MARGIN * 2) return null;
  const { rect, clip } = selection;
  const left = Math.max(PANE_MARGIN, rect.x + clip.left);
  const top = Math.max(PANE_MARGIN, rect.y + clip.top);
  const right = Math.min(pane.clientWidth - PANE_MARGIN, rect.x + rect.width - clip.right);
  const bottom = Math.min(pane.clientHeight - PANE_MARGIN, rect.y + rect.height - clip.bottom);
  if (right <= left || bottom <= top) return null;

  const menuWidth = menu?.offsetWidth ?? 0;
  const menuHeight = menu?.offsetHeight ?? 0;
  const height = Math.max(RAIL_HEIGHT, menuHeight);
  const minimumY = Math.min(TRAY_TOP_RESERVE, pane.clientHeight - height - PANE_MARGIN);
  let y: number;
  let dock: Dock;
  if (top - BLOCK_GAP - height >= minimumY) {
    y = top - BLOCK_GAP - height;
    dock = "above";
  } else if (bottom + BLOCK_GAP + height <= pane.clientHeight - PANE_MARGIN) {
    y = Math.max(minimumY, bottom + BLOCK_GAP);
    dock = "below";
  } else {
    y = clamp(Math.max(minimumY, top + BLOCK_GAP), PANE_MARGIN, pane.clientHeight - height - PANE_MARGIN);
    dock = "inside";
  }

  let handleX = clamp(right - HANDLE_SIZE, PANE_MARGIN, pane.clientWidth - HANDLE_SIZE - PANE_MARGIN);
  const handleY = y + (height - HANDLE_SIZE) / 2;
  // Standalone HTML providers keep their source-view menu in this pane. The rail remains usable beside it.
  const sourceMenu = pane.closest(".html-document-editor")?.querySelector(".html-editor-options")?.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  if (!active && sourceMenu && handleX + HANDLE_SIZE > sourceMenu.left - paneRect.left - ITEM_GAP
    && handleX < sourceMenu.right - paneRect.left + ITEM_GAP
    && handleY + HANDLE_SIZE > sourceMenu.top - paneRect.top - ITEM_GAP
    && handleY < sourceMenu.bottom - paneRect.top + ITEM_GAP) {
    handleX = clamp(sourceMenu.left - paneRect.left - HANDLE_SIZE - ITEM_GAP,
      PANE_MARGIN, pane.clientWidth - HANDLE_SIZE - PANE_MARGIN);
  }

  let menuPosition: ActionRailLayout["menu"] = null;
  if (menu && menuWidth > 0) {
    const maxX = pane.clientWidth - menuWidth - PANE_MARGIN;
    let menuX = clamp((left + right - menuWidth) / 2, PANE_MARGIN, maxX);
    const overlapsHandle = () => menuX < handleX + HANDLE_SIZE + ITEM_GAP && menuX + menuWidth + ITEM_GAP > handleX;
    if (!active && overlapsHandle()) {
      const beforeHandle = handleX - ITEM_GAP - menuWidth;
      const afterHandle = handleX + HANDLE_SIZE + ITEM_GAP;
      if (beforeHandle >= PANE_MARGIN) menuX = beforeHandle;
      else if (afterHandle + menuWidth <= pane.clientWidth - PANE_MARGIN) menuX = afterHandle;
    }
    menuPosition = { x: menuX, y: (height - menuHeight) / 2 };
  }
  return { y, height, dock, handle: { x: handleX, y: handleY, width: HANDLE_SIZE, height: HANDLE_SIZE }, menu: menuPosition };
}

/**
 * Owns the geometry for every block-level HTML action. The circular entry affordance is pinned to the block's
 * right edge before activation; edit mode replaces it with a centered formatting menu on the same dock.
 */
export function HtmlBlockActionRail({ selection, viewport, handle, bounds, active, keep, activate, children }: {
  selection: HtmlSelectionMessage;
  viewport: RefObject<HTMLDivElement>;
  handle: RefObject<HTMLButtonElement>;
  bounds: MutableRefObject<HtmlActionBounds | null>;
  active: boolean;
  keep: () => void;
  activate: () => void;
  children?: ReactNode;
}) {
  const { t } = useLocalization();
  const menu = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ActionRailLayout | null>(null);
  useLayoutEffect(() => {
    const pane = viewport.current;
    if (!pane) return;
    const place = () => {
      const next = placeRail(selection, pane, menu.current, active);
      bounds.current = active ? null : next?.handle ?? null;
      setLayout((current) => sameLayout(current, next) ? current : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(pane);
    if (menu.current) observer.observe(menu.current);
    return () => { observer.disconnect(); bounds.current = null; };
  }, [selection, viewport, bounds, active]);

  if (!layout) return null;
  return <div className="html-block-action-rail" data-placement={layout.dock}
    style={{ top: layout.y, height: layout.height }}>
    {children && <div ref={menu} className="html-block-action-rail__menu" data-html-control
      style={layout.menu ? { left: layout.menu.x, top: layout.menu.y } : { visibility: "hidden" }}
      onPointerEnter={keep} onFocus={keep}>{children}</div>}
    {!active && <button ref={handle} type="button" className="html-editor-pencil" data-html-control data-placement={layout.dock}
      title={t("editor.html.editBlock")} aria-label={t("editor.html.editBlock")} aria-pressed={active}
      style={{ left: layout.handle.x, top: layout.handle.y - layout.y, width: layout.handle.width, height: layout.handle.height }}
      onPointerEnter={keep} onFocus={keep} onClick={activate}><Pencil size={14} strokeWidth={2.2} /></button>}
  </div>;
}

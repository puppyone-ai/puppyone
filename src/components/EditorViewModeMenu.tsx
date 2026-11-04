import { Tooltip, type EditorPaneMenuSegmentedControl } from "@puppyone/shared-ui";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSurface } from "./DesktopMenu";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "./useAnchoredOverlayPosition";

const MENU_MAX_HEIGHT = 320;
const MENU_ITEM_SELECTOR = '[role="menuitemradio"]';

/**
 * A document's view switch as one quiet control: the current view's own icon,
 * one press from the others, as the Homepage's layout switch is.
 */
export function EditorViewModeMenu({ item, boundarySelector, className }: Readonly<{
  item: EditorPaneMenuSegmentedControl;
  /** Where the menu may open. */
  boundarySelector: string;
  /** The trigger's look, owned by the surface it sits on. */
  className: string;
}>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = item.options.find((option) => option.id === item.value) ?? item.options[0];
  const triggerLabel = current ? `${item.label}: ${current.label}` : item.label;
  const { overlayRef, setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef: triggerRef,
    boundarySelector,
    // CSS owns the intrinsic width; positioning only limits available space.
    preferredWidth: 0,
    widthMode: "content",
    preferredMaxHeight: MENU_MAX_HEIGHT,
    gap: 4,
    margin: 8,
    alignment: "end",
    placementPreference: "below",
  });

  useEffect(() => {
    if (!open) return undefined;
    const isInside = (target: EventTarget | null) => target instanceof Node && Boolean(
      triggerRef.current?.contains(target) || overlayRef.current?.contains(target),
    );
    const dismiss = (event: Event) => {
      if (!isInside(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      const menu = overlayRef.current;
      if (!menu?.contains(event.target as Node)) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR));
      if (items.length === 0) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = items.length - 1;
      items[next]?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismiss, true);
    document.addEventListener("keydown", onKeyDown, true);
    const frame = requestAnimationFrame(() => {
      const menu = overlayRef.current;
      (menu?.querySelector<HTMLButtonElement>(`${MENU_ITEM_SELECTOR}[aria-checked="true"]`)
        ?? menu?.querySelector<HTMLButtonElement>(MENU_ITEM_SELECTOR))?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", dismiss, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, overlayRef]);

  const menuStyle = overlayPosition
    ? {
        left: overlayPosition.left,
        top: overlayPosition.top,
        maxWidth: overlayPosition.maxWidth,
        maxHeight: overlayPosition.maxHeight,
      }
    : {
        left: 0,
        top: 0,
        maxHeight: MENU_MAX_HEIGHT,
        visibility: "hidden",
        pointerEvents: "none",
      } satisfies CSSProperties;

  return (
    <>
      <Tooltip content={triggerLabel}><button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {current?.icon}
      </button></Tooltip>
      {open && (
        <DesktopOverlayLayer>
          <DesktopMenuSurface
            ref={setOverlayRef}
            className="desktop-editor-pane-menu desktop-editor-view-mode-menu"
            elevation="compact"
            ariaLabel={item.label}
            style={menuStyle}
          >
            <DesktopMenuSection>
              {item.options.map((option) => {
                const selected = option.id === item.value;
                return (
                  <DesktopMenuItem
                    key={option.id}
                    role="menuitemradio"
                    aria-checked={selected}
                    icon={option.icon}
                    label={option.label}
                    trailing={selected ? <Check size={14} strokeWidth={1.85} aria-hidden="true" /> : undefined}
                    onClick={() => {
                      setOpen(false);
                      if (!selected) item.setValue(option.id);
                    }}
                  />
                );
              })}
            </DesktopMenuSection>
          </DesktopMenuSurface>
        </DesktopOverlayLayer>
      )}
    </>
  );
}

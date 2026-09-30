import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { DesktopMenuSurface } from "../../components/DesktopMenu";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "./useAnchoredOverlayPosition";

type DesktopTitlebarMenuLayerProps = {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className: string;
  gap?: number;
  onDismiss: () => void;
  open: boolean;
  preferredMaxHeight: number;
  preferredWidth?: number;
  alignment?: "start" | "center" | "end";
  role?: "menu" | "dialog";
  id?: string;
  ariaLabel?: string;
};

const TITLEBAR_CONTEXT_MENU_WIDTH = 300;

/**
 * Keeps Header controls in the native chrome tree while rendering their
 * floating menus in the shared overlay root. Header width and clipping must
 * never determine whether a menu is visible.
 */
export function DesktopTitlebarMenuLayer({
  anchorRef,
  children,
  className,
  gap = 4,
  onDismiss,
  open,
  preferredMaxHeight,
  preferredWidth = TITLEBAR_CONTEXT_MENU_WIDTH,
  alignment = "start",
  role = "menu",
  id,
  ariaLabel,
}: DesktopTitlebarMenuLayerProps) {
  const { overlayRef, setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef,
    preferredWidth,
    preferredMaxHeight,
    gap,
    margin: 8,
    alignment,
    placementPreference: "below",
  });
  const focusedOnOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      focusedOnOpen.current = false;
      return;
    }
    // The Portal first mounts hidden for measurement; focus after positioning.
    if (role === "dialog" && overlayPosition && !focusedOnOpen.current) {
      overlayRef.current?.focus({ preventScroll: true });
      focusedOnOpen.current = true;
    }
  }, [open, overlayPosition, overlayRef, role]);

  useEffect(() => {
    if (!open) return undefined;

    const isInsideMenu = (target: EventTarget | null) => target instanceof Node && Boolean(
      anchorRef.current?.contains(target) || overlayRef.current?.contains(target),
    );
    const isInsideModal = (target: EventTarget | null) => role === "dialog"
      && target instanceof Element
      && Boolean(target.closest('[aria-modal="true"], [data-desktop-dialog-root="true"]'));
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!isInsideMenu(event.target) && !isInsideModal(event.target)) onDismiss();
    };
    const closeOnFocusExit = (event: FocusEvent) => {
      if (!isInsideMenu(event.target) && !isInsideModal(event.target)) onDismiss();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      if (role === "dialog" && !isInsideMenu(event.target)) return;
      onDismiss();
      const anchor = anchorRef.current;
      const trigger = anchor?.matches("[aria-haspopup]") ? anchor
        : anchor?.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]')
          ?? anchor?.querySelector<HTMLElement>("[aria-haspopup]");
      trigger?.focus();
    };

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("focusin", closeOnFocusExit, true);
    // Git details consume Escape to go Back; the card closes after that handler.
    const captureEscape = role === "menu";
    document.addEventListener("keydown", closeOnEscape, captureEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("focusin", closeOnFocusExit, true);
      document.removeEventListener("keydown", closeOnEscape, captureEscape);
    };
  }, [anchorRef, onDismiss, open, overlayRef, role]);

  if (!open) return null;

  const style = overlayPosition
    ? {
        left: overlayPosition.left,
        top: overlayPosition.top,
        width: overlayPosition.width,
        maxHeight: overlayPosition.maxHeight,
      }
    : {
        left: 0,
        top: 0,
        width: preferredWidth,
        maxHeight: preferredMaxHeight,
        visibility: "hidden",
        pointerEvents: "none",
      } satisfies CSSProperties;

  return (
    <DesktopOverlayLayer>
      <DesktopMenuSurface
        ref={setOverlayRef}
        role={role}
        id={id}
        ariaLabel={ariaLabel}
        tabIndex={role === "dialog" ? -1 : undefined}
        className={`desktop-titlebar-menu desktop-titlebar-menu-overlay ${className}`}
        data-titlebar-context-menu="true"
        elevation="compact"
        tone="quiet"
        typographySurface="left-sidebar"
        style={style}
      >
        {children}
      </DesktopMenuSurface>
    </DesktopOverlayLayer>
  );
}

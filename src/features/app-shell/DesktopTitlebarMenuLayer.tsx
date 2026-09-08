import { useEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
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
}: DesktopTitlebarMenuLayerProps) {
  const { overlayRef, setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef,
    preferredWidth: TITLEBAR_CONTEXT_MENU_WIDTH,
    preferredMaxHeight,
    gap,
    margin: 8,
  });

  useEffect(() => {
    if (!open) return undefined;

    const isInsideMenu = (target: EventTarget | null) => target instanceof Node && Boolean(
      anchorRef.current?.contains(target) || overlayRef.current?.contains(target),
    );
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!isInsideMenu(event.target)) onDismiss();
    };
    const closeOnFocusExit = (event: FocusEvent) => {
      if (!isInsideMenu(event.target)) onDismiss();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onDismiss();
      anchorRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
    };

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("focusin", closeOnFocusExit, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("focusin", closeOnFocusExit, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [anchorRef, onDismiss, open, overlayRef]);

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
        width: TITLEBAR_CONTEXT_MENU_WIDTH,
        maxHeight: preferredMaxHeight,
        visibility: "hidden",
        pointerEvents: "none",
      } satisfies CSSProperties;

  return (
    <DesktopOverlayLayer>
      <DesktopMenuSurface
        ref={setOverlayRef}
        className={`desktop-titlebar-menu desktop-titlebar-menu-overlay ${className}`}
        data-titlebar-context-menu="true"
        typographySurface="header"
        style={style}
      >
        {children}
      </DesktopMenuSurface>
    </DesktopOverlayLayer>
  );
}

import { useEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
import { DesktopMenuSurface } from "../../../components/DesktopMenu";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../../app-shell/useAnchoredOverlayPosition";

const SHARE_POPOVER_WIDTH = 208;
const SHARE_POPOVER_MAX_HEIGHT = 480;

/**
 * Hover preview anchored under the Header control. It keeps the existing menu
 * surface so the sharing action remains available from the card.
 */
export function CloudSharePopover({
  anchorRef,
  ariaLabel,
  children,
  open,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  children: ReactNode;
  open: boolean;
  onDismiss: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const { overlayRef, setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef,
    preferredWidth: SHARE_POPOVER_WIDTH,
    preferredMaxHeight: SHARE_POPOVER_MAX_HEIGHT,
    gap: 6,
    margin: 8,
    alignment: "center",
    placementPreference: "below",
  });

  useEffect(() => {
    if (!open) return undefined;
    const isInside = (target: EventTarget | null) => target instanceof Node && Boolean(
      anchorRef.current?.contains(target) || overlayRef.current?.contains(target),
    );
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) onDismiss();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onDismiss();
      anchorRef.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [anchorRef, onDismiss, open, overlayRef]);

  if (!open) return null;

  const style: CSSProperties = overlayPosition
    ? {
        left: overlayPosition.left,
        top: overlayPosition.top,
        width: overlayPosition.width,
        maxHeight: overlayPosition.maxHeight,
      }
    : {
        left: 0,
        top: 0,
        width: SHARE_POPOVER_WIDTH,
        maxHeight: SHARE_POPOVER_MAX_HEIGHT,
        visibility: "hidden",
        pointerEvents: "none",
      };

  return (
    <DesktopOverlayLayer>
      <DesktopMenuSurface
        ref={setOverlayRef}
        role="dialog"
        ariaLabel={ariaLabel}
        className="desktop-titlebar-menu desktop-titlebar-menu-overlay desktop-share-popover"
        data-positioned={overlayPosition ? "true" : undefined}
        elevation="compact"
        tone="quiet"
        typographySurface="ui"
        style={style}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {children}
      </DesktopMenuSurface>
    </DesktopOverlayLayer>
  );
}

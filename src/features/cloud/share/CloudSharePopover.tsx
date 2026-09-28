import { useEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
import { DesktopMenuSurface } from "../../../components/DesktopMenu";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../../app-shell/useAnchoredOverlayPosition";

const SHARE_POPOVER_WIDTH = 292;
const SHARE_POPOVER_MAX_HEIGHT = 480;

/**
 * Anchored, read-only status card under the Header cloud control. Opens on
 * hover and stays while the pointer is inside; a click pins it until the user
 * clicks elsewhere or presses Escape.
 */
export function CloudSharePopover({
  anchorRef,
  ariaLabel,
  children,
  open,
  pinned,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  children: ReactNode;
  open: boolean;
  pinned: boolean;
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
        data-pinned={pinned || undefined}
        typographySurface="header"
        style={style}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {children}
      </DesktopMenuSurface>
    </DesktopOverlayLayer>
  );
}

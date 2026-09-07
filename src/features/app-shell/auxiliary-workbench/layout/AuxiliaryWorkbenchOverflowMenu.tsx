import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import {
  DesktopMenuIconButton,
  DesktopMenuItem,
  DesktopMenuSurface,
} from "../../../../components/DesktopMenu";
import { DesktopOverlayLayer } from "../../DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../../useAnchoredOverlayPosition";
import type { AuxiliaryWorkbenchHeaderItem } from "./AuxiliaryWorkbenchHeader.types";
import { AuxiliaryWorkbenchStatus } from "./AuxiliaryWorkbenchStatus";

export function AuxiliaryWorkbenchOverflowMenu({
  items,
  onActivate,
  onClose,
}: {
  items: readonly AuxiliaryWorkbenchHeaderItem[];
  onActivate: (itemId: string) => void;
  onClose: (itemId: string) => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const label = t("terminal.tabs.more", { count: items.length });
  const { overlayRef, setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef: triggerRef,
    boundarySelector: ".desktop-terminal-panel",
    preferredWidth: 260,
    preferredMaxHeight: 320,
    gap: 4,
    margin: 8,
  });

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (triggerRef.current?.contains(target) || overlayRef.current?.contains(target))) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", handleKeyDown, true);
    const frame = requestAnimationFrame(() => {
      overlayRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
        ?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, overlayRef]);

  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  const menuStyle = overlayPosition
    ? {
        left: overlayPosition.left,
        top: overlayPosition.top,
        width: overlayPosition.width,
        maxHeight: overlayPosition.maxHeight,
      }
    : {
        left: 0,
        top: 0,
        width: 260,
        maxHeight: 320,
        visibility: "hidden",
        pointerEvents: "none",
      } satisfies CSSProperties;

  return (
    <>
      <div className="desktop-terminal-tab-overflow-wrap" ref={triggerRef}>
        <DesktopMenuIconButton
          className="desktop-terminal-tab-overflow-trigger"
          label={label}
          icon={<MoreHorizontal size={14} strokeWidth={1.9} aria-hidden="true" />}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        />
      </div>
      {open && (
        <DesktopOverlayLayer>
          <DesktopMenuSurface
            ref={setOverlayRef}
            ariaLabel={label}
            className="desktop-terminal-tab-overflow-menu"
            style={menuStyle}
          >
            {items.map((item) => (
              <div key={item.id} className="desktop-terminal-tab-overflow-row" role="none">
                <DesktopMenuItem
                  className="desktop-terminal-tab-overflow-select"
                  detail={item.snapshot.detail ?? undefined}
                  icon={<AuxiliaryWorkbenchStatus
                    className="desktop-terminal-tab-overflow-status"
                    item={item}
                  />}
                  label={item.snapshot.title}
                  role="menuitemradio"
                  aria-checked="false"
                  onClick={() => {
                    setOpen(false);
                    onActivate(item.id);
                  }}
                />
                <DesktopMenuIconButton
                  className="desktop-terminal-tab-overflow-close"
                  role="menuitem"
                  label={t("terminal.closeSession", { title: item.snapshot.title })}
                  icon={<X size={12} strokeWidth={1.8} aria-hidden="true" />}
                  onClick={() => {
                    setOpen(false);
                    onClose(item.id);
                  }}
                />
              </div>
            ))}
          </DesktopMenuSurface>
        </DesktopOverlayLayer>
      )}
    </>
  );
}

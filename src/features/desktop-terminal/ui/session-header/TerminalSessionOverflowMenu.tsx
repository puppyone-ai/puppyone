import { Tooltip } from "@puppyone/shared-ui";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { MoreHorizontal, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import {
  DesktopMenuIconButton,
  DesktopMenuItem,
  DesktopMenuSurface,
} from "../../../../components/DesktopMenu";
import { DesktopOverlayLayer } from "../../../../components/DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../../../../components/useAnchoredOverlayPosition";
import { TerminalSessionHeaderStatus } from "./TerminalSessionHeaderStatus";
import type { TerminalSessionHeaderItem } from "./types";

type TerminalSessionOverflowMenuProps = {
  items: readonly TerminalSessionHeaderItem[];
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
};

export function TerminalSessionOverflowMenu({
  items,
  onActivate,
  onClose,
}: TerminalSessionOverflowMenuProps) {
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
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.querySelector("button")?.focus();
        return;
      }
      if (!overlayRef.current?.contains(event.target as Node)) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const menuItems = Array.from(
        overlayRef.current.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)'),
      );
      if (menuItems.length === 0) return;
      event.preventDefault();
      const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? menuItems.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + menuItems.length) % menuItems.length
            : (currentIndex + 1) % menuItems.length;
      menuItems[nextIndex]?.focus({ preventScroll: true });
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
        <Tooltip content={label}><DesktopMenuIconButton
          className="desktop-terminal-tab-overflow-trigger"
          label={label}
          icon={<MoreHorizontal size={14} strokeWidth={1.9} aria-hidden="true" />}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        /></Tooltip>
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
              <TerminalOverflowSessionRow
                key={item.session.id}
                item={item}
                onActivate={() => {
                  setOpen(false);
                  onActivate(item.session.id);
                }}
                onClose={() => {
                  setOpen(false);
                  onClose(item.session.id);
                }}
              />
            ))}
          </DesktopMenuSurface>
        </DesktopOverlayLayer>
      )}
    </>
  );
}

function TerminalOverflowSessionRow({
  item,
  onActivate,
  onClose,
}: {
  item: TerminalSessionHeaderItem;
  onActivate: () => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const { presentation, runtime, session } = item;

  return (
    <div className="desktop-terminal-tab-overflow-row" role="none">
      <DesktopMenuItem
        className="desktop-terminal-tab-overflow-select"
        detail={presentation.overflowDetail}
        icon={(
          <TerminalSessionHeaderStatus
            className="desktop-terminal-tab-overflow-status"
            runtime={runtime}
            session={session}
          />
        )}
        label={presentation.overflowLabel}
        role="menuitemradio"
        aria-checked="false"
        onClick={onActivate}
      />
      <Tooltip content={t("terminal.closeSession", { title: presentation.sessionTitle })}><DesktopMenuIconButton
        className="desktop-terminal-tab-overflow-close"
        role="menuitem"
        label={t("terminal.closeSession", { title: presentation.sessionTitle })}
        icon={<X size={12} strokeWidth={1.8} aria-hidden="true" />}
        onClick={onClose}
      /></Tooltip>
    </div>
  );
}

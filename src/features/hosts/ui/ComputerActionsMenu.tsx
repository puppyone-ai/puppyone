import { Ellipsis, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { DesktopMenuItem, DesktopMenuSurface } from "../../../components/DesktopMenu";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { resolveDesktopActionMenuPositionBeside } from "../../../components/DesktopSidebarActionMenu";
import { useDesktopSidebarMenuInteraction } from "../../../components/useDesktopSidebarMenuInteraction";
import { walkDesktopMenu } from "../../../components/desktopMenuKeyboard";

/** Removing a computer is a secondary action; Main still owns its confirmation. */
export function ComputerActionsMenu({ name, current = false, disabled, onRemove, open, onOpenChange }: {
  name: string; current?: boolean; disabled: boolean; onRemove: () => void;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocalization();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = t("hosts.home.computerActions", { host: bidiIsolate(name) });
  return <>
    <button ref={trigger} type="button" className="desktop-utility-icon-button computer-access-more"
      aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      data-desktop-sidebar-menu-trigger="true"
      onClick={() => { setAnchor(trigger.current?.getBoundingClientRect() ?? null); onOpenChange(!open); }}>
      <Ellipsis size={16} aria-hidden="true" />
    </button>
    {open && anchor && <ActionsPopup anchor={anchor} label={label}
      removeLabel={t(current ? "hosts.settings.removeThis" : "hosts.settings.removeComputer", { host: bidiIsolate(name) })}
      onDismiss={() => onOpenChange(false)} onRestoreFocus={() => trigger.current?.focus()}
      onRemove={() => { onOpenChange(false); onRemove(); }} />}
  </>;
}

function ActionsPopup({ anchor, label, removeLabel, onDismiss, onRestoreFocus, onRemove }: {
  anchor: DOMRect; label: string; removeLabel: string; onDismiss: () => void; onRestoreFocus: () => void; onRemove: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useDesktopSidebarMenuInteraction({ menuRef: menu, anchor, onDismiss,
    onEscape: (event) => { event.preventDefault(); event.stopPropagation(); onDismiss(); onRestoreFocus(); } });
  const position = resolveDesktopActionMenuPositionBeside(anchor, { menuWidth: 210, estimatedHeight: 48 });
  return <DesktopOverlayLayer>
    <DesktopMenuSurface ref={menu} ariaLabel={label} className="computer-access-menu" elevation="compact"
      style={{ position: "fixed", ...position, width: 210 }}
      onKeyDown={(event) => {
        if (event.key === "Tab") { onDismiss(); return; }
        walkDesktopMenu(event, menu.current);
      }}>
      <DesktopMenuItem destructive icon={<Trash2 size={14} />} label={removeLabel} onClick={onRemove} />
    </DesktopMenuSurface>
  </DesktopOverlayLayer>;
}

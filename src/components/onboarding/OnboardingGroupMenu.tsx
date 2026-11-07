import { Tooltip } from "@puppyone/shared-ui";
import { ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DesktopOverlayLayer } from "../DesktopOverlayPortal";
import { DesktopSidebarActionMenu } from "../DesktopSidebarActionMenu";
import { desktopMenuItems, walkDesktopMenu } from "../desktopMenuKeyboard";

const GROUP_MENU_WIDTH = 288;
const GROUP_MENU_GAP = 4;
const VIEWPORT_MARGIN = 12;

/**
 * A named action at the end of a Homepage group's head, such as adding a project
 * to that group. Its menu floats above the page, so the groups' own scrolling can
 * never clip it, and closes on a press elsewhere, Escape, Tab, or the page moving
 * under it. Without `text` the trigger is the arrow of a split action.
 */
export function OnboardingGroupMenu({ label, text, icon, action, pending = false, disabled = false, children }: {
  /** What the menu does, for its tooltip and assistive technology. */
  label: string;
  /** The words on the trigger. */
  text?: string;
  icon?: ReactNode;
  /** The trigger's `data-onboarding-action`, when it is one of the ways to start a project. */
  action?: string;
  /** What it started is still under way. */
  pending?: boolean;
  disabled?: boolean;
  /** The menu's items; `close` dismisses it. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const place = () => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const height = menu?.getBoundingClientRect().height ?? 120;
    const below = anchor.bottom + GROUP_MENU_GAP;
    const top = below + height + VIEWPORT_MARGIN <= window.innerHeight ? below : anchor.top - GROUP_MENU_GAP - height;
    const left = Math.min(Math.max(anchor.right - GROUP_MENU_WIDTH, VIEWPORT_MARGIN),
      window.innerWidth - GROUP_MENU_WIDTH - VIEWPORT_MARGIN);
    setPosition((current) => current.top === top && current.left === left ? current : { top: Math.max(top, VIEWPORT_MARGIN), left });
  };

  useLayoutEffect(() => {
    if (!open || !menu) return;
    place();
    desktopMenuItems(menu)[0]?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- placed once per opening, when the menu exists
  }, [open, menu]);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && (menu?.contains(event.target) || triggerRef.current?.contains(event.target))) return;
      setOpen(false);
    };
    const leave = (event: Event) => {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", leave);
    window.addEventListener("scroll", leave, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", leave);
      window.removeEventListener("scroll", leave, true);
    };
  }, [menu, open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return <>
    <Tooltip content={label}>
      <button ref={triggerRef} type="button"
        className={`onboarding-group-action onboarding-project-group-menu ${text ? "" : "is-split-arrow"}`}
        data-onboarding-action={action} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-busy={pending || undefined} disabled={disabled}
        onClick={() => setOpen((current) => !current)}>
        {icon}
        {text && <span>{text}</span>}
        <ChevronDown size={12} strokeWidth={1.85} aria-hidden="true" />
      </button>
    </Tooltip>
    {open && <DesktopOverlayLayer>
      <DesktopSidebarActionMenu ref={setMenu} className="onboarding-project-group-menu-surface" ariaLabel={label}
        style={{ ...position, width: GROUP_MENU_WIDTH }}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          walkDesktopMenu(event, menu);
        }}>
        {children(close)}
      </DesktopSidebarActionMenu>
    </DesktopOverlayLayer>}
  </>;
}

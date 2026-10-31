import { Tooltip } from "@puppyone/shared-ui";
import type { ReactNode } from "react";
import { DesktopMenuSurface } from "../DesktopMenu";
import { useOnboardingMenu } from "./useOnboardingMenu";

/** A quiet control in the projects' toolbar that opens a menu of its own. */
export function OnboardingToolbarMenu({ label, triggerLabel, trigger, text = false, active = false, multiple = false, disabled, children }: {
  /** What the menu does, shown as the tooltip and given to the menu itself. */
  label: string;
  /** What the control is set to right now. */
  triggerLabel: string;
  trigger: ReactNode;
  /** The control carries words as well as an icon. */
  text?: boolean;
  active?: boolean;
  /** Choices stay open and accumulate, so the menu must hold its width and place. */
  multiple?: boolean;
  disabled: boolean;
  /** The menu's items; `close` dismisses it, for items that finish the choice. */
  children: (close: () => void) => ReactNode;
}) {
  const menu = useOnboardingMenu();
  return (
    <div ref={menu.rootRef} className="onboarding-view-menu-root">
      <Tooltip content={label}>
        <button
          type="button"
          className={`po-icon-button ${text ? "onboarding-view-menu-trigger" : ""} ${active ? "is-active" : ""}`}
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          disabled={disabled}
          onClick={menu.toggle}
        >
          {trigger}
        </button>
      </Tooltip>
      {menu.open && (
        <DesktopMenuSurface
          ref={menu.menuRef}
          className={`onboarding-view-menu ${multiple ? "is-multiple" : ""}`}
          ariaLabel={label}
          elevation="compact"
          onKeyDown={menu.onKeyDown}
        >
          {children(menu.close)}
        </DesktopMenuSurface>
      )}
    </div>
  );
}

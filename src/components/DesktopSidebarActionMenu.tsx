import { forwardRef } from "react";
import {
  DesktopMenuSurface,
  type DesktopMenuSurfaceProps,
} from "./DesktopMenu";

const SIDEBAR_ACTION_MENU_GAP = 4;
const SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN = 12;

export type DesktopSidebarActionMenuAnchor = Pick<DOMRect, "left" | "bottom">;

export type DesktopSidebarActionMenuPositionOptions = Readonly<{
  menuWidth: number;
  estimatedHeight: number;
  viewportWidth?: number;
  viewportHeight?: number;
}>;

export function resolveDesktopSidebarActionMenuPosition(
  anchor: DesktopSidebarActionMenuAnchor,
  {
    menuWidth,
    estimatedHeight,
    viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth,
    viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight,
  }: DesktopSidebarActionMenuPositionOptions,
) {
  const maxLeft = Math.max(
    SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
    viewportWidth - menuWidth - SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
  );
  const maxTop = Math.max(
    SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
    viewportHeight - estimatedHeight - SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
  );

  return {
    left: clamp(anchor.left, SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN, maxLeft),
    top: clamp(
      anchor.bottom + SIDEBAR_ACTION_MENU_GAP,
      SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
      maxTop,
    ),
  };
}

export type DesktopSidebarActionMenuProps = Omit<
  DesktopMenuSurfaceProps,
  "elevation" | "tone" | "typographySurface"
>;

/**
 * Shared menu surface for actions launched from a left-sidebar row.
 *
 * Feature owners keep their own commands and widths, while anchor geometry,
 * typography, tone, and elevation stay consistent across sidebar domains.
 */
export const DesktopSidebarActionMenu = forwardRef<
  HTMLDivElement,
  DesktopSidebarActionMenuProps
>(function DesktopSidebarActionMenu({ className, ...props }, ref) {
  return (
    <DesktopMenuSurface
      ref={ref}
      className={["desktop-sidebar-action-menu", className].filter(Boolean).join(" ")}
      elevation="compact"
      tone="quiet"
      typographySurface="left-sidebar"
      {...props}
    />
  );
});

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

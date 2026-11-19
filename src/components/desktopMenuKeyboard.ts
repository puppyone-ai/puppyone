import type { KeyboardEvent } from "react";

export function desktopMenuItems(menu: HTMLElement | null) {
  return [...(menu?.querySelectorAll<HTMLButtonElement>(".desktop-menu-item:not(:disabled)") ?? [])];
}

/** The arrows walk a menu's items and wrap around; Home and End reach its ends. */
export function walkDesktopMenu(event: KeyboardEvent<HTMLElement>, menu: HTMLElement | null) {
  const items = desktopMenuItems(menu);
  const last = items.length - 1;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const target = {
    ArrowDown: current === last ? 0 : current + 1,
    ArrowUp: current <= 0 ? last : current - 1,
    Home: 0,
    End: last,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  items[target]?.focus();
}

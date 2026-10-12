import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { DesktopSidebarActionMenuAnchor } from "./DesktopSidebarActionMenu";

/** Shared lifecycle for mutually exclusive Sidebar menus. Marked launchers
 * replace the current menu in their click handler, without a dismissal gap. */
export function useDesktopSidebarMenuInteraction({
  menuRef,
  anchor,
  onDismiss,
  onEscape,
  autoFocus = true,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  anchor: DesktopSidebarActionMenuAnchor;
  onDismiss: () => void;
  onEscape?: (event: KeyboardEvent) => void;
  autoFocus?: boolean;
}) {
  const callbacks = useRef({ onDismiss, onEscape });
  useLayoutEffect(() => {
    callbacks.current = { onDismiss, onEscape };
  }, [onDismiss, onEscape]);

  useLayoutEffect(() => {
    if (autoFocus) {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
    }
  }, [anchor, autoFocus, menuRef]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || menuRef.current?.contains(target)) return;
      // Only a primary press on an enabled, explicitly opted-in launcher is
      // a handoff. Other outside interactions still dismiss immediately.
      if (event.button === 0 && target instanceof Element) {
        const trigger = target.closest<HTMLButtonElement>(
          'button[data-desktop-sidebar-menu-trigger="true"]',
        );
        if (trigger && !trigger.disabled && trigger.getAttribute("aria-disabled") !== "true") return;
      }
      callbacks.current.onDismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      if (callbacks.current.onEscape) callbacks.current.onEscape(event);
      else callbacks.current.onDismiss();
    };
    const handleViewportChange = (event: Event) => {
      // Scrolling a long menu must not dismiss that menu. Its fixed anchor
      // becomes stale only when the underlying page/Sidebar scrolls.
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      callbacks.current.onDismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [menuRef]);
}

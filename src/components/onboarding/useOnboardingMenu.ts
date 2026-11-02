import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * One menu opened from a button on the Homepage: focus moves into it, the arrow keys
 * walk its items, and Escape or a press outside closes it. Focus returns to the button
 * only when the menu is dismissed from inside it, never from a press elsewhere.
 */
export function useOnboardingMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>(".desktop-menu-item:not(:disabled)") ?? [])];

  useLayoutEffect(() => {
    if (!open) return;
    const available = items();
    (available.find((item) => item.getAttribute("aria-checked") === "true") ?? available[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const close = () => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const available = items();
    const current = available.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    available[(current + step + available.length) % available.length]?.focus();
  };

  return {
    open,
    rootRef,
    menuRef,
    close,
    toggle: () => setOpen((current) => !current),
    onKeyDown,
  };
}

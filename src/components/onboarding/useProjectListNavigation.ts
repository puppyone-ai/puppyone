import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { HomepageProjectLayout } from "../../preferenceStorage";

const OPEN_CONTROL = "[data-project-open]";

function columnsIn(controls: HTMLElement[]) {
  const firstRowTop = controls[0]?.getBoundingClientRect().top;
  const nextRow = controls.findIndex((control) => control.getBoundingClientRect().top !== firstRowTop);
  return nextRow === -1 ? controls.length : nextRow;
}

/** Where a key leads from one project, or nothing if it leads nowhere. */
function resolveTarget(key: string, current: number, last: number, columns: number, rtl: boolean) {
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (key === "ArrowUp") return current >= columns ? current - columns : null;
  if (key === "ArrowDown") {
    const nextRow = (Math.floor(current / columns) + 1) * columns;
    return nextRow <= last ? Math.min(current + columns, last) : null;
  }
  if (columns === 1 || (key !== "ArrowLeft" && key !== "ArrowRight")) return null;
  const forward = (key === "ArrowRight") !== rtl;
  const target = current + (forward ? 1 : -1);
  return target >= 0 && target <= last ? target : null;
}

/**
 * The list is one stop on the way through the page, as the arrow keys move inside it:
 * a roving tabindex. The stop is the project last focused, or the first while that
 * one is filtered out or gone. Only the stop's row can be tabbed into, so its actions
 * stay reachable without every project on the page lying in the way.
 */
export function useProjectListNavigation(itemIds: readonly string[], layout: HomepageProjectLayout) {
  const listRef = useRef<HTMLUListElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const stopId = focusedId !== null && itemIds.includes(focusedId) ? focusedId : itemIds[0] ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // Keys typed in a project's menu or dialog arrive here too, through their portals.
    if (!(event.target instanceof Element) || !event.target.matches(OPEN_CONTROL)) return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(OPEN_CONTROL)];
    const target = resolveTarget(
      event.key,
      controls.indexOf(event.target as HTMLElement),
      controls.length - 1,
      layout === "grid" ? columnsIn(controls) : 1,
      getComputedStyle(event.currentTarget).direction === "rtl",
    );
    if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") event.preventDefault();
    if (target !== null) controls[target]?.focus();
  };

  /** A project that left with focus inside it has no button to hand focus back to. */
  const leavingIdRef = useRef<string | null>(null);
  const handOffFocusIfGone = (id: string) => { leavingIdRef.current = id; };
  useLayoutEffect(() => {
    const leaving = leavingIdRef.current;
    if (leaving === null) return;
    leavingIdRef.current = null;
    if (!itemIds.includes(leaving)) {
      listRef.current?.querySelector<HTMLElement>(`${OPEN_CONTROL}[tabindex="0"]`)?.focus({ preventScroll: true });
    }
  });

  return { listRef, stopId, setFocusedId, onKeyDown, handOffFocusIfGone };
}

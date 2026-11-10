import { useEffect } from "react";

/** A place asked for from the Header; a new request carries a new nonce, so asking again scrolls again. */
export type HomepagePlaceFocus = Readonly<{ place: string; nonce: number }>;

const FOCUS_MS = 1600;
/** The page may still be arranging its groups when it is asked to show one. */
const WAIT_MS = 2000;
const RETRY_MS = 100;

function placeGroupId(place: string) {
  return place === "local" ? "local-only" : `space:${place}`;
}

/**
 * Brings one place's projects into view and marks them for a moment. A place
 * with no projects on this page has no group, so the page stays where it is.
 */
export function useProjectGroupFocus(focus: HomepagePlaceFocus | null | undefined) {
  useEffect(() => {
    if (!focus) return undefined;
    const id = placeGroupId(focus.place);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let group: HTMLElement | null = null;
    const startedAt = Date.now();
    const attempt = () => {
      group = document.querySelector<HTMLElement>(`[data-project-group="${CSS.escape(id)}"]`);
      if (!group) {
        if (Date.now() - startedAt < WAIT_MS) timer = setTimeout(attempt, RETRY_MS);
        return;
      }
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      group.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      group.setAttribute("data-project-group-focus", "");
      const shown = group;
      timer = setTimeout(() => shown.removeAttribute("data-project-group-focus"), FOCUS_MS);
    };
    attempt();
    return () => {
      if (timer) clearTimeout(timer);
      group?.removeAttribute("data-project-group-focus");
    };
  }, [focus]);
}

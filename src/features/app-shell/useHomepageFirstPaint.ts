import { useEffect, useState } from "react";

/**
 * The longest the first Homepage waits once workspace restoration ends. A cold
 * start refreshes its session before listing projects, and neither that listing
 * nor a dead network has a shorter limit, so local projects stop waiting here.
 */
export const HOMEPAGE_FIRST_PAINT_BUDGET_MS = 4000;

/**
 * Holds the first Homepage until its list can appear once, already in order,
 * instead of reordering as each source arrives. Later reloads never hold it again.
 */
export function useHomepageFirstPaint({ restoring, settled }: { restoring: boolean; settled: boolean }) {
  const [released, setReleased] = useState(false);
  const ready = released || (!restoring && settled);
  useEffect(() => {
    if (ready) { setReleased(true); return undefined; }
    if (restoring) return undefined;
    const timer = window.setTimeout(() => setReleased(true), HOMEPAGE_FIRST_PAINT_BUDGET_MS);
    return () => window.clearTimeout(timer);
  }, [ready, restoring]);
  return ready;
}

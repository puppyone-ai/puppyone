import { useEffect, useState } from "react";

/**
 * The longest a Homepage waits once workspace restoration ends. A cold start
 * refreshes its session before listing projects, and neither that listing nor a
 * dead network has a shorter limit, so local projects stop waiting here.
 */
export const HOMEPAGE_FIRST_PAINT_BUDGET_MS = 4000;

/** How long a click on Home waits for dates. Longer would read as a dead button. */
export const HOMEPAGE_RETURN_WAIT_MS = 1500;

/**
 * Holds the Homepage until its list can appear once, whole and in its final order,
 * instead of growing or moving as each source arrives. An account's list is held once: later reloads never
 * hold it again, but signing in to an account brings a list this Homepage has not shown.
 */
export function useHomepageFirstPaint({ restoring, settled, account = null, accountRestoring = false }: {
  restoring: boolean;
  settled: boolean;
  account?: string | null;
  /** The account is not known yet, so a Homepage released now is nobody's in particular. */
  accountRestoring?: boolean;
}) {
  const [released, setReleased] = useState<{ account: string | null; accountRestoring: boolean } | null>(null);
  // A list given up on while the session restored is not taken back when it turns up.
  const shown = released !== null && (released.accountRestoring || released.account === account);
  const ready = shown || (!restoring && settled);
  useEffect(() => {
    if (ready) { setReleased({ account, accountRestoring }); return undefined; }
    if (restoring) return undefined;
    const timer = window.setTimeout(() => setReleased({ account, accountRestoring }), HOMEPAGE_FIRST_PAINT_BUDGET_MS);
    return () => window.clearTimeout(timer);
  }, [account, accountRestoring, ready, restoring]);
  return ready;
}

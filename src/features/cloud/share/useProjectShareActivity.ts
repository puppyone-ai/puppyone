import { useEffect, useState } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { isPendingShareLive, type PendingShare } from "./shareStatus";
import { useProjectShares, type ProjectSharesState } from "./useProjectShares";

const RECEIPT_POLL_INTERVAL_MS = 5_000;
/** The backend may never report a read, so stop waiting instead of polling forever. */
const PENDING_SHARE_TTL_MS = 10 * 60_000;

export type ProjectShareActivity = Readonly<{
  shares: ProjectSharesState;
  pending: PendingShare | null;
  setPending: (pending: PendingShare | null) => void;
}>;

/**
 * Project shares plus the share still waiting for its first read. While one is
 * pending the list is polled, so the Header can flip from "Waiting for
 * Viktor…" to "1 Agent" without the Share dialog being open.
 */
export function useProjectShareActivity({
  session,
  apiBaseUrl,
  projectId,
  enabled,
  onSessionChange,
}: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  projectId: string | null;
  enabled: boolean;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}): ProjectShareActivity {
  const [pending, setPending] = useState<PendingShare | null>(null);
  const shares = useProjectShares({
    session,
    apiBaseUrl,
    projectId,
    enabled,
    pollIntervalMs: pending ? RECEIPT_POLL_INTERVAL_MS : 0,
    onSessionChange,
  });

  useEffect(() => {
    setPending(null);
  }, [enabled, projectId]);

  useEffect(() => {
    if (!pending) return undefined;
    if (shares.loaded && !shares.loading && !isPendingShareLive(pending, shares.shares)) {
      setPending(null);
      return undefined;
    }
    const remaining = Date.parse(pending.issuedAt) + PENDING_SHARE_TTL_MS - Date.now();
    const timer = window.setTimeout(() => setPending(null), Number.isNaN(remaining) ? 0 : Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [pending, shares]);

  return { shares, pending, setPending };
}

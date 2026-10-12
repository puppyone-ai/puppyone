import { useCallback, useMemo, useState } from "react";
import { deleteCloudMcpEndpoint, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectShare, ProjectSharesState } from "./useProjectShares";

export type ProjectShareRevoke = Readonly<{
  /** Stopping requires an authenticated session; without one the row states the fact only. */
  available: boolean;
  /** The share whose confirmation is showing, if any. */
  confirmingId: string | null;
  /** The share currently being stopped, if any. */
  pendingId: string | null;
  /** True after a failed attempt, until the next one starts. */
  failed: boolean;
  ask: (shareId: string) => void;
  dismiss: () => void;
  stop: (share: ProjectShare) => Promise<void>;
}>;

/**
 * Stopping someone's reach, as a two-step action any surface can host.
 *
 * Both the Header's reach list and the Share screen need the same thing: ask,
 * confirm, stop, then reload the list from the same source. The capability
 * lives here rather than inside one component so the two surfaces cannot drift
 * into two different revocations — a divergence neither the compiler nor the
 * tests would catch.
 *
 * The list itself stays owned by `useProjectShares`; this hook only mutates and
 * then asks that owner to reload.
 */
export function useProjectShareRevoke({
  session,
  apiBaseUrl,
  shares,
  onSessionChange,
}: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  shares: ProjectSharesState;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}): ProjectShareRevoke {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const ask = useCallback((shareId: string) => {
    setFailed(false);
    setConfirmingId(shareId);
  }, []);

  const dismiss = useCallback(() => {
    setConfirmingId(null);
    setFailed(false);
  }, []);

  const stop = useCallback(async (share: ProjectShare) => {
    if (!session) return;
    setPendingId(share.id);
    setFailed(false);
    try {
      await deleteCloudMcpEndpoint(session, share.id, onSessionChange, apiBaseUrl);
      setConfirmingId(null);
      await shares.reload();
    } catch {
      setFailed(true);
    } finally {
      setPendingId(null);
    }
  }, [apiBaseUrl, onSessionChange, session, shares]);

  return useMemo(() => ({
    available: session !== null,
    confirmingId,
    pendingId,
    failed,
    ask,
    dismiss,
    stop,
  }), [ask, confirmingId, dismiss, failed, pendingId, session, stop]);
}

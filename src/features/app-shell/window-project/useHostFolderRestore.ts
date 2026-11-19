import { useEffect, useRef } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { HostFolderSelection } from "../../hosts";
import { windowProjectStore } from "./windowProjectStore";

/**
 * Reopen the other computer's folder this account last had open, once per
 * window, only when the window restored nothing else. An offline computer
 * shows as offline inside the folder; it never falls back to a stale copy.
 */
export function useHostFolderRestore({ enabled, session, apiBase, restoring, open }: {
  enabled: boolean; session: DesktopCloudSession | null; apiBase: string | null; restoring: boolean;
  open: (selection: HostFolderSelection) => unknown;
}) {
  const attempted = useRef(false);
  const userId = session?.user_id ?? null;
  const generation = session?.session_generation ?? null;
  useEffect(() => {
    if (!enabled || attempted.current || restoring || !userId || !generation || !apiBase) return;
    attempted.current = true;
    const state = windowProjectStore.getState();
    if (state.folders || state.opening || state.shown !== "local") return;
    void window.puppyoneDesktop?.listRecentHostFolders?.({ userId, generation }).then((result) => {
      const last = result?.lastActive;
      const current = windowProjectStore.getState();
      if (!last || current.folders || current.opening || current.shown !== "local") return;
      open({ ref: { deployment: last.deployment, accountId: last.accountId, deviceId: last.deviceId,
        folderId: last.folderId }, name: last.name, hostName: last.hostName, writable: last.writable });
    }).catch(() => {});
  }, [enabled, restoring, userId, generation, apiBase, open]);
}

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { agentChangedFilesStore as store } from "./agentChangedFilesStore";

/** Opening a file captures its unread revision. A later edit must remain unread. */
export function useAgentFileReview(root: string, path: string | null, ready: boolean) {
  const openedVersion = useMemo(() => path ? store.version(root, path) : null, [root, path]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(root, listener), [root]);
  const snapshot = useCallback(() => path ? store.reviewVersion(root, path) : null, [root, path]);
  const requestedVersion = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => {
    if (path && ready) store.acknowledge(root, path, requestedVersion ?? openedVersion);
  }, [root, path, ready, openedVersion, requestedVersion]);
}

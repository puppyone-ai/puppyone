import { useEffect, useRef } from "react";

export type PersistentWorkbenchItemHosts = ReadonlyMap<string, HTMLDivElement>;

/** Owns one stable portal container per Session, independent of Group geometry. */
export function usePersistentWorkbenchItemHosts(
  sessionIds: readonly string[],
): PersistentWorkbenchItemHosts {
  const hostsRef = useRef<Map<string, HTMLDivElement> | null>(null);
  if (!hostsRef.current) hostsRef.current = new Map();
  const hosts = hostsRef.current;

  for (const sessionId of sessionIds) {
    if (hosts.has(sessionId)) continue;
    const host = document.createElement("div");
    host.className = "desktop-terminal-session-host";
    host.dataset.terminalSessionHostId = sessionId;
    hosts.set(sessionId, host);
  }

  useEffect(() => {
    const retained = new Set(sessionIds);
    for (const [sessionId, host] of hosts) {
      if (retained.has(sessionId)) continue;
      host.remove();
      hosts.delete(sessionId);
    }
  }, [hosts, sessionIds]);

  // Strict Mode replays effect cleanup without discarding component state.
  // Slot effects detach hosts; this owner must not clear still-live portals.
  return hosts;
}

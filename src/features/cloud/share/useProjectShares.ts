import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCloudDashboard,
  listCloudMcpEndpoints,
  type DesktopCloudDashboard,
  type DesktopCloudMcpEndpoint,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";

/**
 * One row in the "who can read this project" list. A share is an MCP endpoint
 * enriched with the last time any client actually used it, which is the only
 * evidence the desktop has that the other side connected.
 */
export type ProjectShare = Readonly<{
  id: string;
  name: string;
  path: string;
  readonly: boolean;
  status: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  endpoint: DesktopCloudMcpEndpoint;
}>;

export type ProjectSharesState = Readonly<{
  shares: ProjectShare[];
  loading: boolean;
  loaded: boolean;
  error: boolean;
  reload: () => Promise<void>;
}>;

export function useProjectShares({
  session,
  apiBaseUrl,
  projectId,
  enabled,
  pollIntervalMs = 0,
  onSessionChange,
}: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  projectId: string | null;
  enabled: boolean;
  /** When > 0, refetch on an interval (used while waiting for a receipt). */
  pollIntervalMs?: number;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}): ProjectSharesState {
  const [endpoints, setEndpoints] = useState<DesktopCloudMcpEndpoint[]>([]);
  const [dashboard, setDashboard] = useState<DesktopCloudDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef(0);
  const sessionRef = useRef(session);
  const onSessionChangeRef = useRef(onSessionChange);
  sessionRef.current = session;
  onSessionChangeRef.current = onSessionChange;
  const contextKey = session && projectId && enabled
    ? `${session.user_id}\u001f${session.session_generation}\u001f${apiBaseUrl ?? ""}\u001f${projectId}`
    : null;

  const reload = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!contextKey || !currentSession || !projectId) return;
    const request = ++requestRef.current;
    setLoading(true);
    const [endpointResult, dashboardResult] = await Promise.allSettled([
      listCloudMcpEndpoints(currentSession, projectId, onSessionChangeRef.current, apiBaseUrl),
      getCloudDashboard(currentSession, projectId, onSessionChangeRef.current, apiBaseUrl),
    ]);
    if (request !== requestRef.current) return;
    if (endpointResult.status === "fulfilled") {
      setEndpoints(endpointResult.value);
      setError(false);
    } else {
      setError(true);
    }
    if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);
    setLoaded(true);
    setLoading(false);
  }, [apiBaseUrl, contextKey, projectId]);

  useEffect(() => {
    requestRef.current += 1;
    setEndpoints([]);
    setDashboard(null);
    setLoaded(false);
    setError(false);
    if (!contextKey) {
      setLoading(false);
      return;
    }
    void reload();
  }, [contextKey, reload]);

  useEffect(() => {
    if (!contextKey || pollIntervalMs <= 0) return undefined;
    const timer = window.setInterval(() => {
      void reload();
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [contextKey, pollIntervalMs, reload]);

  const shares = useMemo(
    () => buildProjectShares(endpoints, dashboard),
    [dashboard, endpoints],
  );

  return useMemo(
    () => ({ shares, loading, loaded, error, reload }),
    [error, loaded, loading, reload, shares],
  );
}

export function buildProjectShares(
  endpoints: DesktopCloudMcpEndpoint[],
  dashboard: DesktopCloudDashboard | null,
): ProjectShare[] {
  const lastSeenById = new Map<string, string | null>();
  for (const connection of dashboard?.connections ?? []) {
    lastSeenById.set(connection.id, connection.last_synced_at ?? null);
  }
  return endpoints.map((endpoint) => {
    const access = endpoint.accesses?.[0];
    return {
      id: endpoint.id,
      name: endpoint.name,
      path: access?.path ?? endpoint.path ?? "",
      readonly: access?.readonly !== false,
      status: endpoint.status || "active",
      createdAt: endpoint.created_at ?? null,
      lastSeenAt: lastSeenById.get(endpoint.id) ?? null,
      endpoint,
    };
  });
}

/** True once the destination has used the endpoint after the share was issued. */
export function shareHasReceipt(share: ProjectShare | null | undefined, issuedAt: string | null): boolean {
  if (!share?.lastSeenAt) return false;
  if (!issuedAt) return true;
  const seen = Date.parse(share.lastSeenAt);
  const issued = Date.parse(issuedAt);
  if (Number.isNaN(seen) || Number.isNaN(issued)) return true;
  return seen >= issued;
}

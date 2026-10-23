import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DesktopCloudHistory,
} from "../../../lib/cloudHistoryApi";
import { acquireHistoryPage } from "./historyRepository";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import {
  isHistorySnapshotRestartError,
  mergeCloudHistoryPages,
} from "./pagination";
import { cloudMessage, type CloudMessageDescriptor } from "../cloudPresentation";

export type CloudHistoryDataState = {
  history: DesktopCloudHistory | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: CloudMessageDescriptor | null;
  warning: CloudMessageDescriptor | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
};

type CloudHistoryDataInternalState = Omit<CloudHistoryDataState, "reload" | "loadMore" | "hasMore"> & {
  contextKey: string | null;
};


export function useCloudHistoryData({
  session,
  projectId,
  apiBaseUrl,
  enabled = true,
  revisionKey,
  onSessionChange,
}: {
  session: DesktopCloudSession | null;
  projectId: string | null;
  apiBaseUrl: string | null;
  enabled?: boolean;
  revisionKey?: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}): CloudHistoryDataState {
  const canLoad = enabled && Boolean(session && projectId);
  const contextKey = canLoad && session && projectId
    ? [
        session.user_id,
        session.session_generation,
        session.api_base_url,
        apiBaseUrl ?? "",
        projectId,
        revisionKey ?? "mutable-latest",
      ].join("\n")
    : `disabled:${projectId ?? "none"}`;
  const [state, setState] = useState<CloudHistoryDataInternalState>(() => createCloudHistoryDataState());
  const activeRequestRef = useRef(0);
  const subscriptionRef = useRef<(() => void) | null>(null);
  const loadMoreCursorRef = useRef<string | null>(null);
  const sessionRef = useRef(session);
  const onSessionChangeRef = useRef(onSessionChange);
  sessionRef.current = session;
  onSessionChangeRef.current = onSessionChange;

  const load = useCallback(async () => {
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    loadMoreCursorRef.current = null;

    const activeSession = sessionRef.current;
    if (!canLoad || !activeSession || !projectId) {
      setState(createCloudHistoryDataState({ contextKey }));
      return;
    }

    setState((current) => (
      current.contextKey === contextKey
        ? {
            ...current,
            loading: true,
            loadingMore: false,
            error: null,
            warning: current.warning,
          }
        : createCloudHistoryDataState({
            loading: true,
            contextKey,
          })
    ));

    subscriptionRef.current?.();
    const subscription = acquireHistoryPage({ session: activeSession, projectId, apiBaseUrl, revisionKey }, null, onSessionChangeRef.current);
    subscriptionRef.current = subscription.release;
    if (subscription.cached) setState({ history: subscription.cached, loading: false, loadingMore: false,
      error: null, warning: getHistoryHealthWarning(subscription.cached), contextKey });
    try {
      const history = await subscription.promise;
      if (activeRequestRef.current !== requestId) return;
      setState({
        history,
        loading: false,
        loadingMore: false,
        error: null,
        warning: getHistoryHealthWarning(history),
        contextKey,
      });
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;
      setState({
        history: null,
        loading: false,
        loadingMore: false,
        error: cloudMessage("history-load-failed", undefined, error instanceof Error ? error.message : undefined),
        warning: null,
        contextKey,
      });
    }
  }, [apiBaseUrl, canLoad, contextKey, projectId, revisionKey]);

  const loadMore = useCallback(async () => {
    const currentHistory = state.contextKey === contextKey ? state.history : null;
    const cursor = currentHistory?.next_cursor ?? null;
    const activeSession = sessionRef.current;
    if (
      !canLoad
      || !activeSession
      || !projectId
      || state.loading
      || state.loadingMore
      || loadMoreCursorRef.current
      || !currentHistory?.has_more
      || !cursor
    ) return;

    loadMoreCursorRef.current = cursor;
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    setState((current) => (
      current.contextKey === contextKey
        ? { ...current, loadingMore: true, error: null }
        : current
    ));

    try {
      subscriptionRef.current?.();
      const subscription = acquireHistoryPage({ session: activeSession, projectId, apiBaseUrl, revisionKey }, cursor, onSessionChangeRef.current);
      subscriptionRef.current = subscription.release;
      const nextPage = await subscription.promise;
      if (activeRequestRef.current !== requestId) return;
      const mergedHistory = mergeCloudHistoryPages(currentHistory, nextPage);
      setState((current) => {
        if (current.contextKey !== contextKey || !current.history) return current;
        if (current.history.snapshot_id !== currentHistory.snapshot_id) return current;
        return {
          ...current,
          history: mergedHistory,
          loadingMore: false,
          error: null,
          warning: getHistoryHealthWarning(mergedHistory),
        };
      });
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;
      if (isHistorySnapshotRestartError(error)) {
        await load();
        return;
      }
      setState((current) => (
        current.contextKey === contextKey
          ? {
              ...current,
              loadingMore: false,
              error: cloudMessage("history-load-more-failed", undefined, error instanceof Error ? error.message : undefined),
            }
          : current
      ));
    } finally {
      if (loadMoreCursorRef.current === cursor) loadMoreCursorRef.current = null;
    }
  }, [
    apiBaseUrl,
    canLoad,
    contextKey,
    projectId,
    state.contextKey,
    state.history,
    state.loading,
    state.loadingMore,
    revisionKey,
    load,
  ]);

  useEffect(() => {
    void load();
    return () => {
      subscriptionRef.current?.();
      activeRequestRef.current += 1;
      loadMoreCursorRef.current = null;
    };
  }, [load]);

  if (state.contextKey !== contextKey) {
    return {
      ...toPublicCloudHistoryDataState(createCloudHistoryDataState({ loading: canLoad })),
      reload: load,
      loadMore,
    };
  }

  return {
    ...toPublicCloudHistoryDataState(state),
    reload: load,
    loadMore,
  };
}

function createCloudHistoryDataState(
  overrides: Partial<CloudHistoryDataInternalState> = {},
): CloudHistoryDataInternalState {
  return {
    history: null,
    loading: false,
    loadingMore: false,
    error: null,
    warning: null,
    contextKey: null,
    ...overrides,
  };
}

function toPublicCloudHistoryDataState({
  contextKey,
  ...publicState
}: CloudHistoryDataInternalState): Omit<CloudHistoryDataState, "reload" | "loadMore"> {
  void contextKey;
  return {
    ...publicState,
    hasMore: Boolean(publicState.history?.has_more && publicState.history.next_cursor),
  };
}

function getHistoryHealthWarning(history: DesktopCloudHistory): CloudMessageDescriptor | null {
  if (history.graph_health !== "degraded") return null;
  const count = history.unreadable_commit_ids.length;
  return count > 0
    ? cloudMessage("history-degraded-count", { count })
    : cloudMessage("history-degraded");
}

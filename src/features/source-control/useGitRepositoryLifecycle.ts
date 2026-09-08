import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import {
  fetchWorkspaceGit,
  getWorkspaceGitStatus,
  startWorkspaceGitRepositoryWatch,
  stopWorkspaceGitRepositoryWatch,
  subscribeWorkspaceGitRepositoryInvalidations,
} from "../../lib/localFiles";
import type { GitBranchGraphSnapshot, GitStatusSnapshot } from "../../types/electron";
import {
  createGitRefreshReason,
  createGitRefreshScheduler,
  type GitRefreshReason,
  type GitRepositoryContext,
} from "./gitRefreshScheduler";
import {
  getRemoteFetchTarget,
  REMOTE_FETCH_FOCUS_STALE_MS,
  REMOTE_FETCH_INTERVAL_MS,
  REMOTE_FETCH_MIN_GAP_MS,
  shouldFetchRemote,
} from "./remoteRefreshPolicy";
import {
  createRepositoryRefreshReason,
  mergePreservedHistory,
  shouldInvalidateHistoryForReason,
} from "./repositoryRefreshPolicy";

type UseGitRepositoryLifecycleOptions = {
  workspace: Workspace | null;
  remoteUpdatesActive: boolean;
};

const MAX_CACHED_GIT_WORKSPACES = 12;

export function useGitRepositoryLifecycle({
  workspace,
  remoteUpdatesActive,
}: UseGitRepositoryLifecycleOptions) {
  const workspacePathRef = useRef<string | null>(null);
  const gitStatusRef = useRef<GitStatusSnapshot | null>(null);
  const schedulerRef = useRef<ReturnType<typeof createGitRefreshScheduler<GitStatusSnapshot>> | null>(null);
  const gitStatusCacheRef = useRef(new Map<string, GitStatusSnapshot>());
  const historyEpochRef = useRef(0);
  const fetchRequestsRef = useRef(new Map<string, Promise<boolean>>());
  const lastRemoteFetchAttemptRef = useRef(new Map<string, number>());
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [gitStatusPath, setGitStatusPath] = useState<string | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);

  const workspacePath = workspace?.path ?? null;
  const cachedGitStatus = workspacePath
    ? gitStatusCacheRef.current.get(workspacePath) ?? null
    : null;
  const activeGitStatus = resolveActiveGitStatus(
    workspacePath,
    gitStatusPath,
    gitStatus,
    cachedGitStatus,
  );
  // Effects intentionally own cache promotion and scheduler lifecycle, but a
  // Workspace identity change is already visible during render. Derive this
  // pending edge synchronously so consumers never paint the previous root's
  // metadata (or a misleading "No Git") for one frame.
  const activeGitStatusLoading = isGitStatusContextLoading(
    workspace?.path ?? null,
    gitStatusPath,
    gitStatusLoading,
  );

  const bumpHistoryEpoch = useCallback(() => {
    historyEpochRef.current += 1;
    setHistoryEpoch(historyEpochRef.current);
    return historyEpochRef.current;
  }, []);

  const ensureScheduler = useCallback(() => {
    if (schedulerRef.current) return schedulerRef.current;
    const created = createGitRefreshScheduler<GitStatusSnapshot>({
      readStatus: async (_generation, rootPath, signal) => getWorkspaceGitStatus(rootPath, { signal }),
      onSnapshot: (nextStatus, meta) => {
        const rootPath = workspacePathRef.current;
        const state = schedulerRef.current?.getState();
        if (!rootPath || meta.rootPath !== rootPath) return;
        if (state && meta.rootEpoch !== state.rootEpoch) return;
        const invalidateHistory = shouldInvalidateHistoryForReason(meta.reason);
        if (invalidateHistory) {
          historyEpochRef.current += 1;
          setHistoryEpoch(historyEpochRef.current);
        }
        const merged = mergePreservedHistory(gitStatusRef.current, nextStatus, { invalidateHistory });
        putBoundedGitStatus(gitStatusCacheRef.current, rootPath, merged);
        gitStatusRef.current = merged;
        setGitStatus(merged);
        setGitStatusPath(rootPath);
        setGitStatusError(null);
      },
      onError: (error, meta) => {
        const rootPath = workspacePathRef.current;
        const state = schedulerRef.current?.getState();
        if (!rootPath || meta.rootPath !== rootPath) return;
        if (state && meta.rootEpoch !== state.rootEpoch) return;
        setGitStatusError(error instanceof Error ? error.message : String(error));
      },
      onLog: (event) => {
        if (event.type !== "refresh-success" && event.type !== "refresh-error" && event.type !== "refresh-discarded") return;
        console.info("[git-refresh]", event.type, {
          rootPath: event.rootPath,
          rootEpoch: event.rootEpoch,
          generation: event.generation,
          cause: event.reason.cause,
          source: event.reason.source,
          detail: event.reason.detail,
          attempt: event.reason.attempt,
          durationMs: event.durationMs,
        });
      },
      onLoadingChange: (loading, generation, rootEpoch) => {
        const state = schedulerRef.current?.getState();
        if (!state || rootEpoch !== state.rootEpoch) return;
        if (!loading && generation < state.requestedGeneration && state.inFlight) return;
        setGitStatusLoading(loading);
      },
    });
    schedulerRef.current = created;
    return created;
  }, []);

  const captureGitRepositoryContext = useCallback((expectedRootPath?: string): GitRepositoryContext | null => {
    const rootPath = expectedRootPath ?? workspacePathRef.current;
    if (!rootPath || workspacePathRef.current !== rootPath) return null;
    const state = ensureScheduler().getState();
    if (state.rootPath !== rootPath) return null;
    return { rootPath, rootEpoch: state.rootEpoch };
  }, [ensureScheduler]);

  const isGitRepositoryContextCurrent = useCallback((context: GitRepositoryContext): boolean => {
    if (workspacePathRef.current !== context.rootPath) return false;
    const state = ensureScheduler().getState();
    return state.rootPath === context.rootPath && state.rootEpoch === context.rootEpoch;
  }, [ensureScheduler]);

  const applyGitStatus = useCallback((
    nextStatus: GitStatusSnapshot,
    context: GitRepositoryContext,
    reason: GitRefreshReason = createRepositoryRefreshReason("external-apply", "external"),
  ): boolean => {
    if (!isGitRepositoryContextCurrent(context)) return false;
    return ensureScheduler().applyMutationSnapshot(nextStatus, context, reason);
  }, [ensureScheduler, isGitRepositoryContextCurrent]);

  const applyGitHistory = useCallback((
    context: GitRepositoryContext,
    expectedHeadCommitId: string | null,
    expectedHistoryEpoch: number,
    graph: GitBranchGraphSnapshot,
  ): boolean => {
    if (!isGitRepositoryContextCurrent(context)) return false;
    if (historyEpochRef.current !== expectedHistoryEpoch) return false;
    const current = gitStatusRef.current;
    if (!current || current.headCommitId !== expectedHeadCommitId) return false;
    const merged = {
      ...current,
      commits: graph.commits,
      allCommits: graph.allCommits,
      totalCommits: Math.max(current.totalCommits, graph.commits.length),
    };
    gitStatusRef.current = merged;
    putBoundedGitStatus(gitStatusCacheRef.current, context.rootPath, merged);
    setGitStatus(merged);
    return true;
  }, [isGitRepositoryContextCurrent]);

  const reportGitStatusError = useCallback((context: GitRepositoryContext, error: unknown) => {
    if (!isGitRepositoryContextCurrent(context)) return;
    setGitStatusError(error instanceof Error ? error.message : String(error));
  }, [isGitRepositoryContextCurrent]);

  const refreshGitStatus = useCallback(async (detail = "manual") => {
    if (!workspacePathRef.current) return;
    ensureScheduler().refreshNow(createRepositoryRefreshReason(
      detail,
      detail === "manual" ? "manual" : "external",
    ));
  }, [ensureScheduler]);

  const invalidateGitStatus = useCallback((detail = "working-tree") => {
    if (!workspacePathRef.current) return;
    ensureScheduler().invalidate({
      reason: createRepositoryRefreshReason(detail, "external"),
      priority: "debounced",
    });
  }, [ensureScheduler]);

  const refreshGitStatusWithFetch = useCallback(async (options: {
    remoteName?: string | null;
    silent?: boolean;
    detail?: string;
  } = {}) => {
    if (!workspace) return;
    const context = captureGitRepositoryContext(workspace.path);
    if (!context) return;
    const remoteName = options.remoteName?.trim() || null;
    const requestKey = `${context.rootEpoch}:${context.rootPath}:${remoteName ?? "all"}`;
    const existing = fetchRequestsRef.current.get(requestKey);
    if (existing) return existing;

    if (!options.silent) setGitStatusError(null);
    const request = (async () => {
      try {
        const nextStatus = await fetchWorkspaceGit(context.rootPath, { remoteName });
        return applyGitStatus(
          nextStatus,
          context,
          createGitRefreshReason("refs", "mutation", options.detail ?? "fetch"),
        );
      } catch (error) {
        if (options.silent) {
          console.info("[git-remote-refresh] fetch skipped", {
            rootPath: context.rootPath,
            remoteName,
            reason: error instanceof Error ? error.message : String(error),
          });
        } else {
          reportGitStatusError(context, error);
        }
        return false;
      } finally {
        fetchRequestsRef.current.delete(requestKey);
      }
    })();
    fetchRequestsRef.current.set(requestKey, request);
    return request;
  }, [applyGitStatus, captureGitRepositoryContext, reportGitStatusError, workspace]);

  const remoteFetchTarget = getRemoteFetchTarget(activeGitStatus);
  const remoteFetchTargetKey = remoteFetchTarget?.key ?? null;

  useEffect(() => {
    const rootPath = workspace?.path ?? null;
    const remoteName = remoteFetchTarget?.remoteName ?? null;
    // A cached snapshot may render synchronously on Project return, but the
    // scheduler context is promoted in an effect. Wait for that matching
    // context before starting the independent remote revalidation.
    if (!rootPath || !remoteName || gitStatusPath !== rootPath) return undefined;

    const fetchIdentity = `${rootPath}:${remoteName}`;
    const isForeground = () => {
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      const focused = typeof document === "undefined"
        || typeof document.hasFocus !== "function"
        || document.hasFocus();
      return visible && focused;
    };
    const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
    const requestFetch = (detail: string, minimumGapMs: number) => {
      const now = Date.now();
      const lastAttemptAt = lastRemoteFetchAttemptRef.current.get(fetchIdentity) ?? null;
      if (!shouldFetchRemote({
        focused: isForeground(),
        online: isOnline(),
        now,
        lastAttemptAt,
        minimumGapMs,
      })) return;
      lastRemoteFetchAttemptRef.current.set(fetchIdentity, now);
      void refreshGitStatusWithFetch({
        remoteName,
        silent: true,
        detail,
      });
    };

    requestFetch(
      remoteUpdatesActive ? "remote-sidebar" : "remote-target",
      REMOTE_FETCH_MIN_GAP_MS,
    );

    const interval = window.setInterval(() => {
      requestFetch("remote-interval", REMOTE_FETCH_INTERVAL_MS);
    }, REMOTE_FETCH_INTERVAL_MS);
    const handleFocus = () => requestFetch("remote-focus", REMOTE_FETCH_FOCUS_STALE_MS);
    const handleOnline = () => requestFetch("remote-online", REMOTE_FETCH_MIN_GAP_MS);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [
    gitStatusPath,
    remoteFetchTarget?.remoteName,
    remoteFetchTargetKey,
    refreshGitStatusWithFetch,
    remoteUpdatesActive,
    workspace?.path,
  ]);

  useEffect(() => {
    const rootPath = workspace?.path ?? null;
    const cachedStatus = rootPath ? gitStatusCacheRef.current.get(rootPath) ?? null : null;
    workspacePathRef.current = rootPath;
    gitStatusRef.current = cachedStatus;
    historyEpochRef.current += 1;
    setHistoryEpoch(historyEpochRef.current);
    setGitStatus(cachedStatus);
    setGitStatusPath(cachedStatus ? rootPath : null);
    setGitStatusLoading(Boolean(rootPath));
    setGitStatusError(null);
    ensureScheduler().setRootPath(rootPath);
  }, [ensureScheduler, workspace?.path]);

  useEffect(() => {
    const rootPath = workspace?.path ?? null;
    if (!rootPath) return undefined;

    const scheduler = ensureScheduler();
    let cancelled = false;
    let metadataSubscriptionId: string | null = null;
    const unsubscribeInvalidations = subscribeWorkspaceGitRepositoryInvalidations((event) => {
      if (cancelled) return;
      if (metadataSubscriptionId && event.subscriptionId !== metadataSubscriptionId) return;
      if (!metadataSubscriptionId && event.rootPath !== rootPath) return;
      scheduler.invalidate({
        reason: createRepositoryRefreshReason(event.reason || "git-metadata", "watcher"),
        priority: "debounced",
      });
    });

    void (async () => {
      try {
        const metadataResult = await startWorkspaceGitRepositoryWatch(rootPath);
        if (cancelled) {
          if (metadataResult?.subscriptionId) {
            await stopWorkspaceGitRepositoryWatch(metadataResult.subscriptionId);
          }
          return;
        }
        metadataSubscriptionId = metadataResult?.subscriptionId ?? null;
      } catch (error) {
        if (!cancelled && workspacePathRef.current === rootPath) {
          setGitStatusError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled && workspacePathRef.current === rootPath) {
          scheduler.refreshNow(createRepositoryRefreshReason("initial", "initial"));
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeInvalidations();
      if (metadataSubscriptionId) void stopWorkspaceGitRepositoryWatch(metadataSubscriptionId);
    };
  }, [ensureScheduler, workspace?.path]);

  useEffect(() => {
    const scheduler = ensureScheduler();
    const syncFocus = () => {
      const focused = typeof document === "undefined"
        ? true
        : document.visibilityState === "visible"
          && (typeof document.hasFocus !== "function" || document.hasFocus());
      scheduler.setFocused(focused);
    };
    syncFocus();
    window.addEventListener("focus", syncFocus);
    window.addEventListener("blur", syncFocus);
    document.addEventListener("visibilitychange", syncFocus);
    const bridge = window.puppyoneDesktop;
    const unsubscribeWindowFocus = typeof bridge?.onGitRepositoryWindowFocus === "function"
      ? bridge.onGitRepositoryWindowFocus((event) => scheduler.setFocused(event.focused))
      : () => {};
    return () => {
      window.removeEventListener("focus", syncFocus);
      window.removeEventListener("blur", syncFocus);
      document.removeEventListener("visibilitychange", syncFocus);
      unsubscribeWindowFocus();
    };
  }, [ensureScheduler]);

  useEffect(() => () => {
    schedulerRef.current?.dispose();
    schedulerRef.current = null;
  }, []);

  return {
    activeGitStatus,
    gitStatus,
    gitStatusError,
    gitStatusLoading: activeGitStatusLoading,
    gitStatusPath,
    historyEpoch,
    applyGitHistory,
    applyGitStatus,
    bumpHistoryEpoch,
    captureGitRepositoryContext,
    invalidateGitStatus,
    isGitRepositoryContextCurrent,
    refreshGitStatus,
    refreshGitStatusWithFetch,
    reportGitStatusError,
  };
}

export function isGitStatusContextLoading(
  workspacePath: string | null,
  statusPath: string | null,
  loading: boolean,
): boolean {
  return Boolean(workspacePath) && (statusPath !== workspacePath || loading);
}

export function resolveActiveGitStatus(
  workspacePath: string | null,
  statusPath: string | null,
  status: GitStatusSnapshot | null,
  cachedStatus: GitStatusSnapshot | null,
): GitStatusSnapshot | null {
  if (!workspacePath) return null;
  return statusPath === workspacePath ? status : cachedStatus;
}

function putBoundedGitStatus(
  cache: Map<string, GitStatusSnapshot>,
  rootPath: string,
  status: GitStatusSnapshot,
) {
  cache.delete(rootPath);
  cache.set(rootPath, status);
  while (cache.size > MAX_CACHED_GIT_WORKSPACES) {
    const oldestRoot = cache.keys().next().value;
    if (typeof oldestRoot !== "string") break;
    cache.delete(oldestRoot);
  }
}

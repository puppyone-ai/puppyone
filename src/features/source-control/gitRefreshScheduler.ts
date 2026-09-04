export const GIT_REFRESH_DEBOUNCE_MS = 250;
export const GIT_FOCUS_STALE_MS = 5_000;
export const GIT_WATCHER_RETRY_INITIAL_MS = 250;
export const GIT_WATCHER_RETRY_MAX_MS = 30_000;
export const GIT_REFRESH_RETRY_INITIAL_MS = 250;
export const GIT_REFRESH_RETRY_MAX_MS = 30_000;

export type GitRefreshPriority = "debounced" | "immediate";

export type GitRefreshCause =
  | "working-tree"
  | "index"
  | "refs"
  | "repository"
  | "ui-configuration";

export type GitRefreshSource =
  | "initial"
  | "watcher"
  | "manual"
  | "focus"
  | "mutation"
  | "external"
  | "retry";

/**
 * Structured refresh provenance. `cause` describes what repository truth may
 * have changed, while `source` describes how reconciliation was requested.
 * Keeping them separate means a retry never loses the original invalidation
 * semantics.
 */
export type GitRefreshReason = Readonly<{
  cause: GitRefreshCause;
  source: GitRefreshSource;
  detail: string;
  attempt?: number;
}>;

export type GitRepositoryContext = Readonly<{
  rootPath: string;
  rootEpoch: number;
}>;

export function createGitRefreshReason(
  cause: GitRefreshCause,
  source: GitRefreshSource,
  detail: string,
  attempt?: number,
): GitRefreshReason {
  return attempt == null
    ? { cause, source, detail }
    : { cause, source, detail, attempt };
}

export type GitRefreshInvalidateOptions = {
  priority?: GitRefreshPriority;
  reason?: GitRefreshReason;
};

export type GitRefreshSchedulerOptions<TSnapshot> = {
  readStatus: (
    generation: number,
    rootPath: string,
    signal: AbortSignal,
  ) => Promise<TSnapshot>;
  onSnapshot: (snapshot: TSnapshot, meta: {
    generation: number;
    reason: GitRefreshReason;
    durationMs: number;
    rootPath: string;
    rootEpoch: number;
  }) => void;
  onError?: (error: unknown, meta: {
    generation: number;
    reason: GitRefreshReason;
    durationMs: number;
    rootPath: string;
    rootEpoch: number;
  }) => void;
  onLoadingChange?: (loading: boolean, generation: number, rootEpoch: number) => void;
  onLog?: (event: {
    type: "refresh-start" | "refresh-success" | "refresh-error" | "refresh-discarded";
    generation: number;
    reason: GitRefreshReason;
    durationMs?: number;
    rootPath: string | null;
    rootEpoch: number;
  }) => void;
  debounceMs?: number;
  focusStaleMs?: number;
  retryInitialMs?: number;
  retryMaxMs?: number;
  now?: () => number;
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
};

type InFlightRead = {
  abortController: AbortController;
  epoch: number;
  generation: number;
  rootPath: string;
  publishable: boolean;
};

export type GitRefreshScheduler<TSnapshot> = {
  setRootPath: (rootPath: string | null) => void;
  setFocused: (focused: boolean) => void;
  invalidate: (options?: GitRefreshInvalidateOptions) => void;
  refreshNow: (reason?: GitRefreshReason) => void;
  applyMutationSnapshot: (
    snapshot: TSnapshot,
    context: GitRepositoryContext,
    reason?: GitRefreshReason,
  ) => boolean;
  getState: () => {
    rootPath: string | null;
    rootEpoch: number;
    requestedGeneration: number;
    appliedGeneration: number;
    inFlight: boolean;
    physicalInFlight: number;
    dirty: boolean;
    queuedPriority: GitRefreshPriority | null;
    lastSuccessfulAt: number | null;
    focused: boolean;
    lastError: unknown | null;
    lastReason: GitRefreshReason | null;
  };
  dispose: () => void;
};

export function createGitRefreshScheduler<TSnapshot>(
  options: GitRefreshSchedulerOptions<TSnapshot>,
): GitRefreshScheduler<TSnapshot> {
  const debounceMs = options.debounceMs ?? GIT_REFRESH_DEBOUNCE_MS;
  const focusStaleMs = options.focusStaleMs ?? GIT_FOCUS_STALE_MS;
  const retryInitialMs = options.retryInitialMs ?? GIT_REFRESH_RETRY_INITIAL_MS;
  const retryMaxMs = options.retryMaxMs ?? GIT_REFRESH_RETRY_MAX_MS;
  const now = options.now ?? (() => Date.now());
  const setTimeoutFn = options.setTimeoutFn ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));

  let rootPath: string | null = null;
  // Monotonic workspace identity. Never resets to 0 on switch, so a delayed
  // response from repo A cannot collide with repo B's generation space.
  let rootEpoch = 0;
  let requestedGeneration = 0;
  let appliedGeneration = 0;
  let inFlightReads: InFlightRead[] = [];
  let dirty = false;
  let queuedPriority: GitRefreshPriority | null = null;
  let lastSuccessfulAt: number | null = null;
  let focused = true;
  let lastError: unknown | null = null;
  let lastReason: GitRefreshReason | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let errorRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let errorRetryDelayMs = retryInitialMs;
  let disposed = false;

  function clearDebounce() {
    if (debounceTimer != null) {
      clearTimeoutFn(debounceTimer);
      debounceTimer = null;
    }
  }

  function clearErrorRetry() {
    if (errorRetryTimer != null) {
      clearTimeoutFn(errorRetryTimer);
      errorRetryTimer = null;
    }
  }

  function physicalInFlightCount() {
    return inFlightReads.length;
  }

  function blockingInFlightCount() {
    return inFlightReads.filter((read) => (
      read.epoch === rootEpoch && read.rootPath === rootPath
    )).length;
  }

  function setLoading(loading: boolean, generation: number, epoch: number) {
    options.onLoadingChange?.(loading, generation, epoch);
  }

  function startRead(priority: GitRefreshPriority, reason: GitRefreshReason) {
    if (disposed || !rootPath) return;
    // Preserve single-flight within one repository. An aborted read from an old
    // repository must not block the newly selected Project if its provider is
    // slow to settle after cancellation.
    if (blockingInFlightCount() > 0) {
      dirty = true;
      queuedPriority = mergePriority(queuedPriority, priority);
      lastReason = reason;
      return;
    }

    requestedGeneration += 1;
    const generation = requestedGeneration;
    const epoch = rootEpoch;
    const capturedRoot = rootPath;
    const abortController = new AbortController();
    const read: InFlightRead = {
      abortController,
      epoch,
      generation,
      rootPath: capturedRoot,
      publishable: true,
    };
    inFlightReads.push(read);
    dirty = false;
    queuedPriority = null;
    lastReason = reason;
    lastError = null;
    clearErrorRetry();
    setLoading(true, generation, epoch);
    const startedAt = now();
    options.onLog?.({
      type: "refresh-start",
      generation,
      reason,
      rootPath: capturedRoot,
      rootEpoch: epoch,
    });

    void Promise.resolve(options.readStatus(generation, capturedRoot, abortController.signal))
      .then((snapshot) => {
        settleRead(read, { ok: true, snapshot, startedAt, reason });
      })
      .catch((error) => {
        settleRead(read, { ok: false, error, startedAt, reason });
      });
  }

  function settleRead(
    read: InFlightRead,
    result: (
      | { ok: true; snapshot: TSnapshot; startedAt: number; reason: GitRefreshReason }
      | { ok: false; error: unknown; startedAt: number; reason: GitRefreshReason }
    ),
  ) {
    if (disposed) return;
    inFlightReads = inFlightReads.filter((entry) => entry !== read);
    const durationMs = Math.max(0, now() - result.startedAt);

    const sameWorkspace = read.epoch === rootEpoch && read.rootPath === rootPath;
    if (!sameWorkspace || !read.publishable || read.generation < appliedGeneration) {
      options.onLog?.({
        type: "refresh-discarded",
        generation: read.generation,
        reason: result.reason,
        durationMs,
        rootPath: read.rootPath,
        rootEpoch: read.epoch,
      });
      // Only clear loading if this read still owns the active epoch's loading bit
      // and nothing newer is publishable-in-flight for this epoch.
      if (sameWorkspace && read.publishable) {
        setLoading(false, read.generation, read.epoch);
      }
      maybeRunTrailing();
      return;
    }

    if (result.ok) {
      appliedGeneration = read.generation;
      lastSuccessfulAt = now();
      lastError = null;
      errorRetryDelayMs = retryInitialMs;
      options.onLog?.({
        type: "refresh-success",
        generation: read.generation,
        reason: result.reason,
        durationMs,
        rootPath: read.rootPath,
        rootEpoch: read.epoch,
      });
      options.onSnapshot(result.snapshot, {
        generation: read.generation,
        reason: result.reason,
        durationMs,
        rootPath: read.rootPath,
        rootEpoch: read.epoch,
      });
      setLoading(false, read.generation, read.epoch);
      maybeRunTrailing();
      return;
    }

    lastError = result.error;
    options.onLog?.({
      type: "refresh-error",
      generation: read.generation,
      reason: result.reason,
      durationMs,
      rootPath: read.rootPath,
      rootEpoch: read.epoch,
    });
    options.onError?.(result.error, {
      generation: read.generation,
      reason: result.reason,
      durationMs,
      rootPath: read.rootPath,
      rootEpoch: read.epoch,
    });
    setLoading(false, read.generation, read.epoch);
    scheduleErrorRetry(result.reason);
    maybeRunTrailing();
  }

  function scheduleErrorRetry(reason: GitRefreshReason) {
    if (disposed || !rootPath || !focused || errorRetryTimer != null) return;
    const delay = errorRetryDelayMs;
    errorRetryDelayMs = Math.min(errorRetryDelayMs * 2, retryMaxMs);
    errorRetryTimer = setTimeoutFn(() => {
      errorRetryTimer = null;
      if (disposed || !rootPath) return;
      if (!focused) {
        // Keep the failure visible for focus reconciliation; do not start a
        // background status while the window is hidden.
        dirty = true;
        queuedPriority = mergePriority(queuedPriority, "immediate");
        return;
      }
      schedule("immediate", createGitRefreshReason(
        reason.cause,
        "retry",
        reason.detail,
        (reason.attempt ?? 0) + 1,
      ));
    }, delay);
  }

  function maybeRunTrailing() {
    if (!dirty || blockingInFlightCount() > 0) return;
    const priority = queuedPriority ?? "debounced";
    dirty = false;
    queuedPriority = null;
    if (!focused && priority !== "immediate") {
      dirty = true;
      queuedPriority = priority;
      return;
    }
    startRead(
      priority,
      lastReason ?? createGitRefreshReason("repository", "external", "trailing-refresh"),
    );
  }

  function schedule(priority: GitRefreshPriority, reason: GitRefreshReason) {
    if (disposed || !rootPath) return;
    lastReason = reason;

    if (!focused && priority !== "immediate") {
      dirty = true;
      queuedPriority = mergePriority(queuedPriority, priority);
      return;
    }

    if (blockingInFlightCount() > 0) {
      dirty = true;
      queuedPriority = mergePriority(queuedPriority, priority);
      return;
    }

    if (priority === "immediate") {
      clearDebounce();
      startRead("immediate", reason);
      return;
    }

    queuedPriority = mergePriority(queuedPriority, "debounced");
    clearDebounce();
    debounceTimer = setTimeoutFn(() => {
      debounceTimer = null;
      if (!focused) {
        dirty = true;
        queuedPriority = mergePriority(queuedPriority, "debounced");
        return;
      }
      const nextPriority = queuedPriority ?? "debounced";
      queuedPriority = null;
      startRead(
        nextPriority,
        lastReason ?? createGitRefreshReason("repository", "external", "debounced-refresh"),
      );
    }, debounceMs);
  }

  return {
    setRootPath(nextRootPath) {
      if (nextRootPath === rootPath) return;
      clearDebounce();
      clearErrorRetry();
      rootEpoch += 1;
      rootPath = nextRootPath;
      requestedGeneration = 0;
      appliedGeneration = 0;
      // Keep physical promises alive, but make them non-publishable.
      for (const read of inFlightReads) {
        read.publishable = false;
        read.abortController.abort();
      }
      dirty = false;
      queuedPriority = null;
      lastSuccessfulAt = null;
      lastError = null;
      lastReason = null;
      errorRetryDelayMs = retryInitialMs;
    },

    setFocused(nextFocused) {
      const wasFocused = focused;
      focused = nextFocused;
      if (!wasFocused && nextFocused) {
        const stale = lastSuccessfulAt == null || (now() - lastSuccessfulAt) >= focusStaleMs;
        if (dirty || stale || lastError != null) {
          schedule("immediate", dirty && lastReason
            ? lastReason
            : createGitRefreshReason(
              "repository",
              "focus",
              lastError != null ? "focus-error" : "focus-stale",
            ));
        }
      }
    },

    invalidate(invalidateOptions = {}) {
      const priority = invalidateOptions.priority ?? "debounced";
      schedule(
        priority,
        invalidateOptions.reason
          ?? createGitRefreshReason("repository", "external", "unspecified-invalidation"),
      );
    },

    refreshNow(reason = createGitRefreshReason("repository", "manual", "manual")) {
      schedule("immediate", reason);
    },

    applyMutationSnapshot(
      snapshot,
      context,
      reason = createGitRefreshReason("repository", "mutation", "mutation"),
    ) {
      if (!rootPath) return false;
      if (context.rootPath !== rootPath || context.rootEpoch !== rootEpoch) return false;
      clearDebounce();
      clearErrorRetry();
      requestedGeneration += 1;
      appliedGeneration = requestedGeneration;
      // Older in-flight reads become ineligible to publish, but remain physically
      // in flight so we do not start another status until they settle.
      for (const read of inFlightReads) {
        read.publishable = false;
        read.abortController.abort();
      }
      dirty = false;
      queuedPriority = null;
      lastSuccessfulAt = now();
      lastError = null;
      lastReason = reason;
      errorRetryDelayMs = retryInitialMs;
      options.onSnapshot(snapshot, {
        generation: appliedGeneration,
        reason,
        durationMs: 0,
        rootPath,
        rootEpoch,
      });
      setLoading(false, appliedGeneration, rootEpoch);
      return true;
    },

    getState() {
      return {
        rootPath,
        rootEpoch,
        requestedGeneration,
        appliedGeneration,
        inFlight: inFlightReads.some((read) => read.publishable && read.epoch === rootEpoch),
        physicalInFlight: physicalInFlightCount(),
        dirty,
        queuedPriority,
        lastSuccessfulAt,
        focused,
        lastError,
        lastReason,
      };
    },

    dispose() {
      disposed = true;
      clearDebounce();
      clearErrorRetry();
      for (const read of inFlightReads) {
        read.publishable = false;
        read.abortController.abort();
      }
      inFlightReads = [];
      dirty = false;
      queuedPriority = null;
    },
  };
}

function mergePriority(
  current: GitRefreshPriority | null,
  next: GitRefreshPriority,
): GitRefreshPriority {
  if (current === "immediate" || next === "immediate") return "immediate";
  return "debounced";
}

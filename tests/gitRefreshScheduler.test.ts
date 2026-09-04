import { describe, expect, it, vi } from "vitest";
import {
  createGitRefreshReason,
  createGitRefreshScheduler,
  GIT_FOCUS_STALE_MS,
  GIT_REFRESH_DEBOUNCE_MS,
  GIT_REFRESH_RETRY_INITIAL_MS,
} from "../src/features/source-control/gitRefreshScheduler";

const refreshReason = (
  detail: string,
  cause: "working-tree" | "index" | "refs" | "repository" | "ui-configuration" = "repository",
  source: "initial" | "watcher" | "manual" | "focus" | "mutation" | "external" | "retry" = "external",
) => createGitRefreshReason(cause, source, detail);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("gitRefreshScheduler", () => {
  it("allows one in-flight read and at most one trailing refresh after a burst", async () => {
    const reads: Array<ReturnType<typeof createDeferred<{ id: number }>>> = [];
    const snapshots: Array<{ id: number }> = [];
    const timers: Array<{ callback: () => void; ms: number }> = [];

    const scheduler = createGitRefreshScheduler({
      debounceMs: GIT_REFRESH_DEBOUNCE_MS,
      readStatus: async () => {
        const deferred = createDeferred<{ id: number }>();
        reads.push(deferred);
        return deferred.promise;
      },
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      setTimeoutFn: (callback, ms) => {
        timers.push({ callback, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.invalidate({ reason: refreshReason("working-tree", "working-tree", "watcher") });
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(GIT_REFRESH_DEBOUNCE_MS);
    timers[0]?.callback();

    expect(reads).toHaveLength(1);
    scheduler.invalidate({ reason: refreshReason("metadata") });
    scheduler.invalidate({ reason: refreshReason("metadata") });
    expect(reads).toHaveLength(1);
    expect(scheduler.getState().dirty).toBe(true);

    reads[0]?.resolve({ id: 1 });
    await flushMicrotasks();

    expect(snapshots).toEqual([{ id: 1 }]);
    expect(reads).toHaveLength(2);

    reads[1]?.resolve({ id: 2 });
    await flushMicrotasks();

    expect(snapshots).toEqual([{ id: 1 }, { id: 2 }]);
    expect(scheduler.getState().inFlight).toBe(false);
    expect(scheduler.getState().dirty).toBe(false);
    scheduler.dispose();
  });

  it("never lets an older deferred response overwrite a newer generation or mutation", async () => {
    const first = createDeferred<{ label: string }>();
    const second = createDeferred<{ label: string }>();
    const snapshots: Array<{ label: string }> = [];
    let call = 0;

    const scheduler = createGitRefreshScheduler({
      debounceMs: 0,
      readStatus: async () => {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      },
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      setTimeoutFn: (callback) => {
        callback();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.invalidate({ reason: refreshReason("working-tree", "working-tree", "watcher") });
    expect(call).toBe(1);

    scheduler.applyMutationSnapshot(
      { label: "mutation" },
      { rootPath: "/repo", rootEpoch: scheduler.getState().rootEpoch },
      refreshReason("commit", "refs", "mutation"),
    );
    expect(snapshots).toEqual([{ label: "mutation" }]);
    expect(scheduler.getState().appliedGeneration).toBe(2);
    expect(scheduler.getState().physicalInFlight).toBe(1);

    // Mutation must not start a second physical status while the first promise lives.
    scheduler.refreshNow(refreshReason("manual", "repository", "manual"));
    expect(call).toBe(1);
    expect(scheduler.getState().dirty).toBe(true);

    first.resolve({ label: "stale" });
    await flushMicrotasks();

    expect(snapshots).toEqual([{ label: "mutation" }]);
    expect(call).toBe(2);

    second.resolve({ label: "fresh" });
    await flushMicrotasks();

    expect(snapshots).toEqual([{ label: "mutation" }, { label: "fresh" }]);
    scheduler.dispose();
  });

  it("discards delayed responses across A → B workspace switches", async () => {
    const repoA = createDeferred<{ label: string }>();
    const repoB = createDeferred<{ label: string }>();
    const snapshots: Array<{ label: string; rootPath: string }> = [];
    const roots: string[] = [];
    let call = 0;

    const scheduler = createGitRefreshScheduler({
      debounceMs: 0,
      readStatus: async (_generation, rootPath) => {
        call += 1;
        roots.push(rootPath);
        return call === 1 ? repoA.promise : repoB.promise;
      },
      onSnapshot: (snapshot, meta) => {
        snapshots.push({ label: snapshot.label, rootPath: meta.rootPath });
      },
      setTimeoutFn: (callback) => {
        callback();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo-a");
    const epochA = scheduler.getState().rootEpoch;
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    expect(call).toBe(1);

    scheduler.setRootPath("/repo-b");
    const epochB = scheduler.getState().rootEpoch;
    expect(epochB).toBeGreaterThan(epochA);
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    // Repository single-flight is scoped to the active root. A provider that
    // ignores abort must not keep the newly selected Project waiting.
    expect(call).toBe(2);
    expect(scheduler.getState().physicalInFlight).toBe(2);
    expect(scheduler.getState().dirty).toBe(false);

    repoA.resolve({ label: "repo-a-stale" });
    await flushMicrotasks();

    expect(snapshots).toEqual([]);
    expect(roots).toEqual(["/repo-a", "/repo-b"]);

    repoB.resolve({ label: "repo-b-fresh" });
    await flushMicrotasks();

    expect(snapshots).toEqual([{ label: "repo-b-fresh", rootPath: "/repo-b" }]);
    scheduler.dispose();
  });

  it("discards a delayed B response after A → B → A", async () => {
    const pendingByRoot = new Map<string, Array<ReturnType<typeof createDeferred<{ label: string }>>>>();
    const snapshots: Array<{ label: string; rootPath: string }> = [];

    const scheduler = createGitRefreshScheduler({
      debounceMs: 0,
      readStatus: async (_generation, rootPath) => {
        const deferred = createDeferred<{ label: string }>();
        const queue = pendingByRoot.get(rootPath) ?? [];
        queue.push(deferred);
        pendingByRoot.set(rootPath, queue);
        return deferred.promise;
      },
      onSnapshot: (snapshot, meta) => {
        snapshots.push({ label: snapshot.label, rootPath: meta.rootPath });
      },
      setTimeoutFn: (callback) => {
        callback();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo-a");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    const firstA = pendingByRoot.get("/repo-a")?.[0];
    expect(firstA).toBeTruthy();

    scheduler.setRootPath("/repo-b");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    const firstB = pendingByRoot.get("/repo-b")?.[0];
    expect(firstB).toBeTruthy();

    scheduler.setRootPath("/repo-a");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    const secondA = pendingByRoot.get("/repo-a")?.[1];
    expect(secondA).toBeTruthy();
    expect(scheduler.getState().physicalInFlight).toBe(3);

    firstA?.resolve({ label: "stale-a" });
    await flushMicrotasks();

    firstB?.resolve({ label: "late-b" });
    await flushMicrotasks();

    expect(snapshots.some((entry) => entry.label === "late-b")).toBe(false);

    secondA?.resolve({ label: "fresh-a" });
    await flushMicrotasks();

    expect(snapshots).toEqual([{ label: "fresh-a", rootPath: "/repo-a" }]);
    scheduler.dispose();
  });

  it("rejects mutation snapshots captured before a workspace epoch change", () => {
    const snapshots: Array<{ label: string; rootPath: string }> = [];
    const scheduler = createGitRefreshScheduler({
      readStatus: async () => ({ label: "read" }),
      onSnapshot: (snapshot, meta) => {
        snapshots.push({ label: snapshot.label, rootPath: meta.rootPath });
      },
    });

    scheduler.setRootPath("/repo-a");
    const staleContext = {
      rootPath: "/repo-a",
      rootEpoch: scheduler.getState().rootEpoch,
    };

    scheduler.setRootPath("/repo-b");
    scheduler.setRootPath("/repo-a");

    const applied = scheduler.applyMutationSnapshot(
      { label: "stale-operation-result" },
      staleContext,
      refreshReason("commit", "refs", "mutation"),
    );

    expect(applied).toBe(false);
    expect(snapshots).toEqual([]);
    expect(scheduler.getState().appliedGeneration).toBe(0);
    scheduler.dispose();
  });

  it("aborts an obsolete physical read before starting the next workspace", async () => {
    const roots: string[] = [];
    const signals: AbortSignal[] = [];
    const scheduler = createGitRefreshScheduler({
      readStatus: async (_generation, rootPath, signal) => {
        roots.push(rootPath);
        signals.push(signal);
        if (rootPath === "/repo-b") return { label: "repo-b" };
        return new Promise<{ label: string }>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
        });
      },
      onSnapshot: () => {},
    });

    scheduler.setRootPath("/repo-a");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    scheduler.setRootPath("/repo-b");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    await flushMicrotasks();

    expect(signals[0]?.aborted).toBe(true);
    expect(roots).toEqual(["/repo-a", "/repo-b"]);
    scheduler.dispose();
  });

  it("queues background invalidation while unfocused and drains on focus", async () => {
    const snapshots: string[] = [];
    const timers: Array<{ callback: () => void }> = [];

    const scheduler = createGitRefreshScheduler({
      debounceMs: 10,
      readStatus: async () => "status",
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      setTimeoutFn: (callback) => {
        timers.push({ callback });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.setFocused(false);
    scheduler.invalidate({ reason: refreshReason("metadata") });
    expect(timers).toHaveLength(0);
    expect(scheduler.getState().dirty).toBe(true);

    scheduler.setFocused(true);
    await flushMicrotasks();
    expect(snapshots).toEqual(["status"]);
    scheduler.dispose();
  });

  it("reconciles on focus when the last successful snapshot is stale", async () => {
    let now = 1_000;
    const snapshots: string[] = [];

    const scheduler = createGitRefreshScheduler({
      debounceMs: 0,
      focusStaleMs: GIT_FOCUS_STALE_MS,
      now: () => now,
      readStatus: async () => `status-${now}`,
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      setTimeoutFn: (callback) => {
        callback();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    await flushMicrotasks();
    expect(snapshots).toEqual(["status-1000"]);

    scheduler.setFocused(false);
    now += GIT_FOCUS_STALE_MS + 1;
    scheduler.setFocused(true);
    await flushMicrotasks();

    expect(snapshots).toEqual(["status-1000", `status-${now}`]);
    scheduler.dispose();
  });

  it("preserves the last good snapshot path by not clearing on transient read errors", async () => {
    const onError = vi.fn();
    const snapshots: string[] = [];
    const timers: Array<{ callback: () => void; ms: number }> = [];
    let shouldFail = false;

    const scheduler = createGitRefreshScheduler({
      debounceMs: 0,
      readStatus: async () => {
        if (shouldFail) throw new Error("transient");
        return "ok";
      },
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      onError,
      setTimeoutFn: (callback, ms) => {
        timers.push({ callback, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    await flushMicrotasks();
    expect(snapshots).toEqual(["ok"]);

    shouldFail = true;
    scheduler.refreshNow(refreshReason("retry"));
    await flushMicrotasks();

    expect(snapshots).toEqual(["ok"]);
    expect(onError).toHaveBeenCalledOnce();
    expect(scheduler.getState().lastError).toBeInstanceOf(Error);
    expect(timers.some((timer) => timer.ms === GIT_REFRESH_RETRY_INITIAL_MS)).toBe(true);
    scheduler.dispose();
  });

  it("retries failed refreshes with bounded exponential backoff", async () => {
    const timers: Array<{ callback: () => void; ms: number }> = [];
    let failures = 0;

    const scheduler = createGitRefreshScheduler({
      debounceMs: 0,
      retryInitialMs: 100,
      retryMaxMs: 400,
      readStatus: async () => {
        failures += 1;
        if (failures <= 2) throw new Error(`fail-${failures}`);
        return "recovered";
      },
      onSnapshot: () => {},
      setTimeoutFn: (callback, ms) => {
        timers.push({ callback, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    await flushMicrotasks();
    expect(failures).toBe(1);
    expect(timers[0]?.ms).toBe(100);

    timers[0]?.callback();
    await flushMicrotasks();
    expect(failures).toBe(2);
    expect(timers[1]?.ms).toBe(200);

    timers[1]?.callback();
    await flushMicrotasks();
    expect(failures).toBe(3);
    expect(scheduler.getState().lastError).toBeNull();
    expect(scheduler.getState().lastSuccessfulAt).not.toBeNull();
    scheduler.dispose();
  });

  it("does not start a debounced read after the window loses focus", async () => {
    const reads: string[] = [];
    const timers: Array<{ callback: () => void; ms: number }> = [];

    const scheduler = createGitRefreshScheduler({
      debounceMs: GIT_REFRESH_DEBOUNCE_MS,
      readStatus: async () => {
        reads.push("read");
        return "status";
      },
      onSnapshot: () => {},
      setTimeoutFn: (callback, ms) => {
        timers.push({ callback, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.invalidate({ reason: refreshReason("working-tree", "working-tree", "watcher") });
    expect(timers).toHaveLength(1);
    scheduler.setFocused(false);
    timers[0]?.callback();
    await flushMicrotasks();

    expect(reads).toEqual([]);
    expect(scheduler.getState().dirty).toBe(true);

    scheduler.setFocused(true);
    await flushMicrotasks();
    expect(reads).toEqual(["read"]);
    scheduler.dispose();
  });

  it("does not run a retry timer while unfocused", async () => {
    const reads: number[] = [];
    const timers: Array<{ callback: () => void; ms: number }> = [];
    let shouldFail = true;

    const scheduler = createGitRefreshScheduler({
      debounceMs: 0,
      retryInitialMs: 100,
      readStatus: async () => {
        reads.push(reads.length + 1);
        if (shouldFail) throw new Error("boom");
        return "ok";
      },
      onSnapshot: () => {},
      setTimeoutFn: (callback, ms) => {
        timers.push({ callback, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    scheduler.setRootPath("/repo");
    scheduler.refreshNow(refreshReason("initial", "repository", "initial"));
    await flushMicrotasks();
    expect(reads).toEqual([1]);
    expect(timers.some((timer) => timer.ms === 100)).toBe(true);

    scheduler.setFocused(false);
    const retry = timers.find((timer) => timer.ms === 100);
    retry?.callback();
    await flushMicrotasks();
    expect(reads).toEqual([1]);
    expect(scheduler.getState().dirty).toBe(true);

    shouldFail = false;
    scheduler.setFocused(true);
    await flushMicrotasks();
    expect(reads.length).toBeGreaterThan(1);
    scheduler.dispose();
  });
});

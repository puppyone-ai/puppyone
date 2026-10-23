/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import { acquireHistoryPage } from "../../../../src/features/cloud/history/historyRepository";
const history = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/lib/cloudHistoryApi", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../src/lib/cloudHistoryApi")>(), getCloudHistory: history,
}));
const session: DesktopCloudSession = { user_id: "u", session_generation: "g", api_base_url: "https://example.test", user_email: "u@example.test", expires_in: 3600, expires_at: 0, status: "authenticated" };
const context = { session, projectId: "p", apiBaseUrl: session.api_base_url, revisionKey: "r1" };
const page = { commits: [], snapshot_id: "a".repeat(64) };
function pending() {
  let complete!: (value: unknown) => void;
  let signal!: AbortSignal;
  history.mockImplementationOnce((...args) => {
    signal = args[6].signal;
    return new Promise((resolve, reject) => {
      complete = resolve;
      signal.addEventListener("abort", () => reject(new Error("cancelled")));
    });
  });
  return { resolve: () => complete(page), signal: () => signal };
}
beforeEach(() => { vi.useFakeTimers(); cloudCache.clear(); history.mockReset(); });
afterEach(() => { vi.useRealTimers(); cloudCache.clear(); });

describe("History request ownership", () => {
  it("shares one request and only aborts when its last subscriber leaves", async () => {
    const request = pending();
    const first = acquireHistoryPage(context), second = acquireHistoryPage(context);
    const result = first.promise.catch(error => error.message);
    expect(history).toHaveBeenCalledTimes(1);
    first.release();
    await vi.advanceTimersByTimeAsync(101);
    expect(request.signal().aborted).toBe(false);
    second.release();
    await vi.advanceTimersByTimeAsync(101);
    expect(request.signal().aborted).toBe(true);
    expect(await result).toBe("cancelled");
    history.mockResolvedValueOnce(page);
    const retry = acquireHistoryPage(context);
    await expect(retry.promise).resolves.toEqual(page);
    retry.release();
    expect(history).toHaveBeenCalledTimes(2);
  });

  it("reuses a remounted subscription and revalidates cached rows on reopen", async () => {
    const request = pending();
    const first = acquireHistoryPage(context);
    first.release();
    const next = acquireHistoryPage(context);
    await vi.advanceTimersByTimeAsync(101);
    expect(request.signal().aborted).toBe(false);
    request.resolve();
    await next.promise;
    next.release();
    history.mockRejectedValueOnce(new Error("revoked"));
    const reopened = acquireHistoryPage(context);
    expect(reopened.cached).toEqual(page);
    await expect(reopened.promise).rejects.toThrow("revoked");
    reopened.release();
    expect(history).toHaveBeenCalledTimes(2);
  });

  it("a mutation detaches an older read and late completion cannot refill its cache", async () => {
    const old = pending();
    const first = acquireHistoryPage(context);
    cloudCache.invalidate({ projectId: context.projectId });
    history.mockResolvedValueOnce({ ...page, snapshot_id: "b".repeat(64) });
    const newer = acquireHistoryPage(context);
    await newer.promise;
    old.resolve();
    await first.promise;
    first.release(); newer.release();
    history.mockResolvedValueOnce(page);
    const reopened = acquireHistoryPage(context);
    expect(reopened.cached?.snapshot_id).toBe("b".repeat(64));
    await reopened.promise; reopened.release();
    expect(history).toHaveBeenCalledTimes(3);
  });

  it("isolates account, API endpoint, revision and project identities", async () => {
    history.mockResolvedValue(page);
    const first = acquireHistoryPage(context);
    await first.promise;
    first.release();
    for (const changed of [
      { ...context, projectId: "other" }, { ...context, revisionKey: "r2" },
      { ...context, session: { ...session, session_generation: "new" } },
      { ...context, apiBaseUrl: "https://another.test", session: { ...session, api_base_url: "https://another.test" } },
    ]) {
      const request = acquireHistoryPage(changed);
      expect(request.cached).toBeUndefined();
      await request.promise;
      request.release();
    }
    expect(history).toHaveBeenCalledTimes(5);
  });
});

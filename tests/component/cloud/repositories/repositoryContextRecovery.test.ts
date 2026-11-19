/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRepositoryContextRecovery } from "../../../../src/features/cloud/project/context/repositoryContextRecovery";

let stop: (() => void) | undefined;
const unavailable = Object.assign(new Error("Unavailable"), { status: 503 });
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(1); });
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

describe("repository authorization read recovery", () => {
  it("recovers a transient 503 and stops all probes after success", async () => {
    const read = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValue(undefined);
    const failed = vi.fn();
    stop = startRepositoryContextRecovery(read, failed);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("bounds a persistent outage, then coalesces focus and online into one probe", async () => {
    const read = vi.fn().mockRejectedValue(unavailable);
    stop = startRepositoryContextRecovery(read, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(4);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it.each([
    { status: 401 }, { status: 403 }, { status: 404 }, { status: 426 },
    { status: 429 }, { status: 501 }, { code: "SESSION_CHANGED" },
    { code: "CLOUD_REQUEST_CANCELLED" }, new TypeError("Invalid response shape"),
  ])("does not retry permanent or unclassified failures: %j", async (error) => {
    const read = vi.fn().mockRejectedValue(error);
    stop = startRepositoryContextRecovery(read, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(["CLOUD_TRANSPORT_UNAVAILABLE", "CLOUD_REQUEST_TIMEOUT"])("recovers typed transport failure %s", async (code) => {
    const read = vi.fn().mockRejectedValueOnce({ code }).mockResolvedValue(undefined);
    stop = startRepositoryContextRecovery(read, vi.fn());
    await vi.advanceTimersByTimeAsync(1_500);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("never overlaps probes, and disposal ignores a late failure", async () => {
    let reject!: (error: unknown) => void;
    const read = vi.fn(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
    const failed = vi.fn();
    stop = startRepositoryContextRecovery(read, failed);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    stop();
    reject(unavailable);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failed).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("defers hidden-window retries until visible and removes listeners on disposal", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const read = vi.fn().mockRejectedValue(unavailable);
    stop = startRepositoryContextRecovery(read, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

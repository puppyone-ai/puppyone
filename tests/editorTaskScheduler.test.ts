import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_TASK_POLICY, EditorTaskScheduler } from "../packages/shared-ui/src/editor/runtime/EditorTaskScheduler";

afterEach(() => vi.useRealTimers());
const request = (instance: string, signal?: AbortSignal) => ({ owner: { scope: "project", instance, generation: 1 }, kind: "parse", inputBytes: 8, maxInputBytes: 16, signal });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("editor task lifecycle", () => {
  it("admits independent owners and waits for the previous task of the same owner", async () => {
    const scheduler = new EditorTaskScheduler();
    const first = await scheduler.acquire(request("a"), () => ({ value: 1, stop: vi.fn() }));
    const createSecond = vi.fn(() => ({ value: 2, stop: vi.fn() }));
    const second = scheduler.acquire(request("a"), createSecond);
    const other = await scheduler.acquire(request("b"), () => ({ value: 3, stop: vi.fn() }));
    expect(createSecond).not.toHaveBeenCalled();
    await first.close();
    expect((await second).value).toBe(2);
    await Promise.all([(await second).close(), other.close()]);
    expect(scheduler.snapshot()).toEqual([]);
  });

  it("never allocates cancelled queued work", async () => {
    const scheduler = new EditorTaskScheduler();
    const first = await scheduler.acquire(request("a"), () => ({ value: 1, stop() {} }));
    const controller = new AbortController();
    const create = vi.fn();
    const queued = scheduler.acquire(request("a", controller.signal), create);
    const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected; await first.close();
    expect(create).not.toHaveBeenCalled();
    expect(scheduler.snapshot()).toEqual([]);
  });

  it("keeps an asynchronously created allocation accounted until its actual exit", async () => {
    const scheduler = new EditorTaskScheduler();
    const allocation = deferred<{ value: number; stop: () => Promise<void> }>();
    const exit = deferred<void>();
    const controller = new AbortController();
    const starting = scheduler.acquire(request("a", controller.signal), () => allocation.promise);
    const rejection = expect(starting).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejection;
    const retirement = scheduler.retire({ scope: "project" });
    allocation.resolve({ value: 1, stop: () => exit.promise });
    await Promise.resolve(); await Promise.resolve();
    expect(scheduler.snapshot()).toHaveLength(1);
    exit.resolve(); await retirement;
    expect(scheduler.snapshot()).toEqual([]);
  });

  it("keeps failed exits visible and allows a retirement retry", async () => {
    const scheduler = new EditorTaskScheduler();
    const stop = vi.fn().mockRejectedValueOnce(new Error("exit failed")).mockResolvedValue(undefined);
    const lease = await scheduler.acquire(request("a"), () => ({ value: 1, stop }));
    await expect(lease.close()).rejects.toThrow("exit failed");
    expect(scheduler.snapshot()[0]?.state).toBe("exit-unconfirmed");
    await scheduler.retire({ scope: "project" });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(scheduler.snapshot()).toEqual([]);
  });

  it("rejects oversized input before allocating and bounds waiting time", async () => {
    vi.useFakeTimers();
    const scheduler = new EditorTaskScheduler();
    const create = vi.fn();
    await expect(scheduler.acquire({ ...request("a"), inputBytes: 17 }, create)).rejects.toThrow("budget");
    expect(create).not.toHaveBeenCalled();
    const first = await scheduler.acquire(request("a"), () => ({ value: 1, stop() {} }));
    const queued = scheduler.acquire(request("a"), create);
    const rejected = expect(queued).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(EDITOR_TASK_POLICY.queueTimeoutMs);
    await rejected; await first.close();
    expect(create).not.toHaveBeenCalled();
  });
});

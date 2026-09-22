import { afterEach, describe, expect, it, vi } from "vitest";
import { createMermaidRenderService } from "../../../../electron/main/mermaid/render-service.mjs";
const request = (id) => ({ id, source: "graph TD; A-->B", config: {} });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const services = [];
function fixture(options = {}) {
  const hosts = [];
  const createHost = vi.fn(() => {
    let rejectRun;
    let resolveRun;
    const host = {
      render: vi.fn(() => new Promise((resolve, reject) => { rejectRun = reject; resolveRun = resolve; })),
      stop: vi.fn(async () => rejectRun?.(new Error("stopped"))),
      resolve: (value = { svg: "<svg />" }) => resolveRun(value),
    };
    hosts.push(host); return host;
  });
  const service = createMermaidRenderService({ createHost, ...options }); services.push(service);
  return { service, hosts, createHost };
}
afterEach(async () => { for (const service of services.splice(0)) await service.dispose(); vi.useRealTimers(); });
describe("native Mermaid finite render queue", () => {
  it("skips a cancelled queued request and reuses a warm host", async () => {
    const f = fixture();
    const a = f.service.render(1, request("a")); const b = f.service.render(1, request("b"));
    await f.service.cancel(1, "b"); expect((await b).ok).toBe(false);
    f.hosts[0].resolve(); expect((await a).ok).toBe(true);
    const c = f.service.render(1, request("c"));
    f.hosts[0].resolve(); await c;
    expect(f.createHost).toHaveBeenCalledTimes(1); expect(f.hosts[0].render).toHaveBeenCalledTimes(2);
  });
  it("does not start the next job until cancellation confirms host exit", async () => {
    const f = fixture(); const a = f.service.render(1, request("a"));
    const b = f.service.render(2, request("b"));
    let confirmExit; f.hosts[0].stop = vi.fn(() => new Promise((resolve) => { confirmExit = resolve; }));
    const closing = f.service.cancel(1, "a"); await flush();
    expect(f.hosts).toHaveLength(1);
    confirmExit(); await closing; expect((await a).ok).toBe(false);
    expect(f.hosts).toHaveLength(2); f.hosts[1].resolve(); await b;
  });
  it("enforces timeout, then recovers using a new process", async () => {
    vi.useFakeTimers(); const f = fixture({ timeoutMs: 50 });
    const a = f.service.render(1, request("a"));
    await vi.advanceTimersByTimeAsync(51); expect(await a).toMatchObject({ ok: false, error: expect.stringContaining("timed out") });
    const b = f.service.render(1, request("b")); f.hosts[1].resolve(); await b;
    expect(f.hosts[0].stop).toHaveBeenCalledTimes(1);
  });
  it("bounds requests and isolates cancellation by sender", async () => {
    const f = fixture(); const all = [];
    for (let i = 0; i < 16; i++) all.push(f.service.render(1, request(`r${i}`)));
    expect(() => f.service.render(1, request("overflow"))).toThrow("full");
    await f.service.cancel(2, "r0"); expect(f.hosts[0].stop).not.toHaveBeenCalled();
    await f.service.releaseOwner(1); expect((await Promise.all(all)).every((r) => !r.ok)).toBe(true);
  });
  it("does not allocate a host for invalid IPC input", () => {
    const f = fixture();
    expect(() => f.service.render(1, { ...request("x"), source: "x".repeat(131073) })).toThrow("Invalid");
    expect(f.createHost).not.toHaveBeenCalled();
  });
  it("retains a slot and permits retry when exit is unconfirmed", async () => {
    const f = fixture(); const a = f.service.render(1, request("a")); const b = f.service.render(2, request("b"));
    const stop = f.hosts[0].stop;
    f.hosts[0].stop = vi.fn().mockRejectedValueOnce(new Error("exit unconfirmed")).mockImplementation(stop);
    await expect(f.service.cancel(1, "a")).rejects.toThrow("unconfirmed");
    f.hosts[0].resolve(); await flush();
    expect(f.hosts).toHaveLength(1);
    await f.service.cancel(1, "a"); await a; f.hosts[1].resolve(); await b;
  });
  it("waits for idle host teardown before admitting another request", async () => {
    vi.useFakeTimers(); const f = fixture({ idleMs: 20 });
    const a = f.service.render(1, request("a")); f.hosts[0].resolve(); await a;
    let exit; f.hosts[0].stop = vi.fn(() => new Promise((resolve) => { exit = resolve; }));
    await vi.advanceTimersByTimeAsync(21);
    const b = f.service.render(1, request("b")); await flush();
    expect(f.hosts).toHaveLength(1); expect(f.hosts[0].render).toHaveBeenCalledTimes(1);
    exit(); await flush(); expect(f.hosts).toHaveLength(2); f.hosts[1].resolve(); await b;
  });
});

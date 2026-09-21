/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMermaidRenderService } from "../../../../../../packages/shared-ui/src/editor/markdown/features/mermaid/mermaidRenderService";
import { retireEditorTasks } from "../../../../../../packages/shared-ui/src/editor/runtime/retireEditorTasks";

const theme = { key: "light", config: { theme: "base" as const } };
const owner = { scope: "mermaid-tests", instance: "diagram.md", generation: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const service = createMermaidRenderService((svg) => svg);
  const jobs: ReturnType<typeof deferred<string>>[] = [];
  const cancels: ReturnType<typeof vi.fn>[] = [];
  const start = vi.fn(() => {
    const job = deferred<string>(); jobs.push(job);
    const cancel = vi.fn(async () => { job.reject(new DOMException("Cancelled", "AbortError")); });
    cancels.push(cancel);
    return { result: job.promise, cancel };
  });
  service.configure({ start });
  return { service, jobs, start, cancels };
}
afterEach(async () => { await retireEditorTasks(); });

describe("Mermaid render service ownership and reuse", () => {
  it("coalesces in-flight work and synchronously reuses completed normalized output", async () => {
    const f = fixture();
    const first = f.service.render({ source: "graph TD\r\n A-->B", theme, owner });
    const second = f.service.render({ source: " graph TD\n A-->B ", theme, owner });
    await flush(); expect(f.start).toHaveBeenCalledTimes(1);
    f.jobs[0].resolve("<svg />");
    expect(await first).toEqual(await second);
    expect(f.service.peek("graph TD\n A-->B", theme)?.svg).toBe("<svg />");
    await f.service.render({ source: "graph TD\n A-->B", theme, owner });
    expect(f.start).toHaveBeenCalledTimes(1);
  });
  it("keeps work alive for another consumer when one view leaves", async () => {
    const f = fixture(); const controller = new AbortController();
    const first = f.service.render({ source: "graph TD; A-->B", theme, owner, signal: controller.signal });
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = f.service.render({ source: "graph TD; A-->B", theme, owner });
    await flush(); controller.abort(); await flush();
    expect(f.cancels[0]).not.toHaveBeenCalled();
    f.jobs[0].resolve("<svg />"); await second; await rejected;
  });
  it("makes the document exit barrier wait for last-consumer cancellation acknowledgement", async () => {
    const service = createMermaidRenderService((svg) => svg);
    const computation = deferred<string>(); const exit = deferred<void>();
    const cancel = vi.fn(() => exit.promise.then(() => computation.reject(new DOMException("exit", "AbortError"))));
    service.configure({ start: () => ({ result: computation.promise, cancel }) });
    const result = service.render({ source: "graph TD; A-->B", theme, owner });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await flush();
    let closed = false;
    const barrier = retireEditorTasks(owner.scope, owner.instance).then(() => { closed = true; });
    await flush(); expect(cancel).toHaveBeenCalledTimes(1); expect(closed).toBe(false);
    exit.resolve(); await barrier; await rejected;
    expect(service.peek("graph TD; A-->B", theme)).toBeNull();
  });
  it("rejects oversize and already cancelled inputs before host allocation", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.service.render({ source: "graph TD", theme, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(f.service.render({ source: "x".repeat(131073), theme })).rejects.toThrow("limit");
    expect(f.start).not.toHaveBeenCalled();
  });
  it("does not reuse results across effective config or font changes", async () => {
    const f = fixture(); const first = f.service.render({ source: "graph TD; A-->B", theme });
    await flush(); f.jobs[0].resolve("<svg />"); await first;
    expect(f.service.peek("graph TD; A-->B", { key: "light", config: { ...theme.config, fontFamily: "serif" } })).toBeNull();
  });
  it("retries failed work and rejects oversize SVG before caching", async () => {
    const f = fixture(); const first = f.service.render({ source: "graph TD", theme });
    const rejected = expect(first).rejects.toThrow("limit");
    await flush(); f.jobs[0].resolve("x".repeat(4 * 1024 * 1024 + 1)); await rejected;
    expect(f.service.peek("graph TD", theme)).toBeNull();
    const retry = f.service.render({ source: "graph TD", theme });
    await flush(); f.jobs[1].resolve("<svg />"); await retry;
  });
  it("evicts cache by aggregate bytes as well as entry count", async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) {
      const run = f.service.render({ source: `graph TD; A-->B${i}`, theme });
      await flush(); f.jobs[i].resolve("s".repeat(4 * 1024 * 1024)); await run;
    }
    expect(f.service.peek("graph TD; A-->B0", theme)).toBeNull();
    expect(f.service.peek("graph TD; A-->B4", theme)).not.toBeNull();
  });
});

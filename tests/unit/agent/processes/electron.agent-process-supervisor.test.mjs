import { describe, expect, it, vi } from "vitest";
import {
  createAgentProcessSupervisor,
} from "../../../../electron/main/agent/application/processes/agent-process-supervisor.mjs";

describe("Agent process supervisor", () => {
  it("bounds concurrent native runtime starts and exposes queue diagnostics", async () => {
    const supervisor = createAgentProcessSupervisor({ maxConcurrentStarts: 2 });
    const releases = [];
    let active = 0;
    let peak = 0;
    const start = (label) => supervisor.runStart({ label }, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return label;
    });

    const tasks = [start("one"), start("two"), start("three")];
    await vi.waitFor(() => expect(supervisor.snapshot()).toMatchObject({ inUse: 2, queued: 1, maxConcurrentStarts: 2 }));
    expect(peak).toBe(2);
    releases.shift()();
    await vi.waitFor(() => expect(supervisor.snapshot()).toMatchObject({ inUse: 2, queued: 0 }));
    releases.splice(0).forEach((release) => release());
    await expect(Promise.all(tasks)).resolves.toEqual(["one", "two", "three"]);
    expect(supervisor.snapshot()).toMatchObject({ inUse: 0, queued: 0 });
  });

  it("removes an aborted queued start without consuming a slot", async () => {
    const supervisor = createAgentProcessSupervisor({ maxConcurrentStarts: 1 });
    let release;
    const running = supervisor.runStart({ label: "running" }, () => new Promise((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(supervisor.snapshot().inUse).toBe(1));
    const controller = new AbortController();
    const queued = supervisor.runStart({ label: "queued", signal: controller.signal }, async () => "never");
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(supervisor.snapshot()).toMatchObject({ inUse: 1, queued: 0 });
    release("done");
    await expect(running).resolves.toBe("done");
  });
});

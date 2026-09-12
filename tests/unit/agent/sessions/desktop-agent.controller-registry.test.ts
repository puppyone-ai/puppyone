import { beforeEach, describe, expect, it, vi } from "vitest";

const instances = vi.hoisted(() => [] as Array<{
  closeTabSession: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  rollbackPreparation: ReturnType<typeof vi.fn>;
}>);

vi.mock("../../../../src/features/desktop-agent/application/AgentSessionController", () => ({
  AgentSessionController: class {
    closeTabSession = vi.fn(async () => true);
    dispose = vi.fn();
    rollbackPreparation = vi.fn(async () => undefined);
    constructor() { instances.push(this); }
  },
}));

import { AgentControllerRegistry } from "../../../../src/features/desktop-agent/application/AgentControllerRegistry";

const registry = () => new AgentControllerRegistry("/workspace", () => () => null);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("Project-owned Agent Controller registry", () => {
  beforeEach(() => { instances.length = 0; });

  it("retains hidden tabs and isolates projects or generations using the same root and Item id", () => {
    const a = registry(), b = registry();
    const first = a.get("tab-0");
    for (let index = 1; index < 9; index += 1) a.get(`tab-${index}`);
    expect(a.get("tab-0")).toBe(first);
    expect(b.get("tab-0")).not.toBe(first);
    expect(instances).toHaveLength(10);
    expect(instances[0].dispose).not.toHaveBeenCalled();
    a.dispose();
    expect(instances[9].dispose).not.toHaveBeenCalled();
    b.dispose();
  });

  it("detaches an abandoned reservation before awaiting rollback without deleting its replacement", async () => {
    const owner = registry();
    const abandoned = owner.get("reserved-tab");
    const wait = deferred<void>();
    instances[0].rollbackPreparation.mockReturnValueOnce(wait.promise);
    const rollback = owner.discard("reserved-tab");
    const replacement = owner.get("reserved-tab");
    expect(replacement).not.toBe(abandoned);
    wait.resolve();
    await rollback;
    expect(owner.get("reserved-tab")).toBe(replacement);
    expect(instances[0].rollbackPreparation).toHaveBeenCalledOnce();
    owner.dispose();
  });

  it("coalesces close requests and keeps failed closes available for retry", async () => {
    const owner = registry();
    const controller = owner.get("chat");
    const wait = deferred<boolean>();
    instances[0].closeTabSession.mockReturnValueOnce(wait.promise);
    const first = owner.close("chat"), second = owner.close("chat");
    expect(second).toBe(first);
    wait.resolve(false);
    expect(await first).toBe(false);
    expect(owner.get("chat")).toBe(controller);
    expect(instances[0].dispose).not.toHaveBeenCalled();
    expect(await owner.close("chat")).toBe(true);
    expect(instances[0].closeTabSession).toHaveBeenCalledTimes(2);
    expect(instances[0].dispose).toHaveBeenCalledOnce();
    expect(owner.get("chat")).not.toBe(controller);
    owner.dispose();
  });

  it("keeps a replacement when an old close completes late", async () => {
    const owner = registry();
    owner.get("chat");
    const wait = deferred<boolean>();
    instances[0].closeTabSession.mockReturnValueOnce(wait.promise);
    const close = owner.close("chat");
    await owner.discard("chat");
    const replacement = owner.get("chat");
    wait.resolve(true);
    await close;
    expect(owner.get("chat")).toBe(replacement);
    owner.dispose();
  });

  it("releases local replicas once and cannot resurrect a disposed project", async () => {
    const owner = registry();
    owner.get("chat");
    owner.dispose(); owner.dispose();
    expect(instances[0].dispose).toHaveBeenCalledOnce();
    expect(instances[0].closeTabSession).not.toHaveBeenCalled();
    expect(() => owner.get("chat")).toThrow(/released/);
    expect(await owner.close("chat")).toBe(true);
    await owner.discard("chat");
    expect(instances).toHaveLength(1);
  });
});

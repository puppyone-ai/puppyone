import { describe, expect, it } from "vitest";
import { createItemHostBudget } from "./resource-budget.mjs";

describe("instance process admission", () => {
  it("reserves before startup, and retains failed/hidden leases until explicit exit", () => {
    const budget = createItemHostBudget({ application: 2, concurrentStarts: 1 });
    const a = budget.reserve({ key: "a", ownerId: 1, projectId: "p", kind: "terminal" });
    expect(() => budget.reserve({ key: "b", ownerId: 1, projectId: "p", kind: "agent" })).toThrow(/capacity/);
    a.ready();
    const b = budget.reserve({ key: "b", ownerId: 1, projectId: "p", kind: "agent" });
    b.ready();
    expect(() => budget.reserve({ key: "c", ownerId: 2, projectId: "q", kind: "agent" })).toThrow(/capacity/);
    a.release(); a.release();
    expect(budget.snapshot()).toHaveLength(1);
    expect(() => budget.reserve({ key: "c", ownerId: 2, projectId: "q", kind: "agent" })).not.toThrow();
  });

  it("scopes project limits by owner and rejects duplicate reservations", () => {
    const budget = createItemHostBudget({ project: 1 });
    budget.reserve({ key: "a", ownerId: 1, projectId: "p", kind: "terminal" });
    expect(() => budget.reserve({ key: "b", ownerId: 1, projectId: "p", kind: "terminal" })).toThrow(/capacity/);
    expect(() => budget.reserve({ key: "a", ownerId: 2, projectId: "p", kind: "terminal" })).toThrow(/already/);
    expect(() => budget.reserve({ key: "b", ownerId: 2, projectId: "p", kind: "terminal" })).not.toThrow();
  });

  it("enforces per-process and aggregate memory without releasing live leases", () => {
    const budget = createItemHostBudget({ reservationBytes: 1, rendererRssBytes: 8192, utilityRssBytes: 8192, projectRssBytes: 9000 });
    const failures = [];
    for (const pid of [11, 12]) {
      const lease = budget.reserve({ key: String(pid), ownerId: 1, projectId: "p", kind: "terminal" });
      lease.bindProcess(pid, "renderer", (error) => failures.push({ pid, code: error.code }));
      lease.ready();
    }
    budget.sample([{ pid: 11, memory: { workingSetSize: 6 } }, { pid: 12, memory: { workingSetSize: 4 } }]);
    expect(failures).toEqual([{ pid: 11, code: "HOST_AGGREGATE_MEMORY_BUDGET" }]);
    expect(budget.snapshot()).toHaveLength(2);
    budget.sample([{ pid: 11, memory: { workingSetSize: 6 } }, { pid: 12, memory: { workingSetSize: 4 } }]);
    expect(failures).toHaveLength(1);
    expect(() => budget.reserve({ key: "13", ownerId: 1, projectId: "p", kind: "agent" })).toThrow(/capacity/);
  });

  it("requires sustained CPU pressure, resets after a quiet sample, and attributes failure", () => {
    let now = 0;
    const budget = createItemHostBudget({ sustainedCpuMs: 1000 }, { now: () => now });
    const failures = [];
    const lease = budget.reserve({ key: "a", ownerId: 1, projectId: "p", kind: "agent" });
    lease.bindProcess(11, "utility", (error) => failures.push(error.code));
    const sample = (cpu) => budget.sample([{ pid: 11, cpu: { percentCPUUsage: cpu } }]);
    sample(100); now = 500; sample(0); now = 900; sample(100); now = 1800; sample(100);
    expect(failures).toEqual([]);
    now = 2000; sample(100);
    expect(failures).toEqual(["HOST_CPU_BUDGET"]);
    lease.release();
  });
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { createUtilityHost } from "../../../../electron/main/item-hosts/utility-host.mjs";
import { createItemHostBudget } from "../../../../electron/main/item-hosts/resource-budget.mjs";

afterEach(() => vi.useRealTimers());
it("keeps a silent utility alive through a clock jump and missed heartbeats, while retaining explicit termination", async () => {
  vi.useFakeTimers();
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.postMessage = vi.fn(message => {
    if (message.type === "request") Promise.resolve().then(() => child.emit("message", { ...message, type: "result", value: {} }));
    if (message.type === "terminate") Promise.resolve().then(() => child.emit("exit", 0));
  });
  const events = [];
  const budget = createItemHostBudget();
  const host = createUtilityHost({ utilityProcess: { fork: () => child }, modulePath: "/fixture",
    identity: { key: "fixture", kind: "agent", ownerId: 1, projectId: "fixture" }, budget, initialize: {},
    logger: { info() {} }, onEvent: event => events.push(event) });
  await host.ready;
  vi.setSystemTime(Date.now() + 3600000);
  await vi.advanceTimersByTimeAsync(60000);
  expect(child.kill).not.toHaveBeenCalled();
  expect(events).not.toContainEqual(expect.objectContaining({ type: "host-failed" }));
  expect(child.postMessage).toHaveBeenCalledWith({ type: "health-probe", generation: host.generation });
  child.emit("message", { type: "heartbeat", generation: host.generation, rss: 1024 });
  await expect(host.call("ping")).resolves.toEqual({});
  expect(host.diagnostics().health.state).toBe("responsive");
  await host.close();
  expect(host.exited).toBe(true);
  expect(budget.snapshot()).toEqual([]);
});

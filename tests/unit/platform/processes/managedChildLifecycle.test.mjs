import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { stopOwnedChild, registerDevelopmentShutdown } from "../../../../scripts/managed-child-lifecycle.mjs";

it.each([["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]])("cleans up on %s, including terminal hangup", (signal, code) => {
  const target = new EventEmitter(), shutdown = vi.fn();
  registerDevelopmentShutdown({ target, shutdown });
  target.emit(signal); target.emit(signal);
  expect(target.listenerCount(signal)).toBe(1);
  expect(shutdown).toHaveBeenCalledExactlyOnceWith(code);
});
it.each(["uncaughtException", "unhandledRejection"])("logs and shuts down after %s rather than leaving detached services", event => {
  const target = new EventEmitter(), shutdown = vi.fn(), logger = { error: vi.fn() };
  const error = new Error("fatal");
  registerDevelopmentShutdown({ target, shutdown, logger });
  target.emit(event, error); target.emit(event, error);
  expect(target.listenerCount(event)).toBe(1);
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(event), error);
  expect(shutdown).toHaveBeenCalledExactlyOnceWith(1);
});

it("still initiates cleanup when the fatal log sink is unavailable", () => {
  const target = new EventEmitter(), shutdown = vi.fn();
  registerDevelopmentShutdown({ target, shutdown, logger: { error: () => { throw new Error("closed terminal"); } } });
  expect(() => target.emit("uncaughtException", new Error("fatal"))).not.toThrow();
  expect(shutdown).toHaveBeenCalledExactlyOnceWith(1);
});

it("allows graceful exit and resolves only after the owned group disappears", async () => {
  let alive = true;
  const processKill = vi.fn((_pid, signal) => {
    if (!alive) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    if (signal === "SIGTERM") alive = false;
  });
  await stopOwnedChild({ pid: 123 }, { platform: "linux", processKill });
  expect(processKill).toHaveBeenCalledWith(-123, "SIGTERM");
  expect(processKill).not.toHaveBeenCalledWith(-123, "SIGKILL");
});
it("escalates for descendants even when the wrapper has already exited", async () => {
  let alive = true;
  const processKill = vi.fn((_pid, signal) => {
    if (!alive) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    if (signal === "SIGKILL") alive = false;
  });
  await stopOwnedChild({ pid: 123, exitCode: 0 }, { platform: "darwin", processKill, graceMs: 0 });
  expect(processKill).toHaveBeenCalledWith(-123, "SIGKILL");
});
it("surfaces cleanup failures instead of silently reporting success", async () => {
  await expect(stopOwnedChild({ pid: 123 }, { platform: "linux", processKill: vi.fn(), graceMs: 0, killWaitMs: 0 })).rejects.toThrow("did not exit");
});
it("does not signal groups that are already gone", async () => {
  const processKill = vi.fn(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
  await stopOwnedChild({ pid: 123 }, { platform: "linux", processKill });
  expect(processKill).toHaveBeenCalledOnce();
});

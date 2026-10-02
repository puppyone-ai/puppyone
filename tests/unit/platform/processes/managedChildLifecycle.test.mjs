import { expect, it, vi } from "vitest";
import { stopOwnedChild } from "../../../../scripts/managed-child-lifecycle.mjs";

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

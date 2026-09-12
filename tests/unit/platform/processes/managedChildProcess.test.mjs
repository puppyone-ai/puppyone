import { afterEach, describe, expect, it, vi } from "vitest";
import { terminateManagedChild } from "../../../../scripts/managed-child-process.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("managed development child processes", () => {
  it.skipIf(process.platform === "win32")(
    "terminates the detached process group instead of only the wrapper process",
    () => {
      const processKill = vi.spyOn(process, "kill").mockReturnValue(true);
      const child = {
        exitCode: null,
        signalCode: null,
        pid: 43210,
        kill: vi.fn(),
      };

      expect(terminateManagedChild(child)).toBe(true);
      expect(processKill).toHaveBeenCalledWith(-43210, "SIGTERM");
      expect(child.kill).not.toHaveBeenCalled();
    },
  );
});

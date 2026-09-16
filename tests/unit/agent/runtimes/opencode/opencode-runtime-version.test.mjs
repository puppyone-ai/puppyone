import { describe, expect, it, vi } from "vitest";

import { probeOpenCodeVersion } from "../../../../../scripts/lib/opencode-runtime-version.mjs";

describe("OpenCode runtime version probe", () => {
  it("retries a transient Windows timeout before accepting the pinned version", async () => {
    const timeout = Object.assign(new Error("spawnSync opencode.exe ETIMEDOUT"), { code: "ETIMEDOUT" });
    const run = vi.fn()
      .mockReturnValueOnce({ status: null, signal: "SIGTERM", stdout: "", stderr: "", error: timeout })
      .mockReturnValueOnce({ status: 0, signal: null, stdout: "1.17.18\n", stderr: "" });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(probeOpenCodeVersion("opencode.exe", "1.17.18", {
      platform: "win32",
      timeoutMs: 30_000,
      retryDelayMs: 1_000,
      run,
      wait,
    })).resolves.toBe("1.17.18");

    expect(run).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("does not retry a deterministic version mismatch", async () => {
    const run = vi.fn().mockReturnValue({ status: 0, signal: null, stdout: "1.17.17\n", stderr: "" });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(probeOpenCodeVersion("opencode.exe", "1.17.18", {
      platform: "win32",
      run,
      wait,
    })).rejects.toThrow("expected 1.17.18, received 1.17.17");

    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("reports the probe timeout after exhausting retries", async () => {
    const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    const run = vi.fn().mockReturnValue({ status: null, signal: "SIGTERM", stdout: "", stderr: "", error: timeout });

    await expect(probeOpenCodeVersion("opencode.exe", "1.17.18", {
      platform: "win32",
      attempts: 2,
      timeoutMs: 25,
      retryDelayMs: 0,
      run,
      wait: vi.fn().mockResolvedValue(undefined),
    })).rejects.toThrow("probe timed out after 25ms");

    expect(run).toHaveBeenCalledTimes(2);
  });
});

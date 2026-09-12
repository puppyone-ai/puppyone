import { describe, expect, it, vi } from "vitest";
import {
  createManagedAgentProcess,
  terminateManagedAgentProcess,
} from "../../../../electron/main/agent/transports/managed-agent-process.mjs";

describe("managed Agent process trees", () => {
  it("creates a POSIX process group and terminates the entire group", () => {
    const child = { pid: 314, kill: vi.fn() };
    const spawn = vi.fn(() => child);
    const processHandle = createManagedAgentProcess({
      spawn,
      executablePath: "/tools/agent",
      args: ["acp"],
      options: { cwd: "/workspace", stdio: ["pipe", "pipe", "pipe"] },
      platform: "darwin",
    });
    expect(spawn).toHaveBeenCalledWith("/tools/agent", ["acp"], expect.objectContaining({ detached: true, shell: false }));
    const processKill = vi.fn();
    terminateManagedAgentProcess(processHandle, "SIGTERM", { platform: "darwin", processKill });
    expect(processKill).toHaveBeenCalledWith(-314, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("uses the child handle on Windows where detached groups have different semantics", () => {
    const child = { pid: 315, kill: vi.fn() };
    terminateManagedAgentProcess({ child, grouped: false }, "SIGKILL", { platform: "win32" });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeProcessOwner } from "../../../../electron/main/item-hosts/native-process-owner.mjs";
import {
  createManagedAgentProcess,
  terminateManagedAgentProcess,
  waitForManagedAgentExit,
} from "../../../../electron/main/agent/transports/managed-agent-process.mjs";

const originalParentPort = process.parentPort;
afterEach(() => { process.parentPort = originalParentPort; });

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

  it("terminates the Windows tree before releasing ownership of an exited launcher", async () => {
    const owner = createNativeProcessOwner({ platform: "win32" });
    process.parentPort = { postMessage: message => owner.receive(message) };
    const child = Object.assign(new EventEmitter(), { pid: 315, kill: vi.fn() });
    const handle = createManagedAgentProcess({ spawn: () => child, executablePath: "C:\\tools\\agent.exe",
      args: [], options: {}, platform: "win32" });
    let finishTree;
    const run = vi.fn(() => new Promise(resolve => { finishTree = resolve; }));
    terminateManagedAgentProcess(handle, "SIGTERM", { platform: "win32", run, env: { SystemRoot: "D:\\Windows" } });
    expect(run).toHaveBeenCalledWith("D:\\Windows\\System32\\taskkill.exe", ["/PID", "315", "/T", "/F"],
      expect.objectContaining({ timeout: 3000, windowsHide: true }));
    child.emit("exit", 0);
    const connection = Object.assign(new EventEmitter(), { processHandle: handle, exitInfo: { code: 0 } });
    let complete = false;
    const waiting = waitForManagedAgentExit(connection).then(() => { complete = true; });
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(owner.snapshot()).toHaveLength(1);
    finishTree();
    await waiting;
    expect(owner.snapshot()).toEqual([]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("retains cleanup authority when taskkill fails even if the launcher has exited", async () => {
    const run = vi.fn(async () => { throw new Error("access denied"); });
    const owner = createNativeProcessOwner({ platform: "win32", run,
      kill: () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); } });
    process.parentPort = { postMessage: message => owner.receive(message) };
    const child = Object.assign(new EventEmitter(), { pid: 316, kill: vi.fn() });
    const handle = createManagedAgentProcess({ spawn: () => child, executablePath: "C:\\tools\\agent.exe",
      args: [], options: {}, platform: "win32" });
    terminateManagedAgentProcess(handle, "SIGTERM", { platform: "win32", run });
    child.emit("exit", 0);
    await expect(waitForManagedAgentExit({ processHandle: handle, exitInfo: { code: 0 } })).rejects.toThrow("tree");
    await expect(owner.close()).rejects.toThrow("cleanup is incomplete");
    expect(owner.snapshot()).toHaveLength(1);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("coalesces repeated Windows termination requests", async () => {
    const child = { pid: 315, kill: vi.fn() };
    const handle = { child, grouped: false };
    const run = vi.fn(async () => {});
    terminateManagedAgentProcess(handle, "SIGTERM", { platform: "win32", run });
    terminateManagedAgentProcess(handle, "SIGKILL", { platform: "win32", run });
    await handle.termination;
    expect(run).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("retries failed Windows termination while the leader remains owned and alive", async () => {
    const child = { pid: 317, kill: vi.fn() };
    const handle = { child, grouped: false };
    const run = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValueOnce({});
    terminateManagedAgentProcess(handle, "SIGTERM", { platform: "win32", run });
    await expect(handle.termination).resolves.toBe(false);
    terminateManagedAgentProcess(handle, "SIGKILL", { platform: "win32", run });
    await expect(handle.termination).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("accepts a confirmed utility exit while supervisor cleanup is in flight", async () => {
    let rejectKill;
    const owner = createNativeProcessOwner({ platform: "win32",
      run: () => new Promise((_, reject) => { rejectKill = reject; }),
      kill: () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); } });
    owner.receive({ action: "spawn", pid: 318, grouped: false });
    const closing = owner.close();
    owner.receive({ action: "exit", pid: 318, grouped: false });
    rejectKill(new Error("PID already terminated by the utility"));
    await expect(closing).resolves.toBeUndefined();
    expect(owner.snapshot()).toEqual([]);
  });
});

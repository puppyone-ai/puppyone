import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveNpmInvocation,
  terminateManagedChild,
} from "../../../../scripts/managed-child-process.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("managed development child processes", () => {
  it("runs npm through Node on Windows without invoking a command shell", () => {
    expect(resolveNpmInvocation({
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "C:\\Tools\\npm-cli.js",
    })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      argsPrefix: ["C:\\Tools\\npm-cli.js"],
    });
    expect(resolveNpmInvocation({
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "",
    })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      argsPrefix: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
    });
  });

  it("uses npm directly on Unix platforms", () => {
    expect(resolveNpmInvocation({ platform: "darwin" })).toEqual({ command: "npm", argsPrefix: [] });
    expect(resolveNpmInvocation({ platform: "linux" })).toEqual({ command: "npm", argsPrefix: [] });
  });

  it("terminates the detached Unix process group instead of only the wrapper process", () => {
    const processKill = vi.spyOn(process, "kill").mockReturnValue(true);
    const child = {
      exitCode: null,
      signalCode: null,
      pid: 43210,
      kill: vi.fn(),
    };

    expect(terminateManagedChild(child, "SIGTERM", { platform: "linux" })).toBe(true);
    expect(processKill).toHaveBeenCalledWith(-43210, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("terminates the complete Windows process tree without opening a console window", () => {
    const terminator = {
      once: vi.fn(),
      unref: vi.fn(),
    };
    const spawnProcess = vi.fn(() => terminator);
    const child = {
      exitCode: null,
      signalCode: null,
      pid: 43210,
      kill: vi.fn(),
    };

    expect(terminateManagedChild(child, "SIGTERM", {
      platform: "win32",
      spawnProcess,
    })).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "43210", "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    expect(terminator.unref).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });
});

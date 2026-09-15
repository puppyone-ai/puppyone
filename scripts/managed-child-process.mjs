import { spawn } from "node:child_process";
import path from "node:path";

export function resolveNpmInvocation({
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
} = {}) {
  if (platform !== "win32") {
    return { command: "npm", argsPrefix: [] };
  }

  const npmCliPath = typeof npmExecPath === "string" && npmExecPath.trim()
    ? npmExecPath
    : path.win32.join(
        path.win32.dirname(execPath),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      );
  return { command: execPath, argsPrefix: [npmCliPath] };
}

export function spawnManagedChild(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
  });
}

export function terminateManagedChild(
  child,
  signal = "SIGTERM",
  {
    platform = process.platform,
    spawnProcess = spawn,
  } = {},
) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return false;

  if (platform === "win32" && Number.isInteger(child.pid)) {
    const fallBackToDirectKill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    try {
      const terminator = spawnProcess(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      terminator.once?.("error", fallBackToDirectKill);
      terminator.once?.("exit", (code) => {
        if (code !== 0) fallBackToDirectKill();
      });
      terminator.unref?.();
      return true;
    } catch {
      return child.kill(signal);
    }
  }

  if (Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }

  return child.kill(signal);
}

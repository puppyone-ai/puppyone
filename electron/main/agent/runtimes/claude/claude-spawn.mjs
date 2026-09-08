import { EventEmitter } from "node:events";
import { createManagedAgentProcess, terminateManagedAgentProcess, waitForManagedAgentExit } from "../../transports/managed-agent-process.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";

/** Electron-safe spawn hook for Node-backed and native Claude Code installs. */
export function createClaudeSpawn({ spawn = nodeSpawn, fsModule = fs, onStderr = () => {} } = {}) {
  const processes = new Set();
  let closed = false;
  const launch = (options) => {
    if (closed) throw new Error("Claude Code process owner has closed.");
    options.signal?.throwIfAborted();
    let command = options.command;
    let args = Array.isArray(options.args) ? [...options.args] : [];
    if (requiresNode(command)) {
      const node = resolveNodeExecutable(options.env?.PATH, fsModule);
      if (!node) throw new Error("Claude Code is Node-backed, but a Node executable was not found in its runtime PATH.");
      args = [command, ...args];
      command = node;
    } else if (command === "node") {
      command = resolveNodeExecutable(options.env?.PATH, fsModule) ?? command;
    }
    if (typeof command !== "string" || !path.isAbsolute(command) || /[\r\n\0]/u.test(command)) {
      throw new Error("Claude Code process command must be an absolute validated path.");
    }
    if (args.some((argument) => (
      typeof argument !== "string" || argument.length > 4_096 || /[\r\n\0]/u.test(argument)
    ))) {
      throw new Error("Claude Code process arguments are invalid.");
    }
    if (typeof options.cwd !== "string" || !path.isAbsolute(options.cwd) || /[\r\n\0]/u.test(options.cwd)) {
      throw new Error("Claude Code process working directory must be absolute.");
    }
    const handle = createManagedAgentProcess({ spawn, executablePath: command, args, options: {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      // The SDK drains stderr and forwards it to the adapter's bounded,
      // redacted diagnostic callback. Keeping it piped also prevents a noisy
      // native CLI from inheriting Electron's stdio or filling an OS pipe.
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    } });
    const child = handle.child;
    const lease = new EventEmitter();
    lease.signal = options.signal;
    let killTimer;
    lease.stop = () => {
      if (lease.exitInfo || killTimer) return;
      terminateManagedAgentProcess(handle, "SIGTERM");
      killTimer = setTimeout(() => {
        if (!lease.exitInfo) terminateManagedAgentProcess(handle, "SIGKILL");
      }, 2000);
      killTimer.unref?.();
    };
    const finish = (code, signal, error = null) => {
      if (lease.exitInfo) return;
      lease.exitInfo = { code, signal, error };
      clearTimeout(killTimer);
      options.signal?.removeEventListener?.("abort", lease.stop);
      processes.delete(lease);
      lease.emit("exit", lease.exitInfo);
    };
    child.once("close", (code, signal) => finish(code, signal));
    child.once("error", (error) => {
      if (!child.pid) finish(null, null, error);
      else lease.stop();
    });
    processes.add(lease);
    child.stderr?.on?.("data", (chunk) => onStderr(String(chunk).slice(-8_192)));
    if (options.signal?.aborted) lease.stop();
    else options.signal?.addEventListener?.("abort", lease.stop, { once: true });
    if (!child.stdin || !child.stdout) {
      lease.stop();
      throw new Error("Claude Code process streams are unavailable.");
    }
    return child;
  };
  launch.waitForExit = async ({ signal } = {}) => {
    const results = await Promise.allSettled([...processes].filter((lease) => !signal || lease.signal === signal)
      .map((lease) => waitForManagedAgentExit(lease)));
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Claude Code processes have not all exited.");
  };
  launch.dispose = async () => {
    closed = true;
    for (const lease of processes) lease.stop();
    await launch.waitForExit();
  };
  return launch;
}

function requiresNode(command) {
  return typeof command === "string" && /\.(?:c?js|mjs)$/iu.test(command);
}

function resolveNodeExecutable(pathValue, fsModule) {
  const separator = process.platform === "win32" ? ";" : ":";
  const names = process.platform === "win32" ? ["node.exe", "node"] : ["node"];
  const candidates = [];
  for (const directory of String(pathValue || "").split(separator).filter(path.isAbsolute)) {
    for (const name of names) candidates.push(path.join(directory, name));
  }
  if (path.basename(process.execPath).toLowerCase().startsWith("node")) candidates.push(process.execPath);
  return candidates.find((candidate) => {
    try {
      fsModule.accessSync(candidate, fsModule.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

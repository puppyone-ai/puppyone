import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { reportNativeProcess } from "../../../native-process-ownership.mjs";

export function runBoundedProcessProbe(executablePath, args, {
  spawn = nodeSpawn,
  env,
  cwd,
  timeoutMs = 1500,
  maxOutputBytes = 16 * 1024,
  signal,
  label = "Local Agent probe",
} = {}) {
  validateLaunch(executablePath, args);
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const kill = () => {
      try {
        child?.kill?.("SIGKILL");
      } catch {
        // The child may have exited between the guard and kill.
      }
    };
    const fail = (message) => {
      kill();
      child?.stdout?.destroy?.();
      child?.stderr?.destroy?.();
      finish(() => reject(new Error(message)));
    };
    const abort = () => fail(`${label} was cancelled.`);
    const append = (target, chunk) => {
      if (settled) return target;
      const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      outputBytes += Buffer.byteLength(value, "utf8");
      if (outputBytes > maxOutputBytes) {
        fail(`${label} output exceeded the safety limit.`);
        return target;
      }
      return target + value;
    };

    if (signal?.aborted) {
      reject(new Error(`${label} was cancelled.`));
      return;
    }
    try {
      child = spawn(executablePath, args, {
        ...(cwd ? { cwd } : {}),
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      reject(new Error(`${label} could not start.`));
      return;
    }
    reportNativeProcess(child);
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once?.("error", () => finish(() => reject(new Error(`${label} could not start.`))));
    child.once?.("close", (code, closeSignal) => finish(() => resolve({
      stdout,
      stderr,
      code: Number.isInteger(code) ? code : null,
      signal: closeSignal ? String(closeSignal) : null,
    })));
    signal?.addEventListener?.("abort", abort, { once: true });
    timer = setTimeout(() => fail(`${label} timed out.`), Math.max(1, Math.min(timeoutMs, 10_000)));
    timer.unref?.();
  });
}

function validateLaunch(executablePath, args) {
  if (typeof executablePath !== "string" || !path.isAbsolute(executablePath) || /[\r\n\0]/.test(executablePath)) {
    throw new TypeError("Local Agent probes require a safe absolute executable path.");
  }
  if (!Array.isArray(args) || args.length > 16 || args.some((arg) => (
    typeof arg !== "string" || arg.length > 4_096 || /[\r\n\0]/.test(arg)
  ))) {
    throw new TypeError("Local Agent probe arguments are invalid.");
  }
}

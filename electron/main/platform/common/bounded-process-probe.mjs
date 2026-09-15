import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { reportNativeProcess } from "../../../native-process-ownership.mjs";
import { resolveProcessInvocation } from "../windows/process-invocation.mjs";

export function runBoundedProcessProbe(executablePath, args, {
  spawn = nodeSpawn,
  env,
  cwd,
  timeoutMs = 1500,
  maxOutputBytes = 16 * 1024,
  signal,
  label = "Desktop process probe",
  platform = process.platform,
  isolatedProcessGroup = false,
} = {}) {
  validateLaunch(executablePath, args);
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
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
      if (isolatedProcessGroup && platform !== "win32" && Number.isSafeInteger(child?.pid) && child.pid > 0) {
        try { process.kill(-child.pid, "SIGKILL"); return; } catch { /* Child may have exited. */ }
      }
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
    const append = (target, chunk, decoder) => {
      if (settled) return target;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputBytes += buffer.length;
      if (outputBytes > maxOutputBytes) {
        fail(`${label} output exceeded the safety limit.`);
        return target;
      }
      return target + decoder.write(buffer);
    };

    if (signal?.aborted) {
      reject(new Error(`${label} was cancelled.`));
      return;
    }
    try {
      const invocation = resolveProcessInvocation(executablePath, args, { env, platform });
      child = spawn(invocation.file, invocation.args, {
        ...(cwd ? { cwd } : {}),
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        ...(isolatedProcessGroup && platform !== "win32" ? { detached: true } : {}),
        ...invocation.options,
      });
    } catch {
      reject(new Error(`${label} could not start.`));
      return;
    }
    if (!child) {
      reject(new Error(`${label} could not start.`));
      return;
    }
    reportNativeProcess(child, { grouped: isolatedProcessGroup && platform !== "win32" });
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk, stdoutDecoder); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk, stderrDecoder); });
    child.once?.("error", () => finish(() => reject(new Error(`${label} could not start.`))));
    child.once?.("close", (code, closeSignal) => finish(() => resolve({
      stdout: stdout + stdoutDecoder.end(),
      stderr: stderr + stderrDecoder.end(),
      code: Number.isInteger(code) ? code : null,
      signal: closeSignal ? String(closeSignal) : null,
    })));
    signal?.addEventListener?.("abort", abort, { once: true });
    timer = setTimeout(() => fail(`${label} timed out.`), Math.max(1, Math.min(timeoutMs, 10_000)));
    timer.unref?.();
  });
}

function validateLaunch(executablePath, args) {
  if (typeof executablePath !== "string" || !(path.isAbsolute(executablePath) || path.win32.isAbsolute(executablePath)) || /[\r\n\0]/.test(executablePath)) {
    throw new TypeError("Local Agent probes require a safe absolute executable path.");
  }
  if (!Array.isArray(args) || args.length > 16 || args.some((arg) => (
    typeof arg !== "string" || arg.length > 4_096 || /[\r\n\0]/.test(arg)
  ))) {
    throw new TypeError("Local Agent probe arguments are invalid.");
  }
}

import { createJsonlFramer, writeJsonlFrame } from "../../transports/jsonl-stream.mjs";
import { EventEmitter } from "node:events";
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { redactSecretText } from "../../agent-events.mjs";
import {
  createManagedAgentProcess,
  terminateManagedAgentProcess,
  waitForManagedAgentExit,
} from "../../transports/managed-agent-process.mjs";

export const PI_RPC_MAX_LINE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_MAX_PENDING = 64;
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 2_000;

export class PiRpcRequestTimeoutError extends Error {
  constructor(command) {
    super(`Pi RPC request timed out: ${command}`);
    this.name = "PiRpcRequestTimeoutError";
    this.code = "PI_RPC_TIMEOUT";
    this.deliveryOutcome = "unknown";
    this.command = command;
  }
}

export class PiRpcDeliveryUnknownError extends Error {
  constructor(command, message) {
    super(redactSecretText(message));
    this.name = "PiRpcDeliveryUnknownError";
    this.code = "PI_RPC_DELIVERY_UNKNOWN";
    this.deliveryOutcome = "unknown";
    this.command = command;
  }
}

export class PiRpcErrorResponse extends Error {
  constructor(command, message) {
    super(`${command}: ${message}`);
    this.name = "PiRpcErrorResponse";
    this.code = "PI_RPC_ERROR";
    this.command = command;
  }
}

/** Strict LF-delimited client for Pi's official, non-JSON-RPC RPC protocol. */
export class PiRpcClient extends EventEmitter {
  constructor({
    executablePath,
    argsPrefix = [],
    args = [],
    cwd,
    env,
    spawn = nodeSpawn,
    maxLineBytes = PI_RPC_MAX_LINE_BYTES,
    maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
    maxPending = DEFAULT_MAX_PENDING,
    forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
    sensitiveValues = [],
  }) {
    super();
    validateLaunch(executablePath, [...argsPrefix, ...args], cwd);
    this.maxLineBytes = maxLineBytes;
    this.maxStderrBytes = maxStderrBytes;
    this.maxPending = maxPending;
    this.forceKillTimeoutMs = forceKillTimeoutMs;
    this.redactSensitive = (text) => sensitiveValues.reduce((result, secret) => secret
      ? result.split(JSON.stringify(secret).slice(1, -1)).join("[redacted]").split(secret).join("[redacted]") : result, String(text));
    this.nextRequestId = 1;
    this.pending = new Map();
    this.seenResponseIds = new Set();
    this.receiveStdout = createJsonlFramer({
      maxLineBytes,
      onLine: (line) => this.#receiveLine(line),
      onFailure: () => this.#protocolFailure("Pi RPC emitted a line larger than the safety limit."),
      isClosed: () => this.closed,
    });
    this.stderrBuffer = "";
    this.closed = false;
    this.exitInfo = null;
    this.exitExpected = false;
    this.closeReason = null;
    this.forceKillTimer = null;
    this.processHandle = createManagedAgentProcess({
      spawn,
      executablePath,
      args: [...argsPrefix, "--mode", "rpc", "--no-approve", ...args],
      options: {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    });
    this.child = this.processHandle.child;
    this.child.stdin?.on?.("error", (error) => {
      if (!this.closed) this.dispose(redactSecretText(error?.message || "Native RPC stdin failed."), { expected: false });
    });
    this.child.stdout?.setEncoding?.("utf8");
    this.child.stderr?.setEncoding?.("utf8");
    this.child.stdout?.on("data", (chunk) => this.receiveStdout(chunk));
    this.child.stderr?.on("data", (chunk) => this.#receiveStderr(chunk));
    this.child.once("error", (error) => this.#handleExit(null, null, error));
    this.child.once("close", (code, signal) => this.#handleExit(code, signal, null));
  }

  request(type, payload = {}, { timeoutMs = 20_000, signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Native RPC request aborted before dispatch."));
    if (this.closed) return Promise.reject(new Error("Pi RPC is not connected."));
    if (this.pending.size >= this.maxPending) return Promise.reject(new Error("Too many pending Pi RPC requests."));
    if (typeof type !== "string" || !/^[a-z][a-z0-9_]{0,79}$/u.test(type)) {
      return Promise.reject(new TypeError("Pi RPC command type is invalid."));
    }
    const id = `puppyone-${this.nextRequestId++}`;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.get(id)?.cleanup();
          this.pending.delete(id);
          const error = new PiRpcRequestTimeoutError(type);
          reject(error);
          // A timed-out mutation has an ambiguous outcome. Retire this process
          // instead of risking a duplicate prompt, abort or session switch.
          this.dispose(error.message, { expected: false });
        }, timeoutMs)
        : null;
      timer?.unref?.();
      const onAbort = () => this.dispose("Native RPC request aborted after dispatch.", { expected: false });
      signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
      this.pending.set(id, { type, resolve, reject, timer, cleanup });
      try {
        this.#write({ id, type, ...boundedPayload(payload) });
      } catch (error) {
        cleanup();
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  respondExtensionUi(message) {
    if (!message || message.type !== "extension_ui_response" || typeof message.id !== "string") {
      throw new TypeError("Pi extension UI response is invalid.");
    }
    this.#write(message);
  }

  waitForExit(options) { return waitForManagedAgentExit(this, options); }

  getDiagnostics() {
    return redactSecretText(this.redactSensitive(this.stderrBuffer).slice(-this.maxStderrBytes));
  }

  dispose(reason = "Pi RPC connection closed.", { expected = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    this.exitExpected = Boolean(expected);
    this.closeReason = redactSecretText(this.redactSensitive(reason));
    this.#rejectPending(new Error(this.closeReason));
    try {
      this.child.stdin?.end?.();
    } catch {
      // The native process may already have closed stdin.
    }
    terminateManagedAgentProcess(this.processHandle, "SIGTERM");
    if (!this.exitInfo && this.forceKillTimeoutMs > 0) {
      this.forceKillTimer = setTimeout(() => {
        this.forceKillTimer = null;
        if (!this.exitInfo) terminateManagedAgentProcess(this.processHandle, "SIGKILL");
      }, this.forceKillTimeoutMs);
      this.forceKillTimer.unref?.();
    }
  }

  #write(message) {
    if (this.closed || !this.child.stdin?.writable) throw new Error("Pi RPC stdin is unavailable.");
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
      throw new Error("Pi RPC request exceeded the safety limit.");
    }
    try {
      writeJsonlFrame(this.child.stdin, line, {
        maxBufferedBytes: this.maxLineBytes * 4,
        onError: (error) => {
          if (!this.closed) this.dispose(redactSecretText(error?.message || "Native RPC write failed."), { expected: false });
        },
      });
    } catch (error) {
      throw new PiRpcDeliveryUnknownError(
        typeof message?.type === "string" ? message.type : "response",
        error?.message || "Pi RPC write outcome is unknown.",
      );
    }
  }

  #receiveLine(line) {
    let message;
    try {
      message = JSON.parse(this.redactSensitive(line));
    } catch {
      this.#protocolFailure("Pi RPC emitted malformed protocol data.");
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.type !== "string") {
      this.#protocolFailure("Pi RPC emitted an invalid message.");
      return;
    }
    if (message.type === "response") {
      this.#receiveResponse(message);
      return;
    }
    this.emit("event", message);
  }

  #receiveResponse(message) {
    const id = typeof message.id === "string" ? message.id : "";
    if (!id || this.seenResponseIds.has(id)) {
      this.#protocolFailure("Pi RPC emitted an invalid or duplicate response id.");
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      this.#protocolFailure("Pi RPC emitted an unknown response id.");
      return;
    }
    this.pending.delete(id);
    pending.cleanup();
    this.seenResponseIds.add(id);
    if (this.seenResponseIds.size > 512) this.seenResponseIds.delete(this.seenResponseIds.values().next().value);
    if (message.command !== pending.type) {
      pending.reject(new PiRpcErrorResponse(pending.type, "response command did not match the request"));
      this.#protocolFailure("Pi RPC response correlation failed.");
      return;
    }
    if (message.success !== true) {
      pending.reject(new PiRpcErrorResponse(pending.type, redactSecretText(message.error || "Unknown Pi RPC error")));
      return;
    }
    pending.resolve(message.data);
  }

  #receiveStderr(chunk) {
    if (this.closed) return;
    this.stderrBuffer += String(chunk);
    const bytes = Buffer.from(this.stderrBuffer, "utf8");
    if (bytes.length > this.maxStderrBytes) {
      this.stderrBuffer = bytes.subarray(bytes.length - this.maxStderrBytes).toString("utf8").replace(/^\uFFFD/u, "");
    }
  }

  #protocolFailure(message) {
    const error = new Error(message);
    this.emit("protocolError", error);
    this.dispose(message, { expected: false });
  }

  #handleExit(code, signal, error) {
    if (this.exitInfo) return;
    if (this.forceKillTimer) clearTimeout(this.forceKillTimer);
    this.forceKillTimer = null;
    this.exitInfo = {
      code: Number.isInteger(code) ? code : null,
      signal: signal ? String(signal) : null,
      error: error
        ? redactSecretText(error.message || String(error))
        : this.exitExpected ? null : this.closeReason,
      diagnostics: this.getDiagnostics(),
    };
    this.closed = true;
    this.#rejectPending(new Error(error?.message || `Pi RPC process exited${code === null ? "" : ` with code ${code}`}.`));
    this.emit("exit", { ...this.exitInfo, expected: this.exitExpected });
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error?.deliveryOutcome === "unknown"
        ? error
        : new PiRpcDeliveryUnknownError(pending.type, error?.message || String(error)));
    }
    this.pending.clear();
  }
}

function validateLaunch(executablePath, args, cwd) {
  if (typeof executablePath !== "string" || !path.isAbsolute(executablePath) || /[\r\n\0]/u.test(executablePath)) {
    throw new TypeError("Pi RPC requires an absolute executable path.");
  }
  if (!Array.isArray(args) || args.length > 16 || args.some((value) => (
    typeof value !== "string" || value.length > 4_096 || /[\r\n\0]/u.test(value)
  ))) throw new TypeError("Pi RPC process arguments are invalid.");
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || /[\r\n\0]/u.test(cwd)) {
    throw new TypeError("Pi RPC requires an absolute working directory.");
  }
}

function boundedPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 64)) {
    if (key === "id" || key === "type" || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = entry;
  }
  return result;
}

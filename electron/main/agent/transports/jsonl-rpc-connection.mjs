import { createJsonlFramer, writeJsonlFrame } from "./jsonl-stream.mjs";
import { EventEmitter } from "node:events";
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { redactSecretText } from "../agent-events.mjs";
import { createManagedAgentProcess, terminateManagedAgentProcess, waitForManagedAgentExit } from "./managed-agent-process.mjs";

export const JSONL_RPC_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_MAX_PENDING = 128;
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 2_000;

export class JsonlRpcRequestTimeoutError extends Error {
  constructor(method) {
    super(`JSONL-RPC request timed out: ${method}`);
    this.name = "JsonlRpcRequestTimeoutError";
    this.code = "JSONL_RPC_TIMEOUT";
    this.deliveryOutcome = "unknown";
    this.method = method;
  }
}

export class JsonlRpcDeliveryUnknownError extends Error {
  constructor(method, message) {
    super(redactSecretText(message));
    this.name = "JsonlRpcDeliveryUnknownError";
    this.code = "JSONL_RPC_DELIVERY_UNKNOWN";
    this.deliveryOutcome = "unknown";
    this.method = method;
  }
}

export class JsonlRpcErrorResponse extends Error {
  constructor(method, code, message, data = undefined) {
    super(message);
    this.name = "JsonlRpcErrorResponse";
    this.code = Number.isFinite(code) ? Number(code) : -32603;
    this.method = method;
    this.data = data;
  }
}

export class JsonlRpcConnection extends EventEmitter {
  constructor({
    executablePath,
    args,
    cwd,
    env,
    spawn = nodeSpawn,
    maxLineBytes = JSONL_RPC_MAX_LINE_BYTES,
    maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
    maxPending = DEFAULT_MAX_PENDING,
    forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
  }) {
    super();
    if (
      typeof executablePath !== "string"
      || !path.isAbsolute(executablePath)
      || executablePath.length > 4_096
      || /[\r\n\0]/u.test(executablePath)
    ) {
      throw new TypeError("An absolute JSONL-RPC executable path is required.");
    }
    if (!Array.isArray(args) || args.some((argument) => (
      typeof argument !== "string" || argument.length > 4_096 || /[\r\n\0]/u.test(argument)
    ))) {
      throw new TypeError("JSONL-RPC process arguments are invalid.");
    }
    if (typeof cwd !== "string" || !path.isAbsolute(cwd) || /[\r\n\0]/u.test(cwd)) {
      throw new TypeError("An absolute JSONL-RPC working directory is required.");
    }
    this.maxLineBytes = maxLineBytes;
    this.maxStderrBytes = maxStderrBytes;
    this.maxPending = maxPending;
    this.forceKillTimeoutMs = forceKillTimeoutMs;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.seenResponseIds = new Set();
    this.receiveStdout = createJsonlFramer({
      maxLineBytes,
      onLine: (line) => this.#receiveLine(line),
      onFailure: () => this.#protocolFailure("The JSONL-RPC process emitted a line larger than the safety limit."),
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
      args,
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

  request(method, params, { timeoutMs = 20_000, signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Native RPC request aborted before dispatch."));
    if (this.closed) return Promise.reject(new Error("The JSONL-RPC process is not connected."));
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new Error("Too many pending JSONL-RPC requests."));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.get(String(id))?.cleanup();
          this.pending.delete(String(id));
          const error = new JsonlRpcRequestTimeoutError(method);
          reject(error);
          // A timed-out JSON-RPC request has an ambiguous result, especially for
          // mutating methods such as turn/start. Retrying on the same connection
          // could submit the mutation twice, so retire the provider immediately.
          this.dispose(error.message, { expected: false });
        }, timeoutMs)
        : null;
      timer?.unref?.();
      const onAbort = () => this.dispose("Native RPC request aborted after dispatch.", { expected: false });
      signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
      this.pending.set(String(id), { method, resolve, reject, timer, cleanup });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        cleanup();
        this.pending.delete(String(id));
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.#write(params === undefined ? { method } : { method, params });
  }

  respond(id, result) {
    this.#write({ id, result });
  }

  respondError(id, code, message) {
    this.#write({ id, error: { code, message: redactSecretText(message) } });
  }

  waitForExit(options) { return waitForManagedAgentExit(this, options); }

  getDiagnostics() {
    return redactSecretText(this.stderrBuffer.slice(-this.maxStderrBytes));
  }

  dispose(reason = "JSONL-RPC connection closed.", { expected = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    this.exitExpected = Boolean(expected);
    this.closeReason = redactSecretText(reason);
    this.#rejectPending(new Error(reason));
    try {
      this.child.stdin?.end?.();
    } catch {
      // Provider stdin may already be closed.
    }
    try {
      terminateManagedAgentProcess(this.processHandle, "SIGTERM");
    } catch {
      // Provider may already have exited.
    }
    if (!this.exitInfo && this.forceKillTimeoutMs > 0) {
      this.forceKillTimer = setTimeout(() => {
        this.forceKillTimer = null;
        if (this.exitInfo) return;
        try {
          terminateManagedAgentProcess(this.processHandle, "SIGKILL");
        } catch {
          // The process may have exited between the check and forced kill.
        }
      }, this.forceKillTimeoutMs);
      this.forceKillTimer.unref?.();
    }
  }

  #write(message) {
    if (this.closed || !this.child.stdin?.writable) {
      throw new Error("JSONL-RPC process stdin is unavailable.");
    }
    // Codex tolerates the compact shape, but ACP implementations use a strict
    // JSON-RPC 2.0 decoder. Always emit the protocol discriminator so the
    // shared transport is standards-compliant for every native runtime.
    const line = `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;
    if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
      throw new Error("JSONL-RPC request exceeded the safety limit.");
    }
    try {
      writeJsonlFrame(this.child.stdin, line, {
        maxBufferedBytes: this.maxLineBytes * 4,
        onError: (error) => {
          if (!this.closed) this.dispose(redactSecretText(error?.message || "Native RPC write failed."), { expected: false });
        },
      });
    } catch (error) {
      this.dispose("Native RPC write outcome is unknown.", { expected: false });
      throw new JsonlRpcDeliveryUnknownError(
        typeof message?.method === "string" ? message.method : "response",
        error?.message || "JSONL-RPC write outcome is unknown.",
      );
    }
  }

  #receiveLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#protocolFailure("The JSONL-RPC process emitted malformed protocol data.");
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.#protocolFailure("The JSONL-RPC process emitted an invalid message.");
      return;
    }
    if (message.jsonrpc != null && message.jsonrpc !== "2.0") {
      this.#protocolFailure("The JSONL-RPC process emitted an invalid protocol version.");
      return;
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    if (hasId && !(typeof message.id === "string" || Number.isSafeInteger(message.id))) {
      this.#protocolFailure("The JSONL-RPC process emitted an invalid message id.");
      return;
    }
    const hasMethod = typeof message.method === "string" && message.method.length > 0;
    if (hasMethod && hasId) {
      this.emit("request", message);
      return;
    }
    if (hasMethod) {
      this.emit("notification", message);
      return;
    }
    if (hasId) {
      this.#receiveResponse(message);
      return;
    }
    this.#protocolFailure("The JSONL-RPC process emitted an unclassifiable message.");
  }

  #receiveResponse(message) {
    const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
    const hasError = Object.prototype.hasOwnProperty.call(message, "error");
    if (hasResult === hasError || (hasError && (!Number.isInteger(message.error?.code) || typeof message.error?.message !== "string"))) {
      this.#protocolFailure("The JSONL-RPC process emitted an invalid response envelope.");
      return;
    }
    const id = String(message.id);
    if (this.seenResponseIds.has(id)) {
      this.#protocolFailure(`The JSONL-RPC process emitted a duplicate response id: ${id}`);
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      this.#protocolFailure(`The JSONL-RPC process emitted an unknown response id: ${id}`);
      return;
    }
    this.pending.delete(id);
    pending.cleanup();
    this.seenResponseIds.add(id);
    if (this.seenResponseIds.size > 512) {
      this.seenResponseIds.delete(this.seenResponseIds.values().next().value);
    }
    if (message.error) {
      const detail = typeof message.error.message === "string"
        ? redactSecretText(message.error.message)
        : "Unknown JSON-RPC error";
      pending.reject(new JsonlRpcErrorResponse(
        pending.method,
        message.error?.code,
        `${pending.method}: ${detail}`,
        message.error?.data,
      ));
    } else {
      pending.resolve(message.result);
    }
  }

  #receiveStderr(chunk) {
    if (this.closed) return;
    this.stderrBuffer += String(chunk);
    const bytes = Buffer.from(this.stderrBuffer, "utf8");
    if (bytes.length > this.maxStderrBytes) {
      this.stderrBuffer = bytes.subarray(bytes.length - this.maxStderrBytes).toString("utf8").replace(/^\uFFFD/, "");
    }
  }

  #protocolFailure(message) {
    const error = new Error(message);
    this.emit("protocolError", error);
    this.dispose(message, { expected: false });
  }

  #handleExit(code, signal, error) {
    if (this.exitInfo) return;
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
    this.exitInfo = {
      code: Number.isInteger(code) ? code : null,
      signal: signal ? String(signal) : null,
      error: error
        ? redactSecretText(error.message || String(error))
        : this.exitExpected
          ? null
          : this.closeReason,
      diagnostics: this.getDiagnostics(),
    };
    this.closed = true;
    this.#rejectPending(new Error(error?.message || `JSONL-RPC process exited${code === null ? "" : ` with code ${code}`}.`));
    this.emit("exit", { ...this.exitInfo, expected: this.exitExpected });
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error?.deliveryOutcome === "unknown"
        ? error
        : new JsonlRpcDeliveryUnknownError(pending.method, error?.message || String(error)));
    }
    this.pending.clear();
  }
}

import { redactSecretText } from "../../agent-events.mjs";
import { JsonlRpcErrorResponse } from "../../transports/jsonl-rpc-connection.mjs";
import {
  ACP_PROTOCOL_VERSION,
  ACP_SERVER_NOTIFICATION_ALIASES,
  ACP_SERVER_REQUEST_ALIASES,
  acpMethodCandidates,
} from "./acp-methods.mjs";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Provider-neutral Agent Client Protocol connection.
 *
 * The transport owns process framing and limits. This class owns ACP method
 * negotiation, capabilities, callbacks and method-name compatibility only.
 */
export class AcpClient {
  constructor({
    connection,
    clientInfo = { name: "puppyone-desktop", version: "0.0.0" },
    delegate = {},
    methodOverrides = {},
  }) {
    if (!connection || typeof connection.request !== "function") {
      throw new TypeError("AcpClient requires a JSONL-RPC connection.");
    }
    this.connection = connection;
    this.clientInfo = clientInfo;
    this.delegate = delegate;
    this.methodOverrides = methodOverrides;
    this.methodCache = new Map();
    this.agentInfo = null;
    this.agentCapabilities = null;
    this.protocolVersion = null;
    this.authMethods = [];
    this.disposed = false;
    this.onNotification = (message) => {
      void this.#handleNotification(message).catch((error) => this.#handleCallbackFailure(error));
    };
    this.onRequest = (message) => {
      void this.#handleRequest(message).catch((error) => this.#handleCallbackFailure(error));
    };
    connection.on("notification", this.onNotification);
    connection.on("request", this.onRequest);
  }

  async initialize(options = {}) {
    const clientCapabilities = {
      ...(options.clientCapabilities ?? {}),
      ...(this.delegate.readTextFile || this.delegate.writeTextFile
        ? {
          fs: {
            ...(options.clientCapabilities?.fs ?? {}),
            ...(this.delegate.readTextFile ? { readTextFile: true } : {}),
            ...(this.delegate.writeTextFile ? { writeTextFile: true } : {}),
          },
        }
        : {}),
    };
    const response = await this.#request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: options.clientInfo ?? this.clientInfo,
      ...(Object.keys(clientCapabilities).length > 0 ? { clientCapabilities } : {}),
    });
    this.agentInfo = recordOrNull(response?.agentInfo);
    this.agentCapabilities = recordOrNull(response?.agentCapabilities);
    this.protocolVersion = Number.isSafeInteger(response?.protocolVersion)
      ? response.protocolVersion
      : ACP_PROTOCOL_VERSION;
    this.authMethods = Array.isArray(response?.authMethods) ? response.authMethods.slice(0, 32) : [];
    return response;
  }

  authenticate(params) { return this.#request("authenticate", params); }
  requestExtension(method, params = {}, options = {}) {
    if (this.disposed) throw new Error("ACP client is closed.");
    if (typeof method !== "string" || !method.trim()) throw new TypeError("ACP extension method is required.");
    return this.connection.request(method, params, {
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });
  }
  newSession(params) { return this.#request("newSession", params); }
  loadSession(params) { return this.#request("loadSession", params); }
  resumeSession(params) { return this.#request("resumeSession", params); }
  listSessions(params = {}) { return this.#request("listSessions", params); }
  closeSession(params) { return this.#request("closeSession", params); }
  forkSession(params) { return this.#request("forkSession", params); }
  deleteSession(params) { return this.#request("deleteSession", params); }
  setModel(params) { return this.#request("setModel", params); }
  setMode(params) { return this.#request("setMode", params); }
  setConfigOption(params) { return this.#request("setConfigOption", params); }

  prompt(params) {
    // A prompt is a long-running turn. Progress arrives through session/update,
    // so an arbitrary request timeout would turn a healthy long task into an
    // ambiguous mutation and could cause an unsafe duplicate retry.
    return this.#request("prompt", params, { timeoutMs: 0 });
  }

  cancel(params) {
    const cached = this.methodCache.get("cancel");
    const candidates = cached ? [cached] : acpMethodCandidates("cancel", this.methodOverrides);
    for (const method of new Set(candidates)) this.connection.notify(method, params);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.connection.off?.("notification", this.onNotification);
    this.connection.off?.("request", this.onRequest);
  }

  async #request(logicalMethod, params, options = {}) {
    if (this.disposed) throw new Error("ACP client is closed.");
    const cached = this.methodCache.get(logicalMethod);
    if (cached) {
      return this.connection.request(cached, params, {
        timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      });
    }
    let lastMethodNotFound = null;
    for (const method of acpMethodCandidates(logicalMethod, this.methodOverrides)) {
      try {
        const result = await this.connection.request(method, params, {
          timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        });
        this.methodCache.set(logicalMethod, method);
        return result;
      } catch (error) {
        if (!(error instanceof JsonlRpcErrorResponse) || error.code !== -32601) throw error;
        lastMethodNotFound = error;
      }
    }
    throw lastMethodNotFound ?? new Error(`No ACP method is configured for ${logicalMethod}.`);
  }

  async #handleNotification(message) {
    if (this.disposed) return;
    if (ACP_SERVER_NOTIFICATION_ALIASES.sessionUpdate.includes(message?.method)) {
      await this.delegate.onSessionUpdate?.(message.params);
      return;
    }
    await this.delegate.handleNotification?.(message?.method, message?.params);
  }

  async #handleRequest(message) {
    if (this.disposed) return;
    const handler = this.#serverRequestHandler(message?.method);
    if (!handler) {
      this.connection.respondError(message.id, -32601, "ACP client method is not supported.");
      return;
    }
    try {
      this.connection.respond(message.id, await handler(message.params));
    } catch (error) {
      this.connection.respondError(
        message.id,
        -32603,
        redactSecretText(error instanceof Error ? error.message : String(error)),
      );
    }
  }

  #serverRequestHandler(method) {
    if (ACP_SERVER_REQUEST_ALIASES.requestPermission.includes(method) && this.delegate.requestPermission) {
      return (params) => this.delegate.requestPermission(params);
    }
    if (ACP_SERVER_REQUEST_ALIASES.readTextFile.includes(method) && this.delegate.readTextFile) {
      return (params) => this.delegate.readTextFile(params);
    }
    if (ACP_SERVER_REQUEST_ALIASES.writeTextFile.includes(method) && this.delegate.writeTextFile) {
      return (params) => this.delegate.writeTextFile(params);
    }
    if (this.delegate.handleRequest && this.delegate.canHandleRequest?.(method) !== false) {
      return (params) => this.delegate.handleRequest(method, params);
    }
    return null;
  }

  #handleCallbackFailure(error) {
    const message = redactSecretText(error instanceof Error ? error.message : String(error));
    this.connection.dispose?.(`ACP client callback failed: ${message}`, { expected: false });
  }
}

function recordOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

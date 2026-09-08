import fs from "node:fs";
import path from "node:path";
import { createNativePersistenceReporter } from "../../runtime/native-persistence-reporter.mjs";
import { piHistorySource } from "./pi-history-source.mjs";
import { agentHistoryReadResult } from "../../runtime/agent-history-read-result.mjs";
import { randomUUID } from "node:crypto";
import { redactSecretText } from "../../agent-events.mjs";
import { AgentProviderSessionUnavailableError } from "../../runtime/agent-runtime-port.mjs";
import {
  buildPiTurnInput,
  PI_NATIVE_IMAGE_MAX_BYTES,
  PI_NATIVE_IMAGE_MIME_TYPES,
} from "./pi-prompt-input.mjs";
import {
  createPiEventState,
  normalizePiHistory,
  normalizePiRpcEvent,
} from "./pi-event-normalizer.mjs";
import { PI_RUNTIME_DESCRIPTOR } from "./pi-identity.mjs";
import { PiRpcClient } from "./pi-rpc-client.mjs";

const PI_REASONING_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high"]);

export const PI_CAPABILITIES = Object.freeze({
  streamingText: true,
  structuredToolEvents: true,
  commandOutputStreaming: true,
  fileChangeEvents: true,
  manualApprovals: false,
  structuredQuestions: true,
  resume: true,
  fork: false,
  steer: true,
  queue: true,
  attachments: true,
  contextReferences: true,
  modelSelection: true,
  modeSelection: false,
  slashCommands: true,
  sessionHistory: true,
  history: Object.freeze({ discovery: "unsupported", exactOpen: "supported", hydration: "snapshot" }),
  recovery: Object.freeze({ strategy: "snapshot-reload", activeExecution: "outcome-unknown", atomicHandoff: false }),
  usage: true,
  accountState: true,
  mcp: false,
  skills: true,
  compaction: true,
  revision: "pi-rpc:1",
  protocol: Object.freeze({ name: "pi-rpc", version: 1 }),
  constraints: Object.freeze({
    modelSwitch: "turn-boundary",
    modeSwitch: "unsupported",
    forkRequiresIdle: true,
    compactionRequiresIdle: true,
  }),
  referenceInputs: Object.freeze({
    schemaVersion: 1,
    workspace: Object.freeze({ files: true, directories: true, crossRoots: true }),
    attachments: Object.freeze({
      image: Object.freeze({
        accepted: true,
        mimeTypes: PI_NATIVE_IMAGE_MIME_TYPES,
        maxBytes: PI_NATIVE_IMAGE_MAX_BYTES,
      }),
      text: Object.freeze({ accepted: true }),
      audio: Object.freeze({ accepted: false }),
      video: Object.freeze({ accepted: false }),
      // Non-media binaries are delivered only as authorized native path
      // mentions; Puppyone never parses or embeds their contents.
      binary: Object.freeze({ accepted: true }),
    }),
    limits: Object.freeze({
      maxCount: 32,
      // Path references are not materialized into the RPC frame. Images retain
      // their narrower per-kind and aggregate limits inside pi-prompt-input.
      maxBytesPerReference: 25 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
    }),
    steer: true,
    attachmentOnly: false,
  }),
});

export class PiRpcAdapter {
  referenceMentionDelivery(reference) {
    return PI_NATIVE_IMAGE_MIME_TYPES.includes(reference?.mime) ? "resource" : "path";
  }

  getSessionHistoryPort() {
    return Object.freeze({ sourceScopeId: this.historySource.sourceScopeId, hydrate: () => this.readHistoryResult() });
  }

  constructor({
    readiness = {},
    workspaceRoot,
    onEvent = () => {},
    onExit = () => {},
    onSessionPersisted = () => {},
    spawn,
    clientFactory = (options) => new PiRpcClient(options),
    logger = console,
    onDispose = () => {},
  }) {
    this.readiness = readiness;
    this.historySource = piHistorySource(readiness.environment ?? process.env);
    this.clients = new Set();
    this.workspaceRoot = workspaceRoot;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.persistenceReporter = createNativePersistenceReporter({
      isClosed: () => this.disposed,
      verify: async () => {
        const id = this.sessionId;
        if (!id) return null;
        const state = await this.client.request("get_state");
        if (state?.sessionId !== id || typeof state.sessionFile !== "string" || !path.isAbsolute(state.sessionFile)) return null;
        // Stat only the exact artifact returned by the native RPC, never scan or parse its store.
        const artifact = await fs.promises.stat(state.sessionFile);
        return artifact.isFile() && artifact.size > 0 && this.sessionId === id
          ? { providerSessionId: id, sourceScopeId: this.historySource.sourceScopeId } : null;
      },
      report: onSessionPersisted,
    });
    this.spawn = spawn;
    this.clientFactory = clientFactory;
    this.logger = logger;
    this.onDispose = onDispose;
    this.client = null;
    this.sessionId = null;
    this.sessionState = null;
    this.models = [];
    this.activeState = null;
    this.pendingQuestions = new Map();
    this.disposed = false;
    this.lastProtocolError = null;
  }

  async inspect() {
    this.#assertUsable();
    const client = this.#createClient(["--no-session"]);
    const warnings = [];
    client.on?.("event", (message) => this.#handleInspectionEvent(client, message));
    try {
      const [stateResult, modelResult, commandResult, thinkingResult] = await Promise.allSettled([
        client.request("get_state"),
        client.request("get_available_models"),
        client.request("get_commands"),
        client.request("get_available_thinking_levels"),
      ]);
      if (stateResult.status === "rejected" || modelResult.status === "rejected") {
        throw stateResult.status === "rejected" ? stateResult.reason : modelResult.reason;
      }
      if (commandResult.status === "rejected") warnings.push(errorText(commandResult.reason));
      if (thinkingResult.status === "rejected") warnings.push(errorText(thinkingResult.reason));
      const state = stateResult.value ?? {};
      const models = normalizePiModels(modelResult.value?.models, state, thinkingResult.status === "fulfilled"
        ? thinkingResult.value?.levels
        : []);
      const providers = normalizePiProviders(models);
      return {
        account: piAccountState(models, providers),
        providers,
        models,
        modes: [],
        commands: normalizePiCommands(commandResult.status === "fulfilled" ? commandResult.value?.commands : []),
        capabilities: piCapabilitiesForRuntime(this.readiness.version),
        runtime: {
          ...PI_RUNTIME_DESCRIPTOR,
          version: this.readiness.version ?? null,
          source: this.readiness.source ?? "user-installed",
          compatibility: this.readiness.compatibility ?? "pi-rpc-v1",
        },
        warnings: warnings.filter(Boolean),
      };
    } catch (error) {
      throw new Error(redactSecretText([
        errorText(error) || "Pi RPC inspection failed.",
        client.getDiagnostics?.(),
      ].filter(Boolean).join(" ")));
    } finally {
      await this.#releaseClient(client, "Pi RPC inspection complete.");
    }
  }

  async createSession({ model = null, effort = null } = {}) {
    await this.#connect([]);
    await this.#applySelection(model, effort);
    const state = await this.client.request("get_state");
    this.#rememberSessionState(state);
    return providerSession(state);
  }

  async resumeSession({ threadId, model = null, effort = null } = {}) {
    if (typeof threadId !== "string" || !threadId) {
      throw new AgentProviderSessionUnavailableError("Pi session id is unavailable.");
    }
    try {
      await this.#connect(["--session", threadId]);
      const state = await this.client.request("get_state");
      if (state?.sessionId !== threadId) {
        throw new AgentProviderSessionUnavailableError("Pi did not resume the requested native session.");
      }
      this.#rememberSessionState(state);
      await this.#applySelection(model, effort);
      return providerSession(this.sessionState);
    } catch (error) {
      if (error instanceof AgentProviderSessionUnavailableError || /session.+(?:not found|unavailable|does not exist)/iu.test(errorText(error))) {
        throw new AgentProviderSessionUnavailableError("The saved Pi session is no longer available.");
      }
      throw error;
    }
  }

  async readHistory() { return (await this.readHistoryResult()).events; }

  async readHistoryResult() {
    this.#assertConnected();
    const result = await this.client.request("get_messages");
    if (!Array.isArray(result?.messages)) throw new TypeError("Pi returned an invalid history snapshot.");
    return agentHistoryReadResult({ providerSessionId: this.sessionId, events: normalizePiHistory(result.messages, this.sessionId), coverage: "complete" });
  }

  async startTurn({
    prompt,
    model = null,
    effort = null,
    references: allReferences = [],
    attachments = [],
    contextReferences = [],
  }) {
    this.#assertConnected();
    if (this.activeState) throw new Error("A Pi turn is already running.");
    await this.#applySelection(model, effort);
    const references = allReferences.length > 0 ? allReferences : [...contextReferences, ...attachments];
    const input = await buildPiTurnInput({ prompt, references, workspaceRoot: this.workspaceRoot });
    const turnId = randomUUID();
    const state = createPiEventState({ turnId, providerSessionId: this.sessionId });
    this.activeState = state;
    this.onEvent({
      type: "turn.started",
      providerSessionId: this.sessionId,
      turnId,
      payload: { status: "running", model, effort },
    });
    try {
      await this.client.request("prompt", {
        message: input.message,
        ...(input.images.length > 0 ? { images: input.images } : {}),
      });
      return { turnId };
    } catch (error) {
      if (this.activeState === state) this.activeState = null;
      if (error?.deliveryOutcome === "unknown") {
        this.onExit({ expected: false, error: errorText(error) });
        throw error;
      }
      this.onEvent({
        type: "turn.failed",
        providerSessionId: this.sessionId,
        turnId,
        payload: { status: "failed", message: errorText(error) },
      });
      throw error;
    }
  }

  async steerTurn({ turnId, message, references = [] }) {
    this.#assertConnected();
    if (!this.activeState || this.activeState.turnId !== turnId) throw new Error("That Pi turn is no longer running.");
    const input = await buildPiTurnInput({ prompt: message, references, workspaceRoot: this.workspaceRoot });
    await this.client.request("steer", {
      message: input.message,
      ...(input.images.length > 0 ? { images: input.images } : {}),
    });
  }

  async interruptTurn({ turnId }) {
    this.#assertConnected();
    if (!this.activeState || this.activeState.turnId !== turnId) throw new Error("That Pi turn is no longer running.");
    this.activeState.interruptRequested = true;
    await this.client.request("abort");
  }

  async compactSession() {
    this.#assertConnected();
    if (this.activeState) throw new Error("Stop the active Pi turn before compacting the session.");
    await this.client.request("compact", {}, { timeoutMs: 120_000 });
  }

  async resolveQuestion({ requestId, answers = [], rejected = false }) {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) throw new Error("This Pi extension question is stale or already resolved.");
    this.pendingQuestions.delete(requestId);
    const first = Array.isArray(answers?.[0]) ? answers[0][0] : null;
    if (rejected || !first) {
      this.client.respondExtensionUi({ type: "extension_ui_response", id: pending.rpcId, cancelled: true });
    } else if (pending.method === "confirm") {
      this.client.respondExtensionUi({
        type: "extension_ui_response",
        id: pending.rpcId,
        confirmed: /^(?:yes|true|confirm|continue)$/iu.test(first),
      });
    } else {
      this.client.respondExtensionUi({ type: "extension_ui_response", id: pending.rpcId, value: first });
    }
    this.onEvent({
      type: "question.resolved",
      providerSessionId: this.sessionId,
      turnId: pending.turnId,
      itemId: pending.itemId,
      payload: { requestId, resolution: rejected ? "rejected" : "answered" },
    });
  }

  hasActiveProcess() {
    return this.clients.size > 0;
  }

  forceTerminate(reason = "Pi RPC runtime stopped.") {
    for (const client of this.clients) client.dispose?.(reason, { expected: false });
  }

  async dispose(reason = "Pi RPC adapter closed.") {
    this.disposed = true;
    for (const pending of this.pendingQuestions.values()) {
      try {
        this.client?.respondExtensionUi?.({ type: "extension_ui_response", id: pending.rpcId, cancelled: true });
      } catch {
        // A closing Pi process cannot remain blocked on extension UI.
      }
    }
    this.pendingQuestions.clear();
    this.client = null;
    this.activeState = null;
    const results = await Promise.allSettled([...this.clients].map((client) => this.#releaseClient(client, reason)));
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Pi processes have not all exited.");
    if (!this.disposeNotified) { this.disposeNotified = true; this.onDispose(); }
  }

  async #connect(extraArgs) {
    this.#assertUsable();
    if (this.client) return;
    const client = this.#createClient(extraArgs);
    this.client = client;
    client.on?.("event", (message) => this.#handleRpcEvent(message));
    client.on?.("protocolError", (error) => {
      this.lastProtocolError = redactSecretText(errorText(error));
    });
    client.on?.("exit", (info) => this.onExit(info));
    try {
      const state = await client.request("get_state");
      this.#rememberSessionState(state);
    } catch (error) {
      const diagnostic = client.getDiagnostics?.();
      this.client = null;
      await this.#releaseClient(client, "Pi RPC startup failed.", { expected: false });
      throw new Error(redactSecretText([errorText(error), diagnostic].filter(Boolean).join(" ")));
    }
  }

  #createClient(args) {
    if (!this.readiness.executablePath) throw new Error("Pi executable is unavailable.");
    const client = this.clientFactory({
      executablePath: this.readiness.executablePath,
      args,
      cwd: this.workspaceRoot,
      env: this.readiness.environment ?? process.env,
      ...(this.spawn ? { spawn: this.spawn } : {}),
    });
    this.clients.add(client);
    return client;
  }

  async #releaseClient(client, reason, options) {
    client.dispose?.(reason, options);
    await client.waitForExit?.();
    this.clients.delete(client);
  }

  async #applySelection(model, effort) {
    if (model) {
      const parsed = parseModel(model);
      const current = qualifiedModel(this.sessionState?.model);
      if (current !== model) {
        await this.client.request("set_model", { provider: parsed.provider, modelId: parsed.modelId });
      }
    }
    if (effort && this.sessionState?.thinkingLevel !== effort) {
      await this.client.request("set_thinking_level", { level: effort });
    }
    this.#rememberSessionState(await this.client.request("get_state"));
  }

  #rememberSessionState(state) {
    if (!state || typeof state.sessionId !== "string" || !state.sessionId) {
      throw new Error("Pi RPC did not return a native session id.");
    }
    this.sessionState = state;
    this.sessionId = state.sessionId;
  }

  #handleRpcEvent(message) {
    if (message?.type === "extension_ui_request") {
      this.#handleExtensionUi(message);
      return;
    }
    if (!this.activeState && isTurnScopedPiEvent(message?.type)) return;
    const state = this.activeState ?? createPiEventState({ providerSessionId: this.sessionId });
    const normalized = normalizePiRpcEvent(message, state);
    for (const event of normalized) this.onEvent(event);
    if (normalized.some((event) => ["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type))) {
      void this.persistenceReporter.confirm();
      if (this.activeState === state) this.activeState = null;
    }
  }

  #handleExtensionUi(message) {
    if (!dialogMethod(message.method)) {
      this.#handleExtensionNotice(message);
      return;
    }
    if (!this.activeState) {
      this.client.respondExtensionUi({ type: "extension_ui_response", id: String(message.id), cancelled: true });
      return;
    }
    const requestId = `pi:question:${randomUUID()}`;
    const itemId = `pi:extension-ui:${safeId(message.id) || randomUUID()}`;
    const question = piQuestion(message);
    this.pendingQuestions.set(requestId, {
      rpcId: String(message.id),
      method: message.method,
      turnId: this.activeState.turnId,
      itemId,
    });
    this.onEvent({
      type: "question.requested",
      providerSessionId: this.sessionId,
      turnId: this.activeState.turnId,
      itemId,
      payload: { requestId, questions: [question] },
    });
  }

  #handleExtensionNotice(message) {
    if (message.method === "setTitle" && typeof message.title === "string") {
      this.onEvent({
        type: "session.updated",
        providerSessionId: this.sessionId,
        payload: { title: message.title.slice(0, 200) },
      });
      return;
    }
    if (message.method === "notify") {
      this.onEvent({
        type: message.notifyType === "error" || message.notifyType === "warning" ? "provider.warning" : "provider.activity",
        providerSessionId: this.sessionId,
        turnId: this.activeState?.turnId ?? null,
        itemId: `pi:extension:${safeId(message.id) || randomUUID()}`,
        payload: {
          message: redactSecretText(String(message.message || "Pi extension notification").slice(0, 4_000)),
          label: "Pi extension",
          status: "completed",
        },
      });
    }
  }

  #handleInspectionEvent(client, message) {
    if (message?.type === "extension_ui_request" && dialogMethod(message.method)) {
      client.respondExtensionUi({ type: "extension_ui_response", id: String(message.id), cancelled: true });
    }
  }

  #assertConnected() {
    this.#assertUsable();
    if (!this.client || this.client.closed || !this.sessionId) throw new Error("Pi RPC session is not connected.");
  }

  #assertUsable() {
    if (this.disposed) throw new Error("Pi RPC adapter is closed.");
  }
}

export function normalizePiModels(value, state = {}, currentLevels = []) {
  const current = qualifiedModel(state.model);
  return asArray(value).slice(0, 100).map((model) => {
    const providerId = bounded(model?.provider, 160);
    const modelId = bounded(model?.id, 300);
    if (!providerId || !modelId) return null;
    const qualified = `${providerId}/${modelId}`;
    const variants = model?.reasoning === true
      ? reasoningLevels(model, qualified === current ? currentLevels : [])
      : [];
    const currentEffort = qualified === current ? bounded(state.thinkingLevel, 40) : null;
    return {
      id: qualified,
      model: qualified,
      modelId,
      providerId,
      displayName: bounded(model?.name, 300) || modelId,
      description: `${providerId} · ${Number(model?.contextWindow) > 0 ? `${Math.round(Number(model.contextWindow) / 1_000)}K context` : "Pi model"}`,
      isDefault: qualified === current,
      variants,
      defaultVariant: variants.includes(currentEffort)
        ? currentEffort
        : variants.includes("medium") ? "medium" : variants[0] ?? null,
    };
  }).filter(Boolean);
}

function reasoningLevels(model, currentLevels) {
  const advertised = asArray(currentLevels).filter(isReasoningLevel);
  if (advertised.length > 0) return Array.from(new Set(advertised));
  const levels = [...PI_REASONING_LEVELS];
  const map = record(model?.thinkingLevelMap);
  if (Object.prototype.hasOwnProperty.call(map, "xhigh")) levels.push("xhigh");
  if (Object.prototype.hasOwnProperty.call(map, "max")) levels.push("max");
  return levels;
}

function normalizePiProviders(models) {
  const groups = new Map();
  for (const model of models) {
    const group = groups.get(model.providerId) ?? [];
    group.push(model);
    groups.set(model.providerId, group);
  }
  return Array.from(groups.entries()).map(([id, entries]) => ({
    id,
    displayName: humanize(id),
    source: "pi",
    defaultModel: entries.find((model) => model.isDefault)?.model ?? entries[0]?.model ?? null,
    modelCount: entries.length,
  }));
}

function normalizePiCommands(value) {
  return asArray(value).slice(0, 500).map((command) => ({
    name: bounded(command?.name, 160),
    description: bounded(command?.description, 1_000),
    source: bounded(command?.source, 80) || "pi",
  })).filter((command) => command.name);
}

function piAccountState(models, providers) {
  if (models.length === 0) {
    return {
      account: null,
      requiresOpenaiAuth: false,
      requiresRuntimeSetup: true,
      setupReason: "runtime-setup-required",
      error: "Pi has no authenticated model providers. Configure one in Pi, then refresh.",
    };
  }
  return {
    account: {
      type: "pi",
      email: null,
      planType: providers.map((provider) => provider.displayName).join(", ").slice(0, 300) || null,
    },
    requiresOpenaiAuth: false,
    requiresRuntimeSetup: false,
  };
}

function piCapabilitiesForRuntime(version) {
  const agentVersion = bounded(version, 80) || null;
  return {
    ...PI_CAPABILITIES,
    revision: `${PI_CAPABILITIES.revision}:pi:${agentVersion ?? "unknown"}`,
    protocol: { ...PI_CAPABILITIES.protocol, agentVersion },
  };
}

function providerSession(state) {
  return {
    providerSessionId: state.sessionId,
    title: bounded(state.sessionName, 200) || "Pi session",
    model: qualifiedModel(state.model),
    effort: bounded(state.thinkingLevel, 40) || null,
    updatedAt: new Date().toISOString(),
  };
}

function parseModel(value) {
  const input = bounded(value, 512);
  const separator = input.indexOf("/");
  if (separator <= 0 || separator === input.length - 1) throw new Error("Pi model selection is invalid.");
  return { provider: input.slice(0, separator), modelId: input.slice(separator + 1) };
}

function qualifiedModel(value) {
  const provider = bounded(value?.provider, 160);
  const modelId = bounded(value?.id, 300);
  return provider && modelId ? `${provider}/${modelId}` : null;
}

function dialogMethod(value) {
  return ["select", "confirm", "input", "editor"].includes(value);
}

function isTurnScopedPiEvent(value) {
  return [
    "agent_start", "agent_end", "agent_settled", "turn_start", "turn_end",
    "message_start", "message_update", "message_end",
    "tool_execution_start", "tool_execution_update", "tool_execution_end",
    "auto_retry_start", "auto_retry_end",
  ].includes(value);
}

function piQuestion(message) {
  const question = bounded(message.title || message.message, 4_000) || "Pi needs additional input.";
  if (message.method === "select") {
    return {
      header: "Pi extension",
      question,
      multiple: false,
      custom: false,
      options: asArray(message.options).slice(0, 20).map((option) => ({
        label: bounded(option, 120),
        description: "",
      })).filter((option) => option.label),
    };
  }
  if (message.method === "confirm") {
    return {
      header: bounded(message.title, 80) || "Pi extension",
      question: bounded(message.message, 4_000) || question,
      multiple: false,
      custom: false,
      options: [{ label: "Yes", description: "" }, { label: "No", description: "" }],
    };
  }
  return {
    header: bounded(message.title, 80) || "Pi extension",
    question,
    multiple: false,
    custom: true,
    options: [],
  };
}

function humanize(value) {
  return bounded(value, 160).split(/[-_]/u).filter(Boolean).map((part) => (
    part ? `${part[0].toUpperCase()}${part.slice(1)}` : ""
  )).join(" ");
}

function isReasoningLevel(value) {
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value);
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/u.test(value) ? value : null;
}

function bounded(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function errorText(value) {
  return redactSecretText(value instanceof Error ? value.message : String(value ?? ""));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

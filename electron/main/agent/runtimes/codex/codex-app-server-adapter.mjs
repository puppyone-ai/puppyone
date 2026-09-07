import { createNativePersistenceReporter } from "../../runtime/native-persistence-reporter.mjs";
import { codexHistorySource } from "./codex-history-source.mjs";
import { agentHistoryReadResult } from "../../runtime/agent-history-read-result.mjs";
import { discoverCodexHistory } from "./codex-history-discovery.mjs";
import { codexResolveApproval, codexResolveQuestion, codexHandleServerRequest, codexHandleServerRequestResolved, codexClearPendingApprovalsForTurn, codexClearPendingApprovals, codexClearPendingQuestionsForTurn, codexClearPendingQuestions } from "./codex-interactions.mjs";
import { normalizeCodexNotification } from "./codex-events.mjs";
import { normalizeHistoricalThread } from "./codex-history-projection.mjs";
import { normalizeProviderSession, normalizeAccount, normalizeModels, compatibleReasoningEffort, requireString } from "./codex-native-values.mjs";
export { normalizeCodexNotification } from "./codex-events.mjs";
export { normalizeHistoricalThread } from "./codex-history-projection.mjs";
import { randomUUID } from "node:crypto";
import {
  buildCodexTurnInput,
  CODEX_NATIVE_IMAGE_MIME_TYPES,
} from "./codex-reference-input.mjs";
import {
  readCodexHistory,
  requestCodexMetadataOnlyThread,
} from "./codex-history-reader.mjs";
import { JsonlRpcConnection } from "../../transports/jsonl-rpc-connection.mjs";
import { redactSecretText } from "../../agent-events.mjs";
import { AgentProviderSessionUnavailableError } from "../../runtime/agent-runtime-port.mjs";
export { buildCodexTurnInput } from "./codex-reference-input.mjs";

export const CODEX_CAPABILITIES = Object.freeze({
  streamingText: true,
  structuredToolEvents: true,
  commandOutputStreaming: true,
  fileChangeEvents: true,
  manualApprovals: true,
  structuredQuestions: true,
  resume: true,
  fork: true,
  steer: true,
  queue: false,
  attachments: true,
  contextReferences: true,
  modelSelection: true,
  modeSelection: false,
  slashCommands: false,
  sessionHistory: true,
  history: Object.freeze({ discovery: "paged", exactOpen: "supported", hydration: "paged" }),
  recovery: Object.freeze({ strategy: "object-reconciliation", activeExecution: "outcome-unknown", atomicHandoff: false }),
  usage: true,
  accountState: true,
  mcp: true,
  skills: true,
  compaction: true,
  revision: "codex-app-server:1",
  protocol: Object.freeze({ name: "codex-app-server", version: 1 }),
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
      image: Object.freeze({ accepted: true, mimeTypes: CODEX_NATIVE_IMAGE_MIME_TYPES }),
      text: Object.freeze({ accepted: true }),
      audio: Object.freeze({ accepted: false }),
      video: Object.freeze({ accepted: false }),
      binary: Object.freeze({ accepted: true }),
    }),
    limits: Object.freeze({
      maxCount: 32,
      maxBytesPerReference: 25 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
    }),
    steer: false,
    attachmentOnly: false,
  }),
});

export class CodexAppServerAdapter {
  referenceMentionDelivery() { return "path"; }

  getSessionHistoryPort() {
    return Object.freeze({
      sourceScopeId: this.historySource.sourceScopeId,
      discover: (request) => this.discoverSessions(request),
      hydrate: () => this.readHistoryResult(),
    });
  }

  constructor({
    executablePath,
    environment,
    workspaceRoot,
    appVersion,
    spawn,
    connectionFactory,
    onEvent = () => {},
    onExit = () => {},
    onSessionPersisted = () => {},
  }) {
    this.executablePath = executablePath;
    this.environment = environment;
    this.historySource = codexHistorySource(environment ?? process.env);
    this.workspaceRoot = workspaceRoot;
    this.appVersion = appVersion;
    this.spawn = spawn;
    this.connectionFactory = connectionFactory;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.persistenceReporter = createNativePersistenceReporter({
      isClosed: () => this.disposed,
      verify: async () => {
        const id = this.threadId;
        if (!id) return null;
        const verified = await (async () => { const page = await discoverCodexHistory({ request: (method, params) => this.connection.request(method, params), workspaceRoot: this.workspaceRoot }, { limit: 100 });
        return page.sessions.some((entry) => entry.providerSessionId === id); })();
        return verified && this.threadId === id ? { providerSessionId: id, sourceScopeId: this.historySource.sourceScopeId } : null;
      },
      report: onSessionPersisted,
    });
    this.connection = null;
    this.threadId = null;
    this.activeTurnId = null;
    this.terminalTurnIds = new Set();
    this.pendingApprovals = new Map();
    this.pendingQuestions = new Map();
    this.modelProfiles = new Map();
    this.sessionLifecycleType = null;
    this.disposed = false;
  }

  async connect() {
    if (this.connection) return;
    const createConnection = this.connectionFactory || ((options) => new JsonlRpcConnection(options));
    const connection = createConnection({
      executablePath: this.executablePath,
      args: ["app-server", "--listen", "stdio://"],
      cwd: this.workspaceRoot,
      env: this.environment,
      ...(this.spawn ? { spawn: this.spawn } : {}),
    });
    this.connection = connection;
    connection.on("notification", (message) => this.#handleNotification(message));
    connection.on("request", (message) => codexHandleServerRequest(this, message));
    connection.on("protocolError", (error) => {
      this.lastConnectionError = redactSecretText(error.message);
    });
    connection.on("exit", (info) => {
      codexClearPendingApprovals(this, "cancel", false);
      this.onExit(info);
    });
    try {
      await connection.request("initialize", {
        clientInfo: {
          name: "puppyone_desktop",
          title: "PuppyOne Desktop",
          version: this.appVersion,
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      });
      connection.notify("initialized");
    } catch (error) {
      const diagnostic = connection.getDiagnostics?.() || "";
      connection.dispose();
      throw new Error(redactSecretText([
        error instanceof Error ? error.message : String(error),
        diagnostic,
      ].filter(Boolean).join(" ")));
    }
  }

  async inspect() {
    await this.connect();
    const [accountResult, modelResult] = await Promise.allSettled([
      this.connection.request("account/read", { refreshToken: false }),
      this.connection.request("model/list", { includeHidden: false, limit: 100 }),
    ]);
    if (accountResult.status === "rejected" && modelResult.status === "rejected") {
      throw new Error(redactSecretText(
        accountResult.reason?.message
        || modelResult.reason?.message
        || "Codex account and model inspection failed.",
      ));
    }
    const account = accountResult.status === "fulfilled"
      ? normalizeAccount(accountResult.value)
      : { account: null, requiresOpenaiAuth: false, error: redactSecretText(accountResult.reason?.message || String(accountResult.reason)) };
    const models = modelResult.status === "fulfilled"
      ? normalizeModels(modelResult.value)
      : [];
    this.modelProfiles = new Map(models.map((model) => [model.model, model]));
    return {
      account,
      models,
      modes: [],
      commands: [],
      capabilities: CODEX_CAPABILITIES,
      runtime: {
        id: "codex",
        displayName: "Codex",
        description: "Codex's native app-server runtime.",
        kind: "native-cli",
        iconKey: "codex",
        version: null,
        source: "external",
        compatibility: "versioned-app-server",
      },
      warnings: [
        ...(accountResult.status === "rejected" ? [account.error] : []),
        ...(modelResult.status === "rejected" ? [redactSecretText(modelResult.reason?.message || String(modelResult.reason))] : []),
      ].filter(Boolean),
    };
  }

  async discoverSessions(options = {}) {
    options.signal?.throwIfAborted();
    await this.connect();
    return discoverCodexHistory({ request: this.connection.request.bind(this.connection), workspaceRoot: this.workspaceRoot }, options);
  }

  async createSession({ model = null, effort = null } = {}) {
    await this.connect();
    this.sessionLifecycleType = "session.started";
    const result = await this.connection.request("thread/start", {
      cwd: this.workspaceRoot,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      ephemeral: false,
      threadSource: "puppyone-desktop",
      ...(model ? { model } : {}),
    }).finally(() => { this.sessionLifecycleType = null; });
    this.threadId = requireString(result?.thread?.id, "Codex thread/start did not return a thread id.");
    return { ...normalizeProviderSession(result), effort };
  }

  async resumeSession({ threadId, model = null, effort = null }) {
    await this.connect();
    this.sessionLifecycleType = "session.resumed";
    let result;
    try {
      result = await requestCodexMetadataOnlyThread({
        request: (method, params) => this.connection.request(method, params),
        method: "thread/resume",
        params: {
          threadId,
          cwd: this.workspaceRoot,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          ...(model ? { model } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/\bno rollout found for thread id\b/i.test(message)) {
        throw new AgentProviderSessionUnavailableError("The saved Codex thread is no longer available.");
      }
      throw error;
    } finally {
      this.sessionLifecycleType = null;
    }
    this.threadId = requireString(result?.thread?.id, "Codex thread/resume did not return a thread id.");
    return { ...normalizeProviderSession(result), effort };
  }

  async readHistory() { return (await this.readHistoryResult()).events; }

  async readHistoryResult() {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    const thread = await readCodexHistory({
      request: (method, params) => this.connection.request(method, params),
      threadId: this.threadId,
    });
    return agentHistoryReadResult({ providerSessionId: this.threadId, events: normalizeHistoricalThread(thread), coverage: thread.coverage ?? "unknown" });
  }

  async startTurn({ prompt, clientUserMessageId = randomUUID(), model = null, effort: requestedEffort = null, references = [], attachments = [], contextReferences = [] }) {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    const effort = compatibleReasoningEffort(this.modelProfiles.get(model), requestedEffort);
    const input = buildCodexTurnInput(
      prompt,
      references.length > 0 ? references : [...contextReferences, ...attachments],
      this.workspaceRoot,
    );
    let result;
    try {
      result = await this.connection.request("turn/start", {
        threadId: this.threadId,
        clientUserMessageId,
        input,
        cwd: this.workspaceRoot,
        approvalPolicy: "on-request",
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
    } catch (error) {
      // The request identity remains useful even when delivery is ambiguous:
      // a native user item may still arrive and confirm that exact command.
      if (error && typeof error === "object") {
        try { error.clientUserMessageId = clientUserMessageId; } catch { /* preserve the original failure */ }
      }
      throw error;
    }
    const turnId = requireString(result?.turn?.id, "Codex turn/start did not return a turn id.");
    // A receipt confirms delivery. Notifications received while awaiting it
    // already describe newer native execution state and must win.
    if (!this.terminalTurnIds.has(turnId) && (!this.activeTurnId || this.activeTurnId === turnId)) this.activeTurnId = turnId;
    return { turnId, clientUserMessageId };
  }

  async interruptTurn({ turnId }) {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    await this.connection.request("turn/interrupt", {
      threadId: this.threadId,
      turnId,
    });
    codexClearPendingApprovalsForTurn(this, turnId, "turn-interrupted", true);
    codexClearPendingQuestionsForTurn(this, turnId, true);
  }

  async steerTurn({ turnId, message, references = [] }) {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    if (references.length > 0) throw new Error("Codex steer does not accept reference inputs.");
    await this.connection.request("turn/steer", {
      threadId: this.threadId,
      expectedTurnId: turnId,
      input: buildCodexTurnInput(message, []),
    });
  }

  async forkSession({ messageId = null } = {}) {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    if (this.activeTurnId) throw new Error("Stop the active Codex turn before forking.");
    const result = await requestCodexMetadataOnlyThread({
      request: (method, params) => this.connection.request(method, params),
      method: "thread/fork",
      params: {
        threadId: this.threadId,
        ...(messageId ? { messageId } : {}),
      },
    });
    return { providerSessionId: requireString(result?.thread?.id, "Codex thread/fork did not return a thread id.") };
  }

  async compactSession() {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    if (this.activeTurnId) throw new Error("Stop the active Codex turn before compacting.");
    await this.connection.request("thread/compact/start", { threadId: this.threadId });
  }
  resolveApproval(...args) { return codexResolveApproval(this, ...args); }

  resolveQuestion(...args) { return codexResolveQuestion(this, ...args); }


  async dispose(reason = "Codex app-server adapter closed.") {
    if (this.disposed) return this.connection?.waitForExit?.();
    this.disposed = true;
    codexClearPendingApprovals(this, "cancel", true);
    codexClearPendingQuestions(this, true);
    this.connection?.dispose(reason);
    await this.connection?.waitForExit?.();
  }

  #handleNotification(message) {
    if (message?.method === "serverRequest/resolved") {
      codexHandleServerRequestResolved(this, message.params ?? {});
      return;
    }
    const events = normalizeCodexNotification(message);
    for (const event of events) {
      if (event.type === "session.started" && this.sessionLifecycleType === "session.resumed") {
        event.type = "session.resumed";
      }
      if (event.type.startsWith("turn.") && event.turnId) {
        if (event.type === "turn.started" && !this.terminalTurnIds.has(event.turnId)) this.activeTurnId = event.turnId;
        if (["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type)) {
          void this.persistenceReporter.confirm();
          this.terminalTurnIds.add(event.turnId);
          while (this.terminalTurnIds.size > 128) this.terminalTurnIds.delete(this.terminalTurnIds.values().next().value);
          if (this.activeTurnId === event.turnId) this.activeTurnId = null;
          codexClearPendingApprovalsForTurn(this, event.turnId, "turn-ended");
          codexClearPendingQuestionsForTurn(this, event.turnId);
        }
      }
      this.onEvent(event);
    }
  }
}

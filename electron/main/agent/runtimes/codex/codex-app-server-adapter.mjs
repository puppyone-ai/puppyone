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
import { boundRendererValue, redactSecrets, redactSecretText } from "../../agent-events.mjs";
import { AgentProviderSessionUnavailableError } from "../../runtime/agent-runtime-port.mjs";
export { buildCodexTurnInput } from "./codex-reference-input.mjs";
const CODEX_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

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
      discover: (request) => this.discoverSessions(request),
      hydrate: () => this.readHistory(),
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
  }) {
    this.executablePath = executablePath;
    this.environment = environment;
    this.workspaceRoot = workspaceRoot;
    this.appVersion = appVersion;
    this.spawn = spawn;
    this.connectionFactory = connectionFactory;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.connection = null;
    this.threadId = null;
    this.activeTurnId = null;
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
    connection.on("request", (message) => this.#handleServerRequest(message));
    connection.on("protocolError", (error) => {
      this.lastConnectionError = redactSecretText(error.message);
    });
    connection.on("exit", (info) => {
      this.#clearPendingApprovals("cancel", false);
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

  async discoverSessions({ cursor = null, limit = 50 } = {}) {
    await this.connect();
    const result = await this.connection.request("thread/list", {
      cwd: this.workspaceRoot,
      cursor,
      limit: boundedPageSize(limit),
      archived: false,
      sortKey: "updated_at",
      sortDirection: "desc",
      // History discovery must query Codex's native metadata index only. It
      // must never trigger a rollout scan merely because the launcher opened.
      useStateDbOnly: true,
    });
    return {
      supported: true,
      sessions: (Array.isArray(result?.data) ? result.data : [])
        .filter((thread) => !thread?.ephemeral && thread?.cwd === this.workspaceRoot)
        .slice(0, boundedPageSize(limit))
        .map((thread) => ({
          providerSessionId: requireString(thread.id, "Codex thread/list returned an invalid thread id."),
          title: stringOrNull(thread.name) || stringOrNull(thread.preview) || "Codex session",
          createdAt: toIsoFromSeconds(thread.createdAt),
          updatedAt: toIsoFromSeconds(thread.updatedAt),
          selectedProviderId: stringOrNull(thread.modelProvider),
        })),
      nextCursor: stringOrNull(result?.nextCursor),
    };
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

  async readHistory() {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    const thread = await readCodexHistory({
      request: (method, params) => this.connection.request(method, params),
      threadId: this.threadId,
    });
    return normalizeHistoricalThread(thread);
  }

  async startTurn({ prompt, model = null, effort: requestedEffort = null, references = [], attachments = [], contextReferences = [] }) {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    const clientUserMessageId = randomUUID();
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
    this.activeTurnId = requireString(result?.turn?.id, "Codex turn/start did not return a turn id.");
    return { turnId: this.activeTurnId, clientUserMessageId };
  }

  async interruptTurn({ turnId }) {
    if (!this.threadId) throw new Error("No Codex thread is active.");
    await this.connection.request("turn/interrupt", {
      threadId: this.threadId,
      turnId,
    });
    this.#clearPendingApprovalsForTurn(turnId, "turn-interrupted", true);
    this.#clearPendingQuestionsForTurn(turnId, true);
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

  resolveApproval({ requestId, decision, threadId, turnId }) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) throw new Error("This approval is no longer pending.");
    if (pending.threadId !== threadId || pending.turnId !== turnId || pending.threadId !== this.threadId) {
      throw new Error("Approval correlation did not match the active Codex turn.");
    }
    if (!pending.availableDecisions.includes(decision)) {
      throw new Error("Codex did not offer that approval decision.");
    }
    this.connection.respond(pending.rpcId, { decision });
    this.pendingApprovals.delete(requestId);
  }

  resolveQuestion({ requestId, answers, rejected, turnId }) {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending || pending.threadId !== this.threadId || pending.turnId !== turnId) {
      throw new Error("Question correlation did not match the active Codex turn.");
    }
    this.pendingQuestions.delete(requestId);
    this.connection.respond(pending.rpcId, {
      answers: rejected ? {} : codexQuestionAnswers(pending.questions, answers),
    });
  }

  dispose(reason = "Codex app-server adapter closed.") {
    if (this.disposed) return;
    this.disposed = true;
    this.#clearPendingApprovals("cancel", true);
    this.#clearPendingQuestions(true);
    this.connection?.dispose(reason);
  }

  #handleNotification(message) {
    if (message?.method === "serverRequest/resolved") {
      this.#handleServerRequestResolved(message.params ?? {});
      return;
    }
    const events = normalizeCodexNotification(message);
    for (const event of events) {
      if (event.type === "session.started" && this.sessionLifecycleType === "session.resumed") {
        event.type = "session.resumed";
      }
      if (event.type.startsWith("turn.") && event.turnId) {
        if (event.type === "turn.started") this.activeTurnId = event.turnId;
        if (["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type)) {
          if (this.activeTurnId === event.turnId) this.activeTurnId = null;
          this.#clearPendingApprovalsForTurn(event.turnId, "turn-ended");
          this.#clearPendingQuestionsForTurn(event.turnId);
        }
      }
      this.onEvent(event);
    }
  }

  #handleServerRequest(message) {
    const { method, id, params = {} } = message;
    if (method === "item/tool/requestUserInput") {
      this.#handleQuestionRequest({ id, params });
      return;
    }
    if (method !== "item/commandExecution/requestApproval" && method !== "item/fileChange/requestApproval") {
      this.connection.respondError(id, -32601, `Unsupported Codex server request: ${method}`);
      this.onEvent({
        type: "provider.warning",
        turnId: typeof params.turnId === "string" ? params.turnId : null,
        itemId: typeof params.itemId === "string" ? params.itemId : null,
        payload: { message: `Codex requested unsupported input (${method}); it was denied.` },
      });
      return;
    }
    if (
      typeof params.threadId !== "string"
      || params.threadId !== this.threadId
      || typeof params.turnId !== "string"
      || typeof params.itemId !== "string"
    ) {
      this.connection.respond(id, { decision: "cancel" });
      this.onEvent({
        type: "provider.error",
        payload: { message: "A Codex approval had impossible session ownership and was cancelled.", recoverable: false },
      });
      return;
    }
    const explicitDecisions = Array.isArray(params.availableDecisions)
      ? params.availableDecisions.filter(isApprovalDecision)
      : [];
    const availableDecisions = explicitDecisions.length > 0
      ? explicitDecisions
      : ["accept", "decline", "cancel"];
    const requestId = `codex:${String(id)}`;
    const kind = method.includes("commandExecution") ? "command" : "file-change";
    const networkApprovalContext = normalizeNetworkApprovalContext(params.networkApprovalContext);
    this.pendingApprovals.set(requestId, {
      rpcId: id,
      requestId,
      kind,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      availableDecisions,
    });
    this.onEvent({
      type: "approval.requested",
      providerSessionId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      payload: boundRendererValue(redactSecrets({
        requestId,
        kind,
        title: networkApprovalContext
          ? "Allow network access"
          : kind === "command"
            ? "Run command"
            : "Apply file changes",
        command: typeof params.command === "string" ? params.command : null,
        cwd: typeof params.cwd === "string" ? params.cwd : null,
        commandActions: Array.isArray(params.commandActions) ? params.commandActions : [],
        networkApprovalContext,
        reason: typeof params.reason === "string" ? params.reason : null,
        grantRoot: typeof params.grantRoot === "string" ? params.grantRoot : null,
        proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
        proposedNetworkPolicyAmendments: Array.isArray(params.proposedNetworkPolicyAmendments)
          ? params.proposedNetworkPolicyAmendments
          : [],
        availableDecisions,
        startedAtMs: Number.isFinite(params.startedAtMs) ? params.startedAtMs : Date.now(),
      })),
    });
  }

  #handleQuestionRequest({ id, params }) {
    if (
      typeof params.threadId !== "string"
      || params.threadId !== this.threadId
      || typeof params.turnId !== "string"
      || typeof params.itemId !== "string"
    ) {
      this.connection.respond(id, { answers: {} });
      this.onEvent({
        type: "provider.error",
        payload: { message: "A Codex question had impossible session ownership and was cancelled.", recoverable: false },
      });
      return;
    }
    const questions = normalizeCodexQuestions(params.questions);
    const requestId = `codex:question:${String(id)}`;
    this.pendingQuestions.set(requestId, {
      rpcId: id,
      requestId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      questions,
    });
    this.onEvent({
      type: "question.requested",
      providerSessionId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      payload: { requestId, questions: questions.map(({ id: _id, ...question }) => question) },
    });
  }

  #handleServerRequestResolved(params) {
    const providerRequestId = params?.requestId;
    if (typeof providerRequestId !== "string" && typeof providerRequestId !== "number") return;
    const normalizedProviderId = String(providerRequestId).replace(/^codex:/, "");
    const pending = Array.from(this.pendingApprovals.values()).find((entry) => (
      String(entry.rpcId) === normalizedProviderId || entry.requestId === String(providerRequestId)
    ));
    if (!pending) return;
    this.pendingApprovals.delete(pending.requestId);
    this.onEvent({
      type: "approval.resolved",
      providerSessionId: pending.threadId,
      turnId: pending.turnId,
      itemId: pending.itemId,
      payload: { requestId: pending.requestId, decision: "cancel", reason: "provider-resolved" },
    });
  }

  #clearPendingApprovalsForTurn(turnId, reason, respond = false) {
    if (!turnId) return;
    for (const pending of Array.from(this.pendingApprovals.values())) {
      if (pending.turnId !== turnId) continue;
      if (respond && this.connection && !this.connection.closed) {
        try {
          this.connection.respond(pending.rpcId, { decision: "cancel" });
        } catch {
          // A closed provider cannot execute an unapproved action.
        }
      }
      this.pendingApprovals.delete(pending.requestId);
      this.onEvent({
        type: "approval.resolved",
        providerSessionId: pending.threadId,
        turnId: pending.turnId,
        itemId: pending.itemId,
        payload: { requestId: pending.requestId, decision: "cancel", reason },
      });
    }
  }

  #clearPendingApprovals(decision, respond) {
    for (const pending of this.pendingApprovals.values()) {
      if (respond && this.connection && !this.connection.closed) {
        try {
          this.connection.respond(pending.rpcId, { decision });
        } catch {
          // A closed provider cannot execute an unapproved action.
        }
      }
      this.onEvent({
        type: "approval.resolved",
        providerSessionId: pending.threadId,
        turnId: pending.turnId,
        itemId: pending.itemId,
        payload: { requestId: pending.requestId, decision, reason: "adapter-closed" },
      });
    }
    this.pendingApprovals.clear();
  }

  #clearPendingQuestionsForTurn(turnId, respond = false) {
    for (const pending of Array.from(this.pendingQuestions.values())) {
      if (pending.turnId !== turnId) continue;
      if (respond && this.connection && !this.connection.closed) {
        try {
          this.connection.respond(pending.rpcId, { answers: {} });
        } catch {
          // A closed provider cannot keep waiting for user input.
        }
      }
      this.pendingQuestions.delete(pending.requestId);
    }
  }

  #clearPendingQuestions(respond) {
    for (const pending of this.pendingQuestions.values()) {
      if (respond && this.connection && !this.connection.closed) {
        try {
          this.connection.respond(pending.rpcId, { answers: {} });
        } catch {
          // A closed provider cannot keep waiting for user input.
        }
      }
    }
    this.pendingQuestions.clear();
  }
}

export function normalizeCodexNotification(message) {
  const method = message?.method;
  const params = message?.params ?? {};
  const threadId = stringOrNull(params.threadId);
  const turnId = stringOrNull(params.turnId ?? params.turn?.id);
  const item = params.item && typeof params.item === "object" ? params.item : null;
  const itemId = stringOrNull(params.itemId ?? item?.id);
  switch (method) {
    case "thread/started": {
      const thread = params.thread ?? {};
      return [{
        type: "session.started",
        providerSessionId: stringOrNull(thread.id),
        payload: {
          title: thread.name || thread.preview || "Codex session",
          createdAt: toIsoFromSeconds(thread.createdAt),
          updatedAt: toIsoFromSeconds(thread.updatedAt),
        },
      }];
    }
    case "thread/status/changed":
      // Runtime status is lifecycle state, not a diagnostic. The accompanying
      // failed-turn payload carries the actionable message exactly once.
      return [];
    case "turn/started":
      return [{ type: "turn.started", providerSessionId: threadId, turnId, payload: { status: "running" } }];
    case "turn/completed": {
      const status = params.turn?.status;
      const type = status === "interrupted" ? "turn.interrupted" : status === "failed" ? "turn.failed" : "turn.completed";
      const message = params.turn?.error?.message ? formatCodexErrorMessage(params.turn.error.message) : "";
      const terminalEvent = {
        type,
        providerSessionId: threadId,
        turnId,
        payload: {
          status: normalizeTurnStatus(status),
          ...(message ? { message } : {}),
        },
      };
      return status === "failed" && message
        ? [terminalEvent, {
          type: "provider.error",
          providerSessionId: threadId,
          turnId,
          payload: { message, recoverable: true },
        }]
        : [terminalEvent];
    }
    case "item/started":
      return normalizeItemLifecycle(item, "started", threadId, turnId);
    case "item/completed":
      return normalizeItemLifecycle(item, "completed", threadId, turnId);
    case "item/agentMessage/delta":
      return [{ type: "assistant.delta", providerSessionId: threadId, turnId, itemId, payload: { delta: String(params.delta ?? "") } }];
    case "item/reasoning/summaryTextDelta":
      return [{
        type: "reasoning.summary.delta",
        providerSessionId: threadId,
        turnId,
        itemId,
        payload: {
          delta: String(params.delta ?? ""),
          summaryIndex: params.summaryIndex ?? 0,
          updateMode: "append",
        },
      }];
    case "item/reasoning/summaryPartAdded":
      // This is a section boundary, not hidden chain-of-thought content. It is
      // enough to surface the native working state before readable summary text
      // arrives without leaking raw reasoning tokens.
      return [{ type: "reasoning.summary.delta", providerSessionId: threadId, turnId, itemId, payload: { delta: "", summaryIndex: params.summaryIndex ?? 0, boundary: true } }];
    case "turn/plan/updated":
      return [{ type: "plan.updated", providerSessionId: threadId, turnId, payload: { explanation: stringOrNull(params.explanation), steps: normalizePlan(params.plan) } }];
    case "item/plan/delta":
      return [{
        type: "plan.updated",
        providerSessionId: threadId,
        turnId,
        itemId,
        payload: { text: String(params.delta ?? ""), streaming: true, updateMode: "append" },
      }];
    case "item/commandExecution/outputDelta":
      return [{ type: "command.output.delta", providerSessionId: threadId, turnId, itemId, payload: { delta: String(params.delta ?? "") } }];
    case "item/fileChange/outputDelta":
      return [{ type: "tool.progress", providerSessionId: threadId, turnId, itemId, payload: { delta: String(params.delta ?? "") } }];
    case "item/fileChange/patchUpdated":
      return [{ type: "file.change.updated", providerSessionId: threadId, turnId, itemId, payload: { changes: summarizeFileChanges(params.changes) } }];
    case "item/mcpToolCall/progress":
      return [{ type: "tool.progress", providerSessionId: threadId, turnId, itemId, payload: boundRendererValue(redactSecrets(params)) }];
    case "thread/tokenUsage/updated":
      return [{ type: "usage.updated", providerSessionId: threadId, turnId, payload: boundRendererValue(params.tokenUsage ?? {}) }];
    case "error":
      return [{
        type: params.willRetry ? "provider.connection.updated" : "provider.error",
        providerSessionId: threadId,
        turnId,
        payload: params.willRetry
          ? {
            state: "reconnecting",
            message: formatCodexErrorMessage(params.error, "Codex is reconnecting."),
            ...(Number.isSafeInteger(params.attempt) ? { attempt: params.attempt } : {}),
            ...(Number.isSafeInteger(params.maxAttempts) ? { maxAttempts: params.maxAttempts } : {}),
          }
          : { message: formatCodexErrorMessage(params.error, "Codex reported an error."), recoverable: false },
      }];
    case "warning":
      return [{
        type: "provider.connection.updated",
        providerSessionId: threadId,
        turnId,
        payload: { state: "fallback", message: formatProviderWarning(params) },
      }];
    case "configWarning":
      return [{ type: "provider.warning", providerSessionId: threadId, turnId, payload: { message: formatProviderWarning(params) } }];
    case "deprecationNotice":
      // App-server migration diagnostics are for the integration owner. They
      // must never become user-authored or assistant-authored transcript rows.
      return [];
    default:
      return [];
  }
}

export function normalizeHistoricalThread(thread) {
  const events = [];
  if (!thread || !Array.isArray(thread.turns)) return events;
  for (const turn of thread.turns) {
    const turnId = stringOrNull(turn?.id);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    // turn.started retains the first prompt for older projection consumers.
    // Every native user item is also normalized below with its own identity;
    // follow-ups must never be flattened into the initial turn prompt.
    const firstUserMessage = items.find((item) => item?.type === "userMessage");
    const prompt = readCodexUserMessageText(firstUserMessage);
    const userMessageId = stringOrNull(firstUserMessage?.id);
    events.push({
      type: "turn.started",
      providerSessionId: thread.id,
      turnId,
      payload: {
        status: "running",
        restored: true,
        ...(prompt ? { prompt } : {}),
        ...(userMessageId ? { userMessageId } : {}),
      },
    });
    for (const item of items) {
      events.push(...normalizeItemLifecycle(item, "completed", thread.id, turnId));
    }
    const type = historicalTerminalEventType(turn.status);
    if (type) {
      events.push({ type, providerSessionId: thread.id, turnId, payload: { status: normalizeTurnStatus(turn.status), restored: true } });
    }
  }
  return events;
}

function normalizeItemLifecycle(item, phase, threadId, turnId) {
  if (!item || typeof item !== "object") return [];
  const itemId = stringOrNull(item.id);
  if (item.type === "userMessage") {
    return phase === "completed"
      ? [{
          type: "user.message",
          providerSessionId: threadId,
          turnId,
          itemId,
          payload: { text: readCodexUserMessageText(item) },
        }]
      : [];
  }
  if (item.type === "agentMessage") {
    return phase === "completed"
      ? [{ type: "assistant.completed", providerSessionId: threadId, turnId, itemId, payload: { text: String(item.text ?? "") } }]
      : [];
  }
  if (item.type === "plan") {
    return [{
      type: "plan.updated",
      providerSessionId: threadId,
      turnId,
      itemId,
      payload: {
        text: String(item.text ?? ""),
        completed: phase === "completed",
        updateMode: "replace",
      },
    }];
  }
  if (item.type === "reasoning") {
    return (Array.isArray(item.summary) ? item.summary : []).map((summary, index) => ({
      type: "reasoning.summary.delta",
      providerSessionId: threadId,
      turnId,
      itemId,
      payload: {
        delta: String(summary),
        summaryIndex: index,
        completed: phase === "completed",
        updateMode: "replace",
      },
    }));
  }
  if (item.type === "fileChange") {
    const changes = summarizeFileChanges(item.changes);
    const path = changes.length === 1 ? changes[0]?.path ?? null : null;
    return [
      { type: phase === "started" ? "tool.started" : "tool.completed", providerSessionId: threadId, turnId, itemId, payload: {
        kind: "file-change",
        tool: "edit",
        label: changes.length > 1 ? `Edit ${changes.length} files` : path ? `Edit ${path}` : "Edit files",
        input: { changes },
        path,
        status: normalizeToolStatus(item.status, phase),
      } },
      { type: "file.change.updated", providerSessionId: threadId, turnId, itemId, payload: { changes, status: normalizeToolStatus(item.status, phase) } },
    ];
  }
  const tool = summarizeToolItem(item, phase);
  if (tool) return [{ type: phase === "started" ? "tool.started" : "tool.completed", providerSessionId: threadId, turnId, itemId, payload: tool }];
  return phase === "completed" && typeof item.type === "string"
    ? [{
        type: "provider.warning",
        providerSessionId: threadId,
        turnId,
        itemId,
        payload: { message: `Codex returned an unsupported content item (${item.type}).`, recoverable: true },
      }]
    : [];
}

function readCodexUserMessageText(item) {
  const text = (Array.isArray(item?.content) ? item.content : [])
    .flatMap((content) => content?.type === "text" && typeof content.text === "string" ? [content.text] : [])
    .join("\n");
  return text.slice(0, 128 * 1024);
}

function summarizeToolItem(item, phase) {
  if (item.type === "commandExecution") {
    return boundRendererValue({
      kind: "command",
      tool: "bash",
      label: item.command || "Command",
      command: item.command || "",
      input: { command: item.command || "", cwd: item.cwd || null },
      cwd: item.cwd || null,
      status: normalizeToolStatus(item.status, phase),
      exitCode: Number.isInteger(item.exitCode) ? item.exitCode : null,
      durationMs: Number.isFinite(item.durationMs) ? item.durationMs : null,
      ...(phase === "completed" && item.aggregatedOutput ? { outputPreview: String(item.aggregatedOutput).slice(-16 * 1024) } : {}),
    });
  }
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    const result = normalizeCanonicalToolResult(item);
    return boundRendererValue(redactSecrets({
      kind: item.type === "mcpToolCall" ? "mcp" : "tool",
      tool: String(item.tool || (item.type === "mcpToolCall" ? "mcp" : "tool")).trim().toLowerCase(),
      label: item.type === "mcpToolCall" ? `${item.server}.${item.tool}` : item.tool,
      status: normalizeToolStatus(item.status, phase),
      input: item.arguments ?? null,
      durationMs: Number.isFinite(item.durationMs) ? item.durationMs : null,
      ...(result ? { result, outputPreview: canonicalToolResultText(result) } : {}),
    }));
  }
  if (item.type === "webSearch") return { kind: "search", tool: "websearch", label: item.query || "Web search", query: item.query || "", input: { query: item.query || "" }, status: phase === "completed" ? "completed" : "running" };
  if (item.type === "imageView") return { kind: "read", tool: "read", label: `Viewed ${item.path || "image"}`, path: item.path || null, input: { path: item.path || null }, status: phase === "completed" ? "completed" : "running" };
  if (item.type === "contextCompaction") return { kind: "system", tool: "compaction", label: "Compacted context", status: phase === "completed" ? "completed" : "running" };
  return null;
}

function summarizeFileChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes.slice(0, 100).map((change) => {
    const diff = typeof change?.diff === "string" ? change.diff : "";
    const lines = diff.split("\n");
    return {
      path: typeof change?.path === "string" ? change.path : "Unknown file",
      kind: typeof change?.kind === "string" ? change.kind : "update",
      additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
      deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
    };
  });
}

function normalizePlan(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.slice(0, 100).map((entry) => ({
    step: String(entry?.step ?? ""),
    status: ["pending", "inProgress", "completed"].includes(entry?.status) ? entry.status : String(entry?.status ?? "pending"),
  }));
}

function normalizeTurnStatus(status) {
  if (status === "interrupted") return "interrupted";
  if (status === "failed") return "failed";
  if (status === "inProgress") return "running";
  return "completed";
}

function historicalTerminalEventType(status) {
  if (status === "completed") return "turn.completed";
  if (status === "failed") return "turn.failed";
  if (status === "interrupted") return "turn.interrupted";
  return null;
}

function normalizeCanonicalToolResult(item) {
  const content = [];
  const append = (entry) => {
    if (typeof entry === "string" && entry) {
      content.push({ type: "text", text: entry });
      return;
    }
    if (!entry || typeof entry !== "object") return;
    if (entry.type === "text" && typeof entry.text === "string") {
      content.push({ type: "text", text: entry.text });
      return;
    }
    if (entry.type === "resource" && entry.resource && typeof entry.resource === "object") {
      content.push({
        type: "artifact",
        uri: typeof entry.resource.uri === "string" ? entry.resource.uri : "",
        mimeType: typeof entry.resource.mimeType === "string" ? entry.resource.mimeType : null,
        text: typeof entry.resource.text === "string" ? entry.resource.text : null,
      });
      return;
    }
    content.push({ type: "json", value: entry });
  };
  const nativeResult = item.result;
  if (Array.isArray(nativeResult?.content)) nativeResult.content.forEach(append);
  else if (nativeResult !== undefined && nativeResult !== null) append(nativeResult);
  if (Array.isArray(item.contentItems)) item.contentItems.forEach(append);
  const error = item.error == null
    ? null
    : typeof item.error === "string"
      ? item.error
      : typeof item.error?.message === "string"
        ? item.error.message
        : JSON.stringify(item.error);
  if (content.length === 0 && !error && item.success === undefined) return null;
  return {
    content,
    error,
    success: typeof item.success === "boolean" ? item.success : null,
    truncated: false,
  };
}

function canonicalToolResultText(result) {
  const pieces = result.content.flatMap((entry) => {
    if (entry.type === "text") return [entry.text];
    if (entry.type === "artifact" && entry.text) return [entry.text];
    if (entry.type === "json") return [JSON.stringify(entry.value)];
    return [];
  });
  if (result.error) pieces.push(result.error);
  return pieces.join("\n").slice(-16 * 1024);
}

function normalizeToolStatus(status, phase) {
  if (status === "inProgress" || phase === "started") return "running";
  if (status === "declined") return "declined";
  if (status === "failed") return "failed";
  return "completed";
}

function normalizeProviderSession(result) {
  return {
    providerSessionId: result.thread.id,
    title: result.thread.name || result.thread.preview || "Codex session",
    model: result.model || null,
    createdAt: toIsoFromSeconds(result.thread.createdAt),
    updatedAt: toIsoFromSeconds(result.thread.updatedAt),
  };
}

function normalizeAccount(result) {
  const account = result?.account;
  if (!account || typeof account !== "object") {
    const requiresOpenaiAuth = Boolean(result?.requiresOpenaiAuth);
    return {
      account: null,
      requiresOpenaiAuth,
      ...(requiresOpenaiAuth ? { setupReason: "authentication-required" } : {}),
    };
  }
  return {
    account: {
      type: typeof account.type === "string" ? account.type : "unknown",
      email: typeof account.email === "string" ? account.email : null,
      planType: typeof account.planType === "string" ? account.planType : null,
    },
    requiresOpenaiAuth: Boolean(result?.requiresOpenaiAuth),
  };
}

function normalizeModels(result) {
  if (!Array.isArray(result?.data)) return [];
  return result.data.filter((model) => !model?.hidden).slice(0, 100).map((model) => {
    const variants = Array.isArray(model?.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
        .map((entry) => normalizeCodexReasoningEffort(entry?.reasoningEffort))
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 20)
      : [];
    const advertisedDefault = normalizeCodexReasoningEffort(model?.defaultReasoningEffort);
    return {
      id: String(model.id ?? model.model ?? ""),
      model: String(model.model ?? model.id ?? ""),
      displayName: String(model.displayName ?? model.model ?? model.id ?? "Codex"),
      description: String(model.description ?? ""),
      isDefault: Boolean(model.isDefault),
      variants,
      defaultVariant: variants.includes(advertisedDefault)
        ? advertisedDefault
        : variants.includes("medium")
          ? "medium"
          : variants[0] ?? null,
    };
  }).filter((model) => model.id);
}

function normalizeCodexReasoningEffort(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  // Older catalogs/configs used `max`; the app-server wire value is `xhigh`.
  const compatible = normalized === "max" ? "xhigh" : normalized;
  return CODEX_REASONING_EFFORTS.has(compatible) ? compatible : null;
}

function compatibleReasoningEffort(model, requested = null) {
  if (!model || !Array.isArray(model.variants) || model.variants.length === 0) {
    if (requested) throw new Error("The selected Codex model does not support configurable reasoning effort.");
    return null;
  }
  if (requested) {
    const normalized = normalizeCodexReasoningEffort(requested);
    if (normalized && model.variants.includes(normalized)) return normalized;
    throw new Error("The selected Codex reasoning effort is no longer available for this model.");
  }
  if (model.defaultVariant && model.variants.includes(model.defaultVariant)) return model.defaultVariant;
  return model.variants.includes("medium") ? "medium" : model.variants[0] ?? null;
}

function formatCodexErrorMessage(value, fallback = "Codex reported an error.") {
  return redactSecretText(extractCodexErrorText(value) || fallback);
}

function extractCodexErrorText(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        const nested = extractCodexErrorText(JSON.parse(text), depth + 1);
        if (nested) return nested;
      } catch {
        // Keep the bounded provider text when it only resembles JSON.
      }
    }
    return text.slice(0, 32_768);
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  return extractCodexErrorText(value.error?.message, depth + 1)
    || extractCodexErrorText(value.message, depth + 1)
    || extractCodexErrorText(value.error, depth + 1);
}

function isApprovalDecision(value) {
  return ["accept", "acceptForSession", "decline", "cancel"].includes(value);
}

function normalizeNetworkApprovalContext(value) {
  if (!value || typeof value !== "object") return null;
  const host = typeof value.host === "string" ? value.host.trim() : "";
  const protocol = typeof value.protocol === "string" ? value.protocol.trim() : "";
  if (!host || !protocol) return null;
  return { host: host.slice(0, 512), protocol: protocol.slice(0, 40) };
}

function normalizeCodexQuestions(value) {
  return (Array.isArray(value) ? value : []).slice(0, 16).map((question, index) => ({
    id: stringOrNull(question?.id) || `question-${index + 1}`,
    header: String(question?.header || `Question ${index + 1}`).slice(0, 160),
    question: String(question?.question || "Input required").slice(0, 2_000),
    multiple: Boolean(question?.multiple || question?.multiSelect),
    custom: question?.custom !== false,
    options: (Array.isArray(question?.options) ? question.options : []).slice(0, 64).map((option) => ({
      label: String(option?.label ?? option ?? "").slice(0, 300),
      description: String(option?.description ?? "").slice(0, 1_000),
    })).filter((option) => option.label),
  }));
}

function codexQuestionAnswers(questions, answers) {
  return Object.fromEntries(questions.map((question, index) => [
    question.id,
    { answers: (Array.isArray(answers?.[index]) ? answers[index] : []).map((answer) => String(answer).slice(0, 2_000)) },
  ]));
}

function formatProviderWarning(params) {
  const summary = typeof params?.message === "string"
    ? params.message
    : typeof params?.summary === "string"
      ? params.summary
      : "Codex warning";
  const details = typeof params?.details === "string" ? params.details : null;
  const warningPath = typeof params?.path === "string" ? params.path : null;
  return redactSecretText([
    summary,
    details,
    warningPath ? `(${warningPath})` : null,
  ].filter(Boolean).join(" "));
}

function requireString(value, message) {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toIsoFromSeconds(value) {
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date().toISOString();
}

function boundedPageSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 50;
}

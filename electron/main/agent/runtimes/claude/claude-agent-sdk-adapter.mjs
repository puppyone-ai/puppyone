import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { boundRendererValue, redactSecrets, redactSecretText } from "../../agent-events.mjs";
import {
  formatAuthorizedProjectInstructions,
  loadAuthorizedProjectInstructions,
} from "../../security/authorized-project-instructions.mjs";
import {
  createClaudeEventState,
  normalizeClaudeHistory,
  normalizeClaudeMessage,
} from "./claude-events.mjs";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "./claude-identity.mjs";
import { ClaudeMessageChannel, createClaudeUserMessage } from "./claude-message-channel.mjs";
import { createClaudeSpawn } from "./claude-spawn.mjs";
import { AgentProviderSessionUnavailableError } from "../../runtime/agent-runtime-port.mjs";
import { formatAuthorizedWorkspaceReferencePrompt } from "../../security/authorized-workspace-reference-prompt.mjs";
import {
  buildClaudeUserMessageContent,
  CLAUDE_NATIVE_IMAGE_MAX_BYTES,
  CLAUDE_NATIVE_IMAGE_MIME_TYPES,
} from "./claude-prompt-input.mjs";

const INSPECTION_TIMEOUT_MS = 30_000;
const CLAUDE_PROJECT_INSTRUCTION_NAMES = Object.freeze(["CLAUDE.md", "AGENTS.md", "CONTEXT.md"]);
export { CLAUDE_NATIVE_IMAGE_MAX_BYTES, CLAUDE_NATIVE_IMAGE_MIME_TYPES };

export const CLAUDE_CAPABILITIES = Object.freeze({
  streamingText: true,
  structuredToolEvents: true,
  commandOutputStreaming: true,
  fileChangeEvents: true,
  manualApprovals: true,
  structuredQuestions: true,
  resume: true,
  fork: true,
  steer: false,
  queue: false,
  attachments: true,
  contextReferences: true,
  modelSelection: true,
  modeSelection: true,
  slashCommands: true,
  sessionHistory: true,
  history: Object.freeze({ discovery: "paged", exactOpen: "supported", hydration: "snapshot" }),
  recovery: Object.freeze({ strategy: "snapshot-reload", activeExecution: "outcome-unknown", atomicHandoff: false }),
  usage: true,
  accountState: true,
  mcp: true,
  skills: true,
  compaction: false,
  revision: "claude-agent-sdk:0.3.159",
  protocol: Object.freeze({ name: "claude-agent-sdk", version: "0.3.159" }),
  constraints: Object.freeze({
    modelSwitch: "turn-boundary",
    modeSwitch: "turn-boundary",
    forkRequiresIdle: true,
    compactionRequiresIdle: true,
  }),
  referenceInputs: Object.freeze({
    schemaVersion: 1,
    workspace: Object.freeze({ files: true, directories: true, crossRoots: true }),
    attachments: Object.freeze({
      image: Object.freeze({
        accepted: true,
        mimeTypes: CLAUDE_NATIVE_IMAGE_MIME_TYPES,
        maxBytes: CLAUDE_NATIVE_IMAGE_MAX_BYTES,
      }),
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

export class ClaudeAgentSdkAdapter {
  referenceMentionDelivery() { return "path"; }

  getSessionHistoryPort() {
    return Object.freeze({
      discover: (request) => this.discoverSessions(request),
      hydrate: () => this.readHistory(),
    });
  }

  constructor({
    readiness,
    workspaceRoot,
    appVersion = "0.0.0",
    sdkLoader = () => import("@anthropic-ai/claude-agent-sdk"),
    onEvent = () => {},
    onExit = () => {},
    projectInstructionLoader = (root) => loadAuthorizedProjectInstructions(root, {
      instructionNames: CLAUDE_PROJECT_INSTRUCTION_NAMES,
    }),
    spawnClaudeCodeProcess = null,
    logger = console,
  }) {
    this.readiness = readiness ?? {};
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.appVersion = appVersion;
    this.sdkLoader = sdkLoader;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.projectInstructionLoader = projectInstructionLoader;
    this.spawnClaudeCodeProcess = spawnClaudeCodeProcess ?? createClaudeSpawn({
      onStderr: (data) => {
        const diagnostic = redactSecretText(String(data)).trim().slice(-4_000);
        if (diagnostic) logger.warn?.(`Claude Code runtime: ${diagnostic}`);
      },
    });
    this.logger = logger;
    this.sdk = null;
    this.sessionId = null;
    this.resuming = false;
    this.activeTurnId = null;
    this.activeQuery = null;
    this.activeController = null;
    this.activeState = null;
    this.messageChannel = null;
    this.queryConfigurationKey = null;
    this.queryConsumer = null;
    this.interruptRequested = false;
    this.pendingApprovals = new Map();
    this.pendingQuestions = new Map();
    this.modelProfiles = new Map();
    this.disposed = false;
  }

  async inspect() {
    const sdk = await this.#loadSdk();
    const controller = new AbortController();
    const query = sdk.query({
      prompt: idleInput(controller.signal),
      options: this.#queryOptions({ abortController: controller }),
    });
    try {
      const initialized = await withTimeout(
        query.initializationResult(),
        INSPECTION_TIMEOUT_MS,
        "Claude Code inspection timed out.",
      );
      const models = normalizeModels(initialized?.models);
      this.modelProfiles = new Map(models.map((model) => [model.model, model]));
      const account = normalizeAccount(initialized?.account, models, this.readiness.environment);
      return {
        account,
        providers: [],
        models,
        modes: [
          { id: "agent", displayName: "Agent", description: "Claude Code's standard permission flow.", isDefault: true },
          { id: "plan", displayName: "Plan", description: "Read-only planning with Claude Code's native plan mode.", isDefault: false },
        ],
        commands: normalizeCommands(initialized?.commands),
        capabilities: claudeCapabilitiesForRuntime(this.readiness.version),
        runtime: {
          ...CLAUDE_RUNTIME_DESCRIPTOR,
          version: this.readiness.version ?? null,
          source: this.readiness.source ?? "user-installed",
          compatibility: this.readiness.compatibility ?? "native-sdk",
        },
        warnings: [],
      };
    } finally {
      controller.abort();
      query.close?.();
    }
  }

  async discoverSessions({ cursor = null, limit = 50 } = {}) {
    this.#assertUsable();
    const sdk = await this.#loadSdk();
    if (typeof sdk.listSessions !== "function") return { supported: false, sessions: [], nextCursor: null };
    const offset = numericCursor(cursor);
    const pageSize = boundedPageSize(limit);
    const sessions = await sdk.listSessions({ dir: this.workspaceRoot, limit: pageSize, offset });
    const normalized = asArray(sessions).filter((session) => (
      safeId(session?.sessionId) && (!session?.cwd || path.resolve(session.cwd) === this.workspaceRoot)
    )).slice(0, pageSize).map((session) => ({
      providerSessionId: session.sessionId,
      title: bounded(session.customTitle || session.summary || session.firstPrompt, 500) || "Claude Code session",
      createdAt: normalizeDate(session.createdAt ?? session.lastModified),
      updatedAt: normalizeDate(session.lastModified),
    }));
    return {
      supported: true,
      sessions: normalized,
      nextCursor: normalized.length === pageSize ? String(offset + normalized.length) : null,
    };
  }

  async createSession({ model = null, effort = null, mode = "agent" } = {}) {
    this.#assertIdle();
    await this.#closePersistentQuery("Starting a new Claude Code session.");
    this.sessionId = null;
    this.resuming = false;
    const now = new Date().toISOString();
    return {
      providerSessionId: null,
      title: "New Claude Code session",
      model,
      effort,
      mode,
      createdAt: now,
      updatedAt: now,
    };
  }

  async resumeSession({ threadId, model = null, effort = null, mode = "agent" } = {}) {
    this.#assertIdle();
    await this.#closePersistentQuery("Resuming a Claude Code session.");
    const sdk = await this.#loadSdk();
    const info = await sdk.getSessionInfo(threadId, { dir: this.workspaceRoot });
    if (!info?.sessionId) {
      throw new AgentProviderSessionUnavailableError("The saved Claude Code session is no longer available.");
    }
    this.sessionId = info.sessionId;
    this.resuming = true;
    return {
      providerSessionId: info.sessionId,
      title: info.customTitle || info.summary || "Claude Code session",
      model,
      effort,
      mode,
      createdAt: normalizeDate(info.createdAt),
      updatedAt: normalizeDate(info.lastModified),
    };
  }

  async readHistory() {
    if (!this.sessionId) return [];
    const sdk = await this.#loadSdk();
    const messages = await sdk.getSessionMessages(this.sessionId, {
      dir: this.workspaceRoot,
      limit: 1_000,
      includeSystemMessages: false,
    });
    return normalizeClaudeHistory(messages, this.sessionId);
  }

  async startTurn({ prompt, model = null, effort = null, mode = "agent", references: allReferences = [], attachments = [], contextReferences = [] }) {
    this.#assertUsable();
    if (this.activeTurnId) throw new Error("A Claude Code turn is already running.");
    const sdk = await this.#loadSdk();
    const projectInstructions = await this.projectInstructionLoader(this.workspaceRoot);
    const references = allReferences.length > 0 ? allReferences : [...contextReferences, ...attachments];
    const messageContent = await buildClaudeUserMessageContent({
      prompt,
      references,
      workspaceRoot: this.workspaceRoot,
    });
    const turnId = `claude:${randomUUID()}`;
    const controller = new AbortController();
    const state = createClaudeEventState({ turnId, resumed: this.resuming || Boolean(this.sessionId) });
    const selectedEffort = compatibleClaudeEffort(this.modelProfiles.get(model), effort);
    await this.#ensurePersistentQuery({ sdk, controller, model, effort: selectedEffort, mode, projectInstructions });
    this.activeTurnId = turnId;
    this.activeState = state;
    this.interruptRequested = false;
    this.messageChannel.setSessionId(this.sessionId ?? "");
    this.messageChannel.enqueue(createClaudeUserMessage(
      messageContent,
      this.sessionId ?? "",
    ));
    return { turnId };
  }

  async interruptTurn({ turnId }) {
    if (!this.activeTurnId || this.activeTurnId !== turnId) throw new Error("That Claude Code turn is no longer running.");
    this.interruptRequested = true;
    const interrupt = this.activeQuery?.interrupt?.();
    if (interrupt && typeof interrupt.then === "function") {
      await Promise.race([interrupt.catch(() => {}), delay(1_000)]);
    }
    // Keep the long-lived query connected. `interrupt()` stops only the active
    // native turn; AgentService force-terminates the process if it never
    // confirms the interruption.
  }

  resolveApproval({ requestId, decision, turnId }) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending || pending.turnId !== turnId || turnId !== this.activeTurnId) {
      throw new Error("Approval correlation did not match the active Claude Code turn.");
    }
    this.pendingApprovals.delete(requestId);
    if (decision === "accept" || decision === "acceptForSession") {
      const updatedPermissions = decision === "acceptForSession"
        ? asArray(pending.suggestions).filter((suggestion) => suggestion?.destination === "session")
        : [];
      pending.resolve({
        behavior: "allow",
        updatedInput: pending.input,
        ...(updatedPermissions.length ? { updatedPermissions } : {}),
      });
      return;
    }
    pending.resolve({
      behavior: "deny",
      message: decision === "cancel" ? "User interrupted." : "User denied this action.",
      interrupt: decision === "cancel",
    });
  }

  resolveQuestion({ requestId, answers, rejected, turnId }) {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending || pending.turnId !== turnId || turnId !== this.activeTurnId) {
      throw new Error("Question correlation did not match the active Claude Code turn.");
    }
    this.pendingQuestions.delete(requestId);
    if (rejected) {
      pending.resolve({ behavior: "deny", message: "User declined to answer.", interrupt: true });
      return;
    }
    pending.resolve({
      behavior: "allow",
      updatedInput: { ...pending.input, answers: questionAnswerMap(pending.questions, answers) },
    });
  }

  async forkSession({ messageId = null } = {}) {
    if (!this.sessionId) throw new Error("No Claude Code session is active.");
    const sdk = await this.#loadSdk();
    const forked = await sdk.forkSession(this.sessionId, {
      dir: this.workspaceRoot,
      ...(messageId ? { upToMessageId: messageId } : {}),
    });
    await this.#closePersistentQuery("Forking the Claude Code session.");
    return { providerSessionId: forked.sessionId };
  }

  async dispose(reason = "Claude Code adapter closed.") {
    if (this.disposed) return;
    this.disposed = true;
    this.interruptRequested = true;
    this.#resolvePending(reason);
    await this.#closePersistentQuery(reason);
    this.#clearActive();
  }

  async #consumePersistent(query, channel) {
    let emittedTerminal = false;
    try {
      for await (const message of query) {
        if (this.disposed || this.activeQuery !== query) return;
        if (typeof message?.session_id === "string" && message.session_id) this.sessionId = message.session_id;
        channel.setSessionId(this.sessionId ?? "");
        const state = this.activeState;
        if (!state) continue;
        const normalized = normalizeClaudeMessage(message, state);
        for (const event of normalized) {
          const output = this.interruptRequested && ["turn.completed", "turn.failed"].includes(event.type)
            ? { ...event, type: "turn.interrupted", payload: { ...event.payload, status: "interrupted" } }
            : event;
          this.onEvent(output);
        }
        if (state.terminal && this.activeState === state) {
          channel.onTurnComplete();
          this.#clearActive();
        }
      }
    } catch (error) {
      const state = this.activeState;
      if (!this.disposed && this.activeQuery === query && state && !state.terminal) {
        const interrupted = this.interruptRequested || this.activeController?.signal.aborted;
        if (!interrupted) {
          this.onEvent({
            type: "provider.error",
            providerSessionId: this.sessionId,
            turnId: state.turnId,
            itemId: null,
            payload: { message: redactSecretText(error instanceof Error ? error.message : String(error)), recoverable: true },
          });
        }
        this.onEvent({
          type: interrupted ? "turn.interrupted" : "turn.failed",
          providerSessionId: this.sessionId,
          turnId: state.turnId,
          itemId: null,
          payload: { status: interrupted ? "interrupted" : "failed" },
        });
        emittedTerminal = true;
      }
    } finally {
      if (this.activeQuery === query) {
        const state = this.activeState;
        if (!this.disposed && state && !state.terminal && !emittedTerminal) {
          this.onEvent({
            type: this.interruptRequested ? "turn.interrupted" : "turn.failed",
            providerSessionId: this.sessionId,
            turnId: state.turnId,
            itemId: null,
            payload: { status: this.interruptRequested ? "interrupted" : "failed" },
          });
        }
        this.#resolvePending("Claude Code query closed before the request was resolved.");
        channel.close();
        this.activeQuery = null;
        this.activeController = null;
        this.messageChannel = null;
        this.queryConfigurationKey = null;
        this.queryConsumer = null;
        this.#clearActive();
      }
    }
  }

  async #ensurePersistentQuery({ sdk, controller, model, effort, mode, projectInstructions }) {
    const configurationKey = JSON.stringify({
      model: model ?? null,
      effort: effort ?? null,
      mode,
      instructions: projectInstructionIdentity(projectInstructions),
    });
    if (this.activeQuery && this.queryConfigurationKey === configurationKey) {
      await this.activeQuery.setModel?.(model || undefined);
      await this.activeQuery.setPermissionMode?.(mode === "plan" ? "plan" : "default");
      return;
    }
    await this.#closePersistentQuery("Claude Code query configuration changed.");
    const channel = new ClaudeMessageChannel({
      onWarning: (message) => this.logger.warn?.(message),
    });
    channel.setSessionId(this.sessionId ?? "");
    const query = sdk.query({
      prompt: channel,
      options: this.#queryOptions({
        abortController: controller,
        model,
        effort,
        mode,
        resume: this.sessionId,
        projectInstructions,
      }),
    });
    this.activeController = controller;
    this.activeQuery = query;
    this.messageChannel = channel;
    this.queryConfigurationKey = configurationKey;
    this.queryConsumer = this.#consumePersistent(query, channel);
    try {
      await withTimeout(query.initializationResult(), INSPECTION_TIMEOUT_MS, "Claude Code startup timed out.");
    } catch (error) {
      await this.#closePersistentQuery("Claude Code startup failed.");
      throw error;
    }
  }

  async #closePersistentQuery(reason) {
    const query = this.activeQuery;
    const controller = this.activeController;
    this.activeQuery = null;
    this.activeController = null;
    this.queryConfigurationKey = null;
    this.messageChannel?.close();
    this.messageChannel = null;
    controller?.abort();
    query?.close?.();
    if (this.queryConsumer) {
      await Promise.race([Promise.resolve(this.queryConsumer).catch(() => {}), delay(1_000)]);
    }
    this.queryConsumer = null;
    if (reason && this.pendingApprovals.size + this.pendingQuestions.size > 0) this.#resolvePending(reason);
  }

  #queryOptions({
    abortController,
    model = null,
    effort = null,
    mode = "agent",
    resume = null,
    projectInstructions = [],
  } = {}) {
    const append = formatAuthorizedProjectInstructions(projectInstructions);
    return {
      abortController,
      cwd: this.workspaceRoot,
      env: cleanEnvironment({
        ...(this.readiness.environment ?? {}),
        CLAUDE_AGENT_SDK_CLIENT_APP: `puppyone-desktop/${this.appVersion}`,
        PUPPYONE_AGENT_BACKEND: "claude",
      }),
      ...(this.readiness.executablePath ? { pathToClaudeCodeExecutable: this.readiness.executablePath } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(resume ? { resume } : {}),
      permissionMode: mode === "plan" ? "plan" : "default",
      canUseTool: (toolName, input, options) => this.#requestPermission(toolName, input, options),
      spawnClaudeCodeProcess: this.spawnClaudeCodeProcess,
      stderr: (data) => {
        const diagnostic = redactSecretText(String(data)).trim().slice(-4_000);
        if (diagnostic) this.logger.warn?.(`Claude Code runtime: ${diagnostic}`);
      },
      includePartialMessages: true,
      settingSources: ["user"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        ...(append ? { append } : {}),
      },
    };
  }

  #requestPermission(toolName, input, options = {}) {
    if (this.disposed || !this.activeTurnId) {
      return Promise.resolve({ behavior: "deny", message: "No active Claude Code session owns this request." });
    }
    if (toolName === "AskUserQuestion") return this.#requestQuestion(input, options);
    const requestId = `claude:${safeId(options.toolUseID) || randomUUID()}`;
    return new Promise((resolve) => {
      const pending = {
        requestId,
        turnId: this.activeTurnId,
        input: input ?? {},
        suggestions: options.suggestions,
        resolve,
      };
      this.pendingApprovals.set(requestId, pending);
      listenForAbort(options.signal, () => {
        if (!this.pendingApprovals.delete(requestId)) return;
        resolve({ behavior: "deny", message: "Approval request was cancelled.", interrupt: true });
      });
      this.onEvent({
        type: "approval.requested",
        providerSessionId: this.sessionId,
        turnId: this.activeTurnId,
        itemId: safeId(options.toolUseID),
        payload: {
          requestId,
          title: bounded(options.title, 300) || `Allow ${humanize(toolName)}`,
          description: bounded(options.description, 2_000) || bounded(options.decisionReason, 2_000),
          displayName: bounded(options.displayName, 160) || humanize(toolName),
          kind: permissionKind(toolName),
          toolName: bounded(toolName, 160),
          input: boundRendererValue(redactSecrets(input)),
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        },
      });
    });
  }

  #requestQuestion(input, options) {
    const requestId = `claude:${safeId(options.toolUseID) || randomUUID()}`;
    const questions = normalizeQuestions(input?.questions);
    return new Promise((resolve) => {
      this.pendingQuestions.set(requestId, {
        requestId,
        turnId: this.activeTurnId,
        input: input ?? {},
        questions,
        resolve,
      });
      listenForAbort(options.signal, () => {
        if (!this.pendingQuestions.delete(requestId)) return;
        resolve({ behavior: "deny", message: "Question request was cancelled.", interrupt: true });
      });
      this.onEvent({
        type: "question.requested",
        providerSessionId: this.sessionId,
        turnId: this.activeTurnId,
        itemId: safeId(options.toolUseID),
        payload: { requestId, questions },
      });
    });
  }

  #resolvePending(message) {
    for (const pending of this.pendingApprovals.values()) {
      pending.resolve({ behavior: "deny", message, interrupt: true });
    }
    for (const pending of this.pendingQuestions.values()) {
      pending.resolve({ behavior: "deny", message, interrupt: true });
    }
    this.pendingApprovals.clear();
    this.pendingQuestions.clear();
  }

  async #loadSdk() {
    if (!this.sdk) {
      const sdk = await this.sdkLoader();
      if (typeof sdk?.query !== "function") throw new Error("Claude Agent SDK could not be loaded.");
      this.sdk = sdk;
    }
    return this.sdk;
  }

  #assertIdle() {
    this.#assertUsable();
    if (this.activeTurnId) throw new Error("Stop the active Claude Code turn first.");
  }

  #assertUsable() {
    if (this.disposed) throw new Error("Claude Code adapter is closed.");
  }

  #clearActive() {
    this.activeTurnId = null;
    this.activeState = null;
    this.interruptRequested = false;
  }
}

function normalizeModels(value) {
  return asArray(value).slice(0, 100).map((model, index) => {
    const variants = asArray(model?.supportedEffortLevels)
      .filter((effort) => ["low", "medium", "high", "xhigh", "max"].includes(effort));
    return {
      id: bounded(model?.value, 512),
      model: bounded(model?.value, 512),
      displayName: bounded(model?.displayName, 300) || bounded(model?.value, 300),
      description: bounded(model?.description, 2_000),
      isDefault: index === 0,
      variants,
      defaultVariant: variants.includes("high") ? "high" : variants[0] ?? null,
    };
  }).filter((model) => model.id);
}

function compatibleClaudeEffort(model, requested) {
  if (!requested) return model?.defaultVariant ?? null;
  if (model?.variants?.includes(requested)) return requested;
  throw new Error("The selected Claude Code reasoning effort is no longer available for this model.");
}

function normalizeCommands(value) {
  return asArray(value).slice(0, 500).map((command) => ({
    name: bounded(command?.name, 160),
    description: bounded(command?.description, 1_000),
    argumentHint: bounded(command?.argumentHint, 500),
    source: "claude-code",
  })).filter((command) => command.name);
}

function normalizeAccount(value, models, environment = {}) {
  const account = value && typeof value === "object" ? value : {};
  const hasNativeIdentity = Boolean(
    account.email || account.organization || account.subscriptionType || account.tokenSource
    || account.apiKeySource || account.apiProvider,
  );
  const hasApiKey = Boolean(account.apiKeySource || environment?.ANTHROPIC_API_KEY);
  const supportedCloud = Boolean(account.apiProvider && account.apiProvider !== "firstParty");
  const authenticated = hasApiKey || supportedCloud;
  return {
    account: authenticated ? {
      type: bounded(account.apiProvider, 80) || "claude-code",
      email: bounded(account.email, 300) || null,
      planType: bounded(account.subscriptionType, 160) || null,
    } : null,
    requiresOpenaiAuth: false,
    requiresRuntimeSetup: !authenticated,
    ...(!authenticated ? {
      setupReason: "runtime-setup-required",
      error: hasNativeIdentity && !authenticated
        ? "Claude subscription OAuth cannot be used by a third-party product. Configure an Anthropic API key or a supported cloud provider, then refresh."
        : models.length
          ? "Configure an Anthropic API key or a supported cloud provider for Claude Code, then refresh."
          : "Claude Code authentication and model access are unavailable.",
    } : {}),
  };
}

function normalizeQuestions(value) {
  return asArray(value).slice(0, 8).map((question) => ({
    header: bounded(question?.header, 80),
    question: bounded(question?.question, 4_000),
    multiple: question?.multiSelect === true,
    custom: question?.isOther !== false,
    options: asArray(question?.options).slice(0, 20).map((option) => typeof option === "string"
      ? { label: bounded(option, 120), description: "" }
      : { label: bounded(option?.label, 120), description: bounded(option?.description, 1_000) }),
  })).filter((question) => question.question);
}

function questionAnswerMap(questions, answers) {
  return Object.fromEntries(questions.map((question, index) => {
    const row = asArray(answers?.[index]).map((answer) => bounded(answer, 4_000)).filter(Boolean);
    return [question.question, question.multiple ? row : row[0] ?? ""];
  }));
}

export function formatClaudePrompt(prompt, references, workspaceRoot) {
  return formatAuthorizedWorkspaceReferencePrompt(prompt, references, workspaceRoot);
}

function claudeCapabilitiesForRuntime(version) {
  const agentVersion = bounded(version, 80) || null;
  return {
    ...CLAUDE_CAPABILITIES,
    revision: `${CLAUDE_CAPABILITIES.revision}:claude-code:${agentVersion ?? "unknown"}`,
    protocol: {
      ...CLAUDE_CAPABILITIES.protocol,
      agentVersion,
    },
  };
}

function projectInstructionIdentity(value) {
  if (!value || typeof value !== "object") return null;
  return createHash("sha256")
    .update(String(value.source ?? ""))
    .update("\0")
    .update(String(value.text ?? ""))
    .digest("hex");
}

async function* idleInput(signal) {
  await new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", resolve, { once: true });
  });
}

function listenForAbort(signal, callback) {
  if (!signal) return;
  if (signal.aborted) callback();
  else signal.addEventListener("abort", callback, { once: true });
}

function cleanEnvironment(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string"));
}

function permissionKind(toolName) {
  const name = String(toolName).toLowerCase();
  if (name === "bash") return "command";
  if (["write", "edit", "multiedit", "notebookedit"].includes(name)) return "file-change";
  if (name.includes("web")) return "network";
  return "tool";
}

function humanize(value) {
  const normalized = bounded(value, 160).replace(/[_-]+/g, " ");
  return normalized ? normalized.replace(/\b\w/g, (character) => character.toUpperCase()) : "tool";
}

function bounded(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDate(value) {
  const date = new Date(Number.isFinite(value) ? value : value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numericCursor(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedPageSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 50;
}

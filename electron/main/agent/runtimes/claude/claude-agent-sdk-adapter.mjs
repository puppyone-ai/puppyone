import { createNativePersistenceReporter } from "../../runtime/native-persistence-reporter.mjs";
import { claudeHistorySource } from "./claude-history-source.mjs";
import { readClaudeHistory } from "./claude-history-reader.mjs";
import { discoverClaudeHistory } from "./claude-history-discovery.mjs";
import { normalizeModels, compatibleClaudeEffort, normalizeCommands, normalizeAccount, cleanEnvironment, bounded, normalizeDate } from "./claude-native-values.mjs";

import { claudeResolveApproval, claudeResolveQuestion, claudeRequestPermission, claudeResolvePending } from "./claude-interactions.mjs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { redactSecretText } from "../../agent-events.mjs";
import {
  formatAuthorizedProjectInstructions,
  loadAuthorizedProjectInstructions,
} from "../../security/authorized-project-instructions.mjs";
import {
  createClaudeEventState,
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
      sourceScopeId: this.historySource.sourceScopeId,
      discover: (request) => this.discoverSessions(request),
      hydrate: () => this.readHistoryResult(),
    });
  }

  constructor({
    readiness,
    workspaceRoot,
    appVersion = "0.0.0",
    sdkLoader = () => import("@anthropic-ai/claude-agent-sdk"),
    onEvent = () => {},
    onExit = () => {},
    onSessionPersisted = () => {},
    projectInstructionLoader = (root) => loadAuthorizedProjectInstructions(root, {
      instructionNames: CLAUDE_PROJECT_INSTRUCTION_NAMES,
    }),
    spawnClaudeCodeProcess = null,
    logger = console,
  }) {
    this.readiness = readiness ?? {};
    // SDK history helpers use the parent process profile. Launch the SDK query in that same profile.
    this.historySource = claudeHistorySource(process.env);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.appVersion = appVersion;
    this.sdkLoader = sdkLoader;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.persistenceReporter = createNativePersistenceReporter({
      isClosed: () => this.disposed,
      verify: async () => {
        const id = this.sessionId;
        if (!id) return null;
        const sdk = await this.#loadSdk();
        const info = await sdk.getSessionInfo(id, { dir: this.workspaceRoot });
        return info?.sessionId === id && this.sessionId === id
          ? { providerSessionId: id, sourceScopeId: this.historySource.sourceScopeId } : null;
      },
      report: onSessionPersisted,
    });
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
      await this.spawnClaudeCodeProcess.waitForExit?.({ signal: controller.signal });
    }
  }

  async discoverSessions(options = {}) {
    this.#assertUsable();
    options.signal?.throwIfAborted();
    return discoverClaudeHistory({ sdk: await this.#loadSdk(), workspaceRoot: this.workspaceRoot }, options);
  }

  async createSession({ model = null, effort = null, mode = "agent" } = {}) {
    this.#assertIdle();
    await this.#closePersistentQuery("Starting a new Claude Code session.");
    this.sessionId = randomUUID();
    this.resuming = false;
    const now = new Date().toISOString();
    return {
      providerSessionId: this.sessionId,
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

  async readHistory() { return (await this.readHistoryResult()).events; }

  async readHistoryResult() {
    return readClaudeHistory({ sdk: await this.#loadSdk(), workspaceRoot: this.workspaceRoot, providerSessionId: this.sessionId });
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
    const state = createClaudeEventState({ turnId, resumed: this.resuming });
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
  resolveApproval(...args) { return claudeResolveApproval(this, ...args); }

  resolveQuestion(...args) { return claudeResolveQuestion(this, ...args); }


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
    claudeResolvePending(this, reason);
    await this.#closePersistentQuery(reason);
    this.#clearActive();
  }

  async #consumePersistent(query, channel) {
    let exitReported = false;
    try {
      for await (const message of query) {
        if (this.disposed || this.activeQuery !== query) return;
        if (typeof message?.session_id === "string" && message.session_id) {
          if (this.sessionId && this.sessionId !== message.session_id) throw new Error("Claude Code returned a different native session identity.");
          this.sessionId = message.session_id;
          this.resuming = true;
        }
        channel.setSessionId(this.sessionId ?? "");
        const state = this.activeState;
        if (!state) continue;
        let normalized;
        try { normalized = normalizeClaudeMessage(message, state); }
        catch (error) {
          this.onEvent({ type: "provider.error", providerSessionId: this.sessionId, turnId: state.turnId,
            itemId: null, payload: { code: "ADAPTER_EVENT_INVALID", stage: "display-translation", recoverable: true,
              message: redactSecretText(error instanceof Error ? error.message : String(error)) } });
          continue;
        }
        for (const event of normalized) {
          const output = this.interruptRequested && ["turn.completed", "turn.failed"].includes(event.type)
            ? { ...event, type: "turn.interrupted", payload: { ...event.payload, status: "interrupted" } }
            : event;
          this.onEvent(output);
        }
        if (state.terminal && this.activeState === state) {
          void this.persistenceReporter.confirm();
          channel.onTurnComplete();
          this.#clearActive();
        }
      }
    } catch (error) {
      const state = this.activeState;
      if (!this.disposed && this.activeQuery === query && state && !state.terminal) {
        // Stream failure is a lost observation, not a native terminal result.
        this.onEvent({ type: "provider.error", providerSessionId: this.sessionId, turnId: state.turnId, itemId: null,
          payload: { message: redactSecretText(error instanceof Error ? error.message : String(error)), recoverable: true } });
        exitReported = true;
        this.onExit({ expected: false, error: "Claude Code stream ended without a native result." });
      }
    } finally {
      if (this.activeQuery === query) {
        const state = this.activeState;
        if (!this.disposed && state && !state.terminal && !exitReported) {
          this.onExit({ expected: false, error: "Claude Code stream ended without a native result." });
        }
        claudeResolvePending(this, "Claude Code query closed before the request was resolved.");
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
        resume: this.resuming ? this.sessionId : null,
        sessionId: this.resuming ? null : this.sessionId,
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
      if (this.activeQuery !== query || this.disposed) throw new Error("Claude Code query closed during initialization.");
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
    if (controller) await this.spawnClaudeCodeProcess.waitForExit?.({ signal: controller.signal });
    if (reason && this.pendingApprovals.size + this.pendingQuestions.size > 0) claudeResolvePending(this, reason);
  }

  #queryOptions({
    abortController,
    model = null,
    effort = null,
    mode = "agent",
    resume = null,
    sessionId = null,
    projectInstructions = [],
  } = {}) {
    const append = formatAuthorizedProjectInstructions(projectInstructions);
    return {
      abortController,
      cwd: this.workspaceRoot,
      env: cleanEnvironment({
        ...(this.readiness.environment ?? {}),
        CLAUDE_CONFIG_DIR: this.historySource.root,
        CLAUDE_AGENT_SDK_CLIENT_APP: `puppyone-desktop/${this.appVersion}`,
        PUPPYONE_AGENT_BACKEND: "claude",
      }),
      ...(this.readiness.executablePath ? { pathToClaudeCodeExecutable: this.readiness.executablePath } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(resume ? { resume } : sessionId ? { sessionId } : {}),
      permissionMode: mode === "plan" ? "plan" : "default",
      canUseTool: (toolName, input, options) => claudeRequestPermission(this, toolName, input, options),
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

import path from "node:path";
import { randomUUID } from "node:crypto";
import { JsonlRpcConnection } from "../../transports/jsonl-rpc-connection.mjs";
import { AcpClient } from "./acp-client.mjs";
import { AcpEventNormalizer, normalizeAcpPromptUsage } from "./acp-event-normalizer.mjs";
import {
  resolveAcpEfforts,
  resolveAcpModels,
  resolveAcpModes,
  resolveRequestedAcpEffort,
  resolveRequestedAcpMode,
} from "./acp-session-config.mjs";
import { createAcpWorkspaceFileSystem } from "../../security/acp-workspace-files.mjs";
import {
  formatAuthorizedProjectInstructions,
  loadAuthorizedProjectInstructions,
} from "../../security/authorized-project-instructions.mjs";
import { boundRendererValue, redactSecrets, redactSecretText } from "../../agent-events.mjs";
import { ACP_INLINE_IMAGE_MAX_BYTES } from "./acp-limits.mjs";
import {
  ACP_NATIVE_IMAGE_MIME_TYPES,
  buildAcpPromptBlocks,
  materializeAcpReferences,
} from "./acp-prompt-input.mjs";
import { AcpHistoryCollector } from "./acp-history-collector.mjs";
import { AgentProviderSessionUnavailableError } from "../../runtime/agent-runtime-port.mjs";

const METADATA_SETTLE_MS = 75;
export { ACP_INLINE_IMAGE_MAX_BYTES } from "./acp-limits.mjs";

const ACP_EMBEDDED_TEXT_MIME_TYPES = Object.freeze([
  "text/*",
  "application/json",
  "application/javascript",
  "application/xml",
  "application/yaml",
  "application/toml",
  "image/svg+xml",
]);
const ACP_EMBEDDED_TEXT_EXTENSIONS = Object.freeze([
  ".bash", ".c", ".cc", ".cfg", ".conf", ".cpp", ".cs", ".css", ".csv", ".env",
  ".gql", ".go", ".graphql", ".h", ".hpp", ".htm", ".html", ".ini", ".java", ".js",
  ".json", ".jsonl", ".jsx", ".kt", ".md", ".mdx", ".mjs", ".cjs", ".py", ".rb",
  ".rs", ".sh", ".sql", ".svg", ".swift", ".toml", ".ts", ".tsv", ".tsx", ".txt",
  ".xml", ".yaml", ".yml", ".zsh",
]);

export const BASE_ACP_CAPABILITIES = Object.freeze({
  streamingText: true,
  structuredToolEvents: true,
  commandOutputStreaming: true,
  fileChangeEvents: true,
  manualApprovals: true,
  structuredQuestions: false,
  resume: true,
  fork: false,
  steer: false,
  queue: false,
  attachments: false,
  contextReferences: true,
  modelSelection: true,
  modeSelection: true,
  slashCommands: true,
  sessionHistory: false,
  history: Object.freeze({ discovery: "unsupported", exactOpen: "unsupported", hydration: "unsupported" }),
  recovery: Object.freeze({ strategy: "unsupported", activeExecution: "outcome-unknown", atomicHandoff: false }),
  usage: true,
  accountState: true,
  mcp: true,
  skills: true,
  compaction: false,
  referenceInputs: Object.freeze({
    schemaVersion: 1,
    workspace: Object.freeze({ files: true, directories: true, crossRoots: true }),
    attachments: Object.freeze({
      image: Object.freeze({
        accepted: false,
        mimeTypes: ACP_NATIVE_IMAGE_MIME_TYPES,
        maxBytes: ACP_INLINE_IMAGE_MAX_BYTES,
      }),
      text: Object.freeze({
        accepted: false,
        mimeTypes: ACP_EMBEDDED_TEXT_MIME_TYPES,
        extensions: ACP_EMBEDDED_TEXT_EXTENSIONS,
        maxBytes: ACP_INLINE_IMAGE_MAX_BYTES,
      }),
      audio: Object.freeze({ accepted: false }),
      video: Object.freeze({ accepted: false }),
      binary: Object.freeze({ accepted: false }),
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

/** Provider-neutral, workspace-bound adapter for a local ACP Agent harness. */
export class AcpRuntimeAdapter {
  referenceMentionDelivery() { return "resource"; }

  getSessionHistoryPort() {
    return Object.freeze({
      discover: (request) => this.discoverSessions(request),
      hydrate: () => this.readHistory(),
    });
  }

  constructor({
    readiness,
    workspaceRoot,
    runtimeDescriptor,
    managed = false,
    appVersion = "0.0.0",
    onEvent = () => {},
    onExit = () => {},
    logger = console,
    connectionFactory = (options) => new JsonlRpcConnection(options),
    fileSystemFactory = createAcpWorkspaceFileSystem,
    projectInstructionLoader = loadAuthorizedProjectInstructions,
    processArgs = ({ workspaceRoot: root }) => ["acp", `--cwd=${root}`],
    environmentOverlay = () => ({}),
    accountType = runtimeDescriptor?.id,
    sessionTitles = {},
    authenticationMethodId = null,
    capabilityOverrides = {},
    referenceInputProfile = {},
    questionMethods = [],
    eventSource = `${runtimeDescriptor?.id || "agent"}-acp`,
    onDispose = () => {},
  }) {
    if (!runtimeDescriptor?.id) throw new TypeError("ACP runtime adapter requires a runtime descriptor.");
    this.readiness = readiness ?? {};
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runtimeDescriptor = runtimeDescriptor;
    this.managed = managed;
    this.appVersion = appVersion;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.logger = logger;
    this.connectionFactory = connectionFactory;
    this.fileSystemFactory = fileSystemFactory;
    this.projectInstructionLoader = projectInstructionLoader;
    this.processArgs = processArgs;
    this.environmentOverlay = environmentOverlay;
    this.accountType = accountType;
    this.sessionTitles = {
      created: sessionTitles.created || `New ${runtimeDescriptor.displayName} session`,
      resumed: sessionTitles.resumed || `${runtimeDescriptor.displayName} session`,
    };
    this.authenticationMethodId = text(authenticationMethodId, 160) || null;
    this.capabilityOverrides = capabilityOverrides;
    this.referenceInputProfile = Object.freeze({
      embeddedText: referenceInputProfile?.embeddedText === true,
    });
    this.questionMethods = new Set(array(questionMethods).map((method) => text(method, 160)).filter(Boolean));
    this.eventSource = eventSource;
    this.onDispose = onDispose;
    this.connection = null;
    this.client = null;
    this.connectionMode = null;
    this.sessionId = null;
    this.sessionConfig = emptySessionConfig();
    this.commands = [];
    this.activeTurn = null;
    this.pendingApprovals = new Map();
    this.pendingQuestions = new Map();
    this.exitExpected = false;
    this.disposed = false;
    this.historicalEvents = [];
    this.historyCollector = null;
  }

  hasActiveProcess() {
    return Boolean(this.connection && !this.connection.closed);
  }

  async inspect() {
    this.#assertUsable();
    await this.#connect("metadata");
    try {
      const response = await this.client.newSession({ cwd: this.workspaceRoot, mcpServers: [] });
      this.sessionId = requiredId(response?.sessionId ?? this.sessionId, `${this.runtimeDescriptor.displayName} ACP session id`);
      this.#syncSession(response);
      // ACP publishes optional commands/config updates as notifications after
      // newSession. A short bounded settle window captures them without
      // turning provider discovery into a full runtime boot.
      await delay(METADATA_SETTLE_MS);
      return this.#inspection();
    } finally {
      await this.#disconnect(`${this.runtimeDescriptor.displayName} ACP metadata inspection completed.`);
    }
  }

  async createSession({ model = null, effort = null, mode = null } = {}) {
    return (await this.bootstrapSession({ kind: "create", model, effort, mode })).providerSession;
  }

  /**
   * Establish protocol/authentication and the requested native session on one
   * connection. AgentService uses this atomic path instead of inspect-then-
   * reconnect for ACP runtimes.
   */
  async bootstrapSession({
    kind = "create",
    threadId = null,
    model = null,
    effort = null,
    mode = null,
  } = {}) {
    this.#assertIdle();
    await this.#connect("session");
    let response;
    if (kind === "resume") {
      this.historyCollector = new AcpHistoryCollector();
      try {
        const sessionId = requiredId(threadId, `${this.runtimeDescriptor.displayName} ACP session id`);
        const native = this.client?.agentCapabilities ?? {};
        const parameters = { cwd: this.workspaceRoot, mcpServers: [], sessionId };
        try {
          if (native.loadSession === true) {
            response = await this.client.loadSession(parameters);
          } else if (native.sessionCapabilities?.resume != null) {
            response = await this.client.resumeSession(parameters);
          } else {
            const unsupported = new Error(`${this.runtimeDescriptor.displayName} does not support session load or resume.`);
            unsupported.code = "AGENT_SESSION_RESUME_UNSUPPORTED";
            throw unsupported;
          }
        } catch (error) {
          if (isUnavailableAcpSessionError(error)) {
            throw new AgentProviderSessionUnavailableError(
              `The saved ${this.runtimeDescriptor.displayName} session is no longer available.`,
            );
          }
          throw error;
        }
        this.sessionId = requiredId(
          response?.sessionId ?? threadId,
          `${this.runtimeDescriptor.displayName} ACP session id`,
        );
        this.#syncSession(response);
        await delay(METADATA_SETTLE_MS);
      } finally {
        this.historicalEvents = this.historyCollector?.events(
          safeId(response?.sessionId) ?? safeId(threadId),
        ) ?? [];
        this.historyCollector = null;
      }
    } else if (kind === "create") {
      response = await this.client.newSession({ cwd: this.workspaceRoot, mcpServers: [] });
      this.sessionId = requiredId(response?.sessionId, `${this.runtimeDescriptor.displayName} ACP session id`);
      this.#syncSession(response);
      await delay(METADATA_SETTLE_MS);
    } else {
      throw new TypeError("ACP session bootstrap kind is invalid.");
    }
    const inspection = this.#inspection();
    await this.#applySelection({ model, effort, mode });
    return {
      inspection,
      providerSession: this.#providerSession({
        title: kind === "resume" ? this.sessionTitles.resumed : this.sessionTitles.created,
        model,
        effort,
        mode,
      }),
    };
  }

  async discoverSessions({ cursor = null, limit = 50 } = {}) {
    this.#assertUsable();
    await this.#connect("history");
    try {
      const native = this.client?.agentCapabilities ?? {};
      const supported = native.sessionCapabilities?.list != null || native.listSessions === true;
      if (!supported) return { supported: false, sessions: [], nextCursor: null };
      const response = await this.client.listSessions({
        cwd: this.workspaceRoot,
        ...(cursor ? { cursor } : {}),
        limit: boundedPageSize(limit),
      });
      return {
        supported: true,
        sessions: array(response?.sessions).filter((session) => (
          safeId(session?.sessionId) && (!session?.cwd || path.resolve(session.cwd) === this.workspaceRoot)
        )).slice(0, boundedPageSize(limit)).map((session) => ({
          providerSessionId: session.sessionId,
          title: text(session.title, 500) || this.sessionTitles.resumed,
          createdAt: normalizeDate(session.createdAt ?? session.updatedAt),
          updatedAt: normalizeDate(session.updatedAt),
        })),
        nextCursor: text(response?.nextCursor, 1_024) || null,
      };
    } finally {
      await this.#disconnect(`${this.runtimeDescriptor.displayName} ACP history discovery completed.`);
    }
  }

  async resumeSession({ threadId, model = null, effort = null, mode = null } = {}) {
    return (await this.bootstrapSession({
      kind: "resume",
      threadId,
      model,
      effort,
      mode,
    })).providerSession;
  }

  async readHistory() {
    // PuppyOne deliberately does not persist this replay or create a second
    // transcript authority; it is only the initial projection for this process.
    return this.historicalEvents.slice();
  }

  async forkSession({ messageId = null } = {}) {
    this.#assertIdle();
    if (!this.client || !this.sessionId) throw new Error(`No ${this.runtimeDescriptor.displayName} ACP session is active.`);
    const response = await this.client.forkSession({
      sessionId: this.sessionId,
      ...(messageId ? { messageId } : {}),
    });
    return {
      providerSessionId: requiredId(
        response?.sessionId ?? response?.forkedSessionId,
        `${this.runtimeDescriptor.displayName} forked ACP session id`,
      ),
    };
  }

  async deleteNativeSession({ threadId } = {}) {
    this.#assertIdle();
    if (!this.client) await this.#connect("session");
    await this.client.deleteSession({ sessionId: requiredId(threadId, `${this.runtimeDescriptor.displayName} ACP session id`) });
  }

  async startTurn({ prompt, model = null, effort = null, mode = null, references: allReferences = [], attachments = [], contextReferences = [] }) {
    this.#assertUsable();
    if (!this.client || !this.sessionId) throw new Error(`${this.runtimeDescriptor.displayName} ACP session is not connected.`);
    if (this.activeTurn) throw new Error(`A ${this.runtimeDescriptor.displayName} turn is already running.`);
    await this.#applySelection({ model, effort, mode });
    const turnId = `${this.runtimeDescriptor.id}:${randomUUID()}`;
    const normalizer = new AcpEventNormalizer({ turnId });
    const instructions = await this.projectInstructionLoader(this.workspaceRoot);
    const referenceProfile = this.#nativeReferenceProfile();
    const blocks = buildAcpPromptBlocks({
      prompt,
      instructions: formatAuthorizedProjectInstructions(instructions),
      references: await materializeAcpReferences(
        allReferences.length > 0 ? allReferences : [...contextReferences, ...attachments],
        referenceProfile,
      ),
      workspaceRoot: this.workspaceRoot,
      profile: referenceProfile,
    });
    const active = { turnId, normalizer, interrupted: false, references: allReferences };
    this.activeTurn = active;
    void this.#runPrompt(active, blocks);
    return { turnId };
  }

  async interruptTurn({ turnId }) {
    if (!this.activeTurn || this.activeTurn.turnId !== turnId || !this.sessionId) {
      throw new Error(`That ${this.runtimeDescriptor.displayName} turn is no longer running.`);
    }
    this.activeTurn.interrupted = true;
    this.client.cancel({ sessionId: this.sessionId });
  }

  resolveApproval({ requestId, decision, turnId }) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending || pending.turnId !== turnId || this.activeTurn?.turnId !== turnId) {
      throw new Error(`Approval correlation did not match the active ${this.runtimeDescriptor.displayName} turn.`);
    }
    this.pendingApprovals.delete(requestId);
    const option = selectPermissionOption(pending.options, decision);
    pending.resolve(option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } });
  }

  resolveQuestion({ requestId, answers, rejected, turnId }) {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending || pending.turnId !== turnId || this.activeTurn?.turnId !== turnId) {
      throw new Error(`Question correlation did not match the active ${this.runtimeDescriptor.displayName} turn.`);
    }
    this.pendingQuestions.delete(requestId);
    pending.resolve(rejected
      ? { outcome: "cancelled" }
      : { outcome: "answered", answers: questionAnswerMap(pending.questions, answers) });
  }

  forceTerminate(reason = `${this.runtimeDescriptor.displayName} ACP runtime stopped.`) {
    return this.#disconnect(reason, { expected: false });
  }

  async dispose(reason = `${this.runtimeDescriptor.displayName} ACP adapter closed.`) {
    if (this.disposed) return;
    this.disposed = true;
    this.#resolvePending(reason);
    await this.#disconnect(reason);
    this.onDispose(this);
  }

  async #runPrompt(active, blocks) {
    try {
      const response = await this.client.prompt({
        sessionId: this.sessionId,
        prompt: blocks,
      });
      if (this.activeTurn !== active || this.disposed) return;
      for (const event of active.normalizer.completeAssistant(this.sessionId)) this.onEvent(event);
      const usage = normalizeAcpPromptUsage(response?.usage);
      if (usage) this.onEvent(event("usage.updated", this.sessionId, active.turnId, null, usage));
      this.onEvent(event(active.interrupted ? "turn.interrupted" : "turn.completed", this.sessionId, active.turnId, null, {
        status: active.interrupted ? "interrupted" : "completed",
        stopReason: text(response?.stopReason, 160) || null,
      }));
    } catch (error) {
      if (this.activeTurn !== active || this.disposed) return;
      const interrupted = active.interrupted;
      if (!interrupted) {
        this.onEvent(event("provider.error", this.sessionId, active.turnId, null, {
          message: redactSecretText(error instanceof Error ? error.message : String(error)),
          recoverable: true,
        }));
      }
      this.onEvent(event(interrupted ? "turn.interrupted" : "turn.failed", this.sessionId, active.turnId, null, {
        status: interrupted ? "interrupted" : "failed",
      }));
    } finally {
      if (this.activeTurn === active) {
        this.#resolvePending(`${this.runtimeDescriptor.displayName} turn ended before a client request was resolved.`);
        this.activeTurn = null;
      }
    }
  }

  async #connect(mode) {
    if (this.connection && !this.connection.closed && this.connectionMode === mode) return;
    if (this.connection) await this.#disconnect(`${this.runtimeDescriptor.displayName} ACP connection mode changed.`);
    const environment = this.#environment(mode);
    this.exitExpected = false;
    const connection = this.connectionFactory({
      executablePath: this.readiness.executablePath,
      args: this.processArgs({ mode, workspaceRoot: this.workspaceRoot, managed: this.managed }),
      cwd: this.workspaceRoot,
      env: environment,
    });
    this.connection = connection;
    this.connectionMode = mode;
    connection.once?.("exit", (info) => {
      if (this.connection !== connection) return;
      this.connection = null;
      this.client = null;
      this.connectionMode = null;
      if (!this.exitExpected && !this.disposed) {
        this.#resolvePending(`${this.runtimeDescriptor.displayName} ACP process exited.`);
        this.onExit({
          code: info?.code ?? null,
          signal: info?.signal ?? null,
          error: redactSecretText(info?.error || `${this.runtimeDescriptor.displayName} ACP process exited unexpectedly.`),
          diagnostics: redactSecretText(info?.diagnostics || ""),
          expected: false,
        });
      }
    });
    const fileSystem = this.fileSystemFactory({
      workspaceRoot: this.workspaceRoot,
      getReadReferences: () => this.activeTurn?.references ?? [],
    });
    this.client = new AcpClient({
      connection,
      clientInfo: { name: "puppyone-desktop", title: "PuppyOne Desktop", version: this.appVersion },
      delegate: {
        readTextFile: (request) => this.#withSession(request, () => fileSystem.readTextFile(request)),
        writeTextFile: (request) => this.#withSession(request, () => fileSystem.writeTextFile(request)),
        requestPermission: (request) => this.#requestPermission(request),
        onSessionUpdate: (notification) => this.#handleSessionUpdate(notification),
        canHandleRequest: (method) => this.questionMethods.has(method),
        handleRequest: (method, request) => this.#handleExtensionRequest(method, request),
      },
    });
    await this.client.initialize();
    if (this.authenticationMethodId) {
      const advertised = this.client.authMethods.some((method) => method?.id === this.authenticationMethodId);
      if (!advertised) throw new Error(`${this.runtimeDescriptor.displayName} did not advertise the required authentication method.`);
      await this.client.authenticate({ methodId: this.authenticationMethodId });
    }
  }

  async #disconnect(reason, { expected = true } = {}) {
    this.exitExpected = expected;
    const client = this.client;
    const connection = this.connection;
    this.client = null;
    this.connection = null;
    this.connectionMode = null;
    client?.dispose();
    connection?.dispose?.(reason, { expected });
    await Promise.resolve();
  }

  #environment(mode) {
    const environment = cleanEnvironment(this.readiness.environment ?? {});
    environment.PUPPYONE_AGENT_BACKEND = this.runtimeDescriptor.id;
    return { ...environment, ...cleanEnvironment(this.environmentOverlay({
      environment,
      mode,
      workspaceRoot: this.workspaceRoot,
      managed: this.managed,
    })) };
  }

  #capabilities() {
    const native = this.client?.agentCapabilities ?? {};
    const canDiscoverHistory = Boolean(native.sessionCapabilities?.list);
    const canOpenHistory = native.loadSession === true || Boolean(native.sessionCapabilities?.resume);
    const acceptsImages = Boolean(native.promptCapabilities?.image);
    const acceptsEmbeddedText = Boolean(
      this.referenceInputProfile.embeddedText && native.promptCapabilities?.embeddedContext,
    );
    return {
      ...BASE_ACP_CAPABILITIES,
      resume: native.loadSession === true || Boolean(native.sessionCapabilities?.resume),
      fork: Boolean(native.sessionCapabilities?.fork),
      sessionHistory: canDiscoverHistory || canOpenHistory,
      structuredQuestions: this.questionMethods.size > 0,
      mcp: Boolean(native.mcpCapabilities?.http || native.mcpCapabilities?.sse),
      attachments: acceptsImages || acceptsEmbeddedText,
      revision: `${this.runtimeDescriptor.id}-acp:${this.client?.protocolVersion ?? 1}:image${Number(acceptsImages)}:embedded${Number(acceptsEmbeddedText)}`,
      protocol: {
        name: "acp",
        version: this.client?.protocolVersion ?? 1,
        agentVersion: this.client?.agentInfo?.version ?? this.readiness.version ?? null,
        extensions: extensionVersions(native?._meta),
      },
      ...this.capabilityOverrides,
      history: {
        discovery: canDiscoverHistory ? "paged" : "unsupported",
        exactOpen: canOpenHistory ? "supported" : "unsupported",
        hydration: canOpenHistory ? "push-replay" : "unsupported",
      },
      recovery: {
        strategy: canOpenHistory ? "snapshot-reload" : "unsupported",
        activeExecution: "outcome-unknown",
        atomicHandoff: false,
      },
      referenceInputs: {
        ...BASE_ACP_CAPABILITIES.referenceInputs,
        ...(this.capabilityOverrides.referenceInputs ?? {}),
        workspace: {
          ...BASE_ACP_CAPABILITIES.referenceInputs.workspace,
          ...(this.capabilityOverrides.referenceInputs?.workspace ?? {}),
        },
        attachments: {
          ...BASE_ACP_CAPABILITIES.referenceInputs.attachments,
          ...(this.capabilityOverrides.referenceInputs?.attachments ?? {}),
          image: {
            ...BASE_ACP_CAPABILITIES.referenceInputs.attachments.image,
            ...(this.capabilityOverrides.referenceInputs?.attachments?.image ?? {}),
            accepted: acceptsImages,
          },
          text: {
            ...BASE_ACP_CAPABILITIES.referenceInputs.attachments.text,
            ...(this.capabilityOverrides.referenceInputs?.attachments?.text ?? {}),
            accepted: acceptsEmbeddedText,
          },
        },
        limits: {
          ...BASE_ACP_CAPABILITIES.referenceInputs.limits,
          ...(this.capabilityOverrides.referenceInputs?.limits ?? {}),
        },
      },
    };
  }

  #inspection() {
    const models = publicModels(this.sessionConfig, this.runtimeDescriptor.id);
    const accountReady = models.length > 0 || Boolean(this.authenticationMethodId);
    return {
      account: {
        account: accountReady ? {
          type: this.accountType,
          email: null,
          planType: null,
        } : null,
        requiresOpenaiAuth: false,
        requiresRuntimeSetup: !accountReady,
        ...(!accountReady ? {
          setupReason: "runtime-setup-required",
          error: `${this.runtimeDescriptor.displayName} has no authenticated model available.`,
        } : {}),
      },
      providers: publicProviders(models),
      models,
      modes: publicModes(this.sessionConfig),
      commands: this.commands,
      capabilities: this.#capabilities(),
      runtime: {
        ...this.runtimeDescriptor,
        version: this.readiness.version ?? this.client?.agentInfo?.version ?? null,
        source: this.readiness.source ?? (this.managed ? "bundled" : "user-installed"),
        compatibility: "acp-v1",
      },
      warnings: [],
    };
  }

  #providerSession({ title, model, effort, mode }) {
    const now = new Date().toISOString();
    return {
      providerSessionId: this.sessionId,
      title,
      model: this.sessionConfig.models.currentId ?? model,
      effort: this.sessionConfig.efforts.currentId ?? effort,
      mode: this.sessionConfig.modes.currentId ?? mode,
      createdAt: now,
      updatedAt: now,
    };
  }

  #nativeReferenceProfile() {
    const promptCapabilities = this.client?.agentCapabilities?.promptCapabilities ?? {};
    return Object.freeze({
      image: promptCapabilities.image === true,
      embeddedText: this.referenceInputProfile.embeddedText && promptCapabilities.embeddedContext === true,
    });
  }

  #syncSession(response = {}) {
    const configOptions = Array.isArray(response.configOptions) ? response.configOptions : [];
    this.sessionConfig = {
      configOptions,
      models: resolveAcpModels({ configOptions, models: response.models }),
      modes: resolveAcpModes({ configOptions, modes: response.modes }),
      efforts: resolveAcpEfforts({ configOptions }),
    };
  }

  async #applySelection({ model, effort, mode }) {
    if (!this.client || !this.sessionId) return;
    const requestedModel = text(model, 512);
    if (requestedModel && requestedModel !== this.sessionConfig.models.currentId) {
      if (!this.sessionConfig.models.available.some((entry) => entry.id === requestedModel)) {
        throw new Error(`The selected ${this.runtimeDescriptor.displayName} model is no longer available.`);
      }
      const configId = this.sessionConfig.models.configId;
      if (!configId) throw new Error(`This ${this.runtimeDescriptor.displayName} ACP runtime does not support changing models.`);
      const response = await this.client.setConfigOption({
        configId,
        sessionId: this.sessionId,
        type: "select",
        value: requestedModel,
      });
      this.#syncConfigOptions(response?.configOptions);
    }
    const requestedEffort = resolveRequestedAcpEffort(effort, this.sessionConfig.efforts);
    if (effort && !requestedEffort) {
      throw new Error(`The selected ${this.runtimeDescriptor.displayName} reasoning effort is no longer available.`);
    }
    if (requestedEffort && requestedEffort !== this.sessionConfig.efforts.currentId) {
      const configId = this.sessionConfig.efforts.configId;
      if (!configId) throw new Error(`This ${this.runtimeDescriptor.displayName} ACP runtime does not support changing reasoning effort.`);
      const response = await this.client.setConfigOption({
        configId,
        sessionId: this.sessionId,
        type: "select",
        value: requestedEffort,
      });
      this.#syncConfigOptions(response?.configOptions);
    }
    const requestedMode = resolveRequestedAcpMode(mode, this.sessionConfig.modes);
    if (requestedMode && requestedMode !== this.sessionConfig.modes.currentId) {
      if (this.sessionConfig.modes.configId) {
        const response = await this.client.setConfigOption({
          configId: this.sessionConfig.modes.configId,
          sessionId: this.sessionId,
          type: "select",
          value: requestedMode,
        });
        this.#syncConfigOptions(response?.configOptions);
      } else {
        await this.client.setMode({ sessionId: this.sessionId, modeId: requestedMode });
        this.sessionConfig.modes.currentId = requestedMode;
      }
    }
  }

  #syncConfigOptions(value) {
    if (!Array.isArray(value)) return;
    this.sessionConfig.configOptions = value;
    this.sessionConfig.models = resolveAcpModels({ configOptions: value });
    this.sessionConfig.modes = resolveAcpModes({ configOptions: value });
    this.sessionConfig.efforts = resolveAcpEfforts({ configOptions: value });
  }

  async #handleSessionUpdate(notification) {
    if (!notification) return;
    if (!this.sessionId && safeId(notification.sessionId)) this.sessionId = notification.sessionId;
    if (notification.sessionId !== this.sessionId) return;
    const update = notification.update;
    if (this.historyCollector) this.historyCollector.accept(notification);
    if (update?.sessionUpdate === "available_commands_update") {
      this.commands = array(update.availableCommands).slice(0, 500).map((command) => ({
        name: text(command?.name, 160).replace(/^\//u, ""),
        description: text(command?.description, 1_000),
        argumentHint: text(command?.input?.hint, 500),
        source: this.eventSource,
      })).filter((command) => command.name);
      return;
    }
    if (update?.sessionUpdate === "config_option_update") {
      this.#syncConfigOptions(update.configOptions);
      return;
    }
    if (update?.sessionUpdate === "current_mode_update") {
      this.sessionConfig.modes.currentId = text(update.currentModeId, 160) || null;
      return;
    }
    if (!this.activeTurn) return;
    for (const normalized of this.activeTurn.normalizer.normalize(notification)) this.onEvent(normalized);
  }

  #requestPermission(request) {
    if (!this.activeTurn || request?.sessionId !== this.sessionId) {
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }
    const options = array(request.options).filter((option) => safeId(option?.optionId));
    const requestId = `${this.runtimeDescriptor.id}:${safeId(request.toolCall?.toolCallId) ?? randomUUID()}:${randomUUID()}`;
    const input = record(request.toolCall?.rawInput);
    return new Promise((resolve) => {
      this.pendingApprovals.set(requestId, {
        requestId,
        turnId: this.activeTurn.turnId,
        options,
        resolve,
      });
      this.onEvent(event("approval.requested", this.sessionId, this.activeTurn.turnId,
        safeId(request.toolCall?.toolCallId), {
          requestId,
          title: text(request.toolCall?.title, 300) || "Approval required",
          kind: approvalKind(request.toolCall?.kind),
          command: text(input.command, 8_192) || null,
          reason: text(request.toolCall?.title, 2_000) || null,
          availableDecisions: availableDecisions(options),
          arguments: boundRendererValue(redactSecrets(input)),
        }));
    });
  }

  #handleExtensionRequest(method, request) {
    if (!this.questionMethods.has(method)) return undefined;
    if (!this.activeTurn) return { outcome: "cancelled" };
    const questions = normalizeQuestions(request?.questions);
    const requestId = `${this.runtimeDescriptor.id}:question:${safeId(request?.toolCallId) ?? randomUUID()}:${randomUUID()}`;
    return new Promise((resolve) => {
      this.pendingQuestions.set(requestId, {
        requestId,
        turnId: this.activeTurn.turnId,
        questions,
        resolve,
      });
      this.onEvent(event("question.requested", this.sessionId, this.activeTurn.turnId,
        safeId(request?.toolCallId), { requestId, questions }));
    });
  }

  #withSession(request, operation) {
    if (!this.sessionId || request?.sessionId !== this.sessionId) {
      throw new Error(`ACP file request does not belong to the active ${this.runtimeDescriptor.displayName} session.`);
    }
    return operation();
  }

  #resolvePending(message) {
    for (const pending of this.pendingApprovals.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    for (const pending of this.pendingQuestions.values()) pending.resolve({ outcome: "cancelled" });
    if (this.pendingApprovals.size > 0 || this.pendingQuestions.size > 0) this.logger.warn?.(redactSecretText(message));
    this.pendingApprovals.clear();
    this.pendingQuestions.clear();
  }

  #assertIdle() {
    this.#assertUsable();
    if (this.activeTurn) throw new Error(`Stop the active ${this.runtimeDescriptor.displayName} turn first.`);
  }

  #assertUsable() {
    if (this.disposed) throw new Error(`${this.runtimeDescriptor.displayName} ACP adapter is closed.`);
    if (!this.readiness.executablePath) throw new Error(`${this.runtimeDescriptor.displayName} ACP executable is unavailable.`);
  }
}

function isUnavailableAcpSessionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return error?.code === -32602
    || /invalid params|unknown session|session.{0,32}(?:not found|does not exist|unavailable)/iu.test(message);
}

function publicModels(config, fallbackProviderId) {
  const variants = config.efforts.available.map((entry) => entry.id);
  return config.models.available.map((model, index) => {
    const providerId = model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : fallbackProviderId;
    const modelId = model.id.includes("/") ? model.id.slice(model.id.indexOf("/") + 1) : model.id;
    return {
      id: model.id,
      model: model.id,
      providerId,
      modelId,
      displayName: model.name || model.id,
      description: model.description || "",
      isDefault: model.id === config.models.currentId || (!config.models.currentId && index === 0),
      variants,
      defaultVariant: variants.includes(config.efforts.currentId) ? config.efforts.currentId : variants[0] ?? null,
    };
  });
}

function publicProviders(models) {
  const groups = new Map();
  for (const model of models) {
    const id = model.providerId || "opencode";
    const current = groups.get(id) ?? { id, displayName: humanize(id), source: "native", defaultModel: null, modelCount: 0 };
    current.modelCount += 1;
    if (model.isDefault) current.defaultModel = model.model;
    groups.set(id, current);
  }
  return Array.from(groups.values());
}

function publicModes(config) {
  return config.modes.available.map((mode, index) => ({
    id: mode.id,
    displayName: mode.name || humanize(mode.id),
    description: mode.description || "",
    isDefault: mode.id === config.modes.currentId || (!config.modes.currentId && index === 0),
  }));
}

function selectPermissionOption(options, decision) {
  const desired = decision === "acceptForSession"
    ? ["allow_always", "allow_once"]
    : decision === "accept"
      ? ["allow_once", "allow_always"]
      : decision === "decline"
        ? ["reject_once", "reject_always"]
        : [];
  return desired.map((kind) => options.find((option) => option.kind === kind)).find(Boolean) ?? null;
}

function availableDecisions(options) {
  const decisions = [];
  if (options.some((option) => option.kind === "allow_once" || option.kind === "allow_always")) decisions.push("accept");
  if (options.some((option) => option.kind === "allow_always")) decisions.push("acceptForSession");
  if (options.some((option) => option.kind === "reject_once" || option.kind === "reject_always")) decisions.push("decline");
  decisions.push("cancel");
  return decisions;
}

function approvalKind(kind) {
  return ["edit", "delete", "move"].includes(kind) ? "file-change" : kind === "execute" ? "command" : "tool";
}

export function mergeJsonConfig(value, overlay) {
  let base = {};
  try {
    const parsed = value ? JSON.parse(value) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
  } catch {
    // A malformed inherited inline config is not forwarded into the managed runtime.
  }
  return JSON.stringify({
    ...base,
    ...overlay,
    agent: { ...(record(base.agent)), ...(record(overlay.agent)) },
  });
}

function normalizeQuestions(value) {
  return array(value).slice(0, 16).map((question, index) => ({
    id: safeId(question?.id) || `question-${index + 1}`,
    header: text(question?.header, 160) || text(question?.title, 160) || `Question ${index + 1}`,
    question: text(question?.question, 2_000) || text(question?.prompt, 2_000) || "Input required",
    multiple: Boolean(question?.multiple || question?.multiSelect),
    custom: question?.custom !== false,
    options: array(question?.options).slice(0, 64).map((option) => ({
      id: safeId(option?.id) || safeId(option?.value) || null,
      label: text(option?.label, 300) || text(option?.name, 300) || text(option?.value, 300),
      description: text(option?.description, 1_000),
    })).filter((option) => option.label),
  }));
}

function questionAnswerMap(questions, answers) {
  return Object.fromEntries(questions.map((question, index) => [
    question.id,
    array(answers?.[index]).map((answer) => text(answer, 2_000)).filter(Boolean),
  ]));
}

function extensionVersions(value) {
  const extensions = {};
  for (const [namespace, entries] of Object.entries(record(value)).slice(0, 16)) {
    for (const [name, version] of Object.entries(record(entries)).slice(0, 16)) {
      if (Number.isFinite(version)) extensions[`${namespace}.${name}`] = Number(version);
    }
  }
  return extensions;
}

function emptySessionConfig() {
  return {
    configOptions: [],
    models: { configId: null, currentId: null, available: [] },
    modes: { configId: null, currentId: null, available: [] },
    efforts: { configId: null, currentId: null, available: [] },
  };
}

function event(type, providerSessionId, turnId, itemId, payload) {
  return { type, providerSessionId: safeId(providerSessionId), turnId: safeId(turnId), itemId: safeId(itemId), payload };
}

function cleanEnvironment(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string"));
}

function requiredId(value, label) {
  const id = safeId(value);
  if (!id) throw new Error(`${label} is invalid.`);
  return id;
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function humanize(value) {
  return text(value, 160).replace(/[-_.]+/gu, " ").replace(/\b\w/gu, (character) => character.toUpperCase());
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedPageSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 50;
}

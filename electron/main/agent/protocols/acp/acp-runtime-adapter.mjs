import { createNativePersistenceReporter } from "../../runtime/native-persistence-reporter.mjs";
import { agentHistoryReadResult } from "../../runtime/agent-history-read-result.mjs";
import { nativeSessionId } from "../../../../../shared/agent-contract/native-session-id.mjs";
import { discoverAcpHistory } from "./acp-history-discovery.mjs";
import { isUnavailableAcpSessionError, publicModels, publicProviders, publicModes, event, array, record, text } from "./acp-native-values.mjs";
export { mergeJsonConfig } from "./acp-native-values.mjs";
import { acpResolveApproval, acpResolveQuestion, acpRequestPermission, acpHandleExtensionRequest, acpResolvePending } from "./acp-interactions.mjs";
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
import { redactSecretText } from "../../agent-events.mjs";
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
        // ACP requires every Agent to accept resource links. Embedded text is
        // an optional optimization negotiated separately at runtime.
        accepted: true,
        mimeTypes: ACP_EMBEDDED_TEXT_MIME_TYPES,
        extensions: ACP_EMBEDDED_TEXT_EXTENSIONS,
      }),
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

/** Provider-neutral, workspace-bound adapter for a local ACP Agent harness. */
export class AcpRuntimeAdapter {
  referenceMentionDelivery() { return "resource"; }

  getSessionHistoryPort() {
    return Object.freeze({
      sourceScopeId: this.sourceScopeId,
      discover: (request) => this.discoverSessions(request),
      hydrate: () => this.readHistoryResult(),
    });
  }

  constructor({
    readiness,
    sourceScopeId = "default",
    workspaceRoot,
    runtimeDescriptor,
    managed = false,
    appVersion = "0.0.0",
    onEvent = () => {},
    onExit = () => {},
    onSessionPersisted = () => {},
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
    completionInspectorFactory = null,
    eventSource = `${runtimeDescriptor?.id || "agent"}-acp`,
    onDispose = () => {},
  }) {
    if (!runtimeDescriptor?.id) throw new TypeError("ACP runtime adapter requires a runtime descriptor.");
    this.readiness = readiness ?? {};
    this.sourceScopeId = sourceScopeId;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runtimeDescriptor = runtimeDescriptor;
    this.managed = managed;
    this.appVersion = appVersion;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.persistenceReporter = createNativePersistenceReporter({
      isClosed: () => this.disposed,
      verify: async () => {
        const id = this.sessionId;
        const page = await discoverAcpHistory({ client: this.client, workspaceRoot: this.workspaceRoot, fallbackTitle: this.sessionTitles.created });
        return page.supported && page.sessions.some((entry) => entry.providerSessionId === id)
          ? { providerSessionId: id, sourceScopeId: this.sourceScopeId } : null;
      },
      report: onSessionPersisted,
    });
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
    this.completionInspectorFactory = typeof completionInspectorFactory === "function"
      ? completionInspectorFactory
      : null;
    this.eventSource = eventSource;
    this.onDispose = onDispose;
    this.connection = null;
    this.closingConnections = new Set();
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
        this.historyCoverage = this.historyCollector?.truncated ? "partial" : "unknown";
        this.historicalEvents = this.historyCollector?.events(
          nativeSessionId(response?.sessionId) ?? nativeSessionId(threadId),
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

  async discoverSessions(options = {}) {
    this.#assertUsable();
    options.signal?.throwIfAborted();
    await this.#connect("history");
    try {
      return await discoverAcpHistory({ client: this.client, workspaceRoot: this.workspaceRoot,
        fallbackTitle: this.sessionTitles.resumed }, options);
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

  async readHistoryResult() {
    return agentHistoryReadResult({ providerSessionId: this.sessionId, events: await this.readHistory(),
      coverage: this.historyCoverage ?? "unknown",
      reason: this.historyCoverage === "partial" ? "read-limit"
        : this.client?.agentCapabilities?.loadSession === true ? "replay-unverified" : "unsupported" });
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
    const completionInspector = this.completionInspectorFactory?.({
      turnId,
      runtimeVersion: this.client?.agentInfo?.version ?? this.readiness.version ?? null,
    }) ?? null;
    const active = { turnId, normalizer, completionInspector, interrupted: false, references: allReferences };
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
  resolveApproval(...args) { return acpResolveApproval(this, ...args); }

  resolveQuestion(...args) { return acpResolveQuestion(this, ...args); }


  forceTerminate(reason = `${this.runtimeDescriptor.displayName} ACP runtime stopped.`) {
    return this.#disconnect(reason, { expected: false });
  }

  async dispose(reason = `${this.runtimeDescriptor.displayName} ACP adapter closed.`) {
    if (this.disposed) {
      await Promise.all([...this.closingConnections].map((connection) => connection.waitForExit?.()));
      this.closingConnections.clear();
      return;
    }
    this.disposed = true;
    acpResolvePending(this, reason);
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
      void this.persistenceReporter.confirm();
      const usage = normalizeAcpPromptUsage(response?.usage);
      if (usage) this.onEvent(event("usage.updated", this.sessionId, active.turnId, null, usage));
      const completion = !active.interrupted
        ? safelyInspectCompletion(active.completionInspector, { response }, this.logger)
        : null;
      this.onEvent(event(active.interrupted ? "turn.interrupted" : "turn.completed", this.sessionId, active.turnId, null, {
        status: active.interrupted ? "interrupted" : "completed",
        stopReason: text(response?.stopReason, 160) || null,
        ...(completion ?? {}),
      }));
    } catch (error) {
      if (this.activeTurn !== active || this.disposed) return;
      if (error?.deliveryOutcome === "unknown") {
        this.onExit({ expected: false, error: redactSecretText(error.message || String(error)) });
        return;
      }
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
        acpResolvePending(this, `${this.runtimeDescriptor.displayName} turn ended before a client request was resolved.`);
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
        acpResolvePending(this, `${this.runtimeDescriptor.displayName} ACP process exited.`);
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
        requestPermission: (request) => acpRequestPermission(this, request),
        onSessionUpdate: (notification) => this.#handleSessionUpdate(notification),
        canHandleRequest: (method) => this.questionMethods.has(method),
        handleRequest: (method, request) => acpHandleExtensionRequest(this, method, request),
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
    if (connection) this.closingConnections.add(connection);
    connection?.dispose?.(reason, { expected });
    await connection?.waitForExit?.();
    this.closingConnections.delete(connection);
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
        hydration: native.loadSession === true ? "push-replay" : "unsupported",
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
            accepted: true,
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
    if (!this.sessionId && nativeSessionId(notification.sessionId)) this.sessionId = notification.sessionId;
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
    safelyObserveCompletion(this.activeTurn.completionInspector, notification, this.logger);
    for (const normalized of this.activeTurn.normalizer.normalize(notification)) this.onEvent(normalized);
  }

  #withSession(request, operation) {
    if (!this.sessionId || request?.sessionId !== this.sessionId) {
      throw new Error(`ACP file request does not belong to the active ${this.runtimeDescriptor.displayName} session.`);
    }
    return operation();
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

function cleanEnvironment(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string"));
}

function requiredId(value, label) {
  const id = nativeSessionId(value);
  if (!id) throw new Error(`${label} is invalid.`);
  return id;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safelyObserveCompletion(inspector, notification, logger) {
  if (!inspector?.observe) return;
  try {
    inspector.observe(notification);
  } catch {
    logger?.warn?.("ACP completion inspection ignored an invalid native update.");
  }
}

function safelyInspectCompletion(inspector, context, logger) {
  if (!inspector?.complete) return null;
  try {
    const completion = inspector.complete(context);
    return completion && typeof completion === "object" ? completion : null;
  } catch {
    logger?.warn?.("ACP completion inspection could not classify the completed turn.");
    return null;
  }
}

import type { AgentProjection, AgentDisplayPatch } from "./display-types";
import type { AgentFileReference, AgentReferenceStatus, AgentReferenceError, AgentWorkspaceEntryReference, AgentStagedAttachmentReference, AgentDraftReference, AgentPromptReferenceMention, AgentReferenceDisplay, AgentSubmissionIntent } from "./user-message-types";
export type * from "./user-message-types";
export type * from "./display-types";
/** Serializable DTOs shared by Renderer, preload declarations, and Electron main contract tests. */
export type AgentRuntimeId = string;
/** @deprecated Compatibility alias for the original Codex-only persistence format. */
export type AgentProviderId = AgentRuntimeId;

export type AgentReadinessStatus =
  | "not-installed"
  | "installed-not-authenticated"
  | "unsupported-version"
  | "protocol-unavailable"
  | "ready"
  | "error";

/** Exact readiness reason. Presentation and recovery routing use this code, not backend prose. */
export type AgentReadinessCode =
  | "READY"
  | "RUNTIME_NOT_INSTALLED"
  | "RUNTIME_DISCOVERY_FAILED"
  | "RUNTIME_INSPECTION_FAILED"
  | "RUNTIME_VERSION_UNVERIFIED"
  | "RUNTIME_VERSION_UNSUPPORTED"
  | "RUNTIME_SETUP_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATION_EXPIRED"
  | "AUTHENTICATION_PROBE_FAILED"
  | "AUTHENTICATION_PROBE_CRASHED"
  | "AUTHENTICATION_PROBE_TIMED_OUT"
  | "AUTHENTICATION_STATUS_UNKNOWN"
  | "PROVIDER_CREDENTIALS_REJECTED"
  | "PROTOCOL_UNAVAILABLE"
  | "PROTOCOL_PROBE_FAILED";

export type AgentRuntimeDescriptor = {
  id: AgentRuntimeId;
  displayName: string;
  description?: string;
  kind?: "harness" | "direct-cli" | string;
  iconKey?: string;
  priority?: number;
  version?: string | null;
  source?: string | null;
  compatibility?: string | null;
  distribution?: "bundled" | "sdk-bundled" | "user-installed" | string;
  execution?: {
    kind: string;
    distribution: string;
    controller: string;
  };
  protocol?: {
    kind: string;
    transport: string;
  };
  integration?: {
    kind: string;
    adapter: string;
  };
  trust?: {
    level: string;
    publisher: string;
  };
  ownership?: {
    harness: string;
    credentials: string[];
    models: string;
    billing: string[];
    session: string;
  };
};

export type AgentRuntimeReadiness = {
  runtimeId?: AgentRuntimeId;
  provider: AgentProviderId;
  status: AgentReadinessStatus;
  code: AgentReadinessCode;
  version: string | null;
  minimumVersion: string | null;
  message: string;
  source?: string;
  compatibility?: string;
  diagnostic?: string;
  selectable?: boolean;
};

/** @deprecated Use AgentRuntimeReadiness. */
export type AgentProviderReadiness = AgentRuntimeReadiness;
/** @deprecated Use AgentRuntimeReadiness. */
export type AgentBackendReadiness = AgentRuntimeReadiness;

export type AgentRuntimeCatalogEntry = {
  descriptor: AgentRuntimeDescriptor;
  readiness: AgentRuntimeReadiness;
};

export type AgentAttachmentKind = "image" | "text" | "audio" | "video" | "binary";

/** Renderer-safe admission policy. Native wire transports stay private to each runtime adapter. */
export type AgentAttachmentInputCapability = {
  accepted: boolean;
  mimeTypes?: string[];
  extensions?: string[];
  maxBytes?: number;
};

export type AgentReferenceInputCapabilities = {
  schemaVersion: 1;
  workspace: {
    files: boolean;
    directories: boolean;
    /** Explicit support for references owned by another admitted local root. */
    crossRoots?: boolean;
  };
  attachments: Record<AgentAttachmentKind, AgentAttachmentInputCapability>;
  limits: {
    maxCount: number;
    maxBytesPerReference: number;
    maxTotalBytes: number;
  };
  /** Whether the native steer operation accepts reference inputs. */
  steer: boolean;
  /** Whether an otherwise-empty prompt is accepted with references. */
  attachmentOnly: boolean;
};

export type AgentCapabilities = {
  streamingText: boolean;
  structuredToolEvents: boolean;
  commandOutputStreaming: boolean;
  fileChangeEvents: boolean;
  manualApprovals: boolean;
  structuredQuestions: boolean;
  resume: boolean;
  fork: boolean;
  steer: boolean;
  queue: boolean;
  attachments: boolean;
  contextReferences: boolean;
  modelSelection: boolean;
  modeSelection: boolean;
  slashCommands: boolean;
  sessionHistory: boolean;
  usage: boolean;
  accountState: boolean;
  mcp: boolean;
  skills: boolean;
  compaction: boolean;
  /** Independent native History operations; sessionHistory is a compatibility projection. */
  history?: {
    discovery: "unsupported" | "paged";
    exactOpen: "unsupported" | "supported";
    hydration: "unsupported" | "push-replay" | "snapshot" | "paged";
  };
  /** What native state can be recovered after PuppyOne loses the live connection. */
  recovery?: {
    strategy: "unsupported" | "cursor-replay" | "snapshot-reload" | "object-reconciliation";
    activeExecution: "confirmed" | "outcome-unknown";
    /** True only when native snapshot capture and subsequent events have no race window. */
    atomicHandoff: boolean;
  };
  /** Changes whenever the runtime's effective negotiated capability surface changes. */
  revision?: string;
  /** Versioned native protocol and explicitly negotiated extension metadata. */
  protocol?: {
    name: string;
    version: string | number;
    agentVersion?: string | null;
    extensions?: Record<string, number>;
  };
  /** Operation timing rules that cannot be represented by compatibility booleans. */
  constraints?: {
    modelSwitch?: "turn-boundary" | "session-boundary" | "unsupported";
    modeSwitch?: "turn-boundary" | "session-boundary" | "unsupported";
    forkRequiresIdle?: boolean;
    compactionRequiresIdle?: boolean;
  };
  /** Fine-grained native input support. Legacy booleans remain a migration projection. */
  referenceInputs?: AgentReferenceInputCapabilities;
};

export type AgentAccountState = {
  account: {
    type: string;
    email: string | null;
    planType: string | null;
  } | null;
  requiresOpenaiAuth: boolean;
  requiresRuntimeSetup?: boolean;
  setupReason?: "authentication-required" | "authentication-expired" | "runtime-setup-required";
  error?: string;
};

export type AgentModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  providerId?: string;
  modelId?: string;
  variants?: string[];
  defaultVariant?: string | null;
  contextWindow?: number | null;
};

export type AgentInferenceProvider = {
  id: string;
  displayName: string;
  source?: "env" | "config" | "custom" | "api" | string | null;
  defaultModel?: string | null;
  modelCount: number;
};

export type AgentMode = {
  id: string;
  displayName: string;
  description: string;
  isDefault: boolean;
};

export type AgentCommand = {
  name: string;
  description: string;
  source: string;
};

export type AgentSessionMetadata = {
  id: string;
  runtimeId?: AgentRuntimeId;
  runtime?: AgentRuntimeDescriptor | null;
  provider: AgentProviderId;
  providerSessionId: string | null;
  workspaceRoot: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  terminalState: AgentTurnTerminalState | "idle" | "running" | "provider-exited" | "outcome-unknown";
  selectedModel: string | null;
  selectedEffort?: string | null;
  selectedMode?: string | null;
  activeTurnId: string | null;
  lastSequence: number;
};

export type AgentSessionListItem = Omit<AgentSessionMetadata, "activeTurnId"> & {
  archivedAt?: string | null;
  partial?: boolean;
  /** Who first recorded the locator; never implies transcript ownership. */
  origin?: "puppyone" | "native-discovery";
};

export type AgentSessionDiscoveryStatus = "not-requested" | "unsupported" | "partial" | "complete" | "failed";

export type AgentSessionsListResponse = {
  sessions: AgentSessionListItem[];
  discovery: {
    runtimeId: AgentRuntimeId | null;
    status: AgentSessionDiscoveryStatus;
    nextCursor: string | null;
    /** Opaque product scan identity required only while pagination is partial. */
    scanId: string | null;
    indexed: number;
    warnings: string[];
  };
  warnings: string[];
};

export type AgentTurnTerminalState = "completed" | "failed" | "interrupted";

export type AgentEventType =
  | "session.started"
  | "session.resumed"
  | "session.updated"
  | "session.closed"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "turn.interrupted"
  | "user.message"
  | "assistant.delta"
  | "assistant.completed"
  | "reasoning.summary.delta"
  | "plan.updated"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "command.output.delta"
  | "file.change.updated"
  | "usage.updated"
  | "approval.requested"
  | "approval.resolved"
  | "question.requested"
  | "question.resolved"
  | "provider.activity"
  | "provider.connection.updated"
  | "provider.warning"
  | "provider.error";

export type AgentCanonicalToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "artifact"; uri: string; mimeType: string | null; text: string | null }
    | { type: "json"; value: unknown }
  >;
  error: string | null;
  success: boolean | null;
  truncated: boolean;
};

export type AgentEventPayloadMap = {
  "session.started": { title?: string; status?: string };
  "session.resumed": { title?: string; status?: string };
  "session.updated": { title?: string; status?: string };
  "session.closed": { status?: string };
  "turn.started": AgentRestoredPayload & {
    prompt?: string;
    userMessageId?: string;
    submissionId?: string;
    status?: string;
    referenceDisplays?: AgentReferenceDisplay[];
    promptMentions?: AgentPromptReferenceMention[];
    model?: string | null;
    effort?: string | null;
    mode?: string | null;
  };
  "turn.completed": AgentRestoredPayload & { status?: string; durationMs?: number };
  "turn.failed": AgentRestoredPayload & { status?: string; message?: string; durationMs?: number };
  "turn.interrupted": AgentRestoredPayload & { status?: string; message?: string; durationMs?: number };
  "user.message": AgentRestoredPayload & {
    text: string;
    referenceDisplays?: AgentReferenceDisplay[];
    promptMentions?: AgentPromptReferenceMention[];
  };
  "assistant.delta": AgentTextUpdatePayload & { delta?: string; text?: string };
  "assistant.completed": AgentTextUpdatePayload & { text?: string };
  "reasoning.summary.delta": AgentTextUpdatePayload & {
    delta?: string;
    text?: string;
    summaryIndex?: number;
    completed?: boolean;
    boundary?: boolean;
  };
  "plan.updated": AgentTextUpdatePayload & { steps?: unknown[]; explanation?: string | null; completed?: boolean };
  "tool.started": AgentActivityPayload;
  "tool.progress": AgentActivityPayload;
  "tool.completed": AgentActivityPayload;
  "command.output.delta": AgentActivityPayload & { delta?: string; updateMode?: "append" | "replace" };
  "file.change.updated": AgentActivityPayload;
  "usage.updated": {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedTokens?: number;
    cost?: number;
    contextWindow?: number;
    tokens?: number;
  };
  "approval.requested": AgentBlockingPayload & {
    availableDecisions?: AgentApprovalDecision[];
    commandActions?: Array<Record<string, unknown>>;
    networkApprovalContext?: Record<string, unknown> | null;
    grantRoot?: string | null;
    proposedExecpolicyAmendment?: unknown;
    proposedNetworkPolicyAmendments?: unknown;
  };
  "approval.resolved": AgentBlockingPayload & { decision?: AgentApprovalDecision };
  "question.requested": AgentBlockingPayload & { questions: unknown[] };
  "question.resolved": AgentBlockingPayload & { resolution?: string; rejected?: boolean };
  "provider.activity": AgentActivityPayload;
  "provider.connection.updated": {
    scope?: "upstream-request" | "transport";
    requestId?: string;
    recoveryId?: string;
    state: "reconnecting" | "fallback" | "connected";
    message?: string;
    attempt?: number;
    maxAttempts?: number;
    maxRetries?: number;
  };
  "provider.warning": AgentDiagnosticPayload & {
    attempt?: number;
    maxAttempts?: number;
    maxRetries?: number;
  };
  "provider.error": AgentDiagnosticPayload;
};

type AgentRestoredPayload = { restored?: boolean };

type AgentTextUpdatePayload = AgentRestoredPayload & {
  updateMode?: "append" | "replace";
  streaming?: boolean;
  truncated?: boolean;
};

type AgentActivityPayload = {
  kind?: string;
  tool?: string;
  label?: string;
  description?: string;
  status?: string;
  input?: Record<string, unknown> | null;
  arguments?: Record<string, unknown> | null;
  command?: string | null;
  cwd?: string | null;
  path?: string | null;
  query?: string | null;
  changes?: unknown[];
  outputPreview?: string;
  result?: AgentCanonicalToolResult;
  error?: string | Record<string, unknown> | null;
  content?: unknown;
  detail?: unknown;
  metadata?: Record<string, unknown>;
  recoverable?: boolean;
  exitCode?: number | null;
  duration?: number;
  durationMs?: number;
  elapsedMs?: number;
  diff?: string;
  patch?: string;
  outputPaths?: string[];
  truncated?: boolean;
  restored?: boolean;
};

type AgentBlockingPayload = {
  requestId: string;
  kind?: string;
  title?: string;
  command?: string;
  cwd?: string;
  reason?: string | null;
};

type AgentDiagnosticPayload = {
  code?: string;
  stage?: string;
  source?: string;
  actions?: string[];
  message?: string;
  recoverable?: boolean;
  diagnostic?: string;
};

export type AgentEventEnvelope<TType extends AgentEventType> = {
  schemaVersion: 1;
  sequence: number;
  sessionId: string;
  runtimeId?: AgentRuntimeId;
  provider: AgentProviderId;
  providerSessionId: string | null;
  turnId: string | null;
  itemId: string | null;
  emittedAt: string;
  type: TType;
  payload: AgentEventPayloadMap[TType];
};

/** A true discriminated union: narrowing `type` also narrows `payload`. */
export type AgentEvent<TType extends AgentEventType = AgentEventType> = TType extends AgentEventType
  ? AgentEventEnvelope<TType>
  : never;

export type AgentRuntimeInspection = {
  runtimes?: AgentRuntimeCatalogEntry[];
  selectedRuntimeId?: AgentRuntimeId | null;
  runtime?: AgentRuntimeDescriptor;
  /** Readiness for selectedRuntimeId; null while the UI is showing inventory before selection. */
  readiness: AgentRuntimeReadiness | null;
  account: AgentAccountState | null;
  providers?: AgentInferenceProvider[];
  models: AgentModel[];
  modes?: AgentMode[];
  commands?: AgentCommand[];
  capabilities: AgentCapabilities | null;
  warnings: string[];
};

/** @deprecated Use AgentRuntimeInspection. */
export type AgentProviderInspection = AgentRuntimeInspection;

export type AgentLocalInstallationState = "not-found" | "detected" | "unsupported" | "broken";
export type AgentLocalAuthenticationState = "unknown" | "signed-out" | "signed-in" | "expired" | "error";
export type AgentLocalIntegrationState =
  | "inventory-only"
  | "setup-required"
  | "protocol-unavailable"
  | "ready"
  | "incompatible"
  | "blocked"
  /** @deprecated Read-only compatibility for older snapshots. */
  | "bridge-required";
export type AgentLocalConnectionSource =
  | "configured"
  | "user-installation"
  | "system-installation"
  | "path-installation"
  | "application-bundle";

export type AgentLocalConnection = {
  id: string;
  displayName: string;
  installation: AgentLocalInstallationState;
  version: string | null;
  authentication: AgentLocalAuthenticationState;
  integration: AgentLocalIntegrationState;
  capabilities: {
    versionProbe: boolean;
    authenticationProbe: boolean;
    protocolProbe: boolean;
  };
  selectable: boolean;
  statusMessage: string;
  actions: Array<{ id: "refresh" | "learn-more"; label: string }>;
  source?: AgentLocalConnectionSource;
};

export type AgentLocalConnectionsSnapshot = {
  connections: AgentLocalConnection[];
  scannedAt: string;
  warnings: string[];
};

export type AgentSessionSnapshot = {
  display: AgentProjection;
  session: AgentSessionMetadata;
  runtime?: AgentRuntimeDescriptor;
  account: AgentAccountState | null;
  providers?: AgentInferenceProvider[];
  models: AgentModel[];
  modes?: AgentMode[];
  commands?: AgentCommand[];
  capabilities: AgentCapabilities | null;
  events: AgentEvent[];
  partial: boolean;
  firstAvailableSequence: number;
  lastSequence: number;
  /** Atomic Main state and its stream cursor accompany every display snapshot. */
  cursor: AgentSessionCursor;
  control: AgentSessionControlView;
  timeline?: AgentTimelineWindow;
};

export type AgentSessionCursor = { streamId: string; revision: number };

export type AgentCommandDeliveryStatus = "queued" | "dispatching" | "accepted" | "rejected" | "cancelled" | "outcome-unknown";

export type AgentControlStartIntent = {
  prompt: string;
  promptMentions: AgentPromptReferenceMention[];
  referenceDisplays: AgentReferenceDisplay[];
  model: string | null;
  effort: string | null;
  mode: string | null;
};

export type AgentSessionControl = {
  schemaVersion: 1;
  streamId: string;
  revision: number;
  sessionEpoch: string;
  adapterGeneration: number;
  runGeneration: number;
  connection: {
    status: "connecting" | "connected" | "recovering" | "disconnected" | "exited";
    reason: string | null;
    /** Structured recovery presentation copied from the canonical connection fact. */
    recoveryState?: "reconnecting" | "fallback" | null;
    attempt?: number | null;
    maxAttempts?: number | null;
  };
  execution: {
    status: "idle" | "starting" | "active" | "ended" | "outcome-unknown";
    activeTurnId: string | null;
    uncertainTurnId: string | null;
    startedAtMs: number | null;
    nativeOutcome: AgentTurnTerminalState | null;
    certainty: "confirmed" | "unknown";
  };
  interaction: {
    approvals: Array<{ requestId: string; turnId: string | null; itemId: string | null; runtimeId: string; event?: AgentEvent }>;
    questions: Array<{ requestId: string; turnId: string | null; itemId: string | null; runtimeId: string; questions: unknown[]; event?: AgentEvent }>;
  };
  commands: Array<{
    commandId: string;
    operationId: string | null;
    kind: "start" | "steer" | "interrupt" | "approval" | "question";
    targetTurnId: string | null;
    requestId?: string | null;
    status: AgentCommandDeliveryStatus;
    error: string | null;
    intentFingerprint: string | null;
    wasQueued: boolean;
    /** Main-allocated client input identity, available before native delivery. */
    userMessageId?: string | null;
    intent?: AgentControlStartIntent;
  }>;
  recoveries?: Array<{id: string; scope: "upstream-request" | "transport"; turnId: string | null; requestId: string | null; adapterGeneration: number; runGeneration: number; state: "reconnecting" | "fallback"; message: string; attempt: number | null; maxAttempts: number | null}>;
  queue: string[];
  terminalTurns: string[];
  pendingSubmission: {
    commandId: string;
    operationId: string;
    adapterGeneration: number;
    prompt: string;
    promptMentions: AgentPromptReferenceMention[];
    referenceDisplays: AgentReferenceDisplay[];
  } | null;
};

/** Renderer receives identities and delivery state, never executable input bodies. */
export type AgentSessionControlView = Omit<AgentSessionControl, "commands" | "pendingSubmission" | "interaction"> & {
  commands: Array<Omit<AgentSessionControl["commands"][number], "intent">>;
  pendingSubmission: Pick<NonNullable<AgentSessionControl["pendingSubmission"]>, "commandId" | "operationId" | "adapterGeneration"> | null;
  interaction: {
    approvals: Array<Omit<AgentSessionControl["interaction"]["approvals"][number], "event">>;
    questions: Array<Omit<AgentSessionControl["interaction"]["questions"][number], "event" | "questions">>;
  };
};

export type AgentTimelineWindow = {
  events: AgentEvent[];
  /** Current facts whose original event fell outside the bounded content window. */
  checkpointEvents?: AgentEvent[];
  partial: boolean;
  firstAvailableSequence: number;
  lastSequence: number;
};

export type AgentSessionAttachRequest = { rootPath: string; sessionId: string };
export type AgentSessionFeedReceipt = {
  subscriptionId: string;
  snapshot: AgentSessionSnapshot;
};
export type AgentSessionFeedAckRequest = AgentSessionAttachRequest & AgentSessionCursor & { subscriptionId: string };
export type AgentSessionDetachRequest = AgentSessionAttachRequest & { subscriptionId: string };
export type AgentSessionFrame =
  | {
      type: "delta";
      subscriptionId: string;
      streamId: string;
      baseRevision: number;
      revision: number;
      control: AgentSessionControlView;
      displayPatch: AgentDisplayPatch;
      session: AgentSessionMetadata;
    }
  | {
      type: "resync-required";
      subscriptionId: string;
      streamId: string;
      revision: number;
    };

export type AgentRuntimeRequest = {
  rootPath?: string | null;
  runtimeId?: AgentRuntimeId | null;
  refresh?: boolean;
};

export type AgentLocalConnectionsRequest = Pick<AgentRuntimeRequest, "rootPath" | "refresh">;

export type AgentModelsListRequest = AgentRuntimeRequest;
export type AgentAccountReadRequest = AgentRuntimeRequest;

export type AgentSessionCreateRequest = {
  rootPath: string;
  runtimeId?: AgentRuntimeId | null;
  model?: string | null;
  effort?: string | null;
  mode?: string | null;
};

export type AgentSessionResumeRequest = {
  rootPath: string;
  sessionId?: string | null;
  runtimeId?: AgentRuntimeId | null;
};

export type AgentSessionOpenRequest = {
  rootPath: string;
  sessionId: string;
  runtimeId: AgentRuntimeId;
};

export type AgentSessionOpenErrorCode =
  | "SESSION_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "RUNTIME_UNAVAILABLE"
  | "RESUME_UNSUPPORTED"
  | "RESUME_TIMED_OUT"
  | "WORKSPACE_MISMATCH"
  | "PROTOCOL_ERROR";

export type AgentSessionOpenResult =
  | { status: "opened"; snapshot: AgentSessionSnapshot }
  | {
      status: "failed";
      error: {
        code: AgentSessionOpenErrorCode;
        message: string;
        retryable: boolean;
      };
    };

export type AgentSessionsListRequest = {
  rootPath: string;
  runtimeId?: AgentRuntimeId | null;
  includeArchived?: boolean;
  /** Explicit user-requested native metadata discovery; false never starts a harness. */
  discoverNative?: boolean;
  cursor?: string | null;
  /** Opaque product scan identity returned with a partial discovery page. */
  scanId?: string | null;
  limit?: number;
};

export type AgentSessionCloseRequest = {
  rootPath: string;
  sessionId: string;
  removePersistence?: boolean;
};

export type AgentSessionMutationRequest = {
  rootPath: string;
  sessionId: string;
  messageId?: string | null;
  archiveNative?: boolean;
  deleteNative?: boolean;
};

export type AgentCommandPrecondition = {
  /** Rejects a command captured for an older Main SessionActor instance. */
  expectedSessionEpoch?: string;
  /** Rejects a command captured before the native adapter was replaced. */
  expectedAdapterGeneration?: number;
  /** Rejects turn-scoped intent captured for an older active run. */
  expectedRunGeneration?: number;
};

export type AgentTurnStartRequest = AgentCommandPrecondition & {
  rootPath: string;
  sessionId: string;
  commandId?: string;
  prompt: string;
  model?: string | null;
  effort?: string | null;
  mode?: string | null;
  referenceEpoch?: string;
  promptMentions?: AgentPromptReferenceMention[];
  attachments?: AgentFileReference[];
  contextReferences?: AgentFileReference[];
  references?: AgentDraftReference[];
};

export type AgentTurnSteerRequest = AgentCommandPrecondition & {
  rootPath: string;
  sessionId: string;
  turnId: string;
  commandId?: string;
  message: string;
  referenceEpoch?: string;
  promptMentions?: AgentPromptReferenceMention[];
  references?: AgentDraftReference[];
};

export type AgentReferenceStageRequest = {
  rootPath: string;
  epoch: string;
  files: File[];
};

export type AgentReferenceRevokeRequest = {
  rootPath: string;
  tokens: string[];
};

export type AgentWorkspaceReferenceResolveRequest = {
  rootPath: string;
  paths: string[];
};

export type AgentTurnInterruptRequest = AgentCommandPrecondition & {
  rootPath: string;
  sessionId: string;
  turnId: string;
  commandId?: string;
};

export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type AgentApprovalResolution = AgentCommandPrecondition & {
  rootPath: string;
  sessionId: string;
  turnId: string;
  requestId: string;
  commandId?: string;
  decision: AgentApprovalDecision;
};

export type AgentQuestionResolution = AgentCommandPrecondition & {
  rootPath: string;
  sessionId: string;
  turnId: string;
  requestId: string;
  commandId?: string;
  answer?: string | string[] | string[][] | null;
  answers?: string[][] | null;
  rejected?: boolean;
};

export type AgentReplayRequest = {
  rootPath: string;
  sessionId: string;
  afterSequence: number;
};

export type AgentSessionExitEvent = {
  sessionId: string;
  reason: "closed" | "provider-exited";
};

export type AgentIpcChannel =
  | "agent:providers-discover"
  | "agent:local-connections-discover"
  | "agent:models-list"
  | "agent:account-read"
  | "agent:session-create"
  | "agent:session-resume"
  | "agent:session-open"
  | "agent:session-replay"
  | "agent:session-attach"
  | "agent:session-feed-ack"
  | "agent:session-feed-watermark"
  | "agent:session-detach"
  | "agent:sessions-list"
  | "agent:session-fork"
  | "agent:session-archive"
  | "agent:session-delete"
  | "agent:session-close"
  | "agent:reference-stage"
  | "agent:reference-revoke"
  | "agent:reference-resolve-workspace"
  | "agent:reference-pick-workspace"
  | "agent:command-dispatch"
  | "agent:turn-start"
  | "agent:turn-steer"
  | "agent:turn-interrupt"
  | "agent:session-compact"
  | "agent:approval-resolve"
  | "agent:question-resolve";

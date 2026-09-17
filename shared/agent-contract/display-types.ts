import type {
  AgentCommandDeliveryStatus,
  AgentPromptReferenceMention,
  AgentReferenceDisplay,
  AgentTurnCompletionQuality,
  AgentTurnFailureScope,
  AgentTurnSideEffects,
  AgentTurnTerminalState,
  AgentTurnTransportHealth,
} from "./types";

export type AgentTranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  clientUserMessageId?: string;
  submissionId?: string;
  deliveryStatus?: AgentCommandDeliveryStatus;
  truncated?: boolean;
  turnId: string | null;
  itemId: string | null;
  text: string;
  references?: AgentReferenceDisplay[];
  promptMentions?: AgentPromptReferenceMention[];
  streaming: boolean;
  terminalState: AgentTurnTerminalState | null;
  /** Immutable first-observed position in the canonical event ledger. */
  sequence: number;
  /** Latest event that revised this message without changing its position. */
  updatedSequence?: number;
};

export type AgentActivityStatus =
  | "queued"
  | "running"
  | "pending"
  | "in-progress"
  | "waiting-for-user"
  | "completed"
  | "succeeded"
  | "failed"
  | "warning"
  | "blocked"
  | "cancelled"
  | "interrupted"
  | "unknown";

export type AgentActivityLabelCode =
  | "reasoning-summary"
  | "plan-updated"
  | "command"
  | "command-output"
  | "file-changes"
  | "tool-activity"
  | "agent-activity"
  | "provider-error"
  | "provider-warning";

export type AgentActivityKind = "tool" | "command" | "file-change" | "plan" | "reasoning" | "warning" | "error";

/** Discriminated semantic activity type shared by projection and Renderer registries. */
export type AgentActivity<TKind extends AgentActivityKind = AgentActivityKind> = TKind extends AgentActivityKind ? {
  id: string;
  turnId: string | null;
  itemId: string | null;
  kind: TKind;
  label: string;
  labelCode?: AgentActivityLabelCode;
  status: AgentActivityStatus;
  detail: Record<string, unknown>;
  output: string;
  /** Immutable first-observed position in the canonical event ledger. */
  sequence: number;
  /** Latest event that revised this activity without changing its position. */
  updatedSequence?: number;
} : never;

/**
 * Replaceable, live provider transport state. It is deliberately not an
 * activity or timeline part: connection attempts describe the current turn,
 * not durable conversation history.
 */
export type AgentConnectionStatus = {
  state: "reconnecting" | "fallback";
  message: string;
  attempt: number | null;
  maxAttempts: number | null;
  turnId: string | null;
  sequence: number;
};

export type AgentApproval = {
  replyStatus?: import("./types").AgentCommandDeliveryStatus | null;
  requestId: string;
  turnId: string;
  itemId: string | null;
  kind: "command" | "file-change";
  title: string;
  titleCode?: "approval-required";
  command: string | null;
  cwd: string | null;
  commandActions: Array<Record<string, unknown>>;
  networkApprovalContext: { host: string; protocol: string } | null;
  grantRoot: string | null;
  policyChangeRequested: boolean;
  reason: string | null;
  availableDecisions: Array<"accept" | "acceptForSession" | "decline" | "cancel">;
  sequence: number;
};

export type AgentQuestionChoice = { label: string; description: string };
export type AgentQuestionPrompt = {
  header: string;
  question: string;
  multiple: boolean;
  custom: boolean;
  options: AgentQuestionChoice[];
};

export type AgentQuestion = {
  replyStatus?: import("./types").AgentCommandDeliveryStatus | null;
  requestId: string;
  turnId: string;
  itemId: string | null;
  questions: AgentQuestionPrompt[];
  sequence: number;
};

type AgentPartBase = {
  id: string;
  turnId: string | null;
  itemId: string | null;
  /** Immutable first-observed position in the canonical event ledger. */
  sequence: number;
  /** Latest event that revised this part without changing its position. */
  updatedSequence?: number;
};

export type AgentPart =
  | (AgentPartBase & { kind: "user"; text: string; submissionId?: string; deliveryStatus?: AgentCommandDeliveryStatus; references?: AgentReferenceDisplay[]; promptMentions?: AgentPromptReferenceMention[]; streaming: boolean; terminalState: AgentTurnTerminalState | null })
  | (AgentPartBase & { kind: "assistant"; text: string; truncated?: boolean; streaming: boolean; terminalState: AgentTurnTerminalState | null })
  | (AgentPartBase & { kind: "turn-summary"; durationMs: number; status: AgentTurnTerminalState; completionQuality?: AgentTurnCompletionQuality })
  | AgentActivity
  | (AgentPartBase & { kind: "usage"; usage: Record<string, unknown> })
  | (AgentPartBase & { kind: "permission"; requestId: string; state: "pending" | "resolved" | "unavailable" })
  | (AgentPartBase & { kind: "question"; requestId: string; state: "pending" | "resolved" | "unavailable" })
  | (AgentPartBase & { kind: "unknown"; eventType: string; label: string; labelCode?: "unsupported-event" });

export type AgentTurn = {
  id: string;
  status: "running" | "outcome-unknown" | AgentTurnTerminalState;
  startedAtSequence: number;
  startedAtMs: number | null;
  /** Time spent waiting for an approval or question is not Agent work time. */
  userWaitStartedAtMs?: number | null;
  userWaitDurationMs?: number;
  completedAtSequence: number | null;
  durationMs: number | null;
  partIds: string[];
  completionQuality?: AgentTurnCompletionQuality;
  recovery?: AgentTurnRecovery;
};

/** Provider-neutral recovery fact derived in Main, never inferred from rendered prose. */
export type AgentTurnRecovery = {
  kind: "degraded-completion";
  failureScope: AgentTurnFailureScope;
  code: string;
  retryable: boolean | null;
  transportHealth: AgentTurnTransportHealth;
  sideEffects: AgentTurnSideEffects;
  diagnostic?: string;
};

export type TimelineRow = {
  id: string;
  partId: string;
  turnId: string | null;
  kind: AgentPart["kind"];
  /** Immutable visual order. Never replace this on an upsert. */
  sequence: number;
  /** Latest content revision, used for freshness and render recovery. */
  updatedSequence?: number;
  estimatedHeight: number;
};

export type AgentDisplayPresentation = {
  phase: "ready" | "creating" | "running" | "waiting" | "runtime-exited";
  terminalState: "idle" | "running" | "outcome-unknown" | "provider-exited" | AgentTurnTerminalState;
  pendingPrompt: string | null;
  submitting: boolean;
  stopping: boolean;
};

/** Native content coverage is independent of event replay and UI window limits. */
export type AgentHistoryCoverage = {
  coverage: "not-requested" | "complete" | "partial" | "unknown";
  reason: "read-limit" | "replay-unverified" | "unsupported" | "unverified" | null;
};

export type AgentProjection = {
  presentation: AgentDisplayPresentation;
  schemaVersion: 1;
  sessionState: "empty" | "active" | "closed";
  lastSequence: number;
  history: AgentHistoryCoverage;
  displayWindow: { truncated: boolean };
  /** Diagnostic gaps in the local event ledger, not proof of missing native messages. */
  missingRanges: Array<{ from: number; to: number }>;
  messages: AgentTranscriptMessage[];
  activities: AgentActivity[];
  approvals: AgentApproval[];
  questions: AgentQuestion[];
  turns: AgentTurn[];
  parts: AgentPart[];
  rows: TimelineRow[];
  connectionStatus: AgentConnectionStatus | null;
  runningTurnId: string | null;
  terminalState: AgentTurnTerminalState | null;
  usage: Record<string, unknown> | null;
};

export type AgentDisplayPatch = {
  schemaVersion: 1;
  values: Partial<Pick<AgentProjection, "sessionState" | "lastSequence" | "history" | "displayWindow" | "missingRanges" | "connectionStatus" | "runningTurnId" | "terminalState" | "usage" | "presentation">>;
  collections: Partial<{ [K in "messages" | "activities" | "approvals" | "questions" | "turns" | "parts" | "rows"]: {
    remove: string[];
    upsert: AgentProjection[K][number][];
    update: Array<{ id: string; changes: Record<string, unknown>; append: Record<string, {offset: number; text: string}>; unset: string[] }>;
    order?: string[];
  } }>;
};

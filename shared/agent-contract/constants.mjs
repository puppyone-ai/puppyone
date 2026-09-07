export const AGENT_EVENT_TYPES = Object.freeze([
  "session.started", "session.resumed", "session.updated", "session.closed",
  "turn.started", "turn.completed", "turn.failed", "turn.interrupted",
  "user.message",
  "assistant.delta", "assistant.completed", "reasoning.summary.delta", "plan.updated",
  "tool.started", "tool.progress", "tool.completed", "command.output.delta",
  "file.change.updated", "usage.updated", "approval.requested", "approval.resolved",
  "question.requested", "question.resolved", "provider.activity", "provider.connection.updated",
  "provider.warning", "provider.error",
]);

export const AGENT_RUNTIME_CAPABILITIES = Object.freeze([
  "streamingText", "structuredToolEvents", "commandOutputStreaming", "fileChangeEvents",
  "manualApprovals", "structuredQuestions", "resume", "fork", "steer", "queue",
  "attachments", "contextReferences", "modelSelection", "modeSelection", "slashCommands",
  "sessionHistory", "usage", "accountState", "mcp", "skills", "compaction",
]);

export const REQUIRED_AGENT_RUNTIME_METHODS = Object.freeze([
  "inspect", "createSession", "resumeSession", "startTurn", "interruptTurn", "dispose",
]);

/**
 * Stable, renderer-safe reasons for an Agent runtime readiness result.
 *
 * `status` remains the coarse workflow state used to gate execution. `code`
 * identifies the exact reason and is what presentation and recovery routing
 * must switch on. Keeping this mapping in the shared contract prevents an
 * authentication probe crash from being rendered as an explicit sign-out.
 */
export const AGENT_READINESS_CODE_STATUS = Object.freeze({
  READY: "ready",
  RUNTIME_NOT_INSTALLED: "not-installed",
  RUNTIME_DISCOVERY_FAILED: "error",
  RUNTIME_INSPECTION_FAILED: "error",
  RUNTIME_VERSION_UNVERIFIED: "unsupported-version",
  RUNTIME_VERSION_UNSUPPORTED: "unsupported-version",
  RUNTIME_SETUP_REQUIRED: "installed-not-authenticated",
  AUTHENTICATION_REQUIRED: "installed-not-authenticated",
  AUTHENTICATION_EXPIRED: "installed-not-authenticated",
  AUTHENTICATION_PROBE_FAILED: "error",
  AUTHENTICATION_PROBE_CRASHED: "error",
  AUTHENTICATION_PROBE_TIMED_OUT: "error",
  AUTHENTICATION_STATUS_UNKNOWN: "error",
  PROVIDER_CREDENTIALS_REJECTED: "installed-not-authenticated",
  PROTOCOL_UNAVAILABLE: "protocol-unavailable",
  PROTOCOL_PROBE_FAILED: "protocol-unavailable",
});

export const AGENT_READINESS_CODES = Object.freeze(Object.keys(AGENT_READINESS_CODE_STATUS));

export const AGENT_SESSION_OPEN_ERROR_CODES = Object.freeze([
  "SESSION_NOT_FOUND",
  "SOURCE_CHANGED",
  "AUTH_REQUIRED",
  "AUTH_EXPIRED",
  "RUNTIME_UNAVAILABLE",
  "RESUME_UNSUPPORTED",
  "RESUME_TIMED_OUT",
  "WORKSPACE_MISMATCH",
  "PROTOCOL_ERROR",
]);

export const AGENT_IPC_CHANNELS = Object.freeze([
  "agent:providers-discover", "agent:local-connections-discover", "agent:models-list", "agent:account-read",
  "agent:session-create", "agent:session-resume", "agent:session-open", "agent:session-replay",
  "agent:session-attach", "agent:session-feed-ack", "agent:session-feed-watermark", "agent:session-detach", "agent:sessions-list",
  "agent:session-fork", "agent:session-archive", "agent:session-delete", "agent:session-close",
  "agent:reference-stage", "agent:reference-revoke", "agent:reference-resolve-workspace",
  "agent:reference-pick-workspace",
  "agent:command-dispatch",
  "agent:turn-start", "agent:turn-steer", "agent:turn-interrupt", "agent:session-compact",
  "agent:approval-resolve", "agent:question-resolve",
]);

export const agentContractLimits = Object.freeze({
  maxPathLength: 4_096,
  maxMessageLength: 128 * 1024,
  maxControlReasonLength: 1_000,
  maxCommandErrorLength: 1_000,
  maxCommandFingerprintLength: 128,
  maxReferenceCount: 32,
  maxReferenceBytes: 25 * 1024 * 1024,
  maxTotalReferenceBytes: 25 * 1024 * 1024,
});

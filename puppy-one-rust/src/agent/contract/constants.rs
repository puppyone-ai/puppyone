//! `shared/agent-contract/constants.mjs`.

pub const AGENT_EVENT_TYPES: &[&str] = &[
    "session.started",
    "session.resumed",
    "session.updated",
    "session.closed",
    "turn.started",
    "turn.completed",
    "turn.failed",
    "turn.interrupted",
    "user.message",
    "assistant.delta",
    "assistant.completed",
    "reasoning.summary.delta",
    "plan.updated",
    "tool.started",
    "tool.progress",
    "tool.completed",
    "command.output.delta",
    "file.change.updated",
    "usage.updated",
    "approval.requested",
    "approval.resolved",
    "question.requested",
    "question.resolved",
    "provider.notification",
    "provider.activity",
    "provider.connection.updated",
    "provider.warning",
    "provider.error",
];

pub const AGENT_RUNTIME_CAPABILITIES: &[&str] = &[
    "streamingText",
    "structuredToolEvents",
    "commandOutputStreaming",
    "fileChangeEvents",
    "manualApprovals",
    "structuredQuestions",
    "resume",
    "fork",
    "steer",
    "queue",
    "attachments",
    "contextReferences",
    "modelSelection",
    "modeSelection",
    "slashCommands",
    "sessionHistory",
    "usage",
    "accountState",
    "mcp",
    "skills",
    "compaction",
];

/// The provider process ended after the native turn had a confirmed terminal outcome.
pub const AGENT_IDLE_DISCONNECT_REASON: &str = "provider-idle-exit";

/// Stable, renderer-safe reasons for an Agent runtime readiness result.
///
/// `status` remains the coarse workflow state used to gate execution. `code`
/// identifies the exact reason and is what presentation and recovery routing
/// must switch on. Keeping this mapping in the shared contract prevents an
/// authentication probe crash from being rendered as an explicit sign-out.
pub const AGENT_READINESS_CODE_STATUS: &[(&str, &str)] = &[
    ("READY", "ready"),
    ("RUNTIME_NOT_INSTALLED", "not-installed"),
    ("RUNTIME_DISCOVERY_FAILED", "error"),
    ("RUNTIME_INSPECTION_FAILED", "error"),
    ("RUNTIME_VERSION_UNVERIFIED", "unsupported-version"),
    ("RUNTIME_VERSION_UNSUPPORTED", "unsupported-version"),
    ("RUNTIME_SETUP_REQUIRED", "installed-not-authenticated"),
    ("AUTHENTICATION_REQUIRED", "installed-not-authenticated"),
    ("AUTHENTICATION_EXPIRED", "installed-not-authenticated"),
    ("AUTHENTICATION_PROBE_FAILED", "error"),
    ("AUTHENTICATION_PROBE_CRASHED", "error"),
    ("AUTHENTICATION_PROBE_TIMED_OUT", "error"),
    ("AUTHENTICATION_STATUS_UNKNOWN", "error"),
    (
        "PROVIDER_CREDENTIALS_REJECTED",
        "installed-not-authenticated",
    ),
    ("PROTOCOL_UNAVAILABLE", "protocol-unavailable"),
    ("PROTOCOL_PROBE_FAILED", "protocol-unavailable"),
];

/// `AGENT_READINESS_CODES`.
pub fn agent_readiness_codes() -> Vec<&'static str> {
    AGENT_READINESS_CODE_STATUS
        .iter()
        .map(|(code, _)| *code)
        .collect()
}

/// `AGENT_READINESS_CODE_STATUS[code]`.
pub fn readiness_code_status(code: &str) -> Option<&'static str> {
    AGENT_READINESS_CODE_STATUS
        .iter()
        .find(|(entry, _)| *entry == code)
        .map(|(_, status)| *status)
}

pub const AGENT_SESSION_OPEN_ERROR_CODES: &[&str] = &[
    "SESSION_NOT_FOUND",
    "SOURCE_CHANGED",
    "AUTH_REQUIRED",
    "AUTH_EXPIRED",
    "RUNTIME_UNAVAILABLE",
    "RESUME_UNSUPPORTED",
    "RESUME_TIMED_OUT",
    "HISTORY_READ_FAILED",
    "WORKSPACE_MISMATCH",
    "PROTOCOL_ERROR",
];

/// `agentContractLimits`.
pub mod limits {
    pub const MAX_PATH_LENGTH: usize = 4_096;
    pub const MAX_MESSAGE_LENGTH: usize = 128 * 1024;
    pub const MAX_CONTROL_REASON_LENGTH: usize = 1_000;
    pub const MAX_COMMAND_ERROR_LENGTH: usize = 1_000;
    pub const MAX_COMMAND_FINGERPRINT_LENGTH: usize = 128;
    pub const MAX_REFERENCE_COUNT: usize = 32;
    pub const MAX_TOTAL_REFERENCE_BYTES: usize = 25 * 1024 * 1024;
}

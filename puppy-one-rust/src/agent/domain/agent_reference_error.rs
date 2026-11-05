//! `domain/agent-reference-error.mjs`.

/// `AGENT_REFERENCE_ERROR_CODES`.
pub mod codes {
    pub const UNAUTHORIZED: &str = "REFERENCE_UNAUTHORIZED";
    pub const UNSUPPORTED_KIND: &str = "REFERENCE_KIND_UNSUPPORTED";
    pub const MISSING_RUNTIME_CAPABILITY: &str = "REFERENCE_RUNTIME_CAPABILITY_MISSING";
    pub const MODEL_INCOMPATIBLE: &str = "REFERENCE_MODEL_INCOMPATIBLE";
    pub const MATERIALIZATION_FAILED: &str = "REFERENCE_MATERIALIZATION_FAILED";
    pub const UNVERIFIED_RUNTIME_VERSION: &str = "REFERENCE_RUNTIME_VERSION_UNVERIFIED";
    pub const LIMIT_EXCEEDED: &str = "REFERENCE_LIMIT_EXCEEDED";
    pub const INVALID_INPUT: &str = "REFERENCE_INPUT_INVALID";
}

/// `AgentReferenceError`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentReferenceError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for AgentReferenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AgentReferenceError {}

/// `agentReferenceError(code, message)`.
pub fn agent_reference_error(
    code: &'static str,
    message: impl Into<String>,
) -> AgentReferenceError {
    AgentReferenceError {
        code,
        message: message.into(),
    }
}

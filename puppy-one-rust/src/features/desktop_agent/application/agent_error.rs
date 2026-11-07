//! `application/agent-error.ts`: Renderer error codes and their
//! presentation descriptors (`{ code, params?, detail?, operation? }`).
use crate::agent::agent_error::AgentError;
use crate::agent::contract::dto::{ErrorParam, ErrorParams, OperationFailure};

/// `AgentErrorDescriptor`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ErrorDescriptor {
    pub code: String,
    pub params: ErrorParams,
    pub detail: Option<String>,
    /// The operation failure an unknown error came from.
    pub operation: Option<OperationFailure>,
}

impl ErrorDescriptor {
    /// `error.params[key]` as text.
    pub fn param(&self, key: &str) -> Option<&ErrorParam> {
        self.params
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
    }
}

/// `new AgentOperationError(failure)`: a structured bridge failure.
pub fn agent_operation_error(failure: OperationFailure) -> AgentError {
    let mut error = AgentError::new(failure.message.clone()).with_name("AgentOperationError");
    error.failure = Some(Box::new(failure));
    error
}

/// The operation failure of an `AgentOperationError`.
pub fn operation_failure(error: &AgentError) -> Option<&OperationFailure> {
    (error.name.as_deref() == Some("AgentOperationError"))
        .then_some(error.failure.as_deref())
        .flatten()
}

/// `new AgentKnownError(code, params)`.
pub fn agent_known_error(code: &str, params: Option<ErrorParams>) -> AgentError {
    let mut error = AgentError::new(code)
        .with_name("AgentKnownError")
        .with_code(code);
    error.params = params;
    error
}

/// The code of an `AgentKnownError`.
pub fn known_error_code(error: &AgentError) -> Option<&str> {
    (error.name.as_deref() == Some("AgentKnownError"))
        .then_some(error.code.as_deref())
        .flatten()
}

/// `createAgentError(code, params)`.
pub fn create_agent_error(code: &str, params: Option<ErrorParams>) -> ErrorDescriptor {
    ErrorDescriptor {
        code: code.into(),
        params: params.unwrap_or_default(),
        ..ErrorDescriptor::default()
    }
}

/// `formatAgentError(error)`.
pub fn format_agent_error(error: &AgentError) -> ErrorDescriptor {
    if let Some(code) = known_error_code(error) {
        return create_agent_error(code, error.params.clone());
    }
    if let Some(failure) = operation_failure(error) {
        return ErrorDescriptor {
            code: "unknown".into(),
            detail: Some(error.message.clone()),
            operation: Some(failure.clone()),
            ..ErrorDescriptor::default()
        };
    }
    // Compatibility with bridges that cannot yet return a structured error.
    if error.message.contains("No handler registered for 'agent:")
        || error.message.contains("Desktop Agent bridge unavailable")
    {
        return create_agent_error("native-bridge-unavailable", None);
    }
    ErrorDescriptor {
        code: "unknown".into(),
        detail: Some(crate::text::head16(&error.message, 32_768).to_string()),
        ..ErrorDescriptor::default()
    }
}

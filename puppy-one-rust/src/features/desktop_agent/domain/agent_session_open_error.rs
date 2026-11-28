//! `domain/agent-session-open-error.ts`: a structured Renderer error
//! preserved through Workbench preparation.
use crate::agent::agent_error::AgentError;
use crate::agent::contract::dto::SessionOpenFailure;

/// `new AgentSessionOpenError({ code, message, retryable })`.
pub fn agent_session_open_error(error: &SessionOpenFailure) -> AgentError {
    let mut opened = AgentError::new(error.message.clone())
        .with_name("AgentSessionOpenError")
        .with_retryable(error.retryable);
    if !error.code.is_empty() {
        opened = opened.with_code(&error.code);
    }
    opened
}

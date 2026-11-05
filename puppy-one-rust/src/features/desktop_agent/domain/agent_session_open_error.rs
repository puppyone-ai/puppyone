//! `domain/agent-session-open-error.ts`: a structured Renderer error
//! preserved through Workbench preparation.
use crate::agent::agent_error::AgentError;
use serde_json::Value;

/// `new AgentSessionOpenError({ code, message, retryable })`.
pub fn agent_session_open_error(error: &Value) -> AgentError {
    let mut opened = AgentError::new(error["message"].as_str().unwrap_or_default())
        .with_name("AgentSessionOpenError")
        .with_retryable(error["retryable"] == true);
    if let Some(code) = error["code"].as_str() {
        opened = opened.with_code(code);
    }
    opened
}

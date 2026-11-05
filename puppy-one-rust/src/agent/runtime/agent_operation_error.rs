//! `runtime/agent-operation-error.mjs`.
use crate::agent::agent_error::AgentError;
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use serde_json::Value;

/// `sanitizeAgentOperationError(value)`.
pub fn sanitize_agent_operation_error(mut error: AgentError) -> AgentError {
    let message = js::head16(&redact_secret_text(&error.message), 4_000).to_string();
    error.message = if message.is_empty() {
        "Agent operation failed.".into()
    } else {
        message
    };
    error
}

/// `agentOperationFailure(value)`: failures cross IPC as plain data.
pub fn agent_operation_failure(error: AgentError) -> Value {
    let error = sanitize_agent_operation_error(error);
    let mut actions: Vec<String> = Vec::new();
    for action in &error.actions {
        if matches!(
            action.as_str(),
            "sign-in" | "refresh" | "learn-more" | "update"
        ) && !actions.contains(action)
        {
            actions.push(action.clone());
        }
    }
    actions.truncate(4);
    let bounded = |value: &Option<String>| {
        value
            .as_ref()
            .map(|v| js::head16(&redact_secret_text(v), 160).to_string())
    };
    let failure = Obj::new()
        .set("schemaVersion", 1)
        .set(
            "code",
            error
                .code
                .as_ref()
                .map(|c| js::head16(c, 160).to_string())
                .unwrap_or_else(|| "AGENT_OPERATION_FAILED".into()),
        )
        .set("message", error.message.clone())
        .set("retryable", error.retryable == Some(true))
        .set("actions", actions)
        .opt("runtimeId", bounded(&error.runtime_id))
        .opt("operation", bounded(&error.operation))
        .opt("stage", bounded(&error.stage))
        .opt("status", bounded(&error.status))
        .build();
    Obj::new().set("agentFailure", failure).build()
}

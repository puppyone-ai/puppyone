//! `runtime/agent-runtime-resolution.mjs`.
use crate::agent::agent_error::AgentError;
use crate::agent::agent_events::redact_secret_text;
use serde_json::Value;

const TRANSIENT_CODES: &[&str] = &[
    "AUTHENTICATION_PROBE_FAILED",
    "AUTHENTICATION_PROBE_CRASHED",
    "AUTHENTICATION_PROBE_TIMED_OUT",
    "AUTHENTICATION_STATUS_UNKNOWN",
    "RUNTIME_DISCOVERY_FAILED",
    "RUNTIME_INSPECTION_FAILED",
    "PROTOCOL_PROBE_FAILED",
];

/// `new AgentRuntimeResolutionError({ runtimeId, operation, stage, readiness, message })`.
pub fn agent_runtime_resolution_error(
    runtime_id: &str,
    operation: &str,
    stage: Option<&str>,
    readiness: &Value,
    message: Option<&str>,
) -> AgentError {
    let text = message
        .filter(|m| !m.is_empty())
        .or_else(|| readiness["message"].as_str().filter(|m| !m.is_empty()))
        .unwrap_or("Agent runtime is not ready.");
    let code = readiness["code"]
        .as_str()
        .filter(|c| !c.is_empty())
        .unwrap_or("RUNTIME_DISCOVERY_FAILED")
        .to_string();
    let mut error =
        AgentError::new(redact_secret_text(text)).with_name("AgentRuntimeResolutionError");
    error.retryable = Some(TRANSIENT_CODES.contains(&code.as_str()));
    error.actions = actions_for(&code).iter().map(|a| a.to_string()).collect();
    error.runtime_id = Some(runtime_id.into());
    error.operation = Some(operation.into());
    error.stage = Some(stage.unwrap_or("inventory").into());
    error.status = Some(
        readiness["status"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("error")
            .into(),
    );
    error.code = Some(code);
    error
}

/// `isAgentRuntimeResolutionError(error)`.
pub fn is_agent_runtime_resolution_error(error: &AgentError) -> bool {
    error.name.as_deref() == Some("AgentRuntimeResolutionError")
}

fn actions_for(code: &str) -> &'static [&'static str] {
    match code {
        "AUTHENTICATION_REQUIRED" | "AUTHENTICATION_EXPIRED" => &["sign-in", "refresh"],
        "RUNTIME_NOT_INSTALLED" => &["learn-more", "refresh"],
        "RUNTIME_VERSION_UNSUPPORTED" | "RUNTIME_VERSION_UNVERIFIED" => &["update", "refresh"],
        _ => &["refresh"],
    }
}

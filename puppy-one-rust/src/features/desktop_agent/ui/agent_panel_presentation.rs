//! `ui/agentPanelPresentation.ts`: runtime readiness and session status
//! wording.
use crate::localization::{Arg, bidi_isolate, t, tf};
use serde_json::Value;

/// `readinessStatusCode(readiness)`.
pub fn readiness_status_code(readiness: Option<&Value>) -> &'static str {
    let Some(readiness) = readiness.filter(|r| r.is_object()) else {
        return "checking";
    };
    match readiness["code"].as_str().unwrap_or_default() {
        "READY" => "ready",
        "RUNTIME_SETUP_REQUIRED"
        | "AUTHENTICATION_REQUIRED"
        | "AUTHENTICATION_EXPIRED"
        | "PROVIDER_CREDENTIALS_REJECTED" => "setup-required",
        _ => "needs-repair",
    }
}

/// `readinessLabel(readiness, t)`.
pub fn readiness_label(readiness: Option<&Value>) -> String {
    t(&format!(
        "agent.header.status.{}",
        readiness_status_code(readiness)
    ))
    .to_string()
}

/// `presentRuntimeReadiness(readiness, runtimeLabel, t)`.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeReadinessPresentation {
    pub code: String,
    pub heading: String,
    pub detail: String,
    pub diagnostic: Option<Value>,
}

pub fn present_runtime_readiness(
    readiness: Option<&Value>,
    runtime_label: &str,
) -> RuntimeReadinessPresentation {
    let code = readiness
        .and_then(|r| r["code"].as_str())
        .unwrap_or("RUNTIME_INSPECTION_FAILED")
        .to_string();
    let agent = [("agent", Arg::Text(bidi_isolate(runtime_label)))];
    let detail = readiness
        .and_then(|r| r["message"].as_str())
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| tf("agent.readiness.inspectFailed", &agent));
    RuntimeReadinessPresentation {
        heading: tf(&format!("agent.readiness.reason.{code}"), &agent),
        detail,
        diagnostic: readiness
            .and_then(|r| r.get("diagnostic"))
            .filter(|d| crate::agent::contract::js::truthy(d))
            .cloned(),
        code,
    }
}

/// `sessionStatusCode(status)`.
pub fn session_status_code(status: Option<&str>) -> String {
    status
        .filter(|s| !s.is_empty())
        .unwrap_or("ready")
        .to_string()
}

/// `sessionStatusLabel(status, t)`.
pub fn session_status_label(status: Option<&str>) -> String {
    t(&format!(
        "agent.turn.status.{}",
        session_status_code(status)
    ))
    .to_string()
}

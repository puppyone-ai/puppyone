//! `ui/agentPanelPresentation.ts`: runtime readiness and session status
//! wording.
use crate::agent::contract::dto::RuntimeReadiness;
use crate::localization::{Arg, bidi_isolate, tf};

/// `readinessStatusCode(readiness)`.
pub fn readiness_status_code(readiness: Option<&RuntimeReadiness>) -> &'static str {
    let Some(readiness) = readiness else {
        return "checking";
    };
    match readiness.code.as_str() {
        "READY" => "ready",
        "RUNTIME_SETUP_REQUIRED"
        | "AUTHENTICATION_REQUIRED"
        | "AUTHENTICATION_EXPIRED"
        | "PROVIDER_CREDENTIALS_REJECTED" => "setup-required",
        _ => "needs-repair",
    }
}

/// `presentRuntimeReadiness(readiness, runtimeLabel, t)`.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeReadinessPresentation {
    pub code: String,
    pub heading: String,
    pub detail: String,
    pub diagnostic: Option<String>,
}

pub fn present_runtime_readiness(
    readiness: Option<&RuntimeReadiness>,
    runtime_label: &str,
) -> RuntimeReadinessPresentation {
    let code = readiness
        .map(|r| r.code.as_str())
        .filter(|code| !code.is_empty())
        .unwrap_or("RUNTIME_INSPECTION_FAILED")
        .to_string();
    let agent = [("agent", Arg::Text(bidi_isolate(runtime_label)))];
    let detail = readiness
        .map(|r| r.message.as_str())
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| tf("agent.readiness.inspectFailed", &agent));
    RuntimeReadinessPresentation {
        heading: tf(&format!("agent.readiness.reason.{code}"), &agent),
        detail,
        diagnostic: readiness
            .and_then(|r| r.diagnostic.clone())
            .filter(|d| !d.is_empty()),
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

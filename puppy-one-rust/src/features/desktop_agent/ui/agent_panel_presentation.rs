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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn readiness(status: &str, code: &str, message: &str) -> RuntimeReadiness {
        serde_json::from_value(serde_json::json!({
            "runtimeId": "cursor", "provider": "cursor", "status": status, "code": code,
            "version": "2026.08.1", "minimumVersion": null, "message": message,
        }))
        .unwrap()
    }

    /// `renders explicit sign-out / status probe failure from the structured
    /// readiness code`; `keeps incompatible runtime recovery product-owned`.
    #[test]
    fn readiness_reads_from_its_structured_code() {
        crate::localization::set_current("en");
        let plain =
            |p: &RuntimeReadinessPresentation| p.heading.replace(['\u{2068}', '\u{2069}'], "");
        let signed_out = present_runtime_readiness(
            Some(&readiness(
                "installed-not-authenticated",
                "AUTHENTICATION_REQUIRED",
                "Structured backend detail.",
            )),
            "Cursor Agent",
        );
        assert_eq!(plain(&signed_out), "Sign in to Cursor Agent");
        assert_eq!(signed_out.code, "AUTHENTICATION_REQUIRED");
        assert_eq!(signed_out.detail, "Structured backend detail.");
        let crashed = present_runtime_readiness(
            Some(&readiness(
                "error",
                "AUTHENTICATION_PROBE_CRASHED",
                "Structured backend detail.",
            )),
            "Cursor Agent",
        );
        assert_eq!(plain(&crashed), "Cursor Agent sign-in check crashed");
        let message = "The configured Agent engine is incompatible with this PuppyOne build. Use PuppyOne's managed engine, then retry.";
        let engine = present_runtime_readiness(
            Some(&readiness(
                "unsupported-version",
                "RUNTIME_VERSION_UNSUPPORTED",
                message,
            )),
            "OpenCode",
        );
        assert_eq!(plain(&engine), "Update OpenCode");
        assert_eq!(engine.detail, message);
        assert_eq!(engine.code, "RUNTIME_VERSION_UNSUPPORTED");
        assert_eq!(
            readiness_status_code(Some(&readiness("x", "AUTHENTICATION_REQUIRED", ""))),
            "setup-required"
        );
        assert_eq!(
            readiness_status_code(Some(&readiness("x", "RUNTIME_VERSION_UNSUPPORTED", ""))),
            "needs-repair"
        );
        assert_eq!(readiness_status_code(None), "checking");
        assert_eq!(
            present_runtime_readiness(None, "Codex").code,
            "RUNTIME_INSPECTION_FAILED"
        );
    }
}

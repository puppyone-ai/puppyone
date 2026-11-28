//! `application/session/agent-session-open-errors.mjs`: provider-specific
//! diagnostics stay behind one bounded product error contract.
use crate::agent::agent_error::AgentError;
use crate::agent::agent_events::redact_secret_text;
use crate::text;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `sessionOpenFailure(code, message, retryable)`.
pub fn session_open_failure(code: &str, message: &str, retryable: bool) -> Value {
    json!({ "status": "failed", "error": { "code": code, "message": message, "retryable": retryable } })
}

macro_rules! pattern {
    ($name:ident, $re:expr) => {
        static $name: LazyLock<Regex> =
            LazyLock::new(|| Regex::new($re).expect("open error pattern"));
    };
}
pattern!(
    AUTH_EXPIRED,
    r"(?i)auth(?:entication)?.{0,24}expired|login.{0,24}expired"
);
pattern!(
    AUTH_REQUIRED,
    r"(?i)sign[ -]?in|log[ -]?in|authentication required|not authenticated"
);
pattern!(TIMED_OUT, r"(?i)timed out|timeout");
pattern!(
    UNSUPPORTED,
    r"(?i)does not support|unsupported.{0,24}(?:resume|load|history)|method not found"
);
pattern!(
    WORKSPACE,
    r"(?i)workspace.{0,32}(?:outside|mismatch|different|assigned)"
);
pattern!(
    RUNTIME,
    r"(?i)not installed|runtime.{0,24}unavailable|executable.{0,24}(?:missing|unavailable)"
);

/// `classifySessionOpenFailure(error)`.
pub fn classify_session_open_failure(error: &AgentError) -> Value {
    let message = text::head16(&redact_secret_text(&error.message), 1_000).to_string();
    let code = error.code.as_deref().unwrap_or("");
    if code == "HISTORY_SOURCE_CHANGED" {
        return session_open_failure(
            "SOURCE_CHANGED",
            "The Agent history source changed. Restore the original profile or refresh History.",
            false,
        );
    }
    if code == "AUTHENTICATION_EXPIRED" || AUTH_EXPIRED.is_match(&message) {
        return session_open_failure(
            "AUTH_EXPIRED",
            "The Agent login has expired. Reconnect the Agent and try again.",
            true,
        );
    }
    if code == "AUTHENTICATION_REQUIRED" || AUTH_REQUIRED.is_match(&message) {
        return session_open_failure(
            "AUTH_REQUIRED",
            "Sign in to this Agent before opening the saved session.",
            true,
        );
    }
    if error.stage.as_deref() == Some("history-read") || code == "HISTORY_READ_FAILED" {
        return session_open_failure(
            "HISTORY_READ_FAILED",
            "History messages could not be loaded. Try again.",
            true,
        );
    }
    if TIMED_OUT.is_match(&message) {
        return session_open_failure(
            "RESUME_TIMED_OUT",
            "Opening the saved Agent session timed out.",
            true,
        );
    }
    if UNSUPPORTED.is_match(&message) {
        return session_open_failure(
            "RESUME_UNSUPPORTED",
            "This Agent cannot restore saved sessions through its current protocol.",
            false,
        );
    }
    if WORKSPACE.is_match(&message) {
        return session_open_failure(
            "WORKSPACE_MISMATCH",
            "This saved session belongs to a different workspace.",
            false,
        );
    }
    if RUNTIME.is_match(&message) {
        return session_open_failure(
            "RUNTIME_UNAVAILABLE",
            "The selected Agent runtime is unavailable on this device.",
            true,
        );
    }
    session_open_failure(
        "PROTOCOL_ERROR",
        if message.is_empty() {
            "The Agent protocol could not restore this session."
        } else {
            &message
        },
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn maps_provider_failures_to_the_closed_public_code_and_retryability_contract() {
        for (error, code, retryable) in [
            (
                AgentError::coded("AUTHENTICATION_EXPIRED", "expired"),
                "AUTH_EXPIRED",
                true,
            ),
            (
                AgentError::coded("AUTHENTICATION_REQUIRED", "required"),
                "AUTH_REQUIRED",
                true,
            ),
            (
                AgentError::new("resume request timed out"),
                "RESUME_TIMED_OUT",
                true,
            ),
            (
                AgentError::new("session/resume method not found"),
                "RESUME_UNSUPPORTED",
                false,
            ),
            (
                AgentError::new("workspace reference is outside the assigned root"),
                "WORKSPACE_MISMATCH",
                false,
            ),
            (
                AgentError::new("runtime executable is missing"),
                "RUNTIME_UNAVAILABLE",
                true,
            ),
            (
                AgentError::new("unexpected protocol response"),
                "PROTOCOL_ERROR",
                true,
            ),
            (
                AgentError::coded("HISTORY_SOURCE_CHANGED", "private profile path"),
                "SOURCE_CHANGED",
                false,
            ),
            (
                AgentError::coded("HISTORY_READ_FAILED", "private history path"),
                "HISTORY_READ_FAILED",
                true,
            ),
        ] {
            let failure = classify_session_open_failure(&error);
            assert_eq!(failure["status"], "failed", "{error:?}");
            assert_eq!(failure["error"]["code"], code, "{error:?}");
            assert_eq!(failure["error"]["retryable"], retryable, "{error:?}");
            assert_eq!(failure["error"].as_object().unwrap().len(), 3);
            assert!(!failure["error"]["message"].as_str().unwrap().is_empty());
        }
    }

    #[test]
    fn constructs_the_exact_public_failure_envelope() {
        assert_eq!(
            session_open_failure("SESSION_NOT_FOUND", "Gone", false),
            json!({
                "status": "failed",
                "error": {"code": "SESSION_NOT_FOUND", "message": "Gone", "retryable": false},
            })
        );
    }
}

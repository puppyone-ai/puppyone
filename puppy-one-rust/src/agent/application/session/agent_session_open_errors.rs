//! `application/session/agent-session-open-errors.mjs`: provider-specific
//! diagnostics stay behind one bounded product error contract.
use crate::agent::agent_error::AgentError;
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js;
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
    let message = js::head16(&redact_secret_text(&error.message), 1_000).to_string();
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

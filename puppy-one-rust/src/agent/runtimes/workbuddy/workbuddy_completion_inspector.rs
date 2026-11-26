//! `runtimes/workbuddy/workbuddy-completion-inspector.mjs`: WorkBuddy reports
//! prompt-level failures (such as expired or unreadable credentials) by
//! resolving ACP `session/prompt` with `stopReason: "refusal"` and embedding a
//! serialized RPC error payload in `_meta["codebuddy.ai/errorMessage"]`.
//! Parsing that provider-specific envelope stays at the WorkBuddy boundary so
//! generic ACP and Renderer code never depend on `codebuddy.ai/*` internals.
use crate::agent::agent_error::AgentResult;
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::Obj;
use crate::agent::protocols::acp::acp_runtime_adapter::CompletionInspector;
use crate::text;
use serde_json::{Value, json};

const ERROR_MESSAGE_META_KEY: &str = "codebuddy.ai/errorMessage";
const MAX_MESSAGE_CHARS: usize = 1_000;
const MAX_DIAGNOSTIC_CHARS: usize = 512;

/// `createWorkBuddyCompletionInspector()`.
#[derive(Default)]
pub struct WorkBuddyCompletionInspector;

fn non_empty_trimmed(value: Option<&Value>, limit: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| text::head16(s, limit).to_string())
}

fn is_auth_failure(category: Option<&str>, message: &str, rpc_code: Option<i64>) -> bool {
    if category.is_some_and(|c| c.eq_ignore_ascii_case("auth")) {
        return true;
    }
    let lower = message.to_lowercase();
    rpc_code == Some(-32000)
        && (lower.contains("authentication")
            || lower.contains("sign in")
            || lower.contains("/login"))
}

fn parse_error_envelope(raw: &Value) -> Option<(String, &'static str, Option<String>)> {
    let parsed = match raw {
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(Value::Object(map)) => Value::Object(map),
                _ => {
                    let message = redact_secret_text(text::head16(trimmed, MAX_MESSAGE_CHARS));
                    let code = if is_auth_failure(None, &message, None) {
                        "AUTHENTICATION_REQUIRED"
                    } else {
                        "WORKBUDDY_PROMPT_REFUSED"
                    };
                    return Some((message, code, None));
                }
            }
        }
        Value::Object(_) => raw.clone(),
        _ => return None,
    };

    let data = parsed.get("data").filter(|v| v.is_object());
    let category = data
        .and_then(|d| non_empty_trimmed(d.get("category"), 64))
        .or_else(|| non_empty_trimmed(parsed.get("category"), 64));
    let rpc_code = parsed.get("code").and_then(Value::as_i64);
    let http_status = data
        .and_then(|d| d.get("statusCode"))
        .and_then(Value::as_i64);
    let biz_code = data.and_then(|d| {
        d.get("code")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| d.get("code").and_then(Value::as_i64).map(|n| n.to_string()))
    });
    let message = non_empty_trimmed(parsed.get("message"), MAX_MESSAGE_CHARS)
        .or_else(|| data.and_then(|d| non_empty_trimmed(d.get("message"), MAX_MESSAGE_CHARS)))?;
    let redacted = redact_secret_text(&message);
    let failure_code = if is_auth_failure(category.as_deref(), &redacted, rpc_code) {
        "AUTHENTICATION_REQUIRED"
    } else {
        "WORKBUDDY_PROMPT_REFUSED"
    };

    let mut parts: Vec<String> = Vec::new();
    if let Some(category) = category {
        parts.push(format!("category={category}"));
    }
    if let Some(code) = rpc_code {
        parts.push(format!("rpcCode={code}"));
    }
    if let Some(status) = http_status {
        parts.push(format!("httpStatus={status}"));
    }
    if let Some(biz) = biz_code.filter(|b| !b.is_empty()) {
        parts.push(format!("bizCode={biz}"));
    }
    let diagnostic = (!parts.is_empty()).then(|| {
        redact_secret_text(text::head16(&parts.join(", "), MAX_DIAGNOSTIC_CHARS))
    });
    Some((redacted, failure_code, diagnostic))
}

impl CompletionInspector for WorkBuddyCompletionInspector {
    fn observe(&self, _notification: &Value) -> AgentResult<()> {
        Ok(())
    }

    fn complete(&self, payload: &Value) -> AgentResult<Option<Value>> {
        let Some(response) = payload.get("response").filter(|v| v.is_object()) else {
            return Ok(None);
        };
        if response.get("stopReason").and_then(Value::as_str) != Some("refusal") {
            return Ok(None);
        }
        let meta_error = response
            .get("_meta")
            .and_then(|meta| meta.get(ERROR_MESSAGE_META_KEY));
        if let Some((message, failure_code, diagnostic)) = meta_error.and_then(parse_error_envelope)
        {
            return Ok(Some(
                Obj::new()
                    .set("errorMessage", message)
                    .set("failureCode", failure_code)
                    .opt("diagnostic", diagnostic)
                    .build(),
            ));
        }
        Ok(Some(json!({
            "failureCode": "WORKBUDDY_PROMPT_REFUSED",
        })))
    }
}

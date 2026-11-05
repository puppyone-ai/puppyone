//! `runtimes/cursor/cursor-completion-inspector.mjs`: Cursor has emitted
//! its upstream HTTP/2 cancel both as a structured tool result and as the
//! entire final assistant message. This exact compatibility signature stays
//! at the provider boundary; generic ACP and Renderer code never parse prose.
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js;
use crate::agent::protocols::acp::acp_runtime_adapter::CompletionInspector;
use regex::Regex;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::sync::LazyLock;

const HTTP2_CANCEL_CODE: &str = "CURSOR_HTTP2_STREAM_CANCEL";
const MAX_ASSISTANT_TEXT: usize = 8 * 1024;
const MAX_SCAN_NODES: usize = 256;

static HTTP2_CANCEL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:Error:\s*)?(?:RetriableError:\s*)?\[canceled\]\s+http/2 stream closed with error code CANCEL \(0x8\)\s*$")
        .expect("cancel pattern")
});
static AGENT_OR_TASK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(agent|task)\b").expect("pattern"));
static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));
const SCANNED_KEYS: &[&str] = &[
    "error",
    "output",
    "result",
    "rawOutput",
    "content",
    "text",
    "providerOptions",
    "cursor",
    "highLevelToolCallResult",
];

/// `createCursorCompletionInspector()`.
#[derive(Default)]
pub struct CursorCompletionInspector {
    assistant_messages: RefCell<Vec<(String, String)>>,
    structured_failure: RefCell<Option<Value>>,
    observed_tool_activity: Cell<bool>,
}

fn degraded_completion(failure_scope: &str, side_effects: &str) -> Value {
    json!({
        "completionQuality": "degraded",
        "failureScope": failure_scope,
        "failureCode": HTTP2_CANCEL_CODE,
        "retryable": true,
        "transportHealth": "healthy",
        "sideEffects": side_effects,
        "diagnostic": "Cursor upstream HTTP/2 stream ended with CANCEL (0x8).",
    })
}

fn find_known_failure(value: Option<&Value>) -> Option<String> {
    let mut queue: VecDeque<&Value> = value.into_iter().collect();
    let mut visited = 0;
    while let Some(current) = queue.pop_front() {
        if visited >= MAX_SCAN_NODES {
            break;
        }
        visited += 1;
        match current {
            Value::String(text) => {
                let candidate = text.trim();
                if HTTP2_CANCEL_PATTERN.is_match(candidate) {
                    return Some(candidate.to_string());
                }
            }
            Value::Array(entries) => queue.extend(entries.iter().take(64)),
            Value::Object(map) => queue.extend(
                map.iter()
                    .take(64)
                    .filter(|(key, _)| SCANNED_KEYS.contains(&key.as_str()))
                    .map(|(_, entry)| entry),
            ),
            _ => {}
        }
    }
    None
}

fn normalized_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(|text| js::head16(text, 300).to_string())
        .unwrap_or_default()
}

impl CompletionInspector for CursorCompletionInspector {
    fn observe(&self, notification: &Value) -> AgentResult<()> {
        let Some(update) = notification.get("update").filter(|u| u.is_object()) else {
            return Ok(());
        };
        match update.get("sessionUpdate").and_then(Value::as_str) {
            Some("agent_message_chunk") => {
                let id = update
                    .get("messageId")
                    .and_then(Value::as_str)
                    .filter(|id| SAFE_ID.is_match(id))
                    .unwrap_or("cursor-assistant")
                    .to_string();
                let content = update.get("content");
                let delta = match content {
                    Some(content)
                        if content.get("type").and_then(Value::as_str) == Some("text") =>
                    {
                        content.get("text").and_then(Value::as_str).unwrap_or("")
                    }
                    _ => "",
                };
                if !delta.is_empty() {
                    let mut messages = self.assistant_messages.borrow_mut();
                    match messages.iter_mut().find(|(message, _)| *message == id) {
                        Some((_, text)) => {
                            let remaining = MAX_ASSISTANT_TEXT.saturating_sub(js::len16(text));
                            if remaining > 0 {
                                text.push_str(js::head16(delta, remaining));
                            }
                        }
                        None => {
                            messages.push((id, js::head16(delta, MAX_ASSISTANT_TEXT).to_string()))
                        }
                    }
                }
            }
            Some("tool_call" | "tool_call_update") => {
                self.observed_tool_activity.set(true);
                if find_known_failure(update.get("rawOutput"))
                    .or_else(|| find_known_failure(update.get("content")))
                    .is_none()
                {
                    return Ok(());
                }
                let kind = normalized_text(update.get("kind")).to_lowercase();
                let title = normalized_text(update.get("title")).to_lowercase();
                let scope = if kind == "task" || AGENT_OR_TASK.is_match(&title) {
                    "child-task"
                } else {
                    "tool"
                };
                *self.structured_failure.borrow_mut() =
                    Some(degraded_completion(scope, "possible"));
            }
            _ => {}
        }
        Ok(())
    }

    fn complete(&self, _response: &Value) -> AgentResult<Option<Value>> {
        if let Some(failure) = self.structured_failure.borrow().clone() {
            return Ok(Some(failure));
        }
        let messages = self.assistant_messages.borrow();
        let last = messages.last().map(|(_, text)| text.trim()).unwrap_or("");
        if !HTTP2_CANCEL_PATTERN.is_match(last) {
            return Ok(None);
        }
        let side_effects = if self.observed_tool_activity.get() {
            "possible"
        } else {
            "none"
        };
        Ok(Some(degraded_completion("upstream-request", side_effects)))
    }
}

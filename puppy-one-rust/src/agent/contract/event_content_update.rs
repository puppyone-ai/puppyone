//! `shared/agent-contract/event-content-update.mjs`: canonical text mutation
//! semantics shared by live projection and replay checkpointing. Adapters
//! describe facts; consumers do not reinterpret them.
use super::js;
use crate::text;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateMode {
    Append,
    Replace,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentUpdate {
    /// The payload field carrying the text (`delta` or `text`).
    pub field: &'static str,
    pub mode: UpdateMode,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppliedContentUpdate {
    pub field: &'static str,
    pub mode: UpdateMode,
    pub text: String,
    pub truncated: bool,
}

fn payload<'a>(event: &'a Value, key: &str) -> Option<&'a Value> {
    js::get(event, "payload").and_then(|p| js::get(p, key))
}

/// `agentEventContentUpdate(event)`.
pub fn agent_event_content_update(event: &Value) -> Option<ContentUpdate> {
    let replace_when = |key: &str, value: &str| payload(event, key) == Some(&Value::from(value));
    match js::str_or_empty(js::get(event, "type")) {
        "assistant.delta" => Some(ContentUpdate {
            field: "delta",
            mode: UpdateMode::Append,
        }),
        "reasoning.summary.delta" | "command.output.delta" => Some(ContentUpdate {
            field: "delta",
            mode: if replace_when("updateMode", "replace") {
                UpdateMode::Replace
            } else {
                UpdateMode::Append
            },
        }),
        "plan.updated" => Some(ContentUpdate {
            field: "text",
            mode: if replace_when("updateMode", "append")
                || payload(event, "streaming") == Some(&Value::Bool(true))
            {
                UpdateMode::Append
            } else {
                UpdateMode::Replace
            },
        }),
        _ => None,
    }
}

/// `applyAgentEventContentUpdate(current, event, limit)`: one canonical
/// content mutation with the same bounded semantics everywhere.
pub fn apply_agent_event_content_update(
    current: Option<&str>,
    event: &Value,
    limit: Option<usize>,
) -> Option<AppliedContentUpdate> {
    let update = agent_event_content_update(event)?;
    let existing = current.unwrap_or("");
    let incoming = js::str_or_empty(payload(event, update.field));
    let combined = match update.mode {
        UpdateMode::Replace => incoming.to_string(),
        UpdateMode::Append => format!("{existing}{incoming}"),
    };
    let length = text::len16(&combined);
    let bounded = limit.unwrap_or(length);
    Some(AppliedContentUpdate {
        field: update.field,
        mode: update.mode,
        text: text::head16(&combined, bounded).to_string(),
        truncated: length > bounded,
    })
}

//! `runtimes/codex/codex-history-projection.mjs`: a restored Codex thread
//! as adapter events.
use super::codex_events::{
    normalize_item_lifecycle, normalize_turn_status, read_codex_user_message_text,
};
use super::codex_native_values::{string_or_null, string_or_null_value};
use crate::agent::contract::js::Obj;
use serde_json::{Value, json};

/// `normalizeHistoricalThread(thread)`.
pub fn normalize_historical_thread(thread: &Value) -> Vec<Value> {
    let mut events = Vec::new();
    let Some(turns) = thread.get("turns").and_then(Value::as_array) else {
        return events;
    };
    let thread_id = thread.get("id").cloned().unwrap_or(Value::Null);
    for turn in turns {
        let turn_id = string_or_null_value(turn.get("id"));
        let items = turn
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        // turn.started retains the first prompt for older projection consumers.
        // Every native user item is also normalized below with its own identity;
        // follow-ups must never be flattened into the initial turn prompt.
        let first_user_message = items
            .iter()
            .find(|item| item.get("type").and_then(Value::as_str) == Some("userMessage"));
        let prompt = read_codex_user_message_text(first_user_message);
        let user_message_id = first_user_message.and_then(|m| string_or_null(m.get("id")));
        events.push(json!({
            "type": "turn.started",
            "providerSessionId": thread_id,
            "turnId": turn_id,
            "payload": Obj::new()
                .set("status", "running")
                .set("restored", true)
                .opt("prompt", (!prompt.is_empty()).then_some(prompt))
                .opt("userMessageId", user_message_id)
                .build(),
        }));
        for item in &items {
            events.extend(normalize_item_lifecycle(
                Some(item),
                "completed",
                &thread_id,
                &turn_id,
            ));
        }
        let status = turn.get("status").and_then(Value::as_str);
        if let Some(kind) = historical_terminal_event_type(status) {
            events.push(json!({
                "type": kind,
                "providerSessionId": thread_id,
                "turnId": turn_id,
                "payload": { "status": normalize_turn_status(status), "restored": true },
            }));
        }
    }
    events
}

/// `historicalTerminalEventType(status)`.
pub fn historical_terminal_event_type(status: Option<&str>) -> Option<&'static str> {
    match status {
        Some("completed") => Some("turn.completed"),
        Some("failed") => Some("turn.failed"),
        Some("interrupted") => Some("turn.interrupted"),
        _ => None,
    }
}

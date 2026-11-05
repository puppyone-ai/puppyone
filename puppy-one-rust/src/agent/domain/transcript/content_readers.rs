//! `transcript/content-readers.mjs`: bounded readers of native payload
//! content.
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::agent::migrations::legacy_file_change_evidence::legacy_file_change_evidence;
use serde_json::{Map, Value};

const ACTIVITY_STATUS_ALIASES: &[(&str, &str)] = &[
    ("queued", "queued"),
    ("running", "running"),
    ("pending", "pending"),
    ("in-progress", "in-progress"),
    ("in_progress", "in-progress"),
    ("working", "running"),
    ("waiting-for-user", "waiting-for-user"),
    ("waiting_for_user", "waiting-for-user"),
    ("completed", "completed"),
    ("complete", "completed"),
    ("done", "completed"),
    ("success", "succeeded"),
    ("succeeded", "succeeded"),
    ("failed", "failed"),
    ("failure", "failed"),
    ("error", "failed"),
    ("warning", "warning"),
    ("blocked", "blocked"),
    ("cancelled", "cancelled"),
    ("canceled", "cancelled"),
    ("interrupted", "interrupted"),
];

/// `normalizeAgentActivityStatus(value, fallback)`.
pub fn normalize_agent_activity_status(value: Option<&Value>, fallback: &str) -> String {
    let normalized = value
        .and_then(Value::as_str)
        .map(|s| js::trim(s).to_lowercase())
        .unwrap_or_default();
    if normalized.is_empty() {
        return fallback.to_string();
    }
    ACTIVITY_STATUS_ALIASES
        .iter()
        .find(|(alias, _)| *alias == normalized)
        .map_or("unknown", |(_, status)| *status)
        .to_string()
}

/// `readQuestions(value)`.
pub fn read_questions(value: Option<&Value>) -> Value {
    let Some(entries) = value.and_then(Value::as_array) else {
        return Value::Array(Vec::new());
    };
    Value::Array(
        entries
            .iter()
            .take(8)
            .filter(|entry| entry.is_object())
            .filter_map(|record| {
                let question = js::head16(js::str_or_empty(record.get("question")), 2_000);
                if question.is_empty() {
                    return None;
                }
                let options: Vec<Value> = record
                    .get("options")
                    .and_then(Value::as_array)
                    .map(|options| {
                        options
                            .iter()
                            .take(20)
                            .filter(|option| option.is_object())
                            .filter_map(|item| {
                                let label = js::head16(js::str_or_empty(item.get("label")), 200);
                                (!label.is_empty()).then(|| {
                                    Obj::new()
                                        .set("label", label)
                                        .set(
                                            "description",
                                            js::head16(
                                                js::str_or_empty(item.get("description")),
                                                600,
                                            ),
                                        )
                                        .build()
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Some(
                    Obj::new()
                        .set(
                            "header",
                            js::head16(js::str_or_empty(record.get("header")), 80),
                        )
                        .set("question", question)
                        .set("multiple", js::truthy_opt(record.get("multiple")))
                        .set("custom", record.get("custom") != Some(&Value::Bool(false)))
                        .set("options", options)
                        .build(),
                )
            })
            .collect(),
    )
}

/// `pickUsage(payload)`.
pub fn pick_usage(payload: &Value) -> Value {
    let mut usage = Map::new();
    for key in [
        "inputTokens",
        "outputTokens",
        "cachedTokens",
        "cost",
        "contextWindow",
        "tokens",
    ] {
        if let Some(value) = payload.get(key).filter(|v| js::finite_number(v).is_some()) {
            usage.insert(key.into(), value.clone());
        }
    }
    Value::Object(usage)
}

const SAFE_DETAIL_KEYS: &[&str] = &[
    "category",
    "severity",
    "source",
    "command",
    "cwd",
    "delta",
    "text",
    "explanation",
    "updateMode",
    "summaryIndex",
    "status",
    "kind",
    "tool",
    "description",
    "path",
    "query",
    "changes",
    "steps",
    "title",
    "message",
    "input",
    "result",
    "outputPreview",
    "error",
    "content",
    "detail",
    "metadata",
    "recoverable",
    "truncated",
    "exitCode",
    "duration",
    "durationMs",
    "elapsedMs",
    "diff",
    "patch",
    "outputPaths",
];

/// `pickSafeActivityDetail(payload)`.
pub fn pick_safe_activity_detail(payload: &Value) -> Value {
    let mut detail = Map::new();
    let legacy_changes = legacy_file_change_evidence(payload);
    for key in SAFE_DETAIL_KEYS {
        if let Some(value) = payload.get(*key) {
            detail.insert((*key).into(), bound_projection_value(value, 0));
        }
    }
    // Older adapters emitted structured tool arguments under `arguments`.
    // Normalize that compatibility shape into the canonical `input` field.
    if !detail.contains_key("input")
        && let Some(arguments) = payload.get("arguments")
    {
        detail.insert("input".into(), bound_projection_value(arguments, 0));
    }
    if let Some(changes) = legacy_changes {
        detail.insert(
            "changes".into(),
            bound_projection_value(&Value::Array(changes), 0),
        );
    }
    Value::Object(detail)
}

/// `activityId(event)`.
pub fn activity_id(event: &Value) -> String {
    let sequence = event.sequence().to_string();
    let native_identity = event
        .item_id()
        .or(event.turn_id())
        .unwrap_or(event.event_type())
        .to_string();
    match event.event_type() {
        "provider.notification" => format!(
            "notification:{}:{}",
            event.turn_id().unwrap_or("session"),
            event.item_id().unwrap_or(&sequence)
        ),
        "provider.activity" => format!(
            "system:{}:{native_identity}",
            event.turn_id().unwrap_or("session")
        ),
        "reasoning.summary.delta" => format!(
            "activity:{native_identity}:summary:{}",
            event
                .field("summaryIndex")
                .and_then(js::safe_integer)
                .unwrap_or(0)
        ),
        _ => format!("activity:{native_identity}"),
    }
}

/// `readProviderMessage(value)`: makes already-persisted provider errors
/// readable without trusting raw HTML or object shapes.
pub fn read_provider_message(value: Option<&Value>) -> String {
    read_provider_message_at(value, 0)
}

fn read_provider_message_at(value: Option<&Value>, depth: usize) -> String {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return String::new();
    };
    if depth > 4 {
        return String::new();
    }
    if let Some(text) = value.as_str() {
        let text = js::trim(text);
        if text.is_empty() {
            return String::new();
        }
        let json_shaped = (text.starts_with('{') && text.ends_with('}'))
            || (text.starts_with('[') && text.ends_with(']'));
        if json_shaped && let Ok(parsed) = serde_json::from_str::<Value>(text) {
            let nested = read_provider_message_at(Some(&parsed), depth + 1);
            if !nested.is_empty() {
                return nested;
            }
        }
        return js::head16(text, 32_768).to_string();
    }
    if !value.is_object() {
        return String::new();
    }
    let error_message = value.get("error").and_then(|e| e.get("message"));
    [error_message, value.get("message"), value.get("error")]
        .into_iter()
        .map(|candidate| read_provider_message_at(candidate, depth + 1))
        .find(|text| !text.is_empty())
        .unwrap_or_default()
}

/// `nullableString(value)`.
pub fn nullable_string(value: Option<&Value>) -> Value {
    let text = js::str_or_empty(value);
    if text.is_empty() {
        Value::Null
    } else {
        Value::from(text)
    }
}

/// `readRecordArray(value)`.
pub fn read_record_array(value: Option<&Value>) -> Value {
    Value::Array(
        value
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|e| e.is_object())
                    .take(20)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default(),
    )
}

/// `readNetworkApprovalContext(value)`.
pub fn read_network_approval_context(value: Option<&Value>) -> Value {
    let Some(record) = value.filter(|v| v.is_object()) else {
        return Value::Null;
    };
    let host = js::trim(js::str_or_empty(record.get("host")));
    let protocol = js::trim(js::str_or_empty(record.get("protocol")));
    if host.is_empty() || protocol.is_empty() {
        return Value::Null;
    }
    Obj::new()
        .set("host", host)
        .set("protocol", protocol)
        .build()
}

/// `defaultToolLabelCode(kind)`.
pub fn default_tool_label_code(kind: &str) -> &'static str {
    match kind {
        "command" => "command",
        "file-change" => "file-changes",
        _ => "tool-activity",
    }
}

/// `fileChangeLabelCode(payload)`.
pub fn file_change_label_code(_payload: &Value) -> &'static str {
    "file-changes"
}

/// `readApprovalDecisions(value)`.
pub fn read_approval_decisions(value: Option<&Value>) -> Value {
    const DEFAULT: [&str; 3] = ["accept", "decline", "cancel"];
    let Some(entries) = value.and_then(Value::as_array) else {
        return Value::from(DEFAULT.to_vec());
    };
    let decisions: Vec<Value> = entries
        .iter()
        .filter(|e| {
            matches!(
                e.as_str(),
                Some("accept" | "acceptForSession" | "decline" | "cancel")
            )
        })
        .cloned()
        .collect();
    if decisions.is_empty() {
        Value::from(DEFAULT.to_vec())
    } else {
        Value::Array(decisions)
    }
}

fn bound_projection_value(value: &Value, depth: usize) -> Value {
    if depth > 4 {
        return Value::from("[truncated]");
    }
    match value {
        Value::String(text) => Value::from(js::head16(text, 64 * 1024)),
        Value::Array(entries) => Value::Array(
            entries
                .iter()
                .take(100)
                .map(|e| bound_projection_value(e, depth + 1))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .take(40)
                .map(|(key, entry)| {
                    (
                        js::head16(key, 100).to_string(),
                        bound_projection_value(entry, depth + 1),
                    )
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

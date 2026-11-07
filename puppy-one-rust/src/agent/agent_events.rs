//! `electron/main/agent/agent-events.mjs`: the canonical event envelope Main
//! commits, with every payload bounded and stripped of secrets first.
use crate::agent::contract::display_schema::limits as display_limits;
use crate::agent::contract::event_schema::{
    assert_agent_event_envelope, sanitize_agent_event_payload,
};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::validation::{Contract, type_error};
use crate::clock;
use crate::text;
use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

static SECRET_PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"(?-u:\b)sk-[A-Za-z0-9_-]{12,}(?-u:\b)", "[redacted]"),
        (r"(?i)(?-u:\b)(Bearer\s+)[A-Za-z0-9._~+/-]{12,}", "${1}[redacted]"),
        (
            r"(?i)(?-u:\b)(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|token|authorization|password|client[_-]?secret|secret[_-]?access[_-]?key|private[_-]?key)(\s*[:=]\s*)[^\s,;]+",
            "${1}${2}[redacted]",
        ),
        (
            r"(?-u:\b)([A-Z][A-Z0-9_]*(?:_API_KEY|_ACCESS_TOKEN|_REFRESH_TOKEN|_AUTH_TOKEN|_ID_TOKEN|_SESSION_TOKEN|_CLIENT_SECRET|_SECRET_ACCESS_KEY|_PRIVATE_KEY|_PASSWORD|_CREDENTIALS?))(\s*=\s*)[^\s,;]+",
            "${1}${2}[redacted]",
        ),
        (r"(?-u:\b)AIza[0-9A-Za-z_-]{20,}(?-u:\b)", "[redacted]"),
        (r"(?-u:\b)gh[pousr]_[A-Za-z0-9]{20,}(?-u:\b)", "[redacted]"),
    ]
    .into_iter()
    .map(|(pattern, replacement)| (Regex::new(pattern).expect("secret pattern"), replacement))
    .collect()
});

const SECRET_OBJECT_KEYS: &[&str] = &[
    "token",
    "apikey",
    "accesstoken",
    "refreshtoken",
    "authtoken",
    "idtoken",
    "sessiontoken",
    "authorization",
    "password",
    "clientsecret",
    "secretaccesskey",
    "privatekey",
    "secret",
    "credential",
    "credentials",
    "cookie",
    "setcookie",
];

/// `agentRendererValueLimits`.
pub mod limits {
    pub const MAX_DEPTH: usize = 12;
    pub const MAX_COLLECTION_ENTRIES: usize = 200;
    pub const MAX_NODES: i64 = 4_096;
    pub const MAX_TOTAL_TEXT: i64 = 256 * 1024;
}

/// `isAgentEventEnvelope(value)`.
pub fn is_agent_event_envelope(value: &Value) -> bool {
    assert_agent_event_envelope(value).is_ok()
}

/// What an adapter or the actor reports, before Main numbers and checks it.
#[derive(Clone, Debug, Default)]
pub struct EnvelopeInput {
    pub sequence: i64,
    pub session_id: String,
    pub runtime_id: String,
    pub provider_session_id: Option<String>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub event_type: String,
    pub payload: Value,
    pub emitted_at: Option<String>,
}

/// `createAgentEventEnvelope(input)`.
pub fn create_agent_event_envelope(input: EnvelopeInput) -> Contract<Value> {
    let payload = if input.payload.is_object() {
        input.payload
    } else {
        Value::Object(Map::new())
    };
    let event = Obj::new()
        .set("schemaVersion", 1)
        .set("sequence", input.sequence)
        .set("sessionId", input.session_id)
        .set("runtimeId", input.runtime_id.clone())
        // `provider` remains as a compatibility alias for v1 journals and older
        // renderer projections. New code should use runtimeId.
        .set("provider", input.runtime_id)
        .set("providerSessionId", input.provider_session_id)
        .set("turnId", input.turn_id)
        .set("itemId", input.item_id)
        .set("emittedAt", input.emitted_at.unwrap_or_else(clock::now_iso))
        .set("type", input.event_type.clone())
        .set(
            "payload",
            normalize_display_payload(&input.event_type, &payload)
                .map_err(|_| invalid(&input.event_type))?,
        )
        .build();
    if !is_agent_event_envelope(&event) {
        return Err(invalid(&input.event_type));
    }
    Ok(event)
}

fn invalid(event_type: &str) -> crate::agent::contract::ContractError {
    type_error(format!("Invalid normalized AgentEvent: {event_type}"))
}

fn normalize_display_payload(event_type: &str, payload: &Value) -> Contract<Value> {
    let field = match event_type {
        "assistant.completed" => "text",
        "assistant.delta" => "delta",
        _ => {
            return sanitize_agent_event_payload(
                event_type,
                &redact_secrets(&bound_renderer_value(payload)),
            );
        }
    };
    let Some(content) = payload.get(field).and_then(Value::as_str) else {
        return sanitize_agent_event_payload(
            event_type,
            &redact_secrets(&bound_renderer_value(payload)),
        );
    };
    let mut metadata = payload.clone();
    js::delete(&mut metadata, field);
    let text = redact_secret_text(content);
    // Text completeness is explicit. A generic metadata preview must never
    // silently become an authoritative replacement for an accumulated answer.
    let truncated = payload.get("truncated") == Some(&Value::Bool(true))
        || text::len16(&text) > display_limits::MAX_TEXT;
    let mut object = Obj::from(&redact_secrets(&bound_renderer_value(&metadata)))
        .set(field, text::head16(&text, display_limits::MAX_TEXT));
    if truncated {
        object.insert("truncated", true);
    }
    sanitize_agent_event_payload(event_type, &object.build())
}

/// `redactSecrets(value)`.
pub fn redact_secrets(value: &Value) -> Value {
    redact_at(value, 0)
}

fn redact_at(value: &Value, depth: usize) -> Value {
    if depth > 12 {
        return Value::from("[truncated]");
    }
    match value {
        Value::String(text) => Value::String(redact_secret_text(text)),
        Value::Array(entries) => {
            Value::Array(entries.iter().map(|e| redact_at(e, depth + 1)).collect())
        }
        Value::Object(map) => {
            let mut next = Map::new();
            for (key, entry) in map {
                if is_unsafe_object_key(key) {
                    continue;
                }
                let redacted = if is_secret_object_key(key) {
                    Value::from("[redacted]")
                } else {
                    redact_at(entry, depth + 1)
                };
                next.insert(key.clone(), redacted);
            }
            Value::Object(next)
        }
        other => other.clone(),
    }
}

fn is_secret_object_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_lowercase();
    SECRET_OBJECT_KEYS.contains(&normalized.as_str())
}

/// `redactSecretText(value)`.
pub fn redact_secret_text(value: &str) -> String {
    let mut output = value.to_string();
    for (pattern, replacement) in SECRET_PATTERNS.iter() {
        if pattern.is_match(&output) {
            output = pattern.replace_all(&output, *replacement).into_owned();
        }
    }
    output
}

struct Budget {
    remaining_text: i64,
    remaining_nodes: i64,
}

/// `boundRendererValue(value)`.
pub fn bound_renderer_value(value: &Value) -> Value {
    bound_renderer_value_with(value, 32 * 1024)
}

/// `boundRendererValue(value, maxStringLength)`.
pub fn bound_renderer_value_with(value: &Value, max_string_length: usize) -> Value {
    let mut budget = Budget {
        remaining_text: limits::MAX_TOTAL_TEXT,
        remaining_nodes: limits::MAX_NODES,
    };
    bound_with_state(value, max_string_length, 0, &mut budget)
}

fn bound_with_state(
    value: &Value,
    max_string_length: usize,
    depth: usize,
    state: &mut Budget,
) -> Value {
    if depth > limits::MAX_DEPTH || state.remaining_nodes <= 0 {
        return Value::from("[truncated]");
    }
    state.remaining_nodes -= 1;
    match value {
        Value::String(text) => {
            let length = text::len16(text) as i64;
            let visible = length
                .min(max_string_length as i64)
                .min(state.remaining_text)
                .max(0);
            state.remaining_text -= visible;
            if visible == length {
                return value.clone();
            }
            let separator = if visible > 0 { "\n" } else { "" };
            Value::String(format!(
                "{}{separator}… output truncated",
                text::head16(text, visible as usize)
            ))
        }
        Value::Array(entries) => {
            let mut next = Vec::new();
            for entry in entries.iter().take(limits::MAX_COLLECTION_ENTRIES) {
                if state.remaining_nodes <= 0 || state.remaining_text <= 0 {
                    next.push(Value::from("[truncated]"));
                    break;
                }
                next.push(bound_with_state(entry, max_string_length, depth + 1, state));
            }
            Value::Array(next)
        }
        Value::Object(map) => {
            let mut next = Map::new();
            for (key, entry) in map.iter().take(limits::MAX_COLLECTION_ENTRIES) {
                if is_unsafe_object_key(key) {
                    continue;
                }
                if state.remaining_nodes <= 0 || state.remaining_text <= 0 {
                    next.insert("…".into(), Value::from("[truncated]"));
                    break;
                }
                next.insert(
                    key.clone(),
                    bound_with_state(entry, max_string_length, depth + 1, state),
                );
            }
            Value::Object(next)
        }
        other => other.clone(),
    }
}

fn is_unsafe_object_key(key: &str) -> bool {
    matches!(key, "__proto__" | "prototype" | "constructor")
}

/// `countTextBytes(value)`.
pub fn count_text_bytes(value: &Value) -> usize {
    js::json_byte_length(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn secrets_are_redacted_in_text_and_keys() {
        assert_eq!(
            redact_secret_text("key sk-abcdefghijklmnop and Bearer abcdefghijklmnopq"),
            "key [redacted] and Bearer [redacted]"
        );
        assert_eq!(
            redact_secret_text("api_key = hunter2, ok"),
            "api_key = [redacted], ok"
        );
        assert_eq!(
            redact_secret_text("OPENAI_API_KEY=abc def"),
            "OPENAI_API_KEY=[redacted] def"
        );
        assert_eq!(
            redact_secrets(
                &json!({"Api-Key": "x", "nested": {"text": "ghp_abcdefghijklmnopqrstuvwxyz"}, "__proto__": 1})
            ),
            json!({"Api-Key": "[redacted]", "nested": {"text": "[redacted]"}})
        );
    }

    #[test]
    fn renderer_values_are_bounded() {
        let long = "x".repeat(10);
        assert_eq!(
            bound_renderer_value_with(&json!({"a": long}), 4),
            json!({"a": "xxxx\n… output truncated"})
        );
    }

    // `tests/unit/agent/events/electron.agent-events.test.mjs`.

    #[test]
    fn validates_a_versioned_normalized_event_and_rejects_unknown_vocabulary() {
        let input = |event_type: &str| EnvelopeInput {
            sequence: 1,
            session_id: "session-1".into(),
            runtime_id: "fake-runtime".into(),
            event_type: event_type.into(),
            ..Default::default()
        };
        let event = create_agent_event_envelope(EnvelopeInput {
            payload: json!({"delta": "hello"}),
            ..input("assistant.delta")
        })
        .unwrap();
        assert!(is_agent_event_envelope(&event));
        let message = create_agent_event_envelope(input("codex/raw/event"))
            .unwrap_err()
            .0;
        assert!(
            message.contains("Invalid normalized AgentEvent"),
            "{message}"
        );
        assert!(
            create_agent_event_envelope(EnvelopeInput {
                provider_session_id: Some("x".repeat(513)),
                ..input("assistant.delta")
            })
            .unwrap_err()
            .0
            .contains("Invalid normalized")
        );
    }

    #[test]
    fn bounds_hostile_object_shapes_before_renderer_delivery() {
        let payload: Value = serde_json::from_str(
            r#"{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"label":"ok","unknown":"drop"}"#,
        )
        .unwrap();
        let event = create_agent_event_envelope(EnvelopeInput {
            sequence: 1,
            session_id: "session-1".into(),
            runtime_id: "fake-runtime".into(),
            event_type: "tool.completed".into(),
            payload,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(event["payload"], json!({"label": "ok"}));
    }

    #[test]
    fn applies_one_aggregate_text_and_node_budget_across_nested_renderer_payloads() {
        let chunk = "x".repeat(32 * 1024);
        let payload: Value = Value::Object(
            (0..200)
                .map(|index| {
                    (
                        format!("branch-{index}"),
                        Value::Array(vec![Value::from(chunk.as_str()); 200]),
                    )
                })
                .collect(),
        );
        let serialized = serde_json::to_string(&bound_renderer_value(&payload)).unwrap();
        assert!(serialized.len() < limits::MAX_TOTAL_TEXT as usize + 40_000);
        assert!(serialized.contains("truncated"));
    }

    #[test]
    fn redacts_common_credential_shapes_recursively_before_renderer_delivery() {
        let redacted = redact_secrets(&json!({
            "authorization": "Bearer abcdefghijklmnopqrstuvwxyz",
            "nested": {"apiKey": "sk-abcdefghijklmnopqrstuvwxyz"},
            "message": "refresh_token=secret-value",
        }));
        let text = redacted.to_string();
        assert!(!text.contains("abcdefghijklmnopqrstuvwxyz") && !text.contains("secret-value"));
        assert_eq!(
            redact_secret_text("Bearer abcdefghijklmnopqrstuvwxyz"),
            "Bearer [redacted]"
        );
    }

    #[test]
    fn preserves_token_usage_metrics_while_redacting_common_environment_secrets() {
        let usage = json!({"inputTokens": 1200, "cachedInputTokens": 400, "outputTokens": 88, "totalTokens": 1288});
        let redacted =
            redact_secrets(&json!({"tokenUsage": usage, "accessToken": "secret-access-token"}));
        assert_eq!(redacted["tokenUsage"], usage);
        assert_eq!(redacted["accessToken"], "[redacted]");
        assert_eq!(
            redact_secret_text("AWS_SECRET_ACCESS_KEY=very-secret-value"),
            "AWS_SECRET_ACCESS_KEY=[redacted]"
        );
        assert_eq!(
            redact_secret_text("CLIENT_SECRET=very-secret-value"),
            "CLIENT_SECRET=[redacted]"
        );
    }

    #[test]
    fn envelopes_bound_assistant_text_and_strip_native_fields() {
        let event = create_agent_event_envelope(EnvelopeInput {
            sequence: 1,
            session_id: "s".into(),
            runtime_id: "codex".into(),
            event_type: "assistant.delta".into(),
            payload: json!({"delta": "token sk-abcdefghijklmnop", "private": true}),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(event["payload"], json!({"delta": "token [redacted]"}));
        assert_eq!(event["provider"], "codex");
        assert!(event["turnId"].is_null());
        assert!(
            create_agent_event_envelope(EnvelopeInput {
                sequence: 0,
                session_id: "s".into(),
                runtime_id: "codex".into(),
                event_type: "assistant.delta".into(),
                ..Default::default()
            })
            .is_err()
        );
    }
}

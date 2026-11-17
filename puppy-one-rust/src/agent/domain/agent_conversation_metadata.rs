//! `domain/agent-conversation-metadata.mjs`: projects catalog metadata into
//! list rows without loading a Session actor.
use crate::agent::contract::js::{self, Obj};
use serde_json::Value;

/// `publicSessionRecord(record)`.
pub fn public_session_record(record: &Value) -> Result<Value, String> {
    let runtime_id = [record.get("runtimeId"), record.get("provider")]
        .into_iter()
        .flatten()
        .find(|v| js::truthy(v))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| {
            "A public Agent session record requires a migrated runtime id.".to_string()
        })?;
    let field = |key: &str| {
        record
            .get(key)
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(Value::Null)
    };
    let sequence = match record.get("lastSequence") {
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        Some(other) => js::safe_integer(other),
        None => None,
    };
    let title = record
        .get("title")
        .filter(|t| js::truthy(t))
        .cloned()
        .unwrap_or(Value::from("Agent session"));
    let terminal = record
        .get("terminalState")
        .filter(|t| js::truthy(t))
        .cloned()
        .unwrap_or(Value::from("idle"));
    Ok(Obj::new()
        .set("id", field("sessionId"))
        .set("runtimeId", runtime_id)
        .set("provider", runtime_id)
        .set("runtime", field("runtime"))
        .set("providerSessionId", field("providerSessionId"))
        .set("workspaceRoot", field("workspaceRoot"))
        .set("title", title)
        .set("createdAt", field("createdAt"))
        .set("updatedAt", field("updatedAt"))
        .opt(
            "updatedAtKnown",
            (record.get("updatedAtKnown") == Some(&Value::Bool(false))).then_some(false),
        )
        .set("archivedAt", field("archivedAt"))
        .set("terminalState", terminal)
        .set("selectedModel", field("selectedModel"))
        .set("selectedEffort", field("selectedEffort"))
        .set("selectedMode", field("selectedMode"))
        .set("lastSequence", sequence.filter(|n| *n >= 0).unwrap_or(0))
        .set("partial", js::truthy_opt(record.get("partial")))
        .set(
            "origin",
            if record.get("origin") == Some(&Value::from("native-discovery")) {
                "native-discovery"
            } else {
                "puppyone"
            },
        )
        .build())
}

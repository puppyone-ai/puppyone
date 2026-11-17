//! `application/turn/agent-command-policy.mjs`.
use super::super::agent_session_store::project_session_error;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::Obj;
use crate::agent::domain::agent_session_model::AgentSession;
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::LazyLock;

static COMMAND_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$").expect("command id"));

/// `commandIdentity(value)`.
pub fn command_identity(value: Option<&Value>) -> String {
    match value
        .and_then(Value::as_str)
        .filter(|id| COMMAND_ID.is_match(id))
    {
        Some(id) => id.to_string(),
        None => format!("command-{}", uuid::Uuid::new_v4()),
    }
}

/// `requireCommandPreconditions(session, request)`.
pub fn require_command_preconditions(session: &AgentSession, request: &Value) -> AgentResult<()> {
    if session.closing() {
        return Err(project_session_error(
            "SESSION_CLOSING",
            "This conversation is closing.",
            true,
        ));
    }
    if let Some(instance) = request["instanceId"].as_str().filter(|i| !i.is_empty())
        && instance != session.instance_id
    {
        return Err(project_session_error(
            "SESSION_STALE",
            "This conversation instance has ended.",
            false,
        ));
    }
    let control = session.actor.control();
    let differs = |key: &str, control_key: &str| {
        request
            .get(key)
            .is_some_and(|expected| *expected != control[control_key])
    };
    if differs("expectedSessionEpoch", "sessionEpoch") {
        return Err(AgentError::new(
            "The Agent command belongs to an older session generation.",
        ));
    }
    if differs("expectedAdapterGeneration", "adapterGeneration") {
        return Err(AgentError::new(
            "The Agent command belongs to a replaced runtime connection.",
        ));
    }
    if differs("expectedRunGeneration", "runGeneration") {
        return Err(AgentError::new(
            "The Agent command belongs to an older turn generation.",
        ));
    }
    Ok(())
}

/// `repeatedCommand(session, commandId, kind, intentFingerprint)`.
pub fn repeated_command(
    session: &AgentSession,
    command_id: Option<&Value>,
    kind: &str,
    fingerprint: &str,
) -> AgentResult<Option<Value>> {
    let Some(command_id) = command_id.and_then(Value::as_str) else {
        return Ok(None);
    };
    let control = session.actor.control();
    let Some(existing) = control["commands"]
        .as_array()
        .and_then(|commands| {
            commands
                .iter()
                .find(|entry| entry["commandId"] == command_id)
        })
        .cloned()
    else {
        return Ok(None);
    };
    if existing["kind"] != kind {
        return Err(AgentError::new(
            "Agent command id was already used for a different operation.",
        ));
    }
    if existing["intentFingerprint"] != fingerprint {
        return Err(AgentError::new(
            "Agent command id was already used with different input.",
        ));
    }
    if let Some(status @ ("rejected" | "cancelled" | "outcome-unknown")) =
        existing["status"].as_str()
    {
        return Err(AgentError::new(format!(
            "Agent command was already {status} and will not be retried automatically."
        )));
    }
    Ok(Some(existing))
}

/// `commandReceipt(session, command)`.
pub fn command_receipt(session: &AgentSession, command: &Value) -> Value {
    Obj::new()
        .set("sessionId", session.id())
        .set("commandId", command["commandId"].clone())
        .set("turnId", command["targetTurnId"].clone())
        .set("queued", command["status"] == "queued")
        .set("deliveryStatus", command["status"].clone())
        .set("deduplicated", true)
        .build()
}

/// `operationIdentity()`.
pub fn operation_identity() -> String {
    format!("operation-{}", uuid::Uuid::new_v4())
}

/// `startCommandIntent(input, { model, effort, mode }, recoveryOfTurnId)`.
pub fn start_command_intent(
    display_prompt: &str,
    prompt_mentions: &[Value],
    reference_displays: &[Value],
    model: Option<&str>,
    effort: Option<&str>,
    mode: Option<&str>,
    recovery_of_turn_id: Option<&str>,
) -> Value {
    Obj::new()
        .set("prompt", display_prompt)
        .set("recoveryOfTurnId", recovery_of_turn_id)
        .set("promptMentions", prompt_mentions.to_vec())
        .set("referenceDisplays", reference_displays.to_vec())
        .set("model", model)
        .set("effort", effort)
        .set("mode", mode)
        .build()
}

/// `commandFingerprint(kind, intent)`.
pub fn command_fingerprint(kind: &str, intent: &Value) -> String {
    let serialized = stable_serialize(&serde_json::json!({ "kind": kind, "intent": intent }));
    Sha256::digest(serialized.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn stable_serialize(value: &Value) -> String {
    match value {
        Value::Array(entries) => format!(
            "[{}]",
            entries
                .iter()
                .map(stable_serialize)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_default(),
                        stable_serialize(&map[*key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

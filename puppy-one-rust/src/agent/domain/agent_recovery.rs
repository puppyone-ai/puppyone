//! `domain/agent-recovery.mjs`: recovery observations are scoped facts;
//! model retries do not disconnect the local control channel.
use crate::agent::contract::constants::limits::MAX_CONTROL_REASON_LENGTH;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::text;
use serde_json::Value;

/// `reduceAgentRecoveries(previous, event, control)`.
pub fn reduce_agent_recoveries(previous: &[Value], event: &Value, control: &Value) -> Vec<Value> {
    let event_type = event.event_type();
    if matches!(
        event_type,
        "session.closed" | "session.started" | "session.resumed"
    ) {
        return Vec::new();
    }
    if matches!(
        event_type,
        "turn.completed" | "turn.failed" | "turn.interrupted"
    ) {
        let turn = event.turn_value();
        return previous
            .iter()
            .filter(|entry| {
                entry.get("turnId").cloned().unwrap_or(Value::Null) != turn
                    || entry.get("scope") == Some(&Value::from("transport"))
            })
            .cloned()
            .collect();
    }
    if event_type != "provider.connection.updated" {
        return previous.to_vec();
    }
    let transport = event.field("scope") == Some(&Value::from("transport"));
    let scope = if transport {
        "transport"
    } else {
        "upstream-request"
    };
    let turn_id: Option<String> = if transport {
        None
    } else {
        event.turn_id().map(str::to_string).or_else(|| {
            control["execution"]["activeTurnId"]
                .as_str()
                .map(str::to_string)
        })
    };
    // Model retries belong to a turn; an uncorrelated late notice must not reopen a settled run.
    if !transport && turn_id.as_deref().is_none_or(str::is_empty) {
        return previous.to_vec();
    }
    if let Some(turn) = &turn_id
        && control["terminalTurns"]
            .as_array()
            .is_some_and(|turns| turns.iter().any(|t| t.as_str() == Some(turn)))
    {
        return previous.to_vec();
    }
    let request_id = event.field("requestId").filter(|v| !v.is_null()).cloned();
    let adapter_generation = control["adapterGeneration"].as_i64().unwrap_or(0);
    let id = match event.field("recoveryId").filter(|v| !v.is_null()) {
        Some(id) => js::str_or_empty(Some(id)).to_string(),
        None => format!(
            "{scope}:{adapter_generation}:{}:{}",
            turn_id.as_deref().unwrap_or("connection"),
            request_id
                .as_ref()
                .map(|r| r
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| r.to_string()))
                .unwrap_or_else(|| "request".into())
        ),
    };
    let remaining: Vec<Value> = previous
        .iter()
        .filter(|entry| entry.get("id").and_then(Value::as_str) != Some(id.as_str()))
        .cloned()
        .collect();
    let state = event.text("state");
    if state == "connected" || state == "ended" {
        return remaining;
    }
    if state != "reconnecting" && state != "fallback" {
        return previous.to_vec();
    }
    let max_attempts = event
        .field("maxAttempts")
        .filter(|v| !v.is_null())
        .or(event.field("maxRetries"));
    let mut next = remaining;
    next.push(
        Obj::new()
            .set("id", id)
            .set("scope", scope)
            .set("turnId", turn_id)
            .set("requestId", request_id.unwrap_or(Value::Null))
            .set("adapterGeneration", adapter_generation)
            .set(
                "runGeneration",
                control["runGeneration"].as_i64().unwrap_or(0),
            )
            .set("state", state)
            .set(
                "message",
                event
                    .field("message")
                    .and_then(Value::as_str)
                    .map(|m| text::head16(m, MAX_CONTROL_REASON_LENGTH).to_string())
                    .unwrap_or_default(),
            )
            .set("attempt", positive(event.field("attempt")))
            .set("maxAttempts", positive(max_attempts))
            .build(),
    );
    let excess = next.len().saturating_sub(64);
    next.drain(..excess);
    next
}

/// `activeAgentRecovery(control)`.
pub fn active_agent_recovery(control: &Value) -> Option<&Value> {
    let generation = control.get("adapterGeneration");
    let active = control["execution"]
        .get("activeTurnId")
        .filter(|v| !v.is_null());
    let uncertain = control["execution"]
        .get("uncertainTurnId")
        .filter(|v| !v.is_null());
    control
        .get("recoveries")?
        .as_array()?
        .iter()
        .rev()
        .find(|entry| {
            entry.get("adapterGeneration") == generation
                && (entry.get("scope") == Some(&Value::from("transport"))
                    || entry
                        .get("turnId")
                        .filter(|t| !t.is_null())
                        .is_some_and(|turn| Some(turn) == active || Some(turn) == uncertain))
        })
}

fn positive(value: Option<&Value>) -> Option<i64> {
    value.and_then(js::safe_integer).filter(|n| *n > 0)
}

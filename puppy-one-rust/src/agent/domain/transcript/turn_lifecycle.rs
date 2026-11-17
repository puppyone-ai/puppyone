//! `transcript/turn-lifecycle.mjs`.
use super::transcript_indexes::{Projection, revise};
use crate::agent::contract::types::AgentEventView;
use serde_json::Value;

pub const LIVE_AGENT_ACTIVITY_STATUSES: &[&str] = &[
    "queued",
    "running",
    "pending",
    "in-progress",
    "waiting-for-user",
];

/// `agentTurnTerminalState(event)`.
pub fn agent_turn_terminal_state(event: &Value) -> Option<&'static str> {
    match event.event_type() {
        "turn.completed" => Some("completed"),
        "turn.failed" => Some("failed"),
        "turn.interrupted" => Some("interrupted"),
        _ => None,
    }
}

/// `isLiveAgentActivityStatus(status)`.
pub fn is_live_agent_activity_status(status: Option<&Value>) -> bool {
    status
        .and_then(Value::as_str)
        .is_some_and(|s| LIVE_AGENT_ACTIVITY_STATUSES.contains(&s))
}

/// `agentActivityTerminalStatus(terminalState)`.
pub fn agent_activity_terminal_status(terminal_state: &str) -> &str {
    terminal_state
}

/// `reconcileTerminalAgentTurn(projection, event)`: one terminal
/// reconciliation authority for legacy compatibility collections and the
/// canonical typed-part timeline. Native Harnesses may omit a terminal child
/// event, but no live child is allowed to survive its owning turn.
pub fn reconcile_terminal_agent_turn(projection: &mut Projection, event: &Value) {
    let Some(terminal_state) = agent_turn_terminal_state(event) else {
        return;
    };
    let turn_id = event.turn_id().filter(|t| !t.is_empty());
    let d = &mut projection.d;
    let ends_current_turn = turn_id.is_none() || d.running_turn_id() == turn_id;
    if ends_current_turn {
        d.set("runningTurnId", Value::Null);
        d.set("terminalState", terminal_state);
        d.set("connectionStatus", Value::Null);
    }
    let in_turn =
        |entry: &Value| turn_id.is_some() && entry.get("turnId").and_then(Value::as_str) == turn_id;
    for message in d.messages.iter_mut() {
        if in_turn(message) && message.get("role") == Some(&Value::from("assistant")) {
            *message = revise(message, |m| {
                m.insert("streaming".into(), false.into());
                m.insert("terminalState".into(), terminal_state.into());
            });
        }
    }
    for activity in d.activities.iter_mut() {
        let kind = activity.get("kind").and_then(Value::as_str).unwrap_or("");
        let uncategorized_system = kind == "system"
            && activity.get("detail").and_then(|d| d.get("category"))
                != Some(&Value::from("compaction"));
        if uncategorized_system
            || !in_turn(activity)
            || !is_live_agent_activity_status(activity.get("status"))
        {
            continue;
        }
        let status = unconfirmed_child_status(kind, terminal_state);
        *activity = revise(activity, |a| {
            a.insert("status".into(), status.into());
        });
    }
    for part in d.parts.iter_mut() {
        if !in_turn(part) {
            continue;
        }
        let kind = part.get("kind").and_then(Value::as_str).unwrap_or("");
        if kind == "assistant" {
            *part = revise(part, |p| {
                p.insert("streaming".into(), false.into());
                p.insert("terminalState".into(), terminal_state.into());
            });
        } else if kind == "permission" || kind == "question" {
            if part.get("state") == Some(&Value::from("pending")) {
                *part = revise(part, |p| {
                    p.insert("state".into(), "resolved".into());
                });
            }
        } else if is_agent_activity_part(part) && is_live_agent_activity_status(part.get("status"))
        {
            let status = unconfirmed_child_status(kind, terminal_state);
            *part = revise(part, |p| {
                p.insert("status".into(), status.into());
            });
        }
    }
    let other_turn = |entry: &Value| entry.get("turnId") != Some(&event.turn_value());
    d.approvals.retain(|a| other_turn(a));
    d.questions.retain(|q| other_turn(q));
    // Collection replacement invalidates every lazily rebuilt positional index.
    projection.invalidate();
}

fn is_agent_activity_part(part: &Value) -> bool {
    let kind = part.get("kind").and_then(Value::as_str).unwrap_or("");
    (kind == "system"
        && part.get("detail").and_then(|d| d.get("category")) == Some(&Value::from("compaction")))
        || matches!(
            kind,
            "reasoning" | "plan" | "tool" | "command" | "file-change" | "warning" | "error"
        )
}

fn unconfirmed_child_status<'a>(kind: &str, terminal_state: &'a str) -> &'a str {
    // The parent ending is not proof that an unfinished native tool succeeded.
    if matches!(kind, "tool" | "command" | "file-change" | "system") {
        "unknown"
    } else {
        agent_activity_terminal_status(terminal_state)
    }
}

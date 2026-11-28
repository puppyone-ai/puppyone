//! `transcript/display-control.mjs`: control and transcript are committed
//! together; no content event votes on current control state.
use super::transcript_indexes::{entry, revise};
use crate::agent::contract::display_types::{AgentDisplay, Entry};
use crate::agent::contract::js::{self, Obj};
use crate::agent::domain::agent_recovery::active_agent_recovery;
use crate::agent::domain::agent_session_control::is_agent_idle_disconnect;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

/// `projectAgentDisplayControl(display, control)`.
pub fn project_agent_display_control(display: &AgentDisplay, control: &Value) -> AgentDisplay {
    let commands = control["commands"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let delivery_by_id: HashMap<&str, &Value> = commands
        .iter()
        .filter(|command| command["kind"] == "start")
        .filter_map(|command| Some((command["commandId"].as_str()?, &command["status"])))
        .collect();
    let delivery = |message: &Entry| -> Entry {
        let Some(status) = message
            .get("submissionId")
            .and_then(Value::as_str)
            .and_then(|id| delivery_by_id.get(id))
        else {
            return message.clone();
        };
        if message.get("deliveryStatus") == Some(*status) {
            return message.clone();
        }
        revise(message, |m| {
            m.insert("deliveryStatus".into(), (*status).clone());
        })
    };
    let mut display = display.clone();
    display.messages = display.messages.iter().map(delivery).collect();
    display.parts = display.parts.iter().map(delivery).collect();
    with_uncertain_outcome(&mut display, control);
    with_turn_summaries(&mut display);
    let recovery = active_agent_recovery(control);
    let execution = &control["execution"];
    let active_turn_id = execution
        .get("activeTurnId")
        .filter(|v| js::truthy(v))
        .cloned();
    let idle_disconnect = is_agent_idle_disconnect(control);
    let exited = control["connection"]["status"] == "exited" && !idle_disconnect;
    let blocked = control["interaction"]["approvals"]
        .as_array()
        .is_some_and(|a| !a.is_empty())
        || control["interaction"]["questions"]
            .as_array()
            .is_some_and(|q| !q.is_empty());
    let execution_status = js::str_or_empty(execution.get("status"));
    let native_outcome = execution
        .get("nativeOutcome")
        .cloned()
        .unwrap_or(Value::Null);
    let phase = if exited {
        "runtime-exited"
    } else if active_turn_id.is_some() {
        if blocked { "waiting" } else { "running" }
    } else if execution_status == "starting" {
        "creating"
    } else {
        "ready"
    };
    let terminal_state = if exited {
        Value::from("provider-exited")
    } else if active_turn_id.is_some() {
        Value::from("running")
    } else if execution_status == "outcome-unknown" {
        Value::from("outcome-unknown")
    } else if native_outcome.is_null() {
        Value::from("idle")
    } else {
        native_outcome.clone()
    };
    let stopping = active_turn_id.as_ref().is_some_and(|turn| {
        commands.iter().any(|command| {
            command["kind"] == "interrupt"
                && command.get("targetTurnId") == Some(turn)
                && matches!(command["status"].as_str(), Some("dispatching" | "accepted"))
        })
    });
    display.set(
        "presentation",
        json!({
            "phase": phase,
            "terminalState": terminal_state,
            "pendingPrompt": null,
            "submitting": execution_status == "starting",
            "stopping": stopping,
        }),
    );
    display.set(
        "runningTurnId",
        active_turn_id.clone().unwrap_or(Value::Null),
    );
    display.set(
        "terminalState",
        if active_turn_id.is_some() {
            Value::Null
        } else {
            native_outcome
        },
    );
    let last_sequence = display.get("lastSequence").cloned().unwrap_or(Value::Null);
    display.set(
        "connectionStatus",
        match recovery {
            Some(recovery) => Obj::new()
                .set("state", recovery["state"].clone())
                .set("message", recovery["message"].clone())
                .set("attempt", recovery["attempt"].clone())
                .set("maxAttempts", recovery["maxAttempts"].clone())
                .set("turnId", recovery["turnId"].clone())
                .set("sequence", last_sequence)
                .build(),
            None => Value::Null,
        },
    );
    let pending = |key: &str| -> HashSet<String> {
        control["interaction"][key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| entry["requestId"].as_str().map(str::to_string))
            .collect()
    };
    let (approvals, questions) = (pending("approvals"), pending("questions"));
    let with_reply = |entries: &[Entry], pending: &HashSet<String>| -> Vec<Entry> {
        entries
            .iter()
            .filter(|entry| {
                entry["requestId"]
                    .as_str()
                    .is_some_and(|id| pending.contains(id))
            })
            .map(|entry| with_reply_status(entry, commands))
            .collect()
    };
    display.approvals = with_reply(&display.approvals, &approvals);
    display.questions = with_reply(&display.questions, &questions);
    display
}

/// A summary exists only when the native transcript confirms an outcome and timing.
fn with_turn_summaries(display: &mut AgentDisplay) {
    let mut parts: Vec<Entry> = display
        .parts
        .iter()
        .filter(|part| part["kind"] != "turn-summary")
        .cloned()
        .collect();
    let mut rows = display.rows.clone();
    let turn_key = |value: &Value| {
        value
            .get("turnId")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let sequence_of =
        |value: &Value, key: &str| value.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    let mut last_row_by_turn: HashMap<Option<String>, f64> = HashMap::new();
    for row in &rows {
        if row["kind"] != "turn-summary" {
            let last = last_row_by_turn.entry(turn_key(row)).or_insert(0.0);
            *last = last.max(sequence_of(row, "sequence"));
        }
    }
    for turn in &display.turns {
        let status = turn["status"].as_str().unwrap_or("");
        if !matches!(status, "completed" | "failed" | "interrupted")
            || turn["durationMs"].is_null()
            || turn["completedAtSequence"].is_null()
        {
            continue;
        }
        let turn_id = js::str_or_empty(turn.get("id"));
        let id = format!("turn-summary:{turn_id}");
        let completed = sequence_of(turn, "completedAtSequence");
        let sequence = js::number(
            completed.max(
                last_row_by_turn
                    .get(&Some(turn_id.to_string()))
                    .copied()
                    .unwrap_or(0.0),
            ),
        );
        parts.push(entry(
            Obj::new()
                .set("id", id.clone())
                .set("kind", "turn-summary")
                .set("turnId", turn_id)
                .set("itemId", Value::Null)
                .set("durationMs", turn["durationMs"].clone())
                .set("status", status)
                .opt(
                    "completionQuality",
                    turn.get("completionQuality")
                        .filter(|q| js::truthy(q))
                        .cloned(),
                )
                .set("sequence", sequence.clone())
                .set("updatedSequence", turn["completedAtSequence"].clone())
                .build(),
        ));
        let row = entry(
            Obj::new()
                .set("id", format!("row:{id}"))
                .set("partId", id)
                .set("turnId", turn_id)
                .set("kind", "turn-summary")
                .set("sequence", sequence)
                .set("updatedSequence", turn["completedAtSequence"].clone())
                .set("estimatedHeight", 34)
                .build(),
        );
        match rows
            .iter()
            .position(|entry| entry.get("id") == row.get("id"))
        {
            Some(index) => rows[index] = row,
            None => rows.push(row),
        }
    }
    rows.sort_by(|a, b| sequence_of(a, "sequence").total_cmp(&sequence_of(b, "sequence")));
    let part_ids: HashSet<&str> = parts
        .iter()
        .map(|part| js::str_or_empty(part.get("id")))
        .collect();
    rows.retain(|row| part_ids.contains(js::str_or_empty(row.get("partId"))));
    display.rows = rows;
    display.parts = parts;
}

fn with_uncertain_outcome(display: &mut AgentDisplay, control: &Value) {
    let execution = &control["execution"];
    if execution["status"] != "outcome-unknown" {
        return;
    }
    let Some(turn_id) = execution
        .get("uncertainTurnId")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
    else {
        return;
    };
    const LIVE: &[&str] = &[
        "queued",
        "running",
        "pending",
        "in-progress",
        "waiting-for-user",
    ];
    let settle = |part: &Entry| -> Entry {
        if part.get("turnId").and_then(Value::as_str) != Some(turn_id) {
            return part.clone();
        }
        if part["kind"] == "assistant" || part["role"] == "assistant" {
            return revise(part, |p| {
                p.insert("streaming".into(), false.into());
            });
        }
        if matches!(part["kind"].as_str(), Some("permission" | "question"))
            && part["state"] == "pending"
        {
            return revise(part, |p| {
                p.insert("state".into(), "unavailable".into());
            });
        }
        if part["status"].as_str().is_some_and(|s| LIVE.contains(&s)) {
            return revise(part, |p| {
                p.insert("status".into(), "unknown".into());
            });
        }
        part.clone()
    };
    display.messages = display.messages.iter().map(settle).collect();
    display.activities = display.activities.iter().map(settle).collect();
    display.parts = display.parts.iter().map(settle).collect();
    display.turns = display
        .turns
        .iter()
        .map(|turn| {
            if turn["id"] == turn_id && turn["status"] == "running" {
                revise(turn, |t| {
                    t.insert("status".into(), "outcome-unknown".into());
                })
            } else {
                turn.clone()
            }
        })
        .collect();
}

fn with_reply_status(entry: &Entry, commands: &[Value]) -> Entry {
    let status = commands
        .iter()
        .rev()
        .find(|command| command.get("requestId") == entry.get("requestId"))
        .and_then(|command| command.get("status").filter(|s| !s.is_null()))
        .cloned()
        .unwrap_or(Value::Null);
    if entry.get("replyStatus") == Some(&status) {
        return entry.clone();
    }
    revise(entry, |e| {
        e.insert("replyStatus".into(), status);
    })
}

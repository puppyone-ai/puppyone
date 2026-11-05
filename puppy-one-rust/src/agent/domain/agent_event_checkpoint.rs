//! `domain/agent-event-checkpoint.mjs`: materializes the evicted prefix of a
//! turn into bounded canonical events. This keeps an in-flight response
//! reconstructable without retaining every token delta or pretending the
//! bounded timeline is complete history.
use super::transcript::provider_activity_policy::{
    classify_provider_activity, is_transcript_activity,
};
use crate::agent::contract::event_content_update::{
    UpdateMode, agent_event_content_update, apply_agent_event_content_update,
};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use serde_json::{Value, json};

pub const MAX_CHECKPOINT_EVENTS_PER_TURN: usize = 512;
const MAX_ASSISTANT_TEXT: usize = 128 * 1024;
const MAX_ACTIVITY_TEXT: usize = 64 * 1024;
const TRUNCATION_MARKER: &str = "\n… earlier output truncated …\n";

const CHECKPOINT_TYPES: &[&str] = &[
    "turn.started",
    "user.message",
    "assistant.delta",
    "assistant.completed",
    "reasoning.summary.delta",
    "plan.updated",
    "tool.started",
    "tool.progress",
    "tool.completed",
    "command.output.delta",
    "file.change.updated",
    "usage.updated",
    "approval.requested",
    "approval.resolved",
    "question.requested",
    "question.resolved",
    "provider.activity",
    "provider.warning",
    "provider.error",
];

/// `foldAgentEventCheckpoint(previous, event)`.
pub fn fold_agent_event_checkpoint(previous: &[Value], event: &Value) -> Vec<Value> {
    let Some(turn_id) = event.turn_id().filter(|t| !t.is_empty()) else {
        return previous.to_vec();
    };
    if !CHECKPOINT_TYPES.contains(&event.event_type()) {
        return previous.to_vec();
    }
    if event.event_type() == "provider.activity"
        && !is_transcript_activity(&classify_provider_activity(event))
    {
        return previous.to_vec();
    }
    let mut events = previous.to_vec();
    if !materialize_object_text_update(&mut events, event) {
        match events
            .last()
            .and_then(|last| merge_adjacent_text_delta(last, event))
        {
            Some(merged) => *events.last_mut().expect("last event") = merged,
            None => events.push(event.clone()),
        }
    }
    if events.len() <= MAX_CHECKPOINT_EVENTS_PER_TURN {
        return events;
    }
    let started = events
        .iter()
        .position(|entry| entry.event_type() == "turn.started");
    let marker = format!("checkpoint-truncated:{turn_id}");
    let material: Vec<&Value> = events
        .iter()
        .enumerate()
        .filter(|(index, entry)| {
            entry.item_id() != Some(marker.as_str()) && Some(*index) != started
        })
        .map(|(_, entry)| entry)
        .collect();
    let keep = MAX_CHECKPOINT_EVENTS_PER_TURN - if started.is_some() { 2 } else { 1 };
    let retained = &material[material.len().saturating_sub(keep)..];
    let first = events.first().map_or(event.sequence(), |e| e.sequence());
    let warning = checkpoint_warning(event, first, turn_id);
    let mut out = Vec::with_capacity(MAX_CHECKPOINT_EVENTS_PER_TURN);
    if let Some(started) = started {
        out.push(events[started].clone());
    }
    out.push(warning);
    out.extend(retained.iter().map(|e| (*e).clone()));
    out
}

/// Reasoning summaries and plans are mutable logical objects, not
/// neighboring log lines. Collapse every checkpoint fragment for that object
/// so a later replace invalidates older text even when unrelated events
/// interleaved it.
fn materialize_object_text_update(events: &mut Vec<Value>, event: &Value) -> bool {
    if !matches!(
        event.event_type(),
        "reasoning.summary.delta" | "plan.updated"
    ) {
        return false;
    }
    let identity = checkpoint_identity(event);
    let matching: Vec<usize> = events
        .iter()
        .enumerate()
        .filter(|(_, candidate)| {
            candidate.event_type() == event.event_type()
                && candidate.turn_id() == event.turn_id()
                && checkpoint_identity(candidate) == identity
        })
        .map(|(index, _)| index)
        .collect();
    let Some(&first_index) = matching.first() else {
        return false;
    };
    let first = events[first_index].clone();
    let mut text = String::new();
    let mut truncated = false;
    let mut payload = Obj::new();
    let candidates: Vec<&Value> = matching
        .iter()
        .map(|i| &events[*i])
        .chain(std::iter::once(event))
        .collect();
    for candidate in candidates {
        let Some(mutation) =
            apply_agent_event_content_update(Some(&text), candidate, Some(MAX_ACTIVITY_TEXT))
        else {
            continue;
        };
        text = mutation.text.clone();
        truncated = if mutation.mode == UpdateMode::Replace {
            mutation.truncated
        } else {
            truncated || mutation.truncated
        };
        payload = payload
            .spread(candidate.payload())
            .set(mutation.field, text.as_str())
            .set("updateMode", "replace");
    }
    let mut payload = payload.build();
    if truncated {
        payload["truncated"] = Value::Bool(true);
    } else {
        js::delete(&mut payload, "truncated");
    }
    let materialized = Obj::from(event)
        .set(
            "sequence",
            first.get("sequence").cloned().unwrap_or(Value::Null),
        )
        .set(
            "emittedAt",
            first.get("emittedAt").cloned().unwrap_or(Value::Null),
        )
        .set("payload", payload)
        .build();
    for index in matching.iter().rev() {
        events.remove(*index);
    }
    events.insert(first_index, materialized);
    true
}

fn merge_adjacent_text_delta(previous: &Value, event: &Value) -> Option<Value> {
    if previous.event_type() != event.event_type()
        || previous.turn_id() != event.turn_id()
        || checkpoint_identity(previous) != checkpoint_identity(event)
    {
        return None;
    }
    let update = agent_event_content_update(event)?;
    let limit = if event.event_type() == "assistant.delta" {
        MAX_ASSISTANT_TEXT
    } else {
        MAX_ACTIVITY_TEXT
    };
    let current = previous.text(update.field);
    let incoming = event.text(update.field);
    let combined = match update.mode {
        UpdateMode::Replace => incoming.to_string(),
        UpdateMode::Append => format!("{current}{incoming}"),
    };
    let was_truncated = update.mode == UpdateMode::Append
        && previous.field("truncated") == Some(&Value::Bool(true));
    let length = js::len16(&combined);
    let truncated = was_truncated || length > limit;
    let marker_length = js::len16(TRUNCATION_MARKER);
    let text = if event.event_type() == "command.output.delta" {
        if truncated {
            let keep = limit - marker_length;
            format!(
                "{TRUNCATION_MARKER}{}",
                js::tail16(&combined, length.saturating_sub(keep))
            )
        } else {
            combined
        }
    } else if was_truncated {
        current.to_string()
    } else if length > limit {
        format!(
            "{}{TRUNCATION_MARKER}",
            js::head16(&combined, limit - marker_length)
        )
    } else {
        combined
    };
    let mut payload = Obj::from(previous.payload())
        .spread(event.payload())
        .set(update.field, text)
        .build();
    if truncated {
        payload["truncated"] = Value::Bool(true);
    } else {
        js::delete(&mut payload, "truncated");
    }
    Some(js::with(event, "payload", payload))
}

fn checkpoint_identity(event: &Value) -> String {
    let fallback = || {
        event
            .item_id()
            .or(event.turn_id())
            .unwrap_or("")
            .to_string()
    };
    match event.event_type() {
        "reasoning.summary.delta" => {
            let index = event
                .field("summaryIndex")
                .filter(|v| !v.is_null())
                .map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string())
                })
                .unwrap_or_else(|| "0".into());
            format!("{}:{index}", fallback())
        }
        "plan.updated" => event.item_id().unwrap_or("current-plan").to_string(),
        _ => fallback(),
    }
}

fn checkpoint_warning(event: &Value, first_dropped_sequence: i64, turn_id: &str) -> Value {
    Obj::from(event)
        .set(
            "sequence",
            first_dropped_sequence.max(event.sequence() - MAX_CHECKPOINT_EVENTS_PER_TURN as i64),
        )
        .set("itemId", format!("checkpoint-truncated:{turn_id}"))
        .set("type", "provider.warning")
        .set(
            "payload",
            json!({
                "message": "Part of this unusually large live turn is outside the in-memory display window.",
                "recoverable": true,
                "diagnostic": "live-turn-checkpoint-truncated",
            }),
        )
        .build()
}

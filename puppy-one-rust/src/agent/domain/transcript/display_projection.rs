//! `transcript/display-projection.mjs`: the canonical typed-part timeline
//! (turns, parts, rows) every event revises after the legacy collections.
use super::content_readers::{
    activity_id, pick_safe_activity_detail, pick_usage, read_provider_message,
};
use super::provider_activity_policy::{classify_provider_activity, is_transcript_activity};
use super::provider_notice_policy::{
    is_non_diagnostic_provider_status_message, legacy_provider_connection_update,
    provider_activity_identity,
};
use super::transcript_indexes::{Projection, entry, revise};
use super::turn_lifecycle::agent_turn_terminal_state;
use super::turn_timing::{parse_agent_event_time, read_agent_turn_duration_ms};
use crate::agent::contract::display_types::Entry;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::text;
use serde_json::{Map, Value};

/// `options` of the projection: hydration reads legacy connection warnings
/// as connection state.
#[derive(Clone, Copy, Default)]
pub struct ProjectionOptions {
    pub legacy_provider_connection_warnings: bool,
}

/// `projectTypedPart(projection, event, options)`.
pub fn project_typed_part(projection: &mut Projection, event: &Value, options: ProjectionOptions) {
    if event.event_type() == "provider.connection.updated" {
        return;
    }
    let auxiliary = event.event_type() == "provider.notification"
        || (event.event_type() == "provider.activity"
            && !is_transcript_activity(&classify_provider_activity(event)));
    let turn = if auxiliary {
        None
    } else {
        update_turn(projection, event)
    };
    let Some(part) = part_for_event(projection, event, options) else {
        return;
    };
    let (d, indexes) = projection.split();
    let id = js::str_or_empty(part.get("id")).to_string();
    let existing_index = indexes.parts.get(&id).copied();
    let sequence = existing_index
        .and_then(|i| d.parts[i].get("sequence").cloned())
        .or_else(|| part.get("sequence").cloned())
        .unwrap_or(Value::Null);
    let projected = Obj::from(&part)
        .set("sequence", sequence)
        .set("updatedSequence", event.sequence())
        .build();
    let projected = entry(projected);
    match existing_index {
        Some(index) => d.parts[index] = projected.clone(),
        None => {
            indexes.parts.insert(id.clone(), d.parts.len());
            d.parts.push(projected.clone());
        }
    }
    if let Some(turn) = turn {
        let includes = turn
            .get("partIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().any(|p| p.as_str() == Some(id.as_str())));
        if !includes {
            let turn_id = js::str_or_empty(turn.get("id"));
            if let Some(turn_index) = indexes.turns.get(turn_id).copied() {
                d.turns[turn_index] = revise(&turn, |t| {
                    let mut ids = t
                        .get("partIds")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    ids.push(Value::from(id.as_str()));
                    t.insert("partIds".into(), Value::Array(ids));
                });
            }
        }
    }
    // Usage is session metadata, not visible transcript content. Keep the typed
    // part for consumers that need it, but never allocate virtual-list geometry.
    let kind = projected.get("kind").cloned().unwrap_or(Value::Null);
    if kind == "usage" || !is_transcript_activity(&projected) {
        return;
    }
    let row_id = format!("row:{id}");
    let row_index = indexes.rows.get(&row_id).copied();
    let row_sequence = row_index
        .and_then(|i| d.rows[i].get("sequence").cloned())
        .or_else(|| projected.get("sequence").cloned())
        .unwrap_or(Value::Null);
    let row = entry(
        Obj::new()
            .set("id", row_id.clone())
            .set("partId", id)
            .set(
                "turnId",
                projected.get("turnId").cloned().unwrap_or(Value::Null),
            )
            .set("kind", kind)
            .set("sequence", row_sequence)
            .set("updatedSequence", event.sequence())
            .set("estimatedHeight", estimate_part_height(&projected))
            .build(),
    );
    match row_index {
        Some(index) => d.rows[index] = row,
        None => {
            indexes.rows.insert(row_id, d.rows.len());
            d.rows.push(row);
        }
    }
}

fn update_turn(projection: &mut Projection, event: &Value) -> Option<Entry> {
    let turn_id = event.turn_id().filter(|t| !t.is_empty())?.to_string();
    let restored = js::truthy_opt(event.field("restored"));
    let (d, indexes) = projection.split();
    let turn_index = match indexes.turns.get(&turn_id).copied() {
        Some(index) => index,
        None => {
            let turn = Obj::new()
                .set("id", turn_id.clone())
                .set(
                    "status",
                    if restored {
                        "outcome-unknown"
                    } else {
                        "running"
                    },
                )
                .set("startedAtSequence", event.sequence())
                // Main's replay observation time is not native execution time.
                .set(
                    "startedAtMs",
                    if restored {
                        None
                    } else {
                        parse_agent_event_time(event.get("emittedAt"))
                    },
                )
                .set("userWaitStartedAtMs", Value::Null)
                .set("userWaitDurationMs", 0)
                .set("completedAtSequence", Value::Null)
                .set("durationMs", Value::Null)
                .set("partIds", Value::Array(Vec::new()))
                .build();
            indexes.turns.insert(turn_id.clone(), d.turns.len());
            d.turns.push(entry(turn));
            d.turns.len() - 1
        }
    };
    let mut turn: Map<String, Value> = d.turns[turn_index].as_object().cloned().unwrap_or_default();
    let mut changed = false;
    let event_type = event.event_type();
    let recovery = event.text("recoveryOfTurnId");
    if event_type == "turn.started" && !recovery.is_empty() {
        turn.insert("recoveryOfTurnId".into(), recovery.into());
        changed = true;
    }
    let event_at_ms = parse_agent_event_time(event.get("emittedAt"));
    if matches!(event_type, "approval.requested" | "question.requested")
        && js::nullish(turn.get("userWaitStartedAtMs"))
        && let Some(at) = event_at_ms
    {
        turn.insert("userWaitStartedAtMs".into(), at.into());
        changed = true;
    }
    let same_turn =
        |entry: &Entry| entry.get("turnId").and_then(Value::as_str) == Some(turn_id.as_str());
    if matches!(event_type, "approval.resolved" | "question.resolved")
        && !d.approvals.iter().any(same_turn)
        && !d.questions.iter().any(same_turn)
    {
        changed |= close_agent_turn_user_wait(&mut turn, event_at_ms);
    }
    if let Some(terminal_state) = agent_turn_terminal_state(event) {
        close_agent_turn_user_wait(&mut turn, event_at_ms);
        let started_at_ms = turn.get("startedAtMs").and_then(Value::as_i64);
        turn.insert("status".into(), terminal_state.into());
        turn.insert("completedAtSequence".into(), event.sequence().into());
        turn.insert(
            "durationMs".into(),
            read_agent_turn_duration_ms(
                event.field("durationMs"),
                started_at_ms,
                event.get("emittedAt"),
            )
            .into(),
        );
        if terminal_state == "completed" {
            completed_turn_quality(&mut turn, event.payload());
        }
        changed = true;
    }
    if changed {
        d.turns[turn_index] = entry(Value::Object(turn));
    }
    Some(d.turns[turn_index].clone())
}

fn completed_turn_quality(turn: &mut Map<String, Value>, payload: &Value) {
    if payload.get("completionQuality") != Some(&Value::from("degraded")) {
        turn.insert("completionQuality".into(), "complete".into());
        turn.shift_remove("recovery");
        return;
    }
    let one_of = |key: &str, allowed: &[&str], fallback: &str| -> String {
        payload
            .get(key)
            .and_then(Value::as_str)
            .filter(|v| allowed.contains(v))
            .unwrap_or(fallback)
            .to_string()
    };
    let failure_scope = one_of(
        "failureScope",
        &["child-task", "tool", "upstream-request", "turn"],
        "turn",
    );
    let transport_health = one_of(
        "transportHealth",
        &["healthy", "recovering", "exited", "unknown"],
        "unknown",
    );
    let side_effects = one_of(
        "sideEffects",
        &["none", "possible", "confirmed", "unknown"],
        "unknown",
    );
    let code = js::str_or_empty(payload.get("failureCode"));
    let diagnostic = js::str_or_empty(payload.get("diagnostic"));
    turn.insert("completionQuality".into(), "degraded".into());
    turn.insert(
        "recovery".into(),
        Obj::new()
            .set("kind", "degraded-completion")
            .set("failureScope", failure_scope)
            .set(
                "code",
                if code.is_empty() {
                    "DEGRADED_COMPLETION"
                } else {
                    code
                },
            )
            .set(
                "retryable",
                payload.get("retryable").and_then(Value::as_bool),
            )
            .set("transportHealth", transport_health)
            .set("sideEffects", side_effects)
            .opt("diagnostic", (!diagnostic.is_empty()).then_some(diagnostic))
            .build(),
    );
}

fn close_agent_turn_user_wait(turn: &mut Map<String, Value>, event_at_ms: Option<i64>) -> bool {
    let Some(wait_started_at_ms) = turn.get("userWaitStartedAtMs").and_then(Value::as_i64) else {
        return false;
    };
    let elapsed = match event_at_ms {
        Some(at) if at >= wait_started_at_ms => at - wait_started_at_ms,
        _ => 0,
    };
    let previous = turn
        .get("userWaitDurationMs")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    turn.insert("userWaitStartedAtMs".into(), Value::Null);
    turn.insert("userWaitDurationMs".into(), (previous + elapsed).into());
    true
}

fn part_for_event(
    projection: &mut Projection,
    event: &Value,
    options: ProjectionOptions,
) -> Option<Value> {
    let event_type = event.event_type();
    let turn_value = event.turn_value();
    let message_turn =
        |message: &Value| message.get("turnId").cloned().unwrap_or(Value::Null) == turn_value;
    let revised_at = |message: &Value| {
        message
            .get("updatedSequence")
            .filter(|v| !v.is_null())
            .or(message.get("sequence"))
            .and_then(Value::as_i64)
            == Some(event.sequence())
    };
    match event_type {
        "turn.started" => {
            let turn_id = event.turn_id().filter(|t| !t.is_empty())?.to_string();
            let (d, indexes) = projection.split();
            indexes
                .messages_by_turn
                .get(&turn_id)?
                .iter()
                .filter_map(|index| d.messages.get(*index))
                .find(|message| message.get("role") == Some(&Value::from("user")))
                .map(|message| message_part(message))
        }
        "assistant.delta" | "assistant.completed" => {
            let base_id = format!(
                "assistant:{}",
                event
                    .item_id()
                    .or(event.turn_id())
                    .map(str::to_string)
                    .unwrap_or_else(|| event.sequence().to_string())
            );
            let item = event.item_id();
            projection
                .d
                .messages
                .iter()
                .rev()
                .find(|message| {
                    message.get("role") == Some(&Value::from("assistant"))
                        && message_turn(message)
                        && match item {
                            Some(item) => {
                                message.get("itemId").and_then(Value::as_str) == Some(item)
                            }
                            None => {
                                message.get("id").and_then(Value::as_str) == Some(base_id.as_str())
                            }
                        }
                        && revised_at(message)
                })
                .map(|message| message_part(message))
        }
        "user.message" => {
            let item = event.item_id();
            projection
                .d
                .messages
                .iter()
                .rev()
                .find(|message| {
                    message.get("role") == Some(&Value::from("user"))
                        && message_turn(message)
                        && match item {
                            Some(item) => {
                                message.get("itemId").and_then(Value::as_str) == Some(item)
                            }
                            None => {
                                message.get("updatedSequence").and_then(Value::as_i64)
                                    == Some(event.sequence())
                            }
                        }
                        && revised_at(message)
                })
                .map(|message| message_part(message))
        }
        "reasoning.summary.delta"
        | "plan.updated"
        | "command.output.delta"
        | "file.change.updated"
        | "provider.activity"
        | "provider.notification" => activity_part_at(projection, &activity_id(event)),
        _ if event_type.starts_with("tool.") => activity_part_at(projection, &activity_id(event)),
        "provider.warning" | "provider.error" => {
            let label = read_provider_message(event.field("message"));
            if options.legacy_provider_connection_warnings
                && legacy_provider_connection_update(event, &label).is_some()
            {
                return None;
            }
            if !label.is_empty() && is_non_diagnostic_provider_status_message(&label) {
                return None;
            }
            let fallback = if event_type == "provider.error" {
                "error"
            } else {
                "warning"
            };
            let identity = provider_activity_identity(
                projection,
                event,
                if label.is_empty() { fallback } else { &label },
            );
            activity_part_at(projection, &identity.id)
        }
        "usage.updated" => Some(
            Obj::new()
                .set("id", "usage:current")
                .set("turnId", turn_value.clone())
                .set("itemId", event.item_value())
                .set("kind", "usage")
                .set("usage", pick_usage(event.payload()))
                .set("sequence", event.sequence())
                .set("updatedSequence", event.sequence())
                .build(),
        ),
        "approval.requested" | "approval.resolved" | "question.requested" | "question.resolved" => {
            let request_id = event.text("requestId");
            if request_id.is_empty() {
                return None;
            }
            let (prefix, kind) = if event_type.starts_with("approval.") {
                ("permission", "permission")
            } else {
                ("question", "question")
            };
            Some(
                Obj::new()
                    .set("id", format!("{prefix}:{request_id}"))
                    .set("turnId", turn_value.clone())
                    .set("itemId", event.item_value())
                    .set("kind", kind)
                    .set("requestId", request_id)
                    .set(
                        "state",
                        if event_type.ends_with("resolved") {
                            "resolved"
                        } else {
                            "pending"
                        },
                    )
                    .set("sequence", event.sequence())
                    .set("updatedSequence", event.sequence())
                    .build(),
            )
        }
        _ if event_type.starts_with("session.") || event_type.starts_with("turn.") => None,
        _ => Some(
            Obj::new()
                .set(
                    "id",
                    format!(
                        "unknown:{event_type}:{}",
                        event
                            .item_id()
                            .map(str::to_string)
                            .unwrap_or_else(|| event.sequence().to_string())
                    ),
                )
                .set("turnId", turn_value.clone())
                .set("itemId", event.item_value())
                .set("kind", "unknown")
                .set("eventType", event_type)
                .set("label", "")
                .set("labelCode", "unsupported-event")
                .set("sequence", event.sequence())
                .set("updatedSequence", event.sequence())
                .build(),
        ),
    }
}

fn activity_part_at(projection: &mut Projection, id: &str) -> Option<Value> {
    let index = projection.indexes().activities.get(id).copied()?;
    projection
        .d
        .activities
        .get(index)
        .map(|activity| activity_part(activity))
}

fn message_part(message: &Value) -> Value {
    let role = message.get("role").cloned().unwrap_or(Value::Null);
    Obj::from(message).set("kind", role).build()
}

fn activity_part(activity: &Value) -> Value {
    let detail = pick_safe_activity_detail(activity.get("detail").unwrap_or(&Value::Null));
    Obj::from(activity).set("detail", detail).build()
}

fn estimate_part_height(part: &Value) -> i64 {
    match part.get("kind").and_then(Value::as_str).unwrap_or("") {
        "user" => 64,
        "assistant" => {
            let length = text::len16(js::str_or_empty(part.get("text"))) as i64;
            640.min(50 + ((length + 63) / 64) * 20)
        }
        "turn-summary" => 32,
        "permission" | "question" | "usage" => 36,
        _ => 42,
    }
}

//! `transcript/transcript-reducer.mjs`: folds canonical events into the
//! display projection: the legacy compatibility collections (messages,
//! activities, approvals, questions), then the typed-part timeline, then
//! terminal reconciliation.
use super::content_readers::{
    activity_id, default_tool_label_code, file_change_label_code, normalize_agent_activity_status,
    nullable_string, pick_safe_activity_detail, pick_usage, read_approval_decisions,
    read_network_approval_context, read_provider_message, read_questions, read_record_array,
};
use super::display_projection::{ProjectionOptions, project_typed_part};
use super::file_change::{clear_projected_file_change, has_renderable_file_change};
use super::message_identity::find_agent_user_message;
use super::provider_activity_policy::{
    classify_provider_activity, is_transcript_activity, normalize_legacy_provider_activity,
    prune_provider_activities,
};
use super::provider_notice_policy::{
    is_non_diagnostic_provider_status_message, legacy_provider_connection_update,
    provider_activity_identity,
};
use super::transcript_indexes::{Projection, entry, revise};
use super::turn_lifecycle::reconcile_terminal_agent_turn;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::contract::event_content_update::{
    UpdateMode, agent_event_content_update, apply_agent_event_content_update,
};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::HashSet;
use std::sync::LazyLock;

pub use crate::agent::contract::display_state::create_empty_agent_display as create_agent_projection;

const MAX_COMMAND_OUTPUT: usize = 64 * 1024;
const MAX_MESSAGE_TEXT: usize = 128 * 1024;
const MAX_ACTIVITY_TEXT: usize = 64 * 1024;

/// `agentProjectionLimits`.
pub mod limits {
    pub const MAX_MESSAGE_TEXT: usize = super::MAX_MESSAGE_TEXT;
    pub const MAX_COMMAND_OUTPUT: usize = super::MAX_COMMAND_OUTPUT;
    pub const MAX_ACTIVITY_TEXT: usize = super::MAX_ACTIVITY_TEXT;
}

const ASSISTANT_SEGMENT_BOUNDARY_EVENTS: &[&str] = &[
    "user.message",
    "reasoning.summary.delta",
    "plan.updated",
    "tool.started",
    "tool.progress",
    "tool.completed",
    "command.output.delta",
    "file.change.updated",
    "approval.requested",
    "question.requested",
    "provider.warning",
    "provider.error",
];

static REFERENCE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("reference id pattern"));

fn read_prompt_mentions(value: Option<&Value>, prompt: &str, references: &[Value]) -> Vec<Value> {
    let Some(entries) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let reference_ids: HashSet<&str> = references.iter().filter_map(|r| r["id"].as_str()).collect();
    let length = js::len16(prompt) as i64;
    let mut boundary = 0;
    entries
        .iter()
        .filter(|entry| entry.is_object() || entry.is_array())
        .filter_map(|candidate| {
            let reference_id = js::str_or_empty(candidate.get("referenceId"));
            let start = candidate
                .get("start")
                .and_then(js::safe_integer)
                .unwrap_or(-1);
            let end = candidate
                .get("end")
                .and_then(js::safe_integer)
                .unwrap_or(-1);
            if !reference_ids.contains(reference_id)
                || start < boundary
                || end <= start
                || end > length
            {
                return None;
            }
            boundary = end;
            Some(json!({ "referenceId": reference_id, "start": start, "end": end }))
        })
        .collect()
}

/// `applyAgentEvents(initial, events, options)`.
pub fn apply_agent_events(
    initial: &AgentDisplay,
    events: &[Value],
    options: ProjectionOptions,
) -> AgentDisplay {
    let last = initial.last_sequence();
    let mut relevant: Vec<Value> = events
        .iter()
        .filter(|event| event.sequence() > last)
        .map(normalize_legacy_provider_activity)
        .collect();
    relevant.sort_by_key(|event| event.sequence());
    if relevant.is_empty() {
        return initial.clone();
    }
    let mut next = Projection::new(initial);
    for event in &relevant {
        if event.sequence() <= next.d.last_sequence() {
            continue;
        }
        apply_one(&mut next, event, options);
    }
    next.into_display()
}

/// `applyAgentEvent(previous, event, options)`.
pub fn apply_agent_event(
    previous: &AgentDisplay,
    event: &Value,
    options: ProjectionOptions,
) -> AgentDisplay {
    if event.sequence() <= previous.last_sequence() {
        return previous.clone();
    }
    let event = normalize_legacy_provider_activity(event);
    let mut next = Projection::new(previous);
    apply_one(&mut next, &event, options);
    next.into_display()
}

fn apply_one(next: &mut Projection, event: &Value, options: ProjectionOptions) {
    apply_legacy_agent_event(next, event, options);
    project_typed_part(next, event, options);
    reconcile_terminal_agent_turn(next, event);
    prune_provider_activities(next, event);
}

fn apply_legacy_agent_event(next: &mut Projection, event: &Value, options: ProjectionOptions) {
    let sequence = event.sequence();
    let last = next.d.last_sequence();
    if sequence <= last {
        return;
    }
    let gap = if last > 0 && sequence > last + 1 {
        Some((last + 1, sequence - 1))
    } else if last == 0 && sequence > 1 {
        Some((1, sequence - 1))
    } else {
        None
    };
    if let Some((from, to)) = gap {
        let mut ranges = next
            .d
            .get("missingRanges")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        ranges.push(json!({ "from": from, "to": to }));
        next.d.set("missingRanges", ranges);
    }
    next.d.set("lastSequence", sequence);
    let event_type = event.event_type();
    if ASSISTANT_SEGMENT_BOUNDARY_EVENTS.contains(&event_type)
        || (event_type == "provider.activity"
            && is_transcript_activity(&classify_provider_activity(event)))
    {
        seal_streaming_assistant_segments(next, event.turn_id());
    }

    match event_type {
        "session.started" | "session.resumed" => next.d.set("sessionState", "active"),
        "session.closed" => {
            next.d.set("sessionState", "closed");
            next.d.set("runningTurnId", Value::Null);
        }
        "turn.started" => {
            next.d.set("sessionState", "active");
            next.d.set("runningTurnId", event.turn_value());
            next.d.set("terminalState", Value::Null);
            let prompt = js::head16(event.text("prompt"), MAX_MESSAGE_TEXT).to_string();
            let references = read_reference_displays(event.field("referenceDisplays"));
            let prompt_mentions =
                read_prompt_mentions(event.field("promptMentions"), &prompt, &references);
            let user_message_id = event
                .field("userMessageId")
                .and_then(Value::as_str)
                .map(str::to_string);
            if find_agent_user_message(&next.d.messages, event).is_some() {
                let payload = Obj::from(event.payload()).set("text", prompt).build();
                upsert_user_message(next, &js::with(event, "payload", payload));
                return;
            }
            let turn_id = event
                .turn_id()
                .filter(|t| !t.is_empty())
                .map(str::to_string);
            let (d, indexes) = next.split();
            let turn_messages = turn_id
                .as_ref()
                .and_then(|turn| indexes.messages_by_turn.get(turn).cloned())
                .unwrap_or_default();
            let turn_has_user = turn_messages
                .iter()
                .any(|index| d.messages.get(*index).is_some_and(|m| m["role"] == "user"));
            if (!prompt.is_empty() || !references.is_empty()) && !turn_has_user {
                let message_index = d.messages.len();
                let identity = user_message_id
                    .clone()
                    .or_else(|| event.turn_id().map(str::to_string))
                    .unwrap_or_else(|| sequence.to_string());
                let id = format!("user:{identity}");
                let restored = js::truthy_opt(event.field("restored"));
                let mut message = Obj::new()
                    .set("id", id.clone())
                    .set("role", "user")
                    .set("turnId", event.turn_value())
                    .set(
                        "itemId",
                        if restored {
                            user_message_id.clone()
                        } else {
                            None
                        },
                    );
                if !restored {
                    message = message
                        .opt("clientUserMessageId", user_message_id.clone())
                        .opt("submissionId", event.field("submissionId").cloned());
                }
                let message = message
                    .set("text", prompt)
                    .set("references", references)
                    .set("promptMentions", prompt_mentions)
                    .set("streaming", false)
                    .set("terminalState", Value::Null)
                    .set("sequence", sequence)
                    .set("updatedSequence", sequence)
                    .build();
                d.messages.push(entry(message));
                indexes.messages.insert(id, message_index);
                if let Some(turn) = turn_id {
                    let mut list = turn_messages;
                    list.push(message_index);
                    indexes.messages_by_turn.insert(turn, list);
                }
            }
        }
        // The typed turn record is updated before the shared terminal reconciler
        // settles every compatibility collection and semantic part exactly once.
        "turn.completed" | "turn.failed" | "turn.interrupted" => {}
        "user.message" => upsert_user_message(next, event),
        "assistant.delta" => upsert_assistant(next, event, event.text("delta"), true, false),
        "assistant.completed" => upsert_assistant(next, event, event.text("text"), false, true),
        "reasoning.summary.delta" => {
            let update = agent_event_content_update(event);
            let value = activity_value(
                "reasoning",
                "",
                Some("reasoning-summary"),
                if js::truthy_opt(event.field("completed")) {
                    "completed"
                } else {
                    "running"
                },
                event.payload(),
            );
            upsert_activity(next, event, value, update.map(|u| u.field), event);
        }
        "plan.updated" => {
            let update = agent_event_content_update(event);
            let value = activity_value(
                "plan",
                "",
                Some("plan-updated"),
                if js::truthy_opt(event.field("completed")) {
                    "completed"
                } else {
                    "running"
                },
                event.payload(),
            );
            let identified = if event.item_id().is_none() {
                js::with(event, "itemId", "current-plan")
            } else {
                event.clone()
            };
            upsert_activity(next, &identified, value, update.map(|u| u.field), event);
        }
        "tool.started" | "tool.progress" | "tool.completed" => {
            let kind = match event.field("kind").and_then(Value::as_str) {
                Some("command") => "command",
                Some("file-change") => "file-change",
                _ => "tool",
            };
            let label = event.text("label");
            let status = normalize_agent_activity_status(
                event.field("status"),
                if event_type == "tool.completed" {
                    "completed"
                } else {
                    "running"
                },
            );
            let value = activity_value(
                kind,
                label,
                label.is_empty().then(|| default_tool_label_code(kind)),
                &status,
                event.payload(),
            );
            upsert_activity(next, event, value, None, event);
        }
        "command.output.delta" => {
            let id = activity_id(event);
            let delta = event.text("delta");
            let (d, indexes) = next.split();
            match indexes.activities.get(&id).copied() {
                None => {
                    let activity = Obj::new()
                        .set("id", id.clone())
                        .set("turnId", event.turn_value())
                        .set("itemId", event.item_value())
                        .set("kind", "command")
                        .set("label", "")
                        .set("labelCode", "command-output")
                        .set("status", "running")
                        .set("detail", json!({}))
                        .set("output", tail_bounded(delta, MAX_COMMAND_OUTPUT))
                        .set("sequence", sequence)
                        .set("updatedSequence", sequence)
                        .build();
                    indexes.activities.insert(id, d.activities.len());
                    d.activities.push(entry(activity));
                }
                Some(index) => {
                    let replace = event.field("updateMode") == Some(&Value::from("replace"));
                    let activity = &d.activities[index];
                    let output = if replace {
                        delta.to_string()
                    } else {
                        format!("{}{delta}", js::str_or_empty(activity.get("output")))
                    };
                    d.activities[index] = revise(activity, |a| {
                        a.insert(
                            "output".into(),
                            tail_bounded(&output, MAX_COMMAND_OUTPUT).into(),
                        );
                        a.insert("updatedSequence".into(), sequence.into());
                    });
                }
            }
        }
        "file.change.updated" => {
            if !has_renderable_file_change(event.payload()) {
                clear_projected_file_change(next, event);
                return;
            }
            let status = normalize_agent_activity_status(event.field("status"), "running");
            let value = activity_value(
                "file-change",
                "",
                Some(file_change_label_code(event.payload())),
                &status,
                event.payload(),
            );
            upsert_activity(next, event, value, None, event);
        }
        "usage.updated" => next.d.set("usage", pick_usage(event.payload())),
        "approval.requested" => {
            let request_id = event.text("requestId");
            let turn_id = event.turn_id().filter(|t| !t.is_empty());
            if request_id.is_empty()
                || turn_id.is_none()
                || next
                    .d
                    .approvals
                    .iter()
                    .any(|a| a["requestId"] == request_id)
            {
                return;
            }
            let title = event.text("title");
            let proposed = js::truthy_opt(event.field("proposedExecpolicyAmendment"))
                || event
                    .field("proposedNetworkPolicyAmendments")
                    .and_then(Value::as_array)
                    .is_some_and(|a| !a.is_empty());
            let approval = Obj::new()
                .set("requestId", request_id)
                .set("turnId", turn_id)
                .set("itemId", event.item_value())
                .set(
                    "kind",
                    if event.field("kind") == Some(&Value::from("file-change")) {
                        "file-change"
                    } else {
                        "command"
                    },
                )
                .set("title", title)
                .opt("titleCode", title.is_empty().then_some("approval-required"))
                .set("command", nullable_string(event.field("command")))
                .set("cwd", nullable_string(event.field("cwd")))
                .set(
                    "commandActions",
                    read_record_array(event.field("commandActions")),
                )
                .set(
                    "networkApprovalContext",
                    read_network_approval_context(event.field("networkApprovalContext")),
                )
                .set("grantRoot", nullable_string(event.field("grantRoot")))
                .set("policyChangeRequested", proposed)
                .set("reason", nullable_string(event.field("reason")))
                .set(
                    "availableDecisions",
                    read_approval_decisions(event.field("availableDecisions")),
                )
                .set("sequence", sequence)
                .build();
            next.d.approvals.push(entry(approval));
        }
        "approval.resolved" => {
            let request_id = event.text("requestId").to_string();
            next.d
                .approvals
                .retain(|a| a["requestId"] != request_id.as_str());
        }
        "question.requested" => {
            let request_id = event.text("requestId");
            let turn_id = event.turn_id().filter(|t| !t.is_empty());
            if request_id.is_empty()
                || turn_id.is_none()
                || next
                    .d
                    .questions
                    .iter()
                    .any(|q| q["requestId"] == request_id)
            {
                return;
            }
            let question = Obj::new()
                .set("requestId", request_id)
                .set("turnId", turn_id)
                .set("itemId", event.item_value())
                .set("questions", read_questions(event.field("questions")))
                .set("sequence", sequence)
                .build();
            next.d.questions.push(entry(question));
        }
        "question.resolved" => {
            let request_id = event.text("requestId").to_string();
            next.d
                .questions
                .retain(|q| q["requestId"] != request_id.as_str());
        }
        "provider.notification" | "provider.activity" => {
            let value = classify_provider_activity(event);
            upsert_activity(next, event, value, None, event);
        }
        "provider.warning" | "provider.error" => {
            let kind = if event_type == "provider.error" {
                "error"
            } else {
                "warning"
            };
            let label = read_provider_message(event.field("message"));
            let legacy = if options.legacy_provider_connection_warnings {
                legacy_provider_connection_update(event, &label)
            } else {
                None
            };
            if let Some(connection) = legacy {
                next.d.set(
                    "connectionStatus",
                    Obj::from(&connection)
                        .set("message", label)
                        .set("turnId", event.turn_value())
                        .set("sequence", sequence)
                        .build(),
                );
                return;
            }
            if !label.is_empty() && is_non_diagnostic_provider_status_message(&label) {
                return;
            }
            let identity = provider_activity_identity(
                next,
                event,
                if label.is_empty() { kind } else { &label },
            );
            let (d, indexes) = next.split();
            let existing_index = indexes.activities.get(&identity.id).copied();
            let existing = existing_index.map(|i| d.activities[i].clone());
            if existing.as_ref().is_some_and(|e| e["kind"] == "error") && kind == "warning" {
                return;
            }
            let item = match event.item_id() {
                Some(item) => Value::from(item),
                None => existing
                    .as_ref()
                    .and_then(|e| e.get("itemId").filter(|v| !v.is_null()).cloned())
                    .unwrap_or(Value::Null),
            };
            let activity = Obj::new()
                .set("id", identity.id.clone())
                .set("turnId", identity.turn_id)
                .set("itemId", item)
                .set("kind", kind)
                .set("label", label.as_str())
                .opt(
                    "labelCode",
                    label.is_empty().then_some(if kind == "error" {
                        "provider-error"
                    } else {
                        "provider-warning"
                    }),
                )
                .set("status", if kind == "error" { "failed" } else { "warning" })
                .set("detail", pick_safe_activity_detail(event.payload()))
                .set("output", "")
                .set(
                    "sequence",
                    existing
                        .as_ref()
                        .and_then(|e| e.get("sequence").cloned())
                        .unwrap_or(Value::from(sequence)),
                )
                .set("updatedSequence", sequence)
                .build();
            match existing_index {
                None => {
                    indexes.activities.insert(identity.id, d.activities.len());
                    d.activities.push(entry(activity));
                }
                Some(index) => d.activities[index] = entry(activity),
            }
        }
        _ => {}
    }
}

fn tail_bounded(text: &str, limit: usize) -> String {
    let length = js::len16(text);
    js::tail16(text, length.saturating_sub(limit)).to_string()
}

fn read_reference_displays(value: Option<&Value>) -> Vec<Value> {
    let Some(entries) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    entries
        .iter()
        .take(32)
        .filter(|entry| entry.is_object() || entry.is_array())
        .filter_map(|candidate| {
            let id = candidate
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| REFERENCE_ID.is_match(id))?;
            let display_name = candidate
                .get("displayName")
                .and_then(Value::as_str)
                .filter(|n| !n.is_empty())?;
            let kind = candidate.get("kind").and_then(Value::as_str).filter(|k| {
                matches!(*k, "workspace-file" | "workspace-directory" | "attachment")
            })?;
            let clean: String = display_name
                .chars()
                .filter(|c| *c > '\u{1f}' && *c != '\u{7f}')
                .collect();
            let text = |key: &str, limit: usize| {
                candidate
                    .get(key)
                    .and_then(Value::as_str)
                    .map(|v| js::head16(v, limit).to_string())
            };
            Some(
                Obj::new()
                    .set("id", id)
                    .set("kind", kind)
                    .set("displayName", js::head16(&clean, 512))
                    .opt("relativePath", text("relativePath", 4_096))
                    .opt("workspaceName", text("workspaceName", 512))
                    .opt("mime", text("mime", 200))
                    .opt(
                        "size",
                        candidate
                            .get("size")
                            .and_then(js::safe_integer)
                            .filter(|s| *s >= 0),
                    )
                    .build(),
            )
        })
        .collect()
}

/// Reconciles native user-message facts with the optimistic prompt
/// materialized by turn.started. Native item identity wins, while the
/// original ledger position and locally-known reference metadata remain
/// stable.
fn upsert_user_message(projection: &mut Projection, event: &Value) {
    let text = js::head16(event.text("text"), MAX_MESSAGE_TEXT).to_string();
    let references = read_reference_displays(event.field("referenceDisplays"));
    let prompt_mentions = read_prompt_mentions(event.field("promptMentions"), &text, &references);
    let sequence = event.sequence();
    let existing_index = find_agent_user_message(&projection.d.messages, event);
    let (d, indexes) = projection.split();
    let coalesce = |values: &[Option<&Value>]| {
        values
            .iter()
            .flatten()
            .find(|v| !v.is_null())
            .map(|v| (*v).clone())
    };
    if let Some(index) = existing_index {
        let existing = d.messages[index].clone();
        let event_turn = event.turn_id();
        let existing_turn = existing
            .get("turnId")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(turn) = event_turn.filter(|t| !t.is_empty())
            && Some(turn) != existing_turn.as_deref()
        {
            if let Some(old) = existing_turn.as_ref().filter(|t| !t.is_empty())
                && let Some(list) = indexes.messages_by_turn.get_mut(old)
            {
                list.retain(|i| *i != index);
            }
            indexes
                .messages_by_turn
                .entry(turn.to_string())
                .or_default()
                .push(index);
        }
        let client_id = coalesce(&[
            event.field("userMessageId"),
            event.field("clientUserMessageId"),
            existing.get("clientUserMessageId"),
        ]);
        let submission_id = coalesce(&[event.field("submissionId"), existing.get("submissionId")]);
        d.messages[index] = revise(&existing, |m| {
            if let Some(item) = event.item_id() {
                m.insert("itemId".into(), item.into());
            }
            if let Some(turn) = event.turn_id() {
                m.insert("turnId".into(), turn.into());
            }
            set_or_remove(m, "clientUserMessageId", client_id);
            set_or_remove(m, "submissionId", submission_id);
            // User messages are immutable. When Main already materialized the
            // submitted display prompt, the native echo only confirms identity; it
            // must not replace user-facing text with provider-compiled context.
            if !references.is_empty() {
                m.insert("references".into(), Value::Array(references));
            }
            if !prompt_mentions.is_empty() {
                m.insert("promptMentions".into(), Value::Array(prompt_mentions));
            }
            m.insert("updatedSequence".into(), sequence.into());
        });
        return;
    }
    let client_id = coalesce(&[
        event.field("userMessageId"),
        event.field("clientUserMessageId"),
    ]);
    let identity = client_id
        .as_ref()
        .map(|id| {
            id.as_str()
                .map(str::to_string)
                .unwrap_or_else(|| id.to_string())
        })
        .or_else(|| event.item_id().map(str::to_string))
        .unwrap_or_else(|| format!("event:{sequence}"));
    let id = format!("user:{identity}");
    let message_index = d.messages.len();
    let message = Obj::new()
        .set("id", id.clone())
        .opt("clientUserMessageId", client_id)
        .opt(
            "submissionId",
            event
                .field("submissionId")
                .filter(|v| !v.is_null())
                .cloned(),
        )
        .set("role", "user")
        .set("turnId", event.turn_value())
        .set("itemId", event.item_value())
        .set("text", text)
        .set("references", references)
        .set("promptMentions", prompt_mentions)
        .set("streaming", false)
        .set("terminalState", Value::Null)
        .set("sequence", sequence)
        .set("updatedSequence", sequence)
        .build();
    d.messages.push(entry(message));
    indexes.messages.insert(id, message_index);
    if let Some(turn) = event.turn_id().filter(|t| !t.is_empty()) {
        indexes
            .messages_by_turn
            .entry(turn.to_string())
            .or_default()
            .push(message_index);
    }
}

fn set_or_remove(map: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            map.insert(key.into(), value);
        }
        None => {
            map.shift_remove(key);
        }
    }
}

/// `projectAgentUserSubmission(display, command)`: materialize an admitted
/// input once, including queued and failed deliveries.
pub fn project_agent_user_submission(
    display: &AgentDisplay,
    command: Option<&Value>,
) -> AgentDisplay {
    let Some(command) = command else {
        return display.clone();
    };
    let Some(intent) = command.get("intent").filter(|i| js::truthy(i)) else {
        return display.clone();
    };
    let mut next = Projection::new(display);
    let event = json!({
        "type": "user.message",
        "sequence": display.last_sequence(),
        "turnId": null,
        "itemId": null,
        "payload": {
            "text": intent["prompt"],
            "userMessageId": command["userMessageId"],
            "submissionId": command["commandId"],
            "referenceDisplays": intent["referenceDisplays"],
            "promptMentions": intent["promptMentions"],
        },
    });
    upsert_user_message(&mut next, &event);
    project_typed_part(&mut next, &event, ProjectionOptions::default());
    next.into_display()
}

fn upsert_assistant(
    projection: &mut Projection,
    event: &Value,
    text: &str,
    streaming: bool,
    authoritative: bool,
) {
    let sequence = event.sequence();
    let native_identity = event
        .item_id()
        .or(event.turn_id())
        .map(str::to_string)
        .unwrap_or_else(|| sequence.to_string());
    let base_id = format!("assistant:{native_identity}");
    let turn_value = event.turn_value();
    let item = event.item_id();
    let d = &projection.d;
    let matching: Vec<usize> = d
        .messages
        .iter()
        .enumerate()
        .filter(|(_, message)| {
            message["role"] == "assistant"
                && message.get("turnId").cloned().unwrap_or(Value::Null) == turn_value
                && match item {
                    Some(item) => message.get("itemId").and_then(Value::as_str) == Some(item),
                    None => message.get("id").and_then(Value::as_str) == Some(base_id.as_str()),
                }
        })
        .map(|(index, _)| index)
        .collect();
    let latest_index = matching.last().copied();
    let latest = latest_index.map(|i| d.messages[i].clone());
    let joined = || {
        matching
            .iter()
            .map(|i| js::str_or_empty(d.messages[*i].get("text")))
            .collect::<String>()
    };
    let truncated_payload = event.field("truncated") == Some(&Value::Bool(true));
    let incomplete_prefix = authoritative && truncated_payload && joined().starts_with(text);
    let boundary_after_latest = latest.as_ref().is_some_and(|latest| {
        let latest_at = latest
            .get("updatedSequence")
            .filter(|v| !v.is_null())
            .or(latest.get("sequence"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        d.rows.iter().any(|row| {
            row.get("turnId").cloned().unwrap_or(Value::Null) == turn_value
                && !matches!(row["kind"].as_str(), Some("assistant" | "user" | "usage"))
                && row["sequence"].as_f64().unwrap_or(0.0) > latest_at
        })
    });
    let segmented_text = if boundary_after_latest {
        text_after_assistant_boundary(d, &matching, text, authoritative)
    } else if authoritative && matching.len() > 1 {
        text_for_existing_assistant_segment(d, &matching, text)
    } else {
        text.to_string()
    };
    let create_segment = !incomplete_prefix && boundary_after_latest && !segmented_text.is_empty();
    let id = if create_segment {
        format!("{base_id}:segment:{sequence}")
    } else {
        base_id
    };
    let existing_index = if create_segment { None } else { latest_index };
    let segment_length = js::len16(&segmented_text);
    let (d, indexes) = projection.split();
    if let Some(index) = existing_index {
        let existing = d.messages[index].clone();
        let existing_text = js::str_or_empty(existing.get("text"));
        let next_text = if incomplete_prefix {
            existing_text.to_string()
        } else if authoritative {
            if boundary_after_latest && !create_segment {
                existing_text.to_string()
            } else {
                js::head16(&segmented_text, MAX_MESSAGE_TEXT).to_string()
            }
        } else {
            append_bounded(existing_text, &segmented_text, MAX_MESSAGE_TEXT)
        };
        let truncated = truncated_payload
            || if authoritative {
                segment_length > MAX_MESSAGE_TEXT
            } else {
                existing.get("truncated") == Some(&Value::Bool(true))
                    || js::len16(existing_text) + segment_length > MAX_MESSAGE_TEXT
            };
        d.messages[index] = revise(&existing, |m| {
            m.insert("text".into(), next_text.into());
            m.insert("truncated".into(), truncated.into());
            m.insert("streaming".into(), streaming.into());
            m.insert("updatedSequence".into(), sequence.into());
        });
        return;
    }
    let message_index = d.messages.len();
    let message = Obj::new()
        .set("id", id.clone())
        .set("role", "assistant")
        .set("turnId", turn_value.clone())
        .set("itemId", event.item_value())
        .set("text", js::head16(&segmented_text, MAX_MESSAGE_TEXT))
        .set(
            "truncated",
            truncated_payload || segment_length > MAX_MESSAGE_TEXT,
        )
        .set("streaming", streaming)
        .set("terminalState", Value::Null)
        .set("sequence", sequence)
        .set("updatedSequence", sequence)
        .build();
    d.messages.push(entry(message));
    indexes.messages.insert(id, message_index);
    if let Some(turn) = event.turn_id().filter(|t| !t.is_empty()) {
        indexes
            .messages_by_turn
            .entry(turn.to_string())
            .or_default()
            .push(message_index);
    }
}

fn seal_streaming_assistant_segments(projection: &mut Projection, turn_id: Option<&str>) {
    let Some(turn_id) = turn_id.filter(|t| !t.is_empty()) else {
        return;
    };
    let d = &mut projection.d;
    let streaming_in_turn = |entry: &Value, key: &str| {
        entry[key] == "assistant" && entry["turnId"] == turn_id && entry["streaming"] == true
    };
    for message in d.messages.iter_mut() {
        if streaming_in_turn(message, "role") {
            *message = revise(message, |m| {
                m.insert("streaming".into(), false.into());
            });
        }
    }
    for part in d.parts.iter_mut() {
        if streaming_in_turn(part, "kind") {
            *part = revise(part, |p| {
                p.insert("streaming".into(), false.into());
            });
        }
    }
}

fn text_after_assistant_boundary(
    d: &AgentDisplay,
    matching: &[usize],
    incoming: &str,
    authoritative: bool,
) -> String {
    if !authoritative {
        return incoming.to_string();
    }
    let previous_text: String = matching
        .iter()
        .map(|i| js::str_or_empty(d.messages.get(*i).and_then(|m| m.get("text"))))
        .collect();
    if incoming.is_empty() || incoming == previous_text {
        return String::new();
    }
    if !previous_text.is_empty()
        && let Some(rest) = incoming.strip_prefix(previous_text.as_str())
    {
        return rest.to_string();
    }
    let latest_text = matching
        .last()
        .and_then(|i| d.messages.get(*i))
        .map(|m| js::str_or_empty(m.get("text")))
        .unwrap_or("");
    if !latest_text.is_empty()
        && let Some(rest) = incoming.strip_prefix(latest_text)
    {
        return rest.to_string();
    }
    incoming.to_string()
}

fn text_for_existing_assistant_segment(
    d: &AgentDisplay,
    matching: &[usize],
    incoming: &str,
) -> String {
    let prior: String = matching[..matching.len() - 1]
        .iter()
        .map(|i| js::str_or_empty(d.messages.get(*i).and_then(|m| m.get("text"))))
        .collect();
    if !prior.is_empty()
        && let Some(rest) = incoming.strip_prefix(prior.as_str())
    {
        return rest.to_string();
    }
    incoming.to_string()
}

/// `{ kind, label, labelCode, status, detail }` of an activity upsert.
fn activity_value(
    kind: &str,
    label: &str,
    label_code: Option<&str>,
    status: &str,
    detail: &Value,
) -> Value {
    Obj::new()
        .set("kind", kind)
        .set("label", label)
        .opt("labelCode", label_code)
        .set("status", status)
        .set("detail", detail.clone())
        .build()
}

fn upsert_activity(
    projection: &mut Projection,
    event: &Value,
    value: Value,
    detail_field: Option<&'static str>,
    content_event: &Value,
) {
    let id = activity_id(event);
    let safe_detail = pick_safe_activity_detail(&value["detail"]);
    let sequence = event.sequence();
    let (d, indexes) = projection.split();
    match indexes.activities.get(&id).copied() {
        Some(index) => {
            let existing = d.activities[index].clone();
            let detail = match detail_field {
                Some(field) => {
                    let current = js::str_or_empty(existing["detail"].get(field));
                    let mutation = apply_agent_event_content_update(
                        Some(current),
                        content_event,
                        Some(MAX_ACTIVITY_TEXT),
                    );
                    let text = match &mutation {
                        Some(mutation) => mutation.text.clone(),
                        None => {
                            js::head16(js::str_or_empty(safe_detail.get(field)), MAX_ACTIVITY_TEXT)
                                .to_string()
                        }
                    };
                    let mut detail = Obj::from(&existing["detail"])
                        .spread(&safe_detail)
                        .set(field, text)
                        .build();
                    match &mutation {
                        Some(mutation) if mutation.truncated => {
                            detail["truncated"] = Value::Bool(true)
                        }
                        Some(mutation) if mutation.mode == UpdateMode::Replace => {
                            js::delete(&mut detail, "truncated")
                        }
                        _ => {}
                    }
                    detail
                }
                None => Obj::from(&existing["detail"]).spread(&safe_detail).build(),
            };
            let label = js::str_or_empty(value.get("label"));
            let label_code = if label.is_empty() {
                value
                    .get("labelCode")
                    .filter(|c| !c.is_null())
                    .or(existing.get("labelCode"))
                    .cloned()
            } else {
                None
            };
            d.activities[index] = revise(&existing, |a| {
                if !label.is_empty() {
                    a.insert("label".into(), label.into());
                }
                set_or_remove(a, "labelCode", label_code);
                a.insert("status".into(), value["status"].clone());
                a.insert("detail".into(), detail);
                a.insert("updatedSequence".into(), sequence.into());
            });
        }
        None => {
            let initial = detail_field.and_then(|_| {
                apply_agent_event_content_update(Some(""), content_event, Some(MAX_ACTIVITY_TEXT))
            });
            let detail = match detail_field.zip(initial) {
                Some((field, mutation)) => {
                    let mut detail = Obj::from(&safe_detail).set(field, mutation.text);
                    if mutation.truncated {
                        detail.insert("truncated", true);
                    }
                    detail.build()
                }
                None => safe_detail,
            };
            let activity = Obj::new()
                .set("id", id.clone())
                .set("turnId", event.turn_value())
                .set("itemId", event.item_value())
                .spread(&value)
                .set("detail", detail)
                .set("output", "")
                .set("sequence", sequence)
                .set("updatedSequence", sequence)
                .build();
            indexes.activities.insert(id, d.activities.len());
            d.activities.push(entry(activity));
        }
    }
}

fn append_bounded(current: &str, incoming: &str, limit: usize) -> String {
    let current_length = js::len16(current);
    if current_length < limit {
        format!("{current}{}", js::head16(incoming, limit - current_length))
    } else {
        js::head16(current, limit).to_string()
    }
}

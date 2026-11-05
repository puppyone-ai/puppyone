//! The SessionActor half of
//! `tests/integration/agent/controls/electron.agent-session-control.test.mjs`
//! (the service and feed half lives with the application layer).
use super::agent_session_actor::{ActorOptions, EventInput, SessionActor};
use super::agent_session_control::{create_agent_session_control, reduce_control};
use crate::agent::contract::schema::assert_agent_session_control;
use crate::agent::contract::types::AgentEventView;
use core::prelude::v1::test;
use serde_json::{Value, json};

fn native_event(event_type: &str, turn_id: &str, payload: Value) -> Value {
    json!({ "type": event_type, "turnId": turn_id, "providerSessionId": "thread-1", "payload": payload })
}

fn append(actor: &SessionActor, event: Value) -> Value {
    actor
        .append_event(EventInput {
            session_id: "session-1".into(),
            runtime_id: "codex".into(),
            provider_session_id: Some("thread-1".into()),
            event,
        })
        .unwrap()
}

fn actor() -> SessionActor {
    SessionActor::new(ActorOptions::default()).unwrap()
}

fn contains(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(e)) => e
            .iter()
            .all(|(k, v)| a.get(k).is_some_and(|av| contains(av, v))),
        _ => actual == expected,
    }
}

macro_rules! assert_match {
    ($actual:expr, $expected:expr) => {{
        let actual: &Value = &$actual;
        let expected = $expected;
        assert!(
            contains(actual, &expected),
            "{actual:#} does not match {expected:#}"
        );
    }};
}

fn start_command() -> Value {
    json!({ "type": "command.received", "command": {
        "commandId": "command-1", "kind": "start", "status": "dispatching", "intentFingerprint": "fingerprint-1",
        "intent": { "prompt": "hello", "promptMentions": [], "referenceDisplays": [], "model": null, "effort": null, "mode": null },
    } })
}

#[test]
fn keeps_stale_terminal_facts_scoped_to_their_own_turn() {
    let actor = actor();
    append(&actor, native_event("turn.started", "A", json!({})));
    append(&actor, native_event("turn.interrupted", "A", json!({})));
    append(&actor, native_event("turn.started", "B", json!({})));
    append(&actor, native_event("turn.completed", "A", json!({})));
    assert_match!(
        actor.control()["execution"],
        json!({"status": "active", "activeTurnId": "B"})
    );
    assert!(
        actor.control()["terminalTurns"]
            .as_array()
            .unwrap()
            .contains(&json!("A"))
    );
}

#[test]
fn uses_one_deterministic_pure_reducer_for_live_folding_and_offline_reconstruction() {
    let mut started = native_event("turn.started", "A", json!({}));
    started["emittedAt"] = json!("2026-09-06T00:00:00.000Z");
    let mut completed = native_event("turn.completed", "A", json!({}));
    completed["emittedAt"] = json!("2026-09-06T00:00:01.000Z");
    let inputs = [
        json!({"type": "adapter.attached"}),
        start_command(),
        json!({"type": "command.dispatching", "commandId": "command-1", "operationId": "operation-1"}),
        json!({"type": "submission.prepared", "submission": {"commandId": "command-1", "operationId": "operation-1", "adapterGeneration": 1, "prompt": "hello", "promptMentions": [], "referenceDisplays": []}, "startedAtMs": 100}),
        json!({"type": "event.accepted", "event": started}),
        json!({"type": "event.accepted", "event": completed}),
        json!({"type": "command.accepted", "commandId": "command-1", "turnId": "A"}),
    ];
    let initial = create_agent_session_control("stream-1", "epoch-1", "idle", 0);
    let fold = || {
        inputs.iter().fold(initial.clone(), |control, input| {
            reduce_control(&control, input).unwrap()
        })
    };
    let (live, rebuilt) = (fold(), fold());
    assert_eq!(rebuilt, live);
    assert_match!(
        rebuilt["execution"],
        json!({"status": "ended", "nativeOutcome": "completed"})
    );
}

#[test]
fn records_a_late_command_ack_without_resurrecting_completed_execution() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    actor.dispatch(start_command()).unwrap();
    actor.dispatch(json!({"type": "command.dispatching", "commandId": "command-1", "operationId": "operation-1"})).unwrap();
    actor
        .dispatch(json!({"type": "submission.prepared", "submission": {"commandId": "command-1", "operationId": "operation-1", "adapterGeneration": 1, "prompt": "hello", "promptMentions": [], "referenceDisplays": []}}))
        .unwrap();
    append(&actor, native_event("turn.started", "A", json!({})));
    append(&actor, native_event("turn.completed", "A", json!({})));
    actor
        .dispatch(json!({"type": "command.accepted", "commandId": "command-1", "turnId": "A"}))
        .unwrap();
    assert_match!(
        actor.control()["execution"],
        json!({"status": "ended", "activeTurnId": null, "nativeOutcome": "completed"})
    );
    let command = actor.control()["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["commandId"] == "command-1")
        .unwrap()
        .clone();
    assert_eq!(command["status"], "accepted");
    let revision = actor.control()["revision"].clone();
    actor
        .dispatch(json!({"type": "command.accepted", "commandId": "command-1", "turnId": "A"}))
        .unwrap();
    assert_eq!(actor.control()["revision"], revision);
}

#[test]
fn keeps_an_unconfirmed_active_outcome_unknown_when_the_product_session_closes() {
    let actor = actor();
    append(&actor, native_event("turn.started", "A", json!({})));
    append(
        &actor,
        json!({"type": "session.closed", "providerSessionId": "thread-1", "payload": {"status": "closed"}}),
    );
    assert_match!(
        actor.control()["execution"],
        json!({
            "status": "outcome-unknown", "activeTurnId": null, "uncertainTurnId": "A", "nativeOutcome": null, "certainty": "unknown",
        })
    );
}

#[test]
fn rejects_receipts_from_an_older_adapter_generation() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    let revision = actor.control()["revision"].clone();
    actor
        .dispatch(json!({"type": "adapter.exited", "adapterGeneration": 1, "reason": "late-exit"}))
        .unwrap();
    assert_eq!(actor.control()["revision"], revision);
    assert_eq!(actor.control()["connection"]["status"], "connected");
}

#[test]
fn settles_in_flight_commands_when_an_adapter_generation_is_replaced() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    actor
        .dispatch(json!({"type": "command.received", "command": {"commandId": "replace-me", "kind": "steer", "status": "dispatching", "intentFingerprint": "fingerprint-1"}}))
        .unwrap();
    actor.dispatch(json!({"type": "command.dispatching", "commandId": "replace-me", "operationId": "operation-old"})).unwrap();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    actor
        .dispatch(json!({"type": "command.accepted", "commandId": "replace-me", "operationId": "operation-old", "turnId": "A"}))
        .unwrap();
    let command = actor.control()["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["commandId"] == "replace-me")
        .unwrap()
        .clone();
    assert_match!(
        command,
        json!({"status": "outcome-unknown", "error": "adapter-generation-changed"})
    );
}

#[test]
fn does_not_infer_a_live_turn_from_persisted_or_restored_history() {
    let historical_start = json!({
        "schemaVersion": 1, "sequence": 1, "sessionId": "session-1", "runtimeId": "codex", "provider": "codex",
        "providerSessionId": "thread-1", "turnId": "A", "itemId": null, "emittedAt": "2026-09-06T00:00:00.000Z",
        "type": "turn.started", "payload": {"status": "running"},
    });
    let restored = SessionActor::new(ActorOptions {
        events: vec![historical_start],
        sequence: 1,
        terminal_state: Some("running".into()),
        clock: None,
    })
    .unwrap();
    assert_match!(
        restored.control()["execution"],
        json!({"status": "outcome-unknown", "activeTurnId": null, "uncertainTurnId": "A", "certainty": "unknown"})
    );
    append(
        &restored,
        native_event(
            "turn.completed",
            "A",
            json!({"status": "completed", "restored": true}),
        ),
    );
    assert_match!(
        restored.control()["execution"],
        json!({"status": "ended", "uncertainTurnId": null, "nativeOutcome": "completed", "certainty": "confirmed"})
    );

    let live = actor();
    append(
        &live,
        native_event(
            "turn.started",
            "A",
            json!({"status": "running", "restored": true}),
        ),
    );
    assert!(live.control()["execution"]["activeTurnId"].is_null());
}

#[test]
fn carries_structured_recovery_presentation_in_the_authoritative_control_snapshot() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    append(
        &actor,
        native_event(
            "provider.connection.updated",
            "A",
            json!({"state": "fallback", "message": "Switching transport", "attempt": 2, "maxAttempts": 5}),
        ),
    );
    assert_eq!(actor.control()["connection"]["status"], "connected");
    assert_match!(
        actor.control()["recoveries"][0],
        json!({
            "scope": "upstream-request", "message": "Switching transport", "state": "fallback", "attempt": 2, "maxAttempts": 5,
        })
    );
    assert!(assert_agent_session_control(&actor.control(), "Agent session control").is_ok());
}

#[test]
fn materializes_the_evicted_prefix_of_a_long_active_turn() {
    let actor = actor();
    append(
        &actor,
        native_event("turn.started", "A", json!({"status": "running"})),
    );
    let mut approval = native_event(
        "approval.requested",
        "A",
        json!({"requestId": "approval-A", "kind": "command"}),
    );
    approval["itemId"] = json!("tool-A");
    append(&actor, approval);
    for _ in 0..1_100 {
        let mut delta = native_event("assistant.delta", "A", json!({"delta": "x"}));
        delta["itemId"] = json!("message-A");
        append(&actor, delta);
    }
    let snapshot = actor.snapshot();
    assert_eq!(snapshot.timeline["events"].as_array().unwrap().len(), 1_000);
    assert_eq!(snapshot.timeline["partial"], true);
    let checkpoints = snapshot.timeline["checkpointEvents"].as_array().unwrap();
    assert!(
        checkpoints
            .iter()
            .any(|e| e.event_type() == "turn.started" && e.turn_id() == Some("A"))
    );
    assert!(checkpoints.iter().any(
        |e| e.event_type() == "approval.requested" && e["payload"]["requestId"] == "approval-A"
    ));
    assert!(
        checkpoints
            .iter()
            .any(|e| e.event_type() == "assistant.delta"
                && e.item_id() == Some("message-A")
                && e["payload"]["delta"] == "x".repeat(100))
    );
    assert_match!(
        snapshot.control["execution"],
        json!({"status": "active", "activeTurnId": "A"})
    );
    let approvals = snapshot.control["interaction"]["approvals"]
        .as_array()
        .unwrap();
    assert_eq!(approvals.len(), 1);
    assert_match!(
        approvals[0],
        json!({"requestId": "approval-A", "turnId": "A"})
    );
}

// `tests/integration/agent/events/electron.agent-display-contract.test.mjs`
// (the adapter-normalizer cases live with their runtimes).

fn product_event(actor: &SessionActor, value: Value) -> Value {
    actor
        .append_event(EventInput {
            session_id: "product-session".into(),
            runtime_id: "codex".into(),
            provider_session_id: Some("native-session".into()),
            event: value,
        })
        .unwrap()
}

fn command(actor: &SessionActor, id: &str, status: &str) {
    actor
        .dispatch(json!({"type": "command.received", "command": {
            "commandId": id, "kind": "start", "status": status, "operationId": format!("operation-{id}"),
            "intentFingerprint": id, "userMessageId": format!("client-{id}"),
            "intent": {"prompt": "你好", "referenceDisplays": [], "promptMentions": [], "model": null, "effort": null, "mode": null},
        }}))
        .unwrap();
}

#[test]
fn does_not_reopen_recovery_presentation_for_an_uncorrelated_retry_after_completion() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    product_event(
        &actor,
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {}}),
    );
    product_event(
        &actor,
        json!({"type": "turn.completed", "turnId": "turn-1", "payload": {}}),
    );
    product_event(
        &actor,
        json!({"type": "provider.connection.updated", "payload": {"state": "reconnecting", "message": "Late retry"}}),
    );
    assert!(actor.display().get("connectionStatus").unwrap().is_null());
    assert_eq!(actor.control()["recoveries"], json!([]));
}

#[test]
fn keeps_a_transport_recovery_separate_from_a_completed_upstream_turn() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    product_event(
        &actor,
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {}}),
    );
    product_event(
        &actor,
        json!({"type": "provider.connection.updated", "payload": {"state": "reconnecting", "scope": "transport", "recoveryId": "connection-recovery"}}),
    );
    product_event(
        &actor,
        json!({"type": "turn.completed", "turnId": "turn-1", "payload": {}}),
    );
    assert_eq!(actor.control()["connection"]["status"], "recovering");
    assert!(!actor.display().get("connectionStatus").unwrap().is_null());
}

#[test]
fn reconstructs_the_exact_committed_display_from_structural_patches() {
    use crate::agent::contract::display_schema::assert_agent_display_patch;
    use crate::agent::contract::display_state::apply_agent_display_patch;
    use std::cell::RefCell;
    use std::rc::Rc;
    let actor = actor();
    let replica = Rc::new(RefCell::new(actor.display()));
    let target = replica.clone();
    actor.subscribe(move |commit| {
        assert_agent_display_patch(&commit.display_patch).unwrap();
        let patch: Value = serde_json::from_str(&commit.display_patch.to_string()).unwrap();
        let next = apply_agent_display_patch(&target.borrow(), &patch).unwrap();
        *target.borrow_mut() = next;
    });
    product_event(
        &actor,
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {"prompt": "Hello"}}),
    );
    product_event(
        &actor,
        json!({"type": "assistant.delta", "turnId": "turn-1", "itemId": "answer", "payload": {"delta": "x".repeat(512)}}),
    );
    product_event(
        &actor,
        json!({"type": "assistant.delta", "turnId": "turn-1", "itemId": "answer", "payload": {"delta": "tail"}}),
    );
    product_event(
        &actor,
        json!({"type": "assistant.completed", "turnId": "turn-1", "itemId": "answer", "payload": {"text": "Authoritative replacement"}}),
    );
    product_event(
        &actor,
        json!({"type": "turn.completed", "turnId": "turn-1", "payload": {}}),
    );
    assert_eq!(
        replica.borrow().to_value(),
        actor.snapshot().display.to_value()
    );
}

#[test]
fn publishes_reentrant_commits_in_revision_order_for_every_subscriber() {
    use std::cell::RefCell;
    use std::rc::Rc;
    let actor = actor();
    let revisions = Rc::new(RefCell::new(Vec::new()));
    let reentrant = actor.clone();
    actor.subscribe(move |commit| {
        if commit.revision == 1 {
            reentrant
                .dispatch(json!({"type": "connection.connecting"}))
                .unwrap();
        }
    });
    let seen = revisions.clone();
    actor.subscribe(move |commit| seen.borrow_mut().push(commit.revision));
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    assert_eq!(*revisions.borrow(), [1, 2]);
}

#[test]
fn settles_uncertain_tool_and_assistant_presentation_without_inventing_a_native_outcome() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    product_event(
        &actor,
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {}}),
    );
    product_event(
        &actor,
        json!({"type": "assistant.delta", "turnId": "turn-1", "itemId": "answer", "payload": {"delta": "Partial"}}),
    );
    product_event(
        &actor,
        json!({"type": "tool.started", "turnId": "turn-1", "itemId": "tool", "payload": {"tool": "Read"}}),
    );
    actor
        .dispatch(json!({"type": "recovery.unconfirmed", "reason": "connection-lost"}))
        .unwrap();
    let display = actor.display();
    assert_eq!(display.messages[0]["streaming"], false);
    assert_eq!(display.activities[0]["status"], "unknown");
    assert_eq!(display.turns[0]["status"], "outcome-unknown");
    assert!(!display.parts.iter().any(|p| p["kind"] == "turn-summary"));
}

#[test]
fn bounds_historical_turn_metadata_even_when_the_source_provides_no_renderable_parts() {
    use super::transcript::display_window::bound_agent_display;
    use crate::agent::contract::display_schema::assert_display;
    use std::sync::Arc;
    let actor = actor();
    let mut display = actor.display();
    display.turns = (0..2_100)
        .map(|i| Arc::new(json!({"id": format!("empty-{i}"), "status": "outcome-unknown", "startedAtSequence": i, "startedAtMs": null, "completedAtSequence": null, "durationMs": null, "partIds": []})))
        .collect();
    let bounded = bound_agent_display(display, &actor.control());
    assert_eq!(bounded.get("displayWindow").unwrap()["truncated"], true);
    assert!(bounded.turns.len() < 2_000);
    assert!(assert_display(&bounded).is_ok());
}

#[test]
fn bounds_large_content_by_bytes_as_well_as_entry_count_and_keeps_the_active_input() {
    use crate::agent::contract::display_schema::assert_display;
    let actor = actor();
    command(&actor, "command-1", "dispatching");
    product_event(
        &actor,
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {"prompt": "Hello", "userMessageId": "client-command-1"}}),
    );
    for index in 0..50 {
        product_event(
            &actor,
            json!({"type": "assistant.completed", "turnId": "turn-1", "itemId": format!("answer-{index}"), "payload": {"text": "中".repeat(60_000)}}),
        );
    }
    let display = actor.display();
    assert_eq!(display.get("displayWindow").unwrap()["truncated"], true);
    assert!(display.messages.iter().any(|m| m["role"] == "user"));
    assert_eq!(display.messages.last().unwrap()["itemId"], "answer-49");
    assert!(assert_display(&display).is_ok());
}

// `tests/unit/agent/events/provider-activity-routing.test.mjs` (the
// Claude, Codex and Pi normalizer cases live with their runtimes).

fn pi_commit(actor: &SessionActor, event: Value) {
    actor
        .append_event(EventInput {
            session_id: "session".into(),
            runtime_id: "pi".into(),
            provider_session_id: None,
            event,
        })
        .unwrap();
}

fn pi_envelope(
    sequence: i64,
    event_type: &str,
    payload: Value,
    item_id: Option<&str>,
    turn_id: Option<&str>,
) -> Result<Value, crate::agent::contract::ContractError> {
    crate::agent::agent_events::create_agent_event_envelope(
        crate::agent::agent_events::EnvelopeInput {
            sequence,
            session_id: "session".into(),
            runtime_id: "pi".into(),
            turn_id: turn_id.map(str::to_string),
            item_id: item_id.map(str::to_string),
            event_type: event_type.into(),
            payload,
            ..Default::default()
        },
    )
}

fn replay(events: &[Value]) -> crate::agent::contract::display_types::AgentDisplay {
    use super::transcript::display_projection::ProjectionOptions;
    use super::transcript::transcript_reducer::{apply_agent_events, create_agent_projection};
    apply_agent_events(
        &create_agent_projection(),
        events,
        ProjectionOptions::default(),
    )
}

fn kinds(entries: &[crate::agent::contract::display_types::Entry], key: &str) -> Vec<Value> {
    entries.iter().map(|entry| entry[key].clone()).collect()
}

#[test]
fn preserves_notification_text_through_sanitization_snapshots_and_replay() {
    use super::agent_event_checkpoint::fold_agent_event_checkpoint;
    use crate::agent::contract::display_schema::{assert_agent_display_patch, assert_display};
    use crate::agent::contract::display_state::{
        apply_agent_display_patch, create_agent_display_patch,
    };
    for severity in ["info", "warning", "error"] {
        let actor = actor();
        pi_commit(
            &actor,
            json!({"type": "turn.started", "turnId": "turn", "payload": {"prompt": "Hello"}}),
        );
        let before = actor.display();
        let notice = json!({"type": "provider.notification", "turnId": "turn", "itemId": "notice", "payload": {"message": "A useful notice", "severity": severity, "source": "Extension"}});
        pi_commit(&actor, notice.clone());
        pi_commit(&actor, notice);
        let display = actor.display();
        assert_eq!(display.activities.len(), 1);
        assert_match!(
            display.activities[0],
            json!({"kind": "notification", "label": "A useful notice", "detail": {"severity": severity, "source": "Extension"}})
        );
        assert_eq!(actor.control()["execution"]["status"], "active");
        let patch = create_agent_display_patch(&before, &display);
        assert_agent_display_patch(&patch).unwrap();
        let replica = apply_agent_display_patch(&before, &patch).unwrap();
        assert_display(&replica).unwrap();
        assert_eq!(replica.to_value(), display.to_value());
        let replayed = replay(&actor.events());
        assert_eq!(
            kinds(&replayed.activities, "id"),
            kinds(&display.activities, "id")
        );
        assert_eq!(replayed.activities[0], display.activities[0]);
        assert_eq!(kinds(&replayed.rows, "kind"), [json!("user")]);
        let folded = actor.events().iter().fold(Vec::new(), |prefix, event| {
            fold_agent_event_checkpoint(&prefix, event)
        });
        assert!(
            !folded
                .iter()
                .any(|event| event["type"] == "provider.notification")
        );
    }
}

#[test]
fn isolates_late_and_reused_notice_identities_without_inventing_turns_or_changing_the_active_turn()
{
    let actor = actor();
    pi_commit(
        &actor,
        json!({"type": "turn.started", "turnId": "current", "payload": {}}),
    );
    for turn_id in [json!("older"), json!("current"), Value::Null] {
        pi_commit(
            &actor,
            json!({"type": "provider.notification", "turnId": turn_id, "itemId": "reused", "payload": {"severity": "error", "message": "Extension failed"}}),
        );
    }
    let display = actor.display();
    assert_eq!(display.activities.len(), 3);
    assert_eq!(kinds(&display.turns, "id"), [json!("current")]);
    assert_eq!(actor.control()["execution"]["activeTurnId"], "current");
    assert_eq!(actor.control()["execution"]["status"], "active");
}

#[test]
fn bounds_auxiliary_notices_without_consuming_transcript_geometry_or_tool_identity() {
    use crate::agent::contract::display_schema::assert_display;
    let actor = actor();
    pi_commit(
        &actor,
        json!({"type": "tool.completed", "turnId": "turn", "itemId": "notice-0", "payload": {"tool": "custom", "status": "completed"}}),
    );
    for i in 0..80 {
        pi_commit(
            &actor,
            json!({"type": "provider.notification", "turnId": "turn", "itemId": format!("notice-{i}"), "payload": {"severity": "info", "message": format!("Notice {i}")}}),
        );
    }
    let display = actor.display();
    assert_eq!(
        display
            .activities
            .iter()
            .filter(|a| a["kind"] == "notification")
            .count(),
        32
    );
    assert!(display.activities.iter().any(|a| a["kind"] == "tool"));
    assert_eq!(kinds(&display.rows, "kind"), [json!("tool")]);
    assert_eq!(display.parts.len(), 33);
    assert_display(&display).unwrap();
}

#[test]
fn routes_legacy_notifications_and_unrecognized_provider_statuses_away_from_tools() {
    let display = replay(&[
        pi_envelope(
            1,
            "provider.activity",
            json!({"message": "Old notification", "label": "Pi extension", "status": "completed"}),
            Some("pi:extension:old"),
            Some("turn"),
        )
        .unwrap(),
        pi_envelope(
            2,
            "provider.activity",
            json!({"message": "A future status", "status": "teleporting", "tool": "not-a-call"}),
            Some("future"),
            Some("turn"),
        )
        .unwrap(),
    ]);
    assert_eq!(
        kinds(&display.activities, "kind"),
        [json!("notification"), json!("system")]
    );
    assert_eq!(
        kinds(&display.activities, "label"),
        [json!("Old notification"), json!("A future status")]
    );
    assert!(display.rows.is_empty());
    assert!(display.turns.is_empty());
}

#[test]
fn routes_older_journal_compaction_as_a_system_activity() {
    for phase in ["started", "completed"] {
        let status = if phase == "started" {
            "running"
        } else {
            "completed"
        };
        let display = replay(&[pi_envelope(
            1,
            &format!("tool.{phase}"),
            json!({"kind": "system", "tool": "compaction", "status": status}),
            Some("compact"),
            Some("turn"),
        )
        .unwrap()]);
        assert_match!(
            display.activities[0],
            json!({"kind": "system", "detail": {"category": "compaction"}})
        );
        assert_eq!(kinds(&display.rows, "kind"), [json!("system")]);
    }
}

#[test]
fn does_not_invent_successful_compaction_from_a_completed_parent_turn_or_merge_separate_turns() {
    let display = replay(&[
        pi_envelope(
            1,
            "provider.activity",
            json!({"category": "compaction", "status": "running"}),
            Some("pi:compaction"),
            Some("turn-1"),
        )
        .unwrap(),
        pi_envelope(2, "turn.completed", json!({}), None, Some("turn-1")).unwrap(),
        pi_envelope(
            3,
            "provider.activity",
            json!({"category": "compaction", "status": "completed"}),
            Some("pi:compaction"),
            Some("turn-2"),
        )
        .unwrap(),
    ]);
    assert_eq!(
        kinds(&display.activities, "status"),
        [json!("unknown"), json!("completed")]
    );
    assert_eq!(
        kinds(&display.parts, "status"),
        [json!("unknown"), json!("completed")]
    );
    assert_eq!(display.rows.len(), 2);
}

#[test]
fn rejects_malformed_notification_contracts() {
    for payload in [
        json!({"severity": "success", "message": "Notice"}),
        json!({"severity": "info", "message": ""}),
    ] {
        assert!(
            pi_envelope(
                1,
                "provider.notification",
                payload,
                Some("item"),
                Some("turn")
            )
            .is_err()
        );
    }
}

// `tests/unit/agent/references/electron.agent-event-workspace-paths.test.mjs`
// (live delivery through the journal lives with the application layer).

#[test]
fn normalizes_absolute_codex_file_change_paths_before_renderer_delivery() {
    use super::agent_event_workspace_paths::normalize_agent_event_workspace_paths;
    let original = json!({"type": "file.change.updated", "payload": {
        "label": "Edit /Users/example/project/docs/notes.md",
        "path": "/Users/example/project/docs/notes.md",
        "changes": [{"path": "/Users/example/project/docs/notes.md", "additions": 1, "deletions": 0}],
        "input": {"changes": [{"path": "/Users/example/project/src/App.tsx", "kind": "update"}]},
    }});
    assert_eq!(
        normalize_agent_event_workspace_paths(&original, "/Users/example/project"),
        json!({"type": "file.change.updated", "payload": {
            "label": "Edit docs/notes.md",
            "path": "docs/notes.md",
            "changes": [{"path": "docs/notes.md", "additions": 1, "deletions": 0}],
            "input": {"changes": [{"path": "src/App.tsx", "kind": "update"}]},
        }})
    );
    assert_eq!(
        original["payload"]["path"],
        "/Users/example/project/docs/notes.md"
    );
}

#[test]
fn fails_closed_for_paths_owned_by_another_workspace_folder() {
    use super::agent_event_workspace_paths::normalize_agent_event_workspace_paths;
    let event = json!({"type": "tool.completed", "payload": {
        "label": "Edit /Users/example/project-b/private.md",
        "path": "/Users/example/project-b/private.md",
        "changes": [{"path": "/Users/example/project-b/private.md"}],
    }});
    assert_eq!(
        normalize_agent_event_workspace_paths(&event, "/Users/example/project-a"),
        json!({"type": "tool.completed", "payload": {"label": "Edit private.md", "changes": []}})
    );
}

// `tests/unit/agent/references/electron.agent-file-change-evidence.test.mjs`
// (the per-runtime and ACP/Pi cases live with their protocols).

#[test]
fn preserves_old_journal_edit_fragments_in_main_without_changing_the_recorded_event() {
    let event = json!({
        "schemaVersion": 1, "sequence": 1, "sessionId": "session", "runtimeId": "claude", "provider": "claude",
        "providerSessionId": "native", "turnId": "turn", "itemId": "edit", "type": "tool.completed", "emittedAt": "2026-09-07T00:00:00Z",
        "payload": {"kind": "file-change", "tool": "edit", "status": "completed", "path": "src/file.ts",
            "input": {"old_string": "  old", "new_string": "  new"}},
    });
    let actor = SessionActor::new(ActorOptions {
        events: vec![event.clone()],
        ..Default::default()
    })
    .unwrap();
    assert!(
        actor.display().parts[0]["detail"]["changes"][0]["diff"]
            .as_str()
            .unwrap()
            .contains("-  old\n+  new")
    );
    assert_eq!(actor.events()[0], event);
    let mut cleared_event = event.clone();
    cleared_event["payload"]["changes"] = json!([]);
    let cleared = SessionActor::new(ActorOptions {
        events: vec![cleared_event],
        ..Default::default()
    })
    .unwrap();
    assert_eq!(cleared.display().parts[0]["detail"]["changes"], json!([]));
}

// `tests/unit/agent/history/electron.agent-history-display-status.test.mjs`.

#[test]
fn clears_partial_or_unknown_coverage_through_a_committed_display_patch_after_complete_recovery() {
    use crate::agent::contract::display_schema::{assert_agent_display_patch, assert_display};
    use crate::agent::contract::display_state::apply_agent_display_patch;
    use std::cell::RefCell;
    use std::rc::Rc;
    for coverage in ["partial", "unknown"] {
        let actor = SessionActor::new(ActorOptions {
            sequence: 42,
            ..Default::default()
        })
        .unwrap();
        let replica = Rc::new(RefCell::new(actor.display()));
        let target = replica.clone();
        actor.subscribe(move |commit| {
            assert_agent_display_patch(&commit.display_patch).unwrap();
            let next = apply_agent_display_patch(&target.borrow(), &commit.display_patch).unwrap();
            assert_display(&next).unwrap();
            *target.borrow_mut() = next;
        });
        actor
            .append_event(EventInput {
                session_id: "product".into(),
                runtime_id: "codex".into(),
                provider_session_id: Some("native".into()),
                event: json!({"type": "assistant.completed", "turnId": "turn", "itemId": "answer", "payload": {"text": "Recovered answer"}}),
            })
            .unwrap();
        actor
            .dispatch(
                json!({"type": "history.loaded", "coverage": coverage, "reason": "unverified"}),
            )
            .unwrap();
        assert_eq!(
            replica.borrow().get("history").unwrap()["coverage"],
            coverage
        );
        let messages = kinds(&replica.borrow().messages, "id");
        actor
            .dispatch(json!({"type": "history.loaded", "coverage": "complete"}))
            .unwrap();
        assert_eq!(
            replica.borrow().get("history").unwrap(),
            &json!({"coverage": "complete", "reason": null})
        );
        assert_eq!(kinds(&replica.borrow().messages, "id"), messages);
        assert_eq!(replica.borrow().get("missingRanges").unwrap(), &json!([]));
        assert_eq!(actor.sequence(), 43);
    }
}

#[test]
fn does_not_clear_real_display_truncation_when_native_history_is_complete() {
    let actor = actor();
    for i in 0..50 {
        product_event(
            &actor,
            json!({"type": "assistant.completed", "turnId": "turn", "itemId": format!("answer-{i}"), "payload": {"text": "中".repeat(60_000)}}),
        );
    }
    assert_eq!(
        actor.display().get("displayWindow").unwrap()["truncated"],
        true
    );
    actor
        .dispatch(json!({"type": "history.loaded", "coverage": "complete"}))
        .unwrap();
    let display = actor.display();
    assert_eq!(display.get("history").unwrap()["coverage"], "complete");
    assert_eq!(display.get("displayWindow").unwrap()["truncated"], true);
    assert_eq!(display.messages.last().unwrap()["itemId"], "answer-49");
}

#[test]
fn keeps_native_coverage_independent_of_lost_live_execution_observation() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    actor
        .dispatch(json!({"type": "history.loaded", "coverage": "complete"}))
        .unwrap();
    product_event(
        &actor,
        json!({"type": "turn.started", "turnId": "active", "payload": {}}),
    );
    let generation = actor.control()["adapterGeneration"].clone();
    actor.dispatch(json!({"type": "adapter.exited", "adapterGeneration": generation, "reason": "connection-lost"})).unwrap();
    assert_eq!(
        actor.display().get("history").unwrap()["coverage"],
        "complete"
    );
    assert_eq!(actor.control()["execution"]["status"], "outcome-unknown");
}

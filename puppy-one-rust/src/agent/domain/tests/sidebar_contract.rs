//! `tests/unit/workbench/item-hosts/electron.agent-sidebar-contracts.test.mjs`:
//! the SessionActor's protocol and display invariants (the service, feed and
//! provider halves live with their layers).
use super::agent_session_actor::{ActorOptions, EventInput, SessionActor};
use core::prelude::v1::test;
use serde_json::{Value, json};

fn append(actor: &SessionActor, event: Value) {
    actor
        .append_event(EventInput {
            session_id: "session".into(),
            runtime_id: "codex".into(),
            provider_session_id: Some("thread".into()),
            event,
        })
        .unwrap();
}

fn admit(actor: &SessionActor, id: &str, prompt: &str, status: &str) {
    actor
        .dispatch(json!({"type": "command.received", "command": {
            "commandId": id, "operationId": format!("operation:{id}"), "kind": "start", "status": status,
            "intentFingerprint": format!("fingerprint:{id}"), "userMessageId": format!("client:{id}"),
            "intent": {"prompt": prompt, "promptMentions": [], "referenceDisplays": [], "model": null, "effort": null, "mode": null},
        }}))
        .unwrap();
}

fn actor() -> SessionActor {
    SessionActor::new(ActorOptions::default()).unwrap()
}

fn users(actor: &SessionActor) -> Vec<Value> {
    actor
        .display()
        .parts
        .iter()
        .filter(|p| p["kind"] == "user")
        .map(|p| (**p).clone())
        .collect()
}

fn command(actor: &SessionActor, id: &str) -> Option<Value> {
    actor.control()["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["commandId"] == id)
        .cloned()
}

/// `retains and later confirms an ambiguous command instead of evicting or
/// resending it`.
#[test]
fn an_ambiguous_command_is_kept_and_confirmed_by_its_native_turn() {
    let actor = actor();
    admit(&actor, "input", "Hello", "dispatching");
    actor
        .dispatch(json!({"type": "command.outcome-unknown", "commandId": "input"}))
        .unwrap();
    for index in 0..140 {
        let id = format!("later-{index}");
        admit(&actor, &id, "Hello", "dispatching");
        actor
            .dispatch(json!({"type": "command.rejected", "commandId": id}))
            .unwrap();
    }
    assert!(command(&actor, "input").is_some());
    append(
        &actor,
        json!({"type": "turn.started", "turnId": "late-turn", "payload": {"userMessageId": "client:input"}}),
    );
    let input = command(&actor, "input").unwrap();
    assert_eq!(
        (input["status"].clone(), input["targetTurnId"].clone()),
        (json!("accepted"), json!("late-turn"))
    );
    assert_eq!(
        users(&actor)
            .iter()
            .filter(|p| p["submissionId"] == "input")
            .count(),
        1
    );
}

/// `materializes one queued / dispatching input at admission and joins
/// native identity without another bubble`.
#[test]
fn an_admitted_input_shows_once_and_joins_its_native_identity() {
    for status in ["queued", "dispatching"] {
        let actor = actor();
        admit(&actor, "input", "Hello", status);
        let parts = users(&actor);
        assert_eq!(parts.len(), 1, "{status}");
        assert_eq!(
            (
                parts[0]["text"].clone(),
                parts[0]["submissionId"].clone(),
                parts[0]["deliveryStatus"].clone()
            ),
            (json!("Hello"), json!("input"), json!(status))
        );
        let identity = parts[0]["id"].clone();
        append(
            &actor,
            json!({"type": "turn.started", "turnId": "turn", "payload": {"submissionId": "input", "userMessageId": "client:input", "prompt": "Hello"}}),
        );
        append(
            &actor,
            json!({"type": "user.message", "turnId": "turn", "itemId": "native-user", "payload": {"clientUserMessageId": "client:input", "text": "Compiled harness input"}}),
        );
        let parts = users(&actor);
        assert_eq!(parts.len(), 1, "{status}: no second bubble");
        assert_eq!(parts[0]["id"], identity);
        assert_eq!(parts[0]["text"], "Hello");
        assert_eq!(parts[0]["turnId"], "turn");
        assert_eq!(parts[0]["itemId"], "native-user");
        assert_eq!(parts[0]["deliveryStatus"], "accepted");
        assert_eq!(actor.display().messages.len(), 1);
        let input = command(&actor, "input").unwrap();
        assert_eq!(input["targetTurnId"], "turn");
        assert!(input.get("intent").is_none_or(Value::is_null), "{status}");
    }
}

/// `preserves same-text inputs and their failed or unknown delivery state
/// without renderer fallback`.
#[test]
fn same_text_inputs_keep_their_own_delivery_states() {
    let actor = actor();
    admit(&actor, "first", "Hello", "dispatching");
    admit(&actor, "second", "Hello", "dispatching");
    actor
        .dispatch(json!({"type": "command.rejected", "commandId": "first"}))
        .unwrap();
    actor
        .dispatch(json!({"type": "command.outcome-unknown", "commandId": "second"}))
        .unwrap();
    let states: Vec<_> = users(&actor)
        .iter()
        .map(|p| (p["submissionId"].clone(), p["deliveryStatus"].clone()))
        .collect();
    assert_eq!(
        states,
        [
            (json!("first"), json!("rejected")),
            (json!("second"), json!("outcome-unknown"))
        ]
    );
    let presentation = actor.display().values.get("presentation").cloned();
    assert!(
        presentation.is_none_or(|p| p["pendingPrompt"].is_null()),
        "no renderer fallback prompt"
    );
}

/// `keeps native completion when the start acknowledgement is lost`.
#[test]
fn a_lost_start_acknowledgement_keeps_the_native_completion() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    admit(&actor, "input", "Hello", "dispatching");
    let identity =
        json!({"commandId": "input", "operationId": "operation:input", "adapterGeneration": 1});
    let mut prepared = identity.clone();
    prepared["prompt"] = json!("Hello");
    prepared["promptMentions"] = json!([]);
    prepared["referenceDisplays"] = json!([]);
    actor
        .dispatch(json!({"type": "submission.prepared", "submission": prepared}))
        .unwrap();
    append(
        &actor,
        json!({"type": "turn.started", "turnId": "turn", "payload": {}}),
    );
    append(
        &actor,
        json!({"type": "turn.completed", "turnId": "turn", "payload": {}}),
    );
    let mut unknown = identity;
    unknown["type"] = json!("submission.outcome-unknown");
    unknown["error"] = json!("Lost ACK");
    actor.dispatch(unknown).unwrap();
    let input = command(&actor, "input").unwrap();
    assert_eq!(
        (input["status"].clone(), input["targetTurnId"].clone()),
        (json!("accepted"), json!("turn"))
    );
    let execution = &actor.control()["execution"];
    assert_eq!(
        (
            execution["status"].clone(),
            execution["nativeOutcome"].clone()
        ),
        (json!("ended"), json!("completed"))
    );
    assert_eq!(users(&actor).len(), 1);
}

/// `retains complete answers above 32K and accepts an explicitly shorter
/// final correction`.
#[test]
fn a_long_answer_is_kept_whole_and_a_shorter_final_text_corrects_it() {
    let actor = actor();
    let answer = format!("{}THE END", "x".repeat(40_000));
    for chunk in answer.as_bytes().chunks(10_000) {
        append(
            &actor,
            json!({"type": "assistant.delta", "turnId": "turn", "itemId": "answer", "payload": {"delta": std::str::from_utf8(chunk).unwrap()}}),
        );
    }
    append(
        &actor,
        json!({"type": "assistant.completed", "turnId": "turn", "itemId": "answer", "payload": {"text": answer}}),
    );
    let message = actor.display().messages[0].clone();
    assert_eq!(message["text"], json!(answer));
    assert_eq!(message["truncated"], false);
    assert_eq!(message["streaming"], false);
    append(
        &actor,
        json!({"type": "assistant.completed", "turnId": "turn", "itemId": "answer", "payload": {"text": "Corrected answer"}}),
    );
    assert_eq!(actor.display().messages[0]["text"], "Corrected answer");
}

/// `does not replace accumulated content with a known incomplete prefix and
/// reports the display limit`.
#[test]
fn a_known_incomplete_prefix_never_replaces_the_text_and_the_limit_is_reported() {
    let actor = actor();
    let answer = "x".repeat(40_000);
    append(
        &actor,
        json!({"type": "assistant.delta", "turnId": "turn", "itemId": "answer", "payload": {"delta": answer}}),
    );
    append(
        &actor,
        json!({"type": "assistant.completed", "turnId": "turn", "itemId": "answer", "payload": {"text": &answer[..20_000], "truncated": true}}),
    );
    let first = actor.display().messages[0].clone();
    assert_eq!(first["text"], json!(answer));
    assert_eq!(first["truncated"], true);
    append(
        &actor,
        json!({"type": "assistant.completed", "turnId": "turn", "itemId": "large", "payload": {"text": "y".repeat(200_000)}}),
    );
    let last = actor.display().messages.last().unwrap().clone();
    assert_eq!(last["text"], json!("y".repeat(128 * 1024)));
    assert_eq!(last["truncated"], true);
}

/// `does not repeat an incomplete final prefix after a tool boundary`.
#[test]
fn an_incomplete_final_prefix_after_a_tool_is_not_repeated() {
    let actor = actor();
    append(
        &actor,
        json!({"type": "assistant.delta", "turnId": "turn", "itemId": "answer", "payload": {"delta": "Full streamed answer"}}),
    );
    append(
        &actor,
        json!({"type": "tool.completed", "turnId": "turn", "itemId": "tool", "payload": {"kind": "tool", "label": "Read", "status": "completed"}}),
    );
    append(
        &actor,
        json!({"type": "assistant.completed", "turnId": "turn", "itemId": "answer", "payload": {"text": "Full streamed", "truncated": true}}),
    );
    let messages = actor.display().messages;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["text"], "Full streamed answer");
}

/// `uses an explicit native historical duration without using the replay
/// clock`.
#[test]
fn a_restored_turn_keeps_its_native_duration_not_the_replay_clock() {
    let actor = SessionActor::new(ActorOptions {
        clock: Some(Box::new(|| 9_000_000)),
        ..ActorOptions::default()
    })
    .unwrap();
    append(
        &actor,
        json!({"type": "turn.started", "turnId": "old", "payload": {"restored": true}}),
    );
    append(
        &actor,
        json!({"type": "turn.completed", "turnId": "old", "payload": {"restored": true, "durationMs": 4321}}),
    );
    let summary = actor
        .display()
        .parts
        .iter()
        .find(|p| p["kind"] == "turn-summary")
        .map(|p| p["durationMs"].clone());
    assert_eq!(summary, Some(json!(4321)));
}

/// `keeps large command histories out of IPC frames so a fresh attachment
/// can continue streaming`: a control view of many long accepted inputs
/// stays a valid frame under 100 KB and carries no input bodies.
#[test]
fn long_accepted_inputs_stay_out_of_the_control_frame() {
    use super::agent_control_view::project_agent_control_view;
    use crate::agent::contract::schema::assert_agent_session_control_view;
    let actor = actor();
    let prompt = "文".repeat(40_000);
    for index in 0..75 {
        let id = format!("input-{index}");
        admit(&actor, &id, &prompt, "dispatching");
        actor
            .dispatch(json!({"type": "command.accepted", "commandId": id}))
            .unwrap();
    }
    let view = project_agent_control_view(&actor.control());
    assert!(assert_agent_session_control_view(&view, "control").is_ok());
    assert!(serde_json::to_vec(&view).unwrap().len() < 100_000);
    assert!(
        view["commands"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c.get("intent").is_none())
    );
}

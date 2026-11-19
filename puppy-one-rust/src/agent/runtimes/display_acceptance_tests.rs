//! Native protocol acceptance from electron.agent-display-contract.test.mjs
//! and provider-activity-routing.test.mjs at the frozen TS reference.
use crate::agent::agent_events::{EnvelopeInput, create_agent_event_envelope};
use crate::agent::contract::display_schema::assert_display;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::domain::agent_session_actor::{ActorOptions, EventInput, SessionActor};
use crate::agent::domain::transcript::display_projection::ProjectionOptions;
use crate::agent::domain::transcript::transcript_reducer::{
    apply_agent_events, create_agent_projection,
};
use crate::agent::protocols::pi_rpc::pi_event_normalizer::{
    PiEventState, normalize_pi_history, normalize_pi_rpc_event,
};
use crate::agent::runtimes::claude::claude_events::{
    ClaudeEventState, normalize_claude_history, normalize_claude_message,
};
use crate::agent::runtimes::codex::codex_events::{
    normalize_codex_notification, normalize_item_lifecycle,
};
use core::prelude::v1::test;
use serde_json::{Value, json};

fn actor() -> SessionActor {
    SessionActor::new(ActorOptions::default()).unwrap()
}

fn append(actor: &SessionActor, runtime: &str, event: Value) {
    actor
        .append_event(EventInput {
            session_id: "product-session".into(),
            runtime_id: runtime.into(),
            provider_session_id: Some("native-session".into()),
            event,
        })
        .unwrap();
}

fn command(actor: &SessionActor, id: &str, references: Value) {
    actor.dispatch(json!({"type": "command.received", "command": {
        "commandId": id, "kind": "start", "status": "dispatching", "operationId": format!("operation-{id}"),
        "intentFingerprint": id, "userMessageId": format!("client-{id}"),
        "intent": {"prompt": "你好", "referenceDisplays": references, "promptMentions": [], "model": null, "effort": null, "mode": null}}})).unwrap();
}

fn echo(actor: &SessionActor, id: &str, client_id: Option<&str>) {
    let raw = json!({"method": "item/completed", "params": {"threadId": "native-session", "turnId": "turn-1",
        "item": {"type": "userMessage", "id": id, "clientId": client_id,
            "content": [{"type": "text", "text": "你好\nProvider compiled context", "text_elements": []}]}}});
    for event in normalize_codex_notification(&raw) {
        append(actor, "codex", event);
    }
}

#[test]
fn codex_native_echo_and_start_join_client_identity_in_either_order() {
    for start_first in [true, false] {
        let actor = actor();
        command(&actor, "command-1", json!([]));
        let start = || {
            append(
                &actor,
                "codex",
                json!({"type": "turn.started", "turnId": "turn-1", "payload": {"prompt": "你好", "userMessageId": "client-command-1"}}),
            )
        };
        if start_first {
            start();
            echo(&actor, "native-user", Some("client-command-1"));
        } else {
            echo(&actor, "native-user", Some("client-command-1"));
            start();
        }
        echo(&actor, "native-user", Some("client-command-1"));
        let display = actor.display();
        let users: Vec<_> = display
            .messages
            .iter()
            .filter(|message| message["role"] == "user")
            .collect();
        assert_eq!(users.len(), 1);
        for (key, value) in [
            ("id", "user:client-command-1"),
            ("itemId", "native-user"),
            ("text", "你好"),
            ("submissionId", "command-1"),
        ] {
            assert_eq!(users[0][key], value, "start_first={start_first}, {key}");
        }
        assert_eq!(
            display
                .parts
                .iter()
                .filter(|part| part["kind"] == "user")
                .count(),
            1
        );
        assert_display(&actor.snapshot().display).unwrap();
    }
}

#[test]
fn native_echo_preserves_admitted_cross_root_reference_labels() {
    let actor = actor();
    let reference = json!({"id": "reference-other-root", "kind": "workspace-file", "displayName": "README.md", "relativePath": "README.md", "workspaceName": "Other project"});
    command(&actor, "command-1", json!([reference]));
    append(
        &actor,
        "codex",
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {"userMessageId": "client-command-1"}}),
    );
    echo(&actor, "native-user", Some("client-command-1"));
    let display = actor.display();
    assert_eq!(display.messages[0]["references"], json!([reference]));
    assert_eq!(
        display
            .parts
            .iter()
            .find(|part| part["kind"] == "user")
            .unwrap()["references"],
        json!([reference])
    );
}

#[test]
fn identical_text_with_distinct_native_submissions_and_followups_remains_distinct() {
    let actor = actor();
    command(&actor, "command-1", json!([]));
    echo(&actor, "native-user", Some("client-command-1"));
    command(&actor, "command-2", json!([]));
    echo(&actor, "native-user-2", Some("client-command-2"));
    echo(&actor, "native-followup", None);
    assert_eq!(
        actor
            .display()
            .messages
            .iter()
            .filter(|message| message["role"] == "user")
            .count(),
        3
    );
}

#[test]
fn claude_success_settles_upstream_retry_without_losing_local_connectivity() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    append(
        &actor,
        "claude",
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {"prompt": "Hello"}}),
    );
    let mut state = ClaudeEventState::new(Some("turn-1"), false);
    for raw in [
        json!({"type": "system", "subtype": "api_retry", "attempt": 1, "max_retries": 3, "error": "server_error"}),
        json!({"type": "assistant", "message": {"id": "answer", "content": [{"type": "text", "text": "Done"}]}}),
        json!({"type": "result", "subtype": "success", "result": "Done", "is_error": false}),
    ] {
        for event in normalize_claude_message(&raw, &mut state) {
            append(&actor, "claude", event);
        }
    }
    assert_eq!(actor.control()["connection"]["status"], "connected");
    assert_eq!(actor.control()["execution"]["nativeOutcome"], "completed");
    assert_eq!(actor.control()["recoveries"], json!([]));
    assert!(actor.display().get("connectionStatus").unwrap().is_null());
}

#[test]
fn recovered_pi_request_completes_without_a_stale_failure_card() {
    let actor = actor();
    actor.dispatch(json!({"type": "adapter.attached"})).unwrap();
    append(
        &actor,
        "pi",
        json!({"type": "turn.started", "turnId": "turn-1", "payload": {"prompt": "Hello"}}),
    );
    let mut state = PiEventState::new(Some("turn-1"), Some("native-session"), "pi", "Pi");
    let answer = json!({"role": "assistant", "content": [{"type": "text", "text": "Recovered answer"}], "stopReason": "stop"});
    for raw in [
        json!({"type": "message_end", "message": {"role": "assistant", "content": [], "stopReason": "error", "errorMessage": "fetch failed"}}),
        json!({"type": "auto_retry_start", "attempt": 1, "maxAttempts": 3}),
        json!({"type": "message_end", "message": answer}),
        json!({"type": "auto_retry_end", "success": true}),
        json!({"type": "agent_end", "messages": [answer]}),
        json!({"type": "agent_settled"}),
    ] {
        for event in normalize_pi_rpc_event(&raw, &mut state) {
            append(&actor, "pi", event);
        }
    }
    assert_eq!(actor.control()["execution"]["nativeOutcome"], "completed");
    assert_eq!(actor.control()["connection"]["status"], "connected");
    assert_eq!(actor.control()["recoveries"], json!([]));
    let display = actor.display();
    assert!(display.get("connectionStatus").unwrap().is_null());
    assert_eq!(display.get("terminalState").unwrap(), "completed");
    assert!(display.get("runningTurnId").unwrap().is_null());
    assert_eq!(display.messages.last().unwrap()["text"], "Recovered answer");
    assert!(!display.parts.iter().any(|part| part["kind"] == "error"));
    assert_display(&display).unwrap();
}

#[test]
fn claude_assistant_errors_preserve_native_diagnostic_codes() {
    let events = normalize_claude_message(
        &json!({"type": "assistant", "error": "authentication_failed", "message": {
        "id": "error-message", "content": [{"type": "text", "text": "Authentication failed"}]}}),
        &mut ClaudeEventState::new(Some("turn-1"), false),
    );
    assert!(events.iter().any(|event| event["type"] == "provider.error"
        && event["payload"]["code"] == "authentication_failed"));
}

#[test]
fn incomplete_claude_and_pi_history_never_invents_a_successful_native_outcome() {
    for (runtime, events) in [
        (
            "claude",
            normalize_claude_history(
                &[
                    json!({"type": "user", "uuid": "history-user", "message": {"content": [{"type": "text", "text": "Hello"}]}}),
                ],
                "native-session",
            ),
        ),
        (
            "pi",
            normalize_pi_history(
                &[json!({"role": "user", "content": [{"type": "text", "text": "Hello"}]})],
                Some("native-session"),
                None,
                None,
            ),
        ),
    ] {
        let actor = actor();
        for event in events {
            append(&actor, runtime, event);
        }
        assert!(
            actor.control()["execution"]["nativeOutcome"].is_null(),
            "{runtime}"
        );
        assert_eq!(
            actor.control()["execution"]["certainty"],
            "unknown",
            "{runtime}"
        );
        assert_eq!(
            actor.display().turns[0]["status"],
            "outcome-unknown",
            "{runtime}"
        );
    }
}

fn project(events: Vec<Value>) -> AgentDisplay {
    let envelopes: Vec<_> = events
        .into_iter()
        .enumerate()
        .map(|(index, event)| {
            create_agent_event_envelope(EnvelopeInput {
                sequence: index as i64 + 1,
                session_id: "session".into(),
                runtime_id: "pi".into(),
                event_type: event["type"].as_str().unwrap().into(),
                payload: event["payload"].clone(),
                item_id: event["itemId"].as_str().map(str::to_owned),
                turn_id: event["turnId"].as_str().map(str::to_owned),
                ..Default::default()
            })
            .unwrap()
        })
        .collect();
    apply_agent_events(
        &create_agent_projection(),
        &envelopes,
        ProjectionOptions::default(),
    )
}

#[test]
fn current_and_legacy_codex_compaction_both_project_as_system_activity() {
    for (phase, status) in [("started", "running"), ("completed", "completed")] {
        let current = normalize_item_lifecycle(
            Some(&json!({"id": "compact", "type": "contextCompaction"})),
            phase,
            &json!("native"),
            &json!("turn"),
        );
        let old = vec![
            json!({"type": format!("tool.{phase}"), "turnId": "turn", "itemId": "compact",
            "payload": {"kind": "system", "tool": "compaction", "status": status}}),
        ];
        for display in [project(current), project(old)] {
            assert_eq!(display.activities[0]["kind"], "system");
            assert_eq!(display.activities[0]["detail"]["category"], "compaction");
            assert_eq!(
                display
                    .rows
                    .iter()
                    .map(|row| row["kind"].clone())
                    .collect::<Vec<_>>(),
                [json!("system")]
            );
        }
    }
}

#[test]
fn claude_authentication_projects_as_session_status_for_every_outcome() {
    for status in ["running", "completed", "failed"] {
        let mut state = ClaudeEventState::new(Some("turn"), false);
        let events = normalize_claude_message(
            &json!({"type": "auth_status", "isAuthenticating": status == "running",
            "error": if status == "failed" { Some("Authentication failed") } else { None }, "output": ["Authentication update"]}),
            &mut state,
        );
        assert_eq!(events[0]["type"], "provider.activity");
        assert!(events[0]["turnId"].is_null());
        assert_eq!(events[0]["payload"]["category"], "authentication");
        assert_eq!(events[0]["payload"]["status"], status);
        let display = project(events);
        assert!(display.rows.is_empty());
        assert_eq!(
            display.activities[0]["label"],
            if status == "failed" {
                "Authentication failed"
            } else {
                "Authentication update"
            }
        );
    }
}

#[test]
fn restored_pi_history_does_not_synthesize_transient_notifications() {
    let events = normalize_pi_history(
        &[
            json!({"role": "user", "content": [{"type": "text", "text": "Hello"}]}),
            json!({"role": "assistant", "content": [{"type": "text", "text": "Hi"}], "stopReason": "stop"}),
        ],
        Some("native"),
        None,
        None,
    );
    let display = project(events);
    assert!(display.activities.is_empty());
    assert_eq!(
        display
            .messages
            .iter()
            .map(|message| message["text"].clone())
            .collect::<Vec<_>>(),
        [json!("Hello"), json!("Hi")]
    );
}

fn session(runtime: &str) -> crate::agent::domain::agent_session_model::SessionRef {
    use crate::agent::domain::agent_session_model::{
        SessionRecordInput, create_agent_session_record,
    };
    use crate::agent::sender::Sender;
    use std::rc::Rc;
    create_agent_session_record(SessionRecordInput {
        id: "session".into(),
        owner_id: 1,
        sender: Sender::new(1, Rc::new(|_| {})),
        workspace_root: "/workspace".into(),
        runtime_id: runtime.into(),
        runtime: None,
        model: None,
        effort: None,
        mode: None,
        events: Vec::new(),
        sequence: 0,
        created_at: None,
        title: None,
        terminal_state: None,
    })
    .unwrap()
}

#[test]
fn pi_exhausted_retries_settle_the_turn_and_dispatch_its_queued_successor_once() {
    use crate::agent::application::agent_reference_policy::PreparedInput;
    use crate::agent::application::tests::harness::{run, settle};
    use crate::agent::application::turn::agent_start_transaction::StartContext;
    use crate::agent::application::turn::agent_turn_queue::AgentTurnQueue;
    use std::{cell::RefCell, rc::Rc};
    run(async {
        let session = session("pi");
        session
            .actor
            .dispatch(json!({"type": "adapter.attached"}))
            .unwrap();
        append(
            &session.actor,
            "pi",
            json!({"type": "turn.started", "turnId": "turn-1", "payload": {"prompt": "First"}}),
        );
        session.actor.dispatch(json!({"type": "command.received", "command": {
            "commandId": "next", "kind": "start", "status": "queued", "operationId": "operation-next",
            "intentFingerprint": "next", "userMessageId": "client-next", "intent": {"prompt": "你好",
                "referenceDisplays": [], "promptMentions": [], "model": null, "effort": null, "mode": null}}})).unwrap();
        let queue = AgentTurnQueue::new(None);
        let calls = Rc::new(RefCell::new(Vec::new()));
        let seen = calls.clone();
        queue.set_execute_start(Rc::new(move |context| {
            seen.borrow_mut().push(context.command_id.clone());
            context
                .session
                .actor
                .dispatch(
                    json!({"type": "command.accepted", "commandId": context.command_id,
                "operationId": context.operation_id}),
                )
                .unwrap();
            Box::pin(async { Ok(Value::Null) })
        }));
        queue.enqueue(StartContext {
            session: session.clone(),
            request: json!({}),
            prepared: PreparedInput::default(),
            model: None,
            effort: None,
            mode: None,
            command_id: "next".into(),
            operation_id: "operation-next".into(),
        });
        let mut state = PiEventState::new(Some("turn-1"), Some("native-session"), "pi", "Pi");
        for raw in [
            json!({"type": "auto_retry_start", "attempt": 1, "maxAttempts": 3}),
            json!({"type": "auto_retry_end", "success": false, "finalError": "Retry exhausted"}),
            json!({"type": "agent_settled"}),
        ] {
            for event in normalize_pi_rpc_event(&raw, &mut state) {
                append(&session.actor, "pi", event);
            }
        }
        settle().await;
        assert_eq!(*calls.borrow(), ["next"]);
        assert_eq!(session.actor.control()["queue"], json!([]));
        assert!(
            session
                .actor
                .display()
                .get("connectionStatus")
                .unwrap()
                .is_null()
        );
        session
            .actor
            .dispatch(json!({"type": "adapter.exited"}))
            .unwrap();
        settle().await;
        let weak = Rc::downgrade(&session);
        drop(session);
        drop(queue);
        settle().await;
        assert!(
            weak.upgrade().is_none(),
            "queue subscriptions must be released"
        );
    });
}

#[test]
fn malformed_display_items_keep_diagnostics_and_allow_later_native_completion() {
    use crate::agent::application::agent_event_journal::AgentEventJournal;
    use crate::agent::application::tests::harness::{FakePersistence, RecordingLogger, run};
    use std::rc::Rc;
    run(async {
        let session = session("codex");
        session.state_mut().closing = true;
        let persistence = Rc::new(FakePersistence::default());
        let journal =
            AgentEventJournal::new(Rc::new(persistence), Rc::new(RecordingLogger::default()));
        for event in [
            json!({"type": "turn.started", "turnId": "turn-1", "payload": {"prompt": "Hello"}}),
            json!({"type": "assistant.delta", "turnId": "turn-1", "itemId": {"invalid": true}, "payload": {"delta": "Bad item"}}),
            json!({"type": "assistant.completed", "turnId": "turn-1", "itemId": "answer", "payload": {"text": "Later valid output"}}),
            json!({"type": "turn.completed", "turnId": "turn-1", "payload": {"durationMs": "invalid"}}),
        ] {
            journal.emit(&session, event);
        }
        let display = session.actor.display();
        assert!(
            display
                .messages
                .iter()
                .any(|entry| entry["text"] == "Later valid output")
        );
        assert!(
            display
                .activities
                .iter()
                .any(|entry| entry["kind"] == "error")
        );
        assert_eq!(
            session.actor.control()["execution"]["nativeOutcome"],
            "completed"
        );
        assert_eq!(
            display.get("presentation").unwrap()["terminalState"],
            "completed"
        );
    });
}

// `tests/unit/workbench/item-hosts/electron.agent-sidebar-contracts.test.mjs`:
// the provider halves of the sidebar display invariants.

/// `does not silently clip claude / pi / acp final text in the adapter`.
#[test]
fn no_adapter_clips_a_long_final_answer() {
    use crate::agent::protocols::acp::acp_event_normalizer::AcpEventNormalizer;
    let text = format!("{}END", "a".repeat(40_000));
    for provider in ["claude", "pi", "acp"] {
        let events = match provider {
            "claude" => normalize_claude_message(
                &json!({"type": "assistant", "message": {"id": "answer", "content": [{"type": "text", "text": text}]}}),
                &mut ClaudeEventState::new(Some("turn"), false),
            ),
            "pi" => normalize_pi_rpc_event(
                &json!({"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}),
                &mut PiEventState::new(Some("turn"), None, "pi", "Pi"),
            ),
            _ => {
                let mut normalizer = AcpEventNormalizer::new(Some("turn"));
                normalizer.normalize(&json!({"sessionId": "thread", "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": text}}}));
                normalizer.complete_assistant(Some("thread"))
            }
        };
        let actor = actor();
        for event in events {
            append(&actor, provider, event);
        }
        assert_eq!(
            actor.display().messages[0]["text"],
            json!(text),
            "{provider}"
        );
    }
}

/// `merges ACP partial tool updates, replacements, empty content and
/// terminal metadata by presence`.
#[test]
fn acp_tool_updates_merge_by_presence() {
    use crate::agent::protocols::acp::acp_event_normalizer::AcpEventNormalizer;
    let actor = actor();
    let mut normalizer = AcpEventNormalizer::new(Some("turn"));
    let mut update = |value: Value| {
        let mut update = json!({"sessionUpdate": "tool_call_update", "toolCallId": "tool"});
        for (key, field) in value.as_object().unwrap() {
            update[key] = field.clone();
        }
        for event in normalizer.normalize(&json!({"sessionId": "thread", "update": update})) {
            append(&actor, "acp", event);
        }
    };
    let content =
        |text: &str| json!([{"type": "content", "content": {"type": "text", "text": text}}]);
    update(
        json!({"sessionUpdate": "tool_call", "kind": "execute", "title": "Bash", "status": "in_progress", "content": content("OLD")}),
    );
    update(json!({"content": content("NEW")}));
    let activity = |actor: &SessionActor| {
        let a = actor.display().activities[0].clone();
        (a["kind"].clone(), a["output"].clone(), a["status"].clone())
    };
    assert_eq!(
        activity(&actor),
        (json!("command"), json!("NEW"), json!("running"))
    );
    update(json!({"status": "failed"}));
    assert_eq!(
        activity(&actor),
        (json!("command"), json!("NEW"), json!("failed"))
    );
    update(json!({"content": []}));
    assert_eq!(
        activity(&actor),
        (json!("command"), json!(""), json!("failed"))
    );
}

/// `does not turn historical replay time into a native Worked duration`.
#[test]
fn replayed_history_claims_no_worked_duration() {
    use crate::agent::runtimes::codex::codex_history_projection::normalize_historical_thread;
    let now = std::rc::Rc::new(std::cell::Cell::new(1_000_000_i64));
    let clock = now.clone();
    let actor = SessionActor::new(ActorOptions {
        clock: Some(Box::new(move || {
            clock.set(clock.get() + 1);
            clock.get()
        })),
        ..ActorOptions::default()
    })
    .unwrap();
    let thread = json!({"id": "thread", "turns": [{"id": "historical", "status": "completed",
        "items": [{"id": "answer", "type": "agentMessage", "text": "An old answer"}]}]});
    for event in normalize_historical_thread(&thread) {
        append(&actor, "codex", event);
    }
    let display = actor.display();
    assert_eq!(display.turns[0]["status"], "completed");
    assert!(display.turns[0]["durationMs"].is_null());
    assert!(!display.parts.iter().any(|p| p["kind"] == "turn-summary"));
}

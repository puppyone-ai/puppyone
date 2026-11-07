//! The service half of
//! `tests/integration/agent/controls/electron.agent-session-control.test.mjs`
//! and the request-isolation case of `electron.agent-display-contract.test.mjs`.
use super::harness::{HarnessOptions, create_sender, create_service_harness, run, settle};
use crate::agent::agent_error::AgentError;
use crate::agent::application::session::agent_session_feed::MAX_PENDING_FRAMES;
use crate::agent::contract::schema::assert_agent_session_control;
use core::prelude::v1::test;
use serde_json::{Value, json};
use tokio::sync::oneshot;
use tokio::task::spawn_local as spawn;

fn native_event(event_type: &str, turn_id: &str, payload: Value) -> Value {
    json!({ "type": event_type, "turnId": turn_id, "providerSessionId": "thread-1", "payload": payload })
}

fn frames(sink: &std::cell::RefCell<Vec<Value>>) -> Vec<Value> {
    sink.borrow().clone()
}

#[test]
fn keeps_a_newer_submission_when_an_older_turn_terminal_or_request_rejection_arrives_late() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(506);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        let adapter = harness.adapter(0);
        let (first_reply, first_wait) = oneshot::channel::<Result<Value, AgentError>>();
        let (second_reply, second_wait) = oneshot::channel::<Result<Value, AgentError>>();
        let first_wait = std::cell::RefCell::new(Some(first_wait));
        let emit = adapter.emitter();
        adapter.once("startTurn", move |_| {
            emit(native_event("turn.started", "A", json!({})));
            let wait = first_wait.borrow_mut().take().unwrap();
            Box::pin(async move { wait.await.unwrap() })
        });
        let service = harness.service.clone();
        let first_owner = owner.clone();
        let first_id = id.clone();
        let first = spawn(async move {
            let _ = service
                .start_turn(
                    &first_owner,
                    &json!({"sessionId": first_id, "prompt": "first", "commandId": "late-A"}),
                    Some("/workspace"),
                )
                .await;
        });
        settle().await;
        adapter.emit(native_event("turn.completed", "A", json!({})));
        let second_wait = std::cell::RefCell::new(Some(second_wait));
        adapter.once("startTurn", move |_| {
            let wait = second_wait.borrow_mut().take().unwrap();
            Box::pin(async move { wait.await.unwrap() })
        });
        let service = harness.service.clone();
        let second_owner = owner.clone();
        let second_id = id.clone();
        let second = spawn(async move {
            service
                .start_turn(
                    &second_owner,
                    &json!({"sessionId": second_id, "prompt": "second", "commandId": "current-B"}),
                    Some("/workspace"),
                )
                .await
        });
        settle().await;
        adapter.emit(native_event("turn.completed", "A", json!({})));
        first_reply
            .send(Err(AgentError::new("late transport rejection")))
            .unwrap();
        first.await.unwrap();
        let observed = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace"),
            )
            .unwrap();
        // The actor's own control carries the private pending input.
        let session = harness
            .service
            .assert_session_instance(
                &owner,
                &json!({"sessionId": id, "instanceId": created["session"]["instanceId"]}),
                Some("/workspace"),
                false,
            )
            .unwrap()
            .unwrap();
        assert_eq!(observed["control"]["execution"]["status"], "starting");
        let pending = session.actor.control()["pendingSubmission"].clone();
        assert_eq!(pending["commandId"], "current-B");
        assert_eq!(pending["prompt"], "second");
        second_reply.send(Ok(json!({"turnId": "B"}))).unwrap();
        second.await.unwrap().unwrap();
    });
}

#[test]
fn bounds_reconnect_diagnostics_before_control_state_enters_the_feed() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(508);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": id, "prompt": "Run"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let receipt = harness
            .service
            .attach_session(&owner, &json!({"sessionId": id}), "/workspace")
            .unwrap();
        let cursor = &receipt["snapshot"]["cursor"];
        harness
            .service
            .acknowledge_session(&owner, &json!({"sessionId": id, "subscriptionId": receipt["subscriptionId"], "streamId": cursor["streamId"], "revision": cursor["revision"]}), "/workspace")
            .unwrap();
        // `normalizeCodexNotification({ method: "error", params: { willRetry: true, … } })`.
        harness.adapter(0).emit(json!({
            "type": "provider.connection.updated", "providerSessionId": "thread-1", "turnId": "turn-1",
            "payload": {"state": "reconnecting", "message": "x".repeat(1_001)},
        }));
        let control = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace"),
            )
            .unwrap()["control"]
            .clone();
        assert!(assert_agent_session_control(&control, "Agent session control").is_ok());
        assert_eq!(
            control["recoveries"][0]["message"].as_str().unwrap().len(),
            1_000
        );
        assert_eq!(control["connection"]["status"], "connected");
    });
}

#[test]
fn accepts_a_command_idempotently_and_rejects_stale_session_generations() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(504);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        let epoch = created["control"]["sessionEpoch"].clone();
        let request = json!({"sessionId": id, "prompt": "hello", "commandId": "stable-command", "expectedSessionEpoch": epoch});
        let first = harness
            .service
            .start_turn(&owner, &request, Some("/workspace"))
            .await
            .unwrap();
        let duplicate = harness
            .service
            .start_turn(&owner, &request, Some("/workspace"))
            .await
            .unwrap();
        assert_eq!(first["turnId"], "turn-1");
        assert_eq!(duplicate["commandId"], "stable-command");
        assert_eq!(duplicate["deduplicated"], true);
        assert_eq!(duplicate["deliveryStatus"], "accepted");
        assert_eq!(harness.adapter(0).calls("startTurn").len(), 1);
        let mut different = request.clone();
        different["prompt"] = json!("must not execute");
        let message = harness
            .service
            .start_turn(&owner, &different, Some("/workspace"))
            .await
            .unwrap_err()
            .message;
        assert!(message.contains("different input"), "{message}");
        let stale = json!({"sessionId": id, "prompt": "stale", "commandId": "stale-command", "expectedSessionEpoch": "older-epoch"});
        let message = harness
            .service
            .start_turn(&owner, &stale, Some("/workspace"))
            .await
            .unwrap_err()
            .message;
        assert!(message.contains("older session generation"), "{message}");
        assert_eq!(harness.adapter(0).calls("startTurn").len(), 1);
    });
}

#[test]
fn captures_a_snapshot_before_releasing_a_contiguous_feed() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, sink) = create_sender(501);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        let receipt = harness
            .service
            .attach_session(&owner, &json!({"sessionId": id}), "/workspace")
            .unwrap();
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": id, "prompt": "hello", "commandId": "command-start"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        assert!(frames(&sink).is_empty());
        let cursor = &receipt["snapshot"]["cursor"];
        harness
            .service
            .acknowledge_session(&owner, &json!({"sessionId": id, "subscriptionId": receipt["subscriptionId"], "streamId": cursor["streamId"], "revision": cursor["revision"]}), "/workspace")
            .unwrap();
        let frames = frames(&sink);
        assert!(!frames.is_empty());
        assert_eq!(frames[0]["baseRevision"], cursor["revision"]);
        for pair in frames.windows(2) {
            assert_eq!(pair[1]["baseRevision"], pair[0]["revision"]);
        }
        assert_eq!(
            frames.last().unwrap()["control"]["execution"]["activeTurnId"],
            "turn-1"
        );
    });
}

#[test]
fn owns_follow_up_queuing_and_advancement_in_main() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            capabilities: Some(json!({"queue": true})),
            ..Default::default()
        });
        let (owner, _) = create_sender(502);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        let adapter = harness.adapter(0);
        for turn in ["A", "B"] {
            let emit = adapter.emitter();
            adapter.once("startTurn", move |_| {
                emit(native_event(
                    "turn.started",
                    turn,
                    json!({"status": "running"}),
                ));
                Box::pin(async move { Ok(json!({"turnId": turn})) })
            });
        }
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": id, "prompt": "first", "commandId": "first"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let queued = harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": id, "prompt": "second", "commandId": "second"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        assert_eq!(queued["queued"], true);
        assert_eq!(queued["commandId"], "second");
        assert_eq!(adapter.calls("startTurn").len(), 1);
        adapter.emit(native_event(
            "turn.completed",
            "A",
            json!({"status": "completed"}),
        ));
        settle().await;
        assert_eq!(adapter.calls("startTurn").len(), 2);
        let replay = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace"),
            )
            .unwrap();
        assert_eq!(replay["control"]["execution"]["activeTurnId"], "B");
        assert_eq!(replay["control"]["queue"], json!([]));
    });
}

#[test]
fn cancels_accepted_but_unsent_queued_input_when_its_native_session_exits() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            capabilities: Some(json!({"queue": true})),
            ..Default::default()
        });
        let (owner, _) = create_sender(509);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": id, "prompt": "first", "commandId": "running"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": id, "prompt": "queued text", "commandId": "queued"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let session = harness
            .service
            .assert_session_instance(
                &owner,
                &json!({"sessionId": id, "instanceId": created["session"]["instanceId"]}),
                Some("/workspace"),
                false,
            )
            .unwrap()
            .unwrap();
        harness
            .adapter(0)
            .exit(json!({"expected": false, "diagnostics": "test exit"}));
        settle().await;
        let control = session.actor.control();
        assert_eq!(control["queue"], json!([]));
        let queued = control["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["commandId"] == "queued")
            .unwrap()
            .clone();
        assert_eq!(queued["status"], "cancelled");
        assert_eq!(queued["wasQueued"], true);
        assert_eq!(queued["intent"]["prompt"], "queued text");
        assert_eq!(harness.adapter(0).calls("startTurn").len(), 1);
    });
}

#[test]
fn bounds_an_acknowledged_but_stalled_renderer_and_requires_resynchronization() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, sink) = create_sender(503);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        let receipt = harness
            .service
            .attach_session(&owner, &json!({"sessionId": id}), "/workspace")
            .unwrap();
        let cursor = receipt["snapshot"]["cursor"].clone();
        harness
            .service
            .acknowledge_session(&owner, &json!({"sessionId": id, "subscriptionId": receipt["subscriptionId"], "streamId": cursor["streamId"], "revision": cursor["revision"]}), "/workspace")
            .unwrap();
        sink.borrow_mut().clear();
        for index in 0..=MAX_PENDING_FRAMES {
            harness.adapter(0).emit(json!({
                "type": "provider.activity", "providerSessionId": "thread-1",
                "payload": {"status": "running", "label": format!("activity-{index}")},
            }));
        }
        let frames = frames(&sink);
        assert_eq!(frames.last().unwrap()["type"], "resync-required");
        assert_eq!(
            frames.last().unwrap()["subscriptionId"],
            receipt["subscriptionId"]
        );
        assert_eq!(
            frames.iter().filter(|f| f["type"] == "delta").count(),
            MAX_PENDING_FRAMES
        );
        let warnings = harness.logger.warnings.borrow();
        let (message, detail) = warnings
            .iter()
            .find(|(m, _)| m == "Agent display feed requires resync")
            .unwrap();
        assert_eq!(message, "Agent display feed requires resync");
        assert_eq!(detail["cause"], "unacknowledged-buffer-overflow");
        assert_eq!(detail["frameCount"], MAX_PENDING_FRAMES + 1);
        assert!(detail["byteCount"].is_number());
        assert_eq!(detail["acknowledgedRevision"], cursor["revision"]);
    });
}

#[test]
fn rebinds_the_feed_when_a_retired_session_id_receives_a_new_session_actor() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, sink) = create_sender(505);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        let first = harness
            .service
            .attach_session(&owner, &json!({"sessionId": id}), "/workspace")
            .unwrap();
        let cursor = &first["snapshot"]["cursor"];
        harness
            .service
            .acknowledge_session(&owner, &json!({"sessionId": id, "subscriptionId": first["subscriptionId"], "streamId": cursor["streamId"], "revision": cursor["revision"]}), "/workspace")
            .unwrap();
        harness
            .adapter(0)
            .exit(json!({"expected": false, "diagnostics": "restart"}));
        settle().await;
        let resumed = harness
            .service
            .resume_session(&owner, &json!({"sessionId": id}), "/workspace")
            .await
            .unwrap();
        let second = harness
            .service
            .attach_session(
                &owner,
                &json!({"sessionId": resumed["session"]["id"]}),
                "/workspace",
            )
            .unwrap();
        assert_ne!(
            second["snapshot"]["cursor"]["streamId"],
            first["snapshot"]["cursor"]["streamId"]
        );
        sink.borrow_mut().clear();
        harness
            .service
            .start_turn(&owner, &json!({"sessionId": resumed["session"]["id"], "prompt": "after reconnect", "commandId": "after-reconnect"}), Some("/workspace"))
            .await
            .unwrap();
        let cursor = &second["snapshot"]["cursor"];
        harness
            .service
            .acknowledge_session(&owner, &json!({"sessionId": resumed["session"]["id"], "subscriptionId": second["subscriptionId"], "streamId": cursor["streamId"], "revision": cursor["revision"]}), "/workspace")
            .unwrap();
        let frames = frames(&sink);
        let last = frames.last().unwrap();
        assert_eq!(last["streamId"], cursor["streamId"]);
        assert_eq!(last["control"]["execution"]["activeTurnId"], "turn-1");
    });
}

#[test]
fn tracks_two_replies_independently_and_admits_one_effect_per_native_request() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(101);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = snapshot["session"]["id"].clone();
        harness
            .service
            .start_turn(&owner, &json!({"sessionId": id, "prompt": "Run"}), None)
            .await
            .unwrap();
        let adapter = harness.adapter(0);
        let (finish, finished) = oneshot::channel::<()>();
        let finished = std::cell::RefCell::new(Some(finished));
        adapter.once("resolveApproval", move |_| {
            let wait = finished.borrow_mut().take().unwrap();
            Box::pin(async move {
                let _ = wait.await;
                Ok(Value::Null)
            })
        });
        for request_id in ["request-a", "request-b"] {
            adapter.emit(json!({
                "type": "approval.requested", "turnId": "turn-1",
                "payload": {"requestId": request_id, "kind": "command", "availableDecisions": ["accept", "decline"]},
            }));
        }
        let request = json!({"sessionId": id, "turnId": "turn-1", "requestId": "request-a", "decision": "accept", "commandId": "reply-a"});
        let service = harness.service.clone();
        let pending_owner = owner.clone();
        let pending_request = request.clone();
        let pending = spawn(async move {
            service
                .resolve_approval(&pending_owner, &pending_request, None)
                .await
                .map(drop)
        });
        settle().await;
        let display = harness
            .service
            .replay(&owner, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap()["display"]
            .clone();
        let replies: Vec<(Value, Value)> = display["approvals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| (entry["requestId"].clone(), entry["replyStatus"].clone()))
            .collect();
        assert_eq!(
            replies,
            [
                (json!("request-a"), json!("dispatching")),
                (json!("request-b"), Value::Null)
            ]
        );
        let mut duplicate = request.clone();
        duplicate["commandId"] = json!("duplicate-a");
        let message = harness
            .service
            .resolve_approval(&owner, &duplicate, None)
            .await
            .unwrap_err()
            .message;
        assert!(message.contains("already being delivered"), "{message}");
        let repeated = harness
            .service
            .resolve_approval(&owner, &request, None)
            .await
            .unwrap();
        assert_eq!(repeated["commandId"], "reply-a");
        assert_eq!(adapter.calls("resolveApproval").len(), 1);
        finish.send(()).unwrap();
        pending.await.unwrap().unwrap();
        let mut second = request.clone();
        second["requestId"] = json!("request-b");
        second["commandId"] = json!("reply-b");
        let resolved = harness
            .service
            .resolve_approval(&owner, &second, None)
            .await
            .unwrap();
        assert_eq!(resolved["requestId"], "request-b");
        harness
            .service
            .close_session(
                &owner,
                &json!({"sessionId": id, "removePersistence": false}),
                None,
            )
            .await
            .unwrap();
    });
}

//! Cross-operation ordering from the TS control-plane acceptance suite.
use super::harness::{
    Harness, HarnessOptions, create_sender, create_service_harness, run, run_paused, settle,
};
use crate::agent::agent_error::AgentError;
use crate::agent::application::ports::{AttachmentStore, Pending};
use crate::agent::sender::Sender;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;
use tokio::sync::oneshot;
use tokio::task::spawn_local;

async fn setup(options: HarnessOptions) -> (Harness, Sender, Value) {
    let harness = create_service_harness(options);
    let (owner, _) = create_sender(900);
    let created = harness
        .service
        .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
        .await
        .unwrap();
    (harness, owner, created["session"]["id"].clone())
}
fn native(kind: &str, turn: &str, payload: Value) -> Value {
    json!({"type": kind, "turnId": turn, "providerSessionId": "thread-1", "payload": payload})
}
fn request(id: &Value, command: &str) -> Value {
    json!({"sessionId": id, "commandId": command, "prompt": command})
}
fn snapshot(h: &Harness, owner: &Sender, id: &Value) -> Value {
    h.service
        .replay(
            owner,
            &json!({"sessionId": id, "afterSequence": 0}),
            Some("/workspace"),
        )
        .unwrap()
}
fn command(control: &Value, id: &str) -> Value {
    control["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["commandId"] == id)
        .unwrap()
        .clone()
}
fn next_turn(h: &Harness, turn: &'static str) {
    let emit = h.adapter(0).emitter();
    h.adapter(0).once("startTurn", move |_| {
        emit(native("turn.started", turn, json!({})));
        Box::pin(async move { Ok(json!({"turnId": turn})) })
    });
}

#[derive(Default)]
struct Leases {
    released: RefCell<Vec<Value>>,
    revoked: RefCell<Vec<Value>>,
}
impl AttachmentStore for Leases {
    fn supports(&self, method: &str) -> bool {
        matches!(method, "releaseLease" | "revoke")
    }
    fn release_lease(&self, request: Value) -> Pending<()> {
        self.released.borrow_mut().push(request);
        Box::pin(async { Ok(()) })
    }
    fn revoke(&self, request: Value) -> Pending<Value> {
        self.revoked.borrow_mut().push(request);
        Box::pin(async { Ok(json!({"revoked": 1})) })
    }
}
fn lease_request(id: &Value, command: &str, token: &str) -> Value {
    let mut value = request(id, command);
    value["privateReferenceLease"] =
        json!({"leaseId": format!("lease-{command}"), "tokens": [token]});
    value
}

#[test]
fn explicit_recovery_records_the_originating_degraded_turn() {
    run(async {
        let (h, owner, id) = setup(HarnessOptions::default()).await;
        let mut input = request(&id, "recover");
        input["recoveryOfTurnId"] = json!("turn-degraded");
        h.service
            .start_turn(&owner, &input, Some("/workspace"))
            .await
            .unwrap();
        let replay = snapshot(&h, &owner, &id);
        let started = replay["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "turn.started")
            .unwrap();
        assert_eq!(started["payload"]["submissionId"], "recover");
        assert_eq!(started["payload"]["recoveryOfTurnId"], "turn-degraded");
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn terminal_event_before_start_receipt_settles_once_without_a_phantom_active_turn() {
    run(async {
        let (h, owner, id) = setup(HarnessOptions::default()).await;
        let (reply, wait) = oneshot::channel();
        let wait = RefCell::new(Some(wait));
        h.adapter(0).once("startTurn", move |_| {
            let wait = wait.borrow_mut().take().unwrap();
            Box::pin(async move { wait.await.unwrap() })
        });
        let service = h.service.clone();
        let caller = owner.clone();
        let input = request(&id, "fast");
        let start = spawn_local(async move {
            service
                .start_turn(&caller, &input, Some("/workspace"))
                .await
        });
        settle().await;
        h.adapter(0)
            .emit(native("turn.completed", "fast-A", json!({})));
        reply.send(Ok(json!({"turnId": "fast-A"}))).unwrap();
        start.await.unwrap().unwrap();
        let control = snapshot(&h, &owner, &id)["control"].clone();
        assert_eq!(control["execution"]["status"], "ended");
        assert_eq!(control["execution"]["nativeOutcome"], "completed");
        assert_eq!(control["execution"]["certainty"], "confirmed");
        assert_eq!(control["runGeneration"], 1);
        assert!(control["pendingSubmission"].is_null());
        assert_eq!(command(&control, "fast")["status"], "accepted");
        assert_eq!(h.adapter(0).calls("startTurn").len(), 1);
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn late_interrupt_acceptance_preserves_the_next_turn_and_both_of_its_blockers() {
    run(async {
        let (h, owner, id) = setup(HarnessOptions {
            capabilities: Some(json!({"queue": true})),
            ..Default::default()
        })
        .await;
        h.service
            .start_turn(&owner, &request(&id, "a"), Some("/workspace"))
            .await
            .unwrap();
        let (reply, wait) = oneshot::channel();
        let wait = RefCell::new(Some(wait));
        h.adapter(0).once("interruptTurn", move |_| {
            let wait = wait.borrow_mut().take().unwrap();
            Box::pin(async move { wait.await.unwrap() })
        });
        let service = h.service.clone();
        let caller = owner.clone();
        let input = json!({"sessionId": id, "commandId": "interrupt-a", "turnId": "turn-1"});
        let interrupt = spawn_local(async move {
            service
                .interrupt_turn(&caller, &input, Some("/workspace"))
                .await
        });
        settle().await;
        h.adapter(0)
            .emit(native("turn.interrupted", "turn-1", json!({})));
        next_turn(&h, "B");
        h.service
            .start_turn(&owner, &request(&id, "b"), Some("/workspace"))
            .await
            .unwrap();
        for (kind, req, item) in [
            ("approval.requested", "approval-B", "tool-B"),
            ("question.requested", "question-B", "question-B"),
        ] {
            let mut event = native(kind, "B", json!({"requestId": req, "questions": []}));
            event["itemId"] = json!(item);
            h.adapter(0).emit(event);
        }
        reply.send(Ok(Value::Null)).unwrap();
        interrupt.await.unwrap().unwrap();
        let control = snapshot(&h, &owner, &id)["control"].clone();
        assert_eq!(control["execution"]["activeTurnId"], "B");
        for (key, expected) in [("approvals", "approval-B"), ("questions", "question-B")] {
            let pending = control["interaction"][key].as_array().unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0]["requestId"], expected);
        }
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn written_start_timeout_stays_unknown_until_native_confirmation_without_restarting_or_resending() {
    use crate::agent::transports::jsonl_rpc_connection::{
        ConnectionOptions, JsonlRpcConnection, RequestOptions,
    };
    use crate::agent::transports::test_support::fake_spawner;
    run_paused(async {
        let (h, owner, id) = setup(HarnessOptions::default()).await;
        let (spawner, child) = fake_spawner(true);
        let rpc = JsonlRpcConnection::spawn(ConnectionOptions {
            executable_path: "/usr/local/bin/codex".into(),
            cwd: "/workspace".into(),
            env: Some(vec![]),
            spawner: Some(spawner),
            ..Default::default()
        })
        .unwrap();
        let connection = rpc.clone();
        h.adapter(0).once("startTurn", move |_| {
            let connection = connection.clone();
            Box::pin(async move {
                connection
                    .request(
                        "turn/start",
                        json!({}),
                        RequestOptions {
                            timeout_ms: Some(20),
                            ..Default::default()
                        },
                    )
                    .await
                    .map_err(|mut error| {
                        error.client_user_message_id = Some("native-user-ambiguous".into());
                        error
                    })
            })
        });
        let service = h.service.clone();
        let caller = owner.clone();
        let input = request(&id, "ambiguous");
        let start = spawn_local(async move {
            service
                .start_turn(&caller, &input, Some("/workspace"))
                .await
        });
        settle().await;
        assert_eq!(child.messages().len(), 1);
        assert_eq!(child.messages()[0]["method"], "turn/start");
        tokio::time::advance(std::time::Duration::from_millis(25)).await;
        start.await.unwrap().unwrap();
        let control = snapshot(&h, &owner, &id)["control"].clone();
        assert_eq!(command(&control, "ambiguous")["status"], "outcome-unknown");
        assert_eq!(
            command(&control, "ambiguous")["userMessageId"],
            "native-user-ambiguous"
        );
        assert_eq!(control["execution"]["status"], "outcome-unknown");
        assert_eq!(control["execution"]["certainty"], "unknown");
        assert!(child.kills.borrow().is_empty());
        h.adapter(0).emit(native(
            "turn.started",
            "late-turn",
            json!({"clientUserMessageId": "native-user-ambiguous"}),
        ));
        let confirmed = snapshot(&h, &owner, &id)["control"].clone();
        assert_eq!(confirmed["execution"]["status"], "active");
        assert_eq!(confirmed["execution"]["activeTurnId"], "late-turn");
        assert_eq!(command(&confirmed, "ambiguous")["status"], "accepted");
        h.adapter(0)
            .emit(native("turn.completed", "late-turn", json!({})));
        assert_eq!(
            snapshot(&h, &owner, &id)["control"]["execution"]["nativeOutcome"],
            "completed"
        );
        assert_eq!(h.adapter(0).calls("startTurn").len(), 1);
        assert_eq!(child.messages().len(), 1);
        assert!(child.kills.borrow().is_empty());
        rpc.dispose("test cleanup", true);
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn rejected_queued_start_releases_exactly_its_own_attachment_lease() {
    run(async {
        let leases = Rc::new(Leases::default());
        let (h, owner, id) = setup(HarnessOptions {
            capabilities: Some(json!({"queue": true})),
            attachment_store: Some(leases.clone()),
            ..Default::default()
        })
        .await;
        h.service
            .start_turn(&owner, &request(&id, "a"), Some("/workspace"))
            .await
            .unwrap();
        let token = "q".repeat(43);
        h.service
            .start_turn(
                &owner,
                &lease_request(&id, "queued", &token),
                Some("/workspace"),
            )
            .await
            .unwrap();
        h.adapter(0).once("startTurn", |_| {
            Box::pin(async { Err(AgentError::new("native rejected queued turn")) })
        });
        h.adapter(0)
            .emit(native("turn.completed", "turn-1", json!({})));
        settle().await;
        assert_eq!(
            *leases.released.borrow(),
            [
                json!({"ownerId": 900, "workspaceRoot": "/workspace", "leaseId": "lease-queued", "tokens": [token]})
            ]
        );
        assert!(leases.revoked.borrow().is_empty());
        assert_eq!(h.adapter(0).calls("startTurn").len(), 2);
        assert_eq!(
            command(&snapshot(&h, &owner, &id)["control"], "queued")["status"],
            "rejected"
        );
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn accepted_queued_lease_is_owned_until_its_turn_finishes() {
    run(async {
        let leases = Rc::new(Leases::default());
        let (h, owner, id) = setup(HarnessOptions {
            capabilities: Some(json!({"queue": true})),
            attachment_store: Some(leases.clone()),
            ..Default::default()
        })
        .await;
        h.service
            .start_turn(&owner, &request(&id, "a"), Some("/workspace"))
            .await
            .unwrap();
        let token = "q".repeat(43);
        h.service
            .start_turn(
                &owner,
                &lease_request(&id, "queued", &token),
                Some("/workspace"),
            )
            .await
            .unwrap();
        next_turn(&h, "B");
        h.adapter(0)
            .emit(native("turn.completed", "turn-1", json!({})));
        settle().await;
        assert!(leases.released.borrow().is_empty());
        assert!(leases.revoked.borrow().is_empty());
        assert_eq!(
            command(&snapshot(&h, &owner, &id)["control"], "queued")["status"],
            "accepted"
        );
        h.adapter(0).emit(native("turn.completed", "B", json!({})));
        settle().await;
        assert_eq!(
            *leases.revoked.borrow(),
            [json!({"ownerId": 900, "workspaceRoot": "/workspace", "tokens": [token]})]
        );
        assert!(leases.released.borrow().is_empty());
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn equal_command_ids_belong_to_separate_session_queues() {
    run(async {
        let (h, owner, id) = setup(HarnessOptions {
            capabilities: Some(json!({"queue": true})),
            ..Default::default()
        })
        .await;
        let other = h
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap()["session"]["id"]
            .clone();
        for (session, first, prompt) in [
            (&id, "first-a", "A queued"),
            (&other, "first-b", "B queued"),
        ] {
            h.service
                .start_turn(&owner, &request(session, first), Some("/workspace"))
                .await
                .unwrap();
            let mut input = request(session, "same-id");
            input["prompt"] = json!(prompt);
            h.service
                .start_turn(&owner, &input, Some("/workspace"))
                .await
                .unwrap();
        }
        h.adapter(0)
            .emit(native("turn.completed", "turn-1", json!({})));
        settle().await;
        assert_eq!(h.adapter(0).calls("startTurn").len(), 2);
        assert_eq!(h.adapter(0).calls("startTurn")[1]["prompt"], "A queued");
        assert_eq!(h.adapter(1).calls("startTurn").len(), 1);
        assert_eq!(
            command(&snapshot(&h, &owner, &other)["control"], "same-id")["status"],
            "queued"
        );
        h.adapter(1)
            .emit(native("turn.completed", "turn-1", json!({})));
        settle().await;
        assert_eq!(h.adapter(1).calls("startTurn").len(), 2);
        assert_eq!(h.adapter(1).calls("startTurn")[1]["prompt"], "B queued");
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn queued_dispatch_rechecks_idle_after_a_native_turn_starts_in_the_same_tick() {
    run(async {
        let (h, owner, id) = setup(HarnessOptions {
            capabilities: Some(json!({"queue": true})),
            ..Default::default()
        })
        .await;
        for input in [request(&id, "a"), request(&id, "queued")] {
            h.service
                .start_turn(&owner, &input, Some("/workspace"))
                .await
                .unwrap();
        }
        h.adapter(0)
            .emit(native("turn.completed", "turn-1", json!({})));
        h.adapter(0)
            .emit(native("turn.started", "native-B", json!({})));
        settle().await;
        assert_eq!(h.adapter(0).calls("startTurn").len(), 1);
        assert_eq!(
            command(&snapshot(&h, &owner, &id)["control"], "queued")["status"],
            "queued"
        );
        h.service.close_all().await.unwrap();
    });
}

#[test]
fn late_steer_failure_cannot_replace_the_following_turns_attachment_ownership() {
    run(async {
        let leases = Rc::new(Leases::default());
        let (h, owner, id) = setup(HarnessOptions {
            capabilities: Some(json!({"steer": true})),
            attachment_store: Some(leases.clone()),
            ..Default::default()
        })
        .await;
        let a = "a".repeat(43);
        let b = "b".repeat(43);
        h.service
            .start_turn(&owner, &lease_request(&id, "A", &a), Some("/workspace"))
            .await
            .unwrap();
        let (reply, wait) = oneshot::channel();
        let wait = RefCell::new(Some(wait));
        h.adapter(0).once("steerTurn", move |_| {
            let wait = wait.borrow_mut().take().unwrap();
            Box::pin(async move { wait.await.unwrap() })
        });
        let service = h.service.clone();
        let caller = owner.clone();
        let input = json!({"sessionId": id, "turnId": "turn-1", "commandId": "steer-A", "message": "continue"});
        let steering = spawn_local(async move {
            service
                .steer_turn(&caller, &input, Some("/workspace"))
                .await
        });
        settle().await;
        h.adapter(0)
            .emit(native("turn.completed", "turn-1", json!({})));
        next_turn(&h, "B");
        h.service
            .start_turn(&owner, &lease_request(&id, "B", &b), Some("/workspace"))
            .await
            .unwrap();
        reply
            .send(Err(AgentError::new("late A steer failure")))
            .unwrap();
        assert!(steering.await.unwrap().is_err());
        settle().await;
        assert_eq!(
            *leases.revoked.borrow(),
            [json!({"ownerId": 900, "workspaceRoot": "/workspace", "tokens": [a]})]
        );
        h.adapter(0).emit(native("turn.completed", "B", json!({})));
        settle().await;
        assert_eq!(
            *leases.revoked.borrow(),
            [
                json!({"ownerId": 900, "workspaceRoot": "/workspace", "tokens": [a]}),
                json!({"ownerId": 900, "workspaceRoot": "/workspace", "tokens": [b]})
            ]
        );
        assert!(leases.released.borrow().is_empty());
        h.service.close_all().await.unwrap();
    });
}

/// `electron.agent-sidebar-contracts`: `returns the native confirmed outcome
/// when the real start transaction loses its receipt`.
#[test]
fn a_lost_start_receipt_returns_the_native_confirmed_outcome() {
    run(async {
        let (h, owner, id) = setup(HarnessOptions::default()).await;
        let emit = h.adapter(0).emitter();
        h.adapter(0).once("startTurn", move |request| {
            let user = request["clientUserMessageId"].clone();
            emit(native(
                "turn.started",
                "fast",
                json!({"userMessageId": user}),
            ));
            emit(native("turn.completed", "fast", json!({})));
            Box::pin(async move { Err(AgentError::new("RPC receipt lost")) })
        });
        let receipt = h
            .service
            .start_turn(&owner, &request(&id, "once"), Some("/workspace"))
            .await
            .unwrap();
        assert_eq!(receipt["turnId"], "fast");
        let replay = snapshot(&h, &owner, &id);
        let execution = &replay["control"]["execution"];
        assert_eq!(execution["status"], "ended");
        assert_eq!(execution["nativeOutcome"], "completed");
        let users = replay["display"]["parts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["kind"] == "user")
            .count();
        assert_eq!(users, 1);
        assert_eq!(h.adapter(0).calls("startTurn").len(), 1);
        h.service.close_all().await.unwrap();
    });
}

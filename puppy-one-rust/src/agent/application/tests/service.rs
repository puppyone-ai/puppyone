//! `tests/integration/agent/sessions/electron.agent-service.test.mjs`.
use super::harness::{
    HarnessOptions, create_sender, create_service_harness, run, run_paused,
    semantic_reference_capabilities, settle,
};
use crate::agent::agent_error::AgentError;
use crate::agent::application::ports::{AttachmentStore, Pending};
use crate::agent::runtime::agent_runtime_port::agent_provider_session_unavailable_error;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;

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

fn err_message<T: std::fmt::Debug>(result: Result<T, AgentError>) -> String {
    result.unwrap_err().message
}

fn types(events: &Value) -> Vec<String> {
    events
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["type"].as_str().unwrap_or("").to_string())
        .collect()
}

#[test]
fn returns_installed_runtime_inventory_without_inspecting_or_selecting_a_default_runtime() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let inspection = harness
            .service
            .discover_providers(&json!({}), Some("/workspace"))
            .await
            .unwrap();
        assert_match!(
            inspection,
            json!({
                "selectedRuntimeId": null, "readiness": null, "account": null, "providers": [], "models": [], "capabilities": null,
            })
        );
        let ids: Vec<&Value> = inspection["runtimes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| &e["descriptor"]["id"])
            .collect();
        assert_eq!(ids, [&json!("codex")]);
        assert!(harness.adapters.borrow().is_empty());
    });
}

#[test]
fn requires_an_explicit_runtime_before_creating_a_session() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (sender, _) = create_sender(101);
        let message = err_message(
            harness
                .service
                .create_session(&sender, &json!({}), "/workspace")
                .await,
        );
        assert!(
            message.to_lowercase().contains("choose an agent"),
            "{message}"
        );
        assert!(harness.adapters.borrow().is_empty());
    });
}

#[test]
fn binds_sessions_to_one_sender_and_rejects_cross_window_mutations() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(1);
        let (attacker, _) = create_sender(2);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = snapshot["session"]["id"].clone();
        assert!(
            err_message(harness.service.replay(
                &attacker,
                &json!({"sessionId": id, "afterSequence": 0}),
                None
            ))
            .contains("another window")
        );
        assert!(
            err_message(
                harness
                    .service
                    .start_turn(
                        &attacker,
                        &json!({"sessionId": id, "prompt": "attack"}),
                        None
                    )
                    .await
            )
            .contains("another window")
        );
        assert!(
            err_message(
                harness
                    .service
                    .interrupt_turn(
                        &attacker,
                        &json!({"sessionId": id, "turnId": "turn-1"}),
                        None
                    )
                    .await
            )
            .contains("another window")
        );
        assert!(
            err_message(
                harness
                    .service
                    .close_session(&attacker, &json!({"sessionId": id}), None)
                    .await
            )
            .contains("another window")
        );
    });
}

#[test]
fn keeps_a_turn_alive_without_renderer_visibility_and_cleans_up_on_window_close() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(3);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let result = harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": snapshot["session"]["id"], "prompt": "Keep running"}),
                None,
            )
            .await
            .unwrap();
        assert_eq!(result["turnId"], "turn-1");
        assert!(!harness.adapter(0).disposed.get());
        harness.service.close_sessions_for_window(3).await.unwrap();
        assert!(harness.adapter(0).disposed.get());
        assert_eq!(harness.service.get_session_count(), 0);
    });
}

struct RevokingStore {
    calls: RefCell<Vec<(String, Value)>>,
}

impl AttachmentStore for RevokingStore {
    fn supports(&self, method: &str) -> bool {
        matches!(method, "revokeWorkspace" | "revokeOwner" | "revoke")
    }
    fn revoke_workspace(&self, owner_id: u64, workspace_root: String) -> Pending<()> {
        self.calls
            .borrow_mut()
            .push(("revokeWorkspace".into(), json!([owner_id, workspace_root])));
        Box::pin(async { Ok(()) })
    }
    fn revoke_owner(&self, owner_id: u64) -> Pending<()> {
        self.calls
            .borrow_mut()
            .push(("revokeOwner".into(), json!(owner_id)));
        Box::pin(async { Ok(()) })
    }
    fn revoke(&self, request: Value) -> Pending<Value> {
        self.calls.borrow_mut().push(("revoke".into(), request));
        Box::pin(async { Ok(json!({"revoked": 1})) })
    }
    fn close(&self) -> Pending<()> {
        self.calls.borrow_mut().push(("close".into(), Value::Null));
        Box::pin(async { Ok(()) })
    }
}

#[test]
fn closes_one_roots_sessions_without_disposing_sibling_root_agents() {
    run(async {
        let store = Rc::new(RevokingStore {
            calls: RefCell::default(),
        });
        let harness = create_service_harness(HarnessOptions {
            attachment_store: Some(store.clone()),
            ..Default::default()
        });
        let (owner, _) = create_sender(30);
        harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace-a")
            .await
            .unwrap();
        harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace-b")
            .await
            .unwrap();
        assert_eq!(
            harness
                .service
                .close_sessions_for_workspace_root(30, "/workspace-a")
                .await
                .unwrap(),
            1
        );
        assert!(harness.adapter(0).disposed.get());
        assert!(!harness.adapter(1).disposed.get());
        assert_eq!(harness.service.get_session_count(), 1);
        assert!(
            store
                .calls
                .borrow()
                .contains(&("revokeWorkspace".into(), json!([30, "/workspace-a"])))
        );
        harness.service.close_all().await.unwrap();
    });
}

#[test]
fn supports_multiple_tab_owned_live_sessions_and_preserves_process_local_recovery_on_close() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(33);
        let first = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let second = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        assert_ne!(first["session"]["id"], second["session"]["id"]);
        assert_eq!(harness.service.get_session_count(), 2);
        for snapshot in [&first, &second] {
            harness
                .service
                .close_session(
                    &owner,
                    &json!({"sessionId": snapshot["session"]["id"]}),
                    Some("/workspace"),
                )
                .await
                .unwrap();
        }
        assert!(harness.persistence.removed.borrow().is_empty());
        for snapshot in [&first, &second] {
            assert!(harness.persistence.saves.borrow().iter().any(
                |(record, promote)| record["sessionId"] == snapshot["session"]["id"] && !promote
            ));
        }
    });
}

#[test]
fn keeps_an_allocated_empty_session_out_of_durable_history_until_native_persistence_is_confirmed() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(36);
        let empty = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        harness
            .service
            .close_session(
                &owner,
                &json!({"sessionId": empty["session"]["id"]}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let last = harness.persistence.saves.borrow().last().cloned().unwrap();
        assert_eq!(
            (last.0["sessionId"].clone(), last.1),
            (empty["session"]["id"].clone(), false)
        );
        let durable = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": durable["session"]["id"], "prompt": "Persist me"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        harness.last_adapter().confirm_persistence();
        settle().await;
        harness
            .service
            .close_session(
                &owner,
                &json!({"sessionId": durable["session"]["id"]}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let last = harness.persistence.saves.borrow().last().cloned().unwrap();
        assert_eq!(
            (last.0["sessionId"].clone(), last.1),
            (durable["session"]["id"].clone(), true)
        );
    });
}

#[test]
fn allows_two_same_workspace_chat_tabs_to_prepare_sessions_concurrently() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(35);
        let request = json!({"runtimeId": "codex"});
        let (first, second) = futures_util::future::join(
            harness
                .service
                .create_session(&owner, &request, "/workspace"),
            harness
                .service
                .create_session(&owner, &request, "/workspace"),
        )
        .await;
        assert_ne!(
            first.unwrap()["session"]["id"],
            second.unwrap()["session"]["id"]
        );
        assert_eq!(harness.service.get_session_count(), 2);
        assert_eq!(harness.adapters.borrow().len(), 2);
    });
}

#[test]
fn indexes_native_session_metadata_on_explicit_refresh_without_persisting_transcript_payloads() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            native_sessions: vec![json!({
                "providerSessionId": "native-external", "title": "Existing Codex chat",
                "createdAt": "2026-08-29T00:00:00.000Z", "updatedAt": "2026-08-30T00:00:00.000Z",
                "events": [{"payload": {"text": "private transcript"}}],
            })],
            ..Default::default()
        });
        let (sender, _) = create_sender(34);
        let result = harness
            .service
            .list_sessions(
                &sender,
                &json!({"runtimeId": "codex", "discoverNative": true, "limit": 25}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_match!(
            result["discovery"],
            json!({"runtimeId": "codex", "status": "complete", "nextCursor": null})
        );
        assert_eq!(result["sessions"].as_array().unwrap().len(), 1);
        assert_match!(
            result["sessions"][0],
            json!({"runtimeId": "codex", "providerSessionId": "native-external", "origin": "native-discovery"})
        );
        assert!(
            harness
                .persistence
                .upserts
                .borrow()
                .iter()
                .all(|entry| entry.get("events").is_none())
        );
    });
}

#[test]
fn rejects_a_model_that_is_not_in_the_inspected_connected_provider_catalog() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(32);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let message = err_message(
            harness
                .service
                .start_turn(&owner, &json!({"sessionId": snapshot["session"]["id"], "prompt": "Use an injected model", "model": "unconnected/hidden-model"}), None)
                .await,
        );
        assert!(
            message.contains("no longer available from a connected provider"),
            "{message}"
        );
        assert!(harness.adapter(0).calls("startTurn").is_empty());
    });
}

#[test]
fn does_not_resurrect_a_turn_that_completed_before_turn_start_returned() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(31);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let adapter = harness.adapter(0);
        let emit = adapter.emitter();
        adapter.once("startTurn", move |_| {
            emit(json!({"type": "turn.started", "providerSessionId": "thread-1", "turnId": "turn-fast", "payload": {"status": "running"}}));
            emit(json!({"type": "turn.completed", "providerSessionId": "thread-1", "turnId": "turn-fast", "payload": {"status": "completed"}}));
            Box::pin(async { Ok(json!({"turnId": "turn-fast"})) })
        });
        let id = snapshot["session"]["id"].clone();
        harness
            .service
            .start_turn(&owner, &json!({"sessionId": id, "prompt": "Quick"}), None)
            .await
            .unwrap();
        let replay = harness
            .service
            .replay(&owner, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap();
        assert!(replay["session"]["activeTurnId"].is_null());
        assert_eq!(replay["session"]["terminalState"], "completed");
        assert_eq!(
            types(&replay["events"])
                .iter()
                .filter(|t| *t == "turn.started")
                .count(),
            1
        );
        let completed = replay["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "turn.completed")
            .unwrap();
        assert!(completed["payload"]["durationMs"].is_number());
    });
}

#[test]
fn fails_pending_approvals_closed_without_fabricating_a_terminal_outcome_on_provider_exit() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(4);
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
        adapter.emit(json!({
            "type": "approval.requested", "providerSessionId": "thread-1", "turnId": "turn-1", "itemId": "item-1",
            "payload": {"requestId": "codex:1", "kind": "command", "availableDecisions": ["accept", "decline", "cancel"]},
        }));
        adapter.exit(json!({"expected": false, "diagnostics": "token=secret-value"}));
        settle().await;
        let replay = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace"),
            )
            .unwrap();
        let events = replay["events"].as_array().unwrap();
        assert!(
            events
                .iter()
                .any(|e| e["type"] == "approval.resolved" && e["payload"]["decision"] == "cancel")
        );
        assert!(!events.iter().any(|e| e["type"] == "turn.failed"));
        assert_match!(
            replay["control"]["execution"],
            json!({"status": "outcome-unknown", "uncertainTurnId": "turn-1", "certainty": "unknown"})
        );
        assert!(!replay["events"].to_string().contains("secret-value"));
        assert!(adapter.disposed.get());
        assert_eq!(harness.service.get_session_count(), 0);
    });
}

#[test]
fn resumes_immediately_from_the_retired_in_memory_snapshot_after_provider_exit() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(41);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        harness
            .adapter(0)
            .exit(json!({"expected": false, "diagnostics": "provider crashed"}));
        settle().await;
        assert_eq!(harness.service.get_session_count(), 0);
        assert_eq!(harness.service.get_retained_session_count(), 1);
        assert!(harness.adapter(0).disposed.get());
        let resumed = harness
            .service
            .resume_session(
                &owner,
                &json!({"sessionId": created["session"]["id"]}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(resumed["session"]["id"], created["session"]["id"]);
        assert_eq!(harness.adapters.borrow().len(), 2);
        assert_eq!(
            harness.adapter(1).calls("resumeSession"),
            [json!({"threadId": "thread-1", "model": "gpt-5"})]
        );
        assert_eq!(harness.service.get_session_count(), 1);
    });
}

#[test]
fn keeps_a_completed_turn_ready_when_its_idle_provider_process_exits() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(42);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let adapter = harness.adapter(0);
        let emit = adapter.emitter();
        adapter.once("startTurn", move |_| {
            emit(json!({"type": "turn.started", "providerSessionId": "thread-1", "turnId": "turn-settled", "payload": {"status": "running"}}));
            emit(json!({"type": "turn.completed", "providerSessionId": "thread-1", "turnId": "turn-settled", "payload": {"status": "completed"}}));
            Box::pin(async { Ok(json!({"turnId": "turn-settled"})) })
        });
        let id = created["session"]["id"].clone();
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": id, "prompt": "Finish first"}),
                None,
            )
            .await
            .unwrap();
        adapter.exit(json!({"expected": false, "diagnostics": "idle transport closed"}));
        settle().await;
        let replay = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace"),
            )
            .unwrap();
        assert!(
            !types(&replay["events"])
                .iter()
                .any(|t| t == "provider.error")
        );
        assert_match!(
            replay["control"]["connection"],
            json!({"status": "exited", "reason": "provider-idle-exit"})
        );
        assert_match!(
            replay["control"]["execution"],
            json!({"status": "ended", "certainty": "confirmed"})
        );
        assert_match!(
            replay["display"]["presentation"],
            json!({"phase": "ready", "terminalState": "completed"})
        );
        assert_eq!(replay["session"]["terminalState"], "completed");
        assert_eq!(harness.service.get_session_count(), 0);
        assert_eq!(harness.service.get_retained_session_count(), 1);
    });
}

#[test]
fn discards_stale_native_session_metadata_and_falls_back_to_a_clean_session() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            resume_session_error: Some(agent_provider_session_unavailable_error(Some(
                "The saved Codex thread is gone.",
            ))),
            ..Default::default()
        });
        let (owner, _) = create_sender(43);
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
                &json!({"sessionId": id, "prompt": "Make this conversation durable"}),
                None,
            )
            .await
            .unwrap();
        harness.last_adapter().confirm_persistence();
        settle().await;
        harness.service.close_sessions_for_window(43).await.unwrap();
        assert!(
            harness
                .service
                .resume_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
                .await
                .unwrap()
                .is_null()
        );
        assert!(
            harness
                .persistence
                .unavailable
                .borrow()
                .contains(&id.as_str().unwrap().to_string())
        );
        assert_eq!(harness.service.get_session_count(), 0);
        assert!(
            harness
                .service
                .resume_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
                .await
                .unwrap()
                .is_null()
        );
    });
}

#[test]
fn does_not_discard_a_retired_snapshot_when_a_different_requested_session_is_missing() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(42);
        harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        harness
            .adapter(0)
            .exit(json!({"expected": false, "diagnostics": "provider crashed"}));
        settle().await;
        let missing = harness
            .service
            .resume_session(
                &owner,
                &json!({"sessionId": "missing-session"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert!(missing.is_null());
        assert_eq!(harness.service.get_retained_session_count(), 1);
        let resumed = harness
            .service
            .resume_session(&owner, &json!({}), "/workspace")
            .await
            .unwrap();
        assert!(!resumed.is_null());
    });
}

#[test]
fn opens_an_exact_history_target_with_a_structured_result() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            native_sessions: vec![json!({
                "providerSessionId": "native-history", "title": "Saved chat",
                "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:01.000Z",
            })],
            ..Default::default()
        });
        let (owner, _) = create_sender(44);
        let listed = harness
            .service
            .list_sessions(
                &owner,
                &json!({"runtimeId": "codex", "discoverNative": true}),
                "/workspace",
            )
            .await
            .unwrap();
        let session_id = listed["sessions"][0]["id"].clone();
        let opened = harness
            .service
            .open_session(
                &owner,
                &json!({"sessionId": session_id, "runtimeId": "codex"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_match!(
            opened,
            json!({"status": "opened", "snapshot": {"session": {"id": session_id}}})
        );
    });
}

#[test]
fn classifies_a_missing_exact_history_target_without_throwing_across_ipc() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (sender, _) = create_sender(45);
        let opened = harness
            .service
            .open_session(
                &sender,
                &json!({"sessionId": "missing-session", "runtimeId": "codex"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(
            opened,
            json!({
                "status": "failed",
                "error": {"code": "SESSION_NOT_FOUND", "message": "This saved Agent session is no longer available.", "retryable": false},
            })
        );
    });
}

#[test]
fn does_not_expose_or_open_an_unverified_legacy_locator() {
    run(async {
        use crate::agent::application::ports::SessionCache;
        let harness = create_service_harness(HarnessOptions::default());
        harness
            .persistence
            .save(
                json!({
                    "sessionId": "legacy-empty-session", "workspaceRoot": "/workspace", "runtimeId": "codex",
                    "providerSessionId": "thread-without-rollout", "title": "Codex session",
                    "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:01.000Z", "availability": "unverified",
                }),
                false,
            )
            .await
            .unwrap();
        let (sender, _) = create_sender(46);
        let listed = harness
            .service
            .list_sessions(
                &sender,
                &json!({"runtimeId": "codex", "discoverNative": false}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(listed["sessions"], json!([]));
        let opened = harness
            .service
            .open_session(
                &sender,
                &json!({"sessionId": "legacy-empty-session", "runtimeId": "codex"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_match!(
            opened,
            json!({"status": "failed", "error": {"code": "SESSION_NOT_FOUND", "retryable": false}})
        );
        assert!(harness.adapters.borrow().is_empty());
    });
}

#[test]
fn hydrates_native_history_when_resume_emitted_only_lifecycle_or_diagnostic_events() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            native_sessions: vec![json!({
                "providerSessionId": "native-history", "title": "Saved chat",
                "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:01.000Z",
            })],
            resume_events: vec![
                json!({"type": "session.resumed", "providerSessionId": "native-history", "payload": {"title": "Saved chat"}}),
                json!({"type": "provider.warning", "providerSessionId": "native-history", "payload": {"message": "operator diagnostic"}}),
            ],
            historical_events: vec![
                json!({"type": "turn.started", "providerSessionId": "native-history", "turnId": "turn-1", "payload": {"status": "running", "restored": true, "prompt": "hello"}}),
                json!({"type": "assistant.completed", "providerSessionId": "native-history", "turnId": "turn-1", "itemId": "answer-1", "payload": {"text": "hi"}}),
                json!({"type": "turn.completed", "providerSessionId": "native-history", "turnId": "turn-1", "payload": {"status": "completed", "restored": true}}),
            ],
            ..Default::default()
        });
        let (owner, _) = create_sender(47);
        let listed = harness
            .service
            .list_sessions(
                &owner,
                &json!({"runtimeId": "codex", "discoverNative": true}),
                "/workspace",
            )
            .await
            .unwrap();
        let opened = harness
            .service
            .open_session(
                &owner,
                &json!({"sessionId": listed["sessions"][0]["id"], "runtimeId": "codex"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(opened["status"], "opened");
        assert_eq!(harness.adapter(1).history_reads.get(), 1);
        let events = opened["snapshot"]["events"].as_array().unwrap();
        assert!(
            events
                .iter()
                .any(|e| e["type"] == "turn.started" && e["payload"]["prompt"] == "hello")
        );
        assert!(
            events.iter().any(
                |e| e["type"] == "assistant.completed" && e["payload"] == json!({"text": "hi"})
            )
        );
    });
}

#[test]
fn reconciles_an_unconfirmed_persisted_turn_with_the_native_terminal_object_on_resume() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            historical_events: vec![
                json!({"type": "turn.started", "providerSessionId": "thread-1", "turnId": "turn-1", "payload": {"status": "running", "restored": true}}),
                json!({"type": "assistant.completed", "providerSessionId": "thread-1", "turnId": "turn-1", "itemId": "answer-1", "payload": {"text": "done"}}),
                json!({"type": "turn.completed", "providerSessionId": "thread-1", "turnId": "turn-1", "payload": {"status": "completed", "restored": true}}),
            ],
            ..Default::default()
        });
        let (owner, _) = create_sender(48);
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
        harness
            .service
            .close_session(
                &owner,
                &json!({"sessionId": id, "removePersistence": false}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let resumed = harness
            .service
            .resume_session(&owner, &json!({"sessionId": id}), "/workspace")
            .await
            .unwrap();
        assert_eq!(harness.adapter(1).history_reads.get(), 1);
        assert_match!(
            resumed["control"]["execution"],
            json!({
                "status": "ended", "activeTurnId": null, "uncertainTurnId": null, "nativeOutcome": "completed", "certainty": "confirmed",
            })
        );
    });
}

#[test]
fn rejects_stale_approvals_and_bounds_retained_replay_for_a_slow_renderer() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(5);
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
        adapter.emit(json!({
            "type": "approval.requested", "providerSessionId": "thread-1", "turnId": "turn-1", "itemId": "item-1",
            "payload": {"requestId": "codex:2", "kind": "command", "availableDecisions": ["accept", "decline", "cancel"]},
        }));
        let request = json!({"sessionId": id, "turnId": "turn-1", "requestId": "codex:2", "decision": "decline"});
        assert_match!(
            harness
                .service
                .resolve_approval(&owner, &request, None)
                .await
                .unwrap(),
            json!({"decision": "decline"})
        );
        let mut stale = request.clone();
        stale["decision"] = json!("accept");
        assert!(
            err_message(harness.service.resolve_approval(&owner, &stale, None).await)
                .contains("stale")
        );
        for index in 0..1_100 {
            adapter.emit(json!({"type": "provider.warning", "payload": {"message": format!("warning {index}")}}));
        }
        let replay = harness
            .service
            .replay(&owner, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap();
        let events = replay["events"].as_array().unwrap();
        assert_eq!(events.len(), 1_000);
        let first = replay["firstAvailableSequence"].as_i64().unwrap();
        assert!(first > 1);
        assert_eq!(events[0]["sequence"].as_i64(), Some(first));
        assert_match!(
            *events.last().unwrap(),
            json!({"type": "provider.warning", "payload": {"message": "warning 1099"}})
        );
        assert!(
            events
                .iter()
                .enumerate()
                .all(|(index, e)| e["sequence"].as_i64() == Some(first + index as i64))
        );
    });
}

#[test]
fn deduplicates_blocking_requests_replayed_during_runtime_reconciliation() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(51);
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
        let approval = json!({
            "type": "approval.requested", "providerSessionId": "thread-1", "turnId": "turn-1", "itemId": "item-approval",
            "payload": {"requestId": "runtime:approval", "kind": "command", "availableDecisions": ["accept", "decline", "cancel"]},
        });
        let question = json!({
            "type": "question.requested", "providerSessionId": "thread-1", "turnId": "turn-1", "itemId": "item-question",
            "payload": {"requestId": "runtime:question", "questions": [{"question": "Continue?", "options": []}]},
        });
        for event in [&approval, &approval, &question, &question] {
            adapter.emit(event.clone());
        }
        let events = harness
            .service
            .replay(&owner, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap()["events"]
            .clone();
        let kinds = types(&events);
        assert_eq!(
            kinds.iter().filter(|t| *t == "approval.requested").count(),
            1
        );
        assert_eq!(
            kinds.iter().filter(|t| *t == "question.requested").count(),
            1
        );
    });
}

#[test]
fn closes_every_adapter_during_app_level_cleanup() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        harness
            .service
            .create_session(
                &create_sender(6).0,
                &json!({"runtimeId": "codex"}),
                "/workspace-a",
            )
            .await
            .unwrap();
        harness
            .service
            .create_session(
                &create_sender(7).0,
                &json!({"runtimeId": "codex"}),
                "/workspace-b",
            )
            .await
            .unwrap();
        harness.service.close_all().await.unwrap();
        assert!(harness.adapters.borrow().iter().all(|a| a.disposed.get()));
        assert_eq!(harness.service.get_session_count(), 0);
    });
}

#[test]
fn fails_a_pending_approval_closed_then_confirms_the_interrupt_once_the_provider_acknowledges_it() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(10);
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
        adapter.emit(json!({
            "type": "approval.requested", "providerSessionId": "thread-1", "turnId": "turn-1", "itemId": "item-1",
            "payload": {"requestId": "codex:interrupt", "kind": "command", "availableDecisions": ["accept", "decline", "cancel"]},
        }));
        let emit = adapter.emitter();
        adapter.always("interruptTurn", move |_| {
            emit(json!({"type": "turn.interrupted", "providerSessionId": "thread-1", "turnId": "turn-1", "payload": {"status": "interrupted"}}));
            Box::pin(async { Ok(Value::Null) })
        });
        harness
            .service
            .interrupt_turn(&owner, &json!({"sessionId": id, "turnId": "turn-1"}), None)
            .await
            .unwrap();
        let replay = harness
            .service
            .replay(&owner, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap();
        let events = replay["events"].as_array().unwrap();
        assert!(events.iter().any(|e| e["type"] == "approval.resolved"
            && e["payload"]["decision"] == "cancel"
            && e["payload"]["requestId"] == "codex:interrupt"));
        assert_eq!(
            events
                .iter()
                .filter(|e| e["type"] == "turn.interrupted")
                .count(),
            1
        );
    });
}

#[test]
fn reports_an_unconfirmed_interrupt_without_terminating_the_native_task() {
    run_paused(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(11);
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
        harness
            .service
            .interrupt_turn(&owner, &json!({"sessionId": id, "turnId": "turn-1"}), None)
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5_100)).await;
        settle().await;
        let replay = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace"),
            )
            .unwrap();
        let events = replay["events"].as_array().unwrap();
        assert!(
            !events
                .iter()
                .any(|e| e["type"] == "turn.interrupted" || e["type"] == "turn.failed")
        );
        assert_match!(
            replay["control"]["execution"],
            json!({"status": "active", "activeTurnId": "turn-1", "certainty": "confirmed"})
        );
        assert!(
            events
                .iter()
                .any(|e| e["payload"]["code"] == "INTERRUPT_UNCONFIRMED")
        );
        assert!(!harness.adapter(0).disposed.get());
        assert_eq!(harness.service.get_session_count(), 1);
        harness.adapter(0).emit(json!({"type": "turn.interrupted", "providerSessionId": "thread-1", "turnId": "turn-1", "payload": {}}));
        let after = harness
            .service
            .replay(&owner, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap();
        assert_match!(
            after["control"]["execution"],
            json!({"status": "ended", "nativeOutcome": "interrupted"})
        );
        harness.service.close_all().await.unwrap();
    });
}

#[test]
fn does_not_fabricate_a_terminal_state_when_the_interrupt_request_itself_fails() {
    run_paused(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(12);
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
        harness.adapter(0).emit(json!({
            "type": "approval.requested", "providerSessionId": "thread-1", "turnId": "turn-1", "itemId": "item-1",
            "payload": {"requestId": "codex:still-actionable", "kind": "command", "availableDecisions": ["accept", "decline", "cancel"]},
        }));
        harness.adapter(0).once("interruptTurn", |_| {
            Box::pin(async { Err(AgentError::new("transport unavailable")) })
        });
        let message = err_message(
            harness
                .service
                .interrupt_turn(&owner, &json!({"sessionId": id, "turnId": "turn-1"}), None)
                .await,
        );
        assert!(message.contains("transport unavailable"));
        tokio::time::sleep(std::time::Duration::from_millis(5_100)).await;
        let replay = harness
            .service
            .replay(&owner, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap();
        assert_eq!(replay["session"]["activeTurnId"], "turn-1");
        let events = replay["events"].as_array().unwrap();
        assert!(
            !events
                .iter()
                .any(|e| e["type"] == "turn.failed" || e["type"] == "turn.interrupted")
        );
        assert!(!events.iter().any(|e| e["type"] == "approval.resolved"
            && e["payload"]["requestId"] == "codex:still-actionable"));
        let approval = json!({"sessionId": id, "turnId": "turn-1", "requestId": "codex:still-actionable", "decision": "decline"});
        assert!(
            harness
                .service
                .resolve_approval(&owner, &approval, None)
                .await
                .is_ok()
        );
        assert_eq!(harness.service.get_session_count(), 1);
    });
}

#[test]
fn keeps_only_one_renderer_destroyed_listener_per_owner_and_removes_it_after_the_final_session() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(13);
        let first = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace-a")
            .await
            .unwrap();
        let second = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace-b")
            .await
            .unwrap();
        // The store registers one destroyed listener per owner: destroying the
        // window after both sessions closed must not reach the service.
        harness
            .service
            .close_session(
                &owner,
                &json!({"sessionId": first["session"]["id"], "removePersistence": true}),
                None,
            )
            .await
            .unwrap();
        assert_eq!(harness.service.get_session_count(), 1);
        harness
            .service
            .close_session(
                &owner,
                &json!({"sessionId": second["session"]["id"], "removePersistence": true}),
                None,
            )
            .await
            .unwrap();
        owner.destroy();
        settle().await;
        assert_eq!(harness.service.get_session_count(), 0);
    });
}

#[test]
fn scrubs_private_snapshot_paths_and_data_urls_from_normalized_renderer_events() {
    run(async {
        let harness = create_service_harness(HarnessOptions {
            capabilities: Some(
                json!({"manualApprovals": true, "attachments": true, "referenceInputs": semantic_reference_capabilities()}),
            ),
            ..Default::default()
        });
        let (owner, _) = create_sender(61);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let id = snapshot["session"]["id"].clone();
        let private_path = "/private/staging/ref.snapshot";
        let snapshot_url = "data:image/png;base64,cHJpdmF0ZQ==";
        harness
            .service
            .start_turn(
                &owner,
                &json!({
                    "sessionId": id, "prompt": "Inspect",
                    "references": [{
                        "authorized": true, "id": "ref-private", "kind": "staged-attachment", "path": private_path,
                        "displayName": "photo.png", "mime": "image/png", "size": 7, "snapshotUrl": snapshot_url,
                    }],
                }),
                None,
            )
            .await
            .unwrap();
        harness.adapter(0).emit(json!({
            "type": "provider.warning", "turnId": "turn-1", "payload": {"message": format!("native echo {private_path} {snapshot_url}")},
        }));
        let serialized = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace"),
            )
            .unwrap()["events"]
            .to_string();
        assert!(!serialized.contains(private_path));
        assert!(!serialized.contains(snapshot_url));
        assert!(serialized.contains("[attachment:photo.png]"));
    });
}

#[test]
fn compiles_an_external_file_mention_for_the_harness_while_persisting_only_display_safe_prompt_data()
 {
    run(async {
        let mut reference_inputs = semantic_reference_capabilities();
        reference_inputs["attachments"]["text"] = json!({"accepted": true});
        let harness = create_service_harness(HarnessOptions {
            capabilities: Some(json!({"referenceInputs": reference_inputs})),
            ..Default::default()
        });
        let (owner, _) = create_sender(66);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace-a")
            .await
            .unwrap();
        let id = snapshot["session"]["id"].clone();
        let private_path = "/private/staging/immutable.snapshot";
        let prompt = "Review @notes.md in this turn";
        harness
            .service
            .start_turn(
                &owner,
                &json!({
                    "sessionId": id, "prompt": prompt,
                    "promptMentions": [{"referenceId": "ref-notes", "start": 7, "end": 16}],
                    "references": [{
                        "authorized": true, "id": "ref-notes", "kind": "staged-attachment", "path": private_path,
                        "displayName": "notes.md", "mime": "text/markdown", "size": 12,
                    }],
                }),
                None,
            )
            .await
            .unwrap();
        let start = harness.adapter(0).calls("startTurn")[0].clone();
        assert_eq!(
            start["prompt"],
            format!("Review `{private_path}` in this turn")
        );
        assert_match!(
            start["references"][0],
            json!({"id": "ref-notes", "inlineMentioned": true})
        );
        let replay = harness
            .service
            .replay(
                &owner,
                &json!({"sessionId": id, "afterSequence": 0}),
                Some("/workspace-a"),
            )
            .unwrap();
        let started = replay["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "turn.started")
            .unwrap()
            .clone();
        assert_match!(
            started["payload"],
            json!({"prompt": prompt, "promptMentions": [{"referenceId": "ref-notes", "start": 7, "end": 16}]})
        );
        assert_match!(
            started["payload"]["referenceDisplays"][0],
            json!({"id": "ref-notes", "displayName": "notes.md"})
        );
        assert!(!started.to_string().contains(private_path));
    });
}

#[test]
fn rejects_references_that_did_not_pass_main_process_authorization() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(64);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let message = err_message(
            harness
                .service
                .start_turn(
                    &owner,
                    &json!({"sessionId": snapshot["session"]["id"], "prompt": "Read it", "references": [{"kind": "workspace-entry", "path": "/workspace/raw.txt"}]}),
                    None,
                )
                .await,
        );
        assert!(
            message.contains("authorized by the main process"),
            "{message}"
        );
    });
}

#[test]
fn releases_attachment_grants_on_window_and_application_lifecycle_cleanup() {
    run(async {
        let store = Rc::new(RevokingStore {
            calls: RefCell::default(),
        });
        let harness = create_service_harness(HarnessOptions {
            attachment_store: Some(store.clone()),
            ..Default::default()
        });
        harness.service.close_sessions_for_window(62).await.unwrap();
        assert!(
            store
                .calls
                .borrow()
                .contains(&("revokeOwner".into(), json!(62)))
        );
        harness.service.close_all().await.unwrap();
        assert_eq!(
            store
                .calls
                .borrow()
                .iter()
                .filter(|(m, _)| m == "close")
                .count(),
            1
        );
    });
}

#[test]
fn retains_local_snapshots_for_the_native_turn_and_releases_them_at_terminal_acceptance() {
    run(async {
        let store = Rc::new(RevokingStore {
            calls: RefCell::default(),
        });
        let harness = create_service_harness(HarnessOptions {
            attachment_store: Some(store.clone()),
            ..Default::default()
        });
        let (owner, _) = create_sender(63);
        let snapshot = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let token = "a".repeat(43);
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": snapshot["session"]["id"], "prompt": "Inspect", "privateReferenceLease": {"leaseId": "lease-test", "tokens": [token]}}),
                None,
            )
            .await
            .unwrap();
        assert!(!store.calls.borrow().iter().any(|(m, _)| m == "revoke"));
        harness.adapter(0).emit(json!({"type": "turn.completed", "providerSessionId": "thread-1", "turnId": "turn-1", "payload": {"status": "completed"}}));
        settle().await;
        assert!(store.calls.borrow().contains(&(
            "revoke".into(),
            json!({"ownerId": 63, "workspaceRoot": "/workspace", "tokens": [token]})
        )));
    });
}

#[test]
fn keeps_archive_and_delete_workspace_and_ownership_checks() {
    for method in ["archive", "delete"] {
        run(async {
            let harness = create_service_harness(HarnessOptions::default());
            let (owner, _) = create_sender(93);
            let created = harness
                .service
                .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
                .await
                .unwrap();
            let request = json!({"sessionId": created["session"]["id"]});
            let call = |sender: crate::agent::sender::Sender, root: &'static str| {
                let service = harness.service.clone();
                let request = request.clone();
                async move {
                    if method == "archive" {
                        service.archive_session(&sender, &request, root).await
                    } else {
                        service.delete_session(&sender, &request, root).await
                    }
                }
            };
            assert!(
                err_message(call(owner.clone(), "/different-workspace").await)
                    .contains("workspace")
            );
            assert!(call(create_sender(94).0, "/workspace").await.is_err());
            assert_match!(
                call(owner.clone(), "/workspace").await.unwrap(),
                json!({"sessionId": request["sessionId"]})
            );
            assert_eq!(harness.service.get_session_count(), 0);
            harness.service.close_all().await.unwrap();
        });
    }
}

#[test]
fn keeps_an_active_turn_replay_and_ownership_intact_when_the_catalog_says_unavailable() {
    run(async {
        let harness = create_service_harness(HarnessOptions::default());
        let (owner, _) = create_sender(91);
        let created = harness
            .service
            .create_session(&owner, &json!({"runtimeId": "codex"}), "/workspace")
            .await
            .unwrap();
        let session_id = created["session"]["id"].clone();
        harness
            .service
            .start_turn(
                &owner,
                &json!({"sessionId": session_id, "prompt": "Continue the current task"}),
                None,
            )
            .await
            .unwrap();
        let before = harness
            .service
            .replay(&owner, &json!({"sessionId": session_id}), None)
            .unwrap();
        harness.persistence.mark(session_id.as_str().unwrap());
        harness
            .service
            .list_sessions(
                &owner,
                &json!({"runtimeId": "codex", "discoverNative": true}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(
            harness
                .service
                .replay(&owner, &json!({"sessionId": session_id}), None)
                .unwrap(),
            before
        );
        assert!(!harness.adapter(0).disposed.get());
        assert!(harness.adapter(1).disposed.get());
        assert_eq!(harness.service.get_session_count(), 1);
        let opened = harness
            .service
            .open_session(
                &owner,
                &json!({"sessionId": session_id, "runtimeId": "codex"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_match!(
            opened,
            json!({"status": "opened", "snapshot": {"session": {"id": session_id}}})
        );
        for (sender, runtime_id, root) in [
            (create_sender(92).0, "codex", "/workspace"),
            (owner.clone(), "cursor", "/workspace"),
            (owner.clone(), "codex", "/different-workspace"),
        ] {
            let result = harness
                .service
                .open_session(
                    &sender,
                    &json!({"sessionId": session_id, "runtimeId": runtime_id}),
                    root,
                )
                .await
                .unwrap();
            assert_eq!(result["status"], "failed");
        }
        assert_eq!(harness.adapters.borrow().len(), 2);
        assert!(harness.adapter(0).calls("resumeSession").is_empty());
        harness.service.close_all().await.unwrap();
    });
}

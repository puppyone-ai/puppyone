//! `tests/unit/agent/composer/desktop-agent.submission-lifecycle.test.ts`.
use super::fake_client::FakeClient;
use super::support::{Deferred, assert_match};
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests::harness::run;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::domain::agent_control_view::project_agent_control_view;
use crate::agent::domain::agent_session_control::{
    create_agent_session_control, reduce_agent_session_control,
};
use crate::features::desktop_agent::application::agent_client_port::AgentClientPort;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerState, StatePatch,
};
use crate::features::desktop_agent::application::agent_reference_draft_manager::{
    AgentReferenceDraftManager, AgentReferenceDraftManagerOptions,
};
use crate::features::desktop_agent::application::agent_session_controller::AgentControllerStore;
use crate::features::desktop_agent::application::agent_turn_submission_coordinator::{
    AgentTurnSubmissionCoordinator, AgentTurnSubmissionCoordinatorOptions,
};
use crate::features::desktop_agent::application::ui_runtime::TokioUiRuntime;
use futures_util::FutureExt;
use futures_util::future::{LocalBoxFuture, Shared};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use tokio::sync::oneshot;

struct Harness {
    store: Rc<AgentControllerStore>,
    coordinator: AgentTurnSubmissionCoordinator,
    bridge: Rc<FakeClient>,
    prepare_once: Rc<RefCell<VecDeque<Shared<oneshot::Receiver<bool>>>>>,
    /// `invocationCallOrder` of `prepare`, `reconnect` and `start`.
    order: Rc<RefCell<Vec<&'static str>>>,
}

impl Harness {
    fn state(&self) -> Value {
        self.store.read(AgentControllerState::to_value)
    }
    fn patch(&self, patch: StatePatch) {
        self.store.patch(patch);
    }
    fn starts(&self) -> usize {
        self.bridge.count("startAgentTurn")
    }
}

fn harness() -> Harness {
    let state = AgentControllerState {
        session: Some(json!({ "id": "session" })),
        ..Default::default()
    };
    let store = Rc::new(AgentControllerStore::plain(state));
    let runtime = TokioUiRuntime::create();
    let order: Rc<RefCell<Vec<&'static str>>> = Rc::default();
    let bridge = FakeClient::new();
    {
        let order = order.clone();
        bridge.handle("startAgentTurn", move |_| {
            order.borrow_mut().push("start");
            Box::pin(async { Ok(Value::Null) })
        });
    }
    let port: Rc<dyn AgentClientPort> = bridge.clone();
    let provider: Rc<dyn Fn() -> Option<Rc<dyn AgentClientPort>>> =
        Rc::new(move || Some(port.clone()));
    let references = AgentReferenceDraftManager::new(AgentReferenceDraftManagerOptions {
        workspace_root: "/workspace".into(),
        bridge_provider: provider.clone(),
        store: store.clone(),
        runtime,
        append_text: Rc::new(|_| {}),
    });
    let prepare_once: Rc<RefCell<VecDeque<Shared<oneshot::Receiver<bool>>>>> = Rc::default();
    let prepare_session: Rc<dyn Fn() -> LocalBoxFuture<'static, bool>> = {
        let queue = prepare_once.clone();
        let order = order.clone();
        Rc::new(move || {
            order.borrow_mut().push("prepare");
            let once = queue.borrow_mut().pop_front();
            Box::pin(async move {
                match once {
                    Some(pending) => pending.await.unwrap_or(false),
                    None => true,
                }
            })
        })
    };
    let reconnect_session = {
        let order = order.clone();
        Rc::new(move || {
            order.borrow_mut().push("reconnect");
            Box::pin(async { Ok(true) }) as LocalBoxFuture<'static, _>
        })
    };
    let coordinator = AgentTurnSubmissionCoordinator::new(AgentTurnSubmissionCoordinatorOptions {
        workspace_root: "/workspace".into(),
        bridge_provider: provider,
        references,
        store: store.clone(),
        write_draft: Rc::new(|_, _| {}),
        prepare_session,
        reconnect_session,
    });
    Harness {
        store,
        coordinator,
        bridge,
        prepare_once,
        order,
    }
}

fn control_with(input: Value) -> Value {
    let control = create_agent_session_control("", "", "idle", 0);
    reduce_agent_session_control(&control, &input)
        .expect("control")
        .unwrap_or(control)
}

#[test]
fn does_not_restore_or_redispatch_admitted_input_after_losing_the_receipt() {
    for status in ["queued", "dispatching", "accepted", "outcome-unknown"] {
        run(async move {
            let h = harness();
            let receipt = Deferred::new();
            h.bridge.handle_once("startAgentTurn", receipt.handler());
            h.patch(StatePatch::new().draft("submitted".into()));
            let pending = h.coordinator.submit("submitted");
            let command_id = h.state()["pendingIntent"]["id"].clone();
            let control = control_with(json!({
                "type": "command.received",
                "command": { "commandId": command_id, "kind": "start", "status": status, "intentFingerprint": command_id },
            }));
            h.patch(
                StatePatch::new()
                    .draft("new unsent text".into())
                    .control(Some(project_agent_control_view(&control))),
            );
            receipt.reject(AgentError::new("IPC receipt lost"));
            assert!(!pending.await.expect("submit"), "{status}");
            assert_match(
                &h.state(),
                &json!({ "draft": "new unsent text", "submitting": false, "pendingIntent": null }),
            );
            assert_eq!(h.starts(), 1);
        });
    }
}

#[test]
fn releases_ownership_and_restores_input_after_a_synchronous_bridge_failure() {
    run(async {
        let h = harness();
        h.bridge
            .reject_once("startAgentTurn", AgentError::new("bridge closed"));
        assert!(
            !h.coordinator
                .submit("retryable input")
                .await
                .expect("submit")
        );
        assert_match(
            &h.state(),
            &json!({ "draft": "retryable input", "submitting": false, "pendingIntent": null }),
        );
        let draft = h.state()["draft"].as_str().unwrap_or_default().to_string();
        assert!(h.coordinator.submit(&draft).await.expect("submit"));
    });
}

#[test]
fn reconnects_a_settled_provider_before_dispatching_the_next_turn() {
    run(async {
        let h = harness();
        let attached = control_with(json!({ "type": "adapter.attached" }));
        let exited = reduce_agent_session_control(
            &attached,
            &json!({ "type": "adapter.exited", "adapterGeneration": attached["adapterGeneration"], "reason": "provider-idle-exit" }),
        )
        .expect("control")
        .unwrap_or(attached);
        h.patch(StatePatch::new().control(Some(project_agent_control_view(&exited))));
        assert!(h.coordinator.submit("continue").await.expect("submit"));
        assert_eq!(*h.order.borrow(), vec!["reconnect", "start"]);
    });
}

#[test]
fn does_not_let_an_old_receipt_release_a_newer_conversations_lock() {
    run(async {
        let h = harness();
        let old_receipt = Deferred::new();
        let new_receipt = Deferred::new();
        h.bridge
            .handle_once("startAgentTurn", old_receipt.handler());
        h.bridge
            .handle_once("startAgentTurn", new_receipt.handler());
        let old = h.coordinator.submit("old input");
        h.coordinator.invalidate();
        let mut session = h
            .store
            .read(|state| state.session.clone())
            .expect("session");
        session["id"] = json!("new-session");
        h.patch(StatePatch::new().session(Some(session)));
        let next = h.coordinator.submit("new input");
        old_receipt.reject(AgentError::new("late failure"));
        assert!(!old.await.expect("submit"));
        assert_match(
            &h.state(),
            &json!({ "submitting": true, "pendingIntent": { "prompt": "new input" }, "error": null }),
        );
        assert!(
            !h.coordinator
                .submit("duplicate input")
                .await
                .expect("submit")
        );
        new_receipt.resolve(Value::Null);
        assert!(next.await.expect("submit"));
        assert_match(
            &h.state(),
            &json!({ "submitting": false, "pendingIntent": null }),
        );
        assert_eq!(h.starts(), 2);
    });
}

#[test]
fn does_not_dispatch_after_preparation_completes_for_an_invalidated_conversation() {
    run(async {
        let h = harness();
        let (resolve, preparation) = oneshot::channel();
        h.patch(StatePatch::new().session(None));
        h.prepare_once.borrow_mut().push_back(preparation.shared());
        let pending = h.coordinator.submit("old preparation input");
        h.coordinator.invalidate();
        h.patch(StatePatch::new().draft("new conversation draft".into()));
        resolve.send(false).expect("resolve");
        assert!(!pending.await.expect("submit"));
        assert_match(
            &h.state(),
            &json!({ "draft": "new conversation draft", "submitting": false, "pendingIntent": null, "error": null }),
        );
        assert_eq!(h.starts(), 0);
    });
}

#[test]
fn continues_a_degraded_turn_without_consuming_the_draft_or_references() {
    run(async {
        let h = harness();
        let reference = json!({
            "id": "draft-reference", "kind": "workspace-entry", "entryType": "file",
            "relativePath": "notes.md", "displayName": "notes.md", "status": "ready",
        });
        let mut projection = h.store.read(|state| state.projection.to_value());
        projection["terminalState"] = json!("completed");
        projection["turns"] = json!([{
            "id": "turn-degraded", "status": "completed", "startedAtSequence": 1, "startedAtMs": 1_000,
            "completedAtSequence": 2, "durationMs": 1_000, "partIds": [], "completionQuality": "degraded",
            "recovery": {
                "kind": "degraded-completion", "failureScope": "upstream-request", "code": "CURSOR_HTTP2_STREAM_CANCEL",
                "retryable": true, "transportHealth": "healthy", "sideEffects": "possible",
            },
        }]);
        h.patch(
            StatePatch::new()
                .draft("My separate draft".into())
                .references(vec![reference.clone()])
                .projection(AgentDisplay::from_value(&projection).expect("projection")),
        );
        assert!(
            h.coordinator
                .continue_from_recovery("turn-degraded", "Inspect state and continue")
                .await
                .expect("continue")
        );
        assert_match(
            &h.bridge.calls("startAgentTurn")[0],
            &json!({
                "prompt": "Inspect state and continue", "recoveryOfTurnId": "turn-degraded",
                "references": [], "promptMentions": [],
            }),
        );
        assert_match(
            &h.state(),
            &json!({ "draft": "My separate draft", "references": [reference], "submitting": false, "pendingIntent": null }),
        );
    });
}

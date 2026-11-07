//! `tests/unit/agent/events/desktop-agent.session-feed.test.ts`: the
//! Renderer display replica against the Main SessionActor and feed.
use super::fake_client::FakeClient;
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests::harness::{
    Harness, HarnessOptions, create_service_harness, run, run_paused,
};
use crate::agent::sender::Sender;
use crate::features::desktop_agent::application::agent_client_port::AgentClientPort;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerPhase, AgentDisplayRecoveryCause as Cause, AgentDisplayRecoveryPolicy as Policy,
    AgentDisplayRecoveryStage as Stage, ReplicaStatus,
};
use crate::features::desktop_agent::application::agent_error::agent_operation_error;
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::application::agent_session_replica::{
    ATTACH_TIMEOUT_MS, CONTROL_REQUEST_TIMEOUT_MS, RECOVERY_DEGRADED_DELAY_MS,
    RECOVERY_RECONNECTING_DELAY_MS, RECOVERY_RETRY_BASE_MS, RECOVERY_STABILITY_WINDOW_MS,
    WATERMARK_IDLE_MS,
};
use crate::features::desktop_agent::application::ui_runtime::TokioUiRuntime;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

const ROOT: &str = "/workspace";

type Transform = Rc<RefCell<Rc<dyn Fn(Value) -> Option<Value>>>>;

pub(super) struct FeedHarness {
    pub main: Harness,
    pub owner: Sender,
    pub bridge: Rc<FakeClient>,
    pub controller: AgentSessionController,
    pub snapshot: Value,
    transform: Transform,
}

/// `await vi.advanceTimersByTimeAsync(ms)`: fires every timer due within
/// `ms`, in order, letting the work they start run in between.
pub(super) async fn advance(ms: u64) {
    settle().await;
    if ms > 0 {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }
    settle().await;
}

/// Lets started tasks run.
pub(super) async fn settle() {
    for _ in 0..64 {
        tokio::task::yield_now().await;
    }
}

/// `await vi.waitFor(() => condition())`.
pub(super) async fn wait_for(condition: impl Fn() -> bool) {
    for _ in 0..20_000 {
        if condition() {
            return;
        }
        tokio::task::yield_now().await;
    }
    assert!(condition(), "the condition never held");
}

impl FeedHarness {
    pub async fn new() -> Self {
        let main = create_service_harness(HarnessOptions::default());
        let bridge = FakeClient::new();
        let transform: Transform = Rc::new(RefCell::new(Rc::new(Some)));
        let owner = {
            let bridge = bridge.clone();
            let transform = transform.clone();
            Sender::new(
                890,
                Rc::new(move |frame: Value| {
                    let transform = transform.borrow().clone();
                    if let Some(value) = transform(frame) {
                        bridge.frame(value);
                    }
                }),
            )
        };
        let snapshot = main
            .service
            .create_session(&owner, &json!({ "runtimeId": "codex" }), ROOT)
            .await
            .expect("session");
        {
            let service = main.service.clone();
            bridge.handle("discoverAgentRuntimes", move |mut request| {
                request["runtimeId"] = json!("codex");
                let service = service.clone();
                Box::pin(async move { service.discover_providers(&request, Some(ROOT)).await })
            });
        }
        bridge.resolve("resumeAgentSession", snapshot.clone());
        let feed = |method: &str,
                    call: fn(
            &crate::agent::application::agent_service::AgentService,
            &Sender,
            &Value,
            &str,
        ) -> crate::agent::agent_error::AgentResult<Value>| {
            let service = main.service.clone();
            let owner = owner.clone();
            bridge.handle(method, move |request| {
                let result = call(&service, &owner, &request, ROOT);
                Box::pin(async move { result })
            });
        };
        feed("attachAgentSession", |service, owner, request, root| {
            service.attach_session(owner, request, root)
        });
        feed(
            "acknowledgeAgentSession",
            |service, owner, request, root| service.acknowledge_session(owner, request, root),
        );
        feed(
            "readAgentSessionWatermark",
            |service, owner, request, root| service.read_session_watermark(owner, request, root),
        );
        feed("detachAgentSession", |service, owner, request, root| {
            service.detach_session(owner, request, root)
        });
        let port: Rc<dyn AgentClientPort> = bridge.clone();
        let controller = AgentSessionController::new(
            ROOT,
            Rc::new(move || Some(port.clone())),
            TokioUiRuntime::create(),
        );
        Self {
            main,
            owner,
            bridge,
            controller,
            snapshot,
            transform,
        }
    }

    pub fn session_id(&self) -> String {
        self.snapshot["session"]["id"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    }

    pub fn set_transform(&self, transform: impl Fn(Value) -> Option<Value> + 'static) {
        *self.transform.borrow_mut() = Rc::new(transform);
    }

    pub fn reset_transform(&self) {
        self.set_transform(Some);
    }

    /// Replaces each frame's display patch with an invalid one.
    pub fn corrupt_frames(&self) {
        self.set_transform(|mut frame| {
            frame["displayPatch"] = json!({ "schemaVersion": 2 });
            Some(frame)
        });
    }

    pub fn emit(&self, kind: &str, payload: Value, item_id: Option<&str>, turn_id: &str) {
        self.main.adapter(0).emit(json!({
            "type": kind,
            "payload": payload,
            "itemId": item_id,
            "turnId": turn_id,
            "providerSessionId": "thread-1",
        }));
    }

    pub fn emit_a(&self, kind: &str) {
        self.emit(kind, json!({}), None, "turn-A");
    }

    pub fn read(&self) -> Value {
        self.main
            .service
            .replay(
                &self.owner,
                &json!({ "sessionId": self.session_id(), "afterSequence": 0 }),
                Some(ROOT),
            )
            .expect("replay")
    }

    pub fn projection(&self) -> Value {
        self.controller.store().read(|state| {
            crate::features::desktop_agent::fixtures::projection_json(&state.projection)
        })
    }

    pub fn assert_display_matches(&self) {
        assert_eq!(self.projection(), self.read()["display"]);
    }

    pub fn main_start_count(&self) -> usize {
        self.main
            .adapters
            .borrow()
            .iter()
            .map(|adapter| adapter.calls("startTurn").len())
            .sum()
    }

    pub async fn initialize(&self) {
        self.controller.initialize(false).await.expect("initialize");
    }

    pub async fn dispose(self) {
        self.controller.dispose(false);
        let _ = self.main.service.close_all().await;
    }
}

fn replica_status(h: &FeedHarness) -> ReplicaStatus {
    h.controller.store().read(|state| state.replica_status)
}

fn coded(code: &str) -> AgentError {
    AgentError::new("ended").with_code(code)
}

fn messages(h: &FeedHarness) -> Vec<Value> {
    h.controller.store().read(|state| {
        state
            .projection
            .messages
            .iter()
            .map(|message| Value::from(message.text.as_str()))
            .collect()
    })
}

#[test]
fn stops_retries_on_serialized_ended_errors() {
    for code in ["SESSION_STALE", "HOST_EXITED", "HOST_CLOSED"] {
        run_paused(async move {
            let h = FeedHarness::new().await;
            h.initialize().await;
            h.bridge.reject("readAgentSessionWatermark", coded(code));
            advance(WATERMARK_IDLE_MS + 100).await;
            assert_eq!(
                h.controller.get_snapshot().phase,
                AgentControllerPhase::RuntimeExited
            );
            let attempts = h.bridge.count("attachAgentSession");
            advance(300_000).await;
            assert_eq!(h.bridge.count("attachAgentSession"), attempts);
            h.dispose().await;
        });
    }
}

#[test]
fn repairs_display_failure_without_restarting_the_runtime_but_stops_on_exit() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let resumes = h.bridge.count("resumeAgentSession");
        h.bridge
            .fail(json!({ "scope": "display", "code": "STREAM_RESET", "message": "feed reset" }));
        advance(0).await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);
        assert_eq!(h.bridge.count("resumeAgentSession"), resumes);
        assert_eq!(h.main_start_count(), 0);
        h.bridge
            .fail(json!({ "scope": "execution", "code": "HOST_EXITED", "message": "host exited" }));
        assert_eq!(
            h.controller.get_snapshot().phase,
            AgentControllerPhase::RuntimeExited
        );
        let attempts = h.bridge.count("attachAgentSession");
        advance(300_000).await;
        assert_eq!(h.bridge.count("attachAgentSession"), attempts);
        h.dispose().await;
    });
}

#[test]
fn termination_of_a_healthy_display_is_not_a_recovery_incident() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let (release, receipt) = tokio::sync::oneshot::channel::<Value>();
        let receipt = futures_util::FutureExt::shared(receipt);
        h.bridge.handle("terminateAgentExecution", move |_| {
            let receipt = receipt.clone();
            Box::pin(async move { Ok(receipt.await.expect("receipt")) })
        });
        let attachments = h.bridge.count("attachAgentSession");
        let closing = h.controller.close_tab_session();
        assert_eq!(h.controller.get_snapshot().display_recovery, None);
        h.controller.retry_display_recovery().await;
        advance(120_000).await;
        assert_eq!(h.bridge.count("attachAgentSession"), attachments);
        assert_eq!(h.bridge.count("terminateAgentExecution"), 1);
        release
            .send(json!({ "kind": "released" }))
            .expect("release");
        let closed = closing.await;
        let crate::features::desktop_agent::application::agent_session_lifecycle::CloseOutcome::Terminated(receipt) = closed else {
            panic!("a termination receipt: {closed:?}");
        };
        assert_eq!(receipt.rest.text("kind"), Some("released"));
        h.dispose().await;
    });
}

#[test]
fn does_not_dispatch_an_attach_cancelled_before_its_microtask_starts() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let before = h.bridge.count("attachAgentSession");
        let retry = h.controller.retry_display_recovery();
        h.controller.pause_display_recovery();
        retry.await;
        advance(120_000).await;
        assert_eq!(h.bridge.count("attachAgentSession"), before);
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.policy),
            Some(Policy::Paused)
        );
        h.dispose().await;
    });
}

#[test]
fn pauses_retries_and_releases_a_late_attach_without_resuming() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let attach = h.bridge.implementation("attachAgentSession");
        let receipt = attach(json!({ "rootPath": ROOT, "sessionId": h.session_id() }))
            .await
            .expect("receipt");
        let (finish, late) = tokio::sync::oneshot::channel::<Value>();
        let late = futures_util::FutureExt::shared(late);
        h.bridge.handle_once("attachAgentSession", move |_| {
            let late = late.clone();
            Box::pin(async move { Ok(late.await.expect("late receipt")) })
        });
        let repair = h.controller.retry_display_recovery();
        advance(0).await;
        h.controller.pause_display_recovery();
        repair.await;
        finish.send(receipt.clone()).expect("finish");
        advance(120_000).await;
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.policy),
            Some(Policy::Paused)
        );
        assert_eq!(h.bridge.count("attachAgentSession"), 2);
        assert!(
            h.bridge
                .calls("detachAgentSession")
                .iter()
                .any(|request| request["subscriptionId"] == receipt["subscriptionId"])
        );
        assert_eq!(h.main_start_count(), 0);
        h.controller.retry_display_recovery().await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);
        h.dispose().await;
    });
}

#[test]
fn bounds_automatic_recovery_attempts_and_permits_an_explicit_retry() {
    run_paused(async {
        let h = FeedHarness::new().await;
        let attach = h.bridge.implementation("attachAgentSession");
        h.bridge
            .reject("attachAgentSession", AgentError::new("feed unavailable"));
        h.initialize().await;
        advance(300_000).await;
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.policy),
            Some(Policy::Exhausted)
        );
        let attempts = h.bridge.count("attachAgentSession");
        advance(300_000).await;
        assert_eq!(h.bridge.count("attachAgentSession"), attempts);
        h.bridge
            .handle("attachAgentSession", move |request| attach(request));
        h.controller.retry_display_recovery().await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);
        assert_eq!(h.main_start_count(), 0);
        h.dispose().await;
    });
}

#[test]
fn ends_a_missing_runtime_instance_instead_of_retrying_it_as_a_history_gap() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.bridge.reject(
            "readAgentSessionWatermark",
            agent_operation_error(crate::features::desktop_agent::fixtures::typed(json!({
                "schemaVersion": 1, "code": "SESSION_NOT_FOUND", "message": "The runtime instance has ended.",
                "retryable": false, "actions": [],
            }))),
        );
        advance(WATERMARK_IDLE_MS).await;
        let state = h.controller.get_snapshot();
        assert_eq!(state.replica_status, ReplicaStatus::Detached);
        assert_eq!(state.error_code(), Some("session-ended"));
        let calls = h.bridge.count("attachAgentSession");
        advance(60_000).await;
        assert_eq!(h.bridge.count("attachAgentSession"), calls);
        assert_eq!(h.bridge.count("readAgentSessionWatermark"), 1);
        h.dispose().await;
    });
}

#[test]
fn recovers_an_initial_attach_or_ack_failure_without_another_native_command() {
    for failure in ["attachAgentSession", "acknowledgeAgentSession"] {
        run_paused(async move {
            let h = FeedHarness::new().await;
            h.bridge
                .reject_once(failure, AgentError::new("Temporary IPC failure"));
            h.initialize().await;
            assert_eq!(replica_status(&h), ReplicaStatus::Stale);
            h.emit_a("turn.started");
            h.emit(
                "assistant.completed",
                json!({ "text": "Output while disconnected" }),
                Some("answer"),
                "turn-A",
            );
            h.emit_a("turn.completed");
            advance(WATERMARK_IDLE_MS).await;
            assert_eq!(replica_status(&h), ReplicaStatus::Live, "{failure}");
            assert_eq!(h.controller.get_snapshot().error, None);
            h.assert_display_matches();
            assert_eq!(h.main_start_count(), 0);
            h.dispose().await;
        });
    }
}

#[test]
fn recovers_a_timed_out_first_attach_and_detaches_its_late_receipt() {
    run_paused(async {
        let h = FeedHarness::new().await;
        let attach = h.bridge.implementation("attachAgentSession");
        let receipt = attach(json!({ "rootPath": ROOT, "sessionId": h.session_id() }))
            .await
            .expect("receipt");
        let (late, pending) = tokio::sync::oneshot::channel::<Value>();
        let pending = futures_util::FutureExt::shared(pending);
        h.bridge.handle_once("attachAgentSession", move |_| {
            let pending = pending.clone();
            Box::pin(async move { Ok(pending.await.expect("late")) })
        });
        let initialized = h.controller.initialize(false);
        advance(ATTACH_TIMEOUT_MS).await;
        initialized.await.expect("initialize");
        assert_eq!(replica_status(&h), ReplicaStatus::Stale);
        advance(WATERMARK_IDLE_MS).await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);
        late.send(receipt.clone()).expect("late");
        advance(0).await;
        assert!(
            h.bridge
                .calls("detachAgentSession")
                .iter()
                .any(|request| request["subscriptionId"] == receipt["subscriptionId"])
        );
        assert_eq!(h.main_start_count(), 0);
        h.dispose().await;
    });
}

/// `new Promise(resolve => setTimeout(() => resolve(attach(request)), ms))`.
fn delayed_attach(h: &FeedHarness, ms: u64) {
    let attach = h.bridge.implementation("attachAgentSession");
    h.bridge.handle_once("attachAgentSession", move |request| {
        let attach = attach.clone();
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            attach(request).await
        })
    });
}

#[test]
fn allows_a_slow_snapshot_to_finish_within_the_attach_budget() {
    run_paused(async {
        let h = FeedHarness::new().await;
        delayed_attach(&h, 20_000);
        let initialized = h.controller.initialize(false);
        advance(20_000).await;
        initialized.await.expect("initialize");
        assert_eq!(replica_status(&h), ReplicaStatus::Live);
        assert_eq!(h.controller.get_snapshot().display_recovery, None);
        h.dispose().await;
    });
}

#[test]
fn escalates_recovery_ui_only_after_silent_and_reconnecting_stages() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.bridge.reject(
            "attachAgentSession",
            AgentError::new("Temporary IPC failure"),
        );
        h.initialize().await;
        let state = h.controller.get_snapshot();
        assert_eq!(state.replica_status, ReplicaStatus::Stale);
        let recovery = state.display_recovery.expect("recovery");
        assert_eq!(
            (recovery.stage, recovery.cause),
            (Stage::Silent, Cause::AttachFailed)
        );
        advance(RECOVERY_RECONNECTING_DELAY_MS).await;
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.stage),
            Some(Stage::Reconnecting)
        );
        advance(RECOVERY_DEGRADED_DELAY_MS - RECOVERY_RECONNECTING_DELAY_MS).await;
        let state = h.controller.get_snapshot();
        assert_eq!(state.error, None);
        let recovery = state.display_recovery.expect("recovery");
        assert_eq!(
            (recovery.stage, recovery.cause),
            (Stage::Degraded, Cause::AttachFailed)
        );
        h.dispose().await;
    });
}

#[test]
fn keeps_recovery_status_visible_while_a_replacement_snapshot_attaches() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        delayed_attach(&h, 20_000);
        h.corrupt_frames();
        h.emit_a("turn.started");
        h.reset_transform();
        advance(RECOVERY_RECONNECTING_DELAY_MS).await;
        let state = h.controller.get_snapshot();
        assert_eq!(state.replica_status, ReplicaStatus::Stale);
        let recovery = state.display_recovery.expect("recovery");
        assert_eq!(
            (recovery.stage, recovery.cause),
            (Stage::Reconnecting, Cause::SchemaInvalid)
        );
        advance(RECOVERY_DEGRADED_DELAY_MS - RECOVERY_RECONNECTING_DELAY_MS).await;
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.stage),
            Some(Stage::Degraded)
        );
        advance(20_000 - RECOVERY_DEGRADED_DELAY_MS).await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);
        assert_eq!(h.controller.get_snapshot().display_recovery, None);
        h.dispose().await;
    });
}

#[test]
fn stops_first_attach_recovery_after_disposal() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.bridge
            .reject("attachAgentSession", AgentError::new("Unavailable"));
        h.initialize().await;
        h.controller.dispose(false);
        advance(30_000).await;
        assert_eq!(h.bridge.count("attachAgentSession"), 1);
        h.dispose().await;
    });
}

#[test]
fn applies_frames_emitted_between_snapshot_creation_and_initial_ack_once() {
    run(async {
        let h = Rc::new(FeedHarness::new().await);
        let attach = h.bridge.implementation("attachAgentSession");
        {
            let adapter = h.main.adapter(0);
            h.bridge.handle_once("attachAgentSession", move |request| {
                let attach = attach.clone();
                let adapter = adapter.clone();
                Box::pin(async move {
                    let receipt = attach(request).await;
                    adapter.emit(json!({
                        "type": "turn.started", "payload": { "prompt": "Hello", "userMessageId": "client-A" },
                        "itemId": null, "turnId": "turn-A", "providerSessionId": "thread-1",
                    }));
                    adapter.emit(json!({
                        "type": "assistant.delta", "payload": { "delta": "Hi" },
                        "itemId": "assistant-A", "turnId": "turn-A", "providerSessionId": "thread-1",
                    }));
                    receipt
                })
            });
        }
        h.initialize().await;
        let state = h.controller.get_snapshot();
        assert_eq!(state.phase, AgentControllerPhase::Running);
        assert_eq!(state.replica_status, ReplicaStatus::Live);
        h.assert_display_matches();
        assert_eq!(messages(&h), vec![json!("Hello"), json!("Hi")]);
        Rc::into_inner(h).expect("harness").dispose().await;
    });
}

#[test]
fn keeps_same_text_submissions_distinct_while_joining_native_echo() {
    run(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.emit(
            "turn.started",
            json!({ "prompt": "Hello", "userMessageId": "client-A" }),
            None,
            "turn-A",
        );
        h.emit(
            "user.message",
            json!({ "text": "Hello", "clientUserMessageId": "client-A" }),
            Some("native-A"),
            "turn-A",
        );
        h.emit_a("turn.completed");
        h.emit(
            "turn.started",
            json!({ "prompt": "Hello", "userMessageId": "client-B" }),
            None,
            "turn-B",
        );
        assert_eq!(messages(&h).len(), 2);
        h.assert_display_matches();
        h.dispose().await;
    });
}

#[test]
fn keeps_a_model_retry_while_a_tool_progresses_and_clears_it_on_completion() {
    run(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.emit_a("turn.started");
        h.emit(
            "provider.connection.updated",
            json!({ "state": "reconnecting", "message": "Retrying", "attempt": 1, "maxAttempts": 3 }),
            None,
            "turn-A",
        );
        h.emit(
            "tool.progress",
            json!({ "label": "Read", "status": "running" }),
            Some("tool-A"),
            "turn-A",
        );
        let state = h.controller.get_snapshot();
        assert_eq!(
            state
                .projection
                .connection_status
                .as_ref()
                .map(|s| s.message.clone()),
            Some("Retrying".to_string())
        );
        assert_eq!(
            state.control.as_ref().map(|c| c.connection.status.clone()),
            Some("connected".to_string())
        );
        h.emit_a("turn.completed");
        assert_eq!(
            h.controller.get_snapshot().projection.connection_status,
            None
        );
        h.assert_display_matches();
        h.dispose().await;
    });
}

#[test]
fn repairs_a_lost_last_terminal_frame_using_the_watermark() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.emit_a("turn.started");
        h.set_transform(|_| None);
        h.emit_a("turn.completed");
        h.reset_transform();
        assert_eq!(
            h.controller.get_snapshot().running_turn_id(),
            Some("turn-A")
        );
        advance(WATERMARK_IDLE_MS).await;
        assert_eq!(h.bridge.count("attachAgentSession"), 2);
        h.assert_display_matches();
        assert_eq!(
            h.controller.get_snapshot().phase,
            AgentControllerPhase::Ready
        );
        h.dispose().await;
    });
}

#[test]
fn checks_the_watermark_only_after_a_full_interval_without_frames() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        advance(WATERMARK_IDLE_MS - 1_000).await;
        assert_eq!(h.bridge.count("readAgentSessionWatermark"), 0);
        h.emit_a("turn.started");
        advance(WATERMARK_IDLE_MS - 1).await;
        assert_eq!(h.bridge.count("readAgentSessionWatermark"), 0);
        advance(1).await;
        assert_eq!(h.bridge.count("readAgentSessionWatermark"), 1);
        h.dispose().await;
    });
}

#[test]
fn coalesces_a_frame_burst_into_bounded_acknowledgements() {
    run(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let initial = h.bridge.count("acknowledgeAgentSession");
        h.emit_a("turn.started");
        for _ in 0..400 {
            h.emit(
                "assistant.delta",
                json!({ "delta": "x" }),
                Some("assistant-A"),
                "turn-A",
            );
        }
        wait_for(|| {
            let revision = h
                .controller
                .store()
                .read(|state| state.control.as_ref().map(|c| Value::from(c.revision)));
            h.bridge
                .calls("acknowledgeAgentSession")
                .last()
                .map(|r| r["revision"].clone())
                == revision
        })
        .await;
        assert!(h.bridge.count("acknowledgeAgentSession") <= initial + 2);
        h.assert_display_matches();
        h.dispose().await;
    });
}

#[test]
fn repairs_one_snapshot_after_a_burst_exceeds_feed_backpressure() {
    run(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.emit_a("turn.started");
        for _ in 0..1_200 {
            h.emit(
                "assistant.delta",
                json!({ "delta": "x" }),
                Some("assistant-A"),
                "turn-A",
            );
        }
        wait_for(|| {
            replica_status(&h) == ReplicaStatus::Live && h.projection() == h.read()["display"]
        })
        .await;
        assert_eq!(h.bridge.count("attachAgentSession"), 2);
        h.dispose().await;
    });
}

#[test]
fn does_not_ack_a_malformed_patch_and_repairs_from_a_fresh_snapshot() {
    run(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let initial = h.bridge.count("acknowledgeAgentSession");
        h.corrupt_frames();
        h.emit_a("turn.started");
        h.reset_transform();
        wait_for(|| replica_status(&h) == ReplicaStatus::Live).await;
        assert_eq!(h.bridge.count("attachAgentSession"), 2);
        assert_eq!(h.bridge.count("acknowledgeAgentSession"), initial + 1);
        h.assert_display_matches();
        h.dispose().await;
    });
}

#[test]
fn resets_the_retry_budget_only_after_a_sustained_stable_window() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.bridge.reject_once(
            "attachAgentSession",
            AgentError::new("Temporary IPC failure"),
        );
        h.corrupt_frames();
        h.emit_a("turn.started");
        h.reset_transform();
        advance(0).await;
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.attempt),
            Some(1)
        );
        advance(RECOVERY_RETRY_BASE_MS * 2).await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);

        h.corrupt_frames();
        h.emit(
            "assistant.delta",
            json!({ "delta": "first recurrence" }),
            Some("assistant-A"),
            "turn-A",
        );
        h.reset_transform();
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.attempt),
            Some(3)
        );
        advance(0).await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);

        advance(RECOVERY_STABILITY_WINDOW_MS).await;
        h.corrupt_frames();
        h.emit(
            "assistant.delta",
            json!({ "delta": "after stable window" }),
            Some("assistant-A"),
            "turn-A",
        );
        h.reset_transform();
        assert_eq!(
            h.controller
                .get_snapshot()
                .display_recovery
                .map(|r| r.attempt),
            Some(1)
        );
        h.dispose().await;
    });
}

#[test]
fn ignores_duplicate_frames_without_appending_their_text_again() {
    run(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let last: Rc<RefCell<Value>> = Rc::default();
        {
            let last = last.clone();
            h.set_transform(move |frame| {
                *last.borrow_mut() = frame.clone();
                Some(frame)
            });
        }
        h.emit_a("turn.started");
        h.emit(
            "assistant.delta",
            json!({ "delta": "Hello" }),
            Some("assistant-A"),
            "turn-A",
        );
        let duplicate = last.borrow().clone();
        h.bridge.frame_subscription(0)(duplicate);
        assert_eq!(messages(&h), vec![json!("Hello")]);
        h.dispose().await;
    });
}

#[test]
fn isolates_a_view_subscriber_from_the_committed_display() {
    run(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        let _unsubscribe = h.controller.subscribe(Rc::new(|| panic!("view failure")));
        h.emit_a("turn.started");
        h.emit(
            "assistant.delta",
            json!({ "delta": "Hello" }),
            Some("assistant-A"),
            "turn-A",
        );
        h.emit_a("turn.completed");
        h.assert_display_matches();
        assert_eq!(
            h.controller.get_snapshot().phase,
            AgentControllerPhase::Ready
        );
        h.dispose().await;
    });
}

#[test]
fn keeps_the_replica_stale_when_a_fresh_attachment_cannot_be_acknowledged() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.bridge.handle_once("acknowledgeAgentSession", |_| {
            Box::pin(async { Ok(json!({ "synchronized": false })) })
        });
        h.corrupt_frames();
        h.emit_a("turn.started");
        h.reset_transform();
        advance(0).await;
        assert_eq!(replica_status(&h), ReplicaStatus::Stale);
        advance(5_000).await;
        assert_eq!(replica_status(&h), ReplicaStatus::Live);
        h.assert_display_matches();
        assert_eq!(h.main_start_count(), 0);
        h.dispose().await;
    });
}

#[test]
fn bounds_a_stalled_watermark_read_and_retries_attachment() {
    run_paused(async {
        let h = FeedHarness::new().await;
        h.initialize().await;
        h.bridge.handle_once("readAgentSessionWatermark", |_| {
            Box::pin(futures_util::future::pending())
        });
        advance(WATERMARK_IDLE_MS + CONTROL_REQUEST_TIMEOUT_MS + RECOVERY_RETRY_BASE_MS + 1).await;
        assert_eq!(h.bridge.count("attachAgentSession"), 2);
        assert_eq!(h.main_start_count(), 0);
        h.dispose().await;
    });
}

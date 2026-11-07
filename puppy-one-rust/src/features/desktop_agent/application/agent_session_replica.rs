//! `application/AgentSessionReplica.ts`: a disposable replica of the
//! session service's display. It never interprets Harness events.
use super::agent_client_port::{
    AgentClient as _, AgentClientPort, AgentClientProvider, Cleanup, same_client,
};
use super::agent_controller_state::{
    AgentControllerPhase, AgentDisplayRecovery, AgentDisplayRecoveryCause as Cause,
    AgentDisplayRecoveryPolicy as Policy, AgentDisplayRecoveryStage as Stage, ReplicaStatus,
    StatePatch,
};
use super::agent_error::{
    agent_known_error, create_agent_error, known_error_code, operation_failure,
};
use super::agent_session_controller::AgentControllerStore;
use super::ui_runtime::{
    Task, Timer, UiRuntime, detach, launch, math_random, microtask, resolved, set_timeout,
    start_deferred, unstarted,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::dto::{AgentProjection, SessionFailure, SessionFrame, SessionSnapshot};
use crate::agent::contract::protocol::{AgentOperation, FeedAck, FeedTarget, SessionTarget};
use crate::features::session_transport::managed_operation_scope::{
    ManagedOperationScope, scoped_timeout_ms, wait_for_scoped_operation,
};
use futures_util::FutureExt;
use futures_util::future::LocalBoxFuture;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

pub const WATERMARK_IDLE_MS: u64 = 10_000;
pub const ATTACH_TIMEOUT_MS: u64 = 30_000;
pub const CONTROL_REQUEST_TIMEOUT_MS: u64 = 8_000;
pub const RECOVERY_RECONNECTING_DELAY_MS: u64 = 750;
pub const RECOVERY_DEGRADED_DELAY_MS: u64 = 10_000;
pub const RECOVERY_STABILITY_WINDOW_MS: u64 = 30_000;
pub const RECOVERY_RETRY_BASE_MS: u64 = 1_000;
pub const RECOVERY_RETRY_MAX_MS: u64 = 16_000;
pub const MAX_RECOVERY_ATTEMPTS: u32 = 5;

/// The codes that end a session instance instead of a display incident.
const ENDED_CODES: &[&str] = &[
    "HOST_EXITED",
    "HOST_CLOSED",
    "HOST_CRASHED",
    "HOST_MEMORY_BUDGET",
    "SESSION_NOT_FOUND",
    "SESSION_STALE",
    "PROJECT_STALE",
    "PROJECT_CLOSING",
    "session-ended",
];

struct Subscription {
    id: String,
    session_id: String,
    instance_id: Option<String>,
    stream_id: String,
    revision: Cell<i64>,
    acknowledged_revision: Cell<Option<i64>>,
    ack_promise: RefCell<Option<(u64, Task<AgentResult<bool>>)>>,
    epoch: u64,
}

#[derive(Clone, Copy)]
enum Operation {
    Attach,
    Ack,
    Watermark,
}

/// `classifyRequestFailure(operation, error)`.
fn classify_request_failure(operation: Operation, error: &AgentError) -> Cause {
    let timed_out = scoped_timeout_ms(error).is_some();
    match (operation, timed_out) {
        (Operation::Attach, true) => Cause::AttachTimeout,
        (Operation::Attach, false) => Cause::AttachFailed,
        (Operation::Ack, true) => Cause::AckTimeout,
        (Operation::Ack, false) => Cause::AckFailed,
        (Operation::Watermark, true) => Cause::WatermarkTimeout,
        (Operation::Watermark, false) => Cause::WatermarkFailed,
    }
}

/// `new AgentSessionReplica(workspaceRoot, bridgeProvider, readState, patch)`.
#[derive(Clone)]
pub struct AgentSessionReplica(Rc<Inner>);

struct Inner {
    workspace_root: String,
    bridge_provider: AgentClientProvider,
    store: Rc<AgentControllerStore>,
    runtime: Rc<dyn UiRuntime>,
    frame_cleanup: RefCell<Option<Cleanup>>,
    failure_cleanup: RefCell<Option<Cleanup>>,
    connected_bridge: RefCell<Option<Rc<dyn AgentClientPort>>>,
    subscription: RefCell<Option<Rc<Subscription>>>,
    epoch: Cell<u64>,
    repair_promise: RefCell<Option<(u64, Task<()>)>>,
    watermark_timer: RefCell<Option<Timer>>,
    recovery_retry_timer: RefCell<Option<Timer>>,
    reconnecting_timer: RefCell<Option<Timer>>,
    degraded_timer: RefCell<Option<Timer>>,
    stability_timer: RefCell<Option<Timer>>,
    recovery_started_at: Cell<Option<i64>>,
    recovery_cause: Cell<Option<Cause>>,
    last_snapshot_items: Cell<usize>,
    disposed: Cell<bool>,
    ended: Cell<bool>,
    paused: Cell<bool>,
    attempts: Cell<u32>,
    scope: RefCell<ManagedOperationScope>,
    next_task: Cell<u64>,
}

fn clear(timer: &RefCell<Option<Timer>>) {
    if let Some(timer) = timer.borrow_mut().take() {
        timer.clear();
    }
}

fn session_target(root: &str, session_id: &str, instance_id: Option<&str>) -> SessionTarget {
    SessionTarget {
        root_path: root.to_string(),
        session_id: session_id.to_string(),
        instance_id: instance_id.filter(|id| !id.is_empty()).map(str::to_string),
    }
}

fn feed_target(
    root: &str,
    session_id: &str,
    instance_id: Option<&str>,
    subscription_id: &str,
) -> FeedTarget {
    let target = session_target(root, session_id, instance_id);
    FeedTarget {
        root_path: target.root_path,
        session_id: target.session_id,
        instance_id: target.instance_id,
        subscription_id: subscription_id.to_string(),
    }
}

impl AgentSessionReplica {
    pub fn new(
        workspace_root: &str,
        bridge_provider: AgentClientProvider,
        store: Rc<AgentControllerStore>,
        runtime: Rc<dyn UiRuntime>,
    ) -> Self {
        Self(Rc::new(Inner {
            workspace_root: workspace_root.to_string(),
            bridge_provider,
            store,
            runtime,
            frame_cleanup: RefCell::default(),
            failure_cleanup: RefCell::default(),
            connected_bridge: RefCell::default(),
            subscription: RefCell::default(),
            epoch: Cell::new(0),
            repair_promise: RefCell::default(),
            watermark_timer: RefCell::default(),
            recovery_retry_timer: RefCell::default(),
            reconnecting_timer: RefCell::default(),
            degraded_timer: RefCell::default(),
            stability_timer: RefCell::default(),
            recovery_started_at: Cell::new(None),
            recovery_cause: Cell::new(None),
            last_snapshot_items: Cell::new(0),
            disposed: Cell::new(false),
            ended: Cell::new(false),
            paused: Cell::new(false),
            attempts: Cell::new(0),
            scope: RefCell::new(ManagedOperationScope::new()),
            next_task: Cell::new(0),
        }))
    }

    pub fn connect(&self) {
        self.0.connect();
    }
    pub fn dispose(&self) {
        self.0.dispose();
    }
    /// User termination permanently seals display work; it is not a sync
    /// incident.
    pub fn stop_for_termination(&self) {
        self.0.dispose();
        self.0.store.patch(
            StatePatch::new()
                .replica_status(ReplicaStatus::Stale)
                .display_recovery(None),
        );
    }
    pub fn attach_session(
        &self,
        session_id: &str,
    ) -> LocalBoxFuture<'static, AgentResult<Option<SessionSnapshot>>> {
        self.0.attach_session(session_id)
    }
    pub fn activate_session_feed(&self, session_id: &str) -> LocalBoxFuture<'static, bool> {
        self.0.activate_session_feed(session_id)
    }
    /// `repairFrom(afterSequence, cause = recoveryCause ?? "revision-gap")`.
    pub fn repair_from(&self, cause: Option<Cause>) -> LocalBoxFuture<'static, ()> {
        self.0.repair_from(cause)
    }
    pub fn pause_recovery(&self, policy: Policy) {
        self.0.pause_recovery(policy);
    }
    pub fn retry_recovery(&self) -> LocalBoxFuture<'static, ()> {
        self.0.retry_recovery()
    }
}

impl Inner {
    fn weak(self: &Rc<Self>) -> Weak<Self> {
        Rc::downgrade(self)
    }

    fn task_id(&self) -> u64 {
        let id = self.next_task.get() + 1;
        self.next_task.set(id);
        id
    }

    fn session_id(&self) -> Option<String> {
        self.store
            .read(|state| state.session_id().map(str::to_string))
    }

    fn replica_status(&self) -> ReplicaStatus {
        self.store.read(|state| state.replica_status)
    }

    fn connect(self: &Rc<Self>) {
        if self.disposed.get() || self.paused.get() {
            return;
        }
        let Some(bridge) = (self.bridge_provider)() else {
            return;
        };
        if self
            .connected_bridge
            .borrow()
            .as_ref()
            .is_some_and(|connected| same_client(connected, &bridge))
        {
            return;
        }
        if let Some(cleanup) = self.frame_cleanup.borrow_mut().take() {
            cleanup();
        }
        if let Some(cleanup) = self.failure_cleanup.borrow_mut().take() {
            cleanup();
        }
        self.invalidate();
        *self.connected_bridge.borrow_mut() = Some(bridge.clone());
        let weak = self.weak();
        *self.frame_cleanup.borrow_mut() = bridge.on_agent_session_frame(Rc::new(move |frame| {
            if let Some(replica) = weak.upgrade() {
                replica.handle_frame(frame);
            }
        }));
        let weak = self.weak();
        *self.failure_cleanup.borrow_mut() =
            bridge.on_agent_session_failure(Rc::new(move |failure: SessionFailure| {
                let Some(replica) = weak.upgrade() else {
                    return;
                };
                if replica.disposed.get() || replica.paused.get() {
                    return;
                }
                if failure.scope == "display" {
                    drop(replica.repair_from(Some(Cause::StreamReset)));
                    return;
                }
                replica.ended.set(true);
                replica.clear_recovery_timers();
                replica.invalidate();
                let mut error = create_agent_error("session-ended", None);
                error.detail = failure.message.clone();
                replica.store.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::RuntimeExited)
                        .replica_status(ReplicaStatus::Detached)
                        .display_recovery(None)
                        .error(Some(error)),
                );
            }));
    }

    fn dispose(&self) {
        if self.disposed.get() {
            return;
        }
        self.disposed.set(true);
        self.clear_recovery_timers();
        self.clear_stability_timer();
        self.invalidate();
        if let Some(cleanup) = self.frame_cleanup.borrow_mut().take() {
            cleanup();
        }
        if let Some(cleanup) = self.failure_cleanup.borrow_mut().take() {
            cleanup();
        }
        *self.connected_bridge.borrow_mut() = None;
    }

    fn invalidate(&self) {
        let previous_scope = std::mem::take(&mut *self.scope.borrow_mut());
        previous_scope.cancel();
        self.epoch.set(self.epoch.get() + 1);
        let previous = self.subscription.borrow_mut().take();
        self.clear_watermark_timer();
        if let Some(previous) = previous {
            let bridge = self.connected_bridge.borrow().clone();
            self.detach(
                bridge,
                &previous.session_id,
                &previous.id,
                previous.instance_id.as_deref(),
            );
        }
    }

    fn detach(
        &self,
        bridge: Option<Rc<dyn AgentClientPort>>,
        session_id: &str,
        subscription_id: &str,
        instance_id: Option<&str>,
    ) {
        let Some(bridge) = bridge.filter(|b| b.supports(AgentOperation::DetachFeed)) else {
            return;
        };
        let request = feed_target(
            &self.workspace_root,
            session_id,
            instance_id,
            subscription_id,
        );
        let pending = bridge.detach_session(request);
        detach(&self.runtime, async move {
            let _ = pending.await;
        });
    }

    fn attach_session(
        self: &Rc<Self>,
        session_id: &str,
    ) -> LocalBoxFuture<'static, AgentResult<Option<SessionSnapshot>>> {
        if self.disposed.get() || self.paused.get() {
            return Box::pin(async { Ok(None) });
        }
        self.ended.set(false);
        self.connect();
        let bridge = self.connected_bridge.borrow().clone();
        let Some(bridge) = bridge.filter(|bridge| {
            bridge.supports(AgentOperation::AttachSession)
                && bridge.supports(AgentOperation::AcknowledgeFeed)
                && bridge.delivers_frames()
        }) else {
            return Box::pin(async {
                Err(AgentError::new(
                    "The native Agent display feed is unavailable.",
                ))
            });
        };
        self.invalidate();
        let epoch = self.epoch.get();
        let instance_id = self.store.read(|state| {
            (state.session_id() == Some(session_id))
                .then(|| state.session_instance_id().map(str::to_string))
                .flatten()
        });
        self.store
            .patch(StatePatch::new().replica_status(ReplicaStatus::Subscribing));
        let timed_out = Rc::new(Cell::new(false));
        let pending: Task<AgentResult<crate::agent::contract::dto::FeedReceipt>> = {
            let replica = self.weak();
            let bridge = bridge.clone();
            let request = session_target(&self.workspace_root, session_id, instance_id.as_deref());
            start_deferred(&self.runtime, async move {
                let current = replica.upgrade().is_some_and(|r| {
                    !r.disposed.get() && !r.paused.get() && epoch == r.epoch.get()
                });
                if !current {
                    return Err(AgentError::new(
                        "The display attach was cancelled before dispatch.",
                    ));
                }
                bridge.attach_session(request).await
            })
        };
        // An expired attach can still create a Main subscription; release its
        // late receipt.
        {
            let replica = self.weak();
            let pending = pending.clone();
            let timed_out = timed_out.clone();
            let bridge = bridge.clone();
            let session_id = session_id.to_string();
            let instance_id = instance_id.clone();
            detach(&self.runtime, async move {
                let Ok(receipt) = pending.await else {
                    return;
                };
                let Some(replica) = replica.upgrade() else {
                    return;
                };
                if timed_out.get() || replica.disposed.get() || epoch != replica.epoch.get() {
                    replica.detach(
                        Some(bridge),
                        &session_id,
                        &receipt.subscription_id,
                        instance_id.as_deref(),
                    );
                }
            });
        }
        let signal = self.scope.borrow().signal();
        let replica = self.clone();
        let session_id = session_id.to_string();
        Box::pin(async move {
            let receipt = match wait_for_scoped_operation(
                &replica.runtime,
                pending,
                &signal,
                ATTACH_TIMEOUT_MS,
            )
            .await
            {
                Ok(receipt) => receipt,
                Err(error) => {
                    timed_out.set(scoped_timeout_ms(&error).is_some());
                    if replica.disposed.get() || epoch != replica.epoch.get() {
                        return Ok(None);
                    }
                    if replica.handle_ended(&error) {
                        return Err(agent_known_error("session-ended", None));
                    }
                    let cause = if timed_out.get() {
                        Cause::AttachTimeout
                    } else {
                        Cause::AttachFailed
                    };
                    replica.subscription_failed(epoch, cause, Some(&error));
                    return Err(agent_known_error("event-gap", None));
                }
            };
            if replica.disposed.get() || epoch != replica.epoch.get() {
                return Ok(None);
            }
            let validated = receipt.snapshot.and_then(|snapshot| {
                if snapshot.session.id != session_id {
                    return Err("Invalid Agent display snapshot.".to_string());
                }
                Ok(snapshot)
            });
            let snapshot = match validated {
                Ok(snapshot) => snapshot,
                Err(message) => {
                    let error = AgentError::new(message).with_name("TypeError");
                    replica.detach(
                        Some(bridge),
                        &session_id,
                        &receipt.subscription_id,
                        instance_id.as_deref(),
                    );
                    replica.subscription_failed(epoch, Cause::SchemaInvalid, Some(&error));
                    return Err(agent_known_error("event-gap", None));
                }
            };
            replica
                .last_snapshot_items
                .set(snapshot.display.parts.len());
            *replica.subscription.borrow_mut() = Some(Rc::new(Subscription {
                id: receipt.subscription_id.clone(),
                session_id: session_id.clone(),
                instance_id: snapshot.session.instance_id.clone(),
                stream_id: snapshot.cursor.stream_id.clone(),
                revision: Cell::new(snapshot.cursor.revision),
                acknowledged_revision: Cell::new(None),
                ack_promise: RefCell::default(),
                epoch,
            }));
            Ok(Some(*snapshot))
        })
    }

    fn activate_session_feed(self: &Rc<Self>, session_id: &str) -> LocalBoxFuture<'static, bool> {
        let subscription = self.subscription.borrow().clone();
        let Some(subscription) = subscription.filter(|s| s.session_id == session_id) else {
            return Box::pin(async { false });
        };
        let flush = self.flush_acknowledgements(&subscription);
        let replica = self.clone();
        Box::pin(async move {
            let synchronized = match flush.await {
                Ok(synchronized) => {
                    if !synchronized && replica.current(&subscription) {
                        replica.subscription_failed(
                            subscription.epoch,
                            Cause::BackpressureOverflow,
                            None,
                        );
                        false
                    } else {
                        if replica.current(&subscription) {
                            replica
                                .store
                                .patch(StatePatch::new().replica_status(ReplicaStatus::Live));
                        }
                        synchronized && replica.current(&subscription)
                    }
                }
                Err(error) => {
                    if replica.current(&subscription) && !replica.handle_ended(&error) {
                        let cause = classify_request_failure(Operation::Ack, &error);
                        replica.subscription_failed(subscription.epoch, cause, Some(&error));
                    }
                    false
                }
            };
            if replica.current(&subscription) && replica.replica_status() == ReplicaStatus::Live {
                replica.schedule_watermark_check();
            }
            synchronized
        })
    }

    fn subscription_failed(self: &Rc<Self>, epoch: u64, cause: Cause, error: Option<&AgentError>) {
        if self.disposed.get() || self.ended.get() || epoch != self.epoch.get() {
            return;
        }
        self.enter_recovery(cause, error);
        self.schedule_recovery_retry();
    }

    fn repair_from(self: &Rc<Self>, cause: Option<Cause>) -> LocalBoxFuture<'static, ()> {
        let cause =
            cause.unwrap_or_else(|| self.recovery_cause.get().unwrap_or(Cause::RevisionGap));
        if self.disposed.get() || self.ended.get() || self.paused.get() {
            return Box::pin(async {});
        }
        if let Some((_, repair)) = self.repair_promise.borrow().as_ref() {
            return repair.clone().boxed_local();
        }
        let Some(session_id) = self.session_id() else {
            return Box::pin(async {});
        };
        self.enter_recovery(cause, None);
        if self.attempts.get() >= MAX_RECOVERY_ATTEMPTS {
            self.pause_recovery(Policy::Exhausted);
            return Box::pin(async {});
        }
        self.attempts.set(self.attempts.get() + 1);
        self.patch_recovery(None);
        let pending = self.attach_session(&session_id);
        let repair_epoch = self.epoch.get();
        let id = self.task_id();
        let replica = self.clone();
        let repair = unstarted(async move {
            let result: AgentResult<()> = async {
                let Some(snapshot) = pending.await? else {
                    return Ok(());
                };
                if replica.disposed.get()
                    || replica.session_id().as_deref() != Some(session_id.as_str())
                {
                    return Ok(());
                }
                let projection = replica
                    .store
                    .read(|state| {
                        AgentProjection::project(&snapshot.display, Some(&state.projection))
                    })
                    .map_err(|error| AgentError::new(error).with_name("TypeError"))?;
                replica.store.patch(
                    StatePatch::new()
                        .session(Some(snapshot.session.clone()))
                        .control(Some(snapshot.control.clone()))
                        .projection(projection),
                );
                let synchronized = replica.activate_session_feed(&session_id).await;
                if synchronized
                    && !replica.disposed.get()
                    && !replica.paused.get()
                    && replica.epoch.get() == repair_epoch
                    && replica.session_id().as_deref() == Some(session_id.as_str())
                {
                    replica.finish_recovery();
                }
                Ok(())
            }
            .await;
            if let Err(error) = result
                && !replica.disposed.get()
                && replica.epoch.get() == repair_epoch
                && !replica.handle_ended(&error)
                && known_error_code(&error) != Some("event-gap")
            {
                replica.enter_recovery(
                    classify_request_failure(Operation::Attach, &error),
                    Some(&error),
                );
            }
            let current = replica
                .repair_promise
                .borrow()
                .as_ref()
                .is_some_and(|(task, _)| *task == id);
            if !current {
                return;
            }
            *replica.repair_promise.borrow_mut() = None;
            if replica.replica_status() != ReplicaStatus::Stale {
                return;
            }
            if replica.attempts.get() >= MAX_RECOVERY_ATTEMPTS {
                replica.pause_recovery(Policy::Exhausted);
                return;
            }
            replica.schedule_recovery_retry();
        });
        *self.repair_promise.borrow_mut() = Some((id, repair.clone()));
        launch(&self.runtime, &repair);
        repair.boxed_local()
    }

    fn pause_recovery(&self, policy: Policy) {
        if self.disposed.get() {
            return;
        }
        let cause = self.recovery_cause.get().unwrap_or(Cause::RevisionGap);
        self.paused.set(true);
        self.clear_recovery_timers();
        self.clear_stability_timer();
        self.invalidate();
        if let Some(cleanup) = self.frame_cleanup.borrow_mut().take() {
            cleanup();
        }
        if let Some(cleanup) = self.failure_cleanup.borrow_mut().take() {
            cleanup();
        }
        *self.connected_bridge.borrow_mut() = None;
        *self.repair_promise.borrow_mut() = None;
        self.store.patch(
            StatePatch::new()
                .replica_status(ReplicaStatus::Stale)
                .display_recovery(Some(AgentDisplayRecovery {
                    policy,
                    stage: Stage::ActionRequired,
                    cause,
                    attempt: self.attempts.get(),
                    max_attempts: MAX_RECOVERY_ATTEMPTS,
                })),
        );
    }

    fn retry_recovery(self: &Rc<Self>) -> LocalBoxFuture<'static, ()> {
        if self.disposed.get() || self.ended.get() {
            return Box::pin(async {});
        }
        if let Some((_, repair)) = self.repair_promise.borrow().as_ref() {
            return repair.clone().boxed_local();
        }
        let cause = self.recovery_cause.get().unwrap_or(Cause::RevisionGap);
        self.paused.set(false);
        self.attempts.set(0);
        self.reset_recovery_incident();
        self.connect();
        self.repair_from(Some(cause))
    }

    fn handle_frame(self: &Rc<Self>, frame: SessionFrame) {
        let subscription = self.subscription.borrow().clone();
        let Some(subscription) = subscription else {
            return;
        };
        if !self.current(&subscription) || frame.subscription_id() != Some(subscription.id.as_str())
        {
            return;
        }
        if let Err(error) = self.apply_frame(&subscription, frame) {
            self.enter_recovery(Cause::SchemaInvalid, Some(&error));
            drop(self.repair_from(Some(Cause::SchemaInvalid)));
        }
    }

    fn apply_frame(
        self: &Rc<Self>,
        subscription: &Rc<Subscription>,
        frame: SessionFrame,
    ) -> AgentResult<()> {
        let (stream_id, base_revision, revision, control, display_patch, session) = match frame {
            SessionFrame::Malformed { error, .. } => {
                return Err(AgentError::new(error).with_name("TypeError"));
            }
            SessionFrame::ResyncRequired { .. } => {
                self.schedule_watermark_check();
                drop(self.repair_from(Some(Cause::BackpressureOverflow)));
                return Ok(());
            }
            SessionFrame::Delta {
                stream_id,
                base_revision,
                revision,
                control,
                display_patch,
                session,
                ..
            } => (
                stream_id,
                base_revision,
                revision,
                control,
                display_patch,
                session,
            ),
        };
        self.schedule_watermark_check();
        if stream_id != subscription.stream_id {
            drop(self.repair_from(Some(Cause::StreamReset)));
            return Ok(());
        }
        if revision <= subscription.revision.get() {
            return Ok(());
        }
        if base_revision != subscription.revision.get() || session.id != subscription.session_id {
            drop(self.repair_from(Some(Cause::RevisionGap)));
            return Ok(());
        }
        let projection = self
            .store
            .read(|state| state.projection.apply(&display_patch))
            .map_err(|error| AgentError::new(error).with_name("TypeError"))?;
        let closed = control.connection.reason.as_deref() == Some("session-closed");
        // Validate and publish the complete transaction before moving the
        // cursor or ACKing it.
        self.store.patch(
            StatePatch::new()
                .projection(projection)
                .control(Some(*control))
                .session(Some(*session)),
        );
        if closed {
            self.end_instance();
            return Ok(());
        }
        subscription.revision.set(revision);
        self.request_frame_acknowledgement(subscription);
        Ok(())
    }

    fn current(&self, subscription: &Rc<Subscription>) -> bool {
        !self.disposed.get()
            && !self.paused.get()
            && self
                .subscription
                .borrow()
                .as_ref()
                .is_some_and(|current| Rc::ptr_eq(current, subscription))
            && subscription.epoch == self.epoch.get()
            && self.session_id().as_deref() == Some(subscription.session_id.as_str())
    }

    fn request_frame_acknowledgement(self: &Rc<Self>, subscription: &Rc<Subscription>) {
        // One in-flight loop always advances to the newest applied revision. A
        // burst therefore creates at most one outstanding IPC request instead
        // of one per frame.
        if subscription.ack_promise.borrow().is_some() {
            return;
        }
        let flush = self.flush_acknowledgements(subscription);
        let replica = self.clone();
        let subscription = subscription.clone();
        detach(&self.runtime, async move {
            match flush.await {
                Ok(synchronized) => {
                    if !synchronized && replica.current(&subscription) {
                        replica.subscription_failed(
                            subscription.epoch,
                            Cause::BackpressureOverflow,
                            None,
                        );
                    }
                }
                Err(error) => {
                    if !replica.current(&subscription) || replica.handle_ended(&error) {
                        return;
                    }
                    let cause = classify_request_failure(Operation::Ack, &error);
                    replica.subscription_failed(subscription.epoch, cause, Some(&error));
                }
            }
        });
    }

    fn flush_acknowledgements(
        self: &Rc<Self>,
        subscription: &Rc<Subscription>,
    ) -> Task<AgentResult<bool>> {
        if let Some((_, task)) = subscription.ack_promise.borrow().as_ref() {
            return task.clone();
        }
        let bridge = self.connected_bridge.borrow().clone();
        let Some(bridge) = bridge.filter(|b| b.supports(AgentOperation::AcknowledgeFeed)) else {
            return resolved(Err(AgentError::new(
                "The Agent display feed cannot acknowledge changes.",
            )));
        };
        let id = self.task_id();
        let replica = self.clone();
        let tracked = subscription.clone();
        let task = unstarted(async move {
            let subscription = tracked;
            let result: AgentResult<bool> = async {
                while replica.current(&subscription)
                    && subscription.acknowledged_revision.get() != Some(subscription.revision.get())
                {
                    let revision = subscription.revision.get();
                    let target = feed_target(
                        &replica.workspace_root,
                        &subscription.session_id,
                        subscription.instance_id.as_deref(),
                        &subscription.id,
                    );
                    let request = FeedAck {
                        root_path: target.root_path,
                        session_id: target.session_id,
                        instance_id: target.instance_id,
                        subscription_id: target.subscription_id,
                        stream_id: subscription.stream_id.clone(),
                        revision,
                    };
                    let signal = replica.scope.borrow().signal();
                    let turn = microtask(&replica.runtime);
                    let call = async {
                        turn.await;
                        bridge.acknowledge_session(request).await
                    };
                    let result = wait_for_scoped_operation(
                        &replica.runtime,
                        call,
                        &signal,
                        CONTROL_REQUEST_TIMEOUT_MS,
                    )
                    .await?;
                    if !replica.current(&subscription) || !result.synchronized {
                        return Ok(false);
                    }
                    subscription.acknowledged_revision.set(Some(revision));
                }
                Ok(replica.current(&subscription))
            }
            .await;
            let current = subscription
                .ack_promise
                .borrow()
                .as_ref()
                .is_some_and(|(task, _)| *task == id);
            if current {
                *subscription.ack_promise.borrow_mut() = None;
            }
            result
        });
        *subscription.ack_promise.borrow_mut() = Some((id, task.clone()));
        launch(&self.runtime, &task);
        task
    }

    fn schedule_watermark_check(self: &Rc<Self>) {
        self.clear_watermark_timer();
        if self.disposed.get()
            || self.ended.get()
            || self.paused.get()
            || self.subscription.borrow().is_none()
            || self.replica_status() != ReplicaStatus::Live
        {
            return;
        }
        let weak = self.weak();
        let timer = set_timeout(&self.runtime, WATERMARK_IDLE_MS, move || {
            if let Some(replica) = weak.upgrade() {
                *replica.watermark_timer.borrow_mut() = None;
                let check = replica.clone().check_watermark();
                detach(&replica.runtime, check);
            }
        });
        *self.watermark_timer.borrow_mut() = Some(timer);
    }

    fn clear_watermark_timer(&self) {
        clear(&self.watermark_timer);
    }

    async fn check_watermark(self: Rc<Self>) {
        let subscription = self.subscription.borrow().clone();
        let bridge = self.connected_bridge.borrow().clone();
        let (Some(subscription), Some(bridge)) = (subscription, bridge) else {
            return;
        };
        if !self.current(&subscription) || !bridge.supports(AgentOperation::ReadFeedWatermark) {
            return;
        }
        let request = feed_target(
            &self.workspace_root,
            &subscription.session_id,
            subscription.instance_id.as_deref(),
            &subscription.id,
        );
        let signal = self.scope.borrow().signal();
        let turn = microtask(&self.runtime);
        let call = async {
            turn.await;
            bridge.read_session_watermark(request).await
        };
        match wait_for_scoped_operation(&self.runtime, call, &signal, CONTROL_REQUEST_TIMEOUT_MS)
            .await
        {
            Ok(watermark) => {
                if self.current(&subscription) {
                    // Frames may advance while this read is in flight. A lower
                    // watermark is harmless.
                    if watermark.resync_required {
                        self.repair_from(Some(Cause::BackpressureOverflow)).await;
                    } else if watermark.stream_id != subscription.stream_id {
                        self.repair_from(Some(Cause::StreamReset)).await;
                    } else if watermark.revision > subscription.revision.get() {
                        self.repair_from(Some(Cause::RevisionGap)).await;
                    }
                }
            }
            Err(error) => {
                if self.current(&subscription) && !self.handle_ended(&error) {
                    self.repair_from(Some(classify_request_failure(Operation::Watermark, &error)))
                        .await;
                }
            }
        }
        if self.replica_status() == ReplicaStatus::Live {
            self.schedule_watermark_check();
        }
    }

    fn enter_recovery(self: &Rc<Self>, cause: Cause, error: Option<&AgentError>) {
        if self.disposed.get() || self.ended.get() || self.paused.get() {
            return;
        }
        self.clear_watermark_timer();
        self.clear_stability_timer();
        let new_incident = self.recovery_started_at.get().is_none();
        if new_incident {
            self.recovery_started_at.set(Some(self.runtime.now_ms()));
            self.schedule_recovery_visibility();
        }
        let previous_cause = self.recovery_cause.replace(Some(cause));
        let stage = self.store.read(|state| match state.display_recovery {
            Some(recovery) if recovery.policy == Policy::Automatic => recovery.stage,
            _ => Stage::Silent,
        });
        self.store.patch(
            StatePatch::new()
                .replica_status(ReplicaStatus::Stale)
                .display_recovery(Some(AgentDisplayRecovery {
                    policy: Policy::Automatic,
                    stage,
                    cause,
                    attempt: self.attempts.get(),
                    max_attempts: MAX_RECOVERY_ATTEMPTS,
                })),
        );
        if new_incident || previous_cause != Some(cause) {
            self.log_recovery(cause, error);
        }
    }

    fn patch_recovery(&self, stage: Option<Stage>) {
        let stage = stage.unwrap_or_else(|| {
            self.store.read(|state| match state.display_recovery {
                Some(recovery) if recovery.policy == Policy::Automatic => recovery.stage,
                _ => Stage::Silent,
            })
        });
        self.store.patch(
            StatePatch::new()
                .replica_status(ReplicaStatus::Stale)
                .display_recovery(Some(AgentDisplayRecovery {
                    policy: Policy::Automatic,
                    stage,
                    cause: self.recovery_cause.get().unwrap_or(Cause::RevisionGap),
                    attempt: self.attempts.get(),
                    max_attempts: MAX_RECOVERY_ATTEMPTS,
                })),
        );
    }

    fn schedule_recovery_visibility(self: &Rc<Self>) {
        self.clear_visibility_timers();
        let started_at = self.recovery_started_at.get();
        let schedule = |delay: u64, stage: Stage, slot: fn(&Inner) -> &RefCell<Option<Timer>>| {
            let weak = self.weak();
            set_timeout(&self.runtime, delay, move || {
                let Some(replica) = weak.upgrade() else {
                    return;
                };
                *slot(&replica).borrow_mut() = None;
                let automatic = replica.store.read(|state| {
                    state
                        .display_recovery
                        .is_some_and(|recovery| recovery.policy == Policy::Automatic)
                });
                if replica.recovery_started_at.get() == started_at && automatic {
                    replica.patch_recovery(Some(stage));
                }
            })
        };
        let reconnecting = schedule(RECOVERY_RECONNECTING_DELAY_MS, Stage::Reconnecting, |r| {
            &r.reconnecting_timer
        });
        *self.reconnecting_timer.borrow_mut() = Some(reconnecting);
        let degraded = schedule(RECOVERY_DEGRADED_DELAY_MS, Stage::Degraded, |r| {
            &r.degraded_timer
        });
        *self.degraded_timer.borrow_mut() = Some(degraded);
    }

    fn schedule_recovery_retry(self: &Rc<Self>) {
        if self.disposed.get()
            || self.ended.get()
            || self.paused.get()
            || self.repair_promise.borrow().is_some()
            || self.recovery_retry_timer.borrow().is_some()
            || self.store.read(|state| state.session.is_none())
        {
            return;
        }
        if self.attempts.get() >= MAX_RECOVERY_ATTEMPTS {
            self.pause_recovery(Policy::Exhausted);
            return;
        }
        let ceiling =
            RECOVERY_RETRY_MAX_MS.min(RECOVERY_RETRY_BASE_MS * 2u64.pow(self.attempts.get()));
        let delay = (ceiling as f64 * (0.5 + math_random() * 0.5)) as u64;
        let weak = self.weak();
        let timer = set_timeout(&self.runtime, delay, move || {
            if let Some(replica) = weak.upgrade() {
                *replica.recovery_retry_timer.borrow_mut() = None;
                let cause = replica.recovery_cause.get().unwrap_or(Cause::RevisionGap);
                drop(replica.repair_from(Some(cause)));
            }
        });
        *self.recovery_retry_timer.borrow_mut() = Some(timer);
    }

    fn finish_recovery(self: &Rc<Self>) {
        self.clear_recovery_timers();
        self.recovery_started_at.set(None);
        self.recovery_cause.set(None);
        let mut patch = StatePatch::new()
            .replica_status(ReplicaStatus::Live)
            .display_recovery(None);
        if self
            .store
            .read(|state| state.error_code() == Some("event-gap"))
        {
            patch = patch.error(None);
        }
        self.store.patch(patch);
        self.clear_stability_timer();
        let weak = self.weak();
        let timer = set_timeout(&self.runtime, RECOVERY_STABILITY_WINDOW_MS, move || {
            if let Some(replica) = weak.upgrade() {
                *replica.stability_timer.borrow_mut() = None;
                if replica.replica_status() == ReplicaStatus::Live {
                    replica.attempts.set(0);
                }
            }
        });
        *self.stability_timer.borrow_mut() = Some(timer);
        self.schedule_watermark_check();
    }

    fn reset_recovery_incident(&self) {
        self.clear_recovery_timers();
        self.clear_stability_timer();
        self.recovery_started_at.set(None);
        self.recovery_cause.set(None);
    }

    fn clear_visibility_timers(&self) {
        clear(&self.reconnecting_timer);
        clear(&self.degraded_timer);
    }

    fn clear_recovery_timers(&self) {
        self.clear_visibility_timers();
        clear(&self.recovery_retry_timer);
    }

    fn clear_stability_timer(&self) {
        clear(&self.stability_timer);
    }

    fn log_recovery(&self, cause: Cause, error: Option<&AgentError>) {
        let subscription = self.subscription.borrow().clone();
        let detail = self.store.read(|state| {
            let runtime = state
                .session
                .as_ref()
                .and_then(|s| s.runtime_id.clone())
                .or_else(|| state.selected_runtime_id.clone());
            let version = state
                .inspection
                .as_ref()
                .and_then(|i| i.readiness.as_ref())
                .and_then(|r| r.version.clone());
            format!(
                "cause={} attempt={} expectedRevision={:?} acknowledgedRevision={:?} streamId={:?} snapshotItems={} elapsedMs={} runtimeId={:?} runtimeVersion={:?} timeoutMs={:?}",
                cause.as_str(),
                self.attempts.get(),
                subscription.as_ref().map(|s| s.revision.get()),
                subscription
                    .as_ref()
                    .and_then(|s| s.acknowledged_revision.get()),
                subscription.as_ref().map(|s| s.stream_id.clone()),
                self.last_snapshot_items.get(),
                self.recovery_started_at
                    .get()
                    .map_or(0, |started| (self.runtime.now_ms() - started).max(0)),
                runtime,
                version,
                error.and_then(scoped_timeout_ms),
            )
        });
        eprintln!("Agent display feed entered recovery {detail}");
    }

    fn handle_ended(&self, error: &AgentError) -> bool {
        let code = match operation_failure(error) {
            Some(failure) => Some(failure.code.clone()),
            None => error.code.clone(),
        };
        if !code.is_some_and(|code| ENDED_CODES.contains(&code.as_str())) {
            return false;
        }
        self.end_instance();
        true
    }

    fn end_instance(&self) {
        self.ended.set(true);
        self.clear_recovery_timers();
        self.clear_stability_timer();
        self.invalidate();
        self.store.patch(
            StatePatch::new()
                .phase(AgentControllerPhase::RuntimeExited)
                .replica_status(ReplicaStatus::Detached)
                .display_recovery(None)
                .error(Some(create_agent_error("session-ended", None))),
        );
    }
}

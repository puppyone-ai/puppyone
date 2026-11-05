//! `application/AgentSessionController.ts`: one Agent tab's Renderer
//! controller over the client port.
//!
//! The product's `async` methods run until their first `await` when
//! called and keep running when nobody awaits them. These methods do the
//! same synchronous work, then return a started [`Task`].
use super::agent_client_port::{AgentClientProvider, AgentFile, require_bridge};
use super::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentDisplayRecoveryPolicy,
    AgentSessionPreparation, ReplicaStatus, StatePatch, StopRequest, StopRequestStatus,
    agent_controller_transitions,
};
use super::agent_controller_values::{choose_agent_effort, choose_agent_mode};
use super::agent_error::{create_agent_error, format_agent_error, known_error_code};
use super::agent_reference_draft_manager::{
    AgentReferenceDraftManager, AgentReferenceDraftManagerOptions,
};
use super::agent_reference_preview_store::AgentReferenceVisualPreview;
use super::agent_runtime_discovery_cache::has_fresh_agent_runtime_inspection;
use super::agent_runtime_selection::plan_agent_runtime_switch;
use super::agent_session_lifecycle::{AgentSessionLifecycle, AgentSessionLifecycleOptions};
use super::agent_session_preparer::{AgentSessionPreparer, AgentSessionPreparerOptions};
use super::agent_session_replica::AgentSessionReplica;
use super::agent_turn_submission_coordinator::{
    AgentTurnSubmissionCoordinator, AgentTurnSubmissionCoordinatorOptions,
};
use super::local_agent_connection_loader::LocalAgentConnectionLoader;
use super::session_ui_state_store::{SessionUiPatch, SessionUiState, SessionUiStateStore};
use super::ui_runtime::{Task, UiRuntime, detach, launch, random_uuid, resolved, start, unstarted};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::constants::AGENT_IDLE_DISCONNECT_REASON;
use crate::agent::contract::display_state::create_empty_agent_display;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::contract::js;
use crate::agent::contract::schema::assert_agent_session_snapshot;
use crate::features::desktop_agent::domain::agent_provider_routing::{
    agent_provider_id_for_model, choose_agent_model, choose_agent_provider,
    list_agent_inference_providers,
};
use crate::features::desktop_agent::domain::agent_session_open_error::agent_session_open_error;
use crate::features::desktop_agent::domain::agent_ui_state::AgentViewportGeometry;
use crate::features::session_transport::managed_operation_scope::{
    ManagedOperationScope, wait_for_scoped_operation,
};
use futures_util::FutureExt;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

/// `() => Promise<AgentSessionSnapshot>`.
pub type CreateSession = Rc<dyn Fn() -> LocalBoxFuture<'static, AgentResult<Value>>>;
/// `(snapshot) => Promise<void>`.
pub type ApplySnapshot = Rc<dyn Fn(Value) -> LocalBoxFuture<'static, AgentResult<()>>>;

type Listener = Rc<dyn Fn()>;

/// `this.state`, `patch(patch)`, `getSnapshot` and `subscribe`: the state
/// every collaborator reads and patches.
#[derive(Default)]
pub struct AgentControllerStore {
    state: RefCell<AgentControllerState>,
    revision: Cell<u64>,
    disposed: Cell<bool>,
    session_model_ids: RefCell<HashSet<String>>,
    listeners: RefCell<Vec<(u64, Listener)>>,
    next_listener: Cell<u64>,
}

impl AgentControllerStore {
    /// Reads the current state (`getSnapshot()`); the borrow ends with `read`.
    pub fn read<R>(&self, read: impl FnOnce(&AgentControllerState) -> R) -> R {
        read(&self.state.borrow())
    }

    /// A copy of the current state.
    pub fn snapshot(&self) -> AgentControllerState {
        self.state.borrow().clone()
    }

    /// Increments with every published state (`getSnapshot()` identity).
    pub fn revision(&self) -> u64 {
        self.revision.get()
    }

    /// `subscribe(listener)`: the id [`Self::unsubscribe`] takes.
    pub fn subscribe(&self, listener: Rc<dyn Fn()>) -> u64 {
        let id = self.next_listener.get() + 1;
        self.next_listener.set(id);
        self.listeners.borrow_mut().push((id, listener));
        id
    }

    pub fn unsubscribe(&self, id: u64) {
        self.listeners
            .borrow_mut()
            .retain(|(listener, _)| *listener != id);
    }

    fn dispose(&self) {
        self.disposed.set(true);
        self.listeners.borrow_mut().clear();
    }

    fn set_session_model_ids(&self, ids: HashSet<String>) {
        *self.session_model_ids.borrow_mut() = ids;
    }

    fn has_session_model(&self, model: &str) -> bool {
        self.session_model_ids.borrow().contains(model)
    }

    /// `patch(patch)`. An invalid phase transition is a programming error:
    /// the patch is rejected (the product throws from `patch`).
    pub fn patch(&self, patch: StatePatch) {
        if self.disposed.get() {
            return;
        }
        {
            let mut state = self.state.borrow_mut();
            if let Some(phase) = patch.phase
                && phase != state.phase
                && !agent_controller_transitions(state.phase).contains(&phase)
            {
                eprintln!(
                    "Invalid Agent controller transition: {} -> {}",
                    state.phase.as_str(),
                    phase.as_str()
                );
                return;
            }
            let reset_session = matches!(patch.session, Some(None)) && patch.control.is_none();
            patch.apply_to(&mut state);
            if reset_session {
                self.session_model_ids.borrow_mut().clear();
                state.control = None;
                state.replica_status = ReplicaStatus::Detached;
            }
            if state.control.is_some() && state.session.is_some() {
                derive_control_replica_state(&mut state);
            }
        }
        self.revision.set(self.revision.get() + 1);
        self.emit();
    }

    fn emit(&self) {
        let listeners: Vec<Rc<dyn Fn()>> = self
            .listeners
            .borrow()
            .iter()
            .map(|(_, l)| l.clone())
            .collect();
        for listener in listeners {
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| listener())).is_err() {
                eprintln!("Agent display subscriber failed");
            }
        }
    }
}

/// `deriveControlReplicaState(state)`.
fn derive_control_replica_state(state: &mut AgentControllerState) {
    let (Some(control), Some(session)) = (state.control.as_ref(), state.session.as_mut()) else {
        return;
    };
    let view = state
        .projection
        .get("presentation")
        .cloned()
        .unwrap_or(Value::Null);
    let pending_id = state
        .pending_intent
        .as_ref()
        .map(|intent| intent["id"].clone());
    let admitted = pending_id.as_ref().is_some_and(|id| {
        control["commands"]
            .as_array()
            .is_some_and(|commands| commands.iter().any(|command| command["commandId"] == *id))
    });
    let local_pending = match &state.pending_intent {
        Some(intent) if !admitted => intent["prompt"].as_str().map(str::to_string),
        _ => None,
    };
    // A cached projection cannot override a newer transport failure or local
    // preparation failure. Explicit recovery publishes the next ready phase.
    if !matches!(
        state.phase,
        AgentControllerPhase::Discovering
            | AgentControllerPhase::Restoring
            | AgentControllerPhase::Failed
            | AgentControllerPhase::RuntimeExited
    ) && let Some(phase) = view["phase"].as_str().and_then(AgentControllerPhase::parse)
    {
        state.phase = phase;
    }
    session["activeTurnId"] = state
        .projection
        .get("runningTurnId")
        .cloned()
        .unwrap_or(Value::Null);
    match view.get("terminalState") {
        Some(terminal) => session["terminalState"] = terminal.clone(),
        None => js::delete(session, "terminalState"),
    }
    state.pending_prompt = view["pendingPrompt"]
        .as_str()
        .map(str::to_string)
        .or(local_pending);
    state.submitting = js::truthy(&view["submitting"]) || state.pending_intent.is_some();
    let session_id = session["id"].as_str().map(str::to_string);
    let instance_id = session["instanceId"].as_str().map(str::to_string);
    let running_turn_id = state.projection.running_turn_id().map(str::to_string);
    let stopping = state
        .stop_request
        .as_ref()
        .is_some_and(|request| request.status == StopRequestStatus::Sending)
        || (state.replica_status == ReplicaStatus::Live && js::truthy(&view["stopping"]));
    if let Some(request) = &state.stop_request
        && (Some(&request.session_id) != session_id.as_ref()
            || request.instance_id != instance_id
            || (state.replica_status == ReplicaStatus::Live
                && Some(&request.turn_id) != running_turn_id.as_ref()))
    {
        state.stop_request = None;
    }
    state.stopping = stopping;
}

/// `exportDisplayDraft()`.
#[derive(Clone, Debug, PartialEq)]
pub struct DisplayDraft {
    pub text: String,
    pub mentions: Vec<Value>,
    pub references: Vec<Value>,
    pub reference_epoch: String,
}

/// `new AgentSessionController(workspaceRoot, bridgeProvider)`.
#[derive(Clone)]
pub struct AgentSessionController(Rc<Inner>);

struct Inner {
    workspace_root: String,
    bridge_provider: AgentClientProvider,
    runtime: Rc<dyn UiRuntime>,
    store: Rc<AgentControllerStore>,
    session_replica: AgentSessionReplica,
    initialize_promise: RefCell<Option<(u64, Task<AgentResult<()>>)>>,
    session_ui: RefCell<SessionUiStateStore>,
    local_connection_loader: LocalAgentConnectionLoader,
    session_lifecycle: AgentSessionLifecycle,
    session_preparer: AgentSessionPreparer,
    reference_drafts: AgentReferenceDraftManager,
    submission: AgentTurnSubmissionCoordinator,
    last_inspection_at: Cell<i64>,
    model_catalog_epoch: Cell<u64>,
    disposed: Cell<bool>,
    stop_intent: RefCell<Option<Value>>,
    stop_scope: ManagedOperationScope,
    next_task: Cell<u64>,
}

fn upgrade(weak: &Weak<Inner>) -> AgentResult<Rc<Inner>> {
    weak.upgrade()
        .ok_or_else(|| AgentError::new("The Agent controller was released."))
}

impl AgentSessionController {
    pub fn new(
        workspace_root: &str,
        bridge_provider: AgentClientProvider,
        runtime: Rc<dyn UiRuntime>,
    ) -> Self {
        let store = Rc::new(AgentControllerStore::default());
        let inner = Rc::new_cyclic(|weak: &Weak<Inner>| {
            let create_session: CreateSession = {
                let weak = weak.clone();
                Rc::new(move || match upgrade(&weak) {
                    Ok(inner) => inner.create_session(),
                    Err(error) => Box::pin(async move { Err(error) }),
                })
            };
            let apply_snapshot: ApplySnapshot = {
                let weak = weak.clone();
                Rc::new(move |snapshot| match upgrade(&weak) {
                    Ok(inner) => inner.apply_snapshot(snapshot),
                    Err(error) => Box::pin(async move { Err(error) }),
                })
            };
            let local_connection_loader = LocalAgentConnectionLoader::new(
                workspace_root,
                bridge_provider.clone(),
                store.clone(),
                runtime.clone(),
            );
            let reference_drafts =
                AgentReferenceDraftManager::new(AgentReferenceDraftManagerOptions {
                    workspace_root: workspace_root.to_string(),
                    bridge_provider: bridge_provider.clone(),
                    store: store.clone(),
                    runtime: runtime.clone(),
                    append_text: {
                        let weak = weak.clone();
                        Rc::new(move |text| {
                            if let Some(inner) = weak.upgrade() {
                                inner.append_dropped_text(text);
                            }
                        })
                    },
                });
            let submission =
                AgentTurnSubmissionCoordinator::new(AgentTurnSubmissionCoordinatorOptions {
                    workspace_root: workspace_root.to_string(),
                    bridge_provider: bridge_provider.clone(),
                    references: reference_drafts.clone(),
                    store: store.clone(),
                    write_draft: {
                        let weak = weak.clone();
                        Rc::new(move |draft, mentions| {
                            if let Some(inner) = weak.upgrade() {
                                inner.write_current_session_ui(SessionUiPatch {
                                    draft: Some(draft.to_string()),
                                    draft_mentions: Some(mentions.to_vec()),
                                    ..Default::default()
                                });
                            }
                        })
                    },
                    prepare_session: {
                        let weak = weak.clone();
                        Rc::new(move || match weak.upgrade() {
                            Some(inner) => inner.session_preparer.prepare().boxed_local(),
                            None => Box::pin(async { false }),
                        })
                    },
                    reconnect_session: {
                        let weak = weak.clone();
                        Rc::new(move || match upgrade(&weak) {
                            Ok(inner) => inner.reconnect_idle_session(),
                            Err(error) => Box::pin(async move { Err(error) }),
                        })
                    },
                });
            let session_replica = AgentSessionReplica::new(
                workspace_root,
                bridge_provider.clone(),
                store.clone(),
                runtime.clone(),
            );
            let session_lifecycle = AgentSessionLifecycle::new(AgentSessionLifecycleOptions {
                workspace_root: workspace_root.to_string(),
                bridge_provider: bridge_provider.clone(),
                store: store.clone(),
                create_session: create_session.clone(),
                apply_snapshot: apply_snapshot.clone(),
                delete_session_ui: {
                    let weak = weak.clone();
                    Rc::new(move |session_id| {
                        if let Some(inner) = weak.upgrade() {
                            inner.session_ui.borrow_mut().delete(session_id);
                        }
                    })
                },
            });
            let session_preparer = AgentSessionPreparer::new(AgentSessionPreparerOptions {
                workspace_root: workspace_root.to_string(),
                bridge_provider: bridge_provider.clone(),
                store: store.clone(),
                runtime: runtime.clone(),
                create_session,
                apply_snapshot,
            });
            Inner {
                workspace_root: workspace_root.to_string(),
                bridge_provider: bridge_provider.clone(),
                runtime: runtime.clone(),
                store: store.clone(),
                session_replica,
                initialize_promise: RefCell::default(),
                session_ui: RefCell::default(),
                local_connection_loader,
                session_lifecycle,
                session_preparer,
                reference_drafts,
                submission,
                last_inspection_at: Cell::new(0),
                model_catalog_epoch: Cell::new(0),
                disposed: Cell::new(false),
                stop_intent: RefCell::default(),
                stop_scope: ManagedOperationScope::new(),
                next_task: Cell::new(0),
            }
        });
        inner.session_replica.connect();
        Self(inner)
    }

    pub fn workspace_root(&self) -> &str {
        &self.0.workspace_root
    }

    /// The state store (`getSnapshot`, `subscribe`).
    pub fn store(&self) -> &Rc<AgentControllerStore> {
        &self.0.store
    }

    /// `getSnapshot()` (a copy).
    pub fn get_snapshot(&self) -> AgentControllerState {
        self.0.store.snapshot()
    }

    /// `subscribe(listener)`: the returned closure unsubscribes.
    pub fn subscribe(&self, listener: Rc<dyn Fn()>) -> impl FnOnce() + 'static {
        let id = self.0.store.subscribe(listener);
        let store = Rc::downgrade(&self.0.store);
        move || {
            if let Some(store) = store.upgrade() {
                store.unsubscribe(id);
            }
        }
    }

    /// Releases Renderer subscriptions only; it never sends a runtime stop.
    pub fn dispose(&self, preserve_draft: bool) {
        self.0.dispose(preserve_draft);
    }

    pub fn initialize(&self, refresh: bool) -> Task<AgentResult<()>> {
        self.0.initialize_runtime(refresh, true)
    }

    /// Discover the runtime catalog without implicitly restoring any
    /// conversation.
    pub fn inspect_runtimes(&self, refresh: bool) -> Task<AgentResult<()>> {
        self.0.initialize_runtime(refresh, false)
    }

    /// Rebuilds only the display replica; never creates/resumes a native
    /// session.
    pub fn attach_live_session(&self, session_id: &str, runtime_id: &str) -> Task<AgentResult<()>> {
        let inner = self.0.clone();
        let initialize = inner.initialize_for_runtime(runtime_id);
        let session_id = session_id.to_string();
        start(&self.0.runtime, async move {
            initialize.await?;
            inner.session_replica.connect();
            let Some(snapshot) = inner.session_replica.attach_session(&session_id).await? else {
                return Err(AgentError::new(
                    "The live Agent session is unavailable for display recovery.",
                ));
            };
            inner.apply_snapshot_state(&snapshot)?;
            inner
                .session_replica
                .activate_session_feed(&session_id)
                .await;
            Ok(())
        })
    }

    pub fn export_display_draft(&self) -> DisplayDraft {
        let inner = &self.0;
        inner.store.read(|state| DisplayDraft {
            text: state.draft.clone(),
            mentions: state.draft_mentions.clone(),
            references: state
                .references
                .iter()
                .filter(|reference| reference["status"] == "ready")
                .cloned()
                .collect(),
            reference_epoch: inner.reference_drafts.reference_epoch(),
        })
    }

    pub fn restore_display_draft(&self, draft: DisplayDraft) -> AgentResult<()> {
        self.0
            .reference_drafts
            .restore_epoch(&draft.reference_epoch)?;
        self.0.set_draft_document(&draft.text, &draft.mentions);
        self.0
            .store
            .patch(StatePatch::new().references(draft.references));
        Ok(())
    }

    /// Selects a creation recipe before first discovery without restoring
    /// history.
    pub fn initialize_for_runtime(&self, runtime_id: &str) -> Task<AgentResult<bool>> {
        self.0.initialize_for_runtime(runtime_id)
    }

    /// Binds a direct-creation recipe synchronously, then lets the mounted
    /// Chat surface own discovery progress and recovery instead of blocking
    /// topology.
    pub fn begin_initialize_for_runtime(&self, runtime_id: &str) {
        let inner = self.0.clone();
        let initialize = inner.initialize_for_runtime(runtime_id);
        detach(&self.0.runtime, async move {
            if let Err(error) = initialize.await {
                inner.store.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::Failed)
                        .error(Some(format_agent_error(&error)))
                        .initialized(true)
                        .session_preparation(AgentSessionPreparation::Failed),
                );
            }
        });
    }

    pub fn discover_local_connections(&self, refresh: bool) -> Task<()> {
        self.0.local_connection_loader.discover(refresh)
    }

    /// Refresh setup/catalog UI without resuming or replacing a live native
    /// session.
    pub fn refresh_model_connections(&self) -> Task<()> {
        self.0.refresh_model_connections()
    }

    pub fn select_runtime(&self, runtime_id: &str) -> Task<bool> {
        self.0.select_runtime(runtime_id)
    }

    pub fn open_saved_session(
        &self,
        session_id: &str,
        runtime_id: &str,
    ) -> Task<AgentResult<bool>> {
        self.0.open_saved_session(session_id, runtime_id)
    }

    pub fn select_provider(&self, provider_id: Option<&str>) -> Option<String> {
        self.0.select_provider(provider_id)
    }

    pub fn select_model(&self, model: Option<&str>) {
        self.0.select_model(model);
    }

    pub fn requires_new_model_connection_session(&self, model: Option<&str>) -> bool {
        self.0.requires_new_model_connection_session(model)
    }

    pub fn start_new_model_connection(&self, model: &str) -> Task<()> {
        self.0.start_new_model_connection(model)
    }

    pub fn select_effort(&self, effort: Option<&str>) {
        self.0.select_effort(effort);
    }

    pub fn select_mode(&self, mode: Option<&str>) {
        self.0.select_mode(mode);
    }

    pub fn set_draft(&self, draft: &str) {
        self.0.set_draft_document(draft, &[]);
    }

    pub fn set_draft_document(&self, draft: &str, draft_mentions: &[Value]) {
        self.0.set_draft_document(draft, draft_mentions);
    }

    pub fn add_workspace_paths(
        &self,
        paths: Vec<String>,
        visual_previews: Vec<(String, AgentReferenceVisualPreview)>,
    ) -> Task<AgentResult<usize>> {
        start(
            &self.0.runtime,
            self.0
                .reference_drafts
                .add_workspace_paths(paths, visual_previews),
        )
    }

    pub fn get_reference_preview_url(&self, id: &str) -> Option<String> {
        self.0.reference_drafts.preview_url(id)
    }

    pub fn capture_reference_acquisition(&self) -> impl Fn() -> bool + 'static {
        self.0.reference_drafts.capture_acquisition()
    }

    pub fn pick_workspace_references(&self) -> Task<AgentResult<usize>> {
        start(
            &self.0.runtime,
            self.0.reference_drafts.pick_workspace_references(),
        )
    }

    pub fn add_path_text_or_draft(&self, text: &str) -> Task<AgentResult<bool>> {
        start(
            &self.0.runtime,
            self.0.reference_drafts.add_path_text_or_draft(text),
        )
    }

    pub fn stage_external_files(&self, files: Vec<AgentFile>) -> Task<AgentResult<usize>> {
        start(
            &self.0.runtime,
            self.0.reference_drafts.stage_external_files(files),
        )
    }

    pub fn remove_reference(&self, id: &str) {
        self.0.reference_drafts.remove(id);
    }

    pub fn retry_reference(&self, id: &str) {
        self.0.reference_drafts.retry(id);
    }

    pub fn append_dropped_text(&self, text: &str) {
        self.0.append_dropped_text(text);
    }

    pub fn remember_viewport(
        &self,
        scroll_top: f64,
        measurements: Vec<(String, f64)>,
        pinned: bool,
        geometry: Option<AgentViewportGeometry>,
    ) {
        self.0.write_current_session_ui(SessionUiPatch {
            scroll_top: Some(scroll_top),
            measurements: Some(measurements),
            pinned: Some(pinned),
            geometry,
            ..Default::default()
        });
    }

    pub fn read_viewport(&self) -> SessionUiState {
        let key = self.0.ui_key();
        self.0.session_ui.borrow_mut().read(&key)
    }

    pub fn new_session(&self) -> Task<()> {
        self.0.new_session()
    }

    pub fn close_tab_session(&self) -> Task<Value> {
        self.0.close_tab_session()
    }

    /// Closes prepared native ownership before releasing Renderer resources.
    pub fn rollback_preparation(&self) -> Task<AgentResult<()>> {
        let inner = self.0.clone();
        let rollback = inner.session_lifecycle.rollback_preparation();
        start(&self.0.runtime, async move {
            let result = rollback.await;
            inner.dispose(false);
            result
        })
    }

    pub fn prepare_session(&self) -> Task<bool> {
        self.0.session_preparer.prepare()
    }

    pub fn submit(&self, prompt: &str) -> Task<AgentResult<bool>> {
        start(&self.0.runtime, self.0.submission.submit(prompt))
    }

    pub fn continue_from_recovery(&self, turn_id: &str, prompt: &str) -> Task<AgentResult<bool>> {
        start(
            &self.0.runtime,
            self.0.submission.continue_from_recovery(turn_id, prompt),
        )
    }

    pub fn stop(&self) -> Task<AgentResult<()>> {
        self.0.stop()
    }

    pub fn pause_display_recovery(&self) {
        self.0
            .session_replica
            .pause_recovery(AgentDisplayRecoveryPolicy::Paused);
    }

    pub fn retry_display_recovery(&self) -> Task<()> {
        start(&self.0.runtime, self.0.session_replica.retry_recovery())
    }

    pub fn manage_executions(&self) -> Option<Task<AgentResult<Value>>> {
        let bridge = (self.0.bridge_provider)()?;
        if !bridge.implements("manageAgentExecutions") {
            return None;
        }
        Some(start(
            &self.0.runtime,
            bridge.call("manageAgentExecutions", Value::Null),
        ))
    }

    pub fn resolve_approval(&self, decision: Value) -> Task<AgentResult<()>> {
        self.0.resolve_interaction(
            "approvals",
            "resolveAgentApproval",
            "approval",
            json!({ "decision": decision }),
        )
    }

    /// `resolveQuestion(resolution)`: the resolution without its routing
    /// fields.
    pub fn resolve_question(&self, resolution: Value) -> Task<AgentResult<()>> {
        self.0
            .resolve_interaction("questions", "resolveAgentQuestion", "question", resolution)
    }

    pub fn compact_session(&self) -> Task<()> {
        start(&self.0.runtime, self.0.session_lifecycle.compact_session())
    }
}

impl Inner {
    fn task_id(&self) -> u64 {
        let id = self.next_task.get() + 1;
        self.next_task.set(id);
        id
    }

    fn patch(&self, patch: StatePatch) {
        self.store.patch(patch);
    }

    fn read<R>(&self, read: impl FnOnce(&AgentControllerState) -> R) -> R {
        self.store.read(read)
    }

    fn dispose(&self, preserve_draft: bool) {
        if self.disposed.get() {
            return;
        }
        self.disposed.set(true);
        self.stop_scope.cancel();
        self.submission.dispose();
        self.session_preparer.dispose();
        self.session_replica.dispose();
        self.local_connection_loader.dispose();
        self.session_ui.borrow_mut().clear();
        if !preserve_draft {
            let references = self.read(|state| {
                let mut references = state.references.clone();
                references.extend(pending_references(state));
                references
            });
            detach(&self.runtime, self.reference_drafts.revoke(references));
        }
        self.reference_drafts.dispose_renderer_resources();
        self.store.dispose();
    }

    fn initialize_runtime(
        self: &Rc<Self>,
        refresh: bool,
        restore_latest: bool,
    ) -> Task<AgentResult<()>> {
        if let Some((_, task)) = self.initialize_promise.borrow().as_ref() {
            return task.clone();
        }
        if restore_latest
            && !refresh
            && self.read(|state| {
                has_fresh_agent_runtime_inspection(
                    state,
                    self.last_inspection_at.get(),
                    self.runtime.now_ms(),
                )
            })
        {
            return resolved(Ok(()));
        }
        let run = self.run_initialize(refresh, restore_latest);
        let id = self.task_id();
        let inner = self.clone();
        let task = unstarted(async move {
            let result = run.await;
            let current = inner
                .initialize_promise
                .borrow()
                .as_ref()
                .is_some_and(|(task, _)| *task == id);
            if current {
                *inner.initialize_promise.borrow_mut() = None;
            }
            result
        });
        *self.initialize_promise.borrow_mut() = Some((id, task.clone()));
        launch(&self.runtime, &task);
        task
    }

    fn initialize_for_runtime(self: &Rc<Self>, runtime_id: &str) -> Task<AgentResult<bool>> {
        if runtime_id.is_empty() {
            return resolved(Ok(false));
        }
        let inner = self.clone();
        let runtime_id = runtime_id.to_string();
        let pending = self
            .initialize_promise
            .borrow()
            .as_ref()
            .map(|(_, task)| task.clone());
        start(&self.runtime, async move {
            if let Some(pending) = pending {
                pending.await?;
            }
            let (bound, selected) = inner.read(|state| {
                (
                    state.initialized || state.inspection.is_some() || state.session.is_some(),
                    state.selected_runtime_id.as_deref() == Some(runtime_id.as_str()),
                )
            });
            if bound {
                if selected {
                    return Ok(true);
                }
                return Ok(inner.select_runtime(&runtime_id).await);
            }
            inner.patch(StatePatch::new().selected_runtime_id(Some(runtime_id.clone())));
            inner.initialize_runtime(false, false).await?;
            Ok(inner.read(|state| {
                state
                    .inspection
                    .as_ref()
                    .is_some_and(|i| i["selectedRuntimeId"] == runtime_id.as_str())
            }))
        })
    }

    fn refresh_model_connections(self: &Rc<Self>) -> Task<()> {
        let blocked = self.read(|state| {
            !state.capability("modelConnections")
                || state.running_turn_id().is_some()
                || state.submitting
        });
        if blocked {
            return resolved(());
        }
        let (runtime_id, session_id) = self.read(|state| {
            (
                state.selected_runtime_id.clone(),
                state.session_id().map(str::to_string),
            )
        });
        let epoch = self.model_catalog_epoch.get() + 1;
        self.model_catalog_epoch.set(epoch);
        let inner = self.clone();
        // Main invalidates inspection when connection state changes. Keep the
        // executable discovery cache: a wallet update is not a CLI reinstall.
        let call = require_bridge(&self.bridge_provider, &["discoverAgentRuntimes"]).map(|bridge| {
            bridge.call(
                "discoverAgentRuntimes",
                json!({ "rootPath": self.workspace_root, "runtimeId": runtime_id, "refresh": false }),
            )
        });
        start(&self.runtime, async move {
            let inspection = match call {
                Ok(call) => call.await,
                Err(error) => Err(error),
            };
            let inspection = match inspection {
                Ok(inspection) => inspection,
                Err(error) => {
                    if !inner.disposed.get() && epoch == inner.model_catalog_epoch.get() {
                        inner.patch(StatePatch::new().error(Some(format_agent_error(&error))));
                    }
                    return;
                }
            };
            let stale = inner.read(|state| {
                state.selected_runtime_id != runtime_id
                    || state.session_id().map(str::to_string) != session_id
            });
            if inner.disposed.get() || epoch != inner.model_catalog_epoch.get() || stale {
                return;
            }
            let (previous, bound_connection, selected_model) = inner.read(|state| {
                (
                    state.inspection.clone(),
                    agent_provider_id_for_model(
                        state.session.as_ref().map(|s| &s["selectedModel"]),
                    ),
                    state.selected_model.clone(),
                )
            });
            // The native snapshot owns the Worker's immutable model
            // configuration. A transient empty catalog must not erase that
            // binding: intersect the current catalog with native model IDs,
            // never the previous UI catalog.
            let all_models = inspection["models"].as_array().cloned().unwrap_or_default();
            let models: Vec<Value> = if session_id.is_some() {
                all_models
                    .into_iter()
                    .filter(|model| {
                        agent_provider_id_for_model(Some(model)) != bound_connection
                            || inner
                                .store
                                .has_session_model(model["model"].as_str().unwrap_or_default())
                    })
                    .collect()
            } else {
                all_models
            };
            let mut next = inspection.clone();
            next["models"] = Value::Array(models);
            if js::truthy(&inspection["capabilities"]) {
                if previous
                    .as_ref()
                    .is_some_and(|p| js::truthy(&p["capabilities"]["readOnly"]))
                {
                    next["capabilities"]["readOnly"] = Value::Bool(true);
                }
            } else {
                match previous.as_ref().and_then(|p| p.get("capabilities")) {
                    Some(capabilities) => next["capabilities"] = capabilities.clone(),
                    None => js::delete(&mut next, "capabilities"),
                }
            }
            let selected = choose_agent_model(Some(&inspection), selected_model.as_deref(), None);
            inner.patch(
                StatePatch::new()
                    .inspection(Some(next))
                    .selected_model(selected),
            );
        })
    }

    fn select_runtime(self: &Rc<Self>, runtime_id: &str) -> Task<bool> {
        let Some(plan) = self.read(|state| plan_agent_runtime_switch(state, runtime_id)) else {
            return resolved(false);
        };
        if plan.already_selected {
            return resolved(true);
        }
        self.submission.invalidate();
        let references = self.read(|state| state.references.clone());
        let rotate = self.reference_drafts.rotate(references);
        let inner = self.clone();
        let runtime_id = runtime_id.to_string();
        start(&self.runtime, async move {
            rotate.await;
            inner.patch(plan.patch);
            let result: AgentResult<bool> = async {
                if let Some(session_id) = plan.session_id {
                    let bridge = require_bridge(&inner.bridge_provider, &["closeAgentSession"])?;
                    bridge
                        .call(
                            "closeAgentSession",
                            json!({ "rootPath": inner.workspace_root, "sessionId": session_id, "removePersistence": false }),
                        )
                        .await?;
                    inner.session_ui.borrow_mut().delete(&session_id);
                }
                // A runtime switch means "new chat". Native history is resumed
                // only through openSavedSession(), never as an implicit side
                // effect here.
                inner.initialize_runtime(false, false).await?;
                Ok(inner.read(|state| state.selected_runtime_id.as_deref() == Some(runtime_id.as_str())))
            }
            .await;
            result.unwrap_or_else(|error| {
                inner.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::Failed)
                        .error(Some(format_agent_error(&error))),
                );
                false
            })
        })
    }

    fn open_saved_session(
        self: &Rc<Self>,
        session_id: &str,
        runtime_id: &str,
    ) -> Task<AgentResult<bool>> {
        if self.read(|state| state.running_turn_id().is_some()) {
            self.patch(StatePatch::new().error(Some(create_agent_error("active-turn", None))));
            return resolved(Ok(false));
        }
        let pending = self.read(pending_references);
        self.submission.invalidate();
        self.session_replica.connect();
        let bridge = match require_bridge(
            &self.bridge_provider,
            &["discoverAgentRuntimes", "openAgentSession"],
        ) {
            Ok(bridge) => bridge,
            Err(error) => return resolved(Err(error)),
        };
        let references = self.read(|state| {
            let mut references = state.references.clone();
            references.extend(pending);
            references
        });
        let reset = self.reference_drafts.reset(references);
        let inner = self.clone();
        let session_id = session_id.to_string();
        let runtime_id = runtime_id.to_string();
        start(&self.runtime, async move {
            reset.await;
            if let Some(current) = inner.read(|state| state.session_id().map(str::to_string)) {
                let bridge = require_bridge(&inner.bridge_provider, &["closeAgentSession"])?;
                bridge
                    .call(
                        "closeAgentSession",
                        json!({ "rootPath": inner.workspace_root, "sessionId": current, "removePersistence": false }),
                    )
                    .await?;
            }
            inner.patch(
                StatePatch::new()
                    .phase(AgentControllerPhase::Discovering)
                    .session(None)
                    .projection(create_empty_agent_display())
                    .selected_runtime_id(Some(runtime_id.clone()))
                    .error(None)
                    .references(Vec::new())
                    .session_preparation(AgentSessionPreparation::Preparing),
            );
            let result: AgentResult<bool> = async {
                let inspection = bridge
                    .call(
                        "discoverAgentRuntimes",
                        json!({ "rootPath": inner.workspace_root, "runtimeId": runtime_id, "refresh": false }),
                    )
                    .await?;
                let selected_model = choose_agent_model(Some(&inspection), None, None);
                let entry = find_model(Some(&inspection), selected_model.as_deref());
                inner.patch(
                    StatePatch::new()
                        .selected_runtime_id(inspection["selectedRuntimeId"].as_str().map(str::to_string))
                        .selected_provider_id(
                            agent_provider_id_for_model(entry.as_ref())
                                .or_else(|| choose_agent_provider(Some(&inspection), None, selected_model.as_deref())),
                        )
                        .selected_effort(choose_agent_effort(entry.as_ref(), None))
                        .selected_mode(choose_agent_mode(Some(&inspection), None))
                        .selected_model(selected_model)
                        .inspection(Some(inspection))
                        .initialized(true)
                        .phase(AgentControllerPhase::Restoring),
                );
                let result = bridge
                    .call(
                        "openAgentSession",
                        json!({ "rootPath": inner.workspace_root, "sessionId": session_id, "runtimeId": runtime_id }),
                    )
                    .await?;
                if result["status"] == "failed" {
                    return Err(agent_session_open_error(&result["error"]));
                }
                let snapshot = result["snapshot"].clone();
                let running = js::truthy(&snapshot["session"]["activeTurnId"]);
                inner.apply_snapshot(snapshot).await?;
                inner.patch(
                    StatePatch::new()
                        .phase(if running { AgentControllerPhase::Running } else { AgentControllerPhase::Ready })
                        .session_preparation(AgentSessionPreparation::Ready),
                );
                Ok(true)
            }
            .await;
            if let Err(error) = &result {
                inner.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::Failed)
                        .error(Some(format_agent_error(error)))
                        .session_preparation(AgentSessionPreparation::Failed),
                );
            }
            result
        })
    }

    fn run_initialize(
        self: &Rc<Self>,
        refresh: bool,
        restore_latest: bool,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        self.session_replica.connect();
        let methods: &[&str] = if restore_latest {
            &["discoverAgentRuntimes", "resumeAgentSession"]
        } else {
            &["discoverAgentRuntimes"]
        };
        let bridge = match require_bridge(&self.bridge_provider, methods) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        self.patch(
            StatePatch::new()
                .phase(AgentControllerPhase::Discovering)
                .error(None),
        );
        let discover = bridge.call(
            "discoverAgentRuntimes",
            json!({
                "rootPath": self.workspace_root,
                "runtimeId": self.read(|state| state.selected_runtime_id.clone()),
                "refresh": refresh,
            }),
        );
        let inner = self.clone();
        Box::pin(async move {
            let result: AgentResult<()> = async {
                let inspection = discover.await?;
                inner.last_inspection_at.set(inner.runtime.now_ms());
                let runtime_id = inspection["selectedRuntimeId"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .map(str::to_string);
                let (model, provider, mode, effort) = inner.read(|state| {
                    (
                        state.selected_model.clone(),
                        state.selected_provider_id.clone(),
                        state.selected_mode.clone(),
                        state.selected_effort.clone(),
                    )
                });
                let selected_model = choose_agent_model(Some(&inspection), model.as_deref(), None);
                let entry = find_model(Some(&inspection), selected_model.as_deref());
                let selected_provider_id = agent_provider_id_for_model(entry.as_ref())
                    .or_else(|| choose_agent_provider(Some(&inspection), provider.as_deref(), selected_model.as_deref()));
                let selected_mode = choose_agent_mode(Some(&inspection), mode.as_deref());
                let selected_effort = choose_agent_effort(entry.as_ref(), effort.as_deref());
                let ready = inspection["readiness"]["status"] == "ready";
                inner.patch(
                    StatePatch::new()
                        .inspection(Some(inspection))
                        .selected_runtime_id(runtime_id.clone())
                        .selected_provider_id(selected_provider_id)
                        .selected_model(selected_model)
                        .selected_effort(selected_effort)
                        .selected_mode(selected_mode)
                        .initialized(true),
                );
                let Some(runtime_id) = runtime_id.filter(|_| ready && restore_latest) else {
                    inner.patch(
                        StatePatch::new()
                            .phase(AgentControllerPhase::Ready)
                            .session_preparation(AgentSessionPreparation::Idle),
                    );
                    return Ok(());
                };
                inner.patch(StatePatch::new().phase(AgentControllerPhase::Restoring));
                let session_id = inner.read(|state| state.session_id().map(str::to_string));
                let mut request = json!({ "rootPath": inner.workspace_root, "runtimeId": runtime_id });
                if let Some(session_id) = &session_id {
                    request["sessionId"] = Value::from(session_id.as_str());
                }
                let restored = bridge.call("resumeAgentSession", request).await?;
                let restored = Some(restored).filter(js::truthy);
                if session_id.is_some() && restored.is_none() {
                    return Err(AgentError::new(
                        "This Agent conversation is no longer available. Start a new conversation to continue.",
                    ));
                }
                let running = restored
                    .as_ref()
                    .is_some_and(|r| js::truthy(&r["session"]["activeTurnId"]));
                let has_restored = restored.is_some();
                if let Some(restored) = restored {
                    inner.apply_snapshot(restored).await?;
                }
                inner.patch(
                    StatePatch::new()
                        .phase(if running { AgentControllerPhase::Running } else { AgentControllerPhase::Ready })
                        .session_preparation(if has_restored {
                            AgentSessionPreparation::Ready
                        } else {
                            AgentSessionPreparation::Idle
                        }),
                );
                Ok(())
            }
            .await;
            if let Err(error) = result {
                inner.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::Failed)
                        .error(Some(format_agent_error(&error)))
                        .initialized(true)
                        .session_preparation(AgentSessionPreparation::Failed),
                );
            }
            Ok(())
        })
    }

    fn select_provider(&self, provider_id: Option<&str>) -> Option<String> {
        let state = self.store.snapshot();
        if state.running_turn_id().is_some()
            || state
                .pending_prompt
                .as_deref()
                .is_some_and(|p| !p.is_empty())
        {
            return state.selected_model;
        }
        if state.session.is_some()
            && state.capability("modelConnections")
            && provider_id.map(str::to_string)
                != agent_provider_id_for_model(state.session.as_ref().map(|s| &s["selectedModel"]))
        {
            return state.selected_model;
        }
        let selected_provider_id = provider_id
            .filter(|id| !id.is_empty())
            .filter(|id| {
                list_agent_inference_providers(state.inspection.as_ref())
                    .iter()
                    .any(|provider| provider["id"] == *id)
            })
            .map(str::to_string);
        let selected_model = choose_agent_model(
            state.inspection.as_ref(),
            None,
            selected_provider_id.as_deref(),
        );
        let entry = find_model(state.inspection.as_ref(), selected_model.as_deref());
        let invalidated = (selected_provider_id != state.selected_provider_id
            || selected_model != state.selected_model)
            && self.session_preparer.invalidate_selection();
        let mut patch = StatePatch::new()
            .selected_provider_id(selected_provider_id)
            .selected_model(selected_model.clone())
            .selected_effort(choose_agent_effort(entry.as_ref(), None))
            .error(None);
        if invalidated {
            patch = patch.session_preparation(AgentSessionPreparation::Idle);
        }
        self.patch(patch);
        selected_model
    }

    fn select_model(&self, model: Option<&str>) {
        let state = self.store.snapshot();
        if state.running_turn_id().is_some()
            || state
                .pending_prompt
                .as_deref()
                .is_some_and(|p| !p.is_empty())
        {
            return;
        }
        let entry = model
            .filter(|m| !m.is_empty())
            .and_then(|model| find_model(state.inspection.as_ref(), Some(model)));
        let selected_model = entry
            .as_ref()
            .and_then(|e| e["model"].as_str())
            .map(str::to_string);
        if self.requires_new_model_connection_session(model) {
            return;
        }
        let preserve_effort = if selected_model == state.selected_model {
            state.selected_effort.clone()
        } else {
            None
        };
        let selected_effort = choose_agent_effort(entry.as_ref(), preserve_effort.as_deref());
        let invalidated = (selected_model != state.selected_model
            || selected_effort != state.selected_effort)
            && self.session_preparer.invalidate_selection();
        let provider = match entry.as_ref() {
            Some(entry) => agent_provider_id_for_model(Some(entry)),
            None => state.selected_provider_id.clone(),
        };
        let mut patch = StatePatch::new()
            .selected_provider_id(provider)
            .selected_model(selected_model)
            .selected_effort(selected_effort)
            .error(None);
        if invalidated {
            patch = patch.session_preparation(AgentSessionPreparation::Idle);
        }
        self.patch(patch);
    }

    fn requires_new_model_connection_session(&self, model: Option<&str>) -> bool {
        self.read(|state| {
            let Some(model) = model.filter(|m| !m.is_empty()) else {
                return false;
            };
            if state.session.is_none() || !state.capability("modelConnections") {
                return false;
            }
            let session_model = state
                .session
                .as_ref()
                .map(|s| s["selectedModel"].clone())
                .filter(|m| !m.is_null())
                .or_else(|| state.selected_model.clone().map(Value::from));
            agent_provider_id_for_model(session_model.as_ref())
                != agent_provider_id_for_model(Some(&Value::from(model)))
        })
    }

    fn start_new_model_connection(self: &Rc<Self>, model: &str) -> Task<()> {
        let state = self.store.snapshot();
        if state.running_turn_id().is_some()
            || state
                .pending_prompt
                .as_deref()
                .is_some_and(|p| !p.is_empty())
            || state.submitting
        {
            return resolved(());
        }
        let Some(connection_id) =
            find_model(state.inspection.as_ref(), Some(model)).and_then(|entry| {
                entry["connectionId"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .map(str::to_string)
            })
        else {
            return resolved(());
        };
        // This is called only after the explicit new-conversation
        // confirmation.
        let previous_session_id = state.session_id().map(str::to_string);
        self.patch(
            StatePatch::new()
                .selected_model(Some(model.to_string()))
                .selected_provider_id(Some(connection_id))
                .selected_effort(None)
                .draft(String::new())
                .draft_mentions(Vec::new())
                .submitting(true),
        );
        let new_session = self.new_session();
        let inner = self.clone();
        start(&self.runtime, async move {
            new_session.await;
            if previous_session_id.is_some()
                && inner.read(|state| state.session_id().map(str::to_string)) == previous_session_id
            {
                inner.patch(
                    StatePatch::new()
                        .selected_model(state.selected_model.clone())
                        .selected_provider_id(state.selected_provider_id.clone())
                        .selected_effort(state.selected_effort.clone()),
                );
            }
            inner.patch(StatePatch::new().submitting(false));
        })
    }

    fn select_effort(&self, effort: Option<&str>) {
        let state = self.store.snapshot();
        if state.running_turn_id().is_some()
            || state
                .pending_prompt
                .as_deref()
                .is_some_and(|p| !p.is_empty())
        {
            return;
        }
        let entry = find_model(state.inspection.as_ref(), state.selected_model.as_deref());
        let selected_effort = choose_agent_effort(entry.as_ref(), effort);
        let invalidated = selected_effort != state.selected_effort
            && self.session_preparer.invalidate_selection();
        let mut patch = StatePatch::new()
            .selected_effort(selected_effort)
            .error(None);
        if invalidated {
            patch = patch.session_preparation(AgentSessionPreparation::Idle);
        }
        self.patch(patch);
    }

    fn select_mode(&self, mode: Option<&str>) {
        let state = self.store.snapshot();
        if state.running_turn_id().is_some()
            || state
                .pending_prompt
                .as_deref()
                .is_some_and(|p| !p.is_empty())
        {
            return;
        }
        let selected_mode = choose_agent_mode(state.inspection.as_ref(), mode);
        let invalidated =
            selected_mode != state.selected_mode && self.session_preparer.invalidate_selection();
        let mut patch = StatePatch::new().selected_mode(selected_mode);
        if invalidated {
            patch = patch.session_preparation(AgentSessionPreparation::Idle);
        }
        self.patch(patch);
    }

    fn set_draft_document(&self, draft: &str, draft_mentions: &[Value]) {
        let mentions = draft_mentions.to_vec();
        self.patch(
            StatePatch::new()
                .draft(draft.to_string())
                .draft_mentions(mentions.clone()),
        );
        self.write_current_session_ui(SessionUiPatch {
            draft: Some(draft.to_string()),
            draft_mentions: Some(mentions),
            ..Default::default()
        });
    }

    fn append_dropped_text(&self, text: &str) {
        let value = js::trim(text);
        if value.is_empty() {
            return;
        }
        let (draft, mentions) = self.read(|state| {
            let draft = if state.draft.is_empty() {
                value.to_string()
            } else {
                format!("{}\n{value}", state.draft)
            };
            (draft, state.draft_mentions.clone())
        });
        self.set_draft_document(&draft, &mentions);
    }

    fn new_session(self: &Rc<Self>) -> Task<()> {
        if self.read(|state| state.running_turn_id().is_some()) {
            return start(&self.runtime, self.session_lifecycle.new_session());
        }
        let pending = self.read(pending_references);
        self.submission.invalidate();
        let references = self.read(|state| {
            let mut references = state.references.clone();
            references.extend(pending);
            references
        });
        let reset = self.reference_drafts.reset(references);
        let inner = self.clone();
        start(&self.runtime, async move {
            reset.await;
            inner.session_lifecycle.new_session().await;
        })
    }

    fn close_tab_session(self: &Rc<Self>) -> Task<Value> {
        self.stop_scope.cancel();
        self.submission.invalidate();
        self.session_preparer.dispose();
        self.session_replica.stop_for_termination();
        let close = self.session_lifecycle.close_session();
        let inner = self.clone();
        start(&self.runtime, async move {
            let closed = close.await;
            if !js::truthy(&closed) {
                return closed;
            }
            let pending = inner.read(pending_references);
            inner.submission.invalidate();
            let references = inner.read(|state| {
                let mut references = state.references.clone();
                references.extend(pending);
                references
            });
            detach(&inner.runtime, inner.reference_drafts.reset(references));
            closed
        })
    }

    fn stop(self: &Rc<Self>) -> Task<AgentResult<()>> {
        let state = self.store.snapshot();
        let (Some(session_id), Some(turn_id)) = (
            state.session_id().map(str::to_string),
            state.running_turn_id().map(str::to_string),
        ) else {
            return resolved(Ok(()));
        };
        if state
            .stop_request
            .as_ref()
            .is_some_and(|request| request.status == StopRequestStatus::Sending)
        {
            return resolved(Ok(()));
        }
        let bridge = match require_bridge(&self.bridge_provider, &["interruptAgentTurn"]) {
            Ok(bridge) => bridge,
            Err(error) => return resolved(Err(error)),
        };
        let instance_id = state.session_instance_id().map(str::to_string);
        let reuse = self.stop_intent.borrow().as_ref().is_some_and(|intent| {
            intent["sessionId"] == session_id.as_str()
                && intent["turnId"] == turn_id.as_str()
                && intent["instanceId"].as_str() == instance_id.as_deref()
        });
        if !reuse {
            let mut intent = json!({
                "rootPath": self.workspace_root,
                "sessionId": session_id,
                "turnId": turn_id,
                "commandId": control_command_id("interrupt"),
            });
            if let Some(instance_id) = &instance_id {
                intent["instanceId"] = Value::from(instance_id.as_str());
            }
            spread(&mut intent, &command_preconditions(&state));
            *self.stop_intent.borrow_mut() = Some(intent);
        }
        let intent = self.stop_intent.borrow().clone().unwrap_or(Value::Null);
        let request = Rc::new(StopRequest {
            command_id: js::string_or_empty(intent.get("commandId")),
            session_id,
            instance_id,
            turn_id,
            status: StopRequestStatus::Sending,
        });
        self.patch(
            StatePatch::new()
                .stop_request(Some(request.clone()))
                .stopping(true)
                .error(None),
        );
        let call = bridge.call("interruptAgentTurn", intent);
        let signal = self.stop_scope.signal();
        let inner = self.clone();
        start(&self.runtime, async move {
            let receipt = wait_for_scoped_operation(&inner.runtime, call, &signal, 5000).await;
            let current = inner.read(|state| {
                state
                    .stop_request
                    .as_ref()
                    .is_some_and(|current| Rc::ptr_eq(current, &request))
            });
            if !current {
                return Ok(());
            }
            let settled = |status| {
                Rc::new(StopRequest {
                    status,
                    ..(*request).clone()
                })
            };
            match receipt {
                Ok(receipt) => {
                    let status = if js::truthy(&receipt["interruptRequested"]) {
                        StopRequestStatus::Accepted
                    } else {
                        StopRequestStatus::Unconfirmed
                    };
                    inner.patch(
                        StatePatch::new()
                            .stopping(false)
                            .stop_request(Some(settled(status))),
                    );
                }
                Err(error) => inner.patch(
                    StatePatch::new()
                        .stopping(false)
                        .stop_request(Some(settled(StopRequestStatus::Unconfirmed)))
                        .error(Some(format_agent_error(&error))),
                ),
            }
            Ok(())
        })
    }

    /// `resolveApproval(decision)` and `resolveQuestion(resolution)`.
    fn resolve_interaction(
        self: &Rc<Self>,
        collection: &str,
        method: &str,
        kind: &str,
        resolution: Value,
    ) -> Task<AgentResult<()>> {
        let state = self.store.snapshot();
        let Some(pending) = state.projection.collection(collection).first().cloned() else {
            return resolved(Ok(()));
        };
        let Some(session_id) = state.session_id().map(str::to_string) else {
            return resolved(Ok(()));
        };
        let bridge = match require_bridge(&self.bridge_provider, &[method]) {
            Ok(bridge) => bridge,
            Err(error) => return resolved(Err(error)),
        };
        self.patch(StatePatch::new().error(None));
        let mut request = if kind == "question" {
            resolution.clone()
        } else {
            json!({})
        };
        if !request.is_object() {
            request = json!({});
        }
        request["rootPath"] = Value::from(self.workspace_root.as_str());
        request["sessionId"] = Value::from(session_id);
        request["turnId"] = pending["turnId"].clone();
        request["requestId"] = pending["requestId"].clone();
        request["commandId"] = Value::from(control_command_id(kind));
        spread(&mut request, &command_preconditions(&state));
        if kind == "approval" {
            request["decision"] = resolution["decision"].clone();
        }
        let call = bridge.call(method, request);
        let inner = self.clone();
        start(&self.runtime, async move {
            if let Err(error) = call.await {
                inner.patch(StatePatch::new().error(Some(format_agent_error(&error))));
                inner.session_replica.repair_from(None).await;
            }
            Ok(())
        })
    }

    fn create_session(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let bridge = match require_bridge(&self.bridge_provider, &["createAgentSession"]) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let request = self.read(|state| {
            json!({
                "rootPath": self.workspace_root,
                "runtimeId": state.selected_runtime_id,
                "model": state.selected_model,
                "effort": state.selected_effort,
                "mode": state.selected_mode,
            })
        });
        bridge.call("createAgentSession", request)
    }

    /// Restores a settled native connection only when the user sends the
    /// next command.
    fn reconnect_idle_session(self: &Rc<Self>) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let current = self.store.snapshot();
        let session_id = current.session_id().map(str::to_string);
        let runtime_id = current
            .session
            .as_ref()
            .and_then(|s| s["runtimeId"].as_str())
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .or(current.selected_runtime_id.clone());
        let (Some(session_id), Some(runtime_id)) = (session_id, runtime_id) else {
            return Box::pin(async { Ok(false) });
        };
        let control = current.control.clone().unwrap_or(Value::Null);
        if control["connection"]["status"] != "exited" {
            return Box::pin(async { Ok(true) });
        }
        if control["connection"]["reason"] != AGENT_IDLE_DISCONNECT_REASON
            || control["execution"]["certainty"] != "confirmed"
            || js::truthy(&control["execution"]["activeTurnId"])
            || js::truthy(&control["execution"]["uncertainTurnId"])
        {
            return Box::pin(async { Ok(false) });
        }
        let bridge = match require_bridge(&self.bridge_provider, &["resumeAgentSession"]) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        self.patch(
            StatePatch::new()
                .phase(AgentControllerPhase::Restoring)
                .error(None)
                .session_preparation(AgentSessionPreparation::Preparing),
        );
        let call = bridge.call(
            "resumeAgentSession",
            json!({ "rootPath": self.workspace_root, "runtimeId": runtime_id, "sessionId": session_id }),
        );
        let inner = self.clone();
        Box::pin(async move {
            let result: AgentResult<bool> = async {
                let restored = Some(call.await?).filter(js::truthy).ok_or_else(|| {
                    AgentError::new(
                        "This Agent conversation is no longer available. Start a new conversation to continue.",
                    )
                })?;
                let running = js::truthy(&restored["session"]["activeTurnId"]);
                inner.apply_snapshot(restored).await?;
                inner.patch(
                    StatePatch::new()
                        .phase(if running { AgentControllerPhase::Running } else { AgentControllerPhase::Ready })
                        .session_preparation(AgentSessionPreparation::Ready),
                );
                Ok(true)
            }
            .await;
            if let Err(error) = &result {
                inner.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::Failed)
                        .error(Some(format_agent_error(error)))
                        .session_preparation(AgentSessionPreparation::Failed),
                );
            }
            result
        })
    }

    fn apply_snapshot(
        self: &Rc<Self>,
        snapshot: Value,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        if let Err(error) = self.apply_snapshot_state(&snapshot) {
            return Box::pin(async move { Err(error) });
        }
        let session_id = js::string_or_empty(snapshot["session"].get("id"));
        let feed = self.session_replica.attach_session(&session_id);
        let inner = self.clone();
        Box::pin(async move {
            let feed_snapshot = match feed.await {
                Ok(feed_snapshot) => feed_snapshot,
                // A transient display-feed failure must not turn a healthy
                // native task into a failed session. The replica owns bounded
                // background recovery.
                Err(error) if known_error_code(&error) == Some("event-gap") => return Ok(()),
                Err(error) => return Err(error),
            };
            let Some(feed_snapshot) = feed_snapshot else {
                return Ok(());
            };
            if inner.disposed.get()
                || inner.read(|state| state.session_id() != Some(session_id.as_str()))
            {
                return Ok(());
            }
            inner.apply_snapshot_state(&feed_snapshot)?;
            inner
                .session_replica
                .activate_session_feed(&session_id)
                .await;
            Ok(())
        })
    }

    fn apply_snapshot_state(&self, snapshot: &Value) -> AgentResult<()> {
        assert_agent_session_snapshot(snapshot)?;
        let projection = AgentDisplay::from_value(&snapshot["display"])?;
        let models = snapshot["models"].as_array().cloned().unwrap_or_default();
        self.store.set_session_model_ids(
            models
                .iter()
                .filter_map(|model| model["model"].as_str().map(str::to_string))
                .collect::<HashSet<_>>(),
        );
        let state = self.store.snapshot();
        let session = &snapshot["session"];
        let inspection = state.inspection.as_ref().map(|current| {
            let mut inspection = current.clone();
            let nullish = |value: &Value| value.is_null();
            let runtime = [
                &snapshot["runtime"],
                &session["runtime"],
                &current["runtime"],
            ]
            .into_iter()
            .find(|value| !nullish(value))
            .cloned();
            match runtime {
                Some(runtime) => inspection["runtime"] = runtime,
                None => js::delete(&mut inspection, "runtime"),
            }
            match snapshot.get("account") {
                Some(account) => inspection["account"] = account.clone(),
                None => js::delete(&mut inspection, "account"),
            }
            for key in ["providers", "modes", "commands"] {
                inspection[key] = [&snapshot[key], &current[key]]
                    .into_iter()
                    .find(|value| !nullish(value))
                    .cloned()
                    .unwrap_or_else(|| json!([]));
            }
            inspection["models"] = Value::Array(models.clone());
            match snapshot.get("capabilities") {
                Some(capabilities) => inspection["capabilities"] = capabilities.clone(),
                None => js::delete(&mut inspection, "capabilities"),
            }
            inspection
        });
        let truthy_str =
            |value: &Value| value.as_str().filter(|v| !v.is_empty()).map(str::to_string);
        let requested_model = truthy_str(&session["selectedModel"])
            .or(state.selected_model.clone())
            .or_else(|| choose_agent_model(inspection.as_ref(), None, None));
        let selected_model =
            choose_agent_model(inspection.as_ref(), requested_model.as_deref(), None);
        let entry = find_model(inspection.as_ref(), selected_model.as_deref());
        let selected_provider_id = agent_provider_id_for_model(entry.as_ref()).or_else(|| {
            choose_agent_provider(
                inspection.as_ref(),
                state.selected_provider_id.as_deref(),
                selected_model.as_deref(),
            )
        });
        let selected_effort = choose_agent_effort(
            entry.as_ref(),
            truthy_str(&session["selectedEffort"])
                .or(state.selected_effort.clone())
                .as_deref(),
        );
        let selected_mode = truthy_str(&session["selectedMode"])
            .or(state.selected_mode.clone())
            .or_else(|| choose_agent_mode(inspection.as_ref(), None));
        let selected_runtime_id = truthy_str(&session["runtimeId"])
            .or_else(|| truthy_str(&session["provider"]))
            .or(state.selected_runtime_id.clone());
        self.patch(
            StatePatch::new()
                .session(Some(session.clone()))
                .control(Some(snapshot["control"].clone()).filter(|c| !c.is_null()))
                .replica_status(if js::truthy(&snapshot["cursor"]) {
                    ReplicaStatus::Subscribing
                } else {
                    ReplicaStatus::Detached
                })
                .inspection(inspection)
                .selected_runtime_id(selected_runtime_id)
                .selected_provider_id(selected_provider_id)
                .selected_model(selected_model)
                .selected_effort(selected_effort)
                .selected_mode(selected_mode)
                .projection(projection)
                .stopping(false)
                .session_preparation(AgentSessionPreparation::Ready),
        );
        Ok(())
    }

    fn ui_key(&self) -> String {
        self.read(|state| {
            state
                .session_id()
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}:new", self.workspace_root))
        })
    }

    fn write_current_session_ui(&self, value: SessionUiPatch) {
        let key = self.ui_key();
        self.session_ui.borrow_mut().patch(&key, value);
    }
}

/// `state.pendingIntent?.references ?? []`.
fn pending_references(state: &AgentControllerState) -> Vec<Value> {
    state
        .pending_intent
        .as_ref()
        .and_then(|intent| intent["references"].as_array().cloned())
        .unwrap_or_default()
}

/// `inspection?.models.find((model) => model.model === selected)`.
fn find_model(inspection: Option<&Value>, selected: Option<&str>) -> Option<Value> {
    let selected = selected?;
    inspection?["models"]
        .as_array()?
        .iter()
        .find(|model| model["model"] == selected)
        .cloned()
}

/// `{ ...request, ...extra }`.
fn spread(request: &mut Value, extra: &Value) {
    if let (Some(request), Some(extra)) = (request.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            request.insert(key.clone(), value.clone());
        }
    }
}

/// `controlCommandId(kind)`.
fn control_command_id(kind: &str) -> String {
    format!("{kind}-{}", random_uuid())
}

/// `commandPreconditions(state)`.
pub fn command_preconditions(state: &AgentControllerState) -> Value {
    let Some(control) = state.control.as_ref() else {
        return json!({});
    };
    json!({
        "expectedSessionEpoch": control["sessionEpoch"],
        "expectedAdapterGeneration": control["adapterGeneration"],
        "expectedRunGeneration": control["runGeneration"],
    })
}

//! `application/AgentSessionController.ts`: one Agent tab's Renderer
//! controller over the client port.
//!
//! The product's `async` methods run until their first `await` when
//! called and keep running when nobody awaits them. These methods do the
//! same synchronous work, then return a started [`Task`].
use super::agent_client_port::{AgentClient as _, AgentClientProvider, AgentFile, require_bridge};
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
use super::agent_session_lifecycle::CloseOutcome;
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
use crate::agent::contract::dto::{
    AgentProjection, Capability, DraftReference, Model, PromptMention, Receipt, RuntimeInspection,
    SessionSnapshot,
};
use crate::agent::contract::protocol::{
    AgentOperation, ApprovalDecision, CloseSession, CommandPreconditions, CreateSession,
    InterruptTurn, OpenSession, ResolveApproval, ResolveQuestion, ResumeSession, RuntimeQuery,
};
use crate::features::desktop_agent::domain::agent_provider_routing::{
    agent_provider_id_for_model, agent_provider_id_for_selection, choose_agent_model,
    choose_agent_provider, list_agent_inference_providers,
};
use crate::features::desktop_agent::domain::agent_session_open_error::agent_session_open_error;
use crate::features::desktop_agent::domain::agent_ui_state::AgentViewportGeometry;
use crate::features::session_transport::managed_operation_scope::{
    ManagedOperationScope, wait_for_scoped_operation,
};
use futures_util::FutureExt;
use futures_util::future::LocalBoxFuture;
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

/// `() => Promise<AgentSessionSnapshot>`.
pub type CreateSessionFn = Rc<dyn Fn() -> LocalBoxFuture<'static, AgentResult<SessionSnapshot>>>;
/// `(snapshot) => Promise<void>`.
pub type ApplySnapshot = Rc<dyn Fn(SessionSnapshot) -> LocalBoxFuture<'static, AgentResult<()>>>;

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
    /// A test double's plain `{ ...state, ...patch }` (no phase graph or
    /// derived control state).
    plain: bool,
}

impl AgentControllerStore {
    /// A store whose patches merge plainly, as the product's collaborator
    /// suites patch a bare state object.
    #[cfg(test)]
    pub fn plain(state: AgentControllerState) -> Self {
        Self {
            state: RefCell::new(state),
            plain: true,
            ..Default::default()
        }
    }

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
        if self.plain {
            patch.apply_to(&mut self.state.borrow_mut());
            self.revision.set(self.revision.get() + 1);
            self.emit();
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
    let view = state.projection.presentation.clone();
    let admitted = state
        .pending_intent
        .as_ref()
        .is_some_and(|intent| control.command(&intent.id).is_some());
    let local_pending = match &state.pending_intent {
        Some(intent) if !admitted => Some(intent.prompt.clone()),
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
    ) && let Some(phase) = view
        .as_ref()
        .and_then(|view| AgentControllerPhase::parse(&view.phase))
    {
        state.phase = phase;
    }
    session.active_turn_id = state.projection.running_turn_id.clone();
    session.terminal_state = view.as_ref().map(|view| view.terminal_state.clone());
    state.pending_prompt = view
        .as_ref()
        .and_then(|view| view.pending_prompt.clone())
        .or(local_pending);
    state.submitting =
        view.as_ref().is_some_and(|view| view.submitting) || state.pending_intent.is_some();
    let session_id = Some(session.id.clone());
    let instance_id = session.instance_id.clone();
    let running_turn_id = state.projection.running_turn_id.clone();
    let stopping = state
        .stop_request
        .as_ref()
        .is_some_and(|request| request.status == StopRequestStatus::Sending)
        || (state.replica_status == ReplicaStatus::Live
            && view.as_ref().is_some_and(|view| view.stopping));
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
    pub mentions: Vec<PromptMention>,
    pub references: Vec<DraftReference>,
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
    stop_intent: RefCell<Option<InterruptTurn>>,
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
            let create_session: CreateSessionFn = {
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

    /// `controller === other`.
    pub fn ptr_eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
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
                .filter(|reference| reference.is_ready())
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

    pub fn set_draft_document(&self, draft: &str, draft_mentions: &[PromptMention]) {
        self.0.set_draft_document(draft, draft_mentions);
    }

    pub fn add_workspace_paths(
        &self,
        paths: Vec<String>,
        visual_previews: Vec<(String, AgentReferenceVisualPreview)>,
    ) -> Task<AgentResult<usize>> {
        self.0
            .reference_drafts
            .add_workspace_paths(paths, visual_previews)
    }

    pub fn get_reference_preview_url(&self, id: &str) -> Option<String> {
        self.0.reference_drafts.preview_url(id)
    }

    pub fn capture_reference_acquisition(&self) -> impl Fn() -> bool + 'static {
        self.0.reference_drafts.capture_acquisition()
    }

    pub fn pick_workspace_references(&self) -> Task<AgentResult<usize>> {
        self.0.reference_drafts.pick_workspace_references()
    }

    pub fn add_path_text_or_draft(&self, text: &str) -> Task<AgentResult<bool>> {
        self.0.reference_drafts.add_path_text_or_draft(text)
    }

    pub fn stage_external_files(&self, files: Vec<AgentFile>) -> Task<AgentResult<usize>> {
        self.0.reference_drafts.stage_external_files(files)
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

    pub fn close_tab_session(&self) -> Task<CloseOutcome> {
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

    pub fn manage_executions(&self) -> Option<Task<AgentResult<Receipt>>> {
        let bridge = (self.0.bridge_provider)()?;
        if !bridge.supports(AgentOperation::ManageExecutions) {
            return None;
        }
        Some(start(&self.0.runtime, bridge.manage_executions()))
    }

    pub fn resolve_approval(&self, decision: ApprovalDecision) -> Task<AgentResult<()>> {
        self.0.resolve_interaction(Interaction::Approval(decision))
    }

    /// `resolveQuestion(resolution)`: the resolution without its routing
    /// fields.
    pub fn resolve_question(&self, resolution: QuestionResolution) -> Task<AgentResult<()>> {
        self.0
            .resolve_interaction(Interaction::Question(resolution))
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
                    .is_some_and(|i| i.selected_runtime_id.as_deref() == Some(runtime_id.as_str()))
            }))
        })
    }

    fn refresh_model_connections(self: &Rc<Self>) -> Task<()> {
        let blocked = self.read(|state| {
            !state.capability(Capability::ModelConnections)
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
        let call = require_bridge(&self.bridge_provider, &[AgentOperation::DiscoverRuntimes]).map(
            |bridge| {
                bridge.discover_runtimes(RuntimeQuery {
                    root_path: Some(self.workspace_root.clone()),
                    runtime_id: runtime_id.clone(),
                    refresh: Some(false),
                })
            },
        );
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
                    state
                        .session
                        .as_ref()
                        .and_then(|s| s.selected_model.as_deref())
                        .and_then(agent_provider_id_for_selection),
                    state.selected_model.clone(),
                )
            });
            // The native snapshot owns the Worker's immutable model
            // configuration. A transient empty catalog must not erase that
            // binding: intersect the current catalog with native model IDs,
            // never the previous UI catalog.
            let all_models = inspection.models.clone();
            let models: Vec<Model> = if session_id.is_some() {
                all_models
                    .into_iter()
                    .filter(|model| {
                        agent_provider_id_for_model(model) != bound_connection
                            || inner.store.has_session_model(&model.model)
                    })
                    .collect()
            } else {
                all_models
            };
            let mut next = inspection.clone();
            next.models = models;
            match next.capabilities.as_mut() {
                Some(capabilities) => {
                    if previous
                        .as_ref()
                        .is_some_and(|p| p.capability(Capability::ReadOnly))
                    {
                        capabilities.read_only = true;
                    }
                }
                None => next.capabilities = previous.as_ref().and_then(|p| p.capabilities.clone()),
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
                    let bridge =
                        require_bridge(&inner.bridge_provider, &[AgentOperation::CloseSession])?;
                    bridge
                        .close_session(CloseSession {
                            root_path: inner.workspace_root.clone(),
                            session_id: session_id.clone(),
                            remove_persistence: Some(false),
                            ..CloseSession::default()
                        })
                        .await?;
                    inner.session_ui.borrow_mut().delete(&session_id);
                }
                // A runtime switch means "new chat". Native history is resumed
                // only through openSavedSession(), never as an implicit side
                // effect here.
                inner.initialize_runtime(false, false).await?;
                Ok(inner.read(|state| {
                    state.selected_runtime_id.as_deref() == Some(runtime_id.as_str())
                }))
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
            &[
                AgentOperation::DiscoverRuntimes,
                AgentOperation::OpenSession,
            ],
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
                let bridge =
                    require_bridge(&inner.bridge_provider, &[AgentOperation::CloseSession])?;
                bridge
                    .close_session(CloseSession {
                        root_path: inner.workspace_root.clone(),
                        session_id: current,
                        remove_persistence: Some(false),
                        ..CloseSession::default()
                    })
                    .await?;
            }
            inner.patch(
                StatePatch::new()
                    .phase(AgentControllerPhase::Discovering)
                    .session(None)
                    .projection(AgentProjection::default())
                    .selected_runtime_id(Some(runtime_id.clone()))
                    .error(None)
                    .references(Vec::new())
                    .session_preparation(AgentSessionPreparation::Preparing),
            );
            let result: AgentResult<bool> = async {
                let inspection = bridge
                    .discover_runtimes(RuntimeQuery {
                        root_path: Some(inner.workspace_root.clone()),
                        runtime_id: Some(runtime_id.clone()),
                        refresh: Some(false),
                    })
                    .await?;
                let selected_model = choose_agent_model(Some(&inspection), None, None);
                let entry = find_model(Some(&inspection), selected_model.as_deref());
                inner.patch(
                    StatePatch::new()
                        .selected_runtime_id(inspection.selected_runtime_id.clone())
                        .selected_provider_id(
                            entry
                                .as_ref()
                                .and_then(agent_provider_id_for_model)
                                .or_else(|| {
                                    choose_agent_provider(
                                        Some(&inspection),
                                        None,
                                        selected_model.as_deref(),
                                    )
                                }),
                        )
                        .selected_effort(choose_agent_effort(entry.as_ref(), None))
                        .selected_mode(choose_agent_mode(Some(&inspection), None))
                        .selected_model(selected_model)
                        .inspection(Some(inspection))
                        .initialized(true)
                        .phase(AgentControllerPhase::Restoring),
                );
                let result = bridge
                    .open_session(OpenSession {
                        root_path: inner.workspace_root.clone(),
                        session_id: session_id.clone(),
                        runtime_id: runtime_id.clone(),
                    })
                    .await?;
                let snapshot = match result {
                    crate::agent::contract::dto::SessionOpenResult::Opened(snapshot) => *snapshot,
                    crate::agent::contract::dto::SessionOpenResult::Failed(error) => {
                        return Err(agent_session_open_error(&error));
                    }
                };
                let running = snapshot
                    .session
                    .active_turn_id
                    .as_deref()
                    .is_some_and(|id| !id.is_empty());
                inner.apply_snapshot(snapshot).await?;
                inner.patch(
                    StatePatch::new()
                        .phase(if running {
                            AgentControllerPhase::Running
                        } else {
                            AgentControllerPhase::Ready
                        })
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
        let methods: &[AgentOperation] = if restore_latest {
            &[
                AgentOperation::DiscoverRuntimes,
                AgentOperation::ResumeSession,
            ]
        } else {
            &[AgentOperation::DiscoverRuntimes]
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
        let discover = bridge.discover_runtimes(RuntimeQuery {
            root_path: Some(self.workspace_root.clone()),
            runtime_id: self.read(|state| state.selected_runtime_id.clone()),
            refresh: Some(refresh),
        });
        let inner = self.clone();
        Box::pin(async move {
            let result: AgentResult<()> = async {
                let inspection = discover.await?;
                inner.last_inspection_at.set(inner.runtime.now_ms());
                let runtime_id = inspection
                    .selected_runtime_id
                    .clone()
                    .filter(|id| !id.is_empty());
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
                let selected_provider_id = entry
                    .as_ref()
                    .and_then(agent_provider_id_for_model)
                    .or_else(|| choose_agent_provider(Some(&inspection), provider.as_deref(), selected_model.as_deref()));
                let selected_mode = choose_agent_mode(Some(&inspection), mode.as_deref());
                let selected_effort = choose_agent_effort(entry.as_ref(), effort.as_deref());
                let ready = inspection.readiness.as_ref().is_some_and(|r| r.is_ready());
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
                let restored = bridge
                    .resume_session(ResumeSession {
                        root_path: inner.workspace_root.clone(),
                        runtime_id: Some(runtime_id.clone()),
                        session_id: session_id.clone(),
                        ..ResumeSession::default()
                    })
                    .await?;
                if session_id.is_some() && restored.is_none() {
                    return Err(AgentError::new(
                        "This Agent conversation is no longer available. Start a new conversation to continue.",
                    ));
                }
                let running = restored.as_ref().is_some_and(|r| {
                    r.session
                        .active_turn_id
                        .as_deref()
                        .is_some_and(|id| !id.is_empty())
                });
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
            && state.capability(Capability::ModelConnections)
            && provider_id.map(str::to_string)
                != state
                    .session
                    .as_ref()
                    .and_then(|s| s.selected_model.as_deref())
                    .and_then(agent_provider_id_for_selection)
        {
            return state.selected_model;
        }
        let selected_provider_id = provider_id
            .filter(|id| !id.is_empty())
            .filter(|id| {
                list_agent_inference_providers(state.inspection.as_ref())
                    .iter()
                    .any(|provider| provider.id == *id)
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
        let selected_model = entry.as_ref().map(|e| e.model.clone());
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
            Some(entry) => agent_provider_id_for_model(entry),
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
            if state.session.is_none() || !state.capability(Capability::ModelConnections) {
                return false;
            }
            let session_model = state
                .session
                .as_ref()
                .and_then(|s| s.selected_model.clone())
                .or_else(|| state.selected_model.clone());
            session_model
                .as_deref()
                .and_then(agent_provider_id_for_selection)
                != agent_provider_id_for_selection(model)
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
        let Some(connection_id) = find_model(state.inspection.as_ref(), Some(model))
            .and_then(|entry| entry.connection_id.filter(|id| !id.is_empty()))
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

    fn set_draft_document(&self, draft: &str, draft_mentions: &[PromptMention]) {
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
        let value = crate::text::trim(text);
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

    fn close_tab_session(self: &Rc<Self>) -> Task<CloseOutcome> {
        self.stop_scope.cancel();
        self.submission.invalidate();
        self.session_preparer.dispose();
        self.session_replica.stop_for_termination();
        let close = self.session_lifecycle.close_session();
        let inner = self.clone();
        start(&self.runtime, async move {
            let closed = close.await;
            if !closed.closed() {
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
        let bridge = match require_bridge(&self.bridge_provider, &[AgentOperation::InterruptTurn]) {
            Ok(bridge) => bridge,
            Err(error) => return resolved(Err(error)),
        };
        let instance_id = state.session_instance_id().map(str::to_string);
        let reuse = self.stop_intent.borrow().as_ref().is_some_and(|intent| {
            intent.session_id == session_id
                && intent.turn_id == turn_id
                && intent.preconditions.instance_id == instance_id
        });
        if !reuse {
            let preconditions = CommandPreconditions {
                instance_id: instance_id.clone(),
                ..command_preconditions(&state)
            };
            *self.stop_intent.borrow_mut() = Some(InterruptTurn {
                root_path: self.workspace_root.clone(),
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                command_id: Some(control_command_id("interrupt")),
                preconditions,
            });
        }
        let Some(intent) = self.stop_intent.borrow().clone() else {
            return resolved(Ok(()));
        };
        let request = Rc::new(StopRequest {
            command_id: intent.command_id.clone().unwrap_or_default(),
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
        let call = bridge.interrupt_turn(intent);
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
                    let status = if receipt.rest.truthy("interruptRequested") {
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
    fn resolve_interaction(self: &Rc<Self>, interaction: Interaction) -> Task<AgentResult<()>> {
        let state = self.store.snapshot();
        let pending = match &interaction {
            Interaction::Approval(_) => state
                .projection
                .approvals
                .first()
                .map(|a| (a.turn_id.clone(), a.request_id.clone())),
            Interaction::Question(_) => state
                .projection
                .questions
                .first()
                .map(|q| (q.turn_id.clone(), q.request_id.clone())),
        };
        let Some((turn_id, request_id)) = pending else {
            return resolved(Ok(()));
        };
        let Some(session_id) = state.session_id().map(str::to_string) else {
            return resolved(Ok(()));
        };
        let operation = match interaction {
            Interaction::Approval(_) => AgentOperation::ResolveApproval,
            Interaction::Question(_) => AgentOperation::ResolveQuestion,
        };
        let bridge = match require_bridge(&self.bridge_provider, &[operation]) {
            Ok(bridge) => bridge,
            Err(error) => return resolved(Err(error)),
        };
        self.patch(StatePatch::new().error(None));
        let preconditions = command_preconditions(&state);
        let call = match interaction {
            Interaction::Approval(decision) => bridge.resolve_approval(ResolveApproval {
                root_path: self.workspace_root.clone(),
                session_id,
                turn_id,
                request_id,
                command_id: Some(control_command_id("approval")),
                preconditions,
                decision,
            }),
            Interaction::Question(resolution) => bridge.resolve_question(ResolveQuestion {
                root_path: self.workspace_root.clone(),
                session_id,
                turn_id,
                request_id,
                command_id: Some(control_command_id("question")),
                preconditions,
                answer: resolution.answer,
                answers: resolution.answers,
                rejected: resolution.rejected,
            }),
        };
        let inner = self.clone();
        start(&self.runtime, async move {
            if let Err(error) = call.await {
                inner.patch(StatePatch::new().error(Some(format_agent_error(&error))));
                inner.session_replica.repair_from(None).await;
            }
            Ok(())
        })
    }

    fn create_session(&self) -> LocalBoxFuture<'static, AgentResult<SessionSnapshot>> {
        let bridge = match require_bridge(&self.bridge_provider, &[AgentOperation::CreateSession]) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let request = self.read(|state| CreateSession {
            root_path: self.workspace_root.clone(),
            runtime_id: state.selected_runtime_id.clone(),
            model: state.selected_model.clone(),
            effort: state.selected_effort.clone(),
            mode: state.selected_mode.clone(),
            ..CreateSession::default()
        });
        bridge.create_session(request)
    }

    /// Restores a settled native connection only when the user sends the
    /// next command.
    fn reconnect_idle_session(self: &Rc<Self>) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let current = self.store.snapshot();
        let session_id = current.session_id().map(str::to_string);
        let runtime_id = current
            .session
            .as_ref()
            .and_then(|s| s.runtime_id.clone())
            .filter(|id| !id.is_empty())
            .or(current.selected_runtime_id.clone());
        let (Some(session_id), Some(runtime_id)) = (session_id, runtime_id) else {
            return Box::pin(async { Ok(false) });
        };
        let control = current.control.clone().unwrap_or_default();
        if control.connection.status != "exited" {
            return Box::pin(async { Ok(true) });
        }
        let present = |id: &Option<String>| id.as_deref().is_some_and(|id| !id.is_empty());
        if control.connection.reason.as_deref() != Some(AGENT_IDLE_DISCONNECT_REASON)
            || control.execution.certainty != "confirmed"
            || present(&control.execution.active_turn_id)
            || present(&control.execution.uncertain_turn_id)
        {
            return Box::pin(async { Ok(false) });
        }
        let bridge = match require_bridge(&self.bridge_provider, &[AgentOperation::ResumeSession]) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        self.patch(
            StatePatch::new()
                .phase(AgentControllerPhase::Restoring)
                .error(None)
                .session_preparation(AgentSessionPreparation::Preparing),
        );
        let call = bridge.resume_session(ResumeSession {
            root_path: self.workspace_root.clone(),
            runtime_id: Some(runtime_id),
            session_id: Some(session_id),
            ..ResumeSession::default()
        });
        let inner = self.clone();
        Box::pin(async move {
            let result: AgentResult<bool> = async {
                let restored = call.await?.ok_or_else(|| {
                    AgentError::new(
                        "This Agent conversation is no longer available. Start a new conversation to continue.",
                    )
                })?;
                let running = restored
                    .session
                    .active_turn_id
                    .as_deref()
                    .is_some_and(|id| !id.is_empty());
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
        snapshot: SessionSnapshot,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        if let Err(error) = self.apply_snapshot_state(&snapshot) {
            return Box::pin(async move { Err(error) });
        }
        let session_id = snapshot.session.id.clone();
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

    fn apply_snapshot_state(&self, snapshot: &SessionSnapshot) -> AgentResult<()> {
        let projection = self
            .read(|state| AgentProjection::project(&snapshot.display, Some(&state.projection)))
            .map_err(|error| AgentError::new(error).with_name("TypeError"))?;
        let models = snapshot.models.clone();
        self.store.set_session_model_ids(
            models
                .iter()
                .map(|model| model.model.clone())
                .collect::<HashSet<_>>(),
        );
        let state = self.store.snapshot();
        let session = &snapshot.session;
        let inspection = state.inspection.as_ref().map(|current| {
            let mut inspection = current.clone();
            inspection.runtime = snapshot
                .runtime
                .clone()
                .or_else(|| session.runtime.clone())
                .or_else(|| current.runtime.clone());
            inspection.account = snapshot.account.clone();
            inspection.providers = Some(
                snapshot
                    .providers
                    .clone()
                    .or_else(|| current.providers.clone())
                    .unwrap_or_default(),
            );
            inspection.modes = Some(
                snapshot
                    .modes
                    .clone()
                    .or_else(|| current.modes.clone())
                    .unwrap_or_default(),
            );
            inspection.commands = Some(
                snapshot
                    .commands
                    .clone()
                    .or_else(|| current.commands.clone())
                    .unwrap_or_default(),
            );
            inspection.models = models.clone();
            inspection.capabilities = snapshot.capabilities.clone();
            inspection
        });
        let truthy_str = |value: &Option<String>| value.clone().filter(|v| !v.is_empty());
        let requested_model = truthy_str(&session.selected_model)
            .or(state.selected_model.clone())
            .or_else(|| choose_agent_model(inspection.as_ref(), None, None));
        let selected_model =
            choose_agent_model(inspection.as_ref(), requested_model.as_deref(), None);
        let entry = find_model(inspection.as_ref(), selected_model.as_deref());
        let selected_provider_id = entry
            .as_ref()
            .and_then(agent_provider_id_for_model)
            .or_else(|| {
                choose_agent_provider(
                    inspection.as_ref(),
                    state.selected_provider_id.as_deref(),
                    selected_model.as_deref(),
                )
            });
        let selected_effort = choose_agent_effort(
            entry.as_ref(),
            truthy_str(&session.selected_effort)
                .or(state.selected_effort.clone())
                .as_deref(),
        );
        let selected_mode = truthy_str(&session.selected_mode)
            .or(state.selected_mode.clone())
            .or_else(|| choose_agent_mode(inspection.as_ref(), None));
        let selected_runtime_id = truthy_str(&session.runtime_id)
            .or_else(|| truthy_str(&Some(session.provider.clone())))
            .or(state.selected_runtime_id.clone());
        self.patch(
            StatePatch::new()
                .session(Some(session.clone()))
                .control(Some(snapshot.control.clone()))
                .replica_status(ReplicaStatus::Subscribing)
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
fn pending_references(state: &AgentControllerState) -> Vec<DraftReference> {
    state
        .pending_intent
        .as_ref()
        .map(|intent| intent.references.clone())
        .unwrap_or_default()
}

/// `inspection?.models.find((model) => model.model === selected)`.
fn find_model(inspection: Option<&RuntimeInspection>, selected: Option<&str>) -> Option<Model> {
    let selected = selected?;
    inspection?
        .models
        .iter()
        .find(|model| model.model == selected)
        .cloned()
}

/// `controlCommandId(kind)`.
fn control_command_id(kind: &str) -> String {
    format!("{kind}-{}", random_uuid())
}

/// `commandPreconditions(state)`.
pub fn command_preconditions(state: &AgentControllerState) -> CommandPreconditions {
    let Some(control) = state.control.as_ref() else {
        return CommandPreconditions::default();
    };
    CommandPreconditions {
        instance_id: None,
        expected_session_epoch: Some(control.session_epoch.clone()),
        expected_adapter_generation: Some(control.adapter_generation),
        expected_run_generation: Some(control.run_generation),
    }
}

/// An answer to the first blocking interaction.
enum Interaction {
    Approval(ApprovalDecision),
    Question(QuestionResolution),
}

/// `resolveQuestion(resolution)`'s resolution.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QuestionResolution {
    pub answer: Option<crate::agent::contract::protocol::QuestionAnswer>,
    pub answers: Option<Vec<Vec<String>>>,
    pub rejected: Option<bool>,
}

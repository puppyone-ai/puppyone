//! `application/session/agent-session-runtime.mjs`: owns the lifecycle of
//! one live Harness adapter and projects its callbacks into the
//! provider-neutral session model. It does not decide which persisted
//! session to open or which user command to execute.
use super::super::agent_event_journal::AgentEventJournal;
use super::super::agent_input_policy::{assert_authenticated, normalize_runtime_id};
use super::super::agent_reference_policy::{
    revoke_active_agent_references, scrub_private_reference_paths,
};
use super::super::agent_session_store::AgentSessionStore;
use super::super::ports::{AttachmentStore, Logger, SessionCache};
use super::super::processes::agent_process_supervisor::AgentProcessSupervisor;
use super::super::runtime_resolution::runtime_resolution_coordinator::{
    ResolvedRuntime, RuntimeResolutionCoordinator,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::constants::AGENT_IDLE_DISCONNECT_REASON;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::agent::domain::agent_session_control::is_agent_execution_settled;
use crate::agent::domain::agent_session_model::{
    SessionRef, apply_inspection, apply_provider_session, persisted_record_from_session,
};
use crate::agent::runtime::agent_runtime_port::{
    AdapterOptions, AgentRuntimeAdapter, assert_agent_runtime_inspection,
};
use crate::agent::runtime::agent_runtime_registry::AgentRuntimeRegistry;
use crate::agent::runtime::agent_session_history_port::resolve_agent_session_history_port;
use crate::agent::runtime::history_source_scope::assert_history_source_scope;
use crate::agent::tasks::{SharedTask, shared, spawn_after};
use crate::clock;
use crate::text;
use serde_json::{Value, json};
use std::rc::{Rc, Weak};
use std::time::Duration;
use tokio::task::spawn_local;

const INTERRUPT_CONFIRMATION_TIMEOUT_MS: u64 = 5_000;
const MAX_TURN_DURATION_MS: f64 = 30.0 * 24.0 * 60.0 * 60.0 * 1_000.0;

/// What `bootstrapNativeSession` reports.
pub struct Bootstrapped {
    pub inspection: Value,
    pub provider_session: Value,
}

struct Inner {
    registry: AgentRuntimeRegistry,
    coordinator: RuntimeResolutionCoordinator,
    supervisor: AgentProcessSupervisor,
    store: AgentSessionStore,
    cache: Rc<dyn SessionCache>,
    attachments: Option<Rc<dyn AttachmentStore>>,
    logger: Rc<dyn Logger>,
    journal: AgentEventJournal,
}

/// `createAgentSessionRuntime(...)`.
#[derive(Clone)]
pub struct AgentSessionRuntime(Rc<Inner>);

impl AgentSessionRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        registry: AgentRuntimeRegistry,
        coordinator: RuntimeResolutionCoordinator,
        supervisor: AgentProcessSupervisor,
        store: AgentSessionStore,
        cache: Rc<dyn SessionCache>,
        attachments: Option<Rc<dyn AttachmentStore>>,
        logger: Rc<dyn Logger>,
        journal: AgentEventJournal,
    ) -> Self {
        Self(Rc::new(Inner {
            registry,
            coordinator,
            supervisor,
            store,
            cache,
            attachments,
            logger,
            journal,
        }))
    }

    pub fn store(&self) -> &AgentSessionStore {
        &self.0.store
    }

    pub fn attachments(&self) -> Option<&Rc<dyn AttachmentStore>> {
        self.0.attachments.as_ref()
    }

    fn emit(&self, session: &SessionRef, event: Value) {
        self.0.journal.emit(session, event);
    }

    async fn run_runtime_start<T, F: std::future::Future<Output = AgentResult<T>>>(
        &self,
        session: &SessionRef,
        operation: &str,
        start: impl FnOnce() -> F,
    ) -> AgentResult<T> {
        let label = format!("{}:{operation}", session.runtime_id());
        self.0
            .supervisor
            .run_start(&label, None, || async {
                if session.closing() {
                    return Err(AgentError::new("Agent session closed during startup."));
                }
                start().await
            })
            .await
    }

    /// `runtimeSession.resolveRuntimeForOperation(value, workspaceRoot, operation)`.
    pub async fn resolve_runtime_for_operation(
        &self,
        value: Option<&Value>,
        workspace_root: &str,
        operation: &str,
    ) -> AgentResult<ResolvedRuntime> {
        let requested = normalize_runtime_id(value);
        if value
            .and_then(Value::as_str)
            .is_some_and(|v| !text::trim(v).is_empty())
            && requested.is_none()
        {
            return Err(AgentError::new("Agent runtime id is invalid."));
        }
        let Some(requested) = requested else {
            return Err(AgentError::new(
                "Choose an Agent before starting an Agent session.",
            ));
        };
        // A new native session must observe installations added after the
        // catalog was cached. Existing sessions keep their running adapter.
        self.0
            .coordinator
            .resolve_for_operation(Some(&requested), workspace_root, operation, true)
            .await
    }

    /// `runtimeSession.createAdapterForSession(session, internalReadiness)`.
    pub fn create_adapter_for_session(
        &self,
        session: &SessionRef,
        internal_readiness: &Value,
    ) -> AgentResult<Rc<dyn AgentRuntimeAdapter>> {
        session.state_mut().bootstrap_events = Some(Vec::new());
        let generation = session.actor.control()["adapterGeneration"]
            .as_i64()
            .unwrap_or(0)
            + 1;
        let workspace_root = session.workspace_root();
        let weak: Weak<_> = Rc::downgrade(session);
        let on_event = {
            let runtime = self.clone();
            let weak = weak.clone();
            Rc::new(move |event: Value| {
                if let Some(session) = weak.upgrade() {
                    runtime.handle_adapter_event(&session, generation, event);
                }
            }) as Rc<dyn Fn(Value)>
        };
        let on_exit = {
            let runtime = self.clone();
            let weak = weak.clone();
            Rc::new(move |info: Value| {
                if let Some(session) = weak.upgrade() {
                    runtime.handle_adapter_exit(&session, generation, &info);
                }
            }) as Rc<dyn Fn(Value)>
        };
        let on_session_persisted = {
            let runtime = self.clone();
            Rc::new(move |identity: Value| {
                let Some(session) = weak.upgrade() else {
                    return;
                };
                let control_generation = session.actor.control()["adapterGeneration"]
                    .as_i64()
                    .unwrap_or(0);
                let current = runtime.0.store.is_current(&session)
                    && !session.closing()
                    && control_generation == generation;
                let state = session.state();
                let matches = identity["providerSessionId"].as_str()
                    == state.provider_session_id.as_deref()
                    && identity["sourceScopeId"].as_str() == state.source_scope_id.as_deref();
                drop(state);
                if !current || !matches {
                    return;
                }
                session.state_mut().native_persistence_confirmed = true;
                let journal = runtime.0.journal.clone();
                spawn_local(async move { journal.persist_now(&session).await });
            }) as Rc<dyn Fn(Value)>
        };
        let readiness = Obj::from(internal_readiness)
            .set("workspaceRoot", workspace_root.as_str())
            .build();
        let adapter = self.0.registry.create_adapter(
            &session.runtime_id(),
            AdapterOptions {
                readiness,
                workspace_root,
                on_event,
                on_exit,
                on_session_persisted: Some(on_session_persisted),
            },
        )?;
        session
            .actor
            .dispatch(json!({ "type": "adapter.attached" }))?;
        Ok(adapter)
    }

    /// `runtimeSession.bootstrapNativeSession(session, selected, { kind, operation, threadId })`.
    pub async fn bootstrap_native_session(
        &self,
        session: &SessionRef,
        selected: &ResolvedRuntime,
        kind: &str,
        operation: &str,
        thread_id: Option<String>,
    ) -> AgentResult<Bootstrapped> {
        let adapter = session
            .adapter()
            .ok_or_else(|| AgentError::new("Agent session closed during startup."))?;
        let history = resolve_agent_session_history_port(adapter.as_ref())?;
        let source_scope_id = history
            .and_then(|h| h.source_scope_id())
            .unwrap_or_else(|| "default".into());
        if let Some(existing) = session.state().source_scope_id.clone() {
            assert_history_source_scope(&source_scope_id, &existing)?;
        }
        session.state_mut().source_scope_id = Some(source_scope_id);
        let selection = {
            let state = session.state();
            Obj::new()
                .set("model", state.selected_model.clone())
                .opt("effort", state.selected_effort.clone())
                .opt("mode", state.selected_mode.clone())
                .build()
        };
        let runtime_id = session.runtime_id();
        let (inspection, mut provider_session) = if adapter.implements("bootstrapSession") {
            let request = Obj::new()
                .set("kind", kind)
                .set("threadId", thread_id.clone())
                .spread(&selection)
                .build();
            let result = self
                .run_runtime_start(session, &format!("bootstrap-{operation}"), || {
                    adapter.bootstrap_session(request)
                })
                .await?;
            let inspection = assert_agent_runtime_inspection(
                adapter.as_ref(),
                &result["inspection"],
                &runtime_id,
            )?;
            (
                inspection,
                result
                    .get("providerSession")
                    .filter(|p| !p.is_null())
                    .cloned(),
            )
        } else {
            let inspected = self
                .run_runtime_start(session, "inspect", || adapter.inspect())
                .await?;
            (
                assert_agent_runtime_inspection(adapter.as_ref(), &inspected, &runtime_id)?,
                None,
            )
        };
        let read_only_resume = kind == "resume"
            && provider_session.is_some()
            && inspection["capabilities"]["readOnly"] == true;
        if !read_only_resume {
            let name = selected.descriptor["displayName"]
                .as_str()
                .unwrap_or("Agent runtime")
                .to_string();
            assert_authenticated(&inspection["account"], &name)?;
        }
        apply_inspection(session, &inspection);
        if !read_only_resume {
            let (model, effort) = {
                let state = session.state();
                (state.selected_model.clone(), state.selected_effort.clone())
            };
            self.require_available_model(session, model.as_deref())?;
            self.require_available_effort(session, model.as_deref(), effort.as_deref())?;
        }
        if provider_session.is_none() {
            provider_session = Some(if kind == "resume" {
                let request = Obj::new()
                    .set("threadId", thread_id.clone())
                    .spread(&selection)
                    .build();
                self.run_runtime_start(session, operation, || adapter.resume_session(request))
                    .await?
            } else {
                self.run_runtime_start(session, operation, || {
                    adapter.create_session(selection.clone())
                })
                .await?
            });
        }
        let provider_session = provider_session.unwrap_or(Value::Null);
        if !self.0.store.is_current(session) || session.closing() || session.sender.is_destroyed() {
            return Err(AgentError::new("Agent session closed during startup."));
        }
        if kind == "resume"
            && provider_session["providerSessionId"].as_str() != thread_id.as_deref()
        {
            return Err(AgentError::new(
                "Agent resumed a different native conversation.",
            ));
        }
        apply_provider_session(session, &provider_session);
        if session.provider_session_id().is_some() && self.0.cache.supports("bindNative") {
            let bound = self
                .0
                .cache
                .bind_native(persisted_record_from_session(session))
                .await?;
            if !self.0.store.is_current(session) || session.closing() {
                return Err(AgentError::new(
                    "Agent session closed while registering its identity.",
                ));
            }
            if let Some(id) = bound["sessionId"].as_str() {
                self.0.store.adopt_identity(session, id)?;
            }
        }
        // Exact native resume is provider evidence; merely allocating an id is not.
        if kind == "resume" {
            session.state_mut().native_persistence_confirmed = true;
        }
        Ok(Bootstrapped {
            inspection,
            provider_session,
        })
    }

    /// `runtimeSession.finishNativeSession(session)`.
    pub fn finish_native_session(&self, session: &SessionRef) -> AgentResult<()> {
        if let Some(error) = session.state().bootstrap_error.clone() {
            return Err(error);
        }
        if !self.0.store.is_current(session) || session.closing() || session.provider_exited() {
            return Err(AgentError::new("Agent session closed during startup."));
        }
        let events = session
            .state_mut()
            .bootstrap_events
            .take()
            .unwrap_or_default();
        let generation = session.actor.control()["adapterGeneration"]
            .as_i64()
            .unwrap_or(0);
        for event in events {
            self.handle_adapter_event(session, generation, event);
        }
        Ok(())
    }

    fn handle_adapter_event(
        &self,
        session: &SessionRef,
        adapter_generation: i64,
        adapter_event: Value,
    ) {
        if !self.0.store.is_current(session)
            || session.closing()
            || session.provider_exited()
            || session.actor.control()["adapterGeneration"].as_i64() != Some(adapter_generation)
        {
            return;
        }
        {
            let mut state = session.state_mut();
            if let Some(buffer) = state.bootstrap_events.as_mut() {
                if buffer.len() >= 1000 {
                    state.bootstrap_error = Some(AgentError::new(
                        "Native Agent startup replay exceeded its limit.",
                    ));
                } else {
                    buffer.push(adapter_event);
                }
                return;
            }
        }
        if let (Some(native), Some(current)) = (
            adapter_event
                .get("providerSessionId")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty()),
            session.provider_session_id(),
        ) && native != current
        {
            self.retire_provider_session(
                session,
                Some("The native Agent changed conversation identity unexpectedly."),
                "Native conversation identity mismatch.",
                "provider-exited",
            );
            return;
        }
        let mut event = adapter_event;
        let paths = session.state().private_reference_paths.clone();
        let payload =
            scrub_private_reference_paths(event.get("payload").unwrap_or(&Value::Null), &paths);
        if event.get("payload").is_some() {
            event["payload"] = payload;
        }
        let event_type = event.event_type().to_string();
        if event_type == "session.started" || event_type == "session.resumed" {
            if session.state().lifecycle_event_seen {
                return;
            }
            let mut state = session.state_mut();
            state.lifecycle_event_seen = true;
            if let Some(id) = event
                .get("providerSessionId")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
            {
                state.provider_session_id = Some(id.to_string());
            }
            if let Some(title) = event["payload"]["title"].as_str() {
                state.title = title.to_string();
            }
        }
        if event_type == "session.updated"
            && let Some(title) = event["payload"]["title"].as_str()
        {
            session.state_mut().title = text::head16(title, 200).to_string();
        }
        if event_type == "turn.started" {
            let pending_prompt = session.pending_prompt();
            let pending_references = session.pending_reference_displays();
            if pending_prompt.as_deref().is_some_and(|p| !p.is_empty())
                || pending_references.as_array().is_some_and(|r| !r.is_empty())
            {
                let state = session.state();
                let payload = Obj::from(&event["payload"])
                    .set("prompt", pending_prompt)
                    .set("promptMentions", session.pending_prompt_mentions())
                    .set("model", state.selected_model.clone())
                    .set("effort", state.selected_effort.clone())
                    .set("referenceDisplays", pending_references)
                    .build();
                drop(state);
                event["payload"] = payload;
            }
        }
        if matches!(
            event_type.as_str(),
            "turn.completed" | "turn.failed" | "turn.interrupted"
        ) {
            let control = session.actor.control();
            let turn = event
                .turn_id()
                .filter(|t| !t.is_empty())
                .map(str::to_string);
            let active_turn_ended = turn.as_deref().is_some_and(|turn| {
                control["execution"]["activeTurnId"] == turn
                    || control["execution"]["uncertainTurnId"] == turn
            });
            let started = if active_turn_ended {
                session.active_turn_started_at_ms()
            } else {
                None
            };
            event["payload"] = with_turn_duration(&event["payload"], started);
            self.fail_pending_for_turn(session, "approvals", turn.as_deref(), "turn-ended");
            self.fail_pending_for_turn(session, "questions", turn.as_deref(), "turn-ended");
            if active_turn_ended {
                self.clear_interrupt_fallback(session);
                session.state_mut().private_reference_paths.clear();
                let attachments = self.0.attachments.clone();
                let target = session.clone();
                spawn_local(async move {
                    revoke_active_agent_references(&target, attachments.as_ref()).await
                });
            }
        }
        let request_id = event["payload"]["requestId"].as_str().map(str::to_string);
        let pending = |key: &str| {
            request_id.as_deref().is_some_and(|id| {
                session
                    .pending_blockers(key)
                    .iter()
                    .any(|b| b["requestId"] == id)
            })
        };
        match event_type.as_str() {
            "approval.requested" if request_id.is_none() || pending("approvals") => return,
            "approval.resolved" if !pending("approvals") => return,
            "question.requested"
                if request_id.is_none()
                    || event.turn_id().is_none_or(str::is_empty)
                    || pending("questions") =>
            {
                return;
            }
            "question.resolved" if !pending("questions") => return,
            _ => {}
        }
        self.emit(session, event);
    }

    fn handle_adapter_exit(&self, session: &SessionRef, adapter_generation: i64, info: &Value) {
        if !self.0.store.is_current(session)
            || session.closing()
            || session.provider_exited()
            || js::truthy_opt(info.get("expected"))
            || session.provider_session_id().is_none()
        {
            return;
        }
        let control = session.actor.control();
        if control["adapterGeneration"].as_i64() != Some(adapter_generation) {
            return;
        }
        let diagnostic = info["diagnostics"]
            .as_str()
            .filter(|d| !d.is_empty())
            .or(info["error"].as_str())
            .unwrap_or("")
            .to_string();
        if is_agent_execution_settled(&control) {
            self.retire_provider_session(session, None, &diagnostic, AGENT_IDLE_DISCONNECT_REASON);
            return;
        }
        self.0
            .coordinator
            .record_operation_failure(&session.runtime_id(), &session.workspace_root());
        let message = format!(
            "{} exited. Files already changed on disk were not reverted.",
            session.runtime_display_name()
        );
        self.retire_provider_session(session, Some(&message), &diagnostic, "provider-exited");
    }

    fn resolve_blocker(&self, session: &SessionRef, key: &str, pending: &Value, reason: &str) {
        let (event_type, resolution) = if key == "approvals" {
            (
                "approval.resolved",
                json!({ "requestId": pending["requestId"], "decision": "cancel", "reason": reason }),
            )
        } else {
            (
                "question.resolved",
                json!({ "requestId": pending["requestId"], "resolution": "rejected", "reason": reason }),
            )
        };
        self.emit(
            session,
            json!({
                "type": event_type,
                "providerSessionId": session.provider_session_id(),
                "turnId": pending["turnId"],
                "itemId": pending["itemId"],
                "payload": resolution,
            }),
        );
    }

    /// `failPendingApprovalsClosed` / `failPendingQuestionsClosed`.
    pub fn fail_pending_closed(&self, session: &SessionRef, key: &str, reason: &str) {
        for pending in session.pending_blockers(key) {
            self.resolve_blocker(session, key, &pending, reason);
        }
    }

    /// `failPendingApprovalsForTurn` / `failPendingQuestionsForTurn`.
    pub fn fail_pending_for_turn(
        &self,
        session: &SessionRef,
        key: &str,
        turn_id: Option<&str>,
        reason: &str,
    ) {
        let Some(turn_id) = turn_id.filter(|t| !t.is_empty()) else {
            return;
        };
        for pending in session.pending_blockers(key) {
            if pending["turnId"] == turn_id {
                self.resolve_blocker(session, key, &pending, reason);
            }
        }
    }

    /// `runtimeSession.scheduleInterruptFallback(session, turnId)`.
    pub fn schedule_interrupt_fallback(&self, session: &SessionRef, turn_id: &str) {
        self.clear_interrupt_fallback(session);
        let runtime = self.clone();
        let target = Rc::downgrade(session);
        let turn = turn_id.to_string();
        let timer = spawn_after(
            Duration::from_millis(INTERRUPT_CONFIRMATION_TIMEOUT_MS),
            move || {
                let Some(session) = target.upgrade() else {
                    return;
                };
                session.state_mut().interrupt_fallback_timer = None;
                if !runtime.0.store.is_current(&session)
                    || session.closing()
                    || session.active_turn_id().as_deref() != Some(turn.as_str())
                {
                    return;
                }
                let name = session.runtime_display_name();
                runtime.emit(
                &session,
                json!({
                    "type": "provider.warning",
                    "providerSessionId": session.provider_session_id(),
                    "turnId": turn,
                    "payload": {
                        "message": format!("{name} has not confirmed that the turn stopped. You can end the execution from the execution manager."),
                        "code": "INTERRUPT_UNCONFIRMED",
                        "recoverable": true,
                    },
                }),
            );
            },
        );
        session.state_mut().interrupt_fallback_timer = Some(timer);
    }

    /// `runtimeSession.clearInterruptFallback(session)`.
    pub fn clear_interrupt_fallback(&self, session: &SessionRef) {
        if let Some(timer) = session.state_mut().interrupt_fallback_timer.take() {
            timer.abort();
        }
    }

    fn retire_provider_session(
        &self,
        session: &SessionRef,
        provider_message: Option<&str>,
        diagnostic: &str,
        reason: &str,
    ) {
        if !self.0.store.is_current(session) || session.closing() || session.provider_exited() {
            return;
        }
        let generation = session.actor.control()["adapterGeneration"].clone();
        self.clear_interrupt_fallback(session);
        self.fail_pending_closed(session, "approvals", "provider-exited");
        self.fail_pending_closed(session, "questions", "provider-exited");
        let active_turn_id = session.active_turn_id();
        {
            let attachments = self.0.attachments.clone();
            let target = session.clone();
            spawn_local(async move {
                revoke_active_agent_references(&target, attachments.as_ref()).await
            });
        }
        // Process death proves that the connection ended, not that the native turn
        // failed. Only a correlated native terminal event may settle execution.
        if let Some(message) = provider_message {
            self.emit(
                session,
                json!({
                    "type": "provider.error",
                    "providerSessionId": session.provider_session_id(),
                    "turnId": active_turn_id,
                    "payload": { "message": message, "diagnostic": redact_secret_text(diagnostic), "recoverable": true },
                }),
            );
        }
        let _ = session.actor.dispatch(
            json!({ "type": "adapter.exited", "adapterGeneration": generation, "reason": reason }),
        );
        if let Some(timer) = session.state_mut().persist_timer.take() {
            timer.abort();
        }
        let journal = self.0.journal.clone();
        let target = session.clone();
        spawn_local(async move { journal.persist_now(&target).await });
        if let Some(adapter) = session.state_mut().adapter.take() {
            let logger = self.0.logger.clone();
            spawn_local(async move {
                if let Err(error) = adapter.dispose().await {
                    logger.warn(
                        &format!(
                            "Unable to release exited Agent adapter: {}",
                            redact_secret_text(&error.message)
                        ),
                        Value::Null,
                    );
                }
            });
        }
    }

    /// `runtimeSession.closeSessionRecord(session, { persist, removePersistence })`.
    pub fn close_session_record(
        &self,
        session: &SessionRef,
        persist: bool,
        remove_persistence: bool,
    ) -> SharedTask<AgentResult<()>> {
        if let Some(pending) = session.state().close_promise.clone() {
            return pending;
        }
        if session.state().closed {
            return shared(async { Ok(()) });
        }
        {
            let mut state = session.state_mut();
            state.closing = true;
            if let Some(timer) = state.persist_timer.take() {
                timer.abort();
            }
        }
        self.clear_interrupt_fallback(session);
        self.fail_pending_closed(session, "approvals", "session-closed");
        self.fail_pending_closed(session, "questions", "session-closed");
        let runtime = self.clone();
        let target = session.clone();
        let task = shared(async move {
            let result = async {
                // Keep the record on failure so the project can retry actual cleanup.
                if let Some(adapter) = target.adapter() {
                    adapter.dispose().await?;
                }
                revoke_active_agent_references(&target, runtime.0.attachments.as_ref()).await;
                if remove_persistence {
                    runtime.0.cache.remove(target.id()).await?;
                } else if persist {
                    runtime.0.journal.persist_now(&target).await;
                }
                if runtime.0.store.is_current(&target) {
                    target.state_mut().closing = false;
                    let terminal = target.terminal_state();
                    runtime.emit(
                        &target,
                        json!({
                            "type": "session.closed",
                            "providerSessionId": target.provider_session_id(),
                            "payload": { "terminalState": terminal },
                        }),
                    );
                    target.state_mut().closing = true;
                    runtime.0.store.remember_closed(&target);
                    runtime.0.store.remove(&target);
                }
                target.state_mut().closed = true;
                Ok(())
            }
            .await;
            target.state_mut().close_promise = None;
            result
        });
        session.state_mut().close_promise = Some(task.clone());
        task
    }

    /// `runtimeSession.requireOwnedSession(sender, id)`.
    pub fn require_owned_session(
        &self,
        sender: &crate::agent::sender::Sender,
        id: Option<&Value>,
    ) -> AgentResult<SessionRef> {
        self.0.store.require_owned(sender, id)
    }

    /// `runtimeSession.requireAvailableModel(session, model)`.
    pub fn require_available_model(
        &self,
        session: &SessionRef,
        model: Option<&str>,
    ) -> AgentResult<String> {
        let Some(model) = model.filter(|m| !m.is_empty()) else {
            return Err(AgentError::new(
                "Choose a connected model provider and model before sending a message.",
            ));
        };
        if !session
            .state()
            .models
            .iter()
            .any(|candidate| candidate["model"] == model)
        {
            return Err(AgentError::new(
                "The selected model is no longer available from a connected provider. Refresh Agent providers and choose again.",
            ));
        }
        Ok(model.to_string())
    }

    /// `runtimeSession.requireAvailableEffort(session, model, effort)`.
    pub fn require_available_effort(
        &self,
        session: &SessionRef,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> AgentResult<Option<String>> {
        let available: Vec<String> = session
            .state()
            .models
            .iter()
            .find(|candidate| model.is_some_and(|m| candidate["model"] == m))
            .and_then(|m| m["variants"].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        let effort = effort.filter(|e| !e.is_empty());
        if effort.is_none() && available.is_empty() {
            return Ok(None);
        }
        match effort {
            Some(effort) if available.iter().any(|a| a == effort) => Ok(Some(effort.to_string())),
            _ => Err(AgentError::new(
                "The selected reasoning effort is no longer available for this model. Refresh Agent models and choose again.",
            )),
        }
    }

    /// `runtimeSession.isCurrent(session)`.
    pub fn is_current(&self, session: &SessionRef) -> bool {
        self.0.store.is_current(session)
    }

    pub fn journal(&self) -> &AgentEventJournal {
        &self.0.journal
    }

    pub fn coordinator(&self) -> &RuntimeResolutionCoordinator {
        &self.0.coordinator
    }

    pub fn cache(&self) -> &Rc<dyn SessionCache> {
        &self.0.cache
    }

    pub fn logger(&self) -> &Rc<dyn Logger> {
        &self.0.logger
    }

    pub fn registry(&self) -> &AgentRuntimeRegistry {
        &self.0.registry
    }
}

fn with_turn_duration(payload: &Value, started_at_ms: Option<i64>) -> Value {
    let candidate = match payload.get("durationMs") {
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        Some(value) => value.as_f64(),
        None => None,
    };
    let duration = match candidate {
        Some(value) if value.is_finite() && value >= 0.0 => Some(value),
        _ => started_at_ms.map(|started| (clock::now_ms() - started) as f64),
    };
    let base = if payload.is_object() {
        payload.clone()
    } else {
        json!({})
    };
    match duration.filter(|d| d.is_finite() && *d >= 0.0) {
        Some(duration) => js::with(
            &base,
            "durationMs",
            js::number(MAX_TURN_DURATION_MS.min(duration.round())),
        ),
        None => base,
    }
}

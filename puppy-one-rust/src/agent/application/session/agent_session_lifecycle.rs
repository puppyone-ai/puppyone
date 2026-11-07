//! `application/session/agent-session-lifecycle.mjs`: allocation, durable
//! restore, exact History open and shutdown semantics.
use super::super::agent_input_policy::{
    normalize_optional_id, normalize_optional_string, normalize_required_id, normalize_runtime_id,
    require_matching_workspace, require_sender_id, require_workspace_root,
};
use super::super::runtime_resolution::runtime_resolution_coordinator::ResolvedRuntime;
use super::agent_history_hydration::hydrate_agent_session;
use super::agent_session_open_errors::{classify_session_open_failure, session_open_failure};
use super::agent_session_runtime::AgentSessionRuntime;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::domain::agent_session_model::{
    SessionRecordInput, SessionRef, apply_provider_session, create_agent_session_record,
    persisted_record_from_session, session_metadata, session_snapshot,
};
use crate::agent::migrations::legacy_session_format::resolve_persisted_runtime_id;
use crate::agent::runtime::agent_operation_error::sanitize_agent_operation_error;
use crate::agent::runtime::agent_runtime_port::is_agent_provider_session_unavailable_error;
use crate::agent::sender::Sender;
use crate::agent::tasks::shared;
use futures_util::future::join_all;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone)]
pub struct AgentSessionLifecycle {
    runtime: AgentSessionRuntime,
    creations: Rc<RefCell<HashSet<String>>>,
}

impl AgentSessionLifecycle {
    pub fn new(runtime: AgentSessionRuntime) -> Self {
        Self {
            runtime,
            creations: Rc::default(),
        }
    }

    /// `lifecycle.createSession(sender, request, workspaceRoot)`.
    pub async fn create_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: &str,
    ) -> AgentResult<Value> {
        let owner_id = require_sender_id(sender)?;
        require_workspace_root(Some(workspace_root))?;
        let store = self.runtime.store();
        store.discard_retired(owner_id, workspace_root);
        let selected = self
            .runtime
            .resolve_runtime_for_operation(request.get("runtimeId"), workspace_root, "create")
            .await?;
        let session = create_agent_session_record(SessionRecordInput {
            id: uuid::Uuid::new_v4().to_string(),
            owner_id,
            sender: sender.clone(),
            workspace_root: workspace_root.to_string(),
            runtime_id: selected.descriptor["id"].as_str().unwrap_or("").to_string(),
            runtime: Some(selected.descriptor.clone()),
            model: normalize_optional_string(request.get("model")),
            effort: normalize_optional_string(request.get("effort")),
            mode: normalize_optional_string(request.get("mode")),
            events: Vec::new(),
            sequence: 0,
            created_at: None,
            title: None,
            terminal_state: None,
        })?;
        store.add(&session)?;
        let result = async {
            let adapter = self
                .runtime
                .create_adapter_for_session(&session, &selected.readiness)?;
            session.state_mut().adapter = Some(adapter);
            let booted = self
                .runtime
                .bootstrap_native_session(&session, &selected, "create", None)
                .await?;
            apply_provider_session(&session, &booted.provider_session);
            self.runtime.finish_native_session(&session)?;
            self.record_runtime_success(&session, &selected, &booted.inspection);
            if !session.state().lifecycle_event_seen {
                self.runtime.journal().emit(
                    &session,
                    json!({
                        "type": "session.started",
                        "providerSessionId": session.provider_session_id(),
                        "payload": session_metadata(&session, None),
                    }),
                );
            }
            self.runtime.journal().persist_soon(&session);
            Ok(session_snapshot(&session))
        }
        .await;
        match result {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                self.record_runtime_failure(&session, &error);
                let _ = self
                    .runtime
                    .close_session_record(&session, false, false)
                    .await;
                Err(sanitize_agent_operation_error(error))
            }
        }
    }

    /// `lifecycle.resumeSession(sender, request, workspaceRoot)`.
    pub async fn resume_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: &str,
    ) -> AgentResult<Value> {
        let owner_id = require_sender_id(sender)?;
        require_workspace_root(Some(workspace_root))?;
        let store = self.runtime.store();
        let connected = store.find_owned(owner_id, workspace_root, true);
        let requested_session_id = normalize_optional_id(request.get("sessionId"));
        let requested_live = requested_session_id.as_deref().and_then(|id| store.get(id));
        if let Some(live) = requested_live.filter(|s| !s.provider_exited()) {
            let owned = self
                .runtime
                .require_owned_session(sender, Some(&Value::from(live.id())))?;
            require_matching_workspace(&owned.workspace_root(), Some(workspace_root))?;
            if request.get("runtimeId").is_some_and(|r| !r.is_null())
                && normalize_runtime_id(request.get("runtimeId")).as_deref()
                    != Some(owned.runtime_id().as_str())
            {
                return Err(AgentError::new("Agent runtime does not match the session."));
            }
            return Ok(session_snapshot(&owned));
        }
        if let Some(connected) = connected.filter(|_| requested_session_id.is_none()) {
            return Ok(session_snapshot(&connected));
        }
        let requested_runtime = normalize_runtime_id(request.get("runtimeId"));
        let creation_key = format!(
            "{owner_id}\0{workspace_root}\0resume\0{}",
            requested_session_id
                .clone()
                .or_else(|| requested_runtime.clone())
                .unwrap_or_else(|| "latest".into())
        );
        if !self.creations.borrow_mut().insert(creation_key.clone()) {
            return Err(AgentError::new(
                "An Agent session is already starting for this workspace.",
            ));
        }
        let result = self
            .resume_admitted(
                sender,
                owner_id,
                workspace_root,
                requested_session_id,
                requested_runtime,
            )
            .await;
        self.creations.borrow_mut().remove(&creation_key);
        result
    }

    async fn resume_admitted(
        &self,
        sender: &Sender,
        owner_id: u64,
        workspace_root: &str,
        requested_session_id: Option<String>,
        requested_runtime: Option<String>,
    ) -> AgentResult<Value> {
        let store = self.runtime.store();
        let cache = self.runtime.cache().clone();
        let retired = store.take_retired(owner_id, workspace_root, requested_session_id.as_deref());
        let persisted = match retired {
            Some(retired) => Some(persisted_record_from_session(&retired)),
            None => match &requested_session_id {
                Some(id) => {
                    cache
                        .find_by_id(id.clone(), Some(workspace_root.to_string()))
                        .await?
                }
                None => {
                    cache
                        .find_latest(workspace_root.to_string(), requested_runtime.clone())
                        .await?
                }
            },
        };
        let Some(persisted) = persisted else {
            return Ok(Value::Null);
        };
        let session_id = persisted["sessionId"].as_str().unwrap_or("").to_string();
        if let Some(existing) = store.get(&session_id) {
            let owned = self
                .runtime
                .require_owned_session(sender, Some(&Value::from(existing.id())))?;
            return Ok(session_snapshot(&owned));
        }
        let runtime_id = resolve_persisted_runtime_id(&persisted, requested_runtime.as_deref());
        let selected = self
            .runtime
            .resolve_runtime_for_operation(
                Some(&Value::from(runtime_id.as_str())),
                workspace_root,
                "resume",
            )
            .await?;
        let text = |key: &str| normalize_optional_string(persisted.get(key));
        let session = create_agent_session_record(SessionRecordInput {
            id: session_id.clone(),
            owner_id,
            sender: sender.clone(),
            workspace_root: workspace_root.to_string(),
            runtime_id: runtime_id.clone(),
            runtime: Some(selected.descriptor.clone()),
            model: text("selectedModel"),
            effort: text("selectedEffort"),
            mode: text("selectedMode"),
            events: persisted["events"].as_array().cloned().unwrap_or_default(),
            sequence: persisted["lastSequence"].as_i64().unwrap_or(0),
            created_at: persisted["createdAt"].as_str().map(str::to_string),
            title: persisted["title"].as_str().map(str::to_string),
            terminal_state: Some(
                persisted["terminalState"]
                    .as_str()
                    .filter(|t| !t.is_empty())
                    .unwrap_or("idle")
                    .to_string(),
            ),
        })?;
        {
            let mut state = session.state_mut();
            state.provider_session_id = persisted["providerSessionId"].as_str().map(str::to_string);
            state.model_binding_revision = persisted["modelBindingRevision"]
                .as_str()
                .map(str::to_string);
            state.source_scope_id = Some(
                persisted["sourceScopeId"]
                    .as_str()
                    .unwrap_or("default")
                    .to_string(),
            );
        }
        store.add(&session)?;
        let thread_id = session.provider_session_id();
        let result = async {
            let adapter = self
                .runtime
                .create_adapter_for_session(&session, &selected.readiness)?;
            session.state_mut().adapter = Some(adapter);
            let booted = self
                .runtime
                .bootstrap_native_session(&session, &selected, "resume", thread_id.clone())
                .await?;
            apply_provider_session(&session, &booted.provider_session);
            self.record_runtime_success(&session, &selected, &booted.inspection);
            // Resume always reconciles against native objects. The bounded local
            // ledger is a presentation cache and cannot prove that an old active
            // turn has (or has not) reached a native terminal state.
            hydrate_agent_session(&session, self.runtime.journal(), None).await?;
            self.runtime.finish_native_session(&session)?;
            if !session.state().lifecycle_event_seen {
                self.runtime.journal().emit(
                    &session,
                    json!({
                        "type": "session.resumed",
                        "providerSessionId": session.provider_session_id(),
                        "payload": session_metadata(&session, None),
                    }),
                );
            }
            self.runtime.journal().persist_soon(&session);
            Ok(session_snapshot(&session))
        }
        .await;
        match result {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                self.record_runtime_failure(&session, &error);
                let _ = self
                    .runtime
                    .close_session_record(&session, false, false)
                    .await;
                if is_agent_provider_session_unavailable_error(&error) {
                    if cache.supports("markUnavailable") {
                        cache.mark_unavailable(session_id.clone()).await?;
                    } else {
                        cache.remove(session_id.clone()).await?;
                    }
                    self.runtime.logger().warn(
                        &format!(
                            "Discarded unavailable {runtime_id} session metadata; a new native session will be created on demand."
                        ),
                        Value::Null,
                    );
                    return Ok(Value::Null);
                }
                Err(sanitize_agent_operation_error(error))
            }
        }
    }

    /// `lifecycle.openSession(sender, request, workspaceRoot)`.
    pub async fn open_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: &str,
    ) -> AgentResult<Value> {
        require_workspace_root(Some(workspace_root))?;
        let session_id = normalize_required_id(request.get("sessionId"), "Agent session id")?;
        let runtime_id = normalize_runtime_id(request.get("runtimeId"));
        let store = self.runtime.store();
        if let Some(live) = store.get(&session_id).filter(|s| !s.provider_exited()) {
            let opened = (|| {
                let owned = self
                    .runtime
                    .require_owned_session(sender, Some(&Value::from(live.id())))?;
                require_matching_workspace(&owned.workspace_root(), Some(workspace_root))?;
                Ok::<_, AgentError>(owned)
            })();
            return Ok(match opened {
                Ok(owned) if Some(owned.runtime_id()) != runtime_id => session_open_failure(
                    "SESSION_NOT_FOUND",
                    "Agent runtime does not match the session.",
                    false,
                ),
                Ok(owned) => json!({ "status": "opened", "snapshot": session_snapshot(&owned) }),
                Err(error) => classify_session_open_failure(&error),
            });
        }
        let persisted = self
            .runtime
            .cache()
            .find_by_id(session_id.clone(), Some(workspace_root.to_string()))
            .await?;
        let unavailable = || {
            session_open_failure(
                "SESSION_NOT_FOUND",
                "This saved Agent session is no longer available.",
                false,
            )
        };
        let Some(persisted) = persisted else {
            return Ok(unavailable());
        };
        if persisted["availability"] != "available"
            || Some(resolve_persisted_runtime_id(
                &persisted,
                runtime_id.as_deref(),
            )) != runtime_id
        {
            return Ok(unavailable());
        }
        let request = json!({ "sessionId": session_id, "runtimeId": runtime_id });
        match self.resume_session(sender, &request, workspace_root).await {
            Ok(snapshot) if !snapshot.is_null() => {
                Ok(json!({ "status": "opened", "snapshot": snapshot }))
            }
            Ok(_) => Ok(unavailable()),
            Err(error) => Ok(classify_session_open_failure(&error)),
        }
    }

    /// `lifecycle.closeSession(sender, request, workspaceRoot)`.
    pub async fn close_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let store = self.runtime.store();
        if store.was_closed(sender, request, workspace_root) {
            return Ok(json!({ "sessionId": request["sessionId"], "closed": true }));
        }
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        if request["instanceId"]
            .as_str()
            .is_some_and(|i| !i.is_empty())
        {
            store.assert_instance(sender, request, workspace_root, false)?;
        }
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        let remove = crate::agent::contract::js::truthy_opt(request.get("removePersistence"));
        self.runtime
            .close_session_record(&session, !remove, remove)
            .await?;
        Ok(json!({ "sessionId": session.id(), "closed": true }))
    }

    async fn close_all_of(&self, sessions: Vec<SessionRef>) -> Vec<AgentResult<()>> {
        join_all(
            sessions
                .iter()
                .map(|session| self.runtime.close_session_record(session, true, false)),
        )
        .await
    }

    /// `lifecycle.closeSessionsForWindow(webContentsId)`.
    pub async fn close_sessions_for_window(&self, owner_id: u64) -> AgentResult<()> {
        let sessions: Vec<SessionRef> = self
            .runtime
            .store()
            .values()
            .into_iter()
            .filter(|s| s.owner_id == owner_id)
            .collect();
        for result in self.close_all_of(sessions).await {
            result?;
        }
        if let Some(store) = self
            .runtime
            .attachments()
            .filter(|a| a.supports("revokeOwner"))
        {
            store.revoke_owner(owner_id).await?;
        }
        Ok(())
    }

    /// `lifecycle.closeSessionsForWorkspaceRoot(webContentsId, workspaceRoot)`.
    #[cfg(test)]
    pub async fn close_sessions_for_workspace_root(
        &self,
        owner_id: u64,
        workspace_root: &str,
    ) -> AgentResult<usize> {
        require_workspace_root(Some(workspace_root))?;
        let matching: Vec<SessionRef> = self
            .runtime
            .store()
            .values()
            .into_iter()
            .filter(|s| s.owner_id == owner_id && s.workspace_root() == workspace_root)
            .collect();
        let count = matching.len();
        for result in self.close_all_of(matching).await {
            result?;
        }
        if let Some(store) = self
            .runtime
            .attachments()
            .filter(|a| a.supports("revokeWorkspace"))
        {
            store
                .revoke_workspace(owner_id, workspace_root.to_string())
                .await?;
        }
        Ok(count)
    }

    /// `lifecycle.closeAll()`.
    pub async fn close_all(&self) -> AgentResult<()> {
        let sessions = self.close_all_of(self.runtime.store().values()).await;
        self.runtime.coordinator().clear();
        let attachments = match self.runtime.attachments() {
            Some(store) => store.close().await,
            None => Ok(()),
        };
        let registry = shared(self.runtime.registry().dispose()).await;
        let failed =
            sessions.iter().any(Result::is_err) || attachments.is_err() || registry.is_err();
        if failed {
            return Err(AgentError::new(
                "Agent shutdown could not release every resource.",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn get_retained_session_count(&self) -> usize {
        self.runtime.store().size()
    }

    #[cfg(test)]
    pub fn get_session_count(&self) -> usize {
        self.runtime.store().active_count()
    }

    fn record_runtime_success(
        &self,
        session: &SessionRef,
        selected: &ResolvedRuntime,
        inspection: &Value,
    ) {
        self.runtime.coordinator().record_operation_success(
            &session.runtime_id(),
            &session.workspace_root(),
            &selected.readiness,
            &selected.descriptor,
            inspection,
        );
    }

    fn record_runtime_failure(&self, session: &SessionRef, error: &AgentError) {
        if is_agent_provider_session_unavailable_error(error) || error.is("HISTORY_SOURCE_CHANGED")
        {
            return;
        }
        self.runtime
            .coordinator()
            .record_operation_failure(&session.runtime_id(), &session.workspace_root());
    }
}

//! `application/session/agent-session-commands.mjs`: explicit session
//! management commands.
use super::super::agent_input_policy::{
    normalize_optional_id, normalize_required_id, require_matching_workspace,
    require_workspace_root,
};
use super::agent_history_hydration::hydrate_agent_session;
use super::agent_session_runtime::AgentSessionRuntime;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::domain::agent_session_model::{
    SessionRecordInput, apply_provider_session, create_agent_session_record,
    require_connected_session, session_metadata, session_snapshot,
};
use crate::agent::sender::Sender;
use crate::clock;
use serde_json::{Value, json};

#[derive(Clone)]
pub struct AgentSessionCommands {
    runtime: AgentSessionRuntime,
}

impl AgentSessionCommands {
    pub fn new(runtime: AgentSessionRuntime) -> Self {
        Self { runtime }
    }

    /// `commands.forkSession(sender, request, workspaceRoot)`.
    pub async fn fork_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let source = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&source.workspace_root(), workspace_root)?;
        require_connected_session(&source)?;
        if source.active_turn_id().is_some() {
            return Err(AgentError::new(
                "Stop the active turn before forking this session.",
            ));
        }
        let adapter = source
            .adapter()
            .filter(|a| source.capability("fork") && a.implements("forkSession"));
        let Some(adapter) = adapter else {
            return Err(AgentError::new(
                "The active Agent runtime does not support session forking.",
            ));
        };
        let forked = adapter
            .fork_session(json!({ "messageId": normalize_optional_id(request.get("messageId")) }))
            .await?;
        self.runtime.journal().persist_now(&source).await;
        self.runtime
            .close_session_record(&source, true, false)
            .await?;
        let selected = self
            .runtime
            .resolve_runtime_for_operation(
                Some(&Value::from(source.runtime_id())),
                &source.workspace_root(),
                "fork",
            )
            .await?;
        let (model, effort, mode, title, runtime) = {
            let state = source.state();
            (
                state.selected_model.clone(),
                state.selected_effort.clone(),
                state.selected_mode.clone(),
                state.title.clone(),
                state.runtime.clone(),
            )
        };
        let session = create_agent_session_record(SessionRecordInput {
            id: uuid::Uuid::new_v4().to_string(),
            owner_id: source.owner_id,
            sender: sender.clone(),
            workspace_root: source.workspace_root(),
            runtime_id: source.runtime_id(),
            runtime: Some(runtime),
            model,
            effort,
            mode,
            events: Vec::new(),
            sequence: 0,
            created_at: None,
            title: Some(format!("{title} (fork)")),
            terminal_state: None,
        })?;
        session.state_mut().source_scope_id = source.state().source_scope_id.clone();
        self.runtime.store().add(&session)?;
        let thread_id = forked["providerSessionId"].as_str().map(str::to_string);
        let result = async {
            let adapter = self.runtime.create_adapter_for_session(&session, &selected.readiness)?;
            session.state_mut().adapter = Some(adapter);
            let booted = self
                .runtime
                .bootstrap_native_session(&session, &selected, "resume", thread_id)
                .await?;
            apply_provider_session(&session, &booted.provider_session);
            self.runtime.coordinator().record_operation_success(
                &session.runtime_id(),
                &session.workspace_root(),
                &selected.readiness,
                &selected.descriptor,
                &booted.inspection,
            );
            hydrate_agent_session(&session, self.runtime.journal(), None).await?;
            self.runtime.finish_native_session(&session)?;
            let payload = Obj::from(&session_metadata(&session, None)).set("forkedFrom", source.id()).build();
            self.runtime.journal().emit(
                &session,
                json!({ "type": "session.resumed", "providerSessionId": session.provider_session_id(), "payload": payload }),
            );
            self.runtime.journal().persist_now(&session).await;
            Ok(session_snapshot(&session))
        }
        .await;
        if let Err(error) = &result {
            let _ = error;
            self.runtime
                .coordinator()
                .record_operation_failure(&session.runtime_id(), &session.workspace_root());
            let _ = self
                .runtime
                .close_session_record(&session, false, false)
                .await;
        }
        result
    }

    /// `commands.archiveSession(sender, request, workspaceRoot)`.
    pub async fn archive_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: &str,
    ) -> AgentResult<Value> {
        require_workspace_root(Some(workspace_root))?;
        let session_id = normalize_required_id(request.get("sessionId"), "Agent session id")?;
        match self.runtime.store().get(&session_id) {
            Some(active) => {
                self.runtime
                    .require_owned_session(sender, Some(&Value::from(session_id.as_str())))?;
                require_matching_workspace(&active.workspace_root(), Some(workspace_root))?;
                if active.active_turn_id().is_some() {
                    return Err(AgentError::new(
                        "Stop the active turn before archiving this session.",
                    ));
                }
                if js::truthy_opt(request.get("archiveNative"))
                    && let Some(adapter) = active
                        .adapter()
                        .filter(|a| a.implements("archiveNativeSession"))
                {
                    adapter
                        .archive_native_session(json!({ "threadId": active.provider_session_id() }))
                        .await?;
                }
                self.runtime
                    .close_session_record(&active, true, false)
                    .await?;
            }
            None => {
                self.require_persisted_session_in_workspace(&session_id, workspace_root)
                    .await?
            }
        }
        self.runtime
            .cache()
            .archive(session_id.clone(), clock::now_iso())
            .await?;
        Ok(json!({ "sessionId": session_id, "archived": true }))
    }

    /// `commands.deleteSession(sender, request, workspaceRoot)`.
    pub async fn delete_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: &str,
    ) -> AgentResult<Value> {
        require_workspace_root(Some(workspace_root))?;
        let session_id = normalize_required_id(request.get("sessionId"), "Agent session id")?;
        let delete_native = js::truthy_opt(request.get("deleteNative"));
        let active = self.runtime.store().get(&session_id);
        match &active {
            Some(active) => {
                self.runtime
                    .require_owned_session(sender, Some(&Value::from(session_id.as_str())))?;
                require_matching_workspace(&active.workspace_root(), Some(workspace_root))?;
                if active.active_turn_id().is_some() {
                    return Err(AgentError::new(
                        "Stop the active turn before deleting this session.",
                    ));
                }
                if delete_native
                    && let Some(adapter) = active
                        .adapter()
                        .filter(|a| a.implements("deleteNativeSession"))
                {
                    adapter
                        .delete_native_session(json!({ "threadId": active.provider_session_id() }))
                        .await?;
                }
                self.runtime
                    .close_session_record(active, false, false)
                    .await?;
            }
            None => {
                self.require_persisted_session_in_workspace(&session_id, workspace_root)
                    .await?
            }
        }
        self.runtime.cache().remove(session_id.clone()).await?;
        Ok(
            json!({ "sessionId": session_id, "deleted": true, "nativeDeleted": delete_native && active.is_some() }),
        )
    }

    /// `commands.compactSession(sender, request, workspaceRoot)`.
    pub async fn compact_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let session = self
            .runtime
            .require_owned_session(sender, request.get("sessionId"))?;
        require_matching_workspace(&session.workspace_root(), workspace_root)?;
        require_connected_session(&session)?;
        if session.active_turn_id().is_some() {
            return Err(AgentError::new(
                "Stop the active turn before compacting this session.",
            ));
        }
        let adapter = session
            .adapter()
            .filter(|a| session.capability("compaction") && a.implements("compactSession"));
        let Some(adapter) = adapter else {
            return Err(AgentError::new(
                "The active Agent runtime does not support session compaction.",
            ));
        };
        adapter.compact_session().await?;
        Ok(json!({ "sessionId": session.id(), "compacted": true }))
    }

    async fn require_persisted_session_in_workspace(
        &self,
        session_id: &str,
        workspace_root: &str,
    ) -> AgentResult<()> {
        let persisted = self
            .runtime
            .cache()
            .find_by_id(session_id.to_string(), Some(workspace_root.to_string()))
            .await?;
        if persisted.is_none() {
            return Err(AgentError::new(
                "Agent session was not found in the assigned workspace.",
            ));
        }
        Ok(())
    }
}

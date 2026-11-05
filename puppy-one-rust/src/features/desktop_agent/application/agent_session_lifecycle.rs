//! `application/AgentSessionLifecycle.ts`: owns one tab's live connection;
//! durable locator indexing remains Main-owned.
use super::agent_client_port::{AgentClientProvider, require_bridge};
use super::agent_controller_state::{AgentControllerPhase, AgentSessionPreparation, StatePatch};
use super::agent_error::{create_agent_error, format_agent_error};
use super::agent_session_controller::{AgentControllerStore, ApplySnapshot, CreateSession};
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::display_state::create_empty_agent_display;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::rc::Rc;

pub struct AgentSessionLifecycleOptions {
    pub workspace_root: String,
    pub bridge_provider: AgentClientProvider,
    pub store: Rc<AgentControllerStore>,
    pub create_session: CreateSession,
    pub apply_snapshot: ApplySnapshot,
    pub delete_session_ui: Rc<dyn Fn(&str)>,
}

#[derive(Clone)]
pub struct AgentSessionLifecycle(Rc<AgentSessionLifecycleOptions>);

impl AgentSessionLifecycle {
    pub fn new(options: AgentSessionLifecycleOptions) -> Self {
        Self(Rc::new(options))
    }

    pub fn new_session(&self) -> LocalBoxFuture<'static, ()> {
        let options = self.0.clone();
        let (running, previous_session_id) = options.store.read(|state| {
            (
                state.running_turn_id().is_some(),
                state.session_id().map(str::to_string),
            )
        });
        if running {
            options
                .store
                .patch(StatePatch::new().error(Some(create_agent_error("active-turn", None))));
            return Box::pin(async {});
        }
        let close = self.close_active_session(false);
        Box::pin(async move {
            let result: AgentResult<()> = async {
                close.await?;
                if let Some(previous) = previous_session_id.as_deref() {
                    (options.delete_session_ui)(previous);
                }
                options.store.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::Creating)
                        .session(None)
                        .projection(create_empty_agent_display())
                        .error(None)
                        .pending_prompt(None)
                        .pending_intent(None)
                        .session_preparation(AgentSessionPreparation::Preparing)
                        .submitting(false)
                        .references(Vec::new())
                        .draft_mentions(Vec::new()),
                );
                let snapshot = (options.create_session)().await?;
                (options.apply_snapshot)(snapshot).await?;
                options
                    .store
                    .patch(StatePatch::new().phase(AgentControllerPhase::Ready));
                Ok(())
            }
            .await;
            if let Err(error) = result {
                options.store.patch(
                    StatePatch::new()
                        .phase(AgentControllerPhase::Failed)
                        .error(Some(format_agent_error(&error)))
                        .session_preparation(AgentSessionPreparation::Failed),
                );
            }
        })
    }

    pub fn compact_session(&self) -> LocalBoxFuture<'static, ()> {
        let options = self.0.clone();
        let Some(session_id) = options
            .store
            .read(|state| state.session_id().map(str::to_string))
        else {
            return Box::pin(async {});
        };
        let call =
            require_bridge(&options.bridge_provider, &["compactAgentSession"]).map(|bridge| {
                bridge.call(
                    "compactAgentSession",
                    json!({ "rootPath": options.workspace_root, "sessionId": session_id }),
                )
            });
        Box::pin(async move {
            let result = match call {
                Ok(call) => call.await,
                Err(error) => Err(error),
            };
            if let Err(error) = result {
                options
                    .store
                    .patch(StatePatch::new().error(Some(format_agent_error(&error))));
            }
        })
    }

    /// The termination receipt (`ItemCloseResult`), `true` once the session
    /// closed, or `false`.
    pub fn close_session(&self) -> LocalBoxFuture<'static, Value> {
        let options = self.0.clone();
        let bridge = (options.bridge_provider)();
        let closing: LocalBoxFuture<'static, AgentResult<Value>> =
            match bridge.filter(|b| b.implements("terminateAgentExecution")) {
                Some(bridge) => bridge.call("terminateAgentExecution", Value::Null),
                None => {
                    let close = self.close_active_session(false);
                    Box::pin(async move { close.await.map(|()| Value::Bool(true)) })
                }
            };
        Box::pin(async move {
            closing.await.unwrap_or_else(|error| {
                options
                    .store
                    .patch(StatePatch::new().error(Some(format_agent_error(&error))));
                Value::Bool(false)
            })
        })
    }

    /// Releases a native session created while Workbench topology was only
    /// reserved. No committed tab owns this resource, so active-turn close
    /// policy does not apply to rollback.
    pub fn rollback_preparation(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
        let bridge = (self.0.bridge_provider)();
        if let Some(bridge) = bridge.filter(|b| b.implements("terminateAgentExecution")) {
            let call = bridge.call("terminateAgentExecution", Value::Null);
            return Box::pin(async move { call.await.map(|_| ()) });
        }
        self.close_active_session(false)
    }

    fn close_active_session(
        &self,
        remove_persistence: bool,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        let options = &self.0;
        let session = options.store.read(|state| state.session.clone());
        let Some(session_id) = session
            .as_ref()
            .and_then(|s| s["id"].as_str())
            .filter(|id| !id.is_empty())
        else {
            return Box::pin(async { Ok(()) });
        };
        let bridge = (options.bridge_provider)();
        let Some(bridge) = bridge.filter(|b| b.implements("closeAgentSession")) else {
            return Box::pin(async { Ok(()) });
        };
        let mut request = json!({
            "rootPath": options.workspace_root,
            "sessionId": session_id,
            "removePersistence": remove_persistence,
        });
        if let Some(instance_id) = session
            .as_ref()
            .and_then(|s| s["instanceId"].as_str())
            .filter(|id| !id.is_empty())
        {
            request["instanceId"] = Value::from(instance_id);
        }
        let call = bridge.call("closeAgentSession", request);
        Box::pin(async move { call.await.map(|_| ()) })
    }
}

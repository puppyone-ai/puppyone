//! `application/AgentSessionLifecycle.ts`: owns one tab's live connection;
//! durable locator indexing remains Main-owned.
use super::agent_client_port::{AgentClient as _, AgentClientProvider, require_bridge};
use super::agent_controller_state::{AgentControllerPhase, AgentSessionPreparation, StatePatch};
use super::agent_error::{create_agent_error, format_agent_error};
use super::agent_session_controller::{AgentControllerStore, ApplySnapshot, CreateSessionFn};
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::dto::{AgentProjection, Receipt};
use crate::agent::contract::protocol::{AgentOperation, CloseSession, CompactSession};
use futures_util::future::LocalBoxFuture;
use std::rc::Rc;

/// `ItemCloseResult`: the session closed, stayed open, or the execution
/// host's termination receipt.
#[derive(Clone, Debug, PartialEq)]
pub enum CloseOutcome {
    Closed,
    Kept,
    Terminated(Receipt),
}

impl CloseOutcome {
    /// Whether the tab may go (the product's truthy result).
    pub fn closed(&self) -> bool {
        !matches!(self, Self::Kept)
    }
}

pub struct AgentSessionLifecycleOptions {
    pub workspace_root: String,
    pub bridge_provider: AgentClientProvider,
    pub store: Rc<AgentControllerStore>,
    pub create_session: CreateSessionFn,
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
                        .projection(AgentProjection::default())
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
        let call = require_bridge(&options.bridge_provider, &[AgentOperation::CompactSession]).map(
            |bridge| {
                bridge.compact_session(CompactSession {
                    root_path: options.workspace_root.clone(),
                    session_id,
                    ..CompactSession::default()
                })
            },
        );
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

    /// The termination receipt (`ItemCloseResult`), closed once the
    /// session closed, or kept.
    pub fn close_session(&self) -> LocalBoxFuture<'static, CloseOutcome> {
        let options = self.0.clone();
        let bridge = (options.bridge_provider)();
        let closing: LocalBoxFuture<'static, AgentResult<CloseOutcome>> =
            match bridge.filter(|b| b.supports(AgentOperation::TerminateExecution)) {
                Some(bridge) => {
                    let call = bridge.terminate_execution();
                    Box::pin(async move { call.await.map(CloseOutcome::Terminated) })
                }
                None => {
                    let close = self.close_active_session(false);
                    Box::pin(async move { close.await.map(|()| CloseOutcome::Closed) })
                }
            };
        Box::pin(async move {
            closing.await.unwrap_or_else(|error| {
                options
                    .store
                    .patch(StatePatch::new().error(Some(format_agent_error(&error))));
                CloseOutcome::Kept
            })
        })
    }

    /// Releases a native session created while Workbench topology was only
    /// reserved. No committed tab owns this resource, so active-turn close
    /// policy does not apply to rollback.
    pub fn rollback_preparation(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
        let bridge = (self.0.bridge_provider)();
        if let Some(bridge) = bridge.filter(|b| b.supports(AgentOperation::TerminateExecution)) {
            let call = bridge.terminate_execution();
            return Box::pin(async move { call.await.map(drop) });
        }
        self.close_active_session(false)
    }

    fn close_active_session(
        &self,
        remove_persistence: bool,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        let options = &self.0;
        let session = options.store.read(|state| state.session.clone());
        let Some(session) = session.filter(|s| !s.id.is_empty()) else {
            return Box::pin(async { Ok(()) });
        };
        let bridge = (options.bridge_provider)();
        let Some(bridge) = bridge.filter(|b| b.supports(AgentOperation::CloseSession)) else {
            return Box::pin(async { Ok(()) });
        };
        let call = bridge.close_session(CloseSession {
            root_path: options.workspace_root.clone(),
            session_id: session.id.clone(),
            instance_id: session.instance().map(str::to_string),
            remove_persistence: Some(remove_persistence),
        });
        Box::pin(async move { call.await.map(drop) })
    }
}

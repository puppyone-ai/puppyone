//! `runtime/agent-runtime-port.mjs`: the provider-neutral port every
//! runtime adapter implements. Application code holds no provider method
//! names or wire envelopes; requests and results are the product's plain
//! objects.
use super::agent_session_history_port::{
    SessionHistoryPort, assert_agent_session_history_capabilities,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::agent::contract::runtime_schema::{
    assert_agent_inspection, assert_agent_runtime_capabilities,
};
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::rc::Rc;

/// An adapter operation (`Promise<…>`).
pub type AdapterFuture<'a, T> = LocalBoxFuture<'a, AgentResult<T>>;

/// What a runtime definition creates an adapter with.
#[derive(Clone)]
pub struct AdapterOptions {
    /// The runtime's (internal) readiness, with `workspaceRoot`.
    pub readiness: Value,
    pub workspace_root: String,
    /// `onEvent(event)`: an adapter-normalized event (`{ type, turnId?, … }`).
    pub on_event: Rc<dyn Fn(Value)>,
    /// `onExit(info)`.
    pub on_exit: Rc<dyn Fn(Value)>,
    /// `onSessionPersisted(identity)`.
    pub on_session_persisted: Option<Rc<dyn Fn(Value)>>,
}

impl AdapterOptions {
    /// Options for a catalog inspection or History query: events are ignored.
    pub fn detached(readiness: Value, workspace_root: &str) -> Self {
        Self {
            readiness,
            workspace_root: workspace_root.to_string(),
            on_event: Rc::new(|_| {}),
            on_exit: Rc::new(|_| {}),
            on_session_persisted: None,
        }
    }
}

fn unsupported<'a, T: 'a>(method: &str) -> AdapterFuture<'a, T> {
    let error = AgentError::new(format!(
        "The active Agent runtime does not implement {method}()."
    ));
    Box::pin(async move { Err(error) })
}

/// One live native connection. The required methods are the trait's
/// required methods; an optional method exists when [`Self::implements`]
/// names it (`typeof adapter.method === "function"`).
pub trait AgentRuntimeAdapter {
    fn inspect(&self) -> AdapterFuture<'_, Value>;
    fn create_session(&self, selection: Value) -> AdapterFuture<'_, Value>;
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value>;
    /// Resolves with `{ turnId }`.
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value>;
    fn interrupt_turn(&self, request: Value) -> AdapterFuture<'_, Value>;
    fn dispose(&self) -> AdapterFuture<'_, ()>;

    /// Whether the optional method `name` exists.
    fn implements(&self, _name: &str) -> bool {
        false
    }
    fn bootstrap_session(&self, _request: Value) -> AdapterFuture<'_, Value> {
        unsupported("bootstrapSession")
    }
    fn steer_turn(&self, _request: Value) -> AdapterFuture<'_, Value> {
        unsupported("steerTurn")
    }
    fn resolve_approval(&self, _request: Value) -> AdapterFuture<'_, Value> {
        unsupported("resolveApproval")
    }
    fn resolve_question(&self, _request: Value) -> AdapterFuture<'_, Value> {
        unsupported("resolveQuestion")
    }
    fn fork_session(&self, _request: Value) -> AdapterFuture<'_, Value> {
        unsupported("forkSession")
    }
    fn compact_session(&self) -> AdapterFuture<'_, Value> {
        unsupported("compactSession")
    }
    fn archive_native_session(&self, _request: Value) -> AdapterFuture<'_, Value> {
        unsupported("archiveNativeSession")
    }
    fn delete_native_session(&self, _request: Value) -> AdapterFuture<'_, Value> {
        unsupported("deleteNativeSession")
    }
    /// `referenceMentionDelivery(reference)`: `"path"` or `"resource"`.
    fn reference_mention_delivery(&self, _reference: &Value) -> Option<&'static str> {
        None
    }
    /// `getSessionHistoryPort()`.
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        None
    }
}

/// `AgentProviderSessionUnavailableError`: a persisted native conversation
/// points at a provider thread that no longer exists. This is a recoverable
/// cache miss, not a runtime-readiness failure.
pub fn agent_provider_session_unavailable_error(message: Option<&str>) -> AgentError {
    AgentError::coded(
        "AGENT_PROVIDER_SESSION_UNAVAILABLE",
        message.unwrap_or("The native Agent session is no longer available."),
    )
    .with_name("AgentProviderSessionUnavailableError")
}

/// `isAgentProviderSessionUnavailableError(error)`.
pub fn is_agent_provider_session_unavailable_error(error: &AgentError) -> bool {
    error.is("AGENT_PROVIDER_SESSION_UNAVAILABLE")
}

/// `assertAgentRuntimeInspection(adapter, inspection, runtimeId)`.
pub fn assert_agent_runtime_inspection(
    adapter: &dyn AgentRuntimeAdapter,
    inspection: &Value,
    runtime_id: &str,
) -> AgentResult<Value> {
    assert_agent_inspection(inspection)?;
    let capabilities = assert_agent_runtime_capabilities(
        |method| adapter.implements(method),
        inspection.get("capabilities").unwrap_or(&Value::Null),
        runtime_id,
    )?;
    assert_agent_session_history_capabilities(adapter, &capabilities, runtime_id)?;
    Ok(js::with(inspection, "capabilities", capabilities))
}

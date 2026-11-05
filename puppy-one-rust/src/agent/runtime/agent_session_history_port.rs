//! `runtime/agent-session-history-port.mjs`: the optional History method
//! group of an adapter.
use super::agent_runtime_port::{AdapterFuture, AgentRuntimeAdapter};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::native_session_id::native_session_id;
use crate::agent::event_loop::AbortSignal;
use serde_json::Value;
use std::rc::Rc;

/// `SessionHistoryPort`.
pub trait SessionHistoryPort {
    /// `port.sourceScopeId`.
    fn source_scope_id(&self) -> Option<String>;
    /// Whether `discover` or `hydrate` exists.
    fn implements(&self, method: &str) -> bool;
    /// `port.discover({ cursor, limit, signal })`.
    fn discover(
        &self,
        _cursor: Option<String>,
        _limit: usize,
        _signal: AbortSignal,
    ) -> AdapterFuture<'_, Value> {
        Box::pin(async { Err(AgentError::new("History discovery is unsupported.")) })
    }
    /// `port.hydrate({ signal })`.
    fn hydrate(&self, _signal: AbortSignal) -> AdapterFuture<'_, Value> {
        Box::pin(async { Err(AgentError::new("History hydration is unsupported.")) })
    }
}

/// `resolveAgentSessionHistoryPort(adapter)`.
pub fn resolve_agent_session_history_port(
    adapter: &dyn AgentRuntimeAdapter,
) -> AgentResult<Option<Rc<dyn SessionHistoryPort>>> {
    let Some(port) = adapter.session_history_port() else {
        return Ok(None);
    };
    if let Some(scope) = port.source_scope_id()
        && native_session_id(Some(&Value::from(scope.as_str()))).is_none()
    {
        return Err(
            AgentError::new("Agent History source identity is invalid.").with_name("TypeError")
        );
    }
    Ok(Some(port))
}

/// `assertAgentSessionHistoryCapabilities(adapter, capabilities, runtimeId)`:
/// History is optional, but an advertised operation can never be
/// half-present.
pub fn assert_agent_session_history_capabilities(
    adapter: &dyn AgentRuntimeAdapter,
    capabilities: &Value,
    runtime_id: &str,
) -> AgentResult<()> {
    let Some(profile) = capabilities.get("history").filter(|h| h.is_object()) else {
        return Ok(());
    };
    let type_error = |message: String| AgentError::new(message).with_name("TypeError");
    let field = |key: &str| profile[key].as_str().unwrap_or("");
    if !matches!(field("discovery"), "unsupported" | "paged") {
        return Err(type_error(format!(
            "Agent runtime {runtime_id} has an invalid History discovery capability."
        )));
    }
    if !matches!(field("exactOpen"), "unsupported" | "supported") {
        return Err(type_error(format!(
            "Agent runtime {runtime_id} has an invalid History exact-open capability."
        )));
    }
    if !matches!(
        field("hydration"),
        "unsupported" | "push-replay" | "snapshot" | "paged"
    ) {
        return Err(type_error(format!(
            "Agent runtime {runtime_id} has an invalid History hydration capability."
        )));
    }
    let port = resolve_agent_session_history_port(adapter)?;
    let has = |method: &str| port.as_ref().is_some_and(|p| p.implements(method));
    if field("discovery") == "paged" && !has("discover") {
        return Err(type_error(format!(
            "Agent runtime {runtime_id} advertises paged History discovery but has no SessionHistoryPort.discover()."
        )));
    }
    if field("exactOpen") == "supported" && capabilities["resume"] != true {
        return Err(type_error(format!(
            "Agent runtime {runtime_id} advertises exact History open without native resume support."
        )));
    }
    if field("hydration") != "unsupported" && !has("hydrate") {
        return Err(type_error(format!(
            "Agent runtime {runtime_id} advertises History hydration but has no SessionHistoryPort.hydrate()."
        )));
    }
    let supported = field("discovery") != "unsupported"
        || field("exactOpen") != "unsupported"
        || field("hydration") != "unsupported";
    if capabilities["sessionHistory"] != supported {
        return Err(type_error(format!(
            "Agent runtime {runtime_id} has an inconsistent sessionHistory compatibility projection."
        )));
    }
    Ok(())
}

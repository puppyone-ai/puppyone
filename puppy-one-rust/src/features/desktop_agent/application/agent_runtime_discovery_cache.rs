//! `application/agent-runtime-discovery-cache.ts`.
use super::agent_controller_state::{AgentControllerPhase, AgentControllerState};

pub const AGENT_RUNTIME_DISCOVERY_CACHE_TTL_MS: i64 = 5 * 60_000;

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|v| !v.is_empty())
}

/// `hasFreshAgentRuntimeInspection(state, inspectedAt, now)`: keeps
/// presentation remounts from probing local Agent installations again.
pub fn has_fresh_agent_runtime_inspection(
    state: &AgentControllerState,
    inspected_at: i64,
    now: i64,
) -> bool {
    let Some(inspection) = state.inspection.as_ref() else {
        return false;
    };
    if !state.initialized
        || matches!(
            state.phase,
            AgentControllerPhase::Failed | AgentControllerPhase::RuntimeExited
        )
    {
        return false;
    }
    if state.session.is_some() {
        return true;
    }
    let readiness = inspection.readiness.as_ref();
    let inspected_runtime_id = non_empty(inspection.selected_runtime_id.as_deref())
        .or_else(|| non_empty(inspection.runtime.as_ref().map(|r| r.id.as_str())))
        .or_else(|| non_empty(readiness.and_then(|r| r.runtime_id.as_deref())))
        .or_else(|| non_empty(readiness.map(|r| r.provider.as_str())));
    inspected_runtime_id == state.selected_runtime_id.as_deref()
        && inspected_at > 0
        && now - inspected_at < AGENT_RUNTIME_DISCOVERY_CACHE_TTL_MS
}

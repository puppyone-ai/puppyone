//! `application/agent-runtime-selection.ts`.
use super::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentSessionPreparation, StatePatch,
};
use crate::agent::contract::dto::AgentProjection;
use crate::features::desktop_agent::domain::agent_backend_routing::list_agent_runtimes;

/// `AgentRuntimeSwitchPlan`.
#[derive(Debug)]
pub struct AgentRuntimeSwitchPlan {
    pub already_selected: bool,
    pub session_id: Option<String>,
    pub patch: StatePatch,
}

/// `planAgentRuntimeSwitch(state, runtimeId)`: the Renderer-only state
/// transition; native session ownership remains behind the client port.
pub fn plan_agent_runtime_switch(
    state: &AgentControllerState,
    runtime_id: &str,
) -> Option<AgentRuntimeSwitchPlan> {
    if state.running_turn_id().is_some()
        || state.submitting
        || state
            .pending_prompt
            .as_deref()
            .is_some_and(|p| !p.is_empty())
        || state.session_preparation == AgentSessionPreparation::Preparing
        || matches!(
            state.phase,
            AgentControllerPhase::Discovering
                | AgentControllerPhase::Restoring
                | AgentControllerPhase::Creating
        )
    {
        return None;
    }
    list_agent_runtimes(state.inspection.as_ref())
        .iter()
        .find(|entry| entry.descriptor.id == runtime_id)?;
    let session_id = state.session_id().map(str::to_string);
    if state.selected_runtime_id.as_deref() == Some(runtime_id) {
        return Some(AgentRuntimeSwitchPlan {
            already_selected: true,
            session_id,
            patch: StatePatch::new(),
        });
    }
    Some(AgentRuntimeSwitchPlan {
        already_selected: false,
        session_id,
        patch: StatePatch::new()
            .phase(AgentControllerPhase::Discovering)
            .session(None)
            .projection(AgentProjection::default())
            .selected_runtime_id(Some(runtime_id.to_string()))
            .selected_provider_id(None)
            .selected_model(None)
            .selected_effort(None)
            .selected_mode(None)
            .draft(String::new())
            .pending_prompt(None)
            .pending_intent(None)
            .session_preparation(AgentSessionPreparation::Idle)
            .references(Vec::new())
            .draft_mentions(Vec::new())
            .error(None),
    })
}

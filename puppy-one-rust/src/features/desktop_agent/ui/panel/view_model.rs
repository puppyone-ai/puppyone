//! A chat's view model under its container's policy: hidden runtimes,
//! presentation, a pending model connection, compute and routing. A
//! container without that policy (the hosted Agent's conversation) takes
//! the defaults.
use super::super::agent_chat_view_model::{
    AgentChatViewModel, AgentChatViewOptions, derive_agent_chat_runtime,
    derive_agent_chat_view_model,
};
use super::compute::{ComputeSnapshot, derive_compute};
use super::routing::{AgentRouting, pending_preferences};
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;

/// What the panel adds to a chat's state.
pub(super) struct ChatPolicy<'a> {
    pub hidden_runtime_ids: &'a [String],
    pub presented: bool,
    pub pending_connection_model: Option<String>,
    pub compute: Option<&'a ComputeSnapshot>,
    pub payments: bool,
    pub compute_access_prompt: bool,
    pub routing: &'a AgentRouting,
}

pub(super) fn chat_view_model(
    state: &AgentControllerState,
    policy: &ChatPolicy<'_>,
) -> AgentChatViewModel {
    let runtime = derive_agent_chat_runtime(state, policy.hidden_runtime_ids);
    let compute = derive_compute(
        policy.compute,
        &runtime.runtime_models,
        policy.payments,
        state.selected_model.as_deref(),
        policy.compute_access_prompt,
    );
    let preferences_ready =
        pending_preferences(state, &runtime.runtime_models, policy.routing).ready();
    derive_agent_chat_view_model(
        state,
        runtime,
        &AgentChatViewOptions {
            presented: policy.presented,
            pending_connection_model: policy.pending_connection_model.clone(),
            compute_ready: compute.ready,
            compute_access_required: compute.access_required.map(str::to_string),
            preferences_ready,
        },
    )
}

/// The view model under the default policy: no hidden runtime, compute
/// snapshot, Payments or routing preference.
pub fn default_chat_view_model(
    state: &AgentControllerState,
    presented: bool,
) -> AgentChatViewModel {
    chat_view_model(
        state,
        &ChatPolicy {
            hidden_runtime_ids: &[],
            presented,
            pending_connection_model: None,
            compute: None,
            payments: false,
            compute_access_prompt: false,
            routing: &AgentRouting::default(),
        },
    )
}

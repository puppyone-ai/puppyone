//! Presentation components for Home (`components/onboarding/*` in `qubits`):
//! pure `RenderOnce` elements with semantic `Theme` tokens and explicit props.
mod agent_brand_mark;
mod layout;
mod space_agents;
mod start_actions;

pub(in crate::app::home) use agent_brand_mark::HomepageAgentBrandMark;
pub(in crate::app::home) use layout::{
    OnboardingBrandLockup, OnboardingHomeLayout, OnboardingHomeState,
};
pub(in crate::app::home) use space_agents::SpaceAgents;
pub(in crate::app::home) use start_actions::{
    OnboardingCreateProjectAction, OnboardingEntryActions, OnboardingStartActions, create_action,
};

//! Presentation components for Home (`components/onboarding/*` in `qubits`):
//! pure `RenderOnce` elements with semantic `Theme` tokens and explicit props.
mod agent_strip;
mod layout;
mod start_actions;

pub(in crate::app::home) use agent_strip::{HomepageAgentBrandMark, HomepageAgentStrip};
pub(in crate::app::home) use layout::{
    OnboardingBrandLockup, OnboardingHomeLayout, OnboardingHomeState,
};
pub(in crate::app::home) use start_actions::{
    OnboardingCreateProjectAction, OnboardingEntryActions, OnboardingStartActions,
};

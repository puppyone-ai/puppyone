//! `electron/main/local-agent-installation`: which local Agent installations
//! exist and which executable each one launches. Setup and activation live
//! in `local_agent_setup`.
pub mod candidate_identity;
pub mod definitions;
pub mod executable_resolver;
pub mod installation_definition;
pub mod installation_registry;
pub mod managed_installation_layout;
#[cfg(all(test, unix))]
mod tests;

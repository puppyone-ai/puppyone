//! `electron/main/agent/application`: the provider-neutral Agent service
//! and the coordinators it is composed from.
pub mod agent_event_journal;
pub mod agent_input_policy;
pub mod agent_reference_policy;
pub mod agent_runtime_catalog;
pub mod agent_service;
pub mod agent_session_store;
pub mod history;
pub mod ports;
pub mod processes;
pub mod runtime_resolution;
pub mod session;
#[cfg(test)]
pub(crate) mod tests;
#[cfg(test)]
pub mod tests_support;
pub mod turn;

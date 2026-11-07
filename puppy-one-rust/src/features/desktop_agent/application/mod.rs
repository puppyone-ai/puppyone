//! `src/features/desktop-agent/application`: the Renderer's Agent
//! controllers over the client port.
pub mod agent_client_port;
pub mod agent_controller_registry;
pub mod agent_controller_state;
pub mod agent_controller_values;
pub mod agent_error;
pub mod agent_reference_draft_manager;
pub mod agent_reference_preview_store;
pub mod agent_runtime_discovery_cache;
pub mod agent_runtime_selection;
pub mod agent_session_controller;
pub mod agent_session_lifecycle;
pub mod agent_session_preparer;
pub mod agent_session_replica;
pub mod agent_turn_submission_coordinator;
pub mod conversation_history_controller;
pub mod session_ui_state_store;
#[cfg(test)]
mod tests;
pub mod ui_runtime;

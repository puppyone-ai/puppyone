//! `electron/main/agent/protocols/acp`: the Agent Client Protocol.
pub mod acp_client;
pub mod acp_event_normalizer;
pub mod acp_history_discovery;
pub mod acp_history_replay;
pub mod acp_interactions;
pub mod acp_limits;
pub mod acp_methods;
pub mod acp_native_values;
pub mod acp_prompt_input;
pub mod acp_runtime_adapter;
pub mod acp_session_config;
#[cfg(test)]
mod tests;

//! `electron/main/agent/runtimes/claude`: Claude Code through the official
//! Agent SDK.
pub mod claude_agent_sdk;
pub mod claude_agent_sdk_adapter;
pub mod claude_discovery;
pub mod claude_events;
pub mod claude_history_discovery;
pub mod claude_history_reader;
pub mod claude_history_source;
pub mod claude_identity;
pub mod claude_interactions;
pub mod claude_message_channel;
pub mod claude_native_values;
pub mod claude_prompt_input;
pub mod claude_runtime_definition;
pub mod claude_spawn;
#[cfg(test)]
mod tests;

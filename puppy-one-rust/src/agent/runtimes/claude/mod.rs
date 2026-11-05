//! `electron/main/agent/runtimes/claude`: Claude Code through the official
//! Agent SDK.
#[allow(dead_code)]
pub mod claude_agent_sdk;
#[allow(dead_code)]
pub mod claude_agent_sdk_adapter;
#[allow(dead_code)]
pub mod claude_discovery;
#[allow(dead_code)]
pub mod claude_events;
#[allow(dead_code)]
pub mod claude_history_discovery;
#[allow(dead_code)]
pub mod claude_history_reader;
#[allow(dead_code)]
pub mod claude_history_source;
#[allow(dead_code)]
pub mod claude_identity;
#[allow(dead_code)]
pub mod claude_interactions;
#[allow(dead_code)]
pub mod claude_message_channel;
#[allow(dead_code)]
pub mod claude_native_values;
#[allow(dead_code)]
pub mod claude_prompt_input;
#[allow(dead_code)]
pub mod claude_runtime_definition;
#[allow(dead_code)]
pub mod claude_spawn;
pub mod legacy_claude_adapter;
mod legacy_history;
#[cfg(test)]
mod tests;

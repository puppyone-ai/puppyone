//! Local Agents (`features/local-agents`): installing and activating an
//! Agent CLI on this computer ([`setup`]: the activation store, the setup
//! section in Settings and the workbench launcher, the activation dialog)
//! and the Settings page that lists the detected Agents with their Hooks
//! ([`settings`]), and the chat runtimes of the detected Agents.
mod chat_recipes;
pub mod settings;
pub mod setup;

pub use chat_recipes::{agent_chat_runtime_id, hidden_agent_chat_runtime_ids};

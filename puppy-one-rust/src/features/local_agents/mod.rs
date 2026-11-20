//! Local Agents (`features/local-agents`): installing and activating an
//! Agent CLI on this computer ([`setup`]: the activation store, the setup
//! section in Settings and the workbench launcher, the activation dialog)
//! and the Settings page that lists the detected Agents with their Hooks
//! ([`settings`]), and the chat runtimes of the detected Agents.
mod chat_recipes;
mod discovery;
pub(crate) use discovery::{
    Installations, RepairResult, repair_codex, store as installation_store,
};
mod settings;
mod setup;

pub use chat_recipes::{
    LOCAL_AGENT_CHAT_RECIPES, agent_chat_runtime_id, hidden_agent_chat_runtime_ids,
    local_agent_id_for_agent_chat_runtime,
};
pub use settings::AgentSettings;
pub(crate) use setup::ActivationDialog;
pub use setup::{InstallationsChanged, Presentation, SetupSection, store as activation_store};

//! `desktop-agent`: the Agent window. Its application layer talks to the
//! Agent host through a typed client port, its views read the typed display
//! model, and [`workbench`] contributes the chat tab to the Workbench.
mod application;
mod domain;
#[cfg(any(test, feature = "dev-capture"))]
mod fixtures;
mod infrastructure;
mod ui;
mod workbench;

pub use application::ui_runtime::UiRuntime;
pub use domain::agent_workspace_path::resolve_agent_workspace_provider_path;
pub use infrastructure::host::agent_host_global::CloudCompute;

pub use domain::agent_chat_history_target::AuxiliaryWorkbenchHistoryTarget as HistoryTarget;
pub use ui::agent_brand_mark::{LauncherIdentity, launcher_icon, runtime_for_icon_key};
pub use ui::agent_conversation_history::{HistoryBrowser, HistoryBrowserEvent};
pub use ui::panel::bind_keys;
#[cfg(feature = "dev-capture")]
pub use workbench::{AgentChatItem, lab_history_browser};
// What other features' tests drive.
#[cfg(test)]
pub use domain::agent_chat_history_target::AgentChatHistoryPayload;
#[cfg(test)]
pub use infrastructure::cloud::{CloudAgentController, Hub, LABEL as HOSTED_AGENT_LABEL};
#[cfg(test)]
pub use ui::panel::AgentChatTabPanel;
pub use workbench::{AgentChats, hosted_installation};

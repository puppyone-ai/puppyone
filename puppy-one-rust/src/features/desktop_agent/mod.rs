//! `desktop-agent`: the Agent window. Its application layer talks to the
//! Agent host through a typed client port, its views read the typed display
//! model, and [`workbench`] contributes the chat tab to the Workbench.
pub mod application;
pub mod domain;
#[cfg(any(test, feature = "dev-capture"))]
pub mod fixtures;
pub mod infrastructure;
pub mod ui;
pub mod workbench;

pub use domain::agent_chat_history_target::AuxiliaryWorkbenchHistoryTarget as HistoryTarget;
pub use ui::agent_brand_mark::{LauncherIdentity, launcher_icon, runtime_for_icon_key};
pub use ui::agent_conversation_history::{HistoryBrowser, HistoryBrowserEvent};
pub use ui::panel::bind_keys;
#[cfg(feature = "dev-capture")]
pub use workbench::{AgentChatItem, lab_history_browser};
pub use workbench::{AgentChats, hosted_installation};

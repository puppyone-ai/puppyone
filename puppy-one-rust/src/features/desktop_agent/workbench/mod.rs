//! `desktop-agent/workbench`: the Agent chat's Workbench contribution. Its
//! items implement the Workbench's [`WorkbenchItem`]; the shell's launcher
//! creates them through [`AgentChats`].
//!
//! [`WorkbenchItem`]: crate::features::workbench::WorkbenchItem
mod chats;
mod item;
#[cfg(feature = "dev-capture")]
mod lab;

pub use chats::{AgentChats, OpenFailure};
#[cfg(feature = "dev-capture")]
pub use item::AgentChatItem;
pub use item::{agent_chat_close_copy, present_agent_chat_workbench_item};
#[cfg(feature = "dev-capture")]
pub use lab::lab_history_browser;

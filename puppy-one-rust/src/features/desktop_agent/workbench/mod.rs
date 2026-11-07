//! `desktop-agent/workbench`: the Agent chat's Workbench contribution. Its
//! items implement the Workbench's [`WorkbenchItem`]; the Workbench reaches
//! the chat only through [`AgentChats`] and these items.
//!
//! [`WorkbenchItem`]: crate::features::workbench::WorkbenchItem
mod chats;
mod item;
#[cfg(feature = "dev-capture")]
mod lab;

pub use chats::{AgentChats, hosted_installation};
#[cfg(feature = "dev-capture")]
pub use item::AgentChatItem;
#[cfg(feature = "dev-capture")]
pub use lab::lab_history_browser;

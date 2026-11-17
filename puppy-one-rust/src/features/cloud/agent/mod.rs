//! The hosted Agent (`features/cloud/agent`): its controller and Hub, the
//! projection of its runs, its History, and its conversation, which
//! composes the Agent window's shared chat views.
mod chats;
mod controller;
mod conversation;
mod history;
mod item;
mod projection;

pub use chats::{HostedChats, hosted_installation};
pub use controller::*;
#[cfg(test)]
pub use conversation::CloudAgentConversation;
pub use history::HostedHistory;
pub use projection::project_cloud_agent_runs;

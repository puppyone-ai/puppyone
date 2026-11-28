//! `CloudAgentWorkbench`'s tab in the workbench: a hosted chat never stops
//! its run when its tab closes, and an unconfirmed submission keeps the tab.
use super::conversation::{CloudAgentConversation, ConversationEvent};
use crate::agent::connections::legacy_runtime_registry::Runtime;
use crate::features::desktop_agent::{agent_chat_close_copy, present_agent_chat_workbench_item};
use crate::features::workbench::{
    CloseCopy, CloseDecision, ItemKind, ItemSnapshot, ItemStatus, RetainedItem, Workbench,
    WorkbenchEvent, WorkbenchItem,
};
use crate::localization::t as tr;
use gpui::{AnyView, App, Context, Entity, Subscription, Window};
use std::path::PathBuf;

/// One hosted chat tab.
#[derive(Clone)]
pub struct CloudAgentItem {
    conversation: Entity<CloudAgentConversation>,
    /// The hosted location whose files the chat opens.
    root: PathBuf,
}

impl CloudAgentItem {
    pub fn new(conversation: Entity<CloudAgentConversation>, root: PathBuf) -> Self {
        Self { conversation, root }
    }
}

impl WorkbenchItem for CloudAgentItem {
    fn kind(&self) -> ItemKind {
        ItemKind::Chat
    }

    fn snapshot(&self, cx: &App) -> ItemSnapshot {
        match self.conversation.read(cx).presentation() {
            Some(presentation) => present_agent_chat_workbench_item(presentation, tr("agent.name")),
            None => {
                let title = tr("agent.header.newChat").to_string();
                ItemSnapshot {
                    accessible_label: title.clone(),
                    title,
                    detail: None,
                    icon_key: None,
                    status: ItemStatus::Idle,
                    running: false,
                    resource_id: None,
                }
            }
        }
    }

    fn view(&self) -> AnyView {
        self.conversation.clone().into()
    }

    fn retained(&self, cx: &App) -> RetainedItem {
        let presentation = self.conversation.read(cx).presentation().cloned();
        RetainedItem::Chat {
            runtime_id: None,
            runtime: presentation
                .as_ref()
                .and_then(|p| p.runtime_icon_key.as_deref())
                .and_then(Runtime::from_icon_key)
                .unwrap_or(Runtime::PuppyOne),
            thread: presentation.as_ref().and_then(|p| p.session_id.clone()),
            title: presentation.map(|p| p.title).unwrap_or_default(),
        }
    }

    /// An unconfirmed submission keeps its tab; otherwise the tab closes
    /// without asking, and its run continues.
    fn close_decision(&self, cx: &App) -> CloseDecision {
        if self.conversation.read(cx).chat().can_release() {
            CloseDecision::Close
        } else {
            CloseDecision::Blocked
        }
    }

    fn close_copy(&self, blocked: bool, title: String) -> CloseCopy {
        agent_chat_close_copy(blocked, title)
    }

    fn set_presentation(
        &self,
        presented: bool,
        _command_target: bool,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.conversation
            .update(cx, |c, cx| c.set_presentation(presented, window, cx));
    }

    fn focus(&self, window: &mut Window, cx: &mut App) {
        self.conversation
            .update(cx, |c, cx| c.focus_composer(window, cx));
    }

    fn watch(&self, cx: &mut Context<Workbench>) -> Subscription {
        let root = self.root.clone();
        cx.subscribe(&self.conversation, move |_, _, event, cx| match event {
            ConversationEvent::Presentation => cx.notify(),
            ConversationEvent::OpenFile(path) => cx.emit(WorkbenchEvent::OpenAgentFile {
                root: root.clone(),
                path: path.clone(),
            }),
        })
    }
}

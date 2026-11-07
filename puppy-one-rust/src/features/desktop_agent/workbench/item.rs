//! `AgentChatWorkbenchItem.tsx` and `agentChatCloseAdapter.ts`: a chat tab
//! is an [`AgentChatTabPanel`] over a controller its project owns, or over a
//! hosted conversation, so hiding or moving the tab never ends its session.
use crate::agent::connections::legacy_runtime_registry::Runtime;
use crate::features::desktop_agent::application::agent_controller_registry::AgentControllerRegistry;
use crate::features::desktop_agent::ui::agent_brand_mark::runtime_for_icon_key;
use crate::features::desktop_agent::ui::panel::{
    AgentChatPanelEvent, AgentChatTabPanel, AgentChatTabPresentation,
};
use crate::features::settings::agent_routing_preferences::AgentRoutingPreferences;
use crate::features::settings::preferences_store::PreferencesStore;
use crate::features::workbench::{
    CloseCopy, CloseDecision, ItemKind, ItemSnapshot, ItemStatus, RetainedItem, Workbench,
    WorkbenchEvent, WorkbenchItem,
};
use crate::localization::{t as tr, tf};
use futures_util::future::LocalBoxFuture;
use gpui::{AnyView, App, Context, Entity, Subscription, Window};
use std::path::PathBuf;
use std::rc::Rc;

/// `presentAgentChatWorkbenchItem(presentation, agentLabel)`.
pub fn present_agent_chat_workbench_item(
    presentation: &AgentChatTabPresentation,
    agent_label: &str,
) -> ItemSnapshot {
    let status = if presentation.running {
        ItemStatus::Running
    } else {
        match presentation.status_code.as_str() {
            "checking" => ItemStatus::Starting,
            "needs-repair" => ItemStatus::Error,
            _ => ItemStatus::Idle,
        }
    };
    let detail = match &presentation.runtime_label {
        Some(label) if !label.is_empty() => format!("{label} — {}", presentation.status_code),
        _ => presentation.status_code.clone(),
    };
    let accessible_label = [
        presentation.title.as_str(),
        presentation
            .runtime_label
            .as_deref()
            .filter(|label| !label.is_empty())
            .unwrap_or(agent_label),
        presentation.status_code.as_str(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" — ");
    ItemSnapshot {
        title: presentation.title.clone(),
        accessible_label,
        detail: Some(detail),
        icon_key: presentation.runtime_icon_key.clone(),
        status,
        running: presentation.running,
        resource_id: presentation.session_id.clone(),
    }
}

/// How a chat's tab closes: a local chat releases its session through its
/// project's controllers; a hosted chat releases only its view.
#[derive(Clone)]
pub(super) enum Release {
    Session {
        registry: Rc<AgentControllerRegistry>,
        item: String,
    },
    Hosted,
    /// Fixtures own no session.
    #[cfg(feature = "dev-capture")]
    View,
}

/// One Agent chat tab.
#[derive(Clone)]
pub struct AgentChatItem {
    panel: Entity<AgentChatTabPanel>,
    release: Release,
    /// The project whose files the chat opens.
    root: PathBuf,
    /// The owner of `agentRoutingPreferences`.
    preferences: Option<Entity<PreferencesStore>>,
}

impl AgentChatItem {
    pub(super) fn new(
        panel: Entity<AgentChatTabPanel>,
        release: Release,
        root: PathBuf,
        preferences: Option<Entity<PreferencesStore>>,
    ) -> Self {
        Self {
            panel,
            release,
            root,
            preferences,
        }
    }

    /// Dev captures and the pixel lab: a chat over a recorded conversation.
    #[cfg(feature = "dev-capture")]
    pub fn fixture(panel: Entity<AgentChatTabPanel>) -> Self {
        Self::new(panel, Release::View, PathBuf::new(), None)
    }

    /// The panel over the recorded conversation (`populated`) or a fresh
    /// chat.
    #[cfg(feature = "dev-capture")]
    pub fn visual_fixture(populated: bool, window: &mut Window, cx: &mut App) -> Self {
        use gpui::AppContext as _;
        Self::fixture(cx.new(|cx| AgentChatTabPanel::visual_fixture(populated, window, cx)))
    }

    /// The pixel lab's chat `scenario` (`tools/workbench-scenarios.json`).
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(scenario: &str, window: &mut Window, cx: &mut App) -> Self {
        use gpui::AppContext as _;
        Self::fixture(cx.new(|cx| AgentChatTabPanel::lab_fixture(scenario, window, cx)))
    }

    fn hosted_unreleasable(&self, cx: &App) -> bool {
        self.panel
            .read(cx)
            .hosted()
            .is_some_and(|chat| !chat.can_release())
    }
}

impl WorkbenchItem for AgentChatItem {
    fn kind(&self) -> ItemKind {
        ItemKind::Chat
    }

    fn snapshot(&self, cx: &App) -> ItemSnapshot {
        match self.panel.read(cx).presentation() {
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
        self.panel.clone().into()
    }

    fn retained(&self, cx: &App) -> RetainedItem {
        let panel = self.panel.read(cx);
        let presentation = panel.presentation().cloned();
        let state = panel.controller().get_snapshot();
        RetainedItem::Chat {
            runtime_id: state
                .session
                .as_ref()
                .and_then(|s| s.runtime_id.clone())
                .or(state.selected_runtime_id),
            runtime: presentation
                .as_ref()
                .and_then(|p| p.runtime_icon_key.as_deref())
                .and_then(runtime_for_icon_key)
                .unwrap_or(Runtime::PuppyOne),
            thread: presentation.as_ref().and_then(|p| p.session_id.clone()),
            title: presentation.map(|p| p.title).unwrap_or_default(),
        }
    }

    /// A hosted chat never stops its run on close, and an unconfirmed
    /// submission keeps its tab; a local chat with a running turn asks.
    fn close_decision(&self, cx: &App) -> CloseDecision {
        match self.release {
            Release::Hosted if self.hosted_unreleasable(cx) => CloseDecision::Blocked,
            Release::Hosted => CloseDecision::Close,
            _ if self.snapshot(cx).running => CloseDecision::Confirm,
            _ => CloseDecision::Close,
        }
    }

    fn close_copy(&self, blocked: bool, title: String) -> CloseCopy {
        if blocked {
            return CloseCopy {
                title: tr("cloud.agent.pendingTitle").into(),
                detail: tr("cloud.agent.pendingDetail"),
                action: tr("agent.closeDialog.keepOpen"),
                blocked: true,
            };
        }
        CloseCopy {
            title: tf("agent.closeDialog.activeTitle", &[("title", title.into())]),
            detail: tr("agent.closeDialog.activeDetail"),
            action: tr("common.action.close"),
            blocked: false,
        }
    }

    /// `requestCloseAgentChatWorkbenchItem`: the tab closes once its session
    /// is released.
    fn commit_close(&self) -> Option<LocalBoxFuture<'static, bool>> {
        let Release::Session { registry, item } = &self.release else {
            return None;
        };
        let closing = registry.close(item);
        Some(Box::pin(async move { closing.await.closed() }))
    }

    fn set_presentation(
        &self,
        presented: bool,
        command_target: bool,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.panel.update(cx, |panel, cx| {
            panel.set_presentation(presented, command_target, window, cx)
        });
    }

    /// The panel's `onPresentationChange`, `onOpenFile`, `onOpenAccount`,
    /// `onOpenModelConnections` and its routing preference writes.
    fn watch(&self, cx: &mut Context<Workbench>) -> Subscription {
        let (root, preferences) = (self.root.clone(), self.preferences.clone());
        cx.subscribe(&self.panel, move |_, _, event: &AgentChatPanelEvent, cx| {
            let route = |cx: &mut App, edit: AgentRoutingEdit| {
                if let Some(store) = &preferences {
                    store.update(cx, |store, cx| {
                        store.change(|p| p.agent_routing = edit(&p.agent_routing), cx)
                    });
                }
            };
            match event {
                AgentChatPanelEvent::Presentation(_) => cx.notify(),
                AgentChatPanelEvent::OpenModelConnections => {
                    cx.emit(WorkbenchEvent::OpenModelConnections)
                }
                AgentChatPanelEvent::OpenAccount => cx.emit(WorkbenchEvent::OpenAccount),
                // `setAgentPreferredRuntime` / `setAgentPreferredRoute`.
                AgentChatPanelEvent::PreferredRuntime(runtime) => {
                    let runtime = runtime.clone();
                    route(
                        cx,
                        Box::new(move |routing| routing.select_runtime(runtime.as_deref())),
                    )
                }
                AgentChatPanelEvent::PreferredRoute(patch) => {
                    let patch = patch.clone();
                    route(
                        cx,
                        Box::new(move |routing| routing.set_preferred_route(&patch)),
                    )
                }
                AgentChatPanelEvent::OpenFile(path) => cx.emit(WorkbenchEvent::OpenAgentFile {
                    root: root.clone(),
                    path: path.clone(),
                }),
            }
        })
    }
}

/// A write to `agentRoutingPreferences`.
type AgentRoutingEdit = Box<dyn FnOnce(&AgentRoutingPreferences) -> AgentRoutingPreferences>;

#[cfg(test)]
mod tests {
    use super::present_agent_chat_workbench_item;
    use crate::features::desktop_agent::ui::panel::AgentChatTabPresentation;
    use crate::features::workbench::ItemStatus;

    fn presentation(
        status: &str,
        running: bool,
        runtime: Option<&str>,
    ) -> AgentChatTabPresentation {
        AgentChatTabPresentation {
            title: "Review".into(),
            runtime_label: runtime.map(str::to_string),
            runtime_icon_key: Some("codex".into()),
            session_id: Some("session-1".into()),
            status_code: status.into(),
            running,
        }
    }

    #[test]
    fn the_item_snapshot_maps_status_and_labels_like_the_product() {
        let snapshot = present_agent_chat_workbench_item(
            &presentation("ready", false, Some("Codex")),
            "Agent",
        );
        assert_eq!(snapshot.status, ItemStatus::Idle);
        assert_eq!(snapshot.detail.as_deref(), Some("Codex — ready"));
        assert_eq!(snapshot.accessible_label, "Review — Codex — ready");
        assert_eq!(snapshot.resource_id.as_deref(), Some("session-1"));
        let running =
            present_agent_chat_workbench_item(&presentation("needs-repair", true, None), "Agent");
        assert_eq!(running.status, ItemStatus::Running);
        assert_eq!(running.detail.as_deref(), Some("needs-repair"));
        assert_eq!(running.accessible_label, "Review — Agent — needs-repair");
        let checking =
            present_agent_chat_workbench_item(&presentation("checking", false, None), "Agent");
        assert_eq!(checking.status, ItemStatus::Starting);
        let repair =
            present_agent_chat_workbench_item(&presentation("needs-repair", false, None), "Agent");
        assert_eq!(repair.status, ItemStatus::Error);
    }
}

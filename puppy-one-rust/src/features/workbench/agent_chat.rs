//! The Agent chat contribution (`AgentChatWorkbenchItem.tsx`,
//! `projectAgentControllers.ts` and `lazy.ts`'s preparation): a chat tab is
//! an [`AgentChatTabPanel`] over a controller its project owns, so hiding
//! or moving the tab never ends its session.
//!
//! The Built-in Agent is the exception: its kernel is still the native
//! harness, so its chats stay on [`AgentChat`] and the panel never offers it.
use super::*;
use crate::agent::contract::js;
use crate::agent::host::agent_host::AgentHostHandle;
use crate::features::desktop_agent::application::agent_client_port::AgentClientPort;
use crate::features::desktop_agent::application::agent_controller_registry::AgentControllerRegistry;
use crate::features::desktop_agent::application::ui_runtime::UiRuntime;
use crate::features::desktop_agent::infrastructure::host::{
    agent_host_client::AgentHostClient, agent_host_global::agent_host,
    project_agent_client::create_project_agent_client_provider, window_runtime::WindowUiRuntime,
};
use crate::features::desktop_agent::ui::panel::{
    AgentChatPanelEvent, AgentChatTabPanel, AgentChatTabPresentation,
};
use serde_json::json;
use std::path::Path;
use std::rc::Rc;

/// `BUILT_IN_AGENT_RUNTIME_ID`.
pub(super) const BUILT_IN_AGENT_RUNTIME_ID: &str = "puppyone-agent";

/// `LOCAL_AGENT_CHAT_RECIPES`' runtime ids.
const LOCAL_AGENT_CHAT_RUNTIME_IDS: [&str; 8] = [
    "claude",
    "codex",
    "cursor",
    "hermes",
    "opencode-native",
    "pi",
    "workbuddy-china",
    "workbuddy-international",
];

/// `localAgentIdForAgentChatRuntime(runtimeId)`.
fn local_agent_id_for_agent_chat_runtime(runtime_id: &str) -> &str {
    match runtime_id {
        "opencode-native" => "opencode",
        id => id,
    }
}

/// The Chat recipe (runtime id) of a detected installation.
pub(super) fn agent_chat_runtime_id(installation: &Installation) -> String {
    if installation.bundled() {
        return BUILT_IN_AGENT_RUNTIME_ID.into();
    }
    LOCAL_AGENT_CHAT_RUNTIME_IDS
        .into_iter()
        .find(|id| local_agent_id_for_agent_chat_runtime(id) == installation.id)
        .unwrap_or(installation.id)
        .into()
}

/// `resolveAgentChatRuntimeVisibility(...).hiddenRuntimeIds`, plus the
/// Built-in Agent, whose chats stay on the native harness.
pub(super) fn hidden_agent_chat_runtime_ids(hidden_local_agent_ids: &[String]) -> Vec<String> {
    LOCAL_AGENT_CHAT_RUNTIME_IDS
        .into_iter()
        .filter(|id| {
            hidden_local_agent_ids
                .iter()
                .any(|hidden| hidden == local_agent_id_for_agent_chat_runtime(id))
        })
        .chain([BUILT_IN_AGENT_RUNTIME_ID])
        .map(str::to_string)
        .collect()
}

/// `AuxiliaryWorkbenchItemSnapshot.status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum AgentChatItemStatus {
    Running,
    Starting,
    Error,
    Idle,
}

/// `presentAgentChatWorkbenchItem(presentation, agentLabel)`'s snapshot.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct AgentChatItemSnapshot {
    pub title: String,
    pub accessible_label: String,
    pub detail: String,
    pub icon_key: Option<String>,
    pub status: AgentChatItemStatus,
    pub running: bool,
    pub resource_id: Option<String>,
}

/// `presentAgentChatWorkbenchItem(presentation, agentLabel)`.
pub(super) fn present_agent_chat_workbench_item(
    presentation: &AgentChatTabPresentation,
    agent_label: &str,
) -> AgentChatItemSnapshot {
    let status = if presentation.running {
        AgentChatItemStatus::Running
    } else {
        match presentation.status_code.as_str() {
            "checking" => AgentChatItemStatus::Starting,
            "needs-repair" => AgentChatItemStatus::Error,
            _ => AgentChatItemStatus::Idle,
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
    AgentChatItemSnapshot {
        title: presentation.title.clone(),
        accessible_label,
        detail,
        icon_key: presentation.runtime_icon_key.clone(),
        status,
        running: presentation.running,
        resource_id: presentation.session_id.clone(),
    }
}

/// This window's Agent bridge (the preload's `agent:*` API): its frames
/// arrive on the window's executor, and closing the window releases its
/// sessions and staged attachments on the host.
pub(super) struct WindowAgent {
    handle: AgentHostHandle,
    window: u64,
    client: Rc<AgentHostClient>,
    runtime: Rc<dyn UiRuntime>,
}

impl Drop for WindowAgent {
    fn drop(&mut self) {
        self.handle.close_window(self.window);
    }
}

/// `projectAgentControllers(project)`: one registry per open project.
pub(super) struct ProjectAgents {
    registry: Rc<AgentControllerRegistry>,
}

impl Drop for ProjectAgents {
    fn drop(&mut self) {
        self.registry.dispose();
    }
}

impl Workbench {
    /// This window's Agent bridge, connected on first use.
    fn agent_window(&mut self, cx: &mut Context<Self>) -> Result<&WindowAgent, String> {
        if self.agent_window.is_none() {
            let handle = agent_host(cx)?;
            let runtime = WindowUiRuntime::create(cx);
            let client = AgentHostClient::connect(handle.clone(), self.window_id, &runtime);
            self.agent_window = Some(WindowAgent {
                handle,
                window: self.window_id,
                client,
                runtime,
            });
            self.authorize_agent_roots();
        }
        Ok(self.agent_window.as_ref().expect("connected"))
    }

    /// The window may use the projects it has open (`authorizeWorkspaceRoot`).
    pub(super) fn authorize_agent_roots(&self) {
        let Some(agent) = &self.agent_window else {
            return;
        };
        let roots = self
            .projects
            .keys()
            .filter(|root| root.is_absolute())
            .map(|root| root.to_string_lossy().into_owned());
        agent.handle.authorize_roots(agent.window, roots);
    }

    /// `projectAgentControllers(project)` for `root`.
    fn project_agents(
        &mut self,
        root: &Path,
        cx: &mut Context<Self>,
    ) -> Result<Rc<AgentControllerRegistry>, String> {
        if let Some(agents) = self.projects.get(root).and_then(|p| p.agents.as_ref()) {
            return Ok(agents.registry.clone());
        }
        let agent = self.agent_window(cx)?;
        let port: Rc<dyn AgentClientPort> = agent.client.clone();
        let runtime = agent.runtime.clone();
        let root_path = root.to_string_lossy().into_owned();
        let context = json!({
            "projectId": uuid::Uuid::new_v4().to_string(),
            "generation": uuid::Uuid::new_v4().to_string(),
            "rootPath": root_path,
        });
        let registry = Rc::new(AgentControllerRegistry::new(
            &root_path,
            Rc::new(move |_item| {
                let port = port.clone();
                create_project_agent_client_provider(
                    context.clone(),
                    Rc::new(move || Some(port.clone())),
                )
            }),
            runtime,
            false,
        ));
        let project = self
            .projects
            .get_mut(root)
            .ok_or_else(|| String::from("This project is closing."))?;
        project.agents = Some(ProjectAgents {
            registry: registry.clone(),
        });
        Ok(registry)
    }

    /// `AgentChatWorkbenchItem` for `item` of `root`.
    fn agent_chat_panel(
        &mut self,
        root: &Path,
        item: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Entity<AgentChatTabPanel>, String> {
        let registry = self.project_agents(root, cx)?;
        let controller = registry.get(item).map_err(|error| error.message)?;
        let hidden = hidden_agent_chat_runtime_ids(&self.hidden_agents);
        let view = cx.new(|cx| AgentChatTabPanel::new(controller, hidden, window, cx));
        cx.subscribe(&view, Self::agent_panel_event).detach();
        Ok(view)
    }

    /// `prepareAgentChatWorkbenchItem(project, itemId, runtimeId)` or, with
    /// a session, `restoreAgentChatWorkbenchItem`: the tab's content.
    pub(super) fn agent_chat_content(
        &mut self,
        runtime_id: &str,
        session_id: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Content, String> {
        let root = self
            .root
            .clone()
            .ok_or_else(|| String::from("This project is closing."))?;
        let item = uuid::Uuid::new_v4().to_string();
        let view = self.agent_chat_panel(&root, &item, window, cx)?;
        let controller = view.read(cx).controller().clone();
        match session_id {
            Some(session_id) => drop(controller.open_saved_session(&session_id, runtime_id)),
            None => controller.begin_initialize_for_runtime(runtime_id),
        }
        Ok(Content::Agent(view, item))
    }

    /// `requestCloseAgentChatWorkbenchItem`: the tab closes once its
    /// session is released; a refusal presents the latest decision again.
    pub(super) fn close_agent_chat(&mut self, tab: Id, item: String, cx: &mut Context<Self>) {
        let Some(root) = self.root.clone() else {
            return;
        };
        let Some(registry) = self
            .projects
            .get(&root)
            .and_then(|p| p.agents.as_ref())
            .map(|agents| agents.registry.clone())
        else {
            self.remove_tab(&root, tab, cx);
            return;
        };
        if !self.closing_agents.insert(tab) {
            return;
        }
        let closing = registry.close(&item);
        cx.spawn(async move |this, cx| {
            let result = closing.await;
            this.update(cx, |s, cx| {
                s.closing_agents.remove(&tab);
                if js::truthy(&result) {
                    s.remove_tab(&root, tab, cx);
                } else if s.root.as_ref() == Some(&root)
                    && s.project()
                        .and_then(|p| p.content.get(&tab))
                        .is_some_and(|c| c.busy(cx))
                {
                    s.request_close_confirmation(tab, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn agent_panel_event(
        &mut self,
        _: Entity<AgentChatTabPanel>,
        event: &AgentChatPanelEvent,
        cx: &mut Context<Self>,
    ) {
        match event {
            AgentChatPanelEvent::Presentation(_) => cx.notify(),
            AgentChatPanelEvent::OpenFile(path) => {
                if let Some(root) = self.root.clone() {
                    cx.emit(WorkbenchEvent::OpenAgentFile {
                        root,
                        path: path.clone(),
                    });
                }
            }
        }
    }

    /// Dev captures: a new chat on the detected Agent `runtime_id` in the
    /// active group; `false` until the Agents are scanned.
    #[cfg(feature = "dev-capture")]
    pub(crate) fn capture_new_chat(
        &mut self,
        runtime_id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.scanning || self.project().is_none_or(|p| p.loading) {
            return false;
        }
        let Some(installation) = self
            .installations
            .iter()
            .find(|i| agent_chat_runtime_id(i) == runtime_id)
            .cloned()
        else {
            eprintln!("No detected Agent for {runtime_id:?}");
            return true;
        };
        let group = self.project().map_or(0, |p| p.layout.active_group);
        self.chat_mode = true;
        self.launch(group, None, Some(installation), false, window, cx);
        true
    }

    /// Dev captures: every chat's session is prepared, or failed.
    #[cfg(feature = "dev-capture")]
    pub(crate) fn capture_agent_settled(&self, cx: &App) -> bool {
        use crate::features::desktop_agent::application::agent_controller_state::{
            AgentControllerPhase, AgentSessionPreparation,
        };
        self.project().is_some_and(|p| {
            p.content.values().all(|c| match c {
                Content::Agent(view, _) => {
                    let state = view.read(cx).controller().get_snapshot();
                    state.phase == AgentControllerPhase::Failed
                        || matches!(
                            state.session_preparation,
                            AgentSessionPreparation::Ready | AgentSessionPreparation::Failed
                        )
                }
                _ => true,
            })
        })
    }

    /// Hidden local Agents leave every open panel's runtime choices.
    pub(super) fn sync_agent_hidden_runtimes(&mut self, cx: &mut Context<Self>) {
        let hidden = hidden_agent_chat_runtime_ids(&self.hidden_agents);
        let panels: Vec<Entity<AgentChatTabPanel>> = self
            .projects
            .values()
            .flat_map(|p| p.content.values())
            .filter_map(|c| match c {
                Content::Agent(view, _) => Some(view.clone()),
                _ => None,
            })
            .collect();
        for panel in panels {
            panel.update(cx, |panel, cx| {
                panel.set_hidden_runtime_ids(hidden.clone(), cx)
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AgentChatItemStatus, AgentChatTabPresentation, BUILT_IN_AGENT_RUNTIME_ID,
        hidden_agent_chat_runtime_ids, local_agent_id_for_agent_chat_runtime,
        present_agent_chat_workbench_item,
    };

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
        assert_eq!(snapshot.status, AgentChatItemStatus::Idle);
        assert_eq!(snapshot.detail, "Codex — ready");
        assert_eq!(snapshot.accessible_label, "Review — Codex — ready");
        assert_eq!(snapshot.resource_id.as_deref(), Some("session-1"));
        let running =
            present_agent_chat_workbench_item(&presentation("needs-repair", true, None), "Agent");
        assert_eq!(running.status, AgentChatItemStatus::Running);
        assert_eq!(running.detail, "needs-repair");
        assert_eq!(running.accessible_label, "Review — Agent — needs-repair");
        let checking =
            present_agent_chat_workbench_item(&presentation("checking", false, None), "Agent");
        assert_eq!(checking.status, AgentChatItemStatus::Starting);
        let repair =
            present_agent_chat_workbench_item(&presentation("needs-repair", false, None), "Agent");
        assert_eq!(repair.status, AgentChatItemStatus::Error);
    }

    #[test]
    fn hidden_local_agents_hide_their_chat_runtimes_and_the_built_in_stays_native() {
        assert_eq!(
            hidden_agent_chat_runtime_ids(&["opencode".into(), "codex".into()]),
            ["codex", "opencode-native", BUILT_IN_AGENT_RUNTIME_ID]
        );
        assert_eq!(
            hidden_agent_chat_runtime_ids(&[]),
            [BUILT_IN_AGENT_RUNTIME_ID]
        );
        assert_eq!(
            local_agent_id_for_agent_chat_runtime("workbuddy-china"),
            "workbuddy-china"
        );
    }
}

//! The Agent chat contribution's window state (`projectAgentControllers.ts`
//! and `lazy.ts`'s preparation): this window's Agent bridge, each open
//! project's controllers and History, and the routing every open chat
//! follows. The hosted Agent's chats are the Cloud feature's.
use super::item::{AgentChatItem, Release};
use crate::agent::contract::dto::RuntimeInspection;
use crate::agent::contract::protocol::RuntimeQuery;
use crate::agent::host::agent_host::AgentHostHandle;
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClient as _, AgentClientPort,
};
use crate::features::desktop_agent::application::agent_controller_registry::AgentControllerRegistry;
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryController;
use crate::features::desktop_agent::application::conversation_history_source::ConversationHistorySource;
use crate::features::desktop_agent::application::ui_runtime::UiRuntime;
use crate::features::desktop_agent::domain::agent_chat_history_target::{
    AuxiliaryWorkbenchHistoryTarget, parse_agent_chat_history_target,
};
use crate::features::desktop_agent::infrastructure::host::{
    agent_host_client::AgentHostClient, agent_host_global::agent_host,
    project_agent_client::create_project_agent_client_provider, window_runtime::WindowUiRuntime,
};
use crate::features::desktop_agent::ui::agent_conversation_history::HistoryBrowser;
use crate::features::desktop_agent::ui::panel::{AgentChatTabPanel, AgentRouting};
use crate::features::local_agents::hidden_agent_chat_runtime_ids;
use crate::features::settings::AgentRoutingPreferences;
use crate::features::settings::PreferencesStore;
use futures_util::future::LocalBoxFuture;
use gpui::{App, AppContext as _, Entity, WeakEntity, Window};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// This window's Agent bridge (the preload's `agent:*` API): its frames
/// arrive on the window's executor, and closing the window releases its
/// sessions and staged attachments on the host.
struct WindowAgent {
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

/// `projectAgentControllers(project)`: one registry per open project, and
/// its `agent-history` resource.
struct ProjectAgents {
    registry: Rc<AgentControllerRegistry>,
    history: ConversationHistoryController,
}

impl Drop for ProjectAgents {
    fn drop(&mut self) {
        self.registry.dispose();
        self.history.dispose();
    }
}

/// A saved conversation being opened for a launcher tab
/// (`restoreAgentChatWorkbenchItem`): it becomes the tab's chat only once
/// its session opened.
pub struct SavedChat {
    root: PathBuf,
    registry: Rc<AgentControllerRegistry>,
    item: String,
    controller: AgentSessionController,
    opening: Option<LocalBoxFuture<'static, Result<(), OpenFailure>>>,
}

/// Why a saved chat did not open: the failure's `code` and `retryable`
/// (`recordCreationFailure`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OpenFailure {
    pub code: Option<String>,
    pub retryable: bool,
}

impl OpenFailure {
    /// `OPEN_FAILURE_MESSAGE_KEYS`: the message its code names, if any.
    pub fn message_key(&self) -> Option<&'static str> {
        Some(match self.code.as_deref()? {
            "SESSION_NOT_FOUND" => "agent.history.openError.sessionNotFound",
            "SOURCE_CHANGED" => "agent.history.openError.sourceChanged",
            "HISTORY_READ_FAILED" => "agent.history.openError.readFailed",
            "AUTH_REQUIRED" => "agent.history.openError.authRequired",
            "AUTH_EXPIRED" => "agent.history.openError.authExpired",
            "RUNTIME_UNAVAILABLE" => "agent.history.openError.runtimeUnavailable",
            "RESUME_UNSUPPORTED" => "agent.history.openError.unsupported",
            "RESUME_TIMED_OUT" => "agent.history.openError.timedOut",
            "WORKSPACE_MISMATCH" => "agent.history.openError.workspaceMismatch",
            "PROTOCOL_ERROR" => "agent.history.openError.protocol",
            _ => return None,
        })
    }
}

impl SavedChat {
    /// Whether the saved session opened.
    pub fn opening(&mut self) -> LocalBoxFuture<'static, Result<(), OpenFailure>> {
        self.opening
            .take()
            .unwrap_or_else(|| Box::pin(async { Err(OpenFailure::default()) }))
    }

    /// The abandoned reservation releases its native session.
    pub fn discard(self) -> LocalBoxFuture<'static, ()> {
        Box::pin(async move { self.registry.discard(&self.item).await })
    }
}

/// The Agent chat contribution of one window's Workbench.
pub struct AgentChats {
    window_id: u64,
    window: Option<WindowAgent>,
    /// The open projects the window may use (`authorizeWorkspaceRoot`).
    roots: Vec<PathBuf>,
    projects: HashMap<PathBuf, ProjectAgents>,
    /// Local agent ids hidden in Settings → Local Agents.
    hidden_agents: Vec<String>,
    /// `agentRoutingPreferences` and the Payments experience.
    routing: AgentRoutingPreferences,
    payments: bool,
    preferences: Option<Entity<PreferencesStore>>,
    /// Every chat panel this window opened.
    panels: Vec<(PathBuf, WeakEntity<AgentChatTabPanel>)>,
}

impl AgentChats {
    pub fn new(window_id: u64) -> Self {
        Self {
            window_id,
            window: None,
            roots: Vec::new(),
            projects: HashMap::new(),
            hidden_agents: Vec::new(),
            routing: AgentRoutingPreferences::default(),
            payments: false,
            preferences: None,
            panels: Vec::new(),
        }
    }

    pub fn set_preference_store(&mut self, store: Entity<PreferencesStore>) {
        self.preferences = Some(store);
    }

    /// The window's open projects; the Agent host authorizes their roots.
    pub fn set_roots(&mut self, roots: Vec<PathBuf>) {
        self.roots = roots;
        self.authorize_roots();
    }

    fn authorize_roots(&self) {
        let Some(agent) = &self.window else {
            return;
        };
        let roots = self
            .roots
            .iter()
            .filter(|root| root.is_absolute())
            .map(|root| root.to_string_lossy().into_owned());
        agent.handle.authorize_roots(agent.window, roots);
    }

    /// Hidden local Agents, routing and Payments reach every open chat.
    pub fn set_preferences(
        &mut self,
        hidden: Vec<String>,
        routing: AgentRoutingPreferences,
        payments: bool,
        cx: &mut App,
    ) -> bool {
        let hidden_changed = self.hidden_agents != hidden;
        let routing_changed = self.routing != routing || self.payments != payments;
        self.hidden_agents = hidden;
        self.routing = routing;
        self.payments = payments;
        if hidden_changed {
            let hidden = hidden_agent_chat_runtime_ids(&self.hidden_agents);
            for panel in self.live_panels(None) {
                panel.update(cx, |panel, cx| {
                    panel.set_hidden_runtime_ids(hidden.clone(), cx)
                });
            }
        }
        if hidden_changed || routing_changed {
            let (routing, payments) = (self.panel_routing(), self.payments);
            for panel in self.live_panels(None) {
                panel.update(cx, |panel, cx| {
                    panel.set_payments(payments, cx);
                    panel.set_routing(routing.clone(), cx);
                });
            }
        }
        hidden_changed || routing_changed
    }

    /// Model connections changed: every chat rereads them.
    pub fn reload_model_connections(&mut self, cx: &mut App) {
        for panel in self.live_panels(None) {
            panel.update(cx, |panel, cx| panel.reload_model_connections(cx));
        }
    }

    /// The window's projects closed: their controllers are released.
    pub fn shutdown(&mut self) {
        self.projects.clear();
        self.panels.clear();
    }

    /// `preferredRuntimeId` (unless hidden) and `selectAgentPreferredRoute`.
    fn panel_routing(&self) -> AgentRouting {
        let hidden = hidden_agent_chat_runtime_ids(&self.hidden_agents);
        AgentRouting {
            preferred_runtime_id: self
                .routing
                .selected_runtime_id
                .clone()
                .filter(|id| !hidden.contains(id)),
            preferred_route: self.routing.preferred_route(),
        }
    }

    /// The open chats (of `root`, or all).
    fn live_panels(&self, root: Option<&Path>) -> Vec<Entity<AgentChatTabPanel>> {
        self.panels
            .iter()
            .filter(|(owner, _)| root.is_none_or(|root| owner == root))
            .filter_map(|(_, panel)| panel.upgrade())
            .collect()
    }

    /// This window's Agent bridge, connected on first use.
    fn agent_window(&mut self, cx: &mut App) -> Result<&WindowAgent, String> {
        if self.window.is_none() {
            let handle = agent_host(cx)?;
            let runtime = WindowUiRuntime::create(cx);
            let client = AgentHostClient::connect(handle.clone(), self.window_id, &runtime);
            self.window = Some(WindowAgent {
                handle,
                window: self.window_id,
                client,
                runtime,
            });
            self.authorize_roots();
        }
        Ok(self.window.as_ref().expect("connected"))
    }

    /// `projectAgentControllers(project)` for `root`.
    fn project_agents(&mut self, root: &Path, cx: &mut App) -> Result<&ProjectAgents, String> {
        if !self.projects.contains_key(root) {
            if !self.roots.iter().any(|open| open == root) {
                return Err("This project is closing.".into());
            }
            let agent = self.agent_window(cx)?;
            let port: Rc<dyn AgentClientPort> = agent.client.clone();
            let runtime = agent.runtime.clone();
            let root_path = root.to_string_lossy().into_owned();
            let history_port = port.clone();
            let history = ConversationHistoryController::new(
                &root_path,
                create_project_agent_client_provider(Rc::new(move || Some(history_port.clone()))),
                runtime.clone(),
            );
            let registry = Rc::new(AgentControllerRegistry::new(
                &root_path,
                Rc::new(move |_item| {
                    let port = port.clone();
                    create_project_agent_client_provider(Rc::new(move || Some(port.clone())))
                }),
                runtime,
                false,
            ));
            self.projects
                .insert(root.to_path_buf(), ProjectAgents { registry, history });
        }
        Ok(&self.projects[root])
    }

    /// The chat over `controller`, wired to the routing.
    fn panel_for(
        &mut self,
        root: &Path,
        controller: AgentSessionController,
        window: &mut Window,
        cx: &mut App,
    ) -> Entity<AgentChatTabPanel> {
        let hidden = hidden_agent_chat_runtime_ids(&self.hidden_agents);
        let (payments, routing) = (self.payments, self.panel_routing());
        let panel = cx.new(|cx| {
            let mut panel = AgentChatTabPanel::new(controller, hidden, window, cx);
            panel.set_payments(payments, cx);
            panel.set_routing(routing, cx);
            panel
        });
        self.track(root, &panel);
        panel
    }

    fn track(&mut self, root: &Path, panel: &Entity<AgentChatTabPanel>) {
        self.panels.retain(|(_, panel)| panel.upgrade().is_some());
        self.panels.push((root.to_path_buf(), panel.downgrade()));
    }

    /// Inspects `runtime_id` for `root` (capabilities, models, effort variants,
    /// and modes) without creating a session or starting a turn.
    pub fn inspect_runtime(
        &mut self,
        root: &Path,
        runtime_id: &str,
        cx: &mut App,
    ) -> Result<LocalBoxFuture<'static, Result<RuntimeInspection, String>>, String> {
        let agent = self.agent_window(cx)?;
        let client = agent.client.clone();
        let request = RuntimeQuery {
            root_path: Some(root.to_string_lossy().into_owned()),
            runtime_id: Some(runtime_id.to_owned()),
            refresh: Some(false),
        };
        Ok(Box::pin(async move {
            client
                .discover_runtimes(request)
                .await
                .map_err(|error| error.message)
        }))
    }

    /// `prepareAgentChatWorkbenchItem(project, itemId, runtimeId)` or, with
    /// a session, `restoreAgentChatWorkbenchItem`.
    pub fn prepare(
        &mut self,
        root: &Path,
        runtime_id: &str,
        session_id: Option<String>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<AgentChatItem, String> {
        self.prepare_with_prompt(root, runtime_id, session_id, None, window, cx)
    }

    /// Prepares a new runtime chat pre-seeded with `initial_prompt` for one-shot
    /// auto-submission once discovery and routing preferences settle.
    pub fn prepare_seeded(
        &mut self,
        root: &Path,
        runtime_id: &str,
        initial_prompt: &str,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<AgentChatItem, String> {
        self.prepare_with_prompt(root, runtime_id, None, Some(initial_prompt), window, cx)
    }

    /// Prepares a new runtime chat pre-seeded with prompt segments and staged
    /// attachments (workspace paths, external files, pasted images) from the L1
    /// launcher.
    pub fn prepare_seeded_submission(
        &mut self,
        root: &Path,
        runtime_id: &str,
        submission: super::super::ui::panel::SeededSubmission,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<AgentChatItem, String> {
        if submission.attachments.is_empty() {
            return self.prepare_seeded(root, runtime_id, &submission.text, window, cx);
        }
        let registry = self.project_agents(root, cx)?.registry.clone();
        let item = uuid::Uuid::new_v4().to_string();
        let controller = registry.get(&item).map_err(|error| error.message)?;
        controller.begin_initialize_for_runtime(runtime_id);
        let panel = self.panel_for(root, controller, window, cx);
        panel.update(cx, |p, cx| p.set_seeded_submission(submission, window, cx));
        Ok(AgentChatItem::new(
            panel,
            Release::Session { registry, item },
            root.to_path_buf(),
            self.preferences.clone(),
        ))
    }

    fn prepare_with_prompt(
        &mut self,
        root: &Path,
        runtime_id: &str,
        session_id: Option<String>,
        initial_prompt: Option<&str>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<AgentChatItem, String> {
        let registry = self.project_agents(root, cx)?.registry.clone();
        let item = uuid::Uuid::new_v4().to_string();
        let controller = registry.get(&item).map_err(|error| error.message)?;
        match session_id {
            Some(session_id) => drop(controller.open_saved_session(&session_id, runtime_id)),
            None => {
                controller.begin_initialize_for_runtime(runtime_id);
                if let Some(prompt) = initial_prompt {
                    controller.seed_initial_prompt(prompt);
                }
            }
        }
        let panel = self.panel_for(root, controller, window, cx);
        Ok(AgentChatItem::new(
            panel,
            Release::Session { registry, item },
            root.to_path_buf(),
            self.preferences.clone(),
        ))
    }

    /// Opens the History `target` in `root` for a launcher tab.
    pub fn open_saved(
        &mut self,
        root: &Path,
        target: &AuxiliaryWorkbenchHistoryTarget,
        cx: &mut App,
    ) -> Result<SavedChat, String> {
        let payload = parse_agent_chat_history_target(target)
            .ok_or_else(|| String::from("Invalid Agent chat history target."))?;
        let registry = self.project_agents(root, cx)?.registry.clone();
        let item = uuid::Uuid::new_v4().to_string();
        let controller = registry.get(&item).map_err(|error| error.message)?;
        let opening = controller.open_saved_session(&payload.session_id, &payload.runtime_id);
        Ok(SavedChat {
            root: root.to_path_buf(),
            registry,
            item,
            controller,
            opening: Some(Box::pin(async move {
                match opening.await {
                    Ok(true) => Ok(()),
                    Ok(false) => Err(OpenFailure::default()),
                    Err(error) => Err(OpenFailure {
                        code: error.code.clone(),
                        retryable: error.retryable == Some(true),
                    }),
                }
            })),
        })
    }

    /// The chat of a saved conversation that opened.
    pub fn saved_chat(
        &mut self,
        saved: SavedChat,
        window: &mut Window,
        cx: &mut App,
    ) -> AgentChatItem {
        let SavedChat {
            root,
            registry,
            item,
            controller,
            ..
        } = saved;
        let panel = self.panel_for(&root, controller, window, cx);
        AgentChatItem::new(
            panel,
            Release::Session { registry, item },
            root,
            self.preferences.clone(),
        )
    }

    /// The chat contribution's `history.renderBrowser`: the project's Agent
    /// History, discovering only with the user's permission.
    pub fn history_browser(
        &mut self,
        root: &Path,
        discovery: bool,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<Entity<HistoryBrowser>, String> {
        let source: Rc<dyn ConversationHistorySource> =
            Rc::new(self.project_agents(root, cx)?.history.clone());
        Ok(cx.new(|cx| HistoryBrowser::new(source, discovery, window, cx)))
    }

    /// Cached recent sessions for `root` (never starts discovery on its own).
    pub fn cached_recent_sessions(
        &self,
        root: &Path,
        excluded: &[String],
        limit: usize,
    ) -> Vec<crate::agent::contract::dto::SessionMetadata> {
        let Some(project) = self.projects.get(root) else {
            return Vec::new();
        };
        project
            .history
            .snapshot()
            .sessions
            .into_iter()
            .filter(|s| !excluded.contains(&s.id))
            .take(limit)
            .collect()
    }

    /// Activates and watches `root`'s conversation history when the user has
    /// already granted `chatHistoryDiscoveryEnabled`.
    pub fn watch_recent_history(
        &mut self,
        root: &Path,
        wake: crate::wake::Wake,
        cx: &mut App,
    ) -> Option<Box<dyn FnOnce()>> {
        let history = self.project_agents(root, cx).ok()?.history.clone();
        let unwatch = history.watch(wake);
        history.activate();
        Some(unwatch)
    }

    /// Dev captures: every chat of `root` is prepared, or failed.
    #[cfg(feature = "dev-capture")]
    pub fn capture_settled(&self, root: &Path, cx: &App) -> bool {
        use crate::features::desktop_agent::application::agent_controller_state::{
            AgentControllerPhase, AgentSessionPreparation,
        };
        self.live_panels(Some(root)).iter().all(|panel| {
            let state = panel.read(cx).controller().get_snapshot();
            state.phase == AgentControllerPhase::Failed
                || matches!(
                    state.session_preparation,
                    AgentSessionPreparation::Ready | AgentSessionPreparation::Failed
                )
        })
    }

    /// Dev captures: the first chat of `root` sends `text`; `false` until it
    /// can.
    #[cfg(feature = "dev-capture")]
    pub fn capture_prompt(&self, root: &Path, text: &str, cx: &App) -> bool {
        let Some(controller) = self.capture_controller(root, cx) else {
            return false;
        };
        let state = controller.get_snapshot();
        if state.session.is_none() || state.running_turn_id().is_some() {
            return false;
        }
        drop(controller.submit(text));
        true
    }

    /// Dev captures: the first chat's turn has settled.
    #[cfg(feature = "dev-capture")]
    pub fn capture_idle(&self, root: &Path, cx: &App) -> bool {
        self.capture_controller(root, cx).is_some_and(|controller| {
            let state = controller.get_snapshot();
            state.running_turn_id().is_none()
                && state
                    .projection
                    .messages
                    .iter()
                    .any(|m| m.role == "assistant" && !m.streaming)
        })
    }

    #[cfg(feature = "dev-capture")]
    fn capture_controller(&self, root: &Path, cx: &App) -> Option<AgentSessionController> {
        self.live_panels(Some(root))
            .first()
            .map(|panel| panel.read(cx).controller().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::OpenFailure;

    #[test]
    fn open_failures_name_their_cause() {
        let key = |code: &str| {
            OpenFailure {
                code: Some(code.into()),
                retryable: false,
            }
            .message_key()
        };
        assert_eq!(
            key("RESUME_TIMED_OUT"),
            Some("agent.history.openError.timedOut")
        );
        assert_eq!(
            key("WORKSPACE_MISMATCH"),
            Some("agent.history.openError.workspaceMismatch")
        );
        assert_eq!(key("SOMETHING_ELSE"), None);
        assert_eq!(OpenFailure::default().message_key(), None);
        for code in [
            "SESSION_NOT_FOUND",
            "SOURCE_CHANGED",
            "HISTORY_READ_FAILED",
            "AUTH_REQUIRED",
            "AUTH_EXPIRED",
            "RUNTIME_UNAVAILABLE",
            "RESUME_UNSUPPORTED",
            "PROTOCOL_ERROR",
        ] {
            let message = key(code).unwrap();
            assert_ne!(crate::localization::t(message), message, "{code}");
        }
    }
}

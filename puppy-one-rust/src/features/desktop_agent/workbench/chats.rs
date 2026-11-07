//! The Agent chat contribution's window state (`projectAgentControllers.ts`,
//! `lazy.ts`'s preparation and `CloudAgentWorkbench`): this window's Agent
//! bridge, each open project's controllers and History, the hosted target's
//! Hubs, and the routing every open chat follows.
use super::item::{AgentChatItem, Release};
use crate::agent::connections::legacy_local_agent_inventory::Installation;
use crate::agent::host::agent_host::AgentHostHandle;
use crate::agent::runtime::legacy_runtime_registry::Runtime;
use crate::features::desktop_agent::application::agent_client_port::AgentClientPort;
use crate::features::desktop_agent::application::agent_controller_registry::AgentControllerRegistry;
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryController;
use crate::features::desktop_agent::application::ui_runtime::UiRuntime;
use crate::features::desktop_agent::domain::agent_chat_history_target::{
    AuxiliaryWorkbenchHistoryTarget, parse_agent_chat_history_target,
};
use crate::features::desktop_agent::infrastructure::cloud::{self, CloudAgentController, Hub};
use crate::features::desktop_agent::infrastructure::host::{
    agent_host_client::AgentHostClient, agent_host_global::agent_host,
    project_agent_client::create_project_agent_client_provider, window_runtime::WindowUiRuntime,
};
use crate::features::desktop_agent::ui::agent_conversation_history::{
    HistoryBrowser, HistorySource,
};
use crate::features::desktop_agent::ui::panel::{AgentChatTabPanel, AgentRouting};
use crate::features::settings::agent_routing_preferences::AgentRoutingPreferences;
use crate::features::settings::preferences_store::PreferencesStore;
use crate::wake::Wake;
use crate::workspace::cloud::agent::{AgentTarget, BrokerTransport, Client, Session};
use futures_util::future::LocalBoxFuture;
use gpui::{App, AppContext as _, Entity, WeakEntity, Window};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

/// `BUILT_IN_AGENT_RUNTIME_ID`.
const BUILT_IN_AGENT_RUNTIME_ID: &str = "puppyone-agent";

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
pub fn agent_chat_runtime_id(installation: &Installation) -> String {
    if installation.bundled() {
        return BUILT_IN_AGENT_RUNTIME_ID.into();
    }
    LOCAL_AGENT_CHAT_RUNTIME_IDS
        .into_iter()
        .find(|id| local_agent_id_for_agent_chat_runtime(id) == installation.id)
        .unwrap_or(installation.id)
        .into()
}

/// `resolveAgentChatRuntimeVisibility(...).hiddenRuntimeIds`: the Built-in
/// Agent is never hidden.
fn hidden_agent_chat_runtime_ids(hidden_local_agent_ids: &[String]) -> Vec<String> {
    LOCAL_AGENT_CHAT_RUNTIME_IDS
        .into_iter()
        .filter(|id| {
            hidden_local_agent_ids
                .iter()
                .any(|hidden| hidden == local_agent_id_for_agent_chat_runtime(id))
        })
        .map(str::to_string)
        .collect()
}

/// `CLOUD_AGENT_LABEL`'s creation recipe: the only runtime a Cloud launcher
/// offers (no local discovery, no terminal).
pub fn hosted_installation() -> Installation {
    Installation {
        runtime: Runtime::PuppyOne,
        id: cloud::INSTALLATION_ID,
        label: cloud::LABEL.into(),
        executable: PathBuf::new(),
        chat: true,
    }
}

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
    opening: Option<LocalBoxFuture<'static, bool>>,
}

impl SavedChat {
    /// Whether the saved session opened.
    pub fn opening(&mut self) -> LocalBoxFuture<'static, bool> {
        self.opening
            .take()
            .unwrap_or_else(|| Box::pin(async { false }))
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
    /// The hosted location shown, and the Hubs of the targets seen (by
    /// storage, account binding and workbench).
    hosted: Option<Arc<Hub>>,
    hubs: HashMap<String, Arc<Hub>>,
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
            hosted: None,
            hubs: HashMap::new(),
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
        let registry = self.project_agents(root, cx)?.registry.clone();
        let item = uuid::Uuid::new_v4().to_string();
        let controller = registry.get(&item).map_err(|error| error.message)?;
        match session_id {
            Some(session_id) => drop(controller.open_saved_session(&session_id, runtime_id)),
            None => controller.begin_initialize_for_runtime(runtime_id),
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
            opening: Some(Box::pin(async move { matches!(opening.await, Ok(true)) })),
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

    /// The hosted Project's Agent (`useCloudAgentWorkspace`): tabs persist
    /// per API, account and target; one Hub per binding and workbench. The
    /// Workbench location of its tabs.
    pub fn open_hosted(
        &mut self,
        target: AgentTarget,
        published: Box<dyn Fn() + Send + Sync>,
    ) -> PathBuf {
        let identity = format!(
            "{}#{}#{}#{}",
            target.storage, target.binding.instance, target.binding.epoch, target.workbench
        );
        let hub = self
            .hubs
            .entry(identity)
            .or_insert_with(|| {
                let transport = Arc::new(BrokerTransport {
                    broker: target.broker.clone(),
                    binding: target.binding.clone(),
                    cancel: Default::default(),
                    wait: crate::workspace::cloud::agent::BATCH_WAIT,
                });
                Hub::new(
                    Client::new(transport, target.project.clone(), target.workbench.clone()),
                    target.storage.clone(),
                    cloud::storage_dir(),
                    published,
                )
            })
            .clone();
        self.hosted = Some(hub);
        PathBuf::from(format!(
            "puppyone-cloud-agent-{}",
            blake3::hash(target.storage.as_bytes()).to_hex()
        ))
    }

    /// The hosted location over `hub`.
    #[cfg(test)]
    pub fn open_hosted_hub(&mut self, hub: Arc<Hub>) {
        self.hosted = Some(hub);
    }

    /// A local project is shown.
    pub fn close_hosted(&mut self) {
        self.hosted = None;
    }

    /// Whether the hosted Agent is shown.
    pub fn is_hosted(&self) -> bool {
        self.hosted.is_some()
    }

    /// `CloudAgentWorkbench.prepare(id, session)`: a hosted chat of the
    /// location `root` whose receipts persist under `key`; a History
    /// `session` opens it.
    pub fn hosted_chat(
        &mut self,
        root: &Path,
        key: &str,
        session: Option<Session>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<AgentChatItem, String> {
        let hub = self
            .hosted
            .clone()
            .ok_or_else(|| String::from("The hosted Agent is not open."))?;
        let (wake, changes) = Wake::channel();
        let chat = CloudAgentController::new(hub, key, session, wake)?;
        let panel = cx.new(|cx| AgentChatTabPanel::new_hosted(chat, changes, window, cx));
        self.track(root, &panel);
        Ok(AgentChatItem::new(
            panel,
            Release::Hosted,
            root.to_path_buf(),
            self.preferences.clone(),
        ))
    }

    /// The hosted History's conversation `id`.
    pub fn hosted_session(&self, id: &str) -> Option<Session> {
        self.hosted
            .as_ref()?
            .history()
            .sessions
            .into_iter()
            .find(|s| s.id == id)
    }

    /// The chat contribution's `history.renderBrowser`: the hosted target's
    /// locators (no discovery permission), or the project's Agent History.
    pub fn history_browser(
        &mut self,
        root: &Path,
        discovery: bool,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<Entity<HistoryBrowser>, String> {
        let (source, enabled) = match &self.hosted {
            Some(hub) => (HistorySource::Hosted(hub.clone()), true),
            None => (
                HistorySource::Agent(self.project_agents(root, cx)?.history.clone()),
                discovery,
            ),
        };
        Ok(cx.new(|cx| HistoryBrowser::new(source, enabled, window, cx)))
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
    use super::{
        BUILT_IN_AGENT_RUNTIME_ID, hidden_agent_chat_runtime_ids,
        local_agent_id_for_agent_chat_runtime,
    };

    #[test]
    fn hidden_local_agents_hide_their_chat_runtimes_but_never_the_built_in() {
        assert_eq!(
            hidden_agent_chat_runtime_ids(&[
                "opencode".into(),
                "codex".into(),
                BUILT_IN_AGENT_RUNTIME_ID.into()
            ]),
            ["codex", "opencode-native"]
        );
        assert!(hidden_agent_chat_runtime_ids(&[]).is_empty());
        assert_eq!(
            local_agent_id_for_agent_chat_runtime("workbuddy-china"),
            "workbuddy-china"
        );
    }
}

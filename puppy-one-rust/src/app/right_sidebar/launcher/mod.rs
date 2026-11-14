//! `AuxiliaryWorkbenchLauncher` and `CloudAgentLauncher` with the
//! contributions they create from: the shell's [`WorkbenchHost`]. The
//! launcher knows the detected local Agents, the setup section, History,
//! and whether it creates for this machine's project (Agent chats and
//! terminals) or a hosted Project (its Agent only); the generic
//! [`Workbench`] only hosts what it places.
mod history;
#[cfg(feature = "dev-capture")]
mod lab;
#[cfg(test)]
mod tests;
mod view;

use crate::agent::connections::legacy_local_agent_inventory::{self as agents, Installation};
use crate::features::cloud::{HostedChats, hosted_installation};
use crate::features::desktop_agent::{AgentChats, HistoryBrowser};
use crate::features::local_agents::agent_chat_runtime_id;
use crate::features::settings::{AgentRoutingPreferences, PreferencesStore};
use crate::features::terminal::TerminalItem;
use crate::features::workbench::{
    Id, ItemKind, LauncherContext, RetainedItem, Workbench, WorkbenchHost, WorkbenchItem,
    WorkbenchView,
};
use crate::ui::components::Icon;
use crate::wake::Wake;
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use std::{
    collections::HashMap,
    path::PathBuf,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};

/// What the launcher asks of the window.
pub(crate) enum LauncherEvent {
    /// A hosted Agent run's changes were accepted (`onPublication`).
    CloudPublished,
}
impl EventEmitter<LauncherEvent> for WorkbenchLauncher {}

/// A launcher row's "open in a terminal" menu, pinned at the pointer.
struct LauncherMenu {
    group: Id,
    tab: Option<Id>,
    installation: Installation,
    at: Point<Pixels>,
}

pub(crate) struct WorkbenchLauncher {
    workbench: WeakEntity<Workbench>,
    /// The Agent chat contribution: this window's Agent bridge and the
    /// projects' controllers.
    chats: AgentChats,
    /// The hosted Agent's contribution: its Hubs and the location shown.
    hosted: HostedChats,
    installations: Vec<Installation>,
    /// Local agent ids hidden in Settings → Local Agents.
    hidden_agents: Vec<String>,
    scanning: bool,
    /// When the running discovery began (`useDelayedDiscoveryFeedback`).
    scan_started: Option<std::time::Instant>,
    scan_rx: mpsc::Receiver<Vec<Installation>>,
    scan_tx: mpsc::Sender<Vec<Installation>>,
    /// Agents launch as chats; a row's menu runs its CLI in a terminal.
    chat_mode: bool,
    /// Launcher tabs showing the cross-runtime History browser.
    history: HashMap<Id, Entity<HistoryBrowser>>,
    /// The launcher's last refused creation, per group (`launchError`).
    launch_errors: HashMap<Id, String>,
    /// Each launcher group's scroller.
    launcher_scroll: HashMap<Id, ScrollHandle>,
    /// Owner of `localAgents.chatHistoryDiscovery` (set by the shell).
    preferences: Option<Entity<PreferencesStore>>,
    /// The launcher's `LocalAgentSetupSection` (created with the preferences).
    setup: Option<Entity<crate::features::local_agents::SetupSection>>,
    /// This window (`agent_presence::owner`).
    owner: String,
    /// A hosted Agent run's changes were accepted.
    cloud_published: Arc<AtomicBool>,
    wake: Wake,
    menu: Option<LauncherMenu>,
    /// The shown project, as the workbench last reported it.
    shown: WorkbenchView,
}

impl WorkbenchLauncher {
    pub fn new(
        workbench: WeakEntity<Workbench>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (wake, rx) = Wake::channel();
        let (scan_tx, scan_rx) = mpsc::channel();
        let tx = scan_tx.clone();
        let scan_wake = wake.clone();
        std::thread::spawn(move || {
            let _ = tx.send(agents::discover());
            scan_wake.notify();
        });
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this.update_in(cx, |s, _, cx| s.woke(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        // An activation that installed a CLI rescans the launchers' Agents.
        let activation = crate::features::local_agents::activation_store(cx);
        cx.subscribe(
            &activation,
            |s, _, _: &crate::features::local_agents::InstallationsChanged, cx| s.rescan(cx),
        )
        .detach();
        Self {
            workbench,
            chats: AgentChats::new(window.window_handle().window_id().as_u64()),
            hosted: HostedChats::default(),
            installations: vec![],
            hidden_agents: vec![],
            scanning: true,
            scan_started: Some(std::time::Instant::now()),
            scan_rx,
            scan_tx,
            chat_mode: true,
            history: HashMap::new(),
            launch_errors: HashMap::new(),
            launcher_scroll: HashMap::new(),
            preferences: None,
            setup: None,
            owner: crate::features::agent_presence::owner(window),
            cloud_published: Default::default(),
            wake,
            menu: None,
            shown: WorkbenchView::default(),
        }
    }
    fn woke(&mut self, cx: &mut Context<Self>) {
        if self.cloud_published.swap(false, Ordering::SeqCst) {
            cx.emit(LauncherEvent::CloudPublished);
        }
        if let Ok(found) = self.scan_rx.try_recv() {
            self.installations = found;
            self.scanning = false;
            cx.notify();
        } else if self.scanning {
            // The delayed discovery feedback is due.
            cx.notify();
        }
    }
    pub fn set_preference_store(
        &mut self,
        store: Entity<PreferencesStore>,
        cx: &mut Context<Self>,
    ) {
        self.chats.set_preference_store(store.clone());
        // Discovery granted elsewhere (Settings) starts the open browsers.
        cx.observe(&store, |s, _, cx| s.sync_history(cx)).detach();
        self.preferences = Some(store);
        self.setup = None;
    }
    /// Hidden local Agents, routing and Payments reach the launcher and
    /// every open chat.
    pub fn set_preferences(
        &mut self,
        hidden: Vec<String>,
        routing: AgentRoutingPreferences,
        payments: bool,
        cx: &mut Context<Self>,
    ) {
        self.hidden_agents = hidden.clone();
        if self.chats.set_preferences(hidden, routing, payments, cx) {
            cx.notify();
        }
    }
    /// Model connections changed: every chat rereads them.
    pub fn reload_model_connections(&mut self, cx: &mut Context<Self>) {
        self.chats.reload_model_connections(cx);
    }
    /// A local folder's workbench: this machine's Agents and terminals.
    pub fn show_local(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        self.hosted.close();
        self.show(root, cx);
    }
    /// The hosted Project's Agent (`useCloudAgentWorkspace`).
    pub fn show_hosted(
        &mut self,
        target: crate::workspace::cloud::agent::AgentTarget,
        cx: &mut Context<Self>,
    ) {
        let (flag, wake) = (self.cloud_published.clone(), self.wake.clone());
        let root = self.hosted.open(
            target,
            Box::new(move || {
                flag.store(true, Ordering::SeqCst);
                wake.notify();
            }),
        );
        self.show(root, cx);
    }
    fn show(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        if let Some(workbench) = self.workbench.upgrade() {
            workbench.update(cx, |w, cx| w.show(root, cx));
        }
        cx.notify();
    }
    /// Whether the hosted Agent is shown.
    #[cfg(test)]
    pub fn is_hosted(&self) -> bool {
        self.hosted.is_open()
    }
    /// Installations offered by launchers: detected agents the user has not
    /// hidden, then the bundled Built-in Agent (never hidden); in Cloud, the
    /// hosted Agent only.
    pub(crate) fn visible_installations(&self) -> Vec<Installation> {
        if self.hosted.is_open() {
            return vec![hosted_installation()];
        }
        self.installations
            .iter()
            .filter(|i| i.bundled() || !self.hidden_agents.iter().any(|h| h == i.id))
            .cloned()
            .collect()
    }
    /// `discovery.refresh`: rescan local agent installations.
    fn rescan(&mut self, cx: &mut Context<Self>) {
        if self.scanning {
            return;
        }
        self.scanning = true;
        self.scan_started = Some(std::time::Instant::now());
        let tx = self.scan_tx.clone();
        let wake = self.wake.clone();
        std::thread::spawn(move || {
            let _ = tx.send(agents::discover());
            wake.notify();
        });
        cx.notify();
    }
    /// `CloudAgentWorkbench.prepare(id, session)`: a hosted chat for `tab`
    /// of `root`, its receipts persisted under the tab id; a History
    /// `session` opens it unless another tab has it open.
    fn hosted_chat(
        &mut self,
        root: &std::path::Path,
        tab: Id,
        session: Option<crate::workspace::cloud::agent::Session>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Rc<dyn WorkbenchItem>, String> {
        let item = self
            .hosted
            .chat(root, &format!("tab:{tab}"), session, window, cx)?;
        Ok(Rc::new(item))
    }
    /// `prepareAgentChatWorkbenchItem(project, itemId, runtimeId)` or, with
    /// a session, `restoreAgentChatWorkbenchItem`.
    fn chat(
        &mut self,
        root: &std::path::Path,
        runtime_id: &str,
        session_id: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Rc<dyn WorkbenchItem>, String> {
        let item = self
            .chats
            .prepare(root, runtime_id, session_id, window, cx)?;
        Ok(Rc::new(item))
    }
    /// A launcher row: a chat on `installation` (in chat mode), its CLI in a
    /// terminal, or the shell.
    fn launch(
        &mut self,
        group: Id,
        tab: Option<Id>,
        installation: Option<Installation>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let (root, can_chat, can_terminal) = {
            let w = workbench.read(cx);
            let Some(root) = w.root().cloned() else {
                return;
            };
            // Preparation belongs to the exact launcher; a stale click
            // cannot replace an existing session.
            if let Some(tab) = tab
                && !w.is_launcher(&root, tab)
            {
                return;
            }
            (
                root,
                w.can_create(ItemKind::Chat),
                w.can_create(ItemKind::Terminal),
            )
        };
        // Cloud: the hosted Agent only, no session lease of this machine.
        if self.hosted.is_open() {
            if !installation.as_ref().is_some_and(|i| i.chat) || !can_chat {
                return;
            }
            self.launch_errors.remove(&group);
            let Some(id) =
                tab.or_else(|| workbench.update(cx, |w, cx| w.new_launcher_tab(group, cx)))
            else {
                return;
            };
            match self.hosted_chat(&root, id, None, window, cx) {
                Ok(item) => {
                    workbench.update(cx, |w, cx| w.place(group, Some(id), item, cx));
                }
                Err(error) => {
                    self.launch_errors.insert(group, error);
                }
            }
            cx.notify();
            return;
        }
        let chat = installation
            .as_ref()
            .is_some_and(|i| i.chat && self.chat_mode);
        if !(if chat { can_chat } else { can_terminal }) {
            return;
        }
        self.launch_errors.remove(&group);
        let item = if let Some(installation) = installation.clone().filter(|_| chat) {
            // `prepareAgentChatWorkbenchItem(project, itemId, recipe.id)`;
            // `launchError`: a refused creation stays on the launcher with
            // its reason.
            match self.chat(
                &root,
                &agent_chat_runtime_id(&installation),
                None,
                window,
                cx,
            ) {
                Ok(item) => item,
                Err(error) => {
                    self.launch_errors.insert(group, error);
                    cx.notify();
                    return;
                }
            }
        } else {
            Rc::new(TerminalItem::launch(root, installation, window, cx))
        };
        workbench.update(cx, |w, cx| w.place(group, tab, item, cx));
        cx.notify();
    }
    /// A saved tab of `root` reopens: the hosted location's chat from its
    /// receipts, a chat's Agent session (`restoreAgentChatWorkbenchItem`),
    /// or a new shell.
    fn reopen(
        &mut self,
        root: &std::path::Path,
        tab: Id,
        item: &RetainedItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Rc<dyn WorkbenchItem>, String> {
        match item {
            // The tab's saved receipts reopen its conversation.
            RetainedItem::Chat { .. } if self.hosted.is_open() => {
                self.hosted_chat(root, tab, None, window, cx)
            }
            RetainedItem::Chat {
                runtime,
                thread,
                runtime_id,
                ..
            } => {
                // A chat retained before it ran on the Agent service names a
                // provider thread, not an Agent session: it reopens new.
                let thread = thread.clone().filter(|_| runtime_id.is_some());
                let runtime_id = runtime_id.clone().or_else(|| {
                    self.installations
                        .iter()
                        .find(|i| i.runtime == *runtime)
                        .map(agent_chat_runtime_id)
                });
                let runtime_id = runtime_id.ok_or_else(|| {
                    crate::localization::t("native.agent.uninstalled").to_string()
                })?;
                self.chat(root, &runtime_id, thread, window, cx)
            }
            RetainedItem::Terminal { .. } => Ok(Rc::new(TerminalItem::launch(
                root.to_path_buf(),
                None,
                window,
                cx,
            ))),
            RetainedItem::Launcher => Err("A launcher has no item.".into()),
        }
    }
}

/// The right sidebar's workbench over its launcher: the launcher is the
/// workbench's host, and the workbench redraws when the launcher changes.
pub(crate) fn compose(
    window: &mut Window,
    cx: &mut App,
) -> (Entity<Workbench>, Entity<WorkbenchLauncher>) {
    let workbench = cx.new(|cx| Workbench::new(window, cx));
    let launcher = cx.new(|cx| WorkbenchLauncher::new(workbench.downgrade(), window, cx));
    workbench.update(cx, |w, cx| {
        w.set_host(Rc::new(launcher.clone()));
        cx.observe(&launcher, |_, _, cx| cx.notify()).detach();
    });
    (workbench, launcher)
}

impl WorkbenchHost for Entity<WorkbenchLauncher> {
    fn launcher(&self, context: LauncherContext, cx: &mut App) -> AnyElement {
        self.update(cx, |l, cx| l.render_launcher(context, cx))
    }
    fn launcher_title(&self, tab: Id, cx: &App) -> Option<String> {
        self.read(cx)
            .history
            .contains_key(&tab)
            .then(|| crate::localization::t("agent.history.title").into())
    }
    fn launcher_mark(&self, tab: Id, color: Rgba, cx: &App) -> Option<AnyElement> {
        self.read(cx).history.contains_key(&tab).then(|| {
            Icon::new("history")
                .small()
                .stroke(2.)
                .color(color)
                .into_any_element()
        })
    }
    fn reopen(
        &self,
        root: &std::path::Path,
        tab: Id,
        item: &RetainedItem,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<Rc<dyn WorkbenchItem>, String> {
        self.update(cx, |l, cx| l.reopen(root, tab, item, window, cx))
    }
    fn changed(&self, view: WorkbenchView, cx: &mut App) {
        self.update(cx, |l, cx| {
            if l.shown.roots != view.roots {
                l.chats.set_roots(view.roots.clone());
            }
            l.shown = view;
            l.sync_history(cx);
        });
    }
    fn tab_removed(&self, tab: Id, cx: &mut App) {
        self.update(cx, |l, _| {
            l.history.remove(&tab);
        });
    }
    fn shutdown(&self, cx: &mut App) {
        self.update(cx, |l, _| l.chats.shutdown());
    }
}

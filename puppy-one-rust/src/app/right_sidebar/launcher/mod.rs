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
use crate::ui::form_input::{InputEvent, TextInput};
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
    },
};

/// What the launcher asks of the window.
pub(crate) enum LauncherEvent {
    /// A hosted Agent run's changes were accepted (`onPublication`).
    CloudPublished,
}
impl EventEmitter<LauncherEvent> for WorkbenchLauncher {}

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
    observations: Vec<crate::platform::local_agent_setup::Observation>,
    scanning: bool,
    /// The running discovery refreshes evidence already shown.
    refreshing: bool,
    /// When the running discovery began (`useDelayedDiscoveryFeedback`).
    scan_started: Option<std::time::Instant>,
    discovery: Entity<crate::features::local_agents::Installations>,
    discovery_override: bool,
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
    /// The shown project, as the workbench last reported it.
    shown: WorkbenchView,
    /// Each launcher's Agent rows' focus, by Agent.
    row_focus: HashMap<(Id, &'static str), FocusHandle>,
    /// Each launcher's heading: focusable, never a Tab stop.
    heading_focus: HashMap<Id, FocusHandle>,
    /// Each launcher's usable rows as last drawn, detected then bundled.
    return_targets: HashMap<Id, Vec<FocusHandle>>,
    /// The launcher whose setup section was last used.
    setup_group: Option<Id>,
    /// The Agent currently selected in the L1 composer-first launcher.
    selected_agent: Option<String>,
    /// Per-group L1 hero prompt inputs.
    hero_inputs: HashMap<Id, Entity<TextInput>>,
    /// Per-group active launcher tab id, updated on render for Enter submit.
    hero_tabs: HashMap<Id, Option<Id>>,
    /// Which group currently has its Agent picker popover open.
    picker_open: Option<Id>,
    /// Focus handle per group's Agent picker popover (for Escape dismissal).
    picker_focus: HashMap<Id, FocusHandle>,
    /// Group whose hero input should take focus as soon as it renders.
    pending_focus: Option<Id>,
    /// Passive history watcher for the shown local project (only when the user
    /// already granted `chatHistoryDiscoveryEnabled`).
    recent_watch: Option<(PathBuf, Box<dyn FnOnce()>)>,
}

impl WorkbenchLauncher {
    pub fn new(
        workbench: WeakEntity<Workbench>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (wake, rx) = Wake::channel();
        let discovery = crate::features::local_agents::installation_store(cx);
        cx.observe(&discovery, |s, _, cx| s.sync_inventory(cx))
            .detach();
        let found = discovery.read(cx).inventory();
        let (scanning, refreshing) = {
            let discovery = discovery.read(cx);
            (discovery.scanning, discovery.refreshing)
        };
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this.update_in(cx, |s, _, cx| s.woke(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            workbench,
            chats: AgentChats::new(window.window_handle().window_id().as_u64()),
            hosted: HostedChats::default(),
            installations: found.installations,
            hidden_agents: vec![],
            observations: found.observations,
            scanning,
            refreshing,
            scan_started: Some(std::time::Instant::now()),
            discovery,
            discovery_override: false,
            chat_mode: true,
            history: HashMap::new(),
            launch_errors: HashMap::new(),
            launcher_scroll: HashMap::new(),
            preferences: None,
            setup: None,
            owner: crate::features::agent_presence::owner(window),
            cloud_published: Default::default(),
            wake,
            shown: WorkbenchView::default(),
            row_focus: HashMap::new(),
            heading_focus: HashMap::new(),
            return_targets: HashMap::new(),
            setup_group: None,
            selected_agent: None,
            hero_inputs: HashMap::new(),
            hero_tabs: HashMap::new(),
            picker_open: None,
            picker_focus: HashMap::new(),
            pending_focus: None,
            recent_watch: None,
        }
    }
    fn woke(&mut self, cx: &mut Context<Self>) {
        if self.cloud_published.swap(false, Ordering::SeqCst) {
            cx.emit(LauncherEvent::CloudPublished);
        }
        cx.notify();
    }
    fn sync_inventory(&mut self, cx: &mut Context<Self>) {
        if self.discovery_override {
            return;
        }
        let discovery = self.discovery.read(cx);
        if discovery.scanning && !self.scanning {
            self.scan_started = Some(std::time::Instant::now());
        }
        self.scanning = discovery.scanning;
        self.refreshing = discovery.refreshing;
        let found = discovery.inventory();
        self.installations = found.installations;
        self.observations = found.observations;
        cx.notify();
    }
    pub fn set_preference_store(
        &mut self,
        store: Entity<PreferencesStore>,
        cx: &mut Context<Self>,
    ) {
        self.chats.set_preference_store(store.clone());
        if self.selected_agent.is_none() {
            self.selected_agent = store
                .read(cx)
                .state
                .agent_routing
                .selected_runtime_id
                .clone();
        }
        // Discovery granted elsewhere (Settings) starts the open browsers.
        cx.observe(&store, |s, _, cx| {
            s.sync_history(cx);
            s.ensure_recent_watch(cx);
        })
        .detach();
        self.preferences = Some(store);
        self.setup = None;
        self.ensure_recent_watch(cx);
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
    /// A hosted Agent conversation a link names (`?session=`): shown in a
    /// tab of its own once the Cloud confirms it is this person's. Unknown,
    /// foreign or unreachable ones open nothing and say nothing.
    pub fn open_hosted_session(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(hub) = self.hosted.hub() else {
            return;
        };
        let (found, resolved) = async_channel::bounded(1);
        let (wake, hub_for_wake) = (self.wake.clone(), hub.clone());
        hub.resolve_session(
            id,
            Box::new(move |session| {
                let _ = found.send_blocking(session);
                wake.notify();
            }),
        );
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Some(session)) = resolved.recv().await {
                let _ = this.update_in(cx, |l, window, cx| {
                    // The window moved on to another project meanwhile.
                    if l.hosted
                        .hub()
                        .is_some_and(|now| Arc::ptr_eq(&now, &hub_for_wake))
                    {
                        l.place_hosted_session(session, window, cx);
                    }
                });
            }
        })
        .detach();
    }
    fn place_hosted_session(
        &mut self,
        session: crate::workspace::cloud::agent::Session,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let Some(root) = workbench.read(cx).root().cloned() else {
            return;
        };
        if !workbench.read(cx).can_create(ItemKind::Chat) {
            return;
        }
        let Some((group, launcher)) = workbench.update(cx, |w, cx| w.prepare_launch_slot(cx))
        else {
            return;
        };
        let Some(tab) =
            launcher.or_else(|| workbench.update(cx, |w, cx| w.new_launcher_tab(group, cx)))
        else {
            return;
        };
        // Already open in another tab: that tab shows it.
        if let Ok(item) = self.hosted_chat(&root, tab, Some(session), window, cx) {
            workbench.update(cx, |w, cx| w.place(group, Some(tab), item, cx));
        }
        cx.notify();
    }
    fn show(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        self.shown.root = Some(root.clone());
        if let Some(workbench) = self.workbench.upgrade() {
            let roots = workbench.update(cx, |w, cx| {
                w.show(root, cx);
                w.open_roots()
            });
            if self.shown.roots != roots {
                self.shown.roots = roots.clone();
                self.chats.set_roots(roots);
            }
        }
        self.picker_open = None;
        self.ensure_recent_watch(cx);
        cx.notify();
    }
    /// Starts passively watching local conversation history for the shown
    /// project ONLY if the user has already granted history discovery permission.
    fn ensure_recent_watch(&mut self, cx: &mut Context<Self>) {
        if self.hosted.is_open() || !self.history_discovery(cx) {
            if let Some((_, unwatch)) = self.recent_watch.take() {
                unwatch();
            }
            return;
        }
        let Some(root) = self.shown.root.clone() else {
            return;
        };
        if !root.is_dir() {
            return;
        }
        if self
            .recent_watch
            .as_ref()
            .is_some_and(|(watched, _)| watched == &root)
        {
            return;
        }
        if let Some((_, unwatch)) = self.recent_watch.take() {
            unwatch();
        }
        if let Some(unwatch) = self
            .chats
            .watch_recent_history(&root, self.wake.clone(), cx)
        {
            self.recent_watch = Some((root, unwatch));
        }
    }
    /// Cached recent sessions for the current project (max 3), never starting
    /// discovery without explicit permission.
    pub(super) fn recent_sessions(
        &self,
        cx: &App,
    ) -> Vec<crate::agent::contract::dto::SessionMetadata> {
        if self.hosted.is_open() {
            return self
                .hosted
                .cached_recent_sessions(&self.shown.open_chats, 3);
        }
        if !self.history_discovery(cx) {
            return Vec::new();
        }
        let Some(root) = self.shown.root.as_ref() else {
            return Vec::new();
        };
        self.chats
            .cached_recent_sessions(root, &self.shown.open_chats, 3)
    }
    /// The currently selected Agent in the L1 composer: remembers the user's
    /// last pick, falling back to the first detected local Agent, then Built-in.
    pub(super) fn active_installation(&self) -> Option<Installation> {
        let visible = self.visible_installations();
        if let Some(selected) = self.selected_agent.as_deref()
            && let Some(found) = visible
                .iter()
                .find(|i| i.chat && (i.id == selected || agent_chat_runtime_id(i) == selected))
        {
            return Some(found.clone());
        }
        visible
            .iter()
            .find(|i| i.chat && !i.bundled())
            .or_else(|| visible.iter().find(|i| i.chat))
            .cloned()
    }
    /// Selects `id` as the active Agent for the L1 composer and returns focus
    /// to `group`'s prompt input.
    pub(super) fn select_agent(
        &mut self,
        group: Id,
        id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.selected_agent = Some(id);
        self.picker_open = None;
        self.focus_group(group, window, cx);
        cx.notify();
    }
    /// Gets or creates `group`'s L1 hero prompt input.
    pub(super) fn hero_input(
        &mut self,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<TextInput> {
        self.hero_tabs.insert(group, tab);
        let input =
            self.hero_inputs
                .entry(group)
                .or_insert_with(|| {
                    let input = cx.new(|cx| {
                        let mut input = TextInput::new("", true, 64_000, window, cx);
                        let size = crate::theme::ty().left.content;
                        input.prompt_text = Some((size, size * 1.5));
                        input.placeholder_color = Some(|t| {
                            crate::features::desktop_agent::AgentTheme::new(t).composer_placeholder
                        });
                        input.min_height = size * 1.5 * 2.;
                        input.appearance = false;
                        input.submit_on_enter = true;
                        input.set_max_rows(6, cx);
                        input
                    });
                    cx.subscribe_in(&input, window, move |s, _, event: &InputEvent, w, cx| {
                        match event {
                            InputEvent::Changed => cx.notify(),
                            InputEvent::Submit => s.submit_hero(group, w, cx),
                        }
                    })
                    .detach();
                    input
                })
                .clone();
        if self.pending_focus == Some(group) {
            self.pending_focus = None;
            input.focus_handle(cx).focus(window, cx);
        }
        input
    }
    /// Focuses `group`'s L1 hero prompt input immediately (or on its next render).
    pub(super) fn focus_group(&mut self, group: Id, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(input) = self.hero_inputs.get(&group) {
            self.pending_focus = None;
            input.focus_handle(cx).focus(window, cx);
        } else {
            self.pending_focus = Some(group);
            cx.notify();
        }
    }
    /// Submits `group`'s L1 hero prompt: creates a fresh chat tab on the
    /// selected Agent and sends the prompt without any extra click.
    pub(super) fn submit_hero(&mut self, group: Id, window: &mut Window, cx: &mut Context<Self>) {
        let Some(input) = self.hero_inputs.get(&group).cloned() else {
            return;
        };
        if input.update(cx, |i, cx| i.composing(window, cx)) {
            return;
        }
        let prompt = input.read(cx).current_text(cx);
        if prompt.trim().is_empty() {
            return;
        }
        let Some(installation) = self.active_installation() else {
            return;
        };
        let tab = self.hero_tabs.get(&group).copied().flatten();
        self.picker_open = None;
        self.selected_agent = Some(installation.id.to_owned());
        input.update(cx, |i, cx| i.set_text("", cx));
        if self.hosted.is_open() {
            self.launch_hosted_with_prompt(group, tab, prompt, window, cx);
        } else {
            let runtime_id = agent_chat_runtime_id(&installation);
            self.launch_seeded_runtime_chat(group, tab, &runtime_id, &prompt, window, cx);
        }
    }
    /// Creates a hosted Cloud Agent chat tab with an initial prompt already
    /// submitted.
    fn launch_hosted_with_prompt(
        &mut self,
        group: Id,
        tab: Option<Id>,
        prompt: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let (root, can_chat) = {
            let w = workbench.read(cx);
            let Some(root) = w.root().cloned() else {
                return;
            };
            if let Some(tab) = tab
                && !w.launcher_available(&root, tab)
            {
                return;
            }
            (root, w.can_create(ItemKind::Chat))
        };
        if !can_chat {
            return;
        }
        self.launch_errors.remove(&group);
        let Some(id) = tab.or_else(|| workbench.update(cx, |w, cx| w.new_launcher_tab(group, cx)))
        else {
            return;
        };
        match self.hosted.chat_with_prompt(
            &root,
            &format!("tab:{id}"),
            None,
            Some(prompt),
            window,
            cx,
        ) {
            Ok(item) => {
                workbench.update(cx, |w, cx| w.place(group, Some(id), Rc::new(item), cx));
            }
            Err(error) => {
                self.launch_errors.insert(group, error);
            }
        }
        cx.notify();
    }
    /// The hosted Project whose Agent the launcher shows.
    pub fn hosted_project(&self) -> Option<String> {
        self.hosted.project()
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
    /// Launches a fresh preferred/detected local Agent chat tab in `(group, tab)`.
    pub(crate) fn launch_preferred_chat(
        &mut self,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::agent::connections::legacy_runtime_registry::Runtime;
        let visible = self.visible_installations();
        let installation = visible
            .iter()
            .find(|i| i.chat && !i.bundled())
            .or_else(|| visible.iter().find(|i| i.chat))
            .cloned()
            .unwrap_or_else(|| Installation {
                runtime: Runtime::PuppyOne,
                id: agents::BUILT_IN_AGENT_ID,
                label: agents::BUILT_IN_AGENT_LABEL.into(),
                executable: PathBuf::new(),
                chat: true,
            });
        self.chat_mode = true;
        self.launch(group, tab, Some(installation), window, cx);
    }
    /// Launches a fresh local Agent chat tab on `runtime_id` with `initial_prompt`
    /// seeded and armed for one-shot auto-submit once the controller initializes.
    pub(crate) fn launch_seeded_runtime_chat(
        &mut self,
        group: Id,
        tab: Option<Id>,
        runtime_id: &str,
        initial_prompt: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.hosted.is_open() {
            return;
        }
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let (root, roots, can_chat) = {
            let w = workbench.read(cx);
            let Some(root) = w.root().cloned() else {
                return;
            };
            if let Some(tab) = tab
                && !w.launcher_available(&root, tab)
            {
                return;
            }
            (root, w.open_roots(), w.can_create(ItemKind::Chat))
        };
        if !can_chat {
            return;
        }
        if self.shown.roots != roots {
            self.shown.roots = roots.clone();
            self.chats.set_roots(roots);
        }
        self.chat_mode = true;
        self.launch_errors.remove(&group);
        match self
            .chats
            .prepare_seeded(&root, runtime_id, initial_prompt, window, cx)
        {
            Ok(item) => {
                workbench.update(cx, |w, cx| w.place(group, tab, Rc::new(item), cx));
            }
            Err(error) => {
                self.launch_errors.insert(group, error);
            }
        }
        cx.notify();
    }
    /// `discovery.refresh`: rescan local agent installations.
    fn rescan(&mut self, cx: &mut Context<Self>) {
        self.discovery.update(cx, |s, cx| s.refresh(cx));
        self.sync_inventory(cx);
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
                && !w.launcher_available(&root, tab)
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
    fn launcher(&self, context: LauncherContext, window: &mut Window, cx: &mut App) -> AnyElement {
        self.update(cx, |l, cx| l.render_launcher(context, window, cx))
    }
    fn focus_launcher(&self, group: Id, window: &mut Window, cx: &mut App) {
        self.update(cx, |l, cx| l.focus_group(group, window, cx));
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
        self.update(cx, |l, _| {
            if let Some((_, unwatch)) = l.recent_watch.take() {
                unwatch();
            }
            l.chats.shutdown();
        });
    }
}

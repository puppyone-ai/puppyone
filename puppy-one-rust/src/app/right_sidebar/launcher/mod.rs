//! `AuxiliaryWorkbenchLauncher` and `CloudAgentLauncher` with the
//! contributions they create from: the shell's [`WorkbenchHost`].
//!
//! Architecture:
//! - [`state`] — Pure domain state (`AgentSelection`, deterministic active
//!   Agent resolution across incremental discovery, `LauncherPageState`).
//! - [`composer`] — L1 hero prompt composer card and occluding Agent switcher
//!   popover built on `PopoverMenu` + `SurfaceFrame`.
//! - [`view`] — L1 stage layout composition (composer, discovery feedback,
//!   setup section, recent sessions, quiet utility footer).
//! - [`history`] — Cross-runtime History browser hosting and session restore.
mod composer;
mod history;
#[cfg(feature = "dev-capture")]
mod lab;
mod state;
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
use state::{AgentSelection, LauncherPageState, LauncherSlot, launcher_placeholder};
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
    /// Owner of `localAgents.*` and `agentRouting` (set by the shell).
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
    /// The launcher page whose setup section was last used.
    setup_slot: Option<LauncherSlot>,
    /// Single source of truth for the L1 launcher's selected Agent.
    selection: AgentSelection,
    /// Per-tab launcher page state (composer input, popover, focus, scroll,
    /// launch error): strictly isolated per tab and dropped when closed.
    pages: HashMap<LauncherSlot, LauncherPageState>,
    /// Passive history watcher for the shown local project (only when the user
    /// already granted `chatHistoryDiscoveryEnabled`).
    recent_watch: Option<(PathBuf, Box<dyn FnOnce()>)>,
    /// Test-only deterministic recent sessions fixture for overlap/occlusion tests.
    #[cfg(test)]
    recent_override: Option<Vec<crate::agent::contract::dto::SessionMetadata>>,
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
            preferences: None,
            setup: None,
            owner: crate::features::agent_presence::owner(window),
            cloud_published: Default::default(),
            wake,
            shown: WorkbenchView::default(),
            setup_slot: None,
            selection: AgentSelection::default(),
            pages: HashMap::new(),
            recent_watch: None,
            #[cfg(test)]
            recent_override: None,
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
        self.sync_placeholders(cx);
        cx.notify();
    }

    /// Connects the shared `PreferencesStore`, hydrates `agent_routing`, and
    /// observes future loads / changes so the launcher never drifts from
    /// persisted routing or locale preferences.
    pub fn set_preference_store(
        &mut self,
        store: Entity<PreferencesStore>,
        cx: &mut Context<Self>,
    ) {
        self.chats.set_preference_store(store.clone());
        self.sync_selection_from_store(&store, cx);
        // Observe the store for delayed disk loads, history permission grants,
        // routing updates, and locale switches.
        cx.observe(&store, |s, store, cx| {
            s.sync_selection_from_store(&store, cx);
            s.sync_history(cx);
            s.ensure_recent_watch(cx);
            s.sync_placeholders(cx);
        })
        .detach();
        self.preferences = Some(store);
        self.setup = None;
        self.ensure_recent_watch(cx);
        self.sync_placeholders(cx);
    }

    /// Keeps `selection` and `PreferencesStore.state.agent_routing` converged:
    /// if the user explicitly picked an Agent before disk hydration completed,
    /// flush that pick to storage once loaded; otherwise follow the store.
    fn sync_selection_from_store(
        &mut self,
        store: &Entity<PreferencesStore>,
        cx: &mut Context<Self>,
    ) {
        let (loaded, routing) = {
            let s = store.read(cx);
            (s.loaded, s.state.agent_routing.clone())
        };
        if !loaded {
            return;
        }
        if let Some(pending) = self.selection.take_pending_persist() {
            store.update(cx, |store, cx| {
                store.change(
                    |p| p.agent_routing = p.agent_routing.select_runtime(Some(&pending)),
                    cx,
                )
            });
            return;
        }
        if self.selection.sync_preferences(&routing) {
            self.sync_placeholders(cx);
            cx.notify();
        }
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
        let hidden_changed = self.hidden_agents != hidden;
        self.hidden_agents = hidden.clone();
        let selection_changed = self.selection.sync_preferences(&routing);
        let chats_changed = self.chats.set_preferences(hidden, routing, payments, cx);
        if hidden_changed || selection_changed {
            self.sync_placeholders(cx);
        }
        if hidden_changed || selection_changed || chats_changed {
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
        if self.shown.root.as_ref() != Some(&root) {
            self.pages.clear();
            self.setup_slot = None;
        }
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
        self.close_all_pickers();
        self.ensure_recent_watch(cx);
        self.sync_placeholders(cx);
        cx.notify();
    }

    // --------------------------------------------------- page state helpers

    fn page_mut(&mut self, slot: LauncherSlot, cx: &mut Context<Self>) -> &mut LauncherPageState {
        self.pages
            .entry(slot)
            .or_insert_with(|| LauncherPageState::new(cx.focus_handle().tab_stop(false)))
    }

    fn remove_page(&mut self, slot: LauncherSlot) {
        self.pages.remove(&slot);
        if self.setup_slot == Some(slot) {
            self.setup_slot = None;
        }
    }

    fn is_picker_open(&self, slot: LauncherSlot) -> bool {
        self.pages.get(&slot).is_some_and(|p| p.picker_open)
    }

    fn set_picker_open(&mut self, slot: LauncherSlot, open: bool, cx: &mut Context<Self>) {
        let changed = self.pages.get(&slot).map(|p| p.picker_open) != Some(open)
            || (open
                && self
                    .pages
                    .iter()
                    .any(|(id, p)| *id != slot && p.picker_open));
        if open {
            for (id, state) in &mut self.pages {
                if *id != slot {
                    state.picker_open = false;
                }
            }
        }
        self.page_mut(slot, cx).picker_open = open;
        if changed {
            cx.notify();
        }
    }

    fn close_all_pickers(&mut self) {
        for state in self.pages.values_mut() {
            state.picker_open = false;
        }
    }

    fn set_launch_error(&mut self, slot: LauncherSlot, error: String, cx: &mut Context<Self>) {
        self.page_mut(slot, cx).launch_error = Some(error);
    }

    fn clear_launch_error(&mut self, slot: LauncherSlot) {
        if let Some(state) = self.pages.get_mut(&slot) {
            state.launch_error = None;
        }
    }

    fn launch_error(&self, slot: LauncherSlot) -> Option<&str> {
        self.pages
            .get(&slot)
            .and_then(|p| p.launch_error.as_deref())
    }

    fn row_focus(
        &mut self,
        slot: LauncherSlot,
        id: &'static str,
        cx: &mut Context<Self>,
    ) -> FocusHandle {
        self.page_mut(slot, cx)
            .row_focus
            .entry(id)
            .or_insert_with(|| cx.focus_handle())
            .clone()
    }

    fn heading_focus(&mut self, slot: LauncherSlot, cx: &mut Context<Self>) -> FocusHandle {
        self.page_mut(slot, cx).heading_focus.clone()
    }

    fn page_scroll(&mut self, slot: LauncherSlot, cx: &mut Context<Self>) -> ScrollHandle {
        self.page_mut(slot, cx).scroll.clone()
    }

    #[cfg(test)]
    pub(crate) fn tab_input(&self, tab: Id) -> Option<Entity<TextInput>> {
        self.pages
            .get(&LauncherSlot::Tab(tab))
            .and_then(|p| p.input.clone())
    }

    #[cfg(test)]
    pub(super) fn has_tab_page(&self, tab: Id) -> bool {
        self.pages.contains_key(&LauncherSlot::Tab(tab))
    }

    /// Synchronizes the dynamic placeholder on every mounted launcher page
    /// hero input strictly during state transitions — never during `render()`.
    pub(super) fn sync_placeholders(&self, cx: &mut Context<Self>) {
        let placeholder = launcher_placeholder(self.active_installation().as_ref());
        for state in self.pages.values() {
            if let Some(input) = &state.input {
                let text = placeholder.clone();
                input.update(cx, |i, cx| i.set_placeholder(text, cx));
            }
        }
    }

    // --------------------------------------------------------- recent history

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
        #[cfg(test)]
        if let Some(sessions) = &self.recent_override {
            return sessions.clone();
        }
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

    // --------------------------------------------------- selection & composer

    /// The currently selected Agent in the L1 composer: resolved cleanly from
    /// authoritative routing preferences + explicit choice + visible catalog.
    pub(super) fn active_installation(&self) -> Option<Installation> {
        let visible = self.visible_installations();
        self.selection.resolve_active(
            &visible,
            &self.hidden_agents,
            self.scanning,
            self.hosted.is_open(),
        )
    }

    /// Selects `id` as the active Agent for the L1 composer, persists the
    /// choice to `PreferencesStore.agent_routing`, updates all placeholders,
    /// and returns keyboard focus to `slot`'s prompt input.
    fn select_agent(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.hosted.is_open() {
            let store_loaded = self
                .preferences
                .as_ref()
                .is_none_or(|store| store.read(cx).loaded);
            let runtime_id = self.selection.select_explicit(&id, store_loaded);
            if store_loaded && let Some(store) = self.preferences.clone() {
                store.update(cx, |store, cx| {
                    store.change(
                        |p| p.agent_routing = p.agent_routing.select_runtime(Some(&runtime_id)),
                        cx,
                    )
                });
            }
        }
        self.set_picker_open(slot, false, cx);
        self.sync_placeholders(cx);
        self.focus_page(slot, group, tab, window, cx);
        cx.notify();
    }

    /// Gets or creates `slot`'s L1 hero prompt input, initialized with the
    /// active Agent's placeholder. Never calls `cx.notify()` on existing child
    /// inputs during render.
    fn ensure_page_input(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<TextInput> {
        let existing = self.pages.get(&slot).and_then(|p| p.input.clone());
        if let Some(input) = existing {
            return input;
        }
        let initial_placeholder = launcher_placeholder(self.active_installation().as_ref());
        let input = cx.new(|cx| {
            let mut input = TextInput::new(initial_placeholder, true, 64_000, window, cx);
            let size = crate::theme::ty().left.content;
            input.prompt_text = Some((size, size * 1.5));
            input.placeholder_color =
                Some(|t| crate::features::desktop_agent::AgentTheme::new(t).composer_placeholder);
            input.min_height = size * 1.5 * 2.;
            input.appearance = false;
            input.submit_on_enter = true;
            input.set_rows(2, 6, cx);
            input
        });
        cx.subscribe_in(
            &input,
            window,
            move |s, _, event: &InputEvent, w, cx| match event {
                InputEvent::Changed => cx.notify(),
                InputEvent::Submit => s.submit_hero(slot, group, tab, w, cx),
            },
        )
        .detach();
        self.page_mut(slot, cx).input = Some(input.clone());
        input
    }

    /// Focuses `slot`'s L1 hero prompt input immediately (creating the input
    /// eagerly if needed, so focus never waits for a render side effect).
    fn focus_page(
        &mut self,
        slot: LauncherSlot,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let input = self.ensure_page_input(slot, group, tab, window, cx);
        input.focus_handle(cx).focus(window, cx);
    }

    /// Submits `slot`'s L1 hero prompt: creates a fresh chat tab on the
    /// selected Agent and sends the prompt without any extra click.
    fn submit_hero(
        &mut self,
        slot: LauncherSlot,
        fallback_group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(input) = self.pages.get(&slot).and_then(|p| p.input.clone()) else {
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
        let group = tab
            .and_then(|id| {
                self.workbench
                    .upgrade()
                    .and_then(|wb| wb.read(cx).group_of(id))
            })
            .unwrap_or(fallback_group);
        self.set_picker_open(slot, false, cx);
        input.update(cx, |i, cx| i.set_text("", cx));
        if self.hosted.is_open() {
            self.launch_hosted_with_prompt(group, tab, prompt, window, cx);
        } else {
            let runtime_id = agent_chat_runtime_id(&installation);
            let store_loaded = self
                .preferences
                .as_ref()
                .is_none_or(|store| store.read(cx).loaded);
            self.selection.select_explicit(&runtime_id, store_loaded);
            if store_loaded && let Some(store) = self.preferences.clone() {
                let runtime = runtime_id.clone();
                store.update(cx, |store, cx| {
                    store.change(
                        |p| p.agent_routing = p.agent_routing.select_runtime(Some(&runtime)),
                        cx,
                    )
                });
            }
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
        let slot = LauncherSlot::of(group, tab);
        self.clear_launch_error(slot);
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
                self.remove_page(slot);
                self.remove_page(LauncherSlot::Tab(id));
                workbench.update(cx, |w, cx| w.place(group, Some(id), Rc::new(item), cx));
            }
            Err(error) => {
                self.set_launch_error(LauncherSlot::Tab(id), error, cx);
            }
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

    /// Launches a fresh preferred/detected local Agent chat tab in `(group, tab)`.
    pub(crate) fn launch_preferred_chat(
        &mut self,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::agent::connections::legacy_runtime_registry::Runtime;
        let installation = self.active_installation().unwrap_or_else(|| Installation {
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
        let slot = LauncherSlot::of(group, tab);
        self.chat_mode = true;
        self.clear_launch_error(slot);
        match self
            .chats
            .prepare_seeded(&root, runtime_id, initial_prompt, window, cx)
        {
            Ok(item) => {
                self.remove_page(slot);
                workbench.update(cx, |w, cx| w.place(group, tab, Rc::new(item), cx));
            }
            Err(error) => {
                self.set_launch_error(slot, error, cx);
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
        let slot = LauncherSlot::of(group, tab);
        // Cloud: the hosted Agent only, no session lease of this machine.
        if self.hosted.is_open() {
            if !installation.as_ref().is_some_and(|i| i.chat) || !can_chat {
                return;
            }
            self.clear_launch_error(slot);
            let Some(id) =
                tab.or_else(|| workbench.update(cx, |w, cx| w.new_launcher_tab(group, cx)))
            else {
                return;
            };
            match self.hosted_chat(&root, id, None, window, cx) {
                Ok(item) => {
                    self.remove_page(slot);
                    self.remove_page(LauncherSlot::Tab(id));
                    workbench.update(cx, |w, cx| w.place(group, Some(id), item, cx));
                }
                Err(error) => {
                    self.set_launch_error(LauncherSlot::Tab(id), error, cx);
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
        self.clear_launch_error(slot);
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
                    self.set_launch_error(slot, error, cx);
                    cx.notify();
                    return;
                }
            }
        } else {
            Rc::new(TerminalItem::launch(root, installation, window, cx))
        };
        self.remove_page(slot);
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
    fn focus_launcher(&self, group: Id, tab: Option<Id>, window: &mut Window, cx: &mut App) {
        let slot = LauncherSlot::of(group, tab);
        self.update(cx, |l, cx| l.focus_page(slot, group, tab, window, cx));
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
            l.remove_page(LauncherSlot::Tab(tab));
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

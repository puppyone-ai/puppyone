//! The launcher's History (`WorkbenchLauncherState.historyOpen` with the
//! chat contribution's `history.renderBrowser`): a launcher tab becomes
//! "Chat history" and hosts the cross-runtime browser until Back or Open.
use super::*;
use crate::features::desktop_agent::HistoryBrowserEvent;

impl Workbench {
    /// `onOpenHistory`: the launcher tab itself, or a new launcher tab.
    pub(super) fn open_history(
        &mut self,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(root) = self.root.clone() else {
            return;
        };
        let Some(tab) = tab.or_else(|| {
            let p = self.project_mut()?;
            let id = p.layout.add(group);
            p.content.insert(id, Content::Launcher);
            Some(id)
        }) else {
            return;
        };
        if self.history.contains_key(&tab) {
            return;
        }
        let discovery = self.history_discovery(cx);
        match self.chats.history_browser(&root, discovery, window, cx) {
            Ok(browser) => self.install_history(tab, browser, window, cx),
            Err(error) => {
                self.launch_errors.insert(group, error);
                cx.notify();
            }
        }
    }
    /// Hosts `browser` in the launcher tab `tab`.
    pub(super) fn install_history(
        &mut self,
        tab: Id,
        browser: Entity<HistoryBrowser>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        cx.observe(&browser, |_, _, cx| cx.notify()).detach();
        cx.subscribe_in(&browser, window, move |s, _, event, window, cx| {
            s.history_event(tab, event, window, cx)
        })
        .detach();
        self.history.insert(tab, browser);
        cx.notify();
    }
    fn history_event(
        &mut self,
        tab: Id,
        event: &HistoryBrowserEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            HistoryBrowserEvent::Back => {
                self.history.remove(&tab);
            }
            HistoryBrowserEvent::Allow => {
                if let Some(store) = &self.preferences {
                    store.update(cx, |p, cx| {
                        p.change(|p| p.local_agents.chat_history_discovery = true, cx)
                    });
                }
                if let Some(browser) = self.history.get(&tab) {
                    browser.update(cx, |b, cx| b.enable(cx));
                }
            }
            // `prepareAgentChatWorkbenchItem({ historyTarget })`.
            HistoryBrowserEvent::Open(target) => {
                if let Some(group) = self.group_of(tab) {
                    self.creation_failure = None;
                    if self.chats.is_hosted() {
                        self.open_hosted_history_target(group, tab, target.id.clone(), window, cx);
                    } else {
                        self.restore_history_target(group, tab, target.clone(), window, cx);
                    }
                }
            }
        }
        cx.notify();
    }
    /// The group showing `tab`.
    pub(super) fn group_of(&self, tab: Id) -> Option<Id> {
        self.project()?
            .layout
            .groups
            .iter()
            .find(|(_, g)| g.tabs.contains(&tab))
            .map(|(group, _)| *group)
    }
    /// `restoreAgentChatWorkbenchItem` for a History target: the launcher
    /// tab becomes the chat only once its saved session opened; otherwise it
    /// stays and the failure is retryable (`recordCreationFailure`).
    pub(super) fn restore_history_target(
        &mut self,
        group: Id,
        tab: Id,
        target: HistoryTarget,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(root) = self.root.clone() else {
            return;
        };
        let mut saved = match self.chats.open_saved(&root, &target, cx) {
            Ok(saved) => saved,
            Err(_) => {
                self.history_restore_failed(tab, target, cx);
                return;
            }
        };
        let opening = saved.opening();
        cx.spawn_in(window, async move |this, cx| {
            let opened = opening.await;
            this.update_in(cx, |s, window, cx| {
                let launcher = s.root.as_ref() == Some(&root)
                    && matches!(
                        s.project().and_then(|p| p.content.get(&tab)),
                        Some(Content::Launcher)
                    );
                if opened && launcher {
                    let item = s.chats.saved_chat(saved, window, cx);
                    let content = s.content(item, cx);
                    s.history.remove(&tab);
                    if let Some(p) = s.project_mut() {
                        p.content.insert(tab, content);
                        p.layout.activate(group, tab);
                    }
                    cx.notify();
                    return;
                }
                cx.foreground_executor().spawn(saved.discard()).detach();
                if launcher {
                    s.history_restore_failed(tab, target, cx);
                }
            })
            .ok();
        })
        .detach();
    }
    fn history_restore_failed(&mut self, tab: Id, target: HistoryTarget, cx: &mut Context<Self>) {
        if let Some(browser) = self.history.get(&tab) {
            browser.update(cx, |browser, cx| {
                browser.opening = None;
                cx.notify();
            });
        }
        self.creation_failure = Some(CreationFailure { tab, target });
        cx.notify();
    }
    /// `localAgentsSettings.chatHistoryDiscoveryEnabled`.
    pub(super) fn history_discovery(&self, cx: &App) -> bool {
        self.preferences
            .as_ref()
            .is_some_and(|p| p.read(cx).state.local_agents.chat_history_discovery)
    }
    /// Sessions already open in a chat tab (`excludedHistoryResourceIds`).
    pub(super) fn open_threads(&self, cx: &App) -> Vec<String> {
        self.project()
            .map(|p| {
                p.content
                    .values()
                    .filter_map(Content::item)
                    .filter(|item| item.kind() == ItemKind::Chat)
                    .filter_map(|item| item.snapshot(cx).resource_id)
                    .collect()
            })
            .unwrap_or_default()
    }
    /// The browsers follow the open chats and the discovery permission
    /// (granted elsewhere, in Settings, it starts discovery too).
    pub(super) fn sync_history(&mut self, cx: &mut Context<Self>) {
        if self.history.is_empty() {
            return;
        }
        let excluded = self.open_threads(cx);
        let enabled = self.history_discovery(cx);
        for browser in self.history.values() {
            browser.update(cx, |b, cx| {
                b.set_excluded(excluded.clone(), cx);
                if enabled && !b.enabled() {
                    b.enable(cx);
                }
            });
        }
    }
    /// The launcher tab's label and icon while History is open.
    pub(super) fn history_open(&self, tab: Id) -> bool {
        self.history.contains_key(&tab)
    }
    pub(super) fn tab_title(&self, tab: Id, content: &Content, cx: &App) -> String {
        if matches!(content, Content::Launcher) && self.history_open(tab) {
            return crate::localization::t("agent.history.title").into();
        }
        content.title(cx)
    }
    pub(super) fn render_history(&self, tab: Id) -> Option<AnyElement> {
        let browser = self.history.get(&tab)?.clone();
        Some(div().size_full().child(browser).into_any_element())
    }
}

impl Workbench {
    /// `prepare(item.id, historyTarget.payload)` for a hosted conversation:
    /// the launcher becomes its chat, unless another tab has it open.
    fn open_hosted_history_target(
        &mut self,
        group: Id,
        tab: Id,
        session_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let session = self.chats.hosted_session(&session_id);
        match self.hosted_chat(tab, session, window, cx) {
            Ok(content) => {
                self.history.remove(&tab);
                if let Some(p) = self.project_mut() {
                    p.content.insert(tab, content);
                    p.layout.activate(group, tab);
                }
            }
            Err(error) => {
                if let Some(browser) = self.history.get(&tab) {
                    browser.update(cx, |browser, _| browser.opening = None);
                }
                self.launch_errors.insert(group, error);
            }
        }
        cx.notify();
    }
}

#[cfg(feature = "dev-capture")]
impl Workbench {
    /// Dev captures: History in the active group, discovery allowed.
    pub(crate) fn capture_history(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.project().is_none_or(|p| p.loading) {
            return false;
        }
        let group = self.project().map_or(0, |p| p.layout.active_group);
        self.open_history(group, None, window, cx);
        for browser in self.history.values() {
            browser.update(cx, |b, cx| b.enable(cx));
        }
        true
    }

    /// Dev captures: History opens its first listed chat once listed.
    pub(crate) fn capture_history_open(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some((tab, browser)) = self.history.iter().next().map(|(t, b)| (*t, b.clone())) else {
            return false;
        };
        let Some(target) = browser.read(cx).capture_first_target() else {
            return false;
        };
        browser.update(cx, |b, _| b.opening = Some(target.id.clone()));
        self.history_event(tab, &HistoryBrowserEvent::Open(target), window, cx);
        true
    }

    /// Dev captures: a new chat on the detected Agent `runtime_id` in the
    /// active group; `false` until the Agents are scanned.
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
        self.launch(group, None, Some(installation), window, cx);
        true
    }

    /// Dev captures: every chat's session is prepared, or failed.
    pub(crate) fn capture_agent_settled(&self, cx: &App) -> bool {
        self.root
            .as_ref()
            .is_some_and(|root| self.chats.capture_settled(root, cx))
    }

    /// Dev captures: the first chat sends `text`; `false` until it can.
    pub(crate) fn capture_agent_prompt(&self, text: &str, cx: &App) -> bool {
        self.root
            .as_ref()
            .is_some_and(|root| self.chats.capture_prompt(root, text, cx))
    }

    /// Dev captures: the first chat's turn has settled.
    pub(crate) fn capture_agent_idle(&self, cx: &App) -> bool {
        self.root
            .as_ref()
            .is_some_and(|root| self.chats.capture_idle(root, cx))
    }
}

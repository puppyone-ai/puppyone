//! The launcher's History (`WorkbenchLauncherState.historyOpen` with the
//! chat contribution's `history.renderBrowser`): a launcher tab becomes
//! "Chat history" and hosts the cross-runtime browser until Back or Open.
use super::*;
use crate::features::desktop_agent::ui::agent_conversation_history::{
    HistoryBrowser, HistoryBrowserEvent, HistorySource,
};

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
        // `CloudAgentHistory` reads the hosted target's locators; it asks
        // no discovery permission.
        let (source, enabled) = match &self.cloud {
            Some(cloud) => (HistorySource::Hosted(cloud.hub.clone()), true),
            None => match self.project_history(&root, cx) {
                Ok(controller) => (HistorySource::Agent(controller), self.history_discovery(cx)),
                Err(error) => {
                    self.launch_errors.insert(group, error);
                    cx.notify();
                    return;
                }
            },
        };
        let browser = cx.new(|cx| HistoryBrowser::new(source, enabled, window, cx));
        self.install_history(tab, browser, window, cx);
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
                let group = self.project().and_then(|p| {
                    p.layout
                        .groups
                        .iter()
                        .find(|(_, g)| g.tabs.contains(&tab))
                        .map(|(group, _)| *group)
                });
                if let Some(group) = group {
                    self.creation_failure = None;
                    if self.cloud.is_some() {
                        self.open_hosted_history_target(group, tab, target.id.clone(), window, cx);
                    } else {
                        self.restore_history_target(group, tab, target.clone(), window, cx);
                    }
                }
            }
        }
        cx.notify();
    }
    /// `localAgentsSettings.chatHistoryDiscoveryEnabled`.
    pub(super) fn history_discovery(&self, cx: &App) -> bool {
        self.preferences
            .as_ref()
            .is_some_and(|p| p.read(cx).state.local_agents.chat_history_discovery)
    }
    /// Thread ids already open in a chat tab (`excludedHistoryResourceIds`).
    pub(super) fn open_threads(&self, cx: &App) -> Vec<String> {
        self.project()
            .map(|p| {
                p.content
                    .values()
                    .filter_map(|c| match c {
                        Content::Agent(view, _) => view
                            .read(cx)
                            .presentation()
                            .and_then(|p| p.session_id.clone()),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default()
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
    pub(super) fn render_history(&mut self, tab: Id, cx: &mut Context<Self>) -> Option<AnyElement> {
        let browser = self.history.get(&tab)?.clone();
        let excluded = self.open_threads(cx);
        let enabled = self.history_discovery(cx);
        browser.update(cx, |b, cx| {
            b.set_excluded(excluded);
            // Permission granted elsewhere (Settings) starts discovery too.
            if enabled && !b.enabled() {
                b.enable(cx);
            }
        });
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
        let session = self.cloud.as_ref().and_then(|cloud| {
            cloud
                .hub
                .history()
                .sessions
                .into_iter()
                .find(|s| s.id == session_id)
        });
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
}

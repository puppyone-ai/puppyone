//! The launcher's History (`WorkbenchLauncherState.historyOpen` with the
//! chat contribution's `history.renderBrowser`): a launcher tab becomes
//! "Chat history" and hosts the cross-runtime browser until Back or Open.
use super::*;
use crate::features::desktop_agent::ui::agent_conversation_history::{
    HistoryBrowser, HistoryBrowserEvent,
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
        let enabled = self.history_discovery(cx);
        let installations = self.installations.clone();
        let dark = self.dark;
        let browser =
            cx.new(|cx| HistoryBrowser::new(installations, root, enabled, dark, window, cx));
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
            HistoryBrowserEvent::Open { installation, id } => {
                let group = self.project().and_then(|p| {
                    p.layout
                        .groups
                        .iter()
                        .find(|(_, g)| g.tabs.contains(&tab))
                        .map(|(group, _)| *group)
                });
                if let Some(group) = group {
                    self.history.remove(&tab);
                    self.chat_mode = true;
                    self.launch(
                        group,
                        Some(tab),
                        Some(installation.clone()),
                        true,
                        window,
                        cx,
                    );
                    if let Some(Content::Chat(view)) =
                        self.project().and_then(|p| p.content.get(&tab))
                    {
                        let id = id.clone();
                        view.update(cx, |view, _| view.resume_when_ready(id));
                    }
                }
            }
        }
        cx.notify();
    }
    /// `localAgentsSettings.chatHistoryDiscoveryEnabled`.
    fn history_discovery(&self, cx: &App) -> bool {
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
                        Content::Chat(view) => view.read(cx).session.snapshot().thread.clone(),
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
        let dark = self.dark;
        let enabled = self.history_discovery(cx);
        browser.update(cx, |b, cx| {
            b.dark = dark;
            b.set_excluded(excluded);
            // Permission granted elsewhere (Settings) starts discovery too.
            if enabled && !b.enabled() {
                b.enable(cx);
            }
        });
        Some(div().size_full().child(browser).into_any_element())
    }
}

//! The launcher's History (`WorkbenchLauncherState.historyOpen` with the
//! chat contribution's `history.renderBrowser`): a launcher tab becomes
//! "Chat history" and hosts the cross-runtime browser until Back or Open.
use super::*;
use crate::features::desktop_agent::{HistoryBrowserEvent, HistoryTarget};

impl WorkbenchLauncher {
    /// `onOpenHistory`: the launcher tab itself, or a new launcher tab.
    pub(super) fn open_history(
        &mut self,
        group: Id,
        tab: Option<Id>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let Some(root) = workbench.read(cx).root().cloned() else {
            return;
        };
        let Some(tab) = tab.or_else(|| workbench.update(cx, |w, cx| w.new_launcher_tab(group, cx)))
        else {
            return;
        };
        if self.history.contains_key(&tab) {
            return;
        }
        let discovery = self.history_discovery(cx);
        // `CloudAgentHistory` in Cloud, the project's Agent History here.
        let browser = match self.hosted.history_browser(window, cx) {
            Some(browser) => Ok(browser),
            None => self.chats.history_browser(&root, discovery, window, cx),
        };
        match browser {
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
        let excluded = self.shown.open_chats.clone();
        browser.update(cx, |b, cx| b.set_excluded(excluded, cx));
        self.history.insert(tab, browser);
        cx.notify();
    }
    pub(super) fn history_event(
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
                let Some(workbench) = self.workbench.upgrade() else {
                    return;
                };
                if let Some(group) = workbench.read(cx).group_of(tab) {
                    workbench.update(cx, |w, cx| w.clear_creation_failure(cx));
                    if self.hosted.is_open() {
                        self.open_hosted_history_target(group, tab, target.id.clone(), window, cx);
                    } else {
                        self.restore_history_target(group, tab, target.clone(), window, cx);
                    }
                }
            }
        }
        cx.notify();
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
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let Some(root) = workbench.read(cx).root().cloned() else {
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
                let launcher = workbench.read(cx).is_launcher(&root, tab);
                if opened && launcher {
                    let item: Rc<dyn WorkbenchItem> =
                        Rc::new(s.chats.saved_chat(saved, window, cx));
                    s.history.remove(&tab);
                    workbench.update(cx, |w, cx| w.place(group, Some(tab), item, cx));
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
    /// The launcher tab stays; the workbench reports the failure, and its
    /// Retry opens the same conversation in the same tab again.
    pub(super) fn history_restore_failed(
        &mut self,
        tab: Id,
        target: HistoryTarget,
        cx: &mut Context<Self>,
    ) {
        if let Some(browser) = self.history.get(&tab) {
            browser.update(cx, |browser, cx| {
                browser.opening = None;
                cx.notify();
            });
        }
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let label = crate::localization::tf(
            "agent.panel.chat",
            &[("agent", crate::localization::t("agent.name").into())],
        );
        let launcher = cx.weak_entity();
        let retry: crate::features::workbench::CreationRetry = Rc::new(move |window, cx| {
            let target = target.clone();
            let _ = launcher.update(cx, |s, cx| s.retry_history_target(tab, target, window, cx));
        });
        workbench.update(cx, |w, cx| w.fail_creation(tab, label, retry, cx));
    }
    /// `retryCreation`: open the same conversation in the same tab again.
    fn retry_history_target(
        &mut self,
        tab: Id,
        target: HistoryTarget,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(group) = self
            .workbench
            .upgrade()
            .and_then(|w| w.read(cx).group_of(tab))
        else {
            return;
        };
        if let Some(browser) = self.history.get(&tab) {
            let id = target.id.clone();
            browser.update(cx, |browser, _| browser.opening = Some(id));
        }
        self.restore_history_target(group, tab, target, window, cx);
        cx.notify();
    }
    /// `localAgentsSettings.chatHistoryDiscoveryEnabled`.
    pub(super) fn history_discovery(&self, cx: &App) -> bool {
        self.preferences
            .as_ref()
            .is_some_and(|p| p.read(cx).state.local_agents.chat_history_discovery)
    }
    /// The browsers follow the open chats and the discovery permission
    /// (granted elsewhere, in Settings, it starts discovery too).
    pub(super) fn sync_history(&mut self, cx: &mut Context<Self>) {
        if self.history.is_empty() {
            return;
        }
        let excluded = self.shown.open_chats.clone();
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
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let Some(root) = workbench.read(cx).root().cloned() else {
            return;
        };
        let session = self.hosted.session(&session_id);
        match self.hosted_chat(&root, tab, session, window, cx) {
            Ok(item) => {
                self.history.remove(&tab);
                workbench.update(cx, |w, cx| w.place(group, Some(tab), item, cx));
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
    /// A History browser in place of the launcher of `tab`.
    pub(super) fn render_history(&self, tab: Id) -> Option<AnyElement> {
        let browser = self.history.get(&tab)?.clone();
        Some(div().size_full().child(browser).into_any_element())
    }
}

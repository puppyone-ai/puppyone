//! Dev-capture fixtures for the right-sidebar pixel lab (`src/lab.rs`) and
//! the capture scenarios' Agent steps. The scenario data mirrors
//! `tools/reference-workbench-entry.tsx` exactly: the same detected agents,
//! tab topology and Agent Chat content.
use super::*;
use crate::agent::connections::legacy_runtime_registry::Runtime;
use crate::features::desktop_agent::{AgentChatItem, HistoryBrowserEvent, lab_history_browser};
use crate::features::terminal::TerminalView;
use crate::features::workbench::LabTabs;

impl WorkbenchLauncher {
    pub(crate) fn lab_fixture(
        &mut self,
        scenario: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.installations = agents::lab_installations();
        self.observations = crate::platform::local_agent_setup::completed_observations(
            &self.installations.iter().map(|i| i.id).collect::<Vec<_>>(),
        );
        self.scanning = false;
        self.discovery_override = true;
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        if scenario == "launcher" || scenario.starts_with("history-") {
            let id = workbench.update(cx, |w, cx| w.lab_launcher(cx));
            if scenario.starts_with("history-") {
                self.lab_history(id, scenario == "history-list", window, cx);
            }
            cx.notify();
            return;
        }
        // tabs-narrow exercises the tab bar; its chat stays empty.
        let chat_scenario = if scenario == "tabs-narrow"
            || scenario.starts_with("drag-")
            || scenario == "split"
            || scenario == "close-dialog"
            || scenario == "terminal-activity"
            || scenario == "terminal"
        {
            "chat-empty"
        } else {
            scenario
        };
        let chat: Rc<dyn WorkbenchItem> =
            Rc::new(AgentChatItem::lab_fixture(chat_scenario, window, cx));
        let terminal: Rc<dyn WorkbenchItem> = match scenario {
            "terminal" => {
                let view = cx.new(TerminalView::lab_fixture);
                Rc::new(TerminalItem::of(
                    view,
                    crate::localization::t("terminal.title").into(),
                    None,
                ))
            }
            "terminal-activity" => {
                let view = cx.new(|cx| {
                    let mut view = TerminalView::new(std::env::temp_dir(), "shell", window, cx);
                    view.lab_busy_agent();
                    view
                });
                Rc::new(TerminalItem::of(
                    view,
                    "Claude Code".into(),
                    Some(Runtime::Claude),
                ))
            }
            _ => self.lab_terminal(window, cx),
        };
        let narrow = (scenario == "tabs-narrow").then(|| {
            let second: Rc<dyn WorkbenchItem> =
                Rc::new(AgentChatItem::lab_fixture("chat-empty", window, cx));
            (second, self.lab_terminal(window, cx))
        });
        let tabs = LabTabs {
            chat,
            terminal,
            narrow,
        };
        workbench.update(cx, |w, cx| w.lab_tabs(scenario, tabs, cx));
        cx.notify();
    }
    /// `FixtureHistory` in the reference entry: four runtimes, five sessions;
    /// Codex has another page, so "Load more" shows.
    fn lab_history(
        &mut self,
        tab: Id,
        populated: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let enabled = populated || self.history_discovery(cx);
        let browser = lab_history_browser(populated, enabled, window, cx);
        self.install_history(tab, browser, window, cx);
    }
    /// An inactive shell tab; its PTY lives in a scratch directory.
    fn lab_terminal(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Rc<dyn WorkbenchItem> {
        let view = cx.new(|cx| TerminalView::new(std::env::temp_dir(), "shell", window, cx));
        Rc::new(TerminalItem::of(
            view,
            crate::localization::t("terminal.title").into(),
            None,
        ))
    }
    /// The Agent panel over a recorded conversation (`agent-panel*`).
    pub(crate) fn visual_fixture_panel(
        &mut self,
        populated: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(workbench) = self.workbench.upgrade() else {
            return;
        };
        let item: Rc<dyn WorkbenchItem> =
            Rc::new(AgentChatItem::visual_fixture(populated, window, cx));
        workbench.update(cx, |w, cx| w.lab_single(item, cx));
    }
    /// Dev captures: History in the active group, discovery allowed.
    pub(crate) fn capture_history(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let Some(workbench) = self.workbench.upgrade() else {
            return false;
        };
        if workbench.read(cx).loading() {
            return false;
        }
        let group = workbench.read(cx).active_group();
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
        let Some(workbench) = self.workbench.upgrade() else {
            return false;
        };
        if self.scanning || workbench.read(cx).loading() {
            return false;
        }
        let Some(installation) = self
            .installations
            .iter()
            .find(|i| agent_chat_runtime_id(i) == runtime_id)
            .cloned()
        else {
            po_platform::diagnosticln!("No detected Agent for {runtime_id:?}");
            return true;
        };
        let group = workbench.read(cx).active_group();
        self.chat_mode = true;
        self.launch(group, None, Some(installation), window, cx);
        true
    }
    fn shown_root(&self) -> Option<&PathBuf> {
        self.shown.root.as_ref()
    }
    /// Dev captures: every chat's session is prepared, or failed.
    pub(crate) fn capture_agent_settled(&self, cx: &App) -> bool {
        self.shown_root()
            .is_some_and(|root| self.chats.capture_settled(root, cx))
    }
    /// Dev captures: the first chat sends `text`; `false` until it can.
    pub(crate) fn capture_agent_prompt(&self, text: &str, cx: &App) -> bool {
        self.shown_root()
            .is_some_and(|root| self.chats.capture_prompt(root, text, cx))
    }
    /// Dev captures: the first chat's turn has settled.
    pub(crate) fn capture_agent_idle(&self, cx: &App) -> bool {
        self.shown_root()
            .is_some_and(|root| self.chats.capture_idle(root, cx))
    }
}

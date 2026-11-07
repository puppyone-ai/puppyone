//! Dev-capture fixtures for the right-sidebar pixel lab (`src/lab.rs`). The
//! scenario data mirrors `tools/reference-workbench-entry.tsx` exactly: the
//! same detected agents, tab topology and Agent Chat content.
use super::*;
use crate::agent::connections::legacy_runtime_registry::Runtime;
use crate::features::desktop_agent::{AgentChatItem, lab_history_browser};
use crate::features::terminal::TerminalView;

impl Workbench {
    pub(crate) fn lab_fixture(
        &mut self,
        scenario: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.installations = agents::lab_installations();
        self.scanning = false;
        let root = PathBuf::from("/reference/project");
        let mut project = Project::default();
        let installations = self.installations.clone();
        let installation = |id: &str| {
            installations
                .iter()
                .find(|i| i.id == id)
                .cloned()
                .expect("lab installation")
        };
        if scenario == "launcher" || scenario.starts_with("history-") {
            let id = project.layout.add(0);
            project.content.insert(id, Content::Launcher);
            if scenario.starts_with("history-") {
                project.loading = false;
                self.projects.insert(root.clone(), project);
                self.root = Some(root);
                self.lab_history(id, scenario == "history-list", window, cx);
                cx.notify();
                return;
            }
        } else {
            let chat = project.layout.add(0);
            let codex = installation("codex");
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
            let _ = codex;
            let item = AgentChatItem::lab_fixture(chat_scenario, window, cx);
            let content = self.content(item, cx);
            project.content.insert(chat, content);
            let terminal = project.layout.add(0);
            project
                .content
                .insert(terminal, self.lab_terminal(window, cx));
            let launcher = project.layout.add(0);
            project.content.insert(launcher, Content::Launcher);
            if scenario == "tabs-narrow" {
                let claude = project.layout.add(0);
                let item = AgentChatItem::lab_fixture("chat-empty", window, cx);
                let content = self.content(item, cx);
                project.content.insert(claude, content);
                let shell = project.layout.add(0);
                project.content.insert(shell, self.lab_terminal(window, cx));
            }
            project.layout.activate(0, chat);
            if scenario == "terminal" {
                let view = cx.new(TerminalView::lab_fixture);
                let item =
                    TerminalItem::of(view, crate::localization::t("terminal.title").into(), None);
                let content = self.content(item, cx);
                project.content.insert(terminal, content);
                project.layout.activate(0, terminal);
            }
            // Native-only interaction states (no product reference): a tab
            // moving within the bar, split previews and a resolved split.
            match scenario {
                "drag-insert" => {
                    self.dragging = Some(terminal);
                    self.drop_intent = Some(DropIntent::Insert {
                        group: 0,
                        index: 0,
                        allowed: true,
                    });
                }
                "drag-split" | "drag-split-refused" => {
                    self.dragging = Some(terminal);
                    self.drop_intent = Some(DropIntent::Split {
                        group: 0,
                        edge: Edge::Bottom,
                        allowed: scenario == "drag-split",
                    });
                }
                "close-dialog" => self.request_close_confirmation(chat, cx),
                "terminal-activity" => {
                    let view = cx.new(|cx| {
                        let mut view =
                            TerminalView::new(std::env::temp_dir(), None, "shell", window, cx);
                        view.lab_busy_agent();
                        view
                    });
                    let item = TerminalItem::of(view, "Claude Code".into(), Some(Runtime::Claude));
                    let content = self.content(item, cx);
                    project.content.insert(terminal, content);
                }
                "split" => {
                    project
                        .layout
                        .split(0, Axis::Vertical, true, Some(terminal));
                }
                _ => {}
            }
        }
        project.loading = false;
        self.projects.insert(root.clone(), project);
        self.root = Some(root);
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
    fn lab_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Content {
        let view = cx.new(|cx| TerminalView::new(std::env::temp_dir(), None, "shell", window, cx));
        let item = TerminalItem::of(view, crate::localization::t("terminal.title").into(), None);
        self.content(item, cx)
    }
}

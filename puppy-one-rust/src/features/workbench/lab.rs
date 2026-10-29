//! Dev-capture fixtures for the right-sidebar pixel lab (`src/lab.rs`). The
//! scenario data mirrors `tools/reference-workbench-entry.tsx` exactly: the
//! same detected agents, tab topology and Agent Chat content.
use super::*;

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
                self.open_history(0, Some(id), window, cx);
                if scenario == "history-list" {
                    self.lab_history(id, cx);
                }
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
            let view = cx.new(|cx| AgentChat::lab_fixture(chat_scenario, codex, window, cx));
            cx.observe(&view, |_, _, cx| cx.notify()).detach();
            project.content.insert(chat, Content::Chat(view));
            let terminal = project.layout.add(0);
            project
                .content
                .insert(terminal, self.lab_terminal(window, cx));
            let launcher = project.layout.add(0);
            project.content.insert(launcher, Content::Launcher);
            if scenario == "tabs-narrow" {
                let claude = project.layout.add(0);
                let view = cx.new(|cx| {
                    AgentChat::lab_fixture("chat-empty", installation("claude"), window, cx)
                });
                project.content.insert(claude, Content::Chat(view));
                let shell = project.layout.add(0);
                project.content.insert(shell, self.lab_terminal(window, cx));
            }
            project.layout.activate(0, chat);
            if scenario == "terminal" {
                let view = cx.new(TerminalView::lab_fixture);
                cx.observe(&view, |_, _, cx| cx.notify()).detach();
                project.content.insert(
                    terminal,
                    Content::Terminal(view, crate::localization::t("terminal.title").into(), None),
                );
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
                        let mut view = TerminalView::new(std::env::temp_dir(), None, window, cx);
                        view.lab_busy_agent();
                        view
                    });
                    project.content.insert(
                        terminal,
                        Content::Terminal(
                            view,
                            "Claude Code".into(),
                            Some(crate::agent::runtime::agent_runtime_registry::Runtime::Claude),
                        ),
                    );
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
    fn lab_history(&mut self, tab: Id, cx: &mut Context<Self>) {
        use crate::agent::domain::agent_session_model::HistoryEntry;
        use crate::agent::runtime::agent_runtime_registry::Runtime;
        use crate::features::desktop_agent::application::conversation_history::{
            ConversationHistory, SourceStatus,
        };
        const NOW: i64 = 1_800_000_000_000;
        let entry = |index: usize, title: &str, age: i64| HistoryEntry {
            id: format!("history-{index}"),
            title: title.into(),
            updated_at: Some(NOW - age),
        };
        let installation = |runtime: Runtime, label: &str| Installation {
            runtime,
            id: "lab",
            label: label.into(),
            executable: PathBuf::new(),
            chat: true,
        };
        let history = ConversationHistory::fixture(vec![
            (
                installation(Runtime::Codex, "Codex"),
                SourceStatus::Partial,
                vec![
                    entry(0, "Make the terminal colours follow the theme", 5 * 60_000),
                    entry(2, "Port the approval dock to GPUI", 26 * 3_600_000),
                ],
            ),
            (
                installation(Runtime::Claude, "Claude Code"),
                SourceStatus::Complete,
                vec![entry(
                    1,
                    "Refactor the workbench split constraints",
                    2 * 3_600_000,
                )],
            ),
            (
                installation(Runtime::Pi, "Pi"),
                SourceStatus::Complete,
                vec![entry(
                    3,
                    "Investigate the flaky terminal resize test after the PTY host moved",
                    3 * 86_400_000,
                )],
            ),
            (
                installation(Runtime::OpenCode, "OpenCode"),
                SourceStatus::Complete,
                vec![entry(4, "Audit markdown table rendering", 9 * 86_400_000)],
            ),
        ]);
        if let Some(browser) = self.history.get(&tab) {
            browser.update(cx, |b, _| b.lab_fixture(history));
        }
    }
    /// An inactive shell tab; its PTY lives in a scratch directory.
    fn lab_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Content {
        let view = cx.new(|cx| TerminalView::new(std::env::temp_dir(), None, window, cx));
        Content::Terminal(view, crate::localization::t("terminal.title").into(), None)
    }
}

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
                        let mut view =
                            TerminalView::new(std::env::temp_dir(), None, "shell", window, cx);
                        view.lab_busy_agent();
                        view
                    });
                    project.content.insert(
                        terminal,
                        Content::Terminal(
                            view,
                            "Claude Code".into(),
                            Some(crate::agent::runtime::legacy_runtime_registry::Runtime::Claude),
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
    fn lab_history(
        &mut self,
        tab: Id,
        populated: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryController;
        use crate::features::desktop_agent::infrastructure::host::window_runtime::WindowUiRuntime;
        use crate::features::desktop_agent::ui::agent_conversation_history::HistoryBrowser;
        let client: std::rc::Rc<
            dyn crate::features::desktop_agent::application::agent_client_port::AgentClientPort,
        > = std::rc::Rc::new(LabHistoryClient { populated });
        let controller = ConversationHistoryController::new(
            "/reference/project",
            std::rc::Rc::new(move || Some(client.clone())),
            WindowUiRuntime::create(cx),
        );
        let enabled = populated || self.history_discovery(cx);
        let browser = cx.new(|cx| HistoryBrowser::new(controller, enabled, window, cx));
        self.install_history(tab, browser, window, cx);
    }
    /// An inactive shell tab; its PTY lives in a scratch directory.
    fn lab_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Content {
        let view = cx.new(|cx| TerminalView::new(std::env::temp_dir(), None, "shell", window, cx));
        Content::Terminal(view, crate::localization::t("terminal.title").into(), None)
    }
}

/// The reference entry's History: four runtimes and five saved chats.
struct LabHistoryClient {
    populated: bool,
}

impl crate::features::desktop_agent::application::agent_client_port::AgentClientPort
    for LabHistoryClient
{
    fn implements(&self, method: &str) -> bool {
        matches!(method, "discoverAgentRuntimes" | "listAgentSessions")
    }

    fn call(
        &self,
        method: &str,
        request: serde_json::Value,
    ) -> crate::features::desktop_agent::application::agent_client_port::ClientFuture {
        use serde_json::json;
        const NOW: i64 = 1_800_000_000_000;
        let runtimes = [
            ("codex", "Codex"),
            ("claude", "Claude Code"),
            ("pi", "Pi"),
            ("opencode-native", "OpenCode"),
        ];
        let runtime = |id: &str| {
            let (id, label) = runtimes
                .iter()
                .find(|(r, _)| *r == id)
                .copied()
                .unwrap_or((id, id));
            let icon = if id == "opencode-native" {
                "opencode"
            } else {
                id
            };
            json!({ "id": id, "displayName": label, "iconKey": icon, "ownership": { "session": "runtime" } })
        };
        let session = |id: usize, runtime_id: &str, title: &str, age: i64| {
            json!({
                "id": format!("history-{id}"), "title": title, "runtimeId": runtime_id,
                "runtime": runtime(runtime_id),
                "updatedAt": crate::agent::contract::js::iso_string(NOW - age),
            })
        };
        let sessions: Vec<serde_json::Value> = if self.populated {
            vec![
                session(
                    0,
                    "codex",
                    "Make the terminal colours follow the theme",
                    5 * 60_000,
                ),
                session(
                    1,
                    "claude",
                    "Refactor the workbench split constraints",
                    2 * 3_600_000,
                ),
                session(2, "codex", "Port the approval dock to GPUI", 26 * 3_600_000),
                session(
                    3,
                    "pi",
                    "Investigate the flaky terminal resize test after the PTY host moved",
                    3 * 86_400_000,
                ),
                session(
                    4,
                    "opencode-native",
                    "Audit markdown table rendering",
                    9 * 86_400_000,
                ),
            ]
        } else {
            vec![]
        };
        let result = match method {
            "discoverAgentRuntimes" => json!({
                "runtimes": runtimes.iter().map(|(id, _)| json!({
                    "descriptor": runtime(id),
                    "readiness": { "runtimeId": id, "status": "ready", "code": "READY", "selectable": true },
                })).collect::<Vec<_>>(),
            }),
            _ if request["discoverNative"] == true => {
                let runtime_id = request["runtimeId"].as_str().unwrap_or_default();
                let more = runtime_id == "codex";
                json!({
                    "sessions": sessions.iter().filter(|s| s["runtimeId"] == runtime_id).collect::<Vec<_>>(),
                    "discovery": {
                        "runtimeId": runtime_id,
                        "status": if more { "partial" } else { "complete" },
                        "coverage": if more { "partial" } else { "complete" },
                        "nextCursor": more.then_some("page-2"),
                        "scanId": more.then_some("scan-1"),
                    },
                })
            }
            _ => json!({
                "sessions": sessions,
                "catalogCoverage": { "truncated": false },
                "catalogNextCursor": null,
            }),
        };
        Box::pin(async move { Ok(result) })
    }
}

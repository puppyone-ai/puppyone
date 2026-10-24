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
        if scenario == "launcher" {
            let id = project.layout.add(0);
            project.content.insert(id, Content::Launcher);
        } else {
            let chat = project.layout.add(0);
            let codex = installation("codex");
            // tabs-narrow exercises the tab bar; its chat stays empty.
            let chat_scenario = if scenario == "tabs-narrow"
                || scenario.starts_with("drag-")
                || scenario == "split"
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
    /// An inactive shell tab; its PTY lives in a scratch directory.
    fn lab_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Content {
        let view = cx.new(|cx| TerminalView::new(std::env::temp_dir(), None, window, cx));
        Content::Terminal(view, crate::localization::t("terminal.title").into(), None)
    }
}

//! Dev-capture topology for the right-sidebar pixel lab (`src/lab.rs`). The
//! shell's launcher supplies the items of `tools/reference-workbench-entry.tsx`;
//! the tab layout and the drag, split and close-dialog states are the
//! workbench's.
use super::*;

/// A lab scenario's items, in tab order: the chat, the terminal (the
/// scenario's own), then the launcher; `tabs-narrow` adds a second chat and a
/// shell.
pub struct LabTabs {
    pub chat: Rc<dyn WorkbenchItem>,
    pub terminal: Rc<dyn WorkbenchItem>,
    pub narrow: Option<(Rc<dyn WorkbenchItem>, Rc<dyn WorkbenchItem>)>,
}

impl Workbench {
    /// A project at the lab root showing one launcher tab; its id.
    pub(crate) fn lab_launcher(&mut self, cx: &mut Context<Self>) -> Id {
        let root = PathBuf::from("/reference/project");
        let mut project = Project::default();
        let id = project.layout.add(0);
        project.content.insert(id, Content::Launcher);
        self.projects.insert(root.clone(), project);
        self.root = Some(root);
        cx.notify();
        id
    }
    /// One tab over `item` (the Agent panel's visual references).
    pub(crate) fn lab_single(&mut self, item: Rc<dyn WorkbenchItem>, cx: &mut Context<Self>) {
        let root = PathBuf::from("/visual-reference-only");
        let mut project = Project::default();
        let id = project.layout.add(0);
        let content = self.content(item, cx);
        project.content.insert(id, content);
        self.projects.insert(root.clone(), project);
        self.root = Some(root);
        cx.notify();
    }
    /// The lab's tabs for `scenario`, then its interaction state.
    pub(crate) fn lab_tabs(&mut self, scenario: &str, tabs: LabTabs, cx: &mut Context<Self>) {
        let root = PathBuf::from("/reference/project");
        let mut project = Project::default();
        let chat = project.layout.add(0);
        let content = self.content(tabs.chat, cx);
        project.content.insert(chat, content);
        let terminal = project.layout.add(0);
        let content = self.content(tabs.terminal, cx);
        project.content.insert(terminal, content);
        let launcher = project.layout.add(0);
        project.content.insert(launcher, Content::Launcher);
        if let Some((second, shell)) = tabs.narrow {
            let id = project.layout.add(0);
            let content = self.content(second, cx);
            project.content.insert(id, content);
            let id = project.layout.add(0);
            let content = self.content(shell, cx);
            project.content.insert(id, content);
        }
        project.layout.activate(0, chat);
        if scenario == "terminal" {
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
            "split" => {
                project
                    .layout
                    .split(0, Axis::Vertical, true, Some(terminal));
            }
            _ => {}
        }
        project.loading = false;
        self.projects.insert(root.clone(), project);
        self.root = Some(root);
        if scenario == "close-dialog" {
            self.request_close_confirmation(chat, cx);
        }
        cx.notify();
    }
}

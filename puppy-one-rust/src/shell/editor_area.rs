//! The editor area's view state (`EditorWorkbench`'s panes, as the window
//! paints them): one editor host per open document slot, the one in front,
//! a split being resized, a drop being previewed, each tab's focus, and the
//! save notices. The documents themselves are the runtime's
//! (`Shell::files`, the workbench runtime store).
use super::editor_workbench::{EditorDrop, EditorResize};
use crate::editor::host::DocumentEditor;
use gpui::{Entity, FocusHandle, Task};
use std::collections::BTreeMap;

pub(super) struct EditorArea {
    /// The front document's host (the active slot's, once it has one).
    pub front: Entity<DocumentEditor>,
    /// Every slot's host, by slot id.
    pub hosts: BTreeMap<u64, Entity<DocumentEditor>>,
    /// A split being resized.
    pub resize: Option<EditorResize>,
    /// A drop being previewed over a pane.
    pub drop: Option<EditorDrop>,
    /// Each tab's own focus handle, by slot id.
    pub tab_focus: BTreeMap<u64, FocusHandle>,
    /// The save failure whose notice the person dismissed
    /// (`useDismissibleNotice`).
    pub dismissed_save_error: Option<String>,
    /// Re-renders once a transient "Saved" status lapses.
    pub saved_refresh: Option<Task<()>>,
}

impl EditorArea {
    pub fn new(front: Entity<DocumentEditor>) -> Self {
        Self {
            front,
            hosts: Default::default(),
            resize: None,
            drop: None,
            tab_focus: Default::default(),
            dismissed_save_error: None,
            saved_refresh: None,
        }
    }
}

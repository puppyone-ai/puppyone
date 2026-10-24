//! Explorer keyboard: typed actions bound in the `Explorer` key context
//! (the focused tree), so they never shadow the editor's bindings.
use super::*;

pub(super) const CONTEXT: &str = "Explorer";

actions!(
    explorer,
    [
        SelectNext,
        SelectPrevious,
        SelectFirst,
        SelectLast,
        /// Expand a folder, or step into the next row.
        ExpandOrNext,
        /// Collapse a folder, or step out to the parent.
        CollapseOrParent,
        OpenSelected,
        CopyItems,
        CutItems,
        PasteItems,
        DuplicateItems,
        DeleteItems,
    ]
);

pub fn bind_keys(cx: &mut App) {
    let context = Some(CONTEXT);
    cx.bind_keys([
        KeyBinding::new("down", SelectNext, context),
        KeyBinding::new("up", SelectPrevious, context),
        KeyBinding::new("home", SelectFirst, context),
        KeyBinding::new("end", SelectLast, context),
        KeyBinding::new("right", ExpandOrNext, context),
        KeyBinding::new("left", CollapseOrParent, context),
        KeyBinding::new("enter", OpenSelected, context),
        KeyBinding::new("secondary-c", CopyItems, context),
        KeyBinding::new("secondary-x", CutItems, context),
        KeyBinding::new("secondary-v", PasteItems, context),
        KeyBinding::new("secondary-d", DuplicateItems, context),
        KeyBinding::new("secondary-backspace", DeleteItems, context),
        KeyBinding::new("secondary-delete", DeleteItems, context),
    ]);
}

impl Shell {
    pub(super) fn on_explorer_actions(
        &self,
        tree: Stateful<Div>,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        tree.on_action(cx.listener(|s, _: &SelectNext, w, cx| {
            let len = s.tree.rows.len();
            let next = s
                .selected_index()
                .map_or(0, |i| (i + 1).min(len.saturating_sub(1)));
            s.select_index(next, w, cx)
        }))
        .on_action(cx.listener(|s, _: &SelectPrevious, w, cx| {
            let previous = s.selected_index().map_or(0, |i| i.saturating_sub(1));
            s.select_index(previous, w, cx)
        }))
        .on_action(cx.listener(|s, _: &SelectFirst, w, cx| s.select_index(0, w, cx)))
        .on_action(cx.listener(|s, _: &SelectLast, w, cx| {
            let last = s.tree.rows.len().saturating_sub(1);
            s.select_index(last, w, cx)
        }))
        .on_action(cx.listener(|s, _: &ExpandOrNext, w, cx| {
            let Some(i) = s.selected_index() else {
                return;
            };
            let row = s.tree.rows[i].clone();
            if row.folder && !row.expanded {
                if s.tree.set_expanded(&row.path, true) {
                    s.files.load_children(row.path, &s.wake);
                }
                cx.notify();
            } else if i + 1 < s.tree.rows.len() {
                s.select_index(i + 1, w, cx)
            }
        }))
        .on_action(cx.listener(|s, _: &CollapseOrParent, w, cx| {
            let Some(i) = s.selected_index() else {
                return;
            };
            let row = s.tree.rows[i].clone();
            if row.folder && row.expanded {
                s.tree.set_expanded(&row.path, false);
                cx.notify();
            } else if let Some(parent) = s.tree.index_of(&parent_of(&row.path)) {
                s.select_index(parent, w, cx)
            }
        }))
        .on_action(cx.listener(|s, _: &OpenSelected, w, cx| {
            if let Some(i) = s.selected_index() {
                s.open_row(i, w, cx)
            }
        }))
        .on_action(cx.listener(|s, _: &CopyItems, _, _| {
            s.explorer.clipboard = Some(FileClipboard::Copy(s.tree.selected_roots()));
        }))
        .on_action(cx.listener(|s, _: &CutItems, _, cx| {
            s.explorer.clipboard = Some(FileClipboard::Cut(s.tree.selected_roots()));
            cx.notify();
        }))
        .on_action(cx.listener(|s, _: &PasteItems, w, cx| {
            // Into the selected folder, or next to the selected file.
            let target = s
                .selected_index()
                .map(|i| {
                    let row = &s.tree.rows[i];
                    if row.folder {
                        row.path.clone()
                    } else {
                        parent_of(&row.path)
                    }
                })
                .unwrap_or_default();
            s.paste_into(target, w, cx)
        }))
        .on_action(
            cx.listener(|s, _: &DuplicateItems, w, cx| s.duplicate(s.tree.selected_roots(), w, cx)),
        )
        .on_action(
            cx.listener(|s, _: &DeleteItems, w, cx| {
                s.confirm_delete(s.tree.selected_roots(), w, cx)
            }),
        )
    }
    fn selected_index(&self) -> Option<usize> {
        self.tree.index_of(&self.tree.selected)
    }
    /// Selects a row, keeps it in view and opens it when it is a file.
    fn select_index(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(row) = self.tree.rows.get(index).cloned() else {
            return;
        };
        self.tree.select(&row.path, false, false);
        self.explorer
            .scroll
            .scroll_to_item(index, ScrollStrategy::Center);
        if !row.folder {
            self.open_row(index, window, cx);
        }
        cx.notify();
    }
}

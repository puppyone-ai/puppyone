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

impl Explorer {
    pub(super) fn on_explorer_actions(
        &self,
        tree: Stateful<Div>,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        tree.on_action(cx.listener(|s, _: &SelectNext, _, cx| {
            let rows = s.session.read(cx).tree().rows.clone();
            // Status rows are not entries; the selection steps over them.
            let mut next = s.selected_index(cx).map_or(0, |i| i + 1);
            while rows.get(next).is_some_and(|r| r.status) {
                next += 1;
            }
            if next >= rows.len() {
                return;
            }
            s.select_index(next, cx)
        }))
        .on_action(cx.listener(|s, _: &SelectPrevious, _, cx| {
            let Some(mut previous) = s.selected_index(cx).map(|i| i.saturating_sub(1)) else {
                return s.select_index(0, cx);
            };
            let tree = s.session.read(cx).tree();
            while previous > 0 && tree.rows.get(previous).is_some_and(|r| r.status) {
                previous -= 1;
            }
            s.select_index(previous, cx)
        }))
        .on_action(cx.listener(|s, _: &SelectFirst, _, cx| s.select_index(0, cx)))
        .on_action(cx.listener(|s, _: &SelectLast, _, cx| {
            let last = s.session.read(cx).tree().rows.len().saturating_sub(1);
            s.select_index(last, cx)
        }))
        .on_action(cx.listener(|s, _: &ExpandOrNext, _, cx| {
            let Some(i) = s.selected_index(cx) else {
                return;
            };
            let tree = s.session.read(cx).tree();
            let (row, len) = (tree.rows[i].clone(), tree.rows.len());
            if row.folder && !row.expanded {
                s.session
                    .update(cx, |session, cx| session.set_expanded(&row.path, true, cx));
            } else if i + 1 < len {
                s.select_index(i + 1, cx)
            }
        }))
        .on_action(cx.listener(|s, _: &CollapseOrParent, _, cx| {
            let Some(i) = s.selected_index(cx) else {
                return;
            };
            let tree = s.session.read(cx).tree();
            let row = tree.rows[i].clone();
            if row.folder && row.expanded {
                s.session
                    .update(cx, |session, cx| session.set_expanded(&row.path, false, cx));
            } else if let Some(parent) = tree.index_of(&parent_of(&row.path)) {
                s.select_index(parent, cx)
            }
        }))
        .on_action(cx.listener(|s, _: &OpenSelected, _, cx| {
            if let Some(i) = s.selected_index(cx) {
                s.open_row(i, cx)
            }
        }))
        .on_action(cx.listener(|s, _: &CopyItems, _, cx| {
            s.session.update(cx, |session, cx| {
                let paths = session.tree().selected_roots();
                session.set_clipboard(FileClipboard::Copy(paths), cx)
            })
        }))
        .on_action(cx.listener(|s, _: &CutItems, _, cx| {
            s.session.update(cx, |session, cx| {
                let paths = session.tree().selected_roots();
                session.set_clipboard(FileClipboard::Cut(paths), cx)
            })
        }))
        .on_action(cx.listener(|s, _: &PasteItems, _, cx| {
            // Into the selected folder, or next to the selected file.
            let selected = s.selected_index(cx);
            s.session.update(cx, |session, cx| {
                let target = selected
                    .map(|i| {
                        let row = &session.tree().rows[i];
                        if row.folder {
                            row.path.clone()
                        } else {
                            parent_of(&row.path)
                        }
                    })
                    .unwrap_or_default();
                session.paste_into(target, cx)
            })
        }))
        .on_action(cx.listener(|s, _: &DuplicateItems, _, cx| {
            s.session.update(cx, |session, cx| {
                let paths = session.tree().selected_roots();
                session.duplicate(paths, cx)
            })
        }))
        .on_action(cx.listener(|s, _: &DeleteItems, w, cx| {
            let paths = s.session.read(cx).tree().selected_roots();
            s.confirm_delete(paths, w, cx)
        }))
    }
    fn selected_index(&self, cx: &App) -> Option<usize> {
        let tree = self.session.read(cx).tree();
        tree.index_of(&tree.selected)
    }
    /// Selects a row, keeps it in view and opens it when it is a file.
    fn select_index(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(row) = self
            .session
            .read(cx)
            .tree()
            .rows
            .get(index)
            .cloned()
            .filter(|r| !r.status)
        else {
            return;
        };
        self.session.update(cx, |session, cx| {
            session.select(&row.path, false, false, cx);
            session
                .scroll()
                .scroll_to_item(index, ScrollStrategy::Center);
        });
        if !row.folder {
            self.open_row(index, cx);
        }
    }
}

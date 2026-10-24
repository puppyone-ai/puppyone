//! IME grouping and committed input edits, independent of native event delivery.
use super::session::Session;
use crate::native_editor::core::{selection::Selection, transaction::InputEdit};
impl Session {
    pub fn edit(&mut self, edit: InputEdit) {
        if self.frozen && !(self.pending_ime.is_some() && !edit.composing) {
            return;
        }
        let before = self.state.clone();
        self.state.selection = edit.selection;
        if edit.composing && self.pending_ime.is_none() {
            self.pending_ime = Some(before.clone());
        }
        if let Some((range, inserted)) = edit.replacement {
            let caret = self
                .state
                .document
                .replace_visible(range, inserted, edit.soft);
            if !edit.composing {
                self.state.selection = Selection {
                    anchor: caret,
                    cursor: caret,
                };
            }
        }
        if !edit.composing {
            if !self.state.source_mode && self.state.selection.anchor == self.state.selection.cursor
            {
                let caret = self.state.document.shortcut(self.state.selection.cursor);
                self.state.selection = Selection {
                    anchor: caret,
                    cursor: caret,
                };
            }
            let original = self.pending_ime.take().unwrap_or(before);
            self.changed(original);
        }
    }
}

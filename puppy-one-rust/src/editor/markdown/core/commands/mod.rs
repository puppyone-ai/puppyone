//! Markdown editing commands (product core/commands): every command produces
//! a source transaction; the view applies it. `intercept` is the
//! `markdownEditingKeymap` entry point for the view's edit intents.
mod block;
mod inline;
mod keymap;
#[cfg(test)]
mod tests;

pub use keymap::{intercept, Cx};

use crate::editor::text::{change::{Change, ChangeSet}, selection::Selection, state::{EditorState, Transaction, UserEvent}};
use std::ops::Range;

/// Source line indices touched by the selection (`getSelectedLineNumbers`).
pub(super) fn selected_lines(state: &EditorState) -> Range<usize> {
    let s = state.selection;
    state.doc.line_index(s.from())..state.doc.line_index(s.to()) + 1
}

/// A transaction from non-overlapping changes in original coordinates.
pub(super) fn edit(changes: Vec<Change>, selection: Option<Selection>, event: UserEvent) -> Option<Transaction> {
    let changes = ChangeSet::new(changes);
    if changes.is_empty() && selection.is_none() {
        return None;
    }
    Some(Transaction::edit(changes, selection, event))
}

pub(super) fn change(range: Range<usize>, insert: impl Into<String>) -> Change {
    Change { range, insert: insert.into() }
}

/// A handled key that changes nothing (the format owns it).
pub(super) fn handled(state: &EditorState) -> Option<Transaction> {
    let mut tr = Transaction::select(state.selection);
    tr.scroll_into_view = false;
    Some(tr)
}

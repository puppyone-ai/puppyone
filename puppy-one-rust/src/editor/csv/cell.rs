//! The active cell's editor (`CsvCellEditor`'s `<input>`): a native
//! `EditorView` placed and styled exactly like the cell's text. Its edits go to
//! the table model; Tab and history requests are handed back to the table.
use crate::editor::{
    text::state::{EditorState, Transaction},
    view::{
        EditorView,
        decoration::{Block, Decorations, Surface},
        extension::{DecorateInput, EditIntent, EditorExtension},
        style::LineStyle,
    },
};
use gpui::{Entity, Subscription};
use std::{cell::Cell, rc::Rc};

/// What a cell editor hands back to the table.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CellRequest {
    /// Tab / Shift-Tab (`handleCellKeyDown`).
    Next { backwards: bool },
    /// ⌘Z / ⌘⇧Z: the table model owns history.
    History { redo: bool },
}

pub type Outbox = Rc<Cell<Option<CellRequest>>>;

/// One-line `<input>` behaviour: Enter and Escape do nothing, Tab leaves the
/// cell, undo / redo belong to the table.
pub struct CellText {
    pub line: Rc<LineStyle>,
    pub surface: Surface,
    pub outbox: Outbox,
}

impl EditorExtension for CellText {
    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        let blocks = (0..input.state.doc.line_count())
            .map(|line| Block::Line {
                line,
                style: self.line.clone(),
            })
            .collect();
        Decorations {
            blocks,
            surface: self.surface.clone(),
            ..Default::default()
        }
    }
    fn intercept(&mut self, intent: EditIntent, state: &EditorState) -> Option<Transaction> {
        match intent {
            EditIntent::Enter | EditIntent::SoftEnter | EditIntent::Escape => {}
            EditIntent::Tab => self
                .outbox
                .set(Some(CellRequest::Next { backwards: false })),
            EditIntent::BackTab => self.outbox.set(Some(CellRequest::Next { backwards: true })),
            _ => return None,
        }
        let mut tr = Transaction::select(state.selection);
        tr.scroll_into_view = false;
        Some(tr)
    }
    fn owns_history(&self) -> bool {
        true
    }
    fn history(&mut self, redo: bool) {
        self.outbox.set(Some(CellRequest::History { redo }));
    }
}

pub struct CellSession {
    pub row: usize,
    pub column: usize,
    pub editor: Entity<EditorView>,
    pub outbox: Outbox,
    pub _subscriptions: Vec<Subscription>,
}

/// An `<input>`'s value is one line: line breaks are stripped.
pub fn display(value: &str) -> String {
    value.chars().filter(|c| *c != '\n' && *c != '\r').collect()
}

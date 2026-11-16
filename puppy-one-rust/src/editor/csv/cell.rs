//! The active cell's editor (`CsvCellEditor`): a native `EditorView` placed and
//! styled like the cell's text. Keystroke edits stay in the cell editor's own
//! history during the session (`CS-03`) and commit as one table-level step on
//! `Enter`, `Tab`, `Escape`, clicking away or blur; multi-line values (`\n`,
//! `⌥Enter` / `SoftEnter`, paste) are preserved intact (`CS-06`).
use crate::editor::{
    text::state::{Applied, EditorState, Transaction, UserEvent},
    view::{
        EditorView,
        decoration::{Block, Decorations, Surface},
        extension::{DecorateInput, EditIntent, EditorExtension},
        style::LineStyle,
    },
};
use gpui::{Entity, Subscription};
use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    rc::Rc,
};

/// What a cell editor hands back to the table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellRequest {
    /// Tab / Shift-Tab (`handleCellKeyDown`).
    Next { backwards: bool },
    /// ⌘Z / ⌘⇧Z while the session has no uncommitted local edits: table history.
    History { redo: bool },
    /// Plain `Enter`: commit the cell session and return focus to the table (`CS-03`).
    Commit,
    /// `Escape`: exit cell editing and return focus to `#csv-table-editor` (`CS-14`).
    Escape,
}

pub type Outbox = Rc<Cell<Option<CellRequest>>>;

/// Multi-line cell extension (`CS-03`, `CS-06`, `CS-14`):
/// - `SoftEnter` (`⌥Enter` / `⇧Enter`) inserts `"\n"`.
/// - `Enter` commits the session and returns focus to the table.
/// - `Escape` exits cell editing and returns focus to the table.
/// - `Tab` / `Shift-Tab` commits and steps to the adjacent cell.
/// - `owns_history()` is `false` once edited in this session so per-keystroke
///   `⌘Z` / `⌘⇧Z` uses the cell's own `EditorView` history, and `true` while
///   untouched so `⌘Z` steps table history directly.
pub struct CellText {
    pub first_line: Rc<LineStyle>,
    pub continuation_line: Rc<LineStyle>,
    pub surface: Surface,
    pub outbox: Outbox,
    pub dirty: Rc<Cell<bool>>,
}

impl EditorExtension for CellText {
    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        let blocks = (0..input.state.doc.line_count())
            .map(|line| Block::Line {
                line,
                style: if line == 0 {
                    self.first_line.clone()
                } else {
                    self.continuation_line.clone()
                },
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
            EditIntent::Enter => self.outbox.set(Some(CellRequest::Commit)),
            EditIntent::Escape => self.outbox.set(Some(CellRequest::Escape)),
            EditIntent::SoftEnter => return None,
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

    fn applied(&mut self, applied: &Applied, _state: &EditorState, _focused: bool) {
        if applied.event != UserEvent::External {
            self.dirty.set(true);
        }
    }

    fn owns_history(&self) -> bool {
        !self.dirty.get()
    }

    fn history(&mut self, redo: bool) {
        self.outbox.set(Some(CellRequest::History { redo }));
    }
}

pub struct CellSession {
    pub row: usize,
    pub column: usize,
    pub dirty: Rc<Cell<bool>>,
    /// Latest committed (non-preedit) text inside `editor` for snapshot reads (`CS-03`).
    pub committed_draft: Rc<RefCell<String>>,
    pub editor: Entity<EditorView>,
    pub outbox: Outbox,
    pub _subscriptions: Vec<Subscription>,
}

/// First line of `value` and whether `value` spans multiple lines (`CS-06`).
pub fn first_line(value: &str) -> (&str, bool) {
    match value.find(['\n', '\r']) {
        Some(i) => (&value[..i], true),
        None => (value, false),
    }
}

/// Normalize `\r\n` and bare `\r` to `\n` for `EditorView::Buffer` while
/// preserving every line break (`CS-06`).
pub fn normalize_newlines(value: &str) -> Cow<'_, str> {
    if !value.contains('\r') {
        return Cow::Borrowed(value);
    }
    Cow::Owned(value.replace("\r\n", "\n").replace('\r', "\n"))
}

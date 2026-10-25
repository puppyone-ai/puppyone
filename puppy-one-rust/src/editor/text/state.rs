//! Immutable-style editor state transitions (CodeMirror `EditorState` +
//! `Transaction`): every edit is a change set applied with a new selection and
//! a user-event tag that history and views interpret.
use super::{buffer::Buffer, change::ChangeSet, selection::Selection};

/// What produced a transaction (CodeMirror `userEvent`). History groups
/// consecutive events of the same kind; views use it for scroll and reveal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UserEvent {
    /// Typed text, including IME commits.
    Input,
    /// Provisional IME composition text (marked text). History folds a whole
    /// composition into one `Input` step when it ends; listeners outside the
    /// view only hear about the result.
    Compose,
    /// Backward/forward deletion.
    Delete,
    Paste,
    /// Formatting or structural commands (always their own history step).
    Command,
    Undo,
    Redo,
    /// Selection-only change.
    Select,
    /// Content replaced from storage; never recorded in history.
    External,
}

#[derive(Clone, Debug)]
pub struct Transaction {
    pub changes: ChangeSet,
    pub selection: Option<Selection>,
    pub event: UserEvent,
    pub scroll_into_view: bool,
}

impl Transaction {
    pub fn select(selection: Selection) -> Self {
        Self {
            changes: ChangeSet::default(),
            selection: Some(selection),
            event: UserEvent::Select,
            scroll_into_view: true,
        }
    }
    pub fn edit(changes: ChangeSet, selection: Option<Selection>, event: UserEvent) -> Self {
        Self {
            changes,
            selection,
            event,
            scroll_into_view: true,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct EditorState {
    pub doc: Buffer,
    pub selection: Selection,
    /// Monotonic document revision; changes only when text changes.
    pub revision: u64,
}

/// Result of applying a transaction, retained for history and views.
pub struct Applied {
    pub before_doc: Buffer,
    pub before_selection: Selection,
    pub changes: ChangeSet,
    pub event: UserEvent,
}

impl EditorState {
    pub fn new(text: &str) -> Self {
        Self {
            doc: Buffer::new(text),
            selection: Selection::default(),
            revision: 0,
        }
    }
    pub fn apply(&mut self, tr: Transaction) -> Option<Applied> {
        let before_selection = self.selection;
        if tr.changes.is_empty() {
            if let Some(selection) = tr.selection {
                self.selection = self.clamp_selection(selection);
            }
            return None;
        }
        let before_doc = self.doc.clone();
        tr.changes.apply(&mut self.doc);
        self.selection = self.clamp_selection(
            tr.selection
                .unwrap_or_else(|| before_selection.map(&tr.changes)),
        );
        self.revision += 1;
        Some(Applied {
            before_doc,
            before_selection,
            changes: tr.changes,
            event: tr.event,
        })
    }
    fn clamp_selection(&self, s: Selection) -> Selection {
        Selection {
            anchor: self.doc.clamp(s.anchor),
            head: self.doc.clamp(s.head),
            ..s
        }
    }
}

//! The contract between the generic view and a document format (CodeMirror
//! extensions): formats decorate the document and may replace default
//! commands; the view owns selection, input, layout and painting.
use super::{
    command::Command,
    decoration::{Block, Decorations},
    style::LineStyle,
};
use crate::editor::text::{
    selection::Selection,
    state::{Applied, EditorState, Transaction},
};

/// Inputs that decide whether decorations must be rebuilt.
pub struct DecorateInput<'a> {
    pub state: &'a EditorState,
    pub focused: bool,
    /// A pointer drag is in progress (keeps line boxes stable, like the product).
    pub pointer_selecting: bool,
    pub dark: bool,
}

/// Editing intents a format may intercept (keymap overrides).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditIntent {
    Enter,
    SoftEnter,
    Tab,
    BackTab,
    Backspace,
    Delete,
    Bold,
    Italic,
    Strike,
    Code,
    Underline,
    Link,
    Escape,
    /// ← with a collapsed caret (before the default motion).
    CharLeft,
    /// Home / ⌘← (before the default motion).
    LineStart,
    /// ⌘0 – ⌘6.
    Heading(u8),
    BulletList,
    OrderedList,
    TaskList,
    Quote,
}

pub trait EditorExtension: std::any::Any {
    fn decorate(&mut self, input: &DecorateInput) -> Decorations;
    /// A cheap key; decorations are rebuilt when it changes (besides
    /// document revision, selection, focus, pointer and appearance).
    fn decoration_key(&self) -> u64 {
        0
    }
    fn intercept(&mut self, _intent: EditIntent, _state: &EditorState) -> Option<Transaction> {
        None
    }
    /// A widget control or hotspot ran a command (e.g. a task checkbox).
    fn command(&mut self, _command: &Command, _state: &EditorState) -> Option<Transaction> {
        None
    }
    /// Called after every applied transaction (reveal tracking, plans).
    fn applied(&mut self, _applied: &Applied, _state: &EditorState, _focused: bool) {}
    /// Selection-only changes and focus changes.
    fn selection_changed(
        &mut self,
        _state: &EditorState,
        _focused: bool,
        _pointer_selecting: bool,
    ) {
    }
    /// The document's history lives outside this view (a CSV cell edits the
    /// table model): undo / redo are handed to `history` instead.
    fn owns_history(&self) -> bool {
        false
    }
    fn history(&mut self, _redo: bool) {}
    /// Adjust a selection after a transaction (CodeMirror transaction
    /// filter), e.g. keep the caret off hidden block markers.
    fn normalize_selection(&mut self, _state: &EditorState) -> Option<Selection> {
        None
    }
}

/// Plain text: one style for every line, no syntax.
pub struct PlainText {
    pub line: std::rc::Rc<LineStyle>,
    pub decorations: Decorations,
}

impl EditorExtension for PlainText {
    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        let mut d = self.decorations.clone();
        d.blocks = (0..input.state.doc.line_count())
            .map(|line| Block::Line {
                line,
                style: self.line.clone(),
            })
            .collect();
        d
    }
}

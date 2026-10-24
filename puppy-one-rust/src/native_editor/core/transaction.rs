//! Typed edit intents and snapshots. Features never own an independent history.
use super::{
    document::{Document, Style},
    selection::Selection,
    text::Text,
};
use std::ops::Range;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub document: Document,
    pub selection: Selection,
    pub source_mode: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableCommand {
    AddRow,
    AddColumn,
    DeleteRow,
    DeleteColumn,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InsertKind {
    Paragraph,
    Table,
    List,
    Code,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Undo,
    Redo,
    Source,
    ToggleMark { bold: bool },
    SetStyle(Style),
    ToggleTask,
    Table(TableCommand),
    Insert(InsertKind),
    AddItem,
    DeleteBlock,
}
impl Command {
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "undo" => Self::Undo,
            "redo" => Self::Redo,
            "source" => Self::Source,
            "bold" => Self::ToggleMark { bold: true },
            "italic" => Self::ToggleMark { bold: false },
            "paragraph" => Self::SetStyle(Style::Paragraph),
            "h1" => Self::SetStyle(Style::Heading(1)),
            "h2" => Self::SetStyle(Style::Heading(2)),
            "quote" => Self::SetStyle(Style::Quote),
            "task" => Self::ToggleTask,
            "add-row" => Self::Table(TableCommand::AddRow),
            "add-column" => Self::Table(TableCommand::AddColumn),
            "delete-row" => Self::Table(TableCommand::DeleteRow),
            "delete-column" => Self::Table(TableCommand::DeleteColumn),
            "new-paragraph" => Self::Insert(InsertKind::Paragraph),
            "new-table" => Self::Insert(InsertKind::Table),
            "new-list" => Self::Insert(InsertKind::List),
            "new-code" => Self::Insert(InsertKind::Code),
            "add-item" => Self::AddItem,
            "delete-block" => Self::DeleteBlock,
            _ => return None,
        })
    }
}
/// Platform-neutral replacement; the input bridge has already resolved UTF-16.
pub struct InputEdit {
    pub selection: Selection,
    pub replacement: Option<(Range<usize>, Text)>,
    pub soft: bool,
    pub composing: bool,
}

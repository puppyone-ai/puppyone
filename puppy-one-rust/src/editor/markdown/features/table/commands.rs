//! Table commands (tableCommands.ts `dispatchMarkdownTableStructureOperation`):
//! a structure operation rewrites the table's source in one transaction.
//! Operations that create or target a cell put the caret at the end of its
//! text; moves keep the (mapped) selection — the moved row / column stays
//! structurally selected in the widget instead. Operations exceeding table
//! capacity limits (`TODO-32`) return `None` without mutating the document.
use super::{ID, model::Table, operation, widget::SESSION_FEATURE};
use crate::editor::{
    markdown::{
        core::features::CommandCx,
        platform::sessions::continuity::{Continuity, SequenceChange},
    },
    table::operation::Operation,
    text::{
        change::ChangeSet,
        selection::Selection,
        state::{Transaction, UserEvent},
    },
    view::command::Command,
};

/// A structure operation on the table whose source starts at `table`.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct Structure {
    pub table: usize,
    pub operation: Operation,
    pub row: usize,
    pub column: usize,
}

pub fn structure(table: usize, operation: Operation, row: usize, column: usize) -> Command {
    let command = Command::new(
        ID,
        Structure {
            table,
            operation,
            row,
            column,
        },
    );
    if operation.move_axis().is_some() {
        command.preserving_focus()
    } else {
        command
    }
}

pub fn transaction(command: &Command, cx: &CommandCx) -> Option<Transaction> {
    let s = *command.payload::<Structure>()?;
    let table: &Table = cx
        .plans
        .iter()
        .filter_map(|p| p.embed())
        .filter(|e| e.feature == ID)
        .filter_map(|e| e.model::<Table>())
        .find(|t| t.range.start == s.table)?;
    let edit = operation::try_apply(table, s.operation, s.row, s.column)?;
    if edit.replacement == cx.state.doc.slice(table.range.clone()) {
        return None;
    }
    let start = table.range.start;
    let selection = match (s.operation.move_axis(), edit.focus) {
        (Some(_), _) => None,
        (None, Some(f)) => edit
            .cells
            .get(f.row)
            .and_then(|r| r.get(f.column))
            .map(|cell| Selection::cursor(start + cell.end)),
        (None, None) => Some(Selection::cursor(start)),
    };
    let mut tr = Transaction::edit(
        ChangeSet::replace(table.range.clone(), &edit.replacement),
        selection,
        UserEvent::Command,
    );
    tr.scroll_into_view = false;
    // The rewritten table is the same widget: its viewport and column
    // sessions follow its columns, also through undo and redo.
    if s.operation != Operation::DeleteTable {
        tr.effects.push(
            Continuity {
                feature: SESSION_FEATURE,
                old: table.range.clone(),
                new: start..start + edit.replacement.len(),
                change: sequence_change(s.operation, s.column, table.alignments.len().max(1)),
            }
            .effect(),
        );
    }
    Some(tr)
}

/// `getMarkdownTableInlineSequenceChange`: how an operation moves columns.
pub fn sequence_change(operation: Operation, column: usize, columns: usize) -> SequenceChange {
    let last = columns.saturating_sub(1);
    let column = column.min(last);
    match operation {
        Operation::InsertColumnLeft => SequenceChange::Insert {
            index: column,
            count: 1,
        },
        Operation::InsertColumnRight => SequenceChange::Insert {
            index: column + 1,
            count: 1,
        },
        Operation::DeleteColumn if columns > 1 => SequenceChange::Delete {
            index: column,
            count: 1,
        },
        Operation::MoveColumnLeft if column > 0 => SequenceChange::Move {
            from: column,
            to: column - 1,
        },
        Operation::MoveColumnRight if column < last => SequenceChange::Move {
            from: column,
            to: column + 1,
        },
        Operation::MoveColumnTo(target) => SequenceChange::Move {
            from: column,
            to: target.min(last),
        },
        _ => SequenceChange::Preserve,
    }
}

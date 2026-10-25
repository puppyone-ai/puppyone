//! Table commands (tableCommands.ts `dispatchMarkdownTableStructureOperation`):
//! a structure operation rewrites the table's source in one transaction.
//! Operations that create or target a cell put the caret at the end of its
//! text; moves keep the (mapped) selection — the moved row / column stays
//! structurally selected in the widget instead.
use super::{ID, model::Table, operation};
use crate::editor::{
    markdown::core::feature::CommandCx,
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
    Command::new(
        ID,
        Structure {
            table,
            operation,
            row,
            column,
        },
    )
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
    let edit = operation::apply(table, s.operation, s.row, s.column);
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
    Some(tr)
}

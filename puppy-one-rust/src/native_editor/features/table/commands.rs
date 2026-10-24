//! Table shape mutations return a caret target; the session commits the edit.
use crate::native_editor::core::{
    document::{Block, Document, Kind},
    text::Text,
    transaction::TableCommand,
};
pub const MAX_ROWS: usize = 128;
pub const MAX_COLUMNS: usize = 24;
pub const MAX_PASTE_BYTES: usize = 64 * 1024;
pub fn new_table() -> Kind {
    Kind::Table {
        align: vec!["---".into(); 2],
        rows: vec![
            vec![Text::plain("Column 1"), Text::plain("Column 2")],
            vec![Text::default(); 2],
        ],
    }
}
pub fn apply(
    document: &mut Document,
    key: (usize, usize),
    command: TableCommand,
) -> Option<(usize, usize)> {
    let mut target = None;
    if let Some(Block {
        kind: Kind::Table { rows, align },
        ..
    }) = document.blocks.get_mut(key.0)
    {
        let (r, c) = (key.1 / align.len(), key.1 % align.len());
        match command {
            TableCommand::AddRow if rows.len() < MAX_ROWS => {
                rows.insert((r + 1).min(rows.len()), vec![Text::default(); align.len()]);
                target = Some((key.0, (r + 1) * align.len()));
            }
            TableCommand::AddColumn if align.len() < MAX_COLUMNS => {
                align.insert(c + 1, "---".into());
                for row in rows.iter_mut() {
                    row.insert(c + 1, Text::default());
                }
                target = Some((key.0, r * align.len() + c + 1));
            }
            TableCommand::DeleteRow if r > 0 && rows.len() > 1 => {
                rows.remove(r);
                target = Some((key.0, r.min(rows.len() - 1) * align.len() + c));
            }
            TableCommand::DeleteColumn if align.len() > 1 => {
                align.remove(c);
                for row in rows.iter_mut() {
                    row.remove(c);
                }
                target = Some((key.0, r * align.len() + c.min(align.len() - 1)));
            }
            _ => {}
        }
    }
    target
}

//! Navigation stays in whole-document coordinates, including exit from a table.
use crate::native_editor::core::{
    document::{Document, Kind},
    projection::Projection,
    transaction::{Command, InsertKind, TableCommand},
};
pub enum Navigation {
    None,
    Caret(usize),
    Edit(Command),
}
pub fn next(document: &Document, cursor: usize, backwards: bool, vertical: bool) -> Navigation {
    let projection = Projection::new(document);
    let span = projection.at(cursor);
    let Kind::Table { align, .. } = &document.blocks[span.key.0].kind else {
        return Navigation::None;
    };
    let pos = projection
        .spans
        .iter()
        .position(|s| s.key == span.key)
        .unwrap();
    let stride = if vertical { align.len() } else { 1 };
    let next = if backwards {
        pos.checked_sub(stride)
    } else {
        Some(pos + stride)
    };
    if let Some(target) = next.and_then(|p| projection.spans.get(p)) {
        Navigation::Caret(target.range.start)
    } else if backwards {
        Navigation::None
    } else {
        Navigation::Edit(if vertical {
            Command::Insert(InsertKind::Paragraph)
        } else {
            Command::Table(TableCommand::AddRow)
        })
    }
}

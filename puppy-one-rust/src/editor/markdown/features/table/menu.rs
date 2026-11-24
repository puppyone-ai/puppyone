//! Table context menu construction, event handling, and anchored overlay
//! (`tableContextMenu.ts`, extracted from `interaction.rs` & `controls.rs`).
use super::{
    interaction::{Frame, Geometry},
    operation::{can_insert_column, can_insert_row},
};
use crate::editor::table::{
    menu::{self, Extras, Item, Scope, TableMenu, Target},
    operation::{Axis, Operation},
};
use gpui::{prelude::*, *};

pub struct OpenMenu {
    pub menu: Entity<TableMenu>,
    pub position: Point<Pixels>,
    pub row: usize,
    pub column: usize,
    /// The row / column a grip menu describes (outlined while open).
    pub source: Option<(Axis, usize)>,
    pub(super) _subscription: Subscription,
}

/// Builds disabled-aware context menu sections for a table cell/row/column target.
pub(super) fn build_sections(
    frame: &Frame,
    scope: Scope,
    row: usize,
    column: usize,
) -> Vec<Vec<Item>> {
    let g = &frame.geometry;
    let target = Target {
        scope,
        row,
        column,
        rows: g.rows.len(),
        columns: g.columns.len(),
        first_movable: 1,
    };
    let extras = Extras {
        alignment: Some(frame.alignments.get(column).copied().unwrap_or_default()),
        delete_table: true,
        ..Default::default()
    };
    let mut sections = menu::sections(target, extras);
    let row_insert_ok = can_insert_row(g.rows.len(), g.columns.len());
    let col_insert_ok = can_insert_column(g.rows.len(), g.columns.len());
    for section in &mut sections {
        for item in section {
            match Operation::from_menu_id(item.id) {
                Some(
                    Operation::InsertRowAbove | Operation::InsertRowBelow | Operation::DuplicateRow,
                ) if !row_insert_ok => {
                    item.disabled = true;
                }
                Some(Operation::InsertColumnLeft | Operation::InsertColumnRight)
                    if !col_insert_ok =>
                {
                    item.disabled = true;
                }
                _ => {}
            }
        }
    }
    sections
}

/// Where a menu move puts its row / column.
pub(super) fn moved(
    operation: Operation,
    row: usize,
    column: usize,
    g: &Geometry,
) -> Option<(Axis, usize)> {
    let (rows, columns) = (g.rows.len(), g.columns.len());
    match operation {
        Operation::MoveRowUp if row > 1 => Some((Axis::Row, row - 1)),
        Operation::MoveRowDown if row >= 1 && row + 1 < rows => Some((Axis::Row, row + 1)),
        Operation::MoveColumnLeft if column > 0 => Some((Axis::Column, column - 1)),
        Operation::MoveColumnRight if column + 1 < columns => Some((Axis::Column, column + 1)),
        _ => None,
    }
}

/// Wraps an open [`TableMenu`] in an anchored deferred overlay snapped to window bounds.
pub(super) fn overlay_element(position: Point<Pixels>, menu: Entity<TableMenu>) -> AnyElement {
    deferred(
        anchored()
            .position(position)
            .snap_to_window_with_margin(px(8.))
            .child(menu),
    )
    .with_priority(1)
    .into_any_element()
}

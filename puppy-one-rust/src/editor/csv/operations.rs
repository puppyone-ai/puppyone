//! Structural table edits (viewers/csv/csvTableOperations.ts): a pure model
//! over the row matrix. The first row stays fixed while it is the header.

pub use crate::editor::table::operation::{Focus, Operation};

pub const MAX_DATA_ROWS: usize = 10_000;
pub const MAX_COLUMNS: usize = 256;

fn empty(columns: usize) -> Vec<String> {
    vec![String::new(); columns]
}

fn move_item<T>(items: &mut Vec<T>, from: usize, to: usize) {
    let item = items.remove(from);
    items.insert(to.min(items.len()), item);
}

/// `applyCsvTableOperation` at (`row`, `column`).
pub fn apply(source: &[Vec<String>], header: bool, op: Operation, row: usize, column: usize) -> (Vec<Vec<String>>, Focus) {
    let columns = source.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let mut rows: Vec<Vec<String>> = source.iter().map(|r| {
        let mut r = r.clone();
        r.resize(columns, String::new());
        r
    }).collect();
    if rows.is_empty() {
        rows.push(empty(columns));
    }
    let first = usize::from(header);
    let movable = row >= first && row < rows.len();
    let r = row.clamp(first, first.max(rows.len() - 1));
    let c = column.min(columns - 1);
    let mut focus = Focus { row: r.min(rows.len() - 1), column: c };
    match op {
        Operation::InsertRowAbove => {
            let at = r.clamp(first, rows.len());
            rows.insert(at, empty(columns));
            focus = Focus { row: at, column: 0 };
        }
        Operation::InsertRowBelow => {
            let at = (r + 1).clamp(first, rows.len());
            rows.insert(at, empty(columns));
            focus = Focus { row: at, column: 0 };
        }
        Operation::DuplicateRow => {
            if movable && r < rows.len() {
                let copy = rows[r].clone();
                rows.insert(r + 1, copy);
                focus = Focus { row: r + 1, column: 0 };
            }
        }
        Operation::MoveRowUp => {
            if movable && r > first && r < rows.len() {
                rows.swap(r, r - 1);
                focus = Focus { row: r - 1, column: c };
            }
        }
        Operation::MoveRowDown => {
            if movable && r + 1 < rows.len() {
                rows.swap(r, r + 1);
                focus = Focus { row: r + 1, column: c };
            }
        }
        Operation::MoveRowTo(target) => {
            let target = target.clamp(first, first.max(rows.len() - 1));
            if movable && r < rows.len() && r != target {
                move_item(&mut rows, r, target);
                focus = Focus { row: target, column: c };
            }
        }
        Operation::DeleteRow => {
            if movable && r < rows.len() {
                if header || rows.len() > 1 {
                    rows.remove(r);
                } else {
                    rows[0] = empty(columns);
                }
                let next = if rows.len() > first { r.min(rows.len() - 1).max(first) } else { rows.len().saturating_sub(1) };
                focus = Focus { row: next, column: c };
            }
        }
        Operation::InsertColumnLeft => {
            for row in &mut rows {
                row.insert(c, String::new());
            }
            focus = Focus { row: r.min(rows.len() - 1), column: c };
        }
        Operation::InsertColumnRight => {
            for row in &mut rows {
                row.insert(c + 1, String::new());
            }
            focus = Focus { row: r.min(rows.len() - 1), column: c + 1 };
        }
        Operation::MoveColumnLeft => {
            if c > 0 {
                for row in &mut rows {
                    row.swap(c, c - 1);
                }
                focus = Focus { row: r.min(rows.len() - 1), column: c - 1 };
            }
        }
        Operation::MoveColumnRight => {
            if c + 1 < columns {
                for row in &mut rows {
                    row.swap(c, c + 1);
                }
                focus = Focus { row: r.min(rows.len() - 1), column: c + 1 };
            }
        }
        Operation::MoveColumnTo(target) => {
            let target = target.min(columns - 1);
            if c != target {
                for row in &mut rows {
                    move_item(row, c, target);
                }
                focus = Focus { row: r.min(rows.len() - 1), column: target };
            }
        }
        Operation::DeleteColumn => {
            if columns > 1 {
                for row in &mut rows {
                    row.remove(c);
                }
                focus = Focus { row: r.min(rows.len() - 1), column: c.min(columns - 2) };
            }
        }
        Operation::ExpandToShape { data_rows, columns: target_columns } => {
            let header_rows = usize::from(header);
            let current_data = rows.len().saturating_sub(header_rows);
            let target_data = current_data.max(data_rows.min(MAX_DATA_ROWS));
            let target_columns = columns.max(target_columns.clamp(1, MAX_COLUMNS));
            let target_rows = (target_data + header_rows).max(1);
            let original = rows.len();
            for row in &mut rows {
                row.resize(target_columns, String::new());
            }
            while rows.len() < target_rows {
                rows.push(empty(target_columns));
            }
            let first_focusable = header_rows.min(rows.len() - 1);
            focus = Focus {
                row: if rows.len() > original { original } else { r.clamp(first_focusable, rows.len() - 1) },
                column: if target_columns > columns { columns } else { c },
            };
        }
        // Markdown-only operations: a CSV has no alignment row.
        Operation::SetColumnAlignment(_) | Operation::DeleteTable => {}
    }
    (rows, focus)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(rows: &[&[&str]]) -> Vec<Vec<String>> {
        rows.iter().map(|r| r.iter().map(|s| s.to_string()).collect()).collect()
    }

    #[test]
    fn header_stays_fixed_and_shapes_expand() {
        let rows = m(&[&["h1", "h2"], &["a", "b"], &["c", "d"]]);
        let (r, f) = apply(&rows, true, Operation::MoveRowUp, 1, 0);
        assert_eq!((r, f), (rows.clone(), Focus { row: 1, column: 0 }));
        let (r, f) = apply(&rows, true, Operation::InsertRowAbove, 0, 1);
        assert_eq!((r[1].clone(), f), (vec![String::new(), String::new()], Focus { row: 1, column: 0 }));
        let (r, f) = apply(&rows, true, Operation::ExpandToShape { data_rows: 3, columns: 3 }, 2, 1);
        assert_eq!((r.len(), r[0].len(), f), (4, 3, Focus { row: 3, column: 2 }));
        let (r, _) = apply(&rows, true, Operation::DeleteColumn, 1, 0);
        assert_eq!(r, m(&[&["h2"], &["b"], &["d"]]));
        let (r, _) = apply(&rows, true, Operation::MoveColumnTo(1), 1, 0);
        assert_eq!(r[0], vec!["h2".to_string(), "h1".to_string()]);
    }
}

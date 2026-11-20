//! Structural table edits (viewers/csv/csvTableOperations.ts): a pure model
//! over the row matrix. The first row stays fixed while it is the header.

pub use crate::editor::table::operation::{Focus, MAX_COLUMNS, MAX_DATA_ROWS, Operation};

fn empty(columns: usize) -> Vec<String> {
    vec![String::new(); columns]
}

fn move_item<T>(items: &mut Vec<T>, from: usize, to: usize) {
    let item = items.remove(from);
    items.insert(to.min(items.len()), item);
}

/// `applyCsvTableOperation` at (`row`, `column`).
pub fn apply(
    source: &[Vec<String>],
    header: bool,
    op: Operation,
    row: usize,
    column: usize,
) -> (Vec<Vec<String>>, Focus) {
    let columns = source.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let mut rows: Vec<Vec<String>> = source
        .iter()
        .map(|r| {
            let mut r = r.clone();
            r.resize(columns, String::new());
            r
        })
        .collect();
    if rows.is_empty() {
        rows.push(empty(columns));
    }
    let first = usize::from(header);
    let data_count = rows.len().saturating_sub(first);
    let movable = row >= first && row < rows.len();
    let r = row.clamp(first, first.max(rows.len() - 1));
    let c = column.min(columns - 1);
    let mut focus = Focus {
        row: r.min(rows.len() - 1),
        column: c,
    };
    match op {
        Operation::InsertRowAbove => {
            if data_count < MAX_DATA_ROWS {
                let at = r.clamp(first, rows.len());
                rows.insert(at, empty(columns));
                focus = Focus { row: at, column: 0 };
            }
        }
        Operation::InsertRowBelow => {
            if data_count < MAX_DATA_ROWS {
                let at = (r + 1).clamp(first, rows.len());
                rows.insert(at, empty(columns));
                focus = Focus { row: at, column: 0 };
            }
        }
        Operation::DuplicateRow => {
            if movable && r < rows.len() && data_count < MAX_DATA_ROWS {
                let copy = rows[r].clone();
                rows.insert(r + 1, copy);
                focus = Focus {
                    row: r + 1,
                    column: 0,
                };
            }
        }
        Operation::MoveRowUp => {
            if movable && r > first && r < rows.len() {
                rows.swap(r, r - 1);
                focus = Focus {
                    row: r - 1,
                    column: c,
                };
            }
        }
        Operation::MoveRowDown => {
            if movable && r + 1 < rows.len() {
                rows.swap(r, r + 1);
                focus = Focus {
                    row: r + 1,
                    column: c,
                };
            }
        }
        Operation::MoveRowTo(target) => {
            let target = target.clamp(first, first.max(rows.len() - 1));
            if movable && r < rows.len() && r != target {
                move_item(&mut rows, r, target);
                focus = Focus {
                    row: target,
                    column: c,
                };
            }
        }
        Operation::DeleteRow => {
            if movable && r < rows.len() {
                if header || rows.len() > 1 {
                    rows.remove(r);
                } else {
                    rows[0] = empty(columns);
                }
                let next = if rows.len() > first {
                    r.min(rows.len() - 1).max(first)
                } else {
                    rows.len().saturating_sub(1)
                };
                focus = Focus {
                    row: next,
                    column: c,
                };
            }
        }
        Operation::InsertColumnLeft => {
            if columns < MAX_COLUMNS {
                for row in &mut rows {
                    row.insert(c, String::new());
                }
                focus = Focus {
                    row: r.min(rows.len() - 1),
                    column: c,
                };
            }
        }
        Operation::InsertColumnRight => {
            if columns < MAX_COLUMNS {
                for row in &mut rows {
                    row.insert(c + 1, String::new());
                }
                focus = Focus {
                    row: r.min(rows.len() - 1),
                    column: c + 1,
                };
            }
        }
        Operation::MoveColumnLeft => {
            if c > 0 {
                for row in &mut rows {
                    row.swap(c, c - 1);
                }
                focus = Focus {
                    row: r.min(rows.len() - 1),
                    column: c - 1,
                };
            }
        }
        Operation::MoveColumnRight => {
            if c + 1 < columns {
                for row in &mut rows {
                    row.swap(c, c + 1);
                }
                focus = Focus {
                    row: r.min(rows.len() - 1),
                    column: c + 1,
                };
            }
        }
        Operation::MoveColumnTo(target) => {
            let target = target.min(columns - 1);
            if c != target {
                for row in &mut rows {
                    move_item(row, c, target);
                }
                focus = Focus {
                    row: r.min(rows.len() - 1),
                    column: target,
                };
            }
        }
        Operation::DeleteColumn => {
            if columns > 1 {
                for row in &mut rows {
                    row.remove(c);
                }
                focus = Focus {
                    row: r.min(rows.len() - 1),
                    column: c.min(columns - 2),
                };
            }
        }
        Operation::ExpandToShape {
            data_rows,
            columns: target_columns,
        } => {
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
                row: if rows.len() > original {
                    original
                } else {
                    r.clamp(first_focusable, rows.len() - 1)
                },
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
        rows.iter()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .collect()
    }

    /// `csvTableOperations.test.ts` with the product's inputs: the header
    /// stays fixed while rows move by command or drop; body rows insert,
    /// duplicate and delete without touching the source; columns move,
    /// insert and delete whole; deleting the only row leaves a blank one;
    /// expanding grows rows and columns at once and never shrinks.
    #[test]
    fn the_product_operation_cases_rewrite_only_what_they_name() {
        let rows = m(&[&["Name", "Score"], &["Ada", "1"], &["Lin", "2"]]);
        assert_eq!(apply(&rows, true, Operation::MoveRowUp, 1, 0).0, rows);
        assert_eq!(apply(&rows, true, Operation::DeleteRow, 0, 0).0, rows);
        assert_eq!(
            apply(&rows, true, Operation::MoveRowTo(1), 2, 1),
            (
                m(&[&["Name", "Score"], &["Lin", "2"], &["Ada", "1"]]),
                Focus { row: 1, column: 1 }
            )
        );

        let rows = m(&[&["Header"], &["one"], &["two"]]);
        let (inserted, _) = apply(&rows, true, Operation::InsertRowAbove, 1, 0);
        let (duplicated, _) = apply(&inserted, true, Operation::DuplicateRow, 2, 0);
        let (deleted, _) = apply(&duplicated, true, Operation::DeleteRow, 1, 0);
        assert_eq!(rows, m(&[&["Header"], &["one"], &["two"]]));
        assert_eq!(inserted, m(&[&["Header"], &[""], &["one"], &["two"]]));
        assert_eq!(
            duplicated,
            m(&[&["Header"], &[""], &["one"], &["one"], &["two"]])
        );
        assert_eq!(deleted, m(&[&["Header"], &["one"], &["one"], &["two"]]));

        let rows = m(&[&["A", "B", "C"], &["1", "2", "3"]]);
        let moved = apply(&rows, false, Operation::MoveColumnTo(0), 0, 2);
        assert_eq!(
            moved,
            (
                m(&[&["C", "A", "B"], &["3", "1", "2"]]),
                Focus { row: 0, column: 0 }
            )
        );
        let (inserted, _) = apply(&moved.0, false, Operation::InsertColumnRight, 1, 1);
        assert_eq!(inserted, m(&[&["C", "A", "", "B"], &["3", "1", "", "2"]]));
        assert_eq!(
            apply(&inserted, false, Operation::DeleteColumn, 1, 2).0,
            moved.0
        );

        assert_eq!(
            apply(&m(&[&["value"]]), false, Operation::DeleteRow, 0, 0),
            (m(&[&[""]]), Focus { row: 0, column: 0 })
        );

        let source = m(&[&["Name", "Score"], &["Ada", "1"]]);
        let grow = |data_rows, columns| Operation::ExpandToShape { data_rows, columns };
        let expanded = apply(&source, true, grow(4, 5), 1, 1);
        assert_eq!(
            expanded,
            (
                m(&[
                    &["Name", "Score", "", "", ""],
                    &["Ada", "1", "", "", ""],
                    &["", "", "", "", ""],
                    &["", "", "", "", ""],
                    &["", "", "", "", ""],
                ]),
                Focus { row: 2, column: 2 }
            )
        );
        assert_eq!(apply(&expanded.0, true, grow(1, 1), 1, 1).0, expanded.0);
    }

    #[test]
    fn header_stays_fixed_and_shapes_expand() {
        let rows = m(&[&["h1", "h2"], &["a", "b"], &["c", "d"]]);
        let (r, f) = apply(&rows, true, Operation::MoveRowUp, 1, 0);
        assert_eq!((r, f), (rows.clone(), Focus { row: 1, column: 0 }));
        let (r, f) = apply(&rows, true, Operation::InsertRowAbove, 0, 1);
        assert_eq!(
            (r[1].clone(), f),
            (
                vec![String::new(), String::new()],
                Focus { row: 1, column: 0 }
            )
        );
        let (r, f) = apply(
            &rows,
            true,
            Operation::ExpandToShape {
                data_rows: 3,
                columns: 3,
            },
            2,
            1,
        );
        assert_eq!(
            (r.len(), r[0].len(), f),
            (4, 3, Focus { row: 3, column: 2 })
        );
        let (r, _) = apply(&rows, true, Operation::DeleteColumn, 1, 0);
        assert_eq!(r, m(&[&["h2"], &["b"], &["d"]]));
        let (r, _) = apply(&rows, true, Operation::MoveColumnTo(1), 1, 0);
        assert_eq!(r[0], vec!["h2".to_string(), "h1".to_string()]);
    }

    #[test]
    fn dimension_caps_refuse_row_and_column_overflow_cleanly() {
        let mut full_rows: Vec<Vec<String>> =
            (0..=MAX_DATA_ROWS).map(|i| vec![format!("r{i}")]).collect();
        let (after_above, _) = apply(&full_rows, true, Operation::InsertRowAbove, 1, 0);
        assert_eq!(after_above.len(), MAX_DATA_ROWS + 1);
        let (after_below, _) = apply(&full_rows, true, Operation::InsertRowBelow, 1, 0);
        assert_eq!(after_below.len(), MAX_DATA_ROWS + 1);
        let (after_dup, _) = apply(&full_rows, true, Operation::DuplicateRow, 1, 0);
        assert_eq!(after_dup.len(), MAX_DATA_ROWS + 1);
        full_rows.pop();
        let (allowed, _) = apply(&full_rows, true, Operation::InsertRowBelow, 1, 0);
        assert_eq!(allowed.len(), MAX_DATA_ROWS + 1);

        let full_cols = vec![
            (0..MAX_COLUMNS)
                .map(|c| format!("c{c}"))
                .collect::<Vec<_>>(),
        ];
        let (after_left, _) = apply(&full_cols, false, Operation::InsertColumnLeft, 0, 0);
        assert_eq!(after_left[0].len(), MAX_COLUMNS);
        let (after_right, _) = apply(&full_cols, false, Operation::InsertColumnRight, 0, 0);
        assert_eq!(after_right[0].len(), MAX_COLUMNS);
    }
}

//! Structure edits of a Markdown table (tableModel.ts
//! `applyMarkdownTableOperation` / `serializeMarkdownTable`): the table is
//! rewritten as a whole — cells sanitised (`|` escaped, line breaks folded),
//! columns padded to their widest cell, the delimiter row carrying each
//! column's alignment — so every structure edit is one source replacement.
//! Enforces `ROW_LIMIT`, `COLUMN_LIMIT`, `CELL_LIMIT`, and `ROW_BYTE_LIMIT`
//! (`TODO-32`) before row/column insertions so capacity-exceeding edits refuse
//! cleanly without corrupting or dropping the table into raw broken source.
use super::model::{Alignment, CELL_LIMIT, COLUMN_LIMIT, ROW_BYTE_LIMIT, ROW_LIMIT, Table};
use crate::editor::table::operation::{Focus, Operation};
use std::ops::Range;

/// A rewritten table and where focus goes.
#[derive(Clone, Debug, PartialEq)]
pub struct Edit {
    pub replacement: String,
    pub focus: Option<Focus>,
    /// Each row's cell content ranges in `replacement` (the delimiter row
    /// excluded), for placing the caret.
    pub cells: Vec<Vec<Range<usize>>>,
}

/// Returns `true` when inserting one additional row stays within [`ROW_LIMIT`]
/// and [`CELL_LIMIT`] (`TODO-32`).
pub fn can_insert_row(rows: usize, columns: usize) -> bool {
    let next_rows = rows.saturating_add(1);
    next_rows <= ROW_LIMIT && next_rows.saturating_mul(columns.max(1)) <= CELL_LIMIT
}

/// Returns `true` when inserting one additional column stays within
/// [`COLUMN_LIMIT`] and [`CELL_LIMIT`] (`TODO-32`).
pub fn can_insert_column(rows: usize, columns: usize) -> bool {
    let next_cols = columns.saturating_add(1);
    next_cols <= COLUMN_LIMIT && rows.max(1).saturating_mul(next_cols) <= CELL_LIMIT
}

/// `sanitizeMarkdownTableCell`.
pub fn sanitize(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let mut folded = String::with_capacity(normalized.len());
    let mut newline = false;
    for c in normalized.chars() {
        if c == '\n' {
            if !newline {
                folded.push(' ');
            }
            newline = true;
        } else {
            newline = false;
            folded.push(c);
        }
    }
    folded.replace('|', "\\|").trim().to_owned()
}

/// JS string length (UTF-16 units), as `padEnd` counts.
fn units(s: &str) -> usize {
    s.encode_utf16().count()
}

fn delimiter_cell(alignment: Alignment) -> &'static str {
    match alignment {
        Alignment::Left => ":---",
        Alignment::Center => ":---:",
        Alignment::Right => "---:",
        Alignment::None => "---",
    }
}

/// `serializeMarkdownTable`: the header, the delimiter row, the body.
pub fn serialize(
    rows: &[Vec<String>],
    alignments: &[Alignment],
) -> (String, Vec<Vec<Range<usize>>>) {
    let width = alignments
        .len()
        .max(rows.iter().map(Vec::len).max().unwrap_or(0))
        .max(1);
    let cells: Vec<Vec<String>> = if rows.is_empty() {
        vec![vec![String::new(); width]]
    } else {
        rows.iter()
            .map(|r| {
                (0..width)
                    .map(|c| sanitize(r.get(c).map_or("", String::as_str)))
                    .collect()
            })
            .collect()
    };
    let delimiters: Vec<&str> = (0..width)
        .map(|c| delimiter_cell(alignments.get(c).copied().unwrap_or_default()))
        .collect();
    let widths: Vec<usize> = (0..width)
        .map(|c| {
            cells
                .iter()
                .map(|r| units(&r[c]))
                .max()
                .unwrap_or(0)
                .max(delimiters[c].len())
        })
        .collect();
    let mut out = String::new();
    let mut offsets = Vec::with_capacity(cells.len());
    let row = |out: &mut String, values: &[&str]| -> Vec<Range<usize>> {
        let mut ranges = Vec::with_capacity(values.len());
        out.push('|');
        for (c, value) in values.iter().enumerate() {
            out.push(' ');
            let start = out.len();
            out.push_str(value);
            ranges.push(start..out.len());
            out.extend(std::iter::repeat_n(
                ' ',
                widths[c].saturating_sub(units(value)),
            ));
            out.push_str(" |");
        }
        ranges
    };
    let header: Vec<&str> = cells[0].iter().map(String::as_str).collect();
    offsets.push(row(&mut out, &header));
    out.push('\n');
    row(&mut out, &delimiters);
    for r in &cells[1..] {
        out.push('\n');
        let values: Vec<&str> = r.iter().map(String::as_str).collect();
        offsets.push(row(&mut out, &values));
    }
    (out, offsets)
}

fn swap<T>(items: &mut [T], a: usize, b: usize) {
    items.swap(a, b);
}

fn move_item<T>(items: &mut Vec<T>, from: usize, to: usize) {
    let item = items.remove(from);
    items.insert(to.min(items.len()), item);
}

/// Applies `operation` at `(row, column)`, returning `None` when the resulting
/// table would violate `ROW_LIMIT`, `COLUMN_LIMIT`, `CELL_LIMIT`, or
/// `ROW_BYTE_LIMIT` (`TODO-32`).
pub fn try_apply(table: &Table, operation: Operation, row: usize, column: usize) -> Option<Edit> {
    if operation == Operation::DeleteTable {
        return Some(Edit {
            replacement: String::new(),
            focus: None,
            cells: Vec::new(),
        });
    }
    let width = table
        .alignments
        .len()
        .max(table.rows.iter().map(|r| r.cells.len()).max().unwrap_or(0))
        .max(1);
    let mut rows: Vec<Vec<String>> = table
        .rows
        .iter()
        .map(|r| {
            (0..width)
                .map(|c| {
                    r.cells
                        .get(c)
                        .map_or(String::new(), |cell| cell.text.clone())
                })
                .collect()
        })
        .collect();
    if rows.is_empty() {
        rows.push(vec![String::new(); width]);
    }
    if rows.len() > ROW_LIMIT
        || width > COLUMN_LIMIT
        || rows.len().saturating_mul(width) > CELL_LIMIT
    {
        return None;
    }
    match operation {
        Operation::InsertRowAbove | Operation::InsertRowBelow | Operation::DuplicateRow
            if !can_insert_row(rows.len(), width) =>
        {
            return None;
        }
        Operation::InsertColumnLeft | Operation::InsertColumnRight
            if !can_insert_column(rows.len(), width) =>
        {
            return None;
        }
        _ => {}
    }

    let mut alignments: Vec<Alignment> = (0..width)
        .map(|c| table.alignments.get(c).copied().unwrap_or_default())
        .collect();
    let r = row.min(rows.len() - 1);
    let c = column.min(width - 1);
    let empty = || vec![String::new(); width];
    let mut focus = Focus { row: r, column: c };
    match operation {
        Operation::InsertRowAbove => {
            let at = if r == 0 { 1 } else { r };
            rows.insert(at, empty());
            focus = Focus { row: at, column: 0 };
        }
        Operation::InsertRowBelow => {
            let at = (r + 1).max(1);
            rows.insert(at, empty());
            focus = Focus { row: at, column: 0 };
        }
        Operation::DeleteRow => {
            if r > 0 && rows.len() > 1 {
                rows.remove(r);
                focus = Focus {
                    row: r.min(rows.len() - 1),
                    column: c,
                };
            }
        }
        Operation::MoveRowUp => {
            if r > 1 {
                swap(&mut rows, r, r - 1);
                focus = Focus {
                    row: r - 1,
                    column: c,
                };
            }
        }
        Operation::MoveRowDown => {
            if r > 0 && r + 1 < rows.len() {
                swap(&mut rows, r, r + 1);
                focus = Focus {
                    row: r + 1,
                    column: c,
                };
            }
        }
        Operation::MoveRowTo(target) => {
            let target = target.clamp(1, (rows.len() - 1).max(1));
            if r > 0 && r != target && target < rows.len() {
                move_item(&mut rows, r, target);
                focus = Focus {
                    row: target,
                    column: c,
                };
            }
        }
        Operation::DuplicateRow => {
            let at = (r + 1).max(1);
            let copy = rows[r].clone();
            rows.insert(at, copy);
            focus = Focus { row: at, column: 0 };
        }
        Operation::InsertColumnLeft => {
            for row in &mut rows {
                row.insert(c, String::new());
            }
            alignments.insert(c, Alignment::None);
            focus = Focus { row: r, column: c };
        }
        Operation::InsertColumnRight => {
            for row in &mut rows {
                row.insert(c + 1, String::new());
            }
            alignments.insert(c + 1, Alignment::None);
            focus = Focus {
                row: r,
                column: c + 1,
            };
        }
        Operation::DeleteColumn => {
            if width > 1 {
                for row in &mut rows {
                    row.remove(c);
                }
                alignments.remove(c);
                focus = Focus {
                    row: r,
                    column: c.min(width - 2),
                };
            }
        }
        Operation::MoveColumnLeft => {
            if c > 0 {
                for row in &mut rows {
                    swap(row, c, c - 1);
                }
                swap(&mut alignments, c, c - 1);
                focus = Focus {
                    row: r,
                    column: c - 1,
                };
            }
        }
        Operation::MoveColumnRight => {
            if c + 1 < width {
                for row in &mut rows {
                    swap(row, c, c + 1);
                }
                swap(&mut alignments, c, c + 1);
                focus = Focus {
                    row: r,
                    column: c + 1,
                };
            }
        }
        Operation::MoveColumnTo(target) => {
            let target = target.min(width - 1);
            if c != target {
                for row in &mut rows {
                    move_item(row, c, target);
                }
                move_item(&mut alignments, c, target);
                focus = Focus {
                    row: r,
                    column: target,
                };
            }
        }
        Operation::SetColumnAlignment(alignment) => alignments[c] = alignment,
        Operation::DeleteTable | Operation::ExpandToShape { .. } => {}
    }
    let (replacement, cells) = serialize(&rows, &alignments);
    if replacement.lines().any(|line| line.len() > ROW_BYTE_LIMIT) {
        return None;
    }
    Some(Edit {
        replacement,
        focus: Some(focus),
        cells,
    })
}

/// Applies `operation` when within capacity limits (`TODO-32`), or returns an
/// unchanged serialized table when refused.
#[cfg(test)]
pub fn apply(table: &Table, operation: Operation, row: usize, column: usize) -> Edit {
    try_apply(table, operation, row, column).unwrap_or_else(|| {
        let width = table.alignments.len().max(1);
        let rows: Vec<Vec<String>> = table
            .rows
            .iter()
            .map(|r| {
                (0..width)
                    .map(|c| {
                        r.cells
                            .get(c)
                            .map_or(String::new(), |cell| cell.text.clone())
                    })
                    .collect()
            })
            .collect();
        let (replacement, cells) = serialize(&rows, &table.alignments);
        Edit {
            replacement,
            focus: None,
            cells,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{
        markdown::features::table::model::{Cell, Row, table_block},
        text::buffer::Buffer,
    };

    fn table(source: &str) -> Table {
        let doc = Buffer::new(source);
        table_block(&doc, &(0..doc.len())).unwrap()
    }

    fn synthetic_table(row_count: usize, col_count: usize, cell_text: &str) -> Table {
        let rows = (0..row_count)
            .map(|r| Row {
                cells: (0..col_count)
                    .map(|_| Cell {
                        range: 0..0,
                        text: cell_text.to_owned(),
                        editable: true,
                    })
                    .collect(),
                header: r == 0,
                line: if r == 0 { 0 } else { r + 1 },
            })
            .collect();
        Table {
            range: 0..10,
            lines: 0..row_count + 1,
            alignments: vec![Alignment::None; col_count],
            rows,
            refinement_valid: true,
        }
    }

    #[test]
    fn serialization_pads_escapes_and_keeps_alignment() {
        let t = table("| Name | Value |\n| :-- | --: |\n| a\\|b | 1 |");
        let edit = apply(&t, Operation::SetColumnAlignment(Alignment::Center), 1, 1);
        assert_eq!(
            edit.replacement,
            "| Name | Value |\n| :--- | :---: |\n| a\\|b | 1     |"
        );
        assert_eq!(&edit.replacement[edit.cells[1][0].clone()], "a\\|b");
        assert_eq!(
            serialize(&[vec!["中文".into()], vec!["x".into()]], &[Alignment::None]).0,
            "| 中文  |\n| --- |\n| x   |"
        );
    }

    #[test]
    fn rows_and_columns_follow_the_product_rules() {
        let t = table("| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |");
        let e = apply(&t, Operation::InsertRowAbove, 0, 1);
        assert_eq!(e.replacement.lines().nth(2), Some("|     |     |"));
        assert_eq!(e.focus, Some(Focus { row: 1, column: 0 }));
        let e = apply(&t, Operation::MoveRowTo(1), 2, 0);
        assert_eq!(e.replacement.lines().nth(2), Some("| c   | d   |"));
        assert_eq!(e.focus, Some(Focus { row: 1, column: 0 }));
        assert_eq!(
            apply(&t, Operation::DeleteRow, 0, 0)
                .replacement
                .lines()
                .count(),
            4
        );
        let e = apply(&t, Operation::InsertColumnRight, 1, 0);
        assert_eq!(e.replacement.lines().next(), Some("| h1  |     | h2  |"));
        assert_eq!(e.focus, Some(Focus { row: 1, column: 1 }));
        let e = apply(&t, Operation::MoveColumnTo(0), 1, 1);
        assert_eq!(e.replacement.lines().nth(2), Some("| b   | a   |"));
        assert_eq!(apply(&t, Operation::DeleteTable, 0, 0).replacement, "");
    }

    #[test]
    fn capacity_limits_refuse_row_and_column_insertions_cleanly() {
        // Row limit (`ROW_LIMIT = 2000`).
        let at_row_cap = synthetic_table(ROW_LIMIT, 2, "x");
        assert!(try_apply(&at_row_cap, Operation::InsertRowAbove, 1, 0).is_none());
        assert!(try_apply(&at_row_cap, Operation::InsertRowBelow, 1, 0).is_none());
        assert!(try_apply(&at_row_cap, Operation::DuplicateRow, 1, 0).is_none());
        // Deleting a row at capacity is still allowed!
        assert!(try_apply(&at_row_cap, Operation::DeleteRow, 1, 0).is_some());

        // Column limit (`COLUMN_LIMIT = 64`).
        let at_col_cap = synthetic_table(3, COLUMN_LIMIT, "x");
        assert!(try_apply(&at_col_cap, Operation::InsertColumnLeft, 0, 0).is_none());
        assert!(try_apply(&at_col_cap, Operation::InsertColumnRight, 0, 0).is_none());
        assert!(try_apply(&at_col_cap, Operation::DeleteColumn, 0, 0).is_some());

        // Cell budget (`CELL_LIMIT = 20_000`): 500 rows * 40 cols = 20_000 cells.
        let at_cell_cap = synthetic_table(500, 40, "x");
        assert!(try_apply(&at_cell_cap, Operation::InsertRowBelow, 1, 0).is_none());
        assert!(try_apply(&at_cell_cap, Operation::InsertColumnRight, 0, 0).is_none());

        // Per-row byte budget (`ROW_BYTE_LIMIT = 64 KiB`): adding a column when near 64 KiB refuses cleanly.
        let wide_cell = "a".repeat(ROW_BYTE_LIMIT - 4);
        let near_byte_cap = synthetic_table(2, 1, &wide_cell);
        assert!(try_apply(&near_byte_cap, Operation::InsertColumnRight, 0, 0).is_none());
    }
}

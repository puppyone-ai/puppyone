//! The canonical structured CSV model (viewers/csv/CsvDocumentModel.ts):
//! persistent `Arc` B-tree row sequence (`CS-01`), stable row and column
//! identities, incremental byte-budgeted history (`CS-02`), byte-preserving
//! on-demand serialization (`CS-04`), unclosed-quote read-only gating (`CS-05`),
//! and record-level diff adoption (`CS-10`). Column geometry lives in
//! `layout.rs`, outside this history.
pub use super::rows::{Row, RowVec, empty_cell};
use super::{
    diff::{self, cell_bytes, row_full_bytes},
    document::{self, Delimiter, Layout, RecordOut},
    operations::{Focus, MAX_COLUMNS, MAX_DATA_ROWS, Operation},
};
use std::{rc::Rc, sync::Arc};

/// `DOCUMENT_HISTORY_POLICY`.
pub const HISTORY_ENTRIES: usize = 200;
pub const HISTORY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct Content {
    pub columns: Vec<u64>,
    /// Bumped only on explicit hard reset; `adopt_text` preserves epoch and IDs (`CS-10`).
    pub epoch: u64,
    pub has_source: bool,
    pub layout: Layout,
    pub rows: RowVec,
    pub suggested_header: bool,
    pub unclosed_quote: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Change {
    pub changed: bool,
    pub focus: Option<Focus>,
}

#[derive(Clone, Debug)]
struct HistoryEntry {
    content: Content,
    delta_bytes: usize,
}

/// Thread-safe parsed content produced on a background executor (`CS-13`).
pub struct StandaloneParsed {
    pub content: Content,
    pub next_id: u64,
}

pub struct CsvModel {
    delimiter: Delimiter,
    content: Content,
    revision: u64,
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
    next_id: u64,
    input_gate: bool,
    serialized: std::cell::RefCell<Option<(u64, Rc<String>)>>,
}

fn empty_cells(columns: usize) -> Arc<Vec<Arc<str>>> {
    let e = empty_cell();
    Arc::new((0..columns).map(|_| e.clone()).collect())
}

fn vec_to_cells(cells: Vec<String>) -> Arc<Vec<Arc<str>>> {
    let e = empty_cell();
    Arc::new(
        cells
            .into_iter()
            .map(|c| {
                if c.is_empty() {
                    e.clone()
                } else {
                    Arc::from(c.as_str())
                }
            })
            .collect(),
    )
}

fn move_item<T>(items: &mut Vec<T>, from: usize, to: usize) {
    let item = items.remove(from);
    items.insert(to.min(items.len()), item);
}

impl CsvModel {
    pub fn new(text: &str, delimiter: Delimiter) -> Self {
        let standalone = Self::parse_standalone(text, delimiter);
        let revision = 1;
        let serialized = std::cell::RefCell::new(Some((revision, Rc::new(text.to_owned()))));
        Self {
            delimiter,
            content: standalone.content,
            revision,
            undo: Vec::new(),
            redo: Vec::new(),
            next_id: standalone.next_id,
            input_gate: true,
            serialized,
        }
    }

    /// Parse `text` without touching any thread-local / `Rc` state (`CS-13`).
    pub fn parse_standalone(text: &str, delimiter: Delimiter) -> StandaloneParsed {
        let parsed = document::parse(text, delimiter);
        let matrix = document::normalize(parsed.rows);
        let col_count = matrix.first().map_or(1, Vec::len).max(1);
        let suggested_header = document::infer_header(&matrix);
        let mut next_id = 0u64;
        let mut raw_iter = parsed.raw.into_iter();
        let rows: Vec<Arc<Row>> = matrix
            .into_iter()
            .map(|cells| {
                next_id += 1;
                let raw = raw_iter.next().flatten();
                Arc::new(Row::new(next_id, vec_to_cells(cells), raw, false))
            })
            .collect();
        let columns: Vec<u64> = (0..col_count)
            .map(|_| {
                next_id += 1;
                next_id
            })
            .collect();
        StandaloneParsed {
            content: Content {
                columns,
                epoch: 0,
                has_source: !text.is_empty(),
                layout: parsed.layout,
                rows: RowVec::from_vec(rows),
                suggested_header,
                unclosed_quote: parsed.unclosed_quote,
            },
            next_id,
        }
    }

    /// Install a background-parsed full model while preserving the full source
    /// snapshot (`CS-13`).
    pub fn install_parsed(&mut self, parsed: StandaloneParsed, full_text: Rc<String>) {
        self.content = parsed.content;
        self.next_id = self.next_id.max(parsed.next_id);
        self.undo.clear();
        self.redo.clear();
        self.revision += 1;
        self.serialized.replace(Some((self.revision, full_text)));
    }

    /// Override the cached canonical text for the current revision (used while a
    /// preview prefix is displayed during `CS-13` background loading so
    /// `text()` still returns the complete file verbatim).
    pub fn set_cached_text(&self, text: Rc<String>) {
        self.serialized.replace(Some((self.revision, text)));
    }

    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    pub fn content(&self) -> &Content {
        &self.content
    }

    pub fn delimiter(&self) -> Delimiter {
        self.delimiter
    }

    pub fn rows(&self) -> &RowVec {
        &self.content.rows
    }

    pub fn row_count(&self) -> usize {
        self.content.rows.len()
    }

    pub fn column_count(&self) -> usize {
        self.content.columns.len()
    }

    /// Offending 0-based row index when the CSV contains an unclosed quote (`CS-05`).
    pub fn has_unclosed_quote(&self) -> Option<usize> {
        self.content.unclosed_quote
    }

    /// Whether structured edits are permitted (`false` when an unclosed quote is present, `CS-05`).
    pub fn input_enabled(&self) -> bool {
        self.input_gate && self.content.unclosed_quote.is_none()
    }

    pub fn set_input_enabled(&mut self, enabled: bool) {
        self.input_gate = enabled;
    }

    pub fn undo_len(&self) -> usize {
        self.undo.len()
    }

    pub fn redo_len(&self) -> usize {
        self.redo.len()
    }

    /// Lookup row index by stable `Row.id` (`CS-10`).
    pub fn row_index_by_id(&self, id: u64) -> Option<usize> {
        self.content.rows.iter().position(|r| r.id == id)
    }

    /// Lookup column index by stable column `u64` ID (`CS-10`).
    pub fn column_index_by_id(&self, id: u64) -> Option<usize> {
        self.content.columns.iter().position(|&c| c == id)
    }

    /// The canonical file text (`readSnapshot`), preserving untouched raw records (`CS-04`).
    pub fn text(&self) -> Rc<String> {
        if let Some((revision, text)) = &*self.serialized.borrow()
            && *revision == self.revision
        {
            return text.clone();
        }
        let total = self.content.rows.len();
        let records = self.content.rows.iter().map(|r| RecordOut {
            cells: r.cells.iter().map(Arc::as_ref),
            len: r.cells.len(),
            raw: r.raw.as_deref(),
            canonical: r.canonical,
        });
        let text = Rc::new(document::stringify_records(
            records,
            total,
            self.delimiter,
            self.content.layout,
            true,
        ));
        self.serialized.replace(Some((self.revision, text.clone())));
        text
    }

    /// Serialize with an uncommitted active-cell draft overlaid (`CS-03`).
    pub fn text_with_draft(&self, draft: Option<(usize, usize, &str)>) -> String {
        let Some((d_row, d_col, d_val)) = draft else {
            return (*self.text()).clone();
        };
        let Some(existing) = self.content.rows.get(d_row) else {
            return (*self.text()).clone();
        };
        if existing.cell_or_empty(d_col) == d_val {
            return (*self.text()).clone();
        }
        let cols = self.column_count();
        let mut overridden: Vec<&str> = (0..cols).map(|c| existing.cell_or_empty(c)).collect();
        if d_col < overridden.len() {
            overridden[d_col] = d_val;
        }
        let total = self.content.rows.len();
        let records = self.content.rows.iter().enumerate().map(|(idx, r)| {
            let cells: Box<dyn Iterator<Item = &str>> = if idx == d_row {
                Box::new(overridden.iter().copied())
            } else {
                Box::new(r.cells.iter().map(Arc::as_ref))
            };
            RecordOut {
                cells,
                len: if idx == d_row {
                    overridden.len()
                } else {
                    r.cells.len()
                },
                raw: if idx == d_row { None } else { r.raw.as_deref() },
                canonical: r.canonical,
            }
        });
        document::stringify_records(records, total, self.delimiter, self.content.layout, true)
    }

    /// Reconcile new source text (from Source mode return or external storage reload)
    /// by record-level diff: preserves unchanged row/column IDs and records the
    /// delta as a single undoable step (`CS-10`).
    pub fn adopt_text(&mut self, text: &str) -> bool {
        let parsed = document::parse(text, self.delimiter);
        let matrix = document::normalize(parsed.rows);
        let suggested_header = document::infer_header(&matrix);
        let outcome = diff::reconcile(
            &self.content.rows,
            &self.content.columns,
            matrix,
            parsed.raw,
            &mut self.next_id,
        );
        let meta_changed = self.content.layout != parsed.layout
            || self.content.unclosed_quote != parsed.unclosed_quote
            || self.content.has_source != !text.is_empty();
        if !outcome.changed && !meta_changed {
            self.serialized
                .replace(Some((self.revision, Rc::new(text.to_owned()))));
            return false;
        }
        let next = Content {
            columns: outcome.columns,
            epoch: self.content.epoch,
            has_source: !text.is_empty(),
            layout: parsed.layout,
            rows: outcome.rows,
            suggested_header,
            unclosed_quote: parsed.unclosed_quote,
        };
        self.commit(next, outcome.delta_bytes.max(64), true);
        self.serialized
            .replace(Some((self.revision, Rc::new(text.to_owned()))));
        true
    }

    /// Compatibility alias delegating to [`Self::adopt_text`] (`CS-10`).
    pub fn replace_content(&mut self, text: &str) {
        self.adopt_text(text);
    }

    pub fn set_cell(&mut self, row: usize, column: usize, value: &str) -> bool {
        if !self.input_enabled() || column >= self.content.columns.len() {
            return false;
        }
        let Some(current) = self.content.rows.get_arc(row) else {
            return false;
        };
        if current.cell_or_empty(column) == value {
            return false;
        }
        let old_cell_bytes = cell_bytes(current.cell_or_empty(column));
        let mut cells = (*current.cells).clone();
        if cells.len() < self.content.columns.len() {
            cells.resize(self.content.columns.len(), empty_cell());
        }
        cells[column] = if value.is_empty() {
            empty_cell()
        } else {
            Arc::from(value)
        };
        let new_row = Arc::new(Row::new(
            current.id,
            Arc::new(cells),
            None,
            current.canonical,
        ));
        let next_rows = self.content.rows.set(row, new_row);
        let delta = 64
            + self.content.columns.len() * std::mem::size_of::<Arc<str>>()
            + old_cell_bytes
            + cell_bytes(value)
            + next_rows.spine_delta_bytes();
        let content = Content {
            has_source: true,
            rows: next_rows,
            ..self.content.clone()
        };
        self.commit(content, delta, true);
        true
    }

    /// `applyStructureOperation`: operates directly on `RowVec` without
    /// materialising or comparing a full string matrix (`CS-01`).
    pub fn apply(&mut self, header: bool, op: Operation, row: usize, column: usize) -> Change {
        if !self.input_enabled() {
            return Change {
                changed: false,
                focus: None,
            };
        }
        let rows_len = self.content.rows.len();
        let columns = self.content.columns.len().max(1);
        if rows_len == 0 {
            return Change {
                changed: false,
                focus: None,
            };
        }
        let first = usize::from(header);
        let data_count = rows_len.saturating_sub(first);
        let movable = row >= first && row < rows_len;
        let r = row.clamp(first, first.max(rows_len - 1));
        let c = column.min(columns - 1);
        let default_focus = Focus {
            row: r.min(rows_len - 1),
            column: c,
        };

        let (next_rows, next_columns, focus, delta) = match op {
            Operation::InsertRowAbove => {
                if data_count >= MAX_DATA_ROWS {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let at = r.clamp(first, rows_len);
                let id = self.id();
                let inserted = Arc::new(Row::new(id, empty_cells(columns), None, true));
                let next_rows = self.content.rows.insert(at, inserted);
                let delta =
                    64 + columns * std::mem::size_of::<Arc<str>>() + next_rows.spine_delta_bytes();
                (
                    next_rows,
                    self.content.columns.clone(),
                    Focus { row: at, column: 0 },
                    delta,
                )
            }
            Operation::InsertRowBelow => {
                if data_count >= MAX_DATA_ROWS {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let at = (r + 1).clamp(first, rows_len);
                let id = self.id();
                let inserted = Arc::new(Row::new(id, empty_cells(columns), None, true));
                let next_rows = self.content.rows.insert(at, inserted);
                let delta =
                    64 + columns * std::mem::size_of::<Arc<str>>() + next_rows.spine_delta_bytes();
                (
                    next_rows,
                    self.content.columns.clone(),
                    Focus { row: at, column: 0 },
                    delta,
                )
            }
            Operation::DuplicateRow => {
                if !movable || r >= rows_len || data_count >= MAX_DATA_ROWS {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let src = Arc::clone(self.content.rows.get_arc(r).unwrap());
                let id = self.id();
                // Shares the exact `Arc<Vec<Arc<str>>>` cell vector — zero cell copies!
                let copy = Arc::new(Row::new(id, Arc::clone(&src.cells), None, true));
                let next_rows = self.content.rows.insert(r + 1, copy);
                let delta = 64 + next_rows.spine_delta_bytes();
                (
                    next_rows,
                    self.content.columns.clone(),
                    Focus {
                        row: r + 1,
                        column: 0,
                    },
                    delta,
                )
            }
            Operation::MoveRowUp => {
                if !movable || r <= first || r >= rows_len {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let next_rows = self.content.rows.move_row(r, r - 1);
                let delta = next_rows.spine_delta_bytes() * 2;
                (
                    next_rows,
                    self.content.columns.clone(),
                    Focus {
                        row: r - 1,
                        column: c,
                    },
                    delta,
                )
            }
            Operation::MoveRowDown => {
                if !movable || r + 1 >= rows_len {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let next_rows = self.content.rows.move_row(r, r + 1);
                let delta = next_rows.spine_delta_bytes() * 2;
                (
                    next_rows,
                    self.content.columns.clone(),
                    Focus {
                        row: r + 1,
                        column: c,
                    },
                    delta,
                )
            }
            Operation::MoveRowTo(target) => {
                let target = target.clamp(first, first.max(rows_len - 1));
                if !movable || r >= rows_len || r == target {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let next_rows = self.content.rows.move_row(r, target);
                let delta = next_rows.spine_delta_bytes() * 2;
                (
                    next_rows,
                    self.content.columns.clone(),
                    Focus {
                        row: target,
                        column: c,
                    },
                    delta,
                )
            }
            Operation::DeleteRow => {
                if !movable || r >= rows_len {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                if header || rows_len > 1 {
                    let (next_rows, removed) = self.content.rows.remove(r);
                    let next_r = if next_rows.len() > first {
                        r.min(next_rows.len() - 1).max(first)
                    } else {
                        next_rows.len().saturating_sub(1)
                    };
                    let delta = row_full_bytes(&removed) + next_rows.spine_delta_bytes();
                    (
                        next_rows,
                        self.content.columns.clone(),
                        Focus {
                            row: next_r,
                            column: c,
                        },
                        delta,
                    )
                } else {
                    let only = self.content.rows.get_arc(0).unwrap();
                    if only.cells.iter().all(|s| s.is_empty()) {
                        return Change {
                            changed: false,
                            focus: Some(Focus { row: 0, column: c }),
                        };
                    }
                    let cleared = Arc::new(Row::new(only.id, empty_cells(columns), None, false));
                    let delta = row_full_bytes(only) + 64;
                    let next_rows = self.content.rows.set(0, cleared);
                    (
                        next_rows,
                        self.content.columns.clone(),
                        Focus { row: 0, column: c },
                        delta,
                    )
                }
            }
            Operation::InsertColumnLeft | Operation::InsertColumnRight => {
                if columns >= MAX_COLUMNS {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let at = if op == Operation::InsertColumnLeft {
                    c
                } else {
                    c + 1
                };
                let mut col_ids = self.content.columns.clone();
                col_ids.insert(at.min(col_ids.len()), self.id());
                let empty = empty_cell();
                let updated: Vec<Arc<Row>> = self
                    .content
                    .rows
                    .iter()
                    .map(|row| {
                        let mut cells = (*row.cells).clone();
                        if cells.len() < columns {
                            cells.resize(columns, empty.clone());
                        }
                        cells.insert(at, empty.clone());
                        Arc::new(Row::new(row.id, Arc::new(cells), None, row.canonical))
                    })
                    .collect();
                let next_rows = RowVec::from_vec(updated);
                let delta = rows_len * (64 + (columns + 1) * std::mem::size_of::<Arc<str>>())
                    + next_rows.spine_delta_bytes();
                (
                    next_rows,
                    col_ids,
                    Focus {
                        row: r.min(rows_len - 1),
                        column: at,
                    },
                    delta,
                )
            }
            Operation::MoveColumnLeft | Operation::MoveColumnRight | Operation::MoveColumnTo(_) => {
                let target = match op {
                    Operation::MoveColumnLeft if c > 0 => c - 1,
                    Operation::MoveColumnRight if c + 1 < columns => c + 1,
                    Operation::MoveColumnTo(t) => t.min(columns - 1),
                    _ => c,
                };
                if target == c {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let mut col_ids = self.content.columns.clone();
                move_item(&mut col_ids, c, target);
                let empty = empty_cell();
                let updated: Vec<Arc<Row>> = self
                    .content
                    .rows
                    .iter()
                    .map(|row| {
                        let mut cells = (*row.cells).clone();
                        if cells.len() < columns {
                            cells.resize(columns, empty.clone());
                        }
                        if matches!(op, Operation::MoveColumnLeft | Operation::MoveColumnRight) {
                            cells.swap(c, target);
                        } else {
                            move_item(&mut cells, c, target);
                        }
                        Arc::new(Row::new(row.id, Arc::new(cells), None, row.canonical))
                    })
                    .collect();
                let next_rows = RowVec::from_vec(updated);
                let delta = rows_len * (64 + columns * std::mem::size_of::<Arc<str>>())
                    + next_rows.spine_delta_bytes();
                (
                    next_rows,
                    col_ids,
                    Focus {
                        row: r.min(rows_len - 1),
                        column: target,
                    },
                    delta,
                )
            }
            Operation::DeleteColumn => {
                if columns <= 1 {
                    return Change {
                        changed: false,
                        focus: Some(default_focus),
                    };
                }
                let mut col_ids = self.content.columns.clone();
                col_ids.remove(c);
                let empty = empty_cell();
                let mut dropped_bytes = 0usize;
                let updated: Vec<Arc<Row>> = self
                    .content
                    .rows
                    .iter()
                    .map(|row| {
                        let mut cells = (*row.cells).clone();
                        if cells.len() < columns {
                            cells.resize(columns, empty.clone());
                        }
                        let removed = cells.remove(c);
                        dropped_bytes += cell_bytes(&removed);
                        Arc::new(Row::new(row.id, Arc::new(cells), None, row.canonical))
                    })
                    .collect();
                let next_rows = RowVec::from_vec(updated);
                let delta = dropped_bytes
                    + rows_len * (64 + (columns - 1) * std::mem::size_of::<Arc<str>>())
                    + next_rows.spine_delta_bytes();
                (
                    next_rows,
                    col_ids,
                    Focus {
                        row: r.min(rows_len - 1),
                        column: c.min(columns - 2),
                    },
                    delta,
                )
            }
            Operation::ExpandToShape {
                data_rows,
                columns: target_columns,
            } => {
                let header_rows = usize::from(header);
                let current_data = rows_len.saturating_sub(header_rows);
                let target_data = current_data.max(data_rows.min(MAX_DATA_ROWS));
                let target_columns = columns.max(target_columns.clamp(1, MAX_COLUMNS));
                let target_rows = (target_data + header_rows).max(1);
                let first_focusable = header_rows.min(target_rows - 1);
                let focus = Focus {
                    row: if target_rows > rows_len {
                        rows_len
                    } else {
                        r.clamp(first_focusable, target_rows - 1)
                    },
                    column: if target_columns > columns { columns } else { c },
                };
                if target_rows == rows_len && target_columns == columns {
                    return Change {
                        changed: false,
                        focus: Some(focus),
                    };
                }
                let mut col_ids = self.content.columns.clone();
                while col_ids.len() < target_columns {
                    col_ids.push(self.id());
                }
                let added_rows = target_rows.saturating_sub(rows_len);
                let (next_rows, delta) = if target_columns == columns && added_rows <= 16 {
                    // Pure row appends keep all existing rows and subtrees untouched!
                    let mut tree = self.content.rows.clone();
                    let template = empty_cells(target_columns);
                    for _ in 0..added_rows {
                        let id = self.id();
                        tree = tree.insert(
                            tree.len(),
                            Arc::new(Row::new(id, Arc::clone(&template), None, true)),
                        );
                    }
                    let d = added_rows * (64 + target_columns * std::mem::size_of::<Arc<str>>())
                        + added_rows * tree.spine_delta_bytes();
                    (tree, d)
                } else {
                    let empty = empty_cell();
                    let mut list: Vec<Arc<Row>> = Vec::with_capacity(target_rows);
                    for row in self.content.rows.iter() {
                        if target_columns > columns {
                            let mut cells = (*row.cells).clone();
                            cells.resize(target_columns, empty.clone());
                            list.push(Arc::new(Row::new(
                                row.id,
                                Arc::new(cells),
                                None,
                                row.canonical,
                            )));
                        } else {
                            list.push(Arc::clone(row));
                        }
                    }
                    let template = empty_cells(target_columns);
                    while list.len() < target_rows {
                        let id = self.id();
                        list.push(Arc::new(Row::new(id, Arc::clone(&template), None, true)));
                    }
                    let tree = RowVec::from_vec(list);
                    let touched = if target_columns > columns {
                        target_rows
                    } else {
                        added_rows
                    };
                    let d = touched * (64 + target_columns * std::mem::size_of::<Arc<str>>())
                        + tree.spine_delta_bytes();
                    (tree, d)
                };
                (next_rows, col_ids, focus, delta)
            }
            Operation::SetColumnAlignment(_) | Operation::DeleteTable => {
                return Change {
                    changed: false,
                    focus: Some(default_focus),
                };
            }
        };

        let content = Content {
            columns: next_columns,
            has_source: true,
            rows: next_rows,
            ..self.content.clone()
        };
        self.commit(content, delta, true);
        Change {
            changed: true,
            focus: Some(focus),
        }
    }

    /// Append a single recovery row carrying an uncommitted cell draft when an
    /// external reload deleted the edited row (`DP-04`), recorded as one step.
    pub fn append_recovery_row(&mut self, column: usize, value: &str) -> bool {
        if !self.input_enabled() || value.is_empty() {
            return false;
        }
        let cols = self.content.columns.len().max(1);
        let target_col = column.min(cols - 1);
        let mut cells: Vec<Arc<str>> = (0..cols).map(|_| empty_cell()).collect();
        cells[target_col] = Arc::from(value);
        let id = self.id();
        let row = Arc::new(Row::new(id, Arc::new(cells), None, true));
        let next_rows = self.content.rows.insert(self.content.rows.len(), row);
        let delta = 64
            + cols * std::mem::size_of::<Arc<str>>()
            + cell_bytes(value)
            + next_rows.spine_delta_bytes();
        let content = Content {
            has_source: true,
            rows: next_rows,
            ..self.content.clone()
        };
        self.commit(content, delta, true);
        true
    }

    /// The add-row rail (`appendRow`).
    pub fn append_row(&mut self, header: bool) -> Change {
        if !self.input_enabled() {
            return Change {
                changed: false,
                focus: None,
            };
        }
        let header_rows = usize::from(header);
        let data = self.content.rows.len().saturating_sub(header_rows);
        if !self.content.has_source && !header {
            return Change {
                changed: false,
                focus: Some(Focus { row: 0, column: 0 }),
            };
        }
        let row = header_rows.max(self.content.rows.len().saturating_sub(1));
        self.apply(
            header,
            Operation::ExpandToShape {
                data_rows: data + 1,
                columns: self.content.columns.len(),
            },
            row,
            0,
        )
    }

    /// The add-column rail (`appendColumn`).
    pub fn append_column(&mut self, header: bool) -> Change {
        if !self.input_enabled() {
            return Change {
                changed: false,
                focus: None,
            };
        }
        let row = usize::from(header).min(self.content.rows.len().saturating_sub(1));
        let data = self.content.rows.len().saturating_sub(usize::from(header));
        let columns = self.content.columns.len();
        self.apply(
            header,
            Operation::ExpandToShape {
                data_rows: data,
                columns: columns + 1,
            },
            row,
            columns.saturating_sub(1),
        )
    }

    pub fn undo(&mut self, redo: bool) -> bool {
        if !self.input_gate {
            return false;
        }
        // If the document opened with an unclosed quote and has no history, undo is off;
        // if an `adopt_text` step introduced an unclosed quote, allow undoing back to valid state!
        if self.content.unclosed_quote.is_some() && (redo || self.undo.is_empty()) {
            return false;
        }
        let Some(target) = (if redo {
            self.redo.pop()
        } else {
            self.undo.pop()
        }) else {
            return false;
        };
        let reverse = HistoryEntry {
            content: std::mem::replace(&mut self.content, target.content),
            delta_bytes: target.delta_bytes,
        };
        if redo {
            self.undo.push(reverse);
        } else {
            self.redo.push(reverse);
        }
        self.trim_history();
        self.revision += 1;
        true
    }

    fn commit(&mut self, content: Content, delta_bytes: usize, record: bool) {
        if record {
            self.undo.push(HistoryEntry {
                content: std::mem::replace(&mut self.content, content),
                delta_bytes,
            });
            self.redo.clear();
        } else {
            self.content = content;
        }
        self.trim_history();
        self.revision += 1;
    }

    /// Incremental byte budget (`CS-02`): retains up to `200` steps per stack
    /// and `8 MiB` combined incremental bytes. If a single newest step itself
    /// exceeds `8 MiB`, older history is trimmed while that step is retained.
    fn trim_history(&mut self) {
        let mut bytes = 0usize;
        let mut any_kept = false;
        for stack in [&mut self.undo, &mut self.redo] {
            let mut retained = 0usize;
            for entry in stack.iter().rev() {
                if retained >= HISTORY_ENTRIES {
                    break;
                }
                let s = entry.delta_bytes;
                if bytes + s > HISTORY_BYTES && any_kept {
                    break;
                }
                bytes += s;
                retained += 1;
                any_kept = true;
            }
            let drop = stack.len() - retained;
            stack.drain(..drop);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_share_history_and_serialize_canonically() {
        let mut m = CsvModel::new("a,b\n1,2\n", Delimiter::Comma);
        assert!(m.content().suggested_header);
        assert!(m.set_cell(1, 1, "x, y"));
        assert_eq!(*m.text(), "a,b\n1,\"x, y\"\n");
        let first = m.rows()[1].id;
        let c = m.apply(true, Operation::InsertRowAbove, 1, 0);
        assert_eq!(c.focus, Some(Focus { row: 1, column: 0 }));
        assert_eq!(m.rows()[2].id, first, "row identities follow their rows");
        assert!(m.append_column(true).changed);
        assert_eq!(m.column_count(), 3);
        assert!(m.undo(false) && m.undo(false) && m.undo(false));
        assert_eq!(*m.text(), "a,b\n1,2\n");
        assert!(m.undo(true));
        assert_eq!(*m.text(), "a,b\n1,\"x, y\"\n");
    }

    /// `CS-01` & `CS-02`: 200 single-cell edits on a `10,000 × 20` table share
    /// untouched rows/cells and retain all 200 undo steps within the 8 MiB budget.
    #[test]
    fn large_table_10000x20_retains_all_200_incremental_undo_steps() {
        let mut text = String::with_capacity(2_000_000);
        for c in 0..20 {
            if c > 0 {
                text.push(',');
            }
            text.push_str(&format!("col_{c:02}"));
        }
        text.push('\n');
        for r in 0..10_000 {
            for c in 0..20 {
                if c > 0 {
                    text.push(',');
                }
                text.push_str(&format!("v{r:04}_{c:02}"));
            }
            text.push('\n');
        }
        let mut m = CsvModel::new(&text, Delimiter::Comma);
        assert_eq!((m.row_count(), m.column_count()), (10_001, 20));
        let untouched_row_before = Arc::clone(m.rows().get_arc(5_000).unwrap());
        let untouched_cell_in_edited_row = Arc::clone(&m.rows()[1].cells[19]);

        for step in 0..200usize {
            let row = 1 + (step * 47) % 9_999;
            // Skip row 5_000 so we can assert zero-copy pointer identity on it!
            let row = if row == 5_000 { 5_001 } else { row };
            let col = step % 18;
            assert!(m.set_cell(row, col, &format!("edited_{step}")));
        }

        // Untouched row and untouched cell inside an edited row keep exact Arc allocations!
        assert!(Arc::ptr_eq(
            &untouched_row_before,
            m.rows().get_arc(5_000).unwrap()
        ));
        assert!(Arc::ptr_eq(
            &untouched_cell_in_edited_row,
            &m.rows()[1].cells[19]
        ));

        // All 200 undo steps MUST be retained!
        assert_eq!(m.undo_len(), 200);
        let mut undone = 0;
        while m.undo(false) {
            undone += 1;
        }
        assert_eq!(undone, 200);
        assert_eq!(*m.text(), text);
    }

    /// `CS-02` edge case: a single edit exceeding 8 MiB trims older history
    /// while retaining that single step itself.
    #[test]
    fn single_step_exceeding_budget_trims_prior_steps_and_keeps_itself() {
        let mut m = CsvModel::new("a,b\n1,2\n", Delimiter::Comma);
        assert!(m.set_cell(1, 0, "first"));
        assert!(m.set_cell(1, 1, "second"));
        assert_eq!(m.undo_len(), 2);

        // ~4.5M ASCII chars * 2 > 8 MiB in `cell_bytes`.
        let huge = "x".repeat(4_500_000);
        assert!(m.set_cell(1, 0, &huge));
        assert_eq!(m.undo_len(), 1, "older steps trimmed, huge step kept");
        assert!(m.undo(false));
        assert_eq!(m.rows()[1].cell_or_empty(0), "first");
        assert_eq!(m.redo_len(), 1, "huge step stays redoable too");
        assert!(m.undo(true));
        assert_eq!(m.rows()[1].cell_or_empty(0).len(), 4_500_000);
    }

    /// `CS-05`: unclosed quote disables model edits and never auto-closes on save.
    #[test]
    fn unclosed_quote_locks_model_and_preserves_raw_bytes() {
        let raw = "id,name\n1,\"alice\n2,bob\n";
        let mut m = CsvModel::new(raw, Delimiter::Comma);
        assert_eq!(m.has_unclosed_quote(), Some(1));
        assert!(!m.input_enabled());
        assert!(!m.set_cell(0, 0, "changed"));
        assert!(!m.apply(true, Operation::InsertRowBelow, 0, 0).changed);
        assert_eq!(*m.text(), raw);
    }

    /// `CS-10`: `adopt_text` preserves unchanged row/column IDs and pushes an
    /// undoable step instead of wiping history.
    #[test]
    fn adopt_text_preserves_identities_and_undo_stack() {
        let mut m = CsvModel::new("id,name\n1,alice\n2,bob\n", Delimiter::Comma);
        let orig_col_ids = m.content().columns.clone();
        let row0_id = m.rows()[0].id;
        let row1_id = m.rows()[1].id;
        let row2_id = m.rows()[2].id;

        // First make a table edit so undo stack is non-empty.
        assert!(m.set_cell(1, 1, "alicia"));
        assert_eq!(m.undo_len(), 1);

        // External / Source-mode text edits row 1 and inserts a row before `2,bob`.
        assert!(m.adopt_text("id,name\n1,alicia_v2\n9,inserted\n2,bob\n"));
        assert_eq!(m.undo_len(), 2, "history preserved + 1 step added");
        assert_eq!(m.content().columns, orig_col_ids);
        assert_eq!(m.rows()[0].id, row0_id);
        assert_eq!(m.rows()[1].id, row1_id);
        assert_eq!(m.rows()[3].id, row2_id, "unchanged row `2,bob` kept its ID");
        assert_ne!(m.rows()[2].id, row2_id);

        // Undo 1: undoes the external/source adopt!
        assert!(m.undo(false));
        assert_eq!(*m.text(), "id,name\n1,alicia\n2,bob\n");
        // Undo 2: undoes the earlier table cell edit!
        assert!(m.undo(false));
        assert_eq!(*m.text(), "id,name\n1,alice\n2,bob\n");
    }
}

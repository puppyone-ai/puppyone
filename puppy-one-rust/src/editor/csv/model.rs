//! The canonical structured CSV model (viewers/csv/CsvDocumentModel.ts):
//! rows and columns with stable identities, its own undo history and a
//! serialized snapshot produced only on demand. Column geometry lives in
//! `layout.rs`, outside this history.
use super::{
    document::{self, Delimiter, Layout},
    operations::{self, Focus, Operation},
};
use std::rc::Rc;

/// `DOCUMENT_HISTORY_POLICY`.
const HISTORY_ENTRIES: usize = 200;
const HISTORY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub id: u64,
    pub cells: Rc<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Content {
    pub columns: Vec<u64>,
    /// Bumped by external source replacement.
    pub epoch: u64,
    pub has_source: bool,
    pub layout: Layout,
    pub rows: Rc<Vec<Row>>,
    pub suggested_header: bool,
    pub unclosed_quote: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Change {
    pub changed: bool,
    pub focus: Option<Focus>,
}

pub struct CsvModel {
    delimiter: Delimiter,
    content: Content,
    revision: u64,
    undo: Vec<Content>,
    redo: Vec<Content>,
    next_id: u64,
    pub input_enabled: bool,
    serialized: std::cell::RefCell<Option<(u64, Rc<String>)>>,
}

fn size(rows: &[Row]) -> usize {
    rows.iter()
        .map(|r| 64 + r.cells.iter().map(|c| 16 + c.len() * 2).sum::<usize>())
        .sum()
}

impl CsvModel {
    pub fn new(text: &str, delimiter: Delimiter) -> Self {
        let mut model = Self {
            delimiter,
            content: Content::empty(),
            revision: 1,
            undo: Vec::new(),
            redo: Vec::new(),
            next_id: 0,
            input_enabled: true,
            serialized: Default::default(),
        };
        model.content = model.parse(text, 0);
        model
            .serialized
            .replace(Some((model.revision, Rc::new(text.to_owned()))));
        model
    }

    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    fn parse(&mut self, text: &str, epoch: u64) -> Content {
        let parsed = document::parse(text, self.delimiter);
        let matrix = document::normalize(parsed.rows);
        let columns = matrix.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let suggested_header = document::infer_header(&matrix);
        let rows = matrix
            .into_iter()
            .map(|cells| Row {
                id: self.id(),
                cells: Rc::new(cells),
            })
            .collect();
        let columns = (0..columns).map(|_| self.id()).collect();
        Content {
            columns,
            epoch,
            has_source: !text.is_empty(),
            layout: parsed.layout,
            rows: Rc::new(rows),
            suggested_header,
            unclosed_quote: parsed.unclosed_quote,
        }
    }

    pub fn content(&self) -> &Content {
        &self.content
    }
    pub fn delimiter(&self) -> Delimiter {
        self.delimiter
    }
    pub fn rows(&self) -> &[Row] {
        &self.content.rows
    }
    pub fn column_count(&self) -> usize {
        self.content.columns.len()
    }

    /// The canonical file text (`readSnapshot`).
    pub fn text(&self) -> Rc<String> {
        if let Some((revision, text)) = &*self.serialized.borrow()
            && *revision == self.revision
        {
            return text.clone();
        }
        let rows: Vec<Vec<String>> = self
            .content
            .rows
            .iter()
            .map(|r| (*r.cells).clone())
            .collect();
        let text = Rc::new(document::stringify(
            &rows,
            self.delimiter,
            self.content.layout,
            true,
        ));
        self.serialized.replace(Some((self.revision, text.clone())));
        text
    }

    /// External source replacement (`replaceContent`): clears history.
    pub fn replace_content(&mut self, text: &str) {
        let content = self.parse(text, self.content.epoch + 1);
        self.undo.clear();
        self.redo.clear();
        self.commit(content, false);
        self.serialized
            .replace(Some((self.revision, Rc::new(text.to_owned()))));
    }

    pub fn set_cell(&mut self, row: usize, column: usize, value: &str) -> bool {
        if !self.input_enabled || column >= self.content.columns.len() {
            return false;
        }
        let Some(current) = self.content.rows.get(row) else {
            return false;
        };
        if current.cells.get(column).map(String::as_str) == Some(value) {
            return false;
        }
        let mut cells = (*current.cells).clone();
        cells.resize(self.content.columns.len(), String::new());
        cells[column] = value.to_owned();
        let mut rows = (*self.content.rows).clone();
        rows[row] = Row {
            id: current.id,
            cells: Rc::new(cells),
        };
        let content = Content {
            has_source: true,
            rows: Rc::new(rows),
            ..self.content.clone()
        };
        self.commit(content, true);
        true
    }

    /// `applyStructureOperation`: identities follow moved rows / columns.
    pub fn apply(&mut self, header: bool, op: Operation, row: usize, column: usize) -> Change {
        if !self.input_enabled {
            return Change {
                changed: false,
                focus: None,
            };
        }
        let matrix: Vec<Vec<String>> = self
            .content
            .rows
            .iter()
            .map(|r| (*r.cells).clone())
            .collect();
        let (next, focus) = operations::apply(&matrix, header, op, row, column);
        if next == matrix {
            return Change {
                changed: false,
                focus: Some(focus),
            };
        }
        let first = usize::from(header);
        let mut row_ids: Vec<u64> = self.content.rows.iter().map(|r| r.id).collect();
        let source_row = row.clamp(first, first.max(row_ids.len().saturating_sub(1)));
        match op {
            Operation::InsertRowAbove | Operation::InsertRowBelow | Operation::DuplicateRow => {
                let id = self.id();
                row_ids.insert(focus.row.min(row_ids.len()), id);
            }
            Operation::MoveRowUp | Operation::MoveRowDown | Operation::MoveRowTo(_) => {
                if source_row < row_ids.len() && source_row != focus.row {
                    let id = row_ids.remove(source_row);
                    row_ids.insert(focus.row.min(row_ids.len()), id);
                }
            }
            Operation::DeleteRow if next.len() < row_ids.len() => {
                row_ids.remove(source_row);
            }
            _ => {}
        }
        while row_ids.len() < next.len() {
            let id = self.id();
            row_ids.push(id);
        }
        row_ids.truncate(next.len());
        let column_count = next.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let mut column_ids = self.content.columns.clone();
        let source_column = column.min(column_ids.len().saturating_sub(1));
        match op {
            Operation::InsertColumnLeft | Operation::InsertColumnRight => {
                let id = self.id();
                column_ids.insert(focus.column.min(column_ids.len()), id);
            }
            Operation::MoveColumnLeft | Operation::MoveColumnRight | Operation::MoveColumnTo(_) => {
                if source_column != focus.column {
                    let id = column_ids.remove(source_column);
                    column_ids.insert(focus.column.min(column_ids.len()), id);
                }
            }
            Operation::DeleteColumn if column_count < column_ids.len() => {
                column_ids.remove(source_column);
            }
            _ => {}
        }
        while column_ids.len() < column_count {
            let id = self.id();
            column_ids.push(id);
        }
        column_ids.truncate(column_count);
        let previous: std::collections::HashMap<u64, &Row> =
            self.content.rows.iter().map(|r| (r.id, r)).collect();
        let rows: Vec<Row> = next
            .into_iter()
            .zip(row_ids)
            .map(|(cells, id)| match previous.get(&id) {
                Some(p) if *p.cells == cells => (*p).clone(),
                _ => Row {
                    id,
                    cells: Rc::new(cells),
                },
            })
            .collect();
        let content = Content {
            columns: column_ids,
            has_source: true,
            rows: Rc::new(rows),
            ..self.content.clone()
        };
        self.commit(content, true);
        Change {
            changed: true,
            focus: Some(focus),
        }
    }

    /// The add-row rail (`appendRow`).
    pub fn append_row(&mut self, header: bool) -> Change {
        let header_rows = usize::from(header);
        let data = self.content.rows.len().saturating_sub(header_rows);
        if !self.content.has_source && !header {
            return Change {
                changed: false,
                focus: Some(Focus { row: 0, column: 0 }),
            };
        }
        let row = header_rows.max(self.content.rows.len() - 1);
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
        let row = usize::from(header).min(self.content.rows.len() - 1);
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
        if !self.input_enabled {
            return false;
        }
        let Some(target) = (if redo {
            self.redo.pop()
        } else {
            self.undo.pop()
        }) else {
            return false;
        };
        let current = self.content.clone();
        if redo {
            self.undo.push(current)
        } else {
            self.redo.push(current)
        }
        self.commit(target, false);
        true
    }

    fn commit(&mut self, content: Content, record: bool) {
        if record {
            self.undo
                .push(std::mem::replace(&mut self.content, content));
            self.redo.clear();
        } else {
            self.content = content;
        }
        self.trim_history();
        self.revision += 1;
    }

    fn trim_history(&mut self) {
        let mut bytes = 0;
        for stack in [&mut self.undo, &mut self.redo] {
            let mut retained = 0;
            for entry in stack.iter().rev() {
                let s = size(&entry.rows);
                if retained >= HISTORY_ENTRIES || bytes + s > HISTORY_BYTES {
                    break;
                }
                bytes += s;
                retained += 1;
            }
            let drop = stack.len() - retained;
            stack.drain(..drop);
        }
    }
}

impl Content {
    fn empty() -> Self {
        Self {
            columns: vec![0],
            epoch: 0,
            has_source: false,
            layout: Layout::default(),
            rows: Rc::new(Vec::new()),
            suggested_header: false,
            unclosed_quote: false,
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
}

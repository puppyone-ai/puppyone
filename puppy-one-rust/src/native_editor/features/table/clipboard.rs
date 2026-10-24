//! Bounded TSV paste into the existing document table.
use super::commands::{MAX_COLUMNS, MAX_PASTE_BYTES, MAX_ROWS};
use crate::native_editor::core::{
    document::{Block, Document, Kind},
    text::Text,
};
impl Document {
    pub fn paste_table(&mut self, key: (usize, usize), tsv: &str) -> bool {
        let Some(Block {
            kind: Kind::Table { rows, align },
            ..
        }) = self.blocks.get_mut(key.0)
        else {
            return false;
        };
        let cols = align.len();
        let (r, c) = (key.1 / cols, key.1 % cols);
        let data: Vec<Vec<_>> = tsv
            .trim_end_matches(['\r', '\n'])
            .split('\n')
            .map(|l| l.trim_end_matches('\r').split('\t').collect())
            .collect();
        let width = data.iter().map(Vec::len).max().unwrap_or(0);
        if r + data.len() > MAX_ROWS || c + width > MAX_COLUMNS || tsv.len() > MAX_PASTE_BYTES {
            return false;
        }
        let new_cols = cols.max(c + width);
        align.resize(new_cols, "---".into());
        rows.resize_with(rows.len().max(r + data.len()), || {
            vec![Text::default(); new_cols]
        });
        for row in rows.iter_mut() {
            row.resize(new_cols, Text::default());
        }
        for (dr, row) in data.iter().enumerate() {
            for (dc, cell) in row.iter().enumerate() {
                rows[r + dr][c + dc] = Text::plain(*cell);
            }
        }
        true
    }
}

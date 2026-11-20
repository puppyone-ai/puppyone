//! View-only column geometry (viewers/csv/CsvColumnLayoutModel.ts): widths
//! follow column identities through structural edits and stay out of the
//! document history; cell edits never resize the table.
use super::model::CsvModel;
use crate::editor::table::{self, COLUMN_INITIAL_MAX_WIDTH, COLUMN_RESIZE_MAX_WIDTH};

/// `CSV_COLUMN_MAX_WIDTH`: the resize ceiling.
pub const MAX_WIDTH: f32 = COLUMN_RESIZE_MAX_WIDTH;
use std::collections::HashMap;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ColumnLayout {
    column_ids: Vec<u64>,
    epoch: u64,
    known: HashMap<u64, f32>,
    pub widths: Vec<f32>,
}

fn estimate(model: &CsvModel) -> Vec<f32> {
    let rows = model.rows();
    table::estimate_widths_by_index(rows.len(), model.column_count(), |r, c| {
        rows.get(r).and_then(|row| row.cell(c))
    })
    .into_iter()
    .map(|w| w.min(COLUMN_INITIAL_MAX_WIDTH))
    .collect()
}

impl ColumnLayout {
    pub fn new(model: &CsvModel, restored: Option<&[f32]>) -> Self {
        let ids = model.content().columns.clone();
        let widths = match restored {
            Some(w) if w.len() == ids.len() && w.iter().all(|v| v.is_finite() && *v > 0.) => w
                .iter()
                .map(|v| table::clamp_width(*v, COLUMN_RESIZE_MAX_WIDTH))
                .collect(),
            _ => estimate(model),
        };
        let known = ids.iter().copied().zip(widths.iter().copied()).collect();
        Self {
            column_ids: ids,
            epoch: model.content().epoch,
            known,
            widths,
        }
    }

    /// `syncFromDocument`; returns whether widths changed (to persist).
    pub fn sync(&mut self, model: &CsvModel) -> bool {
        let content = model.content();
        if content.columns == self.column_ids && content.epoch == self.epoch {
            return false;
        }
        let estimates = estimate(model);
        let widths: Vec<f32> = if content.epoch != self.epoch {
            // External replacement: keep compatible tracks by ordinal.
            content
                .columns
                .iter()
                .enumerate()
                .map(|(i, _)| self.widths.get(i).copied().unwrap_or(estimates[i]))
                .collect()
        } else {
            content
                .columns
                .iter()
                .enumerate()
                .map(|(i, id)| self.known.get(id).copied().unwrap_or(estimates[i]))
                .collect()
        };
        for (id, w) in content.columns.iter().zip(&widths) {
            self.known.insert(*id, *w);
        }
        self.column_ids = content.columns.clone();
        self.epoch = content.epoch;
        self.widths = widths;
        true
    }

    pub fn set_width(&mut self, column: usize, width: f32) -> bool {
        let Some(&id) = self.column_ids.get(column) else {
            return false;
        };
        let w = table::clamp_width(width, COLUMN_RESIZE_MAX_WIDTH);
        if self.widths[column] == w {
            return false;
        }
        self.widths[column] = w;
        self.known.insert(id, w);
        true
    }

    /// `autoFitColumn`: the uncapped content estimate.
    pub fn auto_fit(&mut self, model: &CsvModel, column: usize) -> bool {
        let rows = model.rows();
        let w = table::estimate_widths_by_index(rows.len(), model.column_count(), |r, c| {
            rows.get(r).and_then(|row| row.cell(c))
        })
        .get(column)
        .copied();
        w.is_some_and(|w| self.set_width(column, w))
    }

    fn replace_all(&mut self, widths: Vec<f32>) -> bool {
        if widths == self.widths {
            return false;
        }
        for (id, w) in self.column_ids.iter().zip(&widths) {
            self.known.insert(*id, *w);
        }
        self.widths = widths;
        true
    }

    /// `resetColumnWidths`: back to the content estimate.
    pub fn reset(&mut self, model: &CsvModel) -> bool {
        self.replace_all(estimate(model))
    }

    /// `fitToViewport`: scale the tracks to the available width.
    pub fn fit(&mut self, available: f32) -> bool {
        if !available.is_finite() || available <= 0. {
            return false;
        }
        self.replace_all(table::fit_widths(
            &self.widths,
            available,
            COLUMN_RESIZE_MAX_WIDTH,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{csv::document::Delimiter, table::operation::Operation};

    /// `csvColumnLayoutModel.test.ts`: the view's widths catch up with the
    /// document whenever it syncs (also after columns were added while it
    /// was away, and on undo); a cell edit never resizes a column; widths
    /// follow column identities through a move, a delete and its undo;
    /// compatible stored widths are restored without entering the CSV;
    /// only initial and reset widths are capped, an explicit width is kept;
    /// fitting scales proportionally and keeps readable minimums.
    #[test]
    fn widths_follow_column_identities_and_never_follow_cell_content() {
        let mut m = CsvModel::new("Name,Score\nAda,1", Delimiter::Comma);
        let mut layout = ColumnLayout::new(&m, None);
        assert!(layout.set_width(0, 240.));
        assert!(m.append_column(true).changed);
        assert!(layout.sync(&m));
        assert_eq!(layout.widths, [240., 96., 96.]);
        assert!(m.append_column(true).changed);
        assert!(layout.sync(&m));
        assert_eq!(layout.widths, [240., 96., 96., 96.]);
        assert!(m.undo(false));
        assert!(layout.sync(&m));
        assert_eq!(layout.widths, [240., 96., 96.]);

        let mut m = CsvModel::new("Name,Score\nAda,1", Delimiter::Comma);
        let mut layout = ColumnLayout::new(&m, None);
        assert!(m.set_cell(1, 0, "Ada Lovelace with a deliberately long display value"));
        assert!(!layout.sync(&m));
        assert_eq!(layout.widths, [96., 96.]);

        let mut m = CsvModel::new("Name,Score\nAda,1", Delimiter::Comma);
        let mut layout = ColumnLayout::new(&m, None);
        layout.set_width(0, 240.);
        assert!(m.apply(true, Operation::MoveColumnRight, 1, 0).changed);
        layout.sync(&m);
        assert_eq!(layout.widths, [96., 240.]);
        assert!(m.apply(true, Operation::DeleteColumn, 1, 1).changed);
        layout.sync(&m);
        assert_eq!(layout.widths, [96.]);
        assert!(m.undo(false));
        layout.sync(&m);
        assert_eq!(layout.widths, [96., 240.]);

        let m = CsvModel::new("Name,Score\nAda,1", Delimiter::Comma);
        assert_eq!(
            ColumnLayout::new(&m, Some(&[180., 260.])).widths,
            [180., 260.]
        );
        assert_eq!(*m.text(), "Name,Score\nAda,1");

        let long = format!("Name\n{}", "x".repeat(100));
        let m = CsvModel::new(&long, Delimiter::Comma);
        assert_eq!(
            ColumnLayout::new(&m, None).widths,
            [COLUMN_INITIAL_MAX_WIDTH]
        );
        let mut restored = ColumnLayout::new(&m, Some(&[420.]));
        assert_eq!(restored.widths, [420.]);
        assert!(restored.reset(&m));
        assert_eq!(restored.widths, [COLUMN_INITIAL_MAX_WIDTH]);

        let fit = |current: &[f32], available| table::fit_widths(current, available, MAX_WIDTH);
        assert_eq!(fit(&[100., 200.], 600.), [200., 400.]);
        assert_eq!(fit(&[100., 200.], 120.), [96., 96.]);
        assert_eq!(fit(&[500., 100.], 1_400.), [560., 560.]);
    }
}

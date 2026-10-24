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
    table::estimate_widths(model.rows(), model.column_count(), |r, c| r.cells.get(c).map(String::as_str)).into_iter().map(|w| w.min(COLUMN_INITIAL_MAX_WIDTH)).collect()
}

impl ColumnLayout {
    pub fn new(model: &CsvModel, restored: Option<&[f32]>) -> Self {
        let ids = model.content().columns.clone();
        let widths = match restored {
            Some(w) if w.len() == ids.len() && w.iter().all(|v| v.is_finite() && *v > 0.) => w.iter().map(|v| table::clamp_width(*v, COLUMN_RESIZE_MAX_WIDTH)).collect(),
            _ => estimate(model),
        };
        let known = ids.iter().copied().zip(widths.iter().copied()).collect();
        Self { column_ids: ids, epoch: model.content().epoch, known, widths }
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
            content.columns.iter().enumerate().map(|(i, _)| self.widths.get(i).copied().unwrap_or(estimates[i])).collect()
        } else {
            content.columns.iter().enumerate().map(|(i, id)| self.known.get(id).copied().unwrap_or(estimates[i])).collect()
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
        let Some(&id) = self.column_ids.get(column) else { return false };
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
        let w = table::estimate_widths(model.rows(), model.column_count(), |r, c| r.cells.get(c).map(String::as_str)).get(column).copied();
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
        self.replace_all(table::fit_widths(&self.widths, available, COLUMN_RESIZE_MAX_WIDTH))
    }
}

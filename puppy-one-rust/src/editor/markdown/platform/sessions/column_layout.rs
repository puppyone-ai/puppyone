//! Per-view, `BlockId`-scoped table column layout session
//! (`platform/sessions/column_layout.rs`, TS `embeddedTableColumnLayoutSession.ts`).
//!
//! Establishes the per-block session slot in `WidgetStateStore` for Phase 2
//! (`markdown-table-column-width-sessions`).
use crate::editor::view::widget::{BlockId, WidgetStateStore};

/// Explicit per-column track widths scoped to a single table [`BlockId`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ColumnLayoutSession {
    widths: Option<Vec<f32>>,
}

impl ColumnLayoutSession {
    pub fn widths(&self, expected_columns: usize) -> Option<&[f32]> {
        self.widths
            .as_deref()
            .filter(|w| w.len() == expected_columns)
    }

    pub fn set(&mut self, widths: Vec<f32>) {
        self.widths = Some(widths);
    }

    pub fn clear(&mut self) {
        self.widths = None;
    }
}

pub fn get(
    store: &WidgetStateStore,
    block_id: BlockId,
    expected_columns: usize,
) -> Option<Vec<f32>> {
    store
        .get::<ColumnLayoutSession>(block_id)
        .and_then(|s| s.widths(expected_columns))
        .map(|s| s.to_vec())
}

pub fn set(store: &mut WidgetStateStore, block_id: BlockId, widths: Vec<f32>) {
    store
        .get_or_default::<ColumnLayoutSession>(block_id)
        .set(widths);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::anchor::Anchor;
    use core::prelude::v1::test;

    #[test]
    fn column_layout_session_tracks_explicit_widths_per_block() {
        let mut store = WidgetStateStore::default();
        let block = BlockId::new(3, Anchor::after(0, 0));
        assert_eq!(get(&store, block, 2), None);
        set(&mut store, block, vec![120.0, 240.0]);
        assert_eq!(get(&store, block, 2), Some(vec![120.0, 240.0]));
        assert_eq!(get(&store, block, 3), None);
    }
}

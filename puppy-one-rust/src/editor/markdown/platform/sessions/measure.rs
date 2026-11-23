//! Per-view, `BlockId`-scoped measured widget height session
//! (`platform/sessions/measure.rs`, TS `layoutCoordinator.ts`).
//!
//! Replaces the legacy process-global `MEASURED_HEIGHTS` thread-local so
//! measured HTML/MDX surface heights belong to the owning view and are evicted
//! automatically when blocks leave the document.
use super::BoundedMap;
use crate::editor::view::widget::{BlockId, WidgetStateStore};

/// Maximum measured surface height entries kept per block widget (`TODO-31`).
pub const MAX_MEASURED_HEIGHTS: usize = 512;

/// Measured surface heights stored inside an [`EditorView`]'s
/// [`WidgetStateStore`] under the owning block's [`BlockId`].
pub struct MeasureSession {
    heights: BoundedMap<u64, f32>,
}

impl Default for MeasureSession {
    fn default() -> Self {
        Self {
            heights: BoundedMap::new(MAX_MEASURED_HEIGHTS),
        }
    }
}

impl MeasureSession {
    pub fn get(&mut self, key: u64) -> Option<f32> {
        self.heights.get(&key)
    }

    /// Records a measured height, returning `true` when it changed by `> 0.25px`.
    pub fn record(&mut self, key: u64, height: f32) -> bool {
        let old = self.heights.insert(key, height);
        old.is_none_or(|o| (o - height).abs() > 0.25)
    }
}

/// Reads a previously measured block/panel height from `store` for `block_id`.
pub fn get(store: &mut WidgetStateStore, block_id: BlockId, key: u64) -> Option<f32> {
    store
        .get_mut::<MeasureSession>(block_id)
        .and_then(|session| session.get(key))
}

/// Records a measured height for `block_id` in `store`, returning `true` when
/// the height changed by more than `0.25px`.
pub fn record(store: &mut WidgetStateStore, block_id: BlockId, key: u64, height: f32) -> bool {
    store
        .get_or_default::<MeasureSession>(block_id)
        .record(key, height)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::anchor::Anchor;
    use core::prelude::v1::test;

    #[test]
    fn measure_session_records_threshold_and_evicts_with_block() {
        let mut store = WidgetStateStore::default();
        let block = BlockId::new(7, Anchor::after(42, 0));
        assert_eq!(get(&mut store, block, 99), None);
        assert!(record(&mut store, block, 99, 120.0));
        assert_eq!(get(&mut store, block, 99), Some(120.0));
        assert!(!record(&mut store, block, 99, 120.1));
        assert!(record(&mut store, block, 99, 121.0));
        store.remove_ids(&[block]);
        assert_eq!(get(&mut store, block, 99), None);
    }
}

//! Per-view, `BlockId`-scoped HTML `<details>` disclosure state
//! (`platform/sessions/disclosure.rs`, TS `widgetSession.ts`).
//!
//! Replaces the legacy process-global `OPEN_DETAILS` thread-local so two panes
//! viewing the same document—or two documents with `<details>` at the same
//! block offset—toggle disclosure state independently, and state is evicted
//! automatically when the block unmounts.
use super::BoundedMap;
use crate::editor::view::widget::{BlockId, WidgetStateStore};

/// Maximum `<details>` toggle entries kept per block widget (`TODO-31`).
pub const MAX_OPEN_DETAILS: usize = 512;

/// Disclosure toggles stored inside an [`EditorView`]'s [`WidgetStateStore`]
/// under the owning HTML block's [`BlockId`].
pub struct DisclosureSession {
    toggled: BoundedMap<usize, ()>,
}

impl Default for DisclosureSession {
    fn default() -> Self {
        Self {
            toggled: BoundedMap::new(MAX_OPEN_DETAILS),
        }
    }
}

impl DisclosureSession {
    pub fn is_toggled(&mut self, index: usize) -> bool {
        self.toggled.contains(&index)
    }

    pub fn toggle(&mut self, index: usize) -> bool {
        if self.toggled.remove(&index).is_some() {
            false
        } else {
            self.toggled.insert(index, ());
            true
        }
    }
}

/// Returns whether the `index`-th `<details>` inside `block_id` is toggled
/// relative to its authored `open` attribute in this view's `store`.
pub fn is_toggled(store: &mut WidgetStateStore, block_id: BlockId, index: usize) -> bool {
    store
        .get_mut::<DisclosureSession>(block_id)
        .is_some_and(|session| session.is_toggled(index))
}

/// Toggles the `index`-th `<details>` inside `block_id` in this view's `store`.
pub fn toggle(store: &mut WidgetStateStore, block_id: BlockId, index: usize) -> bool {
    store
        .get_or_default::<DisclosureSession>(block_id)
        .toggle(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::anchor::Anchor;
    use core::prelude::v1::test;

    #[test]
    fn disclosure_session_isolates_views_and_blocks_and_evicts_on_unmount() {
        let mut pane_a = WidgetStateStore::default();
        let mut pane_b = WidgetStateStore::default();
        let block = BlockId::new(1, Anchor::after(0, 0));

        assert!(!is_toggled(&mut pane_a, block, 0));
        assert!(!is_toggled(&mut pane_b, block, 0));

        assert!(toggle(&mut pane_a, block, 0));
        assert!(is_toggled(&mut pane_a, block, 0));
        assert!(
            !is_toggled(&mut pane_b, block, 0),
            "sibling pane must remain untouched"
        );

        pane_a.remove_ids(&[block]);
        assert!(!is_toggled(&mut pane_a, block, 0));
    }
}

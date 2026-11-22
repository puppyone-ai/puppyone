//! Per-view, `BlockId`-scoped horizontal inline viewport session
//! (`platform/sessions/inline_viewport.rs`, TS `embeddedInlineViewportSession.ts`).
//!
//! Establishes the per-block session slot in `WidgetStateStore` for Phase 2
//! (`markdown-table-horizontal-scroll`).
use crate::editor::view::widget::{BlockId, WidgetStateStore};

/// Horizontal scroll offset preserved across edits for a wide block widget.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct InlineViewportSession {
    scroll_x: f32,
}

impl InlineViewportSession {
    pub fn scroll_x(&self) -> f32 {
        self.scroll_x
    }

    pub fn set_scroll_x(&mut self, scroll_x: f32) {
        self.scroll_x = scroll_x.max(0.);
    }

    pub fn reset(&mut self) {
        self.scroll_x = 0.;
    }
}

pub fn scroll_x(store: &WidgetStateStore, block_id: BlockId) -> f32 {
    store
        .get::<InlineViewportSession>(block_id)
        .map_or(0., InlineViewportSession::scroll_x)
}

pub fn set_scroll_x(store: &mut WidgetStateStore, block_id: BlockId, offset: f32) {
    store
        .get_or_default::<InlineViewportSession>(block_id)
        .set_scroll_x(offset);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::anchor::Anchor;
    use core::prelude::v1::test;

    #[test]
    fn inline_viewport_session_clamps_and_persists_per_block() {
        let mut store = WidgetStateStore::default();
        let block = BlockId::new(9, Anchor::after(0, 0));
        assert_eq!(scroll_x(&store, block), 0.);
        set_scroll_x(&mut store, block, 140.5);
        assert_eq!(scroll_x(&store, block), 140.5);
        set_scroll_x(&mut store, block, -12.0);
        assert_eq!(scroll_x(&store, block), 0.);
    }
}

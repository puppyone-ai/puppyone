//! Block-drag layout geometry, binary-search drop-boundary picking, and
//! viewport edge auto-scroll math (`addons/block_drag/geometry.rs`).
use crate::editor::{
    markdown::core::commands::block_move::Movable, text::buffer::Buffer, view::layout::DocLayout,
};
use gpui::{Pixels, px};
use std::ops::Range;

pub const EDGE_SCROLL_ZONE: f32 = 36.;
pub const EDGE_SCROLL_MAX_STEP: f32 = 18.;

pub(super) fn block_top(layout: &DocLayout, doc: &Buffer, range: &Range<usize>) -> Option<Pixels> {
    let clamped = doc.clamp_range(range.clone());
    layout
        .blocks
        .iter()
        .find(|b| b.source.start <= clamped.start && clamped.start <= b.source.end)
        .map(|b| b.bounds.top())
}

pub(super) fn block_bottom(
    layout: &DocLayout,
    doc: &Buffer,
    range: &Range<usize>,
) -> Option<Pixels> {
    let clamped = doc.clamp_range(range.clone());
    layout
        .blocks
        .iter()
        .find(|b| b.source.start <= clamped.end && clamped.end <= b.source.end)
        .map(|b| b.bounds.bottom())
}

pub(super) fn rail(layout: &DocLayout) -> Option<(Pixels, Pixels)> {
    let b = layout.blocks.first()?;
    Some((b.bounds.left(), b.bounds.right()))
}

pub(super) fn block_edge_x(
    layout: &DocLayout,
    doc: &Buffer,
    block: &Movable,
    rail_left: Pixels,
) -> Pixels {
    let start = doc.clamp(block.range.start);
    if block.depth > 0 {
        layout.caret(start, false).x
    } else {
        rail_left
    }
}

pub(super) fn drop_indicator_y(
    layout: &DocLayout,
    doc: &Buffer,
    block: &Movable,
    boundary: usize,
) -> Option<Pixels> {
    let above = boundary
        .checked_sub(1)
        .and_then(|i| block.group.get(i))
        .and_then(|r| block_bottom(layout, doc, r));
    let below = block
        .group
        .get(boundary)
        .and_then(|r| block_top(layout, doc, r));
    match (above, below) {
        (Some(a), Some(c)) => Some((a + c) / 2.),
        (a, c) => a.or(c),
    }
}

pub(super) fn handle_anchor_y(layout: &DocLayout, doc: &Buffer, block: &Movable) -> Option<Pixels> {
    let start = doc.clamp(block.range.start);
    if layout.leaf_of(start).is_some() {
        let c = layout.caret(start, false);
        Some(c.row_top + c.row_height / 2.)
    } else {
        let top = block_top(layout, doc, &block.range)?;
        let bottom = block_bottom(layout, doc, &block.range)?;
        Some(top + ((bottom - top) / 2.).min(px(26.)))
    }
}

pub(super) fn compute_edge_scroll_delta(
    pointer_y: f32,
    bounds_top: f32,
    bounds_bottom: f32,
) -> f32 {
    if bounds_bottom - bounds_top <= EDGE_SCROLL_ZONE * 2. {
        return 0.;
    }
    if pointer_y < bounds_top + EDGE_SCROLL_ZONE {
        let ratio = ((bounds_top + EDGE_SCROLL_ZONE - pointer_y) / EDGE_SCROLL_ZONE).clamp(0., 1.);
        -EDGE_SCROLL_MAX_STEP * ratio
    } else if pointer_y > bounds_bottom - EDGE_SCROLL_ZONE {
        let ratio =
            ((pointer_y - (bounds_bottom - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE).clamp(0., 1.);
        EDGE_SCROLL_MAX_STEP * ratio
    } else {
        0.
    }
}

/// Binary-search the drop boundary across `count` vertically ordered blocks,
/// splitting each block at its midpoint (`(top + bottom) / 2`).
pub(super) fn pick_drop_boundary(
    count: usize,
    pointer_y: f32,
    mut bounds: impl FnMut(usize) -> Option<(f32, f32)>,
) -> usize {
    let mut lo = 0usize;
    let mut hi = count;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match bounds(mid) {
            Some((top, bottom)) if pointer_y < (top + bottom) / 2. => hi = mid,
            _ => lo = mid + 1,
        }
    }
    lo
}

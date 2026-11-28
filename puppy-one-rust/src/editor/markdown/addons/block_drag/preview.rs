//! Dragged-block source highlight and drop-boundary indicator elements
//! (`addons/block_drag/preview.rs`).
use super::geometry::{block_bottom, block_edge_x, block_top, drop_indicator_y};
use crate::editor::{
    markdown::core::commands::block_move::Movable, text::buffer::Buffer, view::layout::DocLayout,
};
use gpui::{prelude::*, *};

const SOURCE_BLEED: f32 = 4.;

/// Renders the selection-tinted highlight behind the currently dragged block.
pub(super) fn source_highlight(
    layout: &DocLayout,
    doc: &Buffer,
    block: &Movable,
    rail_left: Pixels,
    rail_right: Pixels,
    selection_bg: Rgba,
) -> Option<AnyElement> {
    let origin = layout.bounds.origin;
    let top = block_top(layout, doc, &block.range)?;
    let bottom = block_bottom(layout, doc, &block.range)?;
    Some(
        div()
            .absolute()
            .left(rail_left - origin.x - px(SOURCE_BLEED))
            .top(top - origin.y)
            .w(rail_right - rail_left + px(2. * SOURCE_BLEED))
            .h(bottom - top)
            .rounded(px(4.))
            .bg(selection_bg)
            .into_any_element(),
    )
}

/// Renders the horizontal drop-target indicator bar at `boundary`.
pub(super) fn drop_indicator(
    layout: &DocLayout,
    doc: &Buffer,
    block: &Movable,
    boundary: usize,
    rail_left: Pixels,
    rail_right: Pixels,
    accent: Rgba,
) -> Option<AnyElement> {
    let origin = layout.bounds.origin;
    let y = drop_indicator_y(layout, doc, block, boundary)?;
    let from = block_edge_x(layout, doc, block, rail_left);
    Some(
        div()
            .absolute()
            .left(from - origin.x)
            .top(y - origin.y - px(2.))
            .w(rail_right - from)
            .h(px(4.))
            .rounded(px(2.))
            .bg(crate::theme::alpha(accent, 0.5))
            .into_any_element(),
    )
}

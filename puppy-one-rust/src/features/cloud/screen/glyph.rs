//! Vector `ScreenGlyph` matching `CloudComputerScreen.tsx` (`viewBox="0 0 20 16"`),
//! rendered cleanly at both sidebar-thumbnail (`20×16`) and notice (`40×32`) scales.
use crate::theme;
use gpui::{IntoElement, ParentElement, Rgba, Styled, div, px};

pub(super) fn screen_glyph(
    width: f32,
    height: f32,
    stroke: Rgba,
    active: bool,
) -> impl IntoElement {
    let sx = width / 20.;
    let sy = height / 16.;
    let s = sx.min(sy);
    let sw = if width > 24. { 1.1 * s } else { 1.3 * s };
    let fill = theme::fade(stroke, if active { 0.22 } else { 0.09 });

    div()
        .relative()
        .w(px(width))
        .h(px(height))
        .flex_shrink_0()
        .child(
            div()
                .absolute()
                .left(px(1.5 * sx))
                .top(px(1.5 * sy))
                .w(px(17. * sx))
                .h(px(10.5 * sy))
                .rounded(px(2.25 * s))
                .border(px(sw))
                .border_color(stroke)
                .bg(fill),
        )
        .child(
            div()
                .absolute()
                .left(px(10. * sx - sw * 0.5))
                .top(px(12. * sy))
                .w(px(sw))
                .h(px(2.5 * sy))
                .bg(stroke),
        )
        .child(
            div()
                .absolute()
                .left(px(7.25 * sx))
                .top(px(14.5 * sy - sw * 0.5))
                .w(px(5.5 * sx))
                .h(px(sw))
                .rounded(px(sw * 0.5))
                .bg(stroke),
        )
}

/// Crisp 4-corner fullscreen frame glyph (`12×12` logical viewBox).
pub(super) fn fullscreen_glyph(size: f32, color: Rgba) -> impl IntoElement {
    let s = size / 12.;
    let arm = (3.4 * s).max(3.);
    let stroke = (1.4 * s).max(1.2);
    div()
        .relative()
        .w(px(size))
        .h(px(size))
        .flex_shrink_0()
        // Top-left corner
        .child(
            div()
                .absolute()
                .left(px(1.5 * s))
                .top(px(1.5 * s))
                .w(px(arm))
                .h(px(arm))
                .border_t(px(stroke))
                .border_l(px(stroke))
                .border_color(color),
        )
        // Top-right corner
        .child(
            div()
                .absolute()
                .right(px(1.5 * s))
                .top(px(1.5 * s))
                .w(px(arm))
                .h(px(arm))
                .border_t(px(stroke))
                .border_r(px(stroke))
                .border_color(color),
        )
        // Bottom-left corner
        .child(
            div()
                .absolute()
                .left(px(1.5 * s))
                .bottom(px(1.5 * s))
                .w(px(arm))
                .h(px(arm))
                .border_b(px(stroke))
                .border_l(px(stroke))
                .border_color(color),
        )
        // Bottom-right corner
        .child(
            div()
                .absolute()
                .right(px(1.5 * s))
                .bottom(px(1.5 * s))
                .w(px(arm))
                .h(px(arm))
                .border_b(px(stroke))
                .border_r(px(stroke))
                .border_color(color),
        )
}

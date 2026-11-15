//! Vector `ScreenGlyph` matching `CloudComputerScreen.tsx` (`viewBox="0 0 20 16"`),
//! drawn above the main area's notices (`40×32`).
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

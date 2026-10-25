//! Text placement that reproduces Chromium's line boxes: where Chromium puts
//! a line's baseline and where a GPUI text box must start for its baseline
//! to land on the same device pixel.
use super::RenderCx;
use crate::editor::view::style::TextStyle;
use gpui::{Window, px};

/// GPUI's midpoint rounding (`round_half_toward_zero`).
pub(super) fn round_half_down(v: f32) -> f32 {
    (v.abs() - 0.5).ceil().copysign(v)
}

/// Unrounded ascent and descent of the style's primary face.
/// The baseline Chromium draws for a line box of `style` starting at
/// `row_top` (on the device-pixel grid): the primary font's ascent and
/// descent rounded to device pixels, the upper half-leading floored.
pub fn chromium_baseline(scale: f32, style: &TextStyle, primary: (f32, f32), row_top: f32) -> f32 {
    let s = scale;
    let (a, d) = ((primary.0 * s).round() / s, (primary.1 * s).round() / s);
    let above = ((style.line_height_px() - a - d) * s / 2.).floor() / s;
    ((row_top + above + a) * s).round() / s
}

pub fn primary_metrics(window: &Window, style: &TextStyle) -> (f32, f32) {
    let ts = window.text_system();
    let id = ts.resolve_font(&RenderCx::font(style));
    let size = px(style.size);
    (
        f32::from(ts.ascent(id, size)),
        f32::from(ts.descent(id, size)).abs(),
    )
}

/// Top of a GPUI text box (in the same coordinates as `row_top`, whose
/// origin lies on the device-pixel grid) so that its first baseline lands on
/// the device pixel where Chromium draws the baseline of a line box starting
/// at `row_top`. Chromium rounds the primary font's ascent and descent to
/// device pixels and floors the upper half-leading; GPUI centres glyphs in
/// its whole-pixel line height using the shaped line's metrics (`gpui`) and
/// rounds the baseline to a device pixel.
pub fn chromium_text_top(
    scale: f32,
    style: &TextStyle,
    primary: (f32, f32),
    gpui: (f32, f32),
    row_top: f32,
) -> f32 {
    let s = scale;
    let target = chromium_baseline(scale, style, primary, row_top) * s;
    let line_height = style.line_height_px();
    let gpui_line = line_height.round();
    let gpui_baseline = (gpui_line - gpui.0 - gpui.1) / 2. + gpui.0;
    (target - round_half_down(gpui_baseline * s)) / s
}

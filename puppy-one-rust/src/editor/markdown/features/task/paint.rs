//! The task checkbox (`.cm-md-task-checkbox-widget` / `.cm-md-task-checkbox`):
//! a 1.05em box centred in the list marker slot within a 24px hit target;
//! checked boxes fill with the accent and show a white check.
use super::style::TaskStyle;
use crate::editor::view::style::{Paint, Rect};

/// The box and its hit target for a marker slot (`left`, `width`) on a row
/// at `top` of `line_height`, at font size `em`.
pub fn checkbox(style: &TaskStyle, checked: bool, slot: (f32, f32), top: f32, line_height: f32, em: f32) -> (Vec<Paint>, Rect) {
    let (left, width) = slot;
    let size = style.box_em * em;
    let hit_x = left + (width - style.hit) / 2.;
    let hit_y = top + line_height / 2. - style.hit / 2.;
    let bx = hit_x + (style.hit - size) / 2.;
    let by = hit_y + (style.hit - size) / 2.;
    let (border, background) = if checked { (style.checked, Some(style.checked)) } else { (style.box_border, None) };
    let mut paints = vec![Paint::Quad { rect: Rect::new(bx, by, size, size), background, radii: [style.radius; 4], border: style.border_width, border_color: Some(border) }];
    if checked {
        paints.push(check_mark(style, bx, by, size, em));
    }
    (paints, Rect::new(hit_x, hit_y, style.hit, style.hit))
}

/// The checked box's `::after`: a 0.3em × 0.55em box with 0.13em right and
/// bottom borders, rotated 45° about its centre, centred in the checkbox
/// content box and raised by its -0.1em top margin.
fn check_mark(style: &TaskStyle, bx: f32, by: f32, size: f32, em: f32) -> Paint {
    let (w, h, t) = (0.3 * em, 0.55 * em, 0.13 * em);
    let (bw, bh) = (w + t, h + t);
    let inner = size - 2. * style.border_width;
    let cx = bx + style.border_width + inner / 2.;
    let cy = by + style.border_width + (inner - (bh - 0.1 * em)) / 2. - 0.1 * em + bh / 2.;
    // The L (right and bottom borders) in box-local coordinates.
    let shape = [(w, 0.), (bw, 0.), (bw, bh), (0., bh), (0., h), (w, h)];
    let (sin, cos) = std::f32::consts::FRAC_PI_4.sin_cos();
    let points = shape
        .iter()
        .map(|&(x, y)| {
            let (dx, dy) = (x - bw / 2., y - bh / 2.);
            (cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
        })
        .collect();
    Paint::Polygon { points, color: style.check }
}

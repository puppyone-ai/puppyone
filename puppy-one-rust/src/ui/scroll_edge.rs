//! `useScrollEdgeState`'s fades: where scrolled content meets a fixed edge
//! it fades into the ground instead of being cut off by it.
use crate::theme;
use gpui::*;

/// The scroll distance over which an edge's fade comes in.
pub const FADE_DISTANCE: f32 = 24.;

/// Which edge of the content a fade sits on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Top,
    Bottom,
}

/// How strongly an edge fades with `beyond` px of content past it: none at
/// rest, full after [`FADE_DISTANCE`].
pub fn strength(beyond: f32) -> f32 {
    (beyond / FADE_DISTANCE).clamp(0., 1.)
}

/// Paints the fade on `edge` of `bounds` into `ground`, `height` tall at full
/// `strength` (0–1); both its height and its opacity follow the strength.
///
/// `linear-gradient(ground 0%, ground/78% 46%, transparent 100%)` from the
/// edge inward. GPUI gradients have two stops, so the curve is two quads
/// joined on a device-pixel row.
pub fn paint(
    window: &mut Window,
    bounds: Bounds<Pixels>,
    edge: Edge,
    ground: Rgba,
    height: f32,
    strength: f32,
) {
    if strength <= 0. {
        return;
    }
    let scale = window.scale_factor();
    let reach = height * strength;
    // From the edge inward; a gradient's first stop is where it starts.
    let (from, inward, angle) = match edge {
        Edge::Top => (f32::from(bounds.top()), 1., 180.),
        Edge::Bottom => (f32::from(bounds.bottom()), -1., 0.),
    };
    let mid = ((from + inward * reach * 0.46) * scale).round() / scale;
    let far = from + inward * reach;
    let (left, width) = (bounds.origin.x, bounds.size.width);
    let band = |a: f32, b: f32, y0: f32, y1: f32| {
        let (top, bottom) = (y0.min(y1), y0.max(y1));
        fill(
            Bounds::new(point(left, px(top)), size(width, px(bottom - top))),
            linear_gradient(
                angle,
                linear_color_stop(theme::alpha(ground, a * strength), 0.),
                linear_color_stop(theme::alpha(ground, b * strength), 1.),
            ),
        )
    };
    window.paint_quad(band(1., 0.78, from, mid));
    window.paint_quad(band(0.78, 0., mid, far));
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_fade_comes_in_over_the_first_24px_of_scroll() {
        assert_eq!(strength(0.), 0.);
        assert_eq!(strength(-5.), 0.);
        assert_eq!(strength(12.), 0.5);
        assert_eq!(strength(24.), 1.);
        assert_eq!(strength(400.), 1.);
    }
}

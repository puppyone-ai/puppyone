//! `OnboardingEmptyStateIntro` and `styles/onboarding-empty-state-intro.css`:
//! when the Homepage appears with no projects, a curtain covers the window
//! (below the titlebar, which stays on top and does not fade) with a small
//! aperture at the window's centre that breathes once (420ms), opens
//! past the window's corners (560ms) and holds (120ms); the Homepage column
//! fades in from 500ms over 420ms. The page is inert until the curtain goes.
//! With reduced motion the product's near-zero durations end it at once, so
//! the native intro does not play.
use crate::{
    theme,
    ui::motion::{Timeline, cubic_bezier, ease_in_out},
};
use gpui::{prelude::*, *};
use std::time::Duration;

const BREATHE_MS: f32 = 420.;
const REVEAL_MS: f32 = 560.;
const SETTLE_MS: f32 = 120.;
const CONTENT_LAG_MS: f32 = 80.;
const CONTENT_MS: f32 = 420.;
/// The curtain's own animation (`onboarding-empty-state-intro-complete`).
pub(super) const TOTAL: Duration =
    Duration::from_millis((BREATHE_MS + REVEAL_MS + SETTLE_MS) as u64);

/// `@keyframes onboarding-empty-state-breathe`: (offset, radius), eased
/// `ease-in-out` between keyframes.
const BREATHE: [(f32, f32); 5] = [(0., 7.), (0.23, 10.), (0.48, 7.), (0.72, 10.5), (1., 7.)];
/// The aperture's starting radius and the reveal's end, in `vmax`.
const CLOSED: f32 = 7.;
const OPEN_VMAX: f32 = 0.75;

/// One frame of the intro.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Frame {
    /// The aperture's radius in CSS pixels.
    pub radius: f32,
    /// The Homepage column's opacity.
    pub content: f32,
}

/// The intro `elapsed_ms` after it started, in a `w`×`h` window.
pub(super) fn frame(elapsed_ms: f32, w: f32, h: f32) -> Frame {
    let open = OPEN_VMAX * w.max(h);
    let radius = if elapsed_ms < BREATHE_MS {
        let p = (elapsed_ms / BREATHE_MS).max(0.);
        let i = BREATHE
            .windows(2)
            .position(|k| p <= k[1].0)
            .unwrap_or(BREATHE.len() - 2);
        let ((a, ra), (b, rb)) = (BREATHE[i], BREATHE[i + 1]);
        ra + (rb - ra) * ease_in_out((p - a) / (b - a))
    } else {
        let p = ((elapsed_ms - BREATHE_MS) / REVEAL_MS).min(1.);
        CLOSED + (open - CLOSED) * cubic_bezier(0.2, 0.7, 0.2, 1., p)
    };
    let start = BREATHE_MS + CONTENT_LAG_MS;
    let content = if elapsed_ms <= start {
        0.
    } else {
        cubic_bezier(0.2, 0.7, 0.2, 1., (elapsed_ms - start) / CONTENT_MS)
    };
    Frame { radius, content }
}

/// The frame a running intro shows now.
pub(super) fn current(timeline: &Timeline, w: f32, h: f32) -> Frame {
    frame(timeline.time() * TOTAL.as_millis() as f32, w, h)
}

/// The curtain over a `w`×`h` window with an aperture of `radius`: one
/// circular quad whose border is the curtain. GPUI rounds the inner edge to
/// `radius` and antialiases across it, where the product's mask ramps from
/// transparent at the radius to opaque one pixel further; the hole is drawn
/// half a pixel larger so both edges centre on the same circle.
pub(super) fn curtain(radius: f32, w: f32, h: f32, dark: bool) -> Stateful<Div> {
    let hole = radius + 0.5;
    // Thick enough to reach the window's corners from the hole's edge.
    let band = (w * w + h * h).sqrt() / 2. + 2.;
    let outer = hole + band;
    div()
        .id("onboarding-empty-state-intro")
        .debug_selector(|| "onboarding-empty-state-intro".into())
        .absolute()
        .top_0()
        .left_0()
        .w(px(w))
        .h(px(h))
        .overflow_hidden()
        // `cursor: default`, and the page beneath is inert.
        .occlude()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
        .child(
            div()
                .absolute()
                .left(px(w / 2. - outer))
                .top(px(h / 2. - outer))
                .size(px(outer * 2.))
                .rounded(px(outer))
                .border(px(band))
                .border_color(theme::intro_curtain(dark)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_aperture_breathes_then_opens_past_the_corners() {
        let near = |a: f32, b: f32| (a - b).abs() < 0.05;
        let (w, h) = (1280., 800.);
        // Breathing: the keyframe radii at their offsets.
        assert!(near(frame(0., w, h).radius, 7.));
        assert!(near(frame(0.23 * 420., w, h).radius, 10.));
        assert!(near(frame(0.48 * 420., w, h).radius, 7.));
        assert!(near(frame(0.72 * 420., w, h).radius, 10.5));
        assert!(near(frame(419.9, w, h).radius, 7.));
        let mid = frame(0.115 * 420., w, h).radius;
        assert!(mid > 7.5 && mid < 9.5, "{mid}");
        // Revealing: 75vmax at the end, beyond the half-diagonal.
        assert!(frame(700., w, h).radius > 300.);
        let open = frame(980., w, h).radius;
        assert!(near(open, 960.) && open > (w * w + h * h).sqrt() / 2.);
        assert!(near(frame(1100., w, h).radius, 960.));
        // The column waits for the breath and the lag, then fades in.
        assert_eq!(frame(500., w, h).content, 0.);
        let fading = frame(600., w, h).content;
        assert!(fading > 0.3 && fading < 1., "{fading}");
        assert!(near(frame(920., w, h).content, 1.));
        assert_eq!(TOTAL, Duration::from_millis(1100));
    }
}

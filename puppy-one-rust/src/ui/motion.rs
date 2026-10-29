//! Timed motion shared by every animated surface: a [`Timeline`] that owners
//! sample once per painted frame (requesting the next frame while it runs),
//! and the dev-capture freeze that holds all of them at one point.
//!
//! Owners keep their own curve and plan (the pane frames ease in and out, the
//! Explorer disclosure uses the product's trapezoid); the timeline only says
//! how far along the motion is and when it is over.
use std::time::{Duration, Instant};

/// A motion that started at some instant and lasts `duration`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Timeline {
    started: Instant,
    duration: Duration,
}
impl Timeline {
    /// A motion starting now.
    pub fn start(duration: Duration) -> Self {
        Self {
            started: Instant::now(),
            duration,
        }
    }
    /// Linear progress from `0` (start) to `1` (end), or the frozen point.
    pub fn time(&self) -> f32 {
        frozen_time().unwrap_or_else(|| {
            (self.started.elapsed().as_secs_f32() / self.duration.as_secs_f32()).clamp(0., 1.)
        })
    }
    /// The motion is over (never while frozen).
    pub fn finished(&self) -> bool {
        frozen_time().is_none() && self.started.elapsed() >= self.duration
    }
    /// Tests: let `by` pass on the motion's clock.
    #[cfg(test)]
    pub fn advance(&mut self, by: Duration) {
        self.started -= by;
    }
}

/// CSS `cubic-bezier(x1, y1, x2, y2)` at linear progress `t`: the curve is
/// solved for x by bisection, then evaluated for y.
pub fn cubic_bezier(x1: f32, y1: f32, x2: f32, y2: f32, t: f32) -> f32 {
    let t = t.clamp(0., 1.);
    let curve = |p1: f32, p2: f32, s: f32| {
        3. * (1. - s) * (1. - s) * s * p1 + 3. * (1. - s) * s * s * p2 + s * s * s
    };
    let (mut low, mut high) = (0f32, 1f32);
    for _ in 0..24 {
        let mid = (low + high) / 2.;
        if curve(x1, x2, mid) < t {
            low = mid;
        } else {
            high = mid;
        }
    }
    curve(y1, y2, (low + high) / 2.)
}
/// CSS `ease-in-out`.
pub fn ease_in_out(t: f32) -> f32 {
    cubic_bezier(0.42, 0., 0.58, 1., t)
}

/// Dev-capture only: `PUPPYONE_MOTION_AT=<0..1>` holds every motion at that
/// point of its timeline, so a capture shows one exact frame.
#[cfg(feature = "dev-capture")]
pub fn frozen_time() -> Option<f32> {
    static AT: std::sync::OnceLock<Option<f32>> = std::sync::OnceLock::new();
    *AT.get_or_init(|| {
        std::env::var("PUPPYONE_MOTION_AT")
            .ok()
            .and_then(|at| at.parse().ok())
    })
}
#[cfg(not(feature = "dev-capture"))]
pub fn frozen_time() -> Option<f32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_timeline_runs_from_zero_to_one_and_then_finishes() {
        let mut timeline = Timeline::start(Duration::from_millis(200));
        assert!(timeline.time() < 0.5);
        assert!(!timeline.finished());
        timeline.advance(Duration::from_millis(100));
        assert!((0.45..0.9).contains(&timeline.time()));
        timeline.advance(Duration::from_millis(150));
        assert_eq!(timeline.time(), 1.);
        assert!(timeline.finished());
    }

    #[test]
    fn css_curves_hold_their_ends_and_shape() {
        for t in [0., 1.] {
            assert!((cubic_bezier(0.2, 0.7, 0.2, 1., t) - t).abs() < 1e-4);
            assert!((ease_in_out(t) - t).abs() < 1e-4);
        }
        assert!((ease_in_out(0.5) - 0.5).abs() < 1e-3);
        // `cubic-bezier(0.2, 0.7, 0.2, 1)` is front-loaded.
        assert!(cubic_bezier(0.2, 0.7, 0.2, 1., 0.25) > 0.6);
    }
}

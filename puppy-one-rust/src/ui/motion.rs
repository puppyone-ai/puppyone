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
}

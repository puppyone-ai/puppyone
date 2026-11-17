//! Pane open / close motion: port of `CollapsiblePaneFrame` and
//! `collapsible-pane.css`.
//!
//! Opening or closing the Explorer or the right sidebar moves the pane's
//! frame over 360ms (`--po-pane-motion-*`: `cubic-bezier(0.42, 0, 0.58, 1)`)
//! while the main pane follows. The frame's width is the only value that
//! moves: the content keeps its open width at the pane's outer edge (start
//! for the Explorer, end for the right sidebar), so rows and labels never
//! reflow mid-motion, and a closing pane stays painted until its frame has
//! closed. Window resizes and sash drags are direct manipulation and do not
//! animate, nor does anything when the system asks for reduced motion. A
//! toggle during the motion starts from what is on screen, so it reverses
//! smoothly.
//!
//! The motion runs on a [`FrameTimeline`]: it starts at the first frame that
//! shows it, and a late frame slows it down instead of skipping to its end.
use crate::ui::motion::FrameTimeline;
use gpui_kit::base::motion::Easing;
use std::time::{Duration, Instant};

/// `--po-pane-motion-duration`.
const DURATION: Duration = Duration::from_millis(360);

/// The Explorer's and the right sidebar's widths, in that order.
pub(super) type Widths = (f32, f32);

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// The frames this frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct MotionFrame {
    /// The frames' widths on screen.
    pub shown: Widths,
    /// While they move: the widths they started from (the content planes
    /// keep the wider of these and the target).
    pub from: Option<Widths>,
}

#[derive(Default)]
pub(super) struct PaneMotion {
    /// Which panes were open at the last frame.
    open: Option<(bool, bool)>,
    /// The widths the last frame showed.
    shown: Option<Widths>,
    /// Where the running motion started, and its timeline.
    running: Option<(Widths, FrameTimeline)>,
}
impl PaneMotion {
    /// `target`: the settled widths of the panes `open` now; `now`: this
    /// frame's time.
    pub fn frame(
        &mut self,
        open: (bool, bool),
        target: Widths,
        animate: bool,
        now: Instant,
    ) -> MotionFrame {
        if self.open != Some(open) {
            self.running = self
                .shown
                .filter(|_| animate && self.open.is_some())
                .map(|shown| (shown, FrameTimeline::new(DURATION)));
            self.open = Some(open);
        }
        let Some((from, timeline)) = self.running.as_mut().filter(|_| animate) else {
            self.running = None;
            self.shown = Some(target);
            return MotionFrame {
                shown: target,
                from: None,
            };
        };
        let from = *from;
        let t = Easing::EaseInOut.sample(timeline.tick(now));
        if timeline.finished() {
            self.running = None;
        }
        let shown = (lerp(from.0, target.0, t), lerp(from.1, target.1, t));
        self.shown = Some(shown);
        MotionFrame {
            shown,
            from: Some(from),
        }
    }
    /// A frame is moving (more frames are needed).
    pub fn running(&self) -> bool {
        self.running.is_some()
    }
    /// Tests: let `by` pass on the running motion's clock.
    #[cfg(test)]
    pub fn advance(&mut self, by: Duration) {
        if let Some((_, timeline)) = &mut self.running {
            timeline.advance(by);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn closing_moves_the_frame_from_what_was_shown() {
        let mut motion = PaneMotion::default();
        let now = Instant::now();
        let settled = motion.frame((true, false), (320., 0.), true, now);
        assert_eq!(settled.shown, (320., 0.));
        assert!(!motion.running(), "the first frame settles");
        // The first frame of the close still shows the open pane.
        let first = motion.frame((false, false), (0., 0.), true, now);
        assert_eq!(first.shown, (320., 0.));
        assert_eq!(first.from, Some((320., 0.)));
        assert!(motion.running());
        let mid = motion.frame((false, false), (0., 0.), true, now + DURATION / 2);
        assert!(mid.shown.0 > 0. && mid.shown.0 < 320.);
        motion.advance(DURATION);
        let last = motion.frame((false, false), (0., 0.), true, now + DURATION);
        assert_eq!(last.shown, (0., 0.));
        assert!(!motion.running());
    }

    #[test]
    fn a_toggle_mid_motion_reverses_from_the_screen() {
        let mut motion = PaneMotion::default();
        let now = Instant::now();
        motion.frame((true, false), (320., 0.), true, now);
        motion.frame((false, false), (0., 0.), true, now);
        let mid = motion.frame((false, false), (0., 0.), true, now + DURATION / 2);
        let back = motion.frame((true, false), (320., 0.), true, now + DURATION / 2);
        assert_eq!(back.from, Some(mid.shown));
        assert_eq!(back.shown, mid.shown);
    }

    #[test]
    fn resizes_and_reduced_motion_do_not_animate() {
        let mut motion = PaneMotion::default();
        let now = Instant::now();
        motion.frame((true, false), (320., 0.), true, now);
        assert_eq!(
            motion.frame((true, false), (280., 0.), true, now).shown,
            (280., 0.)
        );
        let closed = motion.frame((false, false), (0., 0.), false, now);
        assert_eq!(closed.shown, (0., 0.));
        assert!(!motion.running());
    }
}

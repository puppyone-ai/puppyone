//! Pane open / close motion: port of `CollapsiblePaneFrame` and
//! `collapsible-pane.css`.
//!
//! Opening or closing the Explorer or the right sidebar moves the pane's
//! frame over 360ms (`--po-pane-motion-*`: `cubic-bezier(0.42, 0, 0.58, 1)`)
//! while the main pane follows. Only the frame changes width: the pane's
//! content keeps its open width and its edge (start for the Explorer, end
//! for the right sidebar) and is clipped, so rows and labels never reflow
//! mid-motion. A closing pane stays painted until its frame has closed.
//! Window resizes and sash drags are direct manipulation and do not animate,
//! nor does anything when the system asks for reduced motion. A toggle
//! during the motion starts from what is on screen, so it reverses smoothly.
use super::layout::Layout;
use crate::{geometry::Rect, ui::motion::Timeline};
use gpui_kit::base::motion::Easing;
use std::time::Duration;

/// `--po-pane-motion-duration`.
const DURATION: Duration = Duration::from_millis(360);

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
fn lerp_rect(a: Rect, b: Rect, t: f32) -> Rect {
    Rect::new(
        lerp(a.x, b.x, t),
        lerp(a.y, b.y, t),
        lerp(a.w, b.w, t),
        lerp(a.h, b.h, t),
    )
}

/// What the shell paints this frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::shell) struct PaneFrame {
    /// Pane content at its open width and edge; the editor where it is now.
    pub layout: Layout,
    /// While a pane moves: the window area its frame shows (clip to it).
    pub left_clip: Option<Rect>,
    pub right_clip: Option<Rect>,
    /// Frames keep coming.
    pub running: bool,
}

#[derive(Default)]
pub(super) struct PaneMotion {
    /// Which panes were open at the last frame.
    open: Option<(bool, bool)>,
    /// What the last frame showed (frame geometry).
    shown: Option<Layout>,
    /// Where the running motion started, and its timeline.
    running: Option<(Layout, Timeline)>,
}
impl PaneMotion {
    /// `target`: the settled layout of the panes `open` now.
    pub fn frame(&mut self, open: (bool, bool), target: Layout, animate: bool) -> PaneFrame {
        if self.open != Some(open) {
            self.running = self
                .shown
                .filter(|_| animate && self.open.is_some())
                .map(|shown| (shown, Timeline::start(DURATION)));
            self.open = Some(open);
        }
        if !animate
            || self
                .running
                .is_some_and(|(_, timeline)| timeline.finished())
        {
            self.running = None;
        }
        let Some((from, timeline)) = self.running else {
            self.shown = Some(target);
            return PaneFrame {
                layout: target,
                left_clip: None,
                right_clip: None,
                running: false,
            };
        };
        let t = Easing::EaseInOut.sample(timeline.time());
        let shown = Layout {
            header: target.header,
            explorer: lerp_rect(from.explorer, target.explorer, t),
            footer: lerp_rect(from.footer, target.footer, t),
            editor: lerp_rect(from.editor, target.editor, t),
            auxiliary: lerp_rect(from.auxiliary, target.auxiliary, t),
        };
        self.shown = Some(shown);
        // Content keeps the open width, anchored at the pane's outer edge.
        let left_w = from.explorer.w.max(target.explorer.w);
        let right_w = from.auxiliary.w.max(target.auxiliary.w);
        let layout = Layout {
            explorer: Rect::new(shown.explorer.x, shown.explorer.y, left_w, shown.explorer.h),
            footer: Rect::new(shown.footer.x, shown.footer.y, left_w, shown.footer.h),
            auxiliary: Rect::new(
                shown.auxiliary.right() - right_w,
                shown.auxiliary.y,
                right_w,
                shown.auxiliary.h,
            ),
            ..shown
        };
        PaneFrame {
            layout,
            left_clip: Some(Rect::new(
                shown.explorer.x,
                shown.explorer.y,
                shown.explorer.w,
                shown.footer.bottom() - shown.explorer.y,
            )),
            right_clip: Some(shown.auxiliary),
            running: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn layout(left: bool, right: bool) -> Layout {
        Layout::new(
            1280.,
            800.,
            if left { 320. } else { 0. },
            if right { 560. } else { 0. },
            0.,
        )
    }

    #[test]
    fn closing_the_explorer_moves_its_frame_and_keeps_its_content_width() {
        let mut motion = PaneMotion::default();
        let open = layout(true, false);
        assert!(
            !motion.frame((true, false), open, true).running,
            "first frame settles"
        );
        let closed = layout(false, false);
        let frame = motion.frame((false, false), closed, true);
        assert!(frame.running);
        // The first frame still shows the open pane, at its open width.
        let clip = frame.left_clip.unwrap();
        assert!((clip.w - 320.).abs() < 1.);
        assert_eq!(frame.layout.explorer.w, 320.);
        assert!((frame.layout.editor.x - 320.).abs() < 1.);
        motion.running.as_mut().unwrap().1.advance(DURATION);
        let settled = motion.frame((false, false), closed, true);
        assert!(!settled.running && settled.left_clip.is_none());
        assert_eq!(settled.layout, closed);
    }

    #[test]
    fn the_right_sidebar_content_is_anchored_at_its_end() {
        let mut motion = PaneMotion::default();
        motion.frame((true, false), layout(true, false), true);
        let frame = motion.frame((true, true), layout(true, true), true);
        let clip = frame.right_clip.unwrap();
        assert_eq!(frame.layout.auxiliary.right(), clip.right());
        assert_eq!(frame.layout.auxiliary.w, 560.);
    }

    #[test]
    fn resizes_and_reduced_motion_do_not_animate() {
        let mut motion = PaneMotion::default();
        motion.frame((true, false), layout(true, false), true);
        let wider = Layout::new(1600., 800., 320., 0., 0.);
        assert!(!motion.frame((true, false), wider, true).running);
        assert!(
            !motion
                .frame((false, false), layout(false, false), false)
                .running
        );
    }
}

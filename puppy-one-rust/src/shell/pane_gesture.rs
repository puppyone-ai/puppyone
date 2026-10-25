//! The pane resize gesture: a port of `collapsiblePaneGesture.ts`, the pure
//! state machine every collapsible desktop pane drags with.
//!
//! Dragging a pane's edge resizes it within its range. Pulling it
//! `threshold` past its minimum arms a collapse: the pane previews closed at
//! once (with the pane motion), and only a retreat beyond the hysteresis
//! brings it back; releasing while armed commits the collapse. A pane that
//! starts collapsed previews open at its minimum as soon as it is pulled out
//! and opens only if the pull travelled `threshold`. Nothing is committed
//! until the pointer is released.

/// Which edge of the window the pane sits on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Side {
    /// The Explorer: its trailing edge is dragged.
    Start,
    /// The right sidebar: its leading edge is dragged.
    End,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Phase {
    /// The edge follows the pointer.
    Resizing,
    /// Previewing closed (or staying closed): the frame animates.
    CollapsePreview,
    /// Previewing open again: the frame animates.
    ExpandPreview,
}

/// `CollapsiblePaneGestureConfig`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Config {
    pub collapsed_width: f32,
    pub hysteresis: f32,
    pub threshold: f32,
    pub collapsible: bool,
    pub max: f32,
    pub min: f32,
    pub side: Side,
}

/// `CollapsiblePaneGestureState`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Gesture {
    pub collapse_armed: bool,
    pub latest_expansion: f32,
    pub moved: bool,
    pub phase: Phase,
    pub preview_collapsed: bool,
    pub preview_width: f32,
    pub start_collapsed: bool,
    pub start_width: f32,
    start: (f32, f32),
}

/// `CollapsiblePaneGestureCommit`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Commit {
    /// Close; the width it reopens at.
    Collapse { restore_width: f32 },
    Expand { width: f32 },
    Resize { width: f32 },
}

/// A pane edge drag in progress (`useCollapsiblePaneResize`): the gesture
/// and the rules it runs under.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct PaneDrag {
    pub config: Config,
    pub gesture: Gesture,
}

/// `POINTER_DRAG_SLOP`: a press that moves less is a click.
const DRAG_SLOP: f32 = 4.;

fn normalize(v: f32) -> f32 {
    if v.is_finite() { v.max(0.).round() } else { 0. }
}
fn clamp(v: f32, min: f32, max: f32) -> f32 {
    normalize(v).max(min).min(max)
}

impl Config {
    /// `resolveCollapsiblePaneGestureConfig`.
    pub fn new(min: f32, max: f32, collapsed_width: f32, threshold: f32, collapsible: bool, side: Side) -> Self {
        let min = normalize(min);
        let max = normalize(max).max(min);
        let threshold = clamp(threshold, 0., min);
        Self {
            collapsed_width: clamp(collapsed_width, 0., min),
            hysteresis: clamp(24f32.min(threshold * 0.25), 0., threshold),
            threshold,
            collapsible,
            max,
            min,
            side,
        }
    }
}

impl Gesture {
    /// `beginCollapsiblePaneGesture`.
    pub fn begin(config: &Config, point: (f32, f32), collapsed: bool, width: f32) -> Self {
        let start_width = if collapsed {
            config.collapsed_width
        } else {
            clamp(width, config.min, config.max)
        };
        Self {
            collapse_armed: false,
            latest_expansion: 0.,
            moved: false,
            phase: if collapsed { Phase::ExpandPreview } else { Phase::Resizing },
            preview_collapsed: collapsed,
            preview_width: start_width,
            start_collapsed: collapsed,
            start_width,
            start: point,
        }
    }

    /// `moveCollapsiblePaneGesture`.
    pub fn moved_to(self, config: &Config, point: (f32, f32)) -> Self {
        let side = if config.side == Side::Start { 1. } else { -1. };
        let delta = (point.0 - self.start.0) * side;
        let raw = self.start_width + delta;
        let moved = self.moved
            || (point.0 - self.start.0).hypot(point.1 - self.start.1) > DRAG_SLOP;
        if !config.collapsible {
            return Self {
                moved,
                phase: Phase::Resizing,
                preview_collapsed: false,
                preview_width: clamp(raw, config.min, config.max),
                ..self
            };
        }
        if self.start_collapsed {
            let latest_expansion = delta.max(0.);
            if latest_expansion <= 0. {
                return Self {
                    latest_expansion,
                    moved,
                    phase: Phase::CollapsePreview,
                    preview_collapsed: true,
                    preview_width: config.collapsed_width,
                    ..self
                };
            }
            // Snap from the collapsed edge to the minimum; once the pointer
            // is in range, direct manipulation takes over.
            return Self {
                latest_expansion,
                moved,
                phase: if raw >= config.min { Phase::Resizing } else { Phase::ExpandPreview },
                preview_collapsed: false,
                preview_width: clamp(raw, config.min, config.max),
                ..self
            };
        }
        let boundary = if config.threshold > 0. {
            config.min - config.threshold
        } else {
            config.collapsed_width
        };
        let remains_armed = self.collapse_armed && raw <= boundary + config.hysteresis;
        if raw <= boundary || remains_armed {
            return Self {
                collapse_armed: true,
                moved,
                phase: Phase::CollapsePreview,
                preview_collapsed: true,
                preview_width: config.collapsed_width,
                ..self
            };
        }
        Self {
            collapse_armed: false,
            moved,
            // Leaving an armed preview is a transition back to the track.
            phase: if self.collapse_armed { Phase::ExpandPreview } else { Phase::Resizing },
            preview_collapsed: false,
            preview_width: clamp(raw, config.min, config.max),
            ..self
        }
    }

    /// `finishCollapsiblePaneGesture`.
    pub fn finish(&self, config: &Config) -> Option<Commit> {
        let resize = || (self.preview_width != self.start_width).then_some(Commit::Resize { width: self.preview_width });
        if !config.collapsible {
            return resize();
        }
        if self.start_collapsed {
            return (self.moved && self.latest_expansion >= config.threshold)
                .then_some(Commit::Expand { width: self.preview_width });
        }
        if self.collapse_armed {
            return Some(Commit::Collapse { restore_width: config.min });
        }
        resize()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn right_pane() -> Config {
        Config::new(420., 900., 0., 210., true, Side::End)
    }

    #[test]
    fn a_click_on_a_collapsed_edge_does_not_expand() {
        let gesture = Gesture::begin(&right_pane(), (0., 0.), true, 0.);
        assert_eq!(gesture.finish(&right_pane()), None);
    }

    #[test]
    fn collapse_previews_through_release_jitter_and_commits_once() {
        let c = right_pane();
        let mut g = Gesture::begin(&c, (0., 0.), false, 700.);
        g = g.moved_to(&c, (490., 0.));
        assert_eq!((g.phase, g.preview_collapsed, g.preview_width), (Phase::CollapsePreview, true, 0.));
        g = g.moved_to(&c, (480., 0.));
        assert_eq!((g.phase, g.preview_collapsed, g.preview_width), (Phase::CollapsePreview, true, 0.));
        assert_eq!(g.finish(&c), Some(Commit::Collapse { restore_width: 420. }));
    }

    #[test]
    fn disarming_needs_a_retreat_beyond_the_hysteresis() {
        let c = right_pane();
        let mut g = Gesture::begin(&c, (0., 0.), false, 700.);
        g = g.moved_to(&c, (490., 0.));
        g = g.moved_to(&c, (450., 0.));
        assert_eq!((g.phase, g.preview_collapsed, g.preview_width), (Phase::ExpandPreview, false, 420.));
        assert_eq!(g.finish(&c), Some(Commit::Resize { width: 420. }));
    }

    #[test]
    fn expansion_previews_locally_and_commits_after_enough_travel() {
        let c = right_pane();
        let short = Gesture::begin(&c, (0., 0.), true, 0.).moved_to(&c, (-20., 0.));
        assert!(!short.preview_collapsed);
        assert_eq!(short.finish(&c), None);
        let long = Gesture::begin(&c, (0., 0.), true, 0.).moved_to(&c, (-220., 0.));
        assert_eq!(long.finish(&c), Some(Commit::Expand { width: 420. }));
    }

    #[test]
    fn edge_expansion_hands_off_to_direct_resize() {
        for (side, collapsed_width, min, sign) in [(Side::Start, 56., 160., 1.), (Side::End, 0., 320., -1.)] {
            let c = Config::new(min, 900., collapsed_width, min / 2., true, side);
            let mut g = Gesture::begin(&c, (400., 20.), true, collapsed_width);
            let to = |g: Gesture, width: f32| g.moved_to(&c, (400. + (width - collapsed_width) * sign, 20.));
            g = to(g, collapsed_width + 8.);
            assert_eq!((g.phase, g.preview_width), (Phase::ExpandPreview, min));
            // The held gesture follows later moves without re-snapping.
            for width in [min, min + 32., min + 96., min + 48., min] {
                g = to(g, width);
                assert_eq!((g.phase, g.preview_width, g.preview_collapsed), (Phase::Resizing, width, false));
            }
            assert_eq!(g.finish(&c), Some(Commit::Expand { width: min }));
            g = to(g, collapsed_width);
            assert_eq!((g.phase, g.preview_collapsed), (Phase::CollapsePreview, true));
            assert_eq!(g.finish(&c), None);
        }
    }

    #[test]
    fn both_sides_share_the_collapse_rule() {
        for (side, x) in [(Side::Start, -200.), (Side::End, 200.)] {
            let c = Config::new(240., 900., 0., 120., true, side);
            let g = Gesture::begin(&c, (0., 0.), false, 320.).moved_to(&c, (x, 0.));
            assert_eq!(g.finish(&c), Some(Commit::Collapse { restore_width: 240. }));
        }
    }

    #[test]
    fn the_explorer_collapses_past_half_its_minimum() {
        // 220 minimum, 110 threshold: the boundary is a 110px pane, and a
        // collapse armed there holds until 134px (24px hysteresis).
        let c = Config::new(220., 520., 0., 110., true, Side::Start);
        let g = Gesture::begin(&c, (320., 0.), false, 320.);
        assert_eq!(g.moved_to(&c, (111., 0.)).phase, Phase::Resizing);
        assert_eq!(g.moved_to(&c, (111., 0.)).preview_width, 220.);
        let armed = g.moved_to(&c, (110., 0.));
        assert!(armed.preview_collapsed);
        assert!(armed.moved_to(&c, (134., 0.)).preview_collapsed);
        assert!(!armed.moved_to(&c, (135., 0.)).preview_collapsed);
    }
}

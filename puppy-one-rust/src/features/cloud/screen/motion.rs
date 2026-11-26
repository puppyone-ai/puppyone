//! Where the live screen sits, and how it gets there.
//!
//! The screen has one place: over the main area. Opening it grows it in
//! from slightly smaller and transparent; closing it shrinks and fades it
//! the same way, over 420ms. A change during a move starts from what is on
//! screen, and a target that moves (a pane opening, the window resizing) is
//! followed at every frame. While it is closed, the Header's Computer
//! button shows its live picture on hover (`app::cloud_computer_ui`).
use crate::{
    geometry::Rect,
    ui::motion::{FrameTimeline, cubic_bezier},
};
use std::time::{Duration, Instant};

/// `--dur: 420ms`.
const DURATION: Duration = Duration::from_millis(420);
/// `--ease: cubic-bezier(.2, .8, .2, 1)`, exact at its ends (the solver
/// stops a hair inside them).
fn ease(t: f32) -> f32 {
    match t {
        t if t <= 0. => 0.,
        t if t >= 1. => 1.,
        t => cubic_bezier(0.2, 0.8, 0.2, 1., t),
    }
}
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
/// How much smaller the screen is while it grows in or fades out.
const AWAY_SCALE: f32 = 0.96;

/// The Cloud Computer's desktop: one fixed 16:10 resolution (WXGA, the
/// size computer-use Agents see best at), never the window's. A window
/// resize only scales the picture, so its shape never changes and an
/// Agent at work never has the desktop reflow under it.
pub const DESKTOP: (u16, u16) = (1280, 800);
/// The open screen keeps this margin from the main area's edges.
pub const STAGE_MARGIN: f32 = 32.;
pub const STAGE_RADIUS: f32 = 12.;

/// Height over width of the desktop as it is shown: the picture's own when
/// there is one (a server that cannot resize keeps its own), else
/// [`DESKTOP`]'s, kept between 2:1 and 4:3.
pub fn aspect(frame: Option<(u32, u32)>) -> f32 {
    let (w, h) = match frame {
        Some((w, h)) if w > 0 && h > 0 => (w as f32, h as f32),
        _ => (f32::from(DESKTOP.0), f32::from(DESKTOP.1)),
    };
    (h / w).clamp(0.5, 0.75)
}

/// The open screen on the main area at `stage`: as large as fits inside the
/// margin at `aspect`, centred.
pub fn on_stage(stage: Rect, aspect: f32) -> Rect {
    let (room_w, room_h) = (
        (stage.w - 2. * STAGE_MARGIN).max(1.),
        (stage.h - 2. * STAGE_MARGIN).max(1.),
    );
    let (w, h) = if room_h / room_w > aspect {
        (room_w, room_w * aspect)
    } else {
        (room_h / aspect, room_h)
    };
    Rect::new(
        (stage.x + (stage.w - w) / 2.).round(),
        (stage.y + (stage.h - h) / 2.).round(),
        w.round(),
        h.round(),
    )
}

/// Where the screen belongs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    /// Over the main area.
    Stage,
    /// Closed: it shrinks a little toward the main area's centre and fades.
    Away,
}

/// The screen as one frame shows it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    /// Window coordinates.
    pub rect: Rect,
    pub radius: f32,
    pub opacity: f32,
    /// How far the screen stands on the main area (its shadow).
    pub fit: f32,
}
impl Pose {
    /// Where `place` puts the screen on the main area at `stage`, the
    /// desktop at `aspect`.
    pub fn at(place: Place, stage: Rect, aspect: f32) -> Self {
        let open = on_stage(stage, aspect);
        match place {
            Place::Stage => Self {
                rect: open,
                radius: STAGE_RADIUS,
                opacity: 1.,
                fit: 1.,
            },
            Place::Away => {
                let (w, h) = (open.w * AWAY_SCALE, open.h * AWAY_SCALE);
                Self {
                    rect: Rect::new(open.x + (open.w - w) / 2., open.y + (open.h - h) / 2., w, h),
                    radius: STAGE_RADIUS,
                    opacity: 0.,
                    fit: 0.,
                }
            }
        }
    }
    fn toward(self, to: Self, t: f32) -> Self {
        Self {
            rect: Rect::new(
                lerp(self.rect.x, to.rect.x, t),
                lerp(self.rect.y, to.rect.y, t),
                lerp(self.rect.w, to.rect.w, t),
                lerp(self.rect.h, to.rect.h, t),
            ),
            radius: lerp(self.radius, to.radius, t),
            opacity: lerp(self.opacity, to.opacity, t),
            fit: lerp(self.fit, to.fit, t),
        }
    }
    /// The picture's rect for a `width × height` frame: all of it, inside
    /// the pose and centred.
    pub fn picture(&self, width: u32, height: u32) -> Option<Rect> {
        contain(self.rect, width, height)
    }
}

/// A `width × height` frame shown whole inside `rect`, centred.
pub fn contain(rect: Rect, width: u32, height: u32) -> Option<Rect> {
    let (fw, fh) = (width as f32, height as f32);
    if fw <= 0. || fh <= 0. || rect.w <= 0. || rect.h <= 0. {
        return None;
    }
    let scale = (rect.w / fw).min(rect.h / fh);
    let (w, h) = (fw * scale, fh * scale);
    Some(Rect::new(
        rect.x + (rect.w - w) / 2.,
        rect.y + (rect.h - h) / 2.,
        w,
        h,
    ))
}

/// This frame's pose, and whether it is still on its way.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shown {
    pub pose: Pose,
    pub place: Place,
    pub moving: bool,
    /// The move goes to or from the main area (native web content there
    /// hides until it lands).
    pub crosses: bool,
}

/// The screen's motion, sampled once per painted frame
/// (`PaneMotion`'s clock: a late frame slows it, never skips it).
#[derive(Default)]
pub struct ScreenMotion {
    place: Option<Place>,
    shown: Option<Pose>,
    running: Option<(Pose, Place, FrameTimeline)>,
}
impl ScreenMotion {
    /// The screen for `place`, whose pose this frame is `target`.
    pub fn frame(&mut self, place: Place, target: Pose, animate: bool, now: Instant) -> Shown {
        if self.place != Some(place) {
            let from = self.place.unwrap_or(place);
            self.running = self
                .shown
                .filter(|_| animate && self.place.is_some())
                .map(|shown| (shown, from, FrameTimeline::new(DURATION)));
            self.place = Some(place);
        }
        let Some((from, from_place, timeline)) = self.running.as_mut().filter(|_| animate) else {
            self.running = None;
            self.shown = Some(target);
            return Shown {
                pose: target,
                place,
                moving: false,
                crosses: false,
            };
        };
        let crosses = *from_place == Place::Stage || place == Place::Stage;
        let pose = from.toward(target, ease(timeline.tick(now)));
        let moving = !timeline.finished();
        if !moving {
            self.running = None;
        }
        self.shown = Some(pose);
        Shown {
            pose,
            place,
            moving,
            crosses,
        }
    }
    /// A move is under way.
    #[cfg(feature = "dev-capture")]
    pub fn moving(&self) -> bool {
        self.running.is_some()
    }
    /// The screen left the window (no live picture): it next appears where
    /// it belongs, without a move.
    pub fn forget(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const STAGE: Rect = Rect {
        x: 260.,
        y: 40.,
        w: 1000.,
        h: 700.,
    };

    #[test]
    fn closed_the_screen_is_a_little_smaller_transparent_and_centred_where_it_opens() {
        let open = Pose::at(Place::Stage, STAGE, 0.625);
        let away = Pose::at(Place::Away, STAGE, 0.625);
        assert_eq!(open.opacity, 1.);
        assert_eq!(away.opacity, 0.);
        assert!((away.rect.w - open.rect.w * AWAY_SCALE).abs() < 0.01);
        let centre = |r: Rect| (r.x + r.w / 2., r.y + r.h / 2.);
        let (a, o) = (centre(away.rect), centre(open.rect));
        assert!((a.0 - o.0).abs() < 0.01 && (a.1 - o.1).abs() < 0.01);
    }

    #[test]
    fn a_change_moves_from_what_is_on_screen_and_settles_on_the_target() {
        let mut motion = ScreenMotion::default();
        let start = Instant::now();
        let away = Pose::at(Place::Away, STAGE, 0.625);
        let shown = motion.frame(Place::Away, away, true, start);
        assert_eq!(shown.pose, away);
        assert!(!shown.moving);

        // Opening: the first frame still shows it closed, then it grows in.
        let stage = Pose::at(Place::Stage, STAGE, 0.625);
        let first = motion.frame(Place::Stage, stage, true, start);
        assert_eq!(first.pose, away);
        assert!(first.moving && first.crosses);
        let mut at = start;
        let mut mid = first;
        for _ in 0..6 {
            at += Duration::from_millis(16);
            mid = motion.frame(Place::Stage, stage, true, at);
        }
        assert!(mid.pose.rect.w > away.rect.w && mid.pose.rect.w < stage.rect.w);
        assert!(mid.pose.opacity > 0. && mid.pose.opacity < 1.);

        // Closing half way: it turns back from where it is.
        let back = motion.frame(Place::Away, away, true, at);
        assert_eq!(back.pose, mid.pose);
        for _ in 0..40 {
            at += Duration::from_millis(16);
            motion.frame(Place::Away, away, true, at);
        }
        let settled = motion.frame(Place::Away, away, true, at);
        assert!(!settled.moving);
        assert_eq!(settled.pose, away);
    }

    #[test]
    fn without_motion_the_screen_is_where_it_belongs() {
        let mut motion = ScreenMotion::default();
        let now = Instant::now();
        let away = Pose::at(Place::Away, STAGE, 0.625);
        motion.frame(Place::Away, away, false, now);
        let stage = Pose::at(Place::Stage, STAGE, 0.625);
        let shown = motion.frame(Place::Stage, stage, false, now);
        assert_eq!(shown.pose, stage);
        assert!(!shown.moving);
    }

    #[test]
    fn the_main_area_shows_all_of_the_picture_centred() {
        // A 4:3 picture on a 16:10 screen shows all of it, centred.
        let stage = Pose::at(Place::Stage, STAGE, 0.625);
        let whole = stage.picture(1200, 900).unwrap();
        assert_eq!(whole.h, stage.rect.h);
        assert!(whole.w < stage.rect.w);
        assert_eq!(whole.x, stage.rect.x + (stage.rect.w - whole.w) / 2.);
        assert!(contain(Rect::new(0., 0., 0., 10.), 4, 2).is_none());
    }

    #[test]
    fn the_open_screen_keeps_its_shape_and_margin_whatever_the_window() {
        // Wide, tall and square main areas: always 16:10, centred, inside
        // the margin, touching it on the tighter side.
        for stage in [
            STAGE,
            Rect::new(260., 40., 700., 900.),
            Rect::new(0., 40., 1800., 600.),
        ] {
            let screen = on_stage(stage, aspect(None));
            assert!((screen.h / screen.w - 0.625).abs() < 0.01, "{screen:?}");
            assert!(screen.x >= stage.x + STAGE_MARGIN - 0.5);
            assert!(screen.y >= stage.y + STAGE_MARGIN - 0.5);
            assert!(screen.right() <= stage.right() - STAGE_MARGIN + 0.5);
            assert!(screen.bottom() <= stage.bottom() - STAGE_MARGIN + 0.5);
            let (left, top) = (screen.x - stage.x, screen.y - stage.y);
            assert!((left - (stage.right() - screen.right())).abs() <= 1.);
            assert!((top - (stage.bottom() - screen.bottom())).abs() <= 1.);
            assert!((left - STAGE_MARGIN).abs() <= 0.5 || (top - STAGE_MARGIN).abs() <= 0.5);
        }
        // The desktop's own shape wins when the server keeps one.
        assert_eq!(aspect(Some((1024, 768))), 0.75);
        assert_eq!(aspect(Some((1280, 800))), 0.625);
    }
}

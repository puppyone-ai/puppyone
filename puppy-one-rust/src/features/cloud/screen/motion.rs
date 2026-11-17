//! Where the live screen sits, and how it gets there
//! (`computer-mode-experiment/workbench-redesign-v4.html`).
//!
//! The screen is one element in three places: folded into the sidebar card's
//! row as a thumbnail, unfolded in that card as a live preview, or over the
//! main area. Between places it moves and scales over 420ms; a change during
//! a move starts from what is on screen, and a target that moves (a pane
//! opening, the window resizing) is followed at every frame.
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

/// The sidebar card (`.sc`), inside the Explorer column's plane. Folded, it
/// is a 52px row: a 48×32 thumbnail 8px in, then the title and status.
/// Unfolded, the preview takes the card's width less 8px each side at the
/// screen's aspect, with the title and status under it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Card {
    /// The card's box in window coordinates; its height follows the unfold.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    /// The unfolded preview's height.
    preview: f32,
}
impl Card {
    /// The card's inset in the plane: level with the Explorer's rows.
    pub const INSET_X: f32 = 12.;
    pub const INSET_TOP: f32 = 8.;
    pub const RADIUS: f32 = 10.;
    pub const ROW: f32 = 52.;
    pub const PAD: f32 = 8.;
    const THUMB_W: f32 = 48.;
    const THUMB_H: f32 = 32.;
    /// Thumbnail to title in the row.
    const META_GAP: f32 = 12.;
    /// Preview to title, the title and status, and the card's end.
    const UNDER_PREVIEW: f32 = 9.;
    const META_H: f32 = 38.;
    const END: f32 = 4.;

    /// The card at the top of the Explorer's `plane`, its preview at the
    /// screen's `aspect` (height over width), kept between a wide 2:1 and 4:3.
    pub fn new(plane: Rect, aspect: f32) -> Self {
        let w = (plane.w - 2. * Self::INSET_X).max(Self::THUMB_W + 2. * Self::PAD);
        let preview = (w - 2. * Self::PAD) * aspect.clamp(0.5, 0.75);
        Self {
            x: plane.x + Self::INSET_X,
            y: plane.y + Self::INSET_TOP,
            w,
            preview: preview.round(),
        }
    }
    pub fn height(&self, unfold: f32) -> f32 {
        let open = Self::PAD + self.preview + Self::UNDER_PREVIEW + Self::META_H + Self::END;
        lerp(Self::ROW, open, unfold)
    }
    /// The screen's place in the card, relative to the card's box.
    pub fn slot(&self, unfold: f32) -> Rect {
        Rect::new(
            Self::PAD,
            lerp((Self::ROW - Self::THUMB_H) / 2., Self::PAD, unfold),
            lerp(Self::THUMB_W, self.w - 2. * Self::PAD, unfold),
            lerp(Self::THUMB_H, self.preview, unfold),
        )
    }
    /// The screen's place in the card, in window coordinates.
    pub fn slot_in_window(&self, unfold: f32) -> Rect {
        let slot = self.slot(unfold);
        Rect::new(self.x + slot.x, self.y + slot.y, slot.w, slot.h)
    }
    /// Where the title and status start, relative to the card's box.
    pub fn meta(&self, unfold: f32) -> (f32, f32) {
        (
            lerp(
                Self::PAD + Self::THUMB_W + Self::META_GAP,
                Self::PAD + 2.,
                unfold,
            ),
            lerp(8., Self::PAD + self.preview + Self::UNDER_PREVIEW, unfold),
        )
    }
    /// The fold toggle's top, beside the title.
    pub fn toggle_top(&self, unfold: f32) -> f32 {
        lerp(14., Self::PAD + self.preview + 12., unfold)
    }
    /// The screen's corner radius at `unfold`.
    pub fn radius(unfold: f32) -> f32 {
        lerp(5., 7., unfold)
    }
}

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
    /// In the sidebar card, folded to its row or unfolded to a preview.
    Card { unfolded: bool },
    /// Over the main area.
    Stage,
    /// Nowhere to go back to (the Explorer is closed): it slides out to the
    /// window's start and fades.
    Away,
}

/// The screen as one frame shows it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    /// Window coordinates.
    pub rect: Rect,
    pub radius: f32,
    /// How far the sidebar card has unfolded (0 row, 1 preview).
    pub unfold: f32,
    pub opacity: f32,
    /// How the picture fills `rect`: 0 covers it (a thumbnail crops), 1
    /// shows all of it. It is also how far the screen stands on the main
    /// area (its shadow).
    pub fit: f32,
}
impl Pose {
    /// Where `place` puts the screen: `card` when the Explorer shows,
    /// `stage` the main area, the desktop at `aspect`.
    pub fn at(place: Place, card: Option<Card>, stage: Rect, aspect: f32) -> Self {
        match (place, card) {
            (Place::Stage, _) => Self {
                rect: on_stage(stage, aspect),
                radius: STAGE_RADIUS,
                unfold: 0.,
                opacity: 1.,
                fit: 1.,
            },
            (Place::Card { unfolded }, Some(card)) => {
                let unfold = if unfolded { 1. } else { 0. };
                Self {
                    rect: card.slot_in_window(unfold),
                    radius: Card::radius(unfold),
                    unfold,
                    opacity: 1.,
                    fit: 0.,
                }
            }
            (Place::Card { .. } | Place::Away, _) => Self {
                rect: Rect::new(
                    stage.x - Card::THUMB_W - 12.,
                    stage.y + 10.,
                    Card::THUMB_W,
                    Card::THUMB_H,
                ),
                radius: Card::radius(0.),
                unfold: 0.,
                opacity: 0.,
                fit: 0.,
            },
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
            unfold: lerp(self.unfold, to.unfold, t),
            opacity: lerp(self.opacity, to.opacity, t),
            fit: lerp(self.fit, to.fit, t),
        }
    }
    /// The picture's rect for a `width × height` frame: between covering the
    /// pose and fitting inside it, centred.
    pub fn picture(&self, width: u32, height: u32) -> Option<Rect> {
        let (fw, fh) = (width as f32, height as f32);
        if fw <= 0. || fh <= 0. || self.rect.w <= 0. || self.rect.h <= 0. {
            return None;
        }
        let cover = (self.rect.w / fw).max(self.rect.h / fh);
        let contain = (self.rect.w / fw).min(self.rect.h / fh);
        let scale = lerp(cover, contain, self.fit);
        let (w, h) = (fw * scale, fh * scale);
        Some(Rect::new(
            self.rect.x + (self.rect.w - w) / 2.,
            self.rect.y + (self.rect.h - h) / 2.,
            w,
            h,
        ))
    }
}

/// This frame's pose, and whether it is still on its way.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shown {
    pub pose: Pose,
    pub place: Place,
    pub moving: bool,
    /// The move goes to or from the main area, so it crosses the Explorer's
    /// edge (a fold or unfold stays inside the sidebar).
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

    fn card() -> Card {
        Card::new(Rect::new(0., 40., 260., 700.), 0.625)
    }
    const STAGE: Rect = Rect {
        x: 260.,
        y: 40.,
        w: 1000.,
        h: 700.,
    };

    #[test]
    fn the_card_is_a_row_folded_and_a_preview_at_the_screens_aspect_unfolded() {
        let card = card();
        assert_eq!((card.x, card.y, card.w), (12., 48., 236.));
        assert_eq!(card.height(0.), 52.);
        assert_eq!(card.slot(0.), Rect::new(8., 10., 48., 32.));
        // 220 wide at 10:16.
        assert_eq!(card.slot(1.), Rect::new(8., 8., 220., 138.));
        assert_eq!(card.height(1.), 8. + 138. + 9. + 38. + 4.);
        assert_eq!(card.meta(0.), (68., 8.));
        assert_eq!(card.meta(1.), (10., 155.));
        // A tall or wide screen keeps the preview between 2:1 and 4:3.
        assert_eq!(Card::new(Rect::new(0., 0., 260., 0.), 2.).slot(1.).h, 165.);
        assert_eq!(Card::new(Rect::new(0., 0., 260., 0.), 0.1).slot(1.).h, 110.);
    }

    #[test]
    fn a_change_moves_from_what_is_on_screen_and_settles_on_the_target() {
        let card = Some(card());
        let mut motion = ScreenMotion::default();
        let start = Instant::now();
        let row = Pose::at(Place::Card { unfolded: false }, card, STAGE, 0.625);
        let shown = motion.frame(Place::Card { unfolded: false }, row, true, start);
        assert_eq!(shown.pose, row);
        assert!(!shown.moving);

        // Opening: the first frame still shows the row, then it flies.
        let stage = Pose::at(Place::Stage, card, STAGE, 0.625);
        let first = motion.frame(Place::Stage, stage, true, start);
        assert_eq!(first.pose, row);
        assert!(first.moving && first.crosses);
        let mut at = start;
        let mut mid = first;
        for _ in 0..6 {
            at += Duration::from_millis(16);
            mid = motion.frame(Place::Stage, stage, true, at);
        }
        assert!(mid.pose.rect.w > row.rect.w && mid.pose.rect.w < STAGE.w);
        assert!(mid.pose.fit > 0. && mid.pose.fit < 1.);

        // Closing half way: it turns back from where it is.
        let back = motion.frame(Place::Card { unfolded: true }, row, true, at);
        assert_eq!(back.pose, mid.pose);
        for _ in 0..40 {
            at += Duration::from_millis(16);
            motion.frame(Place::Card { unfolded: true }, row, true, at);
        }
        let settled = motion.frame(Place::Card { unfolded: true }, row, true, at);
        assert!(!settled.moving);
        assert_eq!(settled.pose, row);
    }

    #[test]
    fn without_motion_the_screen_is_where_it_belongs() {
        let card = Some(card());
        let mut motion = ScreenMotion::default();
        let now = Instant::now();
        let row = Pose::at(Place::Card { unfolded: false }, card, STAGE, 0.625);
        motion.frame(Place::Card { unfolded: false }, row, false, now);
        let stage = Pose::at(Place::Stage, card, STAGE, 0.625);
        let shown = motion.frame(Place::Stage, stage, false, now);
        assert_eq!(shown.pose, stage);
        assert!(!shown.moving);
    }

    #[test]
    fn a_thumbnail_crops_the_picture_and_the_main_area_shows_all_of_it() {
        let row = Pose::at(Place::Card { unfolded: false }, Some(card()), STAGE, 0.625);
        // 16:10 into 3:2: cover crops the sides.
        let cropped = row.picture(1600, 1000).unwrap();
        assert_eq!(cropped.h, row.rect.h);
        assert!(cropped.w > row.rect.w);
        // A 4:3 picture on a 16:10 screen shows all of it, centred.
        let stage = Pose::at(Place::Stage, None, STAGE, 0.625);
        let whole = stage.picture(1200, 900).unwrap();
        assert_eq!(whole.h, stage.rect.h);
        assert!(whole.w < stage.rect.w);
        assert_eq!(whole.x, stage.rect.x + (stage.rect.w - whole.w) / 2.);
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

    #[test]
    fn without_a_card_the_screen_leaves_toward_the_windows_start_and_fades() {
        let away = Pose::at(Place::Away, None, STAGE, 0.625);
        assert!(away.rect.right() < STAGE.x);
        assert_eq!(away.opacity, 0.);
    }
}

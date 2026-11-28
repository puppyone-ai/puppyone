//! Moments: short pictures that play in turn, each holding for its own time,
//! with dots that fill as they play (`OnboardingValueCarousel` and its
//! scenes, qubits 67b1e3865). First run's Homepage and the sign-in explainer
//! both tell their story with them; each owns its table of moments, its copy
//! and its layout, and draws the same scenes in its own [`Cast`].
//!
//! - [`hub`]: the person's files in one pile, with Agents drifting round them
//!   or linked by radial spokes
//! - [`edit`]: a chart circled, one line said, redrawn
//! - [`forward`]: a file's link handed to an Agent, which takes it over
//! - [`paint`]: what the scenes draw that GPUI has no element for
use crate::theme::{self, Theme};
use gpui::{prelude::*, *};
use gpui_kit::base::{Button as BaseButton, h_flex};
use std::rc::Rc;
use std::time::{Duration, Instant};

pub mod edit;
pub mod forward;
pub mod hub;
pub mod paint;

/// A scene: one frame of a moment's picture.
pub type Scene = fn(&Theme, Picture, Clock, Cast) -> AnyElement;
/// What a dot does when chosen: open its moment, by index.
pub type OnSelect = Rc<dyn Fn(usize, &mut Window, &mut App)>;

/// `.onboarding-value-slide` cross-fade: `opacity 420ms ease`, the incoming
/// moment `120ms` behind the outgoing one.
const FADE: f32 = 0.42;
const FADE_LAG: f32 = 0.12;

/// Where a scene is drawn: the picture's side, and the zoom of the scenes'
/// 380px drawing at that side (`--onboarding-hub-size`/`-scale`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Picture {
    pub side: f32,
    pub scale: f32,
}

/// The time a scene is drawn at. `None` is at rest: every step has ended and
/// nothing drifts (reduced motion, and the pixel lab).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Clock {
    /// Seconds since the moment opened (its steps).
    pub moment: Option<f32>,
    /// Seconds of the pictures' endless motion (orbits, drift).
    pub motion: Option<f32>,
}

/// Who plays in the scenes: the pile's label (a copy key) and the Agent that
/// is handed a file's link (an Agent brand id).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cast {
    pub center: &'static str,
    pub agent: &'static str,
}

/// Which moment is open, since when, and how far its dot has filled. The
/// open dot fills over its moment's hold and opens the next when full; the
/// last leads back to the first.
pub struct Carousel {
    holds: &'static [f32],
    index: usize,
    opened: Instant,
    /// The moment fading out, and since when.
    previous: Option<(usize, Instant)>,
    progress: f32,
    ticked: Option<Instant>,
    /// When the endless motion started.
    since: Instant,
}
impl Carousel {
    /// `holds`: each moment's seconds, in order.
    pub fn new(holds: &'static [f32]) -> Self {
        let now = Instant::now();
        Self {
            holds,
            index: 0,
            opened: now,
            previous: None,
            progress: 0.,
            ticked: None,
            since: now,
        }
    }
    pub fn index(&self) -> usize {
        self.index
    }
    /// The open dot's fill, 0..1; full at rest, as with no animation.
    pub fn fill(&self, rest: bool) -> f32 {
        if rest {
            1.
        } else {
            self.progress.clamp(0., 1.)
        }
    }
    /// The endless motion's clock (`None` at rest).
    pub fn motion(&self, now: Instant, rest: bool) -> Option<f32> {
        (!rest).then(|| (now - self.since).as_secs_f32())
    }
    /// Opens a moment (a dot, or the next when one is full); the open one
    /// fades out.
    pub fn open(&mut self, index: usize, now: Instant) {
        if index >= self.holds.len() || index == self.index {
            return;
        }
        self.previous = Some((self.index, now));
        self.index = index;
        self.opened = now;
        self.progress = 0.;
    }
    /// Opens a moment without a fade (the pixel lab's starting moment).
    pub fn start_at(&mut self, index: usize) {
        if index < self.holds.len() {
            self.index = index;
        }
    }
    /// Advances the open dot unless the moment is `held`.
    pub fn tick(&mut self, now: Instant, held: bool) {
        let elapsed = self.ticked.map_or(Duration::ZERO, |at| now - at);
        self.ticked = Some(now);
        if held {
            return;
        }
        self.progress += elapsed.as_secs_f32() / self.holds[self.index];
        if self.progress >= 1. {
            self.open((self.index + 1) % self.holds.len(), now);
        }
    }
    /// Each moment on screen with its opacity in the cross-fade and its
    /// clock's `moment` (`None`: at rest). At rest only the open one shows.
    pub fn shown(&self, now: Instant, rest: bool) -> Vec<(usize, f32, Option<f32>)> {
        if rest {
            return vec![(self.index, 1., None)];
        }
        let since = |at: Instant| (now - at).as_secs_f32();
        let opening = since(self.opened);
        let mut shown = vec![(
            self.index,
            paint::ease(((opening - FADE_LAG) / FADE).clamp(0., 1.)),
            Some(opening),
        )];
        if let Some((index, at)) = self.previous {
            let out = 1. - paint::ease((since(at) / FADE).clamp(0., 1.));
            if out > 0. && index != self.index {
                shown.insert(0, (index, out, None));
            }
        }
        shown
    }
    /// The opacity a moment's copy shows at, in step with its picture.
    pub fn opacity(&self, index: usize, now: Instant, rest: bool) -> f32 {
        self.shown(now, rest)
            .into_iter()
            .find(|(shown, ..)| *shown == index)
            .map_or(0., |(_, opacity, _)| opacity)
    }
}

/// `.onboarding-value-stage`: the moments on screen, stacked and cross-fading.
pub fn stage(
    t: &Theme,
    picture: Picture,
    cast: Cast,
    scenes: &[Scene],
    carousel: &Carousel,
    now: Instant,
    rest: bool,
) -> Div {
    let motion = carousel.motion(now, rest);
    carousel.shown(now, rest).into_iter().fold(
        div().relative().size(px(picture.side)).flex_none(),
        |stage, (index, opacity, moment)| {
            let scene = (scenes[index])(t, picture, Clock { moment, motion }, cast);
            stage.child(div().absolute().inset_0().opacity(opacity).child(scene))
        },
    )
}

/// `.onboarding-value-dots`: one per moment (`(id, accessible label)`),
/// named `<prefix>-<id>`; the open one is a bar filled to `fill`.
pub fn dots(
    t: &Theme,
    prefix: &'static str,
    moments: impl IntoIterator<Item = (&'static str, &'static str)>,
    open: usize,
    fill: f32,
    on_select: OnSelect,
) -> Div {
    let ink = t.text;
    h_flex()
        .flex_none()
        .items_center()
        .gap(px(2.))
        .children(
            moments
                .into_iter()
                .enumerate()
                .map(move |(index, (id, label))| {
                    let is_open = index == open;
                    let name = SharedString::from(format!("{prefix}-{id}"));
                    let group = SharedString::from(format!("{prefix}-group-{id}"));
                    let on_select = on_select.clone();
                    BaseButton::new(name.clone())
                        .debug_selector(move || name.to_string())
                        .accessibility_label(label)
                        .group(group.clone())
                        .h(px(22.))
                        .w(px(if is_open { 34. } else { 22. }))
                        .rounded(px(11.))
                        .cursor(theme::clickable_cursor())
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .relative()
                                .h(px(6.))
                                .w(px(if is_open { 22. } else { 6. }))
                                .rounded(px(3.))
                                .bg(theme::alpha(ink, 0.22))
                                .group_hover(group, |s| s.bg(theme::alpha(ink, 0.4)))
                                .when(is_open, |d| {
                                    d.child(
                                        div()
                                            .absolute()
                                            .left_0()
                                            .top_0()
                                            .h(px(6.))
                                            .w(px(22. * fill))
                                            .rounded(px(3.))
                                            .bg(theme::alpha(ink, 0.62)),
                                    )
                                }),
                        )
                        .on_click(move |_, window, cx| on_select(index, window, cx))
                }),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const HOLDS: &[f32] = &[4., 4.5, 5.];

    fn after(start: Instant, seconds: f32) -> Instant {
        start + Duration::from_secs_f32(seconds)
    }

    #[test]
    fn each_moment_opens_the_next_when_its_dot_is_full_and_the_last_leads_back() {
        let mut carousel = Carousel::new(HOLDS);
        let start = Instant::now();
        carousel.tick(start, false);
        carousel.tick(after(start, 3.9), false);
        assert_eq!(carousel.index(), 0);
        carousel.tick(after(start, 4.05), false);
        assert_eq!((carousel.index(), carousel.fill(false)), (1, 0.));
        carousel.tick(after(start, 8.6), false);
        assert_eq!(carousel.index(), 2);
        carousel.tick(after(start, 13.7), false);
        assert_eq!(carousel.index(), 0);
    }

    #[test]
    fn a_held_moment_does_not_move_on() {
        let mut carousel = Carousel::new(HOLDS);
        let start = Instant::now();
        carousel.tick(start, false);
        carousel.tick(after(start, 2.), false);
        // Pointing at the moments holds the dot where it is, however long.
        carousel.tick(after(start, 30.), true);
        assert_eq!(carousel.index(), 0);
        assert!((carousel.fill(false) - 0.5).abs() < 0.01);
        carousel.tick(after(start, 31.), false);
        assert!((carousel.fill(false) - 0.75).abs() < 0.01);
    }

    #[test]
    fn opening_a_moment_fades_the_open_one_out() {
        let mut carousel = Carousel::new(HOLDS);
        let start = Instant::now();
        carousel.open(2, start);
        let shown = carousel.shown(after(start, 0.1), false);
        assert_eq!(
            shown.iter().map(|(index, ..)| *index).collect::<Vec<_>>(),
            [0, 2]
        );
        // The incoming one waits its lag; the outgoing one is gone after the fade.
        assert!(shown[1].1 < 0.001, "{}", shown[1].1);
        let settled = carousel.shown(after(start, 1.), false);
        assert_eq!((settled.len(), settled[0].0, settled[0].1), (1, 2, 1.));
        // At rest only the open moment shows, every step ended, the dot full.
        assert_eq!(carousel.shown(after(start, 0.1), true), vec![(2, 1., None)]);
        assert_eq!(carousel.fill(true), 1.);
    }
}

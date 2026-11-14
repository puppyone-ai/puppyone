//! First run's moments: port of `OnboardingValueCarousel`,
//! `OnboardingValueHub`, `OnboardingValueScenes`, the first-run rules of
//! `styles/onboarding.css` and `onboarding-value-{carousel,hub}.css` at
//! qubits 67b1e3865 (ahead of the v0.4.4 pin; copy from
//! `assets/onboarding-value.json`).
//!
//! Three moments play in turn beside the first-run column, in this order:
//! what Agents make is kept as yours ([`hub`]), you change it by pointing at
//! it ([`edit`]), and any Agent can be handed its link ([`forward`]). The
//! open dot fills as its moment plays and opens the next when full; pointing
//! at the page or the empty-state intro holds it, and with reduced motion (or
//! in the pixel lab) nothing moves on by itself and every moment rests on its
//! outcome.
use super::Homepage;
use crate::localization::t as tr;
use crate::theme::{self, Theme};
use crate::ui::appearance::ActiveAppearance as _;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use std::time::{Duration, Instant};

mod edit;
mod forward;
mod hub;
mod paint;

/// `VALUE_SLIDES`: each moment's id and how long it holds.
const MOMENTS: [(&str, f32); 3] = [("assets", 4.), ("edit", 4.5), ("forward", 5.)];
/// `.onboarding-value-slide` and `.onboarding-brand-copy` cross-fade:
/// `opacity 420ms ease`, the incoming one `120ms` later.
const FADE: f32 = 0.42;
const FADE_LAG: f32 = 0.12;

/// The picture's size steps with the window (`.onboarding-home-value` and
/// its media queries).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Layout {
    /// `--onboarding-hub-size`: the picture's side.
    pub hub: f32,
    /// `--onboarding-hub-scale`: the scenes' 380px drawing at this size.
    pub scale: f32,
    /// Between the picture and the column.
    pub gap: f32,
    /// `--onboarding-column-width` on first run.
    pub column: f32,
}
pub(super) fn layout(width: f32) -> Layout {
    if width >= 1040. {
        Layout { hub: 270., scale: 0.71, gap: 64., column: 400. }
    } else if width >= 860. {
        Layout { hub: 250., scale: 0.66, gap: 48., column: 400. }
    } else {
        Layout { hub: 220., scale: 0.58, gap: 32., column: 340. }
    }
}

/// Which moment is open, since when, and how far its dot has filled.
pub(in crate::app::home) struct Moments {
    index: usize,
    opened: Instant,
    /// The moment fading out, and since when.
    previous: Option<(usize, Instant)>,
    /// The open dot's fill, 0..1.
    progress: f32,
    ticked: Option<Instant>,
    /// The pointer is over the picture or the column (`:hover` holds it).
    pub(in crate::app::home) hovered: bool,
    /// When the pictures' endless motion (orbits, drift) started.
    since: Instant,
}
impl Default for Moments {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            index: 0,
            opened: now,
            previous: None,
            progress: 0.,
            ticked: None,
            hovered: false,
            since: now,
        }
    }
}
impl Moments {
    fn open(&mut self, index: usize, now: Instant) {
        if index == self.index {
            return;
        }
        self.previous = Some((self.index, now));
        self.index = index;
        self.opened = now;
        self.progress = 0.;
    }
    /// Advances the open dot; a full one opens the next moment.
    fn tick(&mut self, now: Instant, holding: bool) {
        let elapsed = self.ticked.map_or(Duration::ZERO, |at| now - at);
        self.ticked = Some(now);
        if holding {
            return;
        }
        self.progress += elapsed.as_secs_f32() / MOMENTS[self.index].1;
        if self.progress >= 1. {
            self.open((self.index + 1) % MOMENTS.len(), now);
        }
    }
    /// The pixel lab opens a moment by its case (`home-empty-<moment>`).
    #[cfg(feature = "dev-capture")]
    pub(in crate::app::home) fn lab(&mut self, scenario: &str) {
        if let Some(index) = MOMENTS
            .iter()
            .position(|(id, _)| scenario.contains(&format!("home-empty-{id}")))
        {
            self.index = index;
        }
    }
    /// Each moment's opacity in the cross-fade, and the scene's time (`None`:
    /// at rest).
    fn shown(&self, now: Instant, rest: bool) -> Vec<(usize, f32, Option<f32>)> {
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
}

impl Homepage {
    /// The first-run row: the moments' picture with its dots beside the
    /// column (`.onboarding-home-value`).
    pub(super) fn first_run_row(
        &mut self,
        width: f32,
        column: AnyElement,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let now = Instant::now();
        let rest = crate::lab::settled() || cx.reduce_motion();
        if !rest {
            let holding = self.moments.hovered || self.intro.is_some();
            self.moments.tick(now, holding);
            window.request_animation_frame();
        }
        let layout = layout(width);
        let drift = if rest {
            None
        } else {
            Some((now - self.moments.since).as_secs_f32())
        };
        let stage = self
            .moments
            .shown(now, rest)
            .into_iter()
            .fold(div().relative().size(px(layout.hub)).flex_none(), |stage, (index, opacity, time)| {
                let scene = match index {
                    0 => hub::scene(&t, layout, drift),
                    1 => edit::scene(&t, layout.scale, time),
                    _ => forward::scene(&t, layout.scale, time),
                };
                stage.child(div().absolute().inset_0().opacity(opacity).child(scene))
            });
        let carousel = v_flex()
            .flex_none()
            .items_center()
            .gap(px(14.))
            .child(stage)
            .child(self.moment_dots(&t, rest, cx));
        h_flex()
            .id("home-value")
            .w_full()
            .min_w_0()
            .items_center()
            .justify_center()
            .gap(px(layout.gap))
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                s.moments.hovered = *hovered;
                cx.notify();
            }))
            .child(carousel)
            .child(column)
            .into_any_element()
    }

    /// `.onboarding-value-dots`: one per moment; the open one is a bar that
    /// fills as its moment plays (full at rest, as with no animation).
    fn moment_dots(&self, t: &Theme, rest: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let ink = t.text;
        let fill = if rest { 1. } else { self.moments.progress.clamp(0., 1.) };
        h_flex()
            .flex_none()
            .items_center()
            .gap(px(2.))
            .children(MOMENTS.iter().enumerate().map(|(index, (id, _))| {
                let open = index == self.moments.index;
                let group = SharedString::from(format!("home-value-dot-{index}"));
                div()
                    .id(SharedString::from(format!("home-value-dot-{id}")))
                    .group(group.clone())
                    .h(px(22.))
                    .w(px(if open { 34. } else { 22. }))
                    .rounded(px(11.))
                    .cursor(theme::clickable_cursor())
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        div()
                            .relative()
                            .h(px(6.))
                            .w(px(if open { 22. } else { 6. }))
                            .rounded(px(3.))
                            .bg(theme::alpha(ink, 0.22))
                            .group_hover(group, |s| s.bg(theme::alpha(ink, 0.4)))
                            .when(open, |d| {
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
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.moments.open(index, Instant::now());
                        cx.notify();
                    }))
            }))
    }

    /// `.onboarding-brand-moments`: every moment's title and line in one
    /// cell, so the keys below never move as they change; only the open one
    /// shows.
    pub(super) fn moment_copy(&self, cx: &App) -> impl IntoElement {
        let t = cx.palette();
        let rest = crate::lab::settled() || cx.reduce_motion();
        let shown = self.moments.shown(Instant::now(), rest);
        div()
            .w_full()
            .grid()
            .grid_cols(1)
            .grid_rows(1)
            .children(MOMENTS.iter().enumerate().map(move |(index, (id, _))| {
                let opacity = shown
                    .iter()
                    .find(|(shown, _, _)| *shown == index)
                    .map_or(0., |(_, opacity, _)| *opacity);
                v_flex()
                    .row_start(1)
                    .col_start(1)
                    .gap(px(12.))
                    .opacity(opacity)
                    .child(
                        div()
                            .text_color(t.text)
                            .text_size(px(theme::ty().ui.display))
                            .line_height(relative(1.28))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(tr(&format!("onboarding.value.{id}.title"))),
                    )
                    .child(
                        div()
                            .text_color(t.muted)
                            .text_size(px(theme::ty().ui.body))
                            .line_height(relative(1.6))
                            .child(tr(&format!("onboarding.value.{id}.body"))),
                    )
            }))
    }
}

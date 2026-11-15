//! First run's moments beside the column: port of the first-run rules of
//! `styles/onboarding.css` and `MinimalOnboarding`'s `OnboardingValueCarousel`
//! at qubits 67b1e3865 (ahead of the v0.4.4 pin; copy from
//! `assets/onboarding-value.json`).
//!
//! Three moments ([`crate::ui::moments`]) play in turn, in this order: what
//! Agents make is kept as yours, you change it by pointing at it, and any Agent
//! can be handed its link. Pointing at the row or the empty-state intro holds
//! the open one; with reduced motion (or in the pixel lab) nothing moves on by
//! itself and every moment rests on its outcome.
use super::Homepage;
use crate::localization::t as tr;
use crate::theme;
use crate::ui::appearance::ActiveAppearance as _;
use crate::ui::moments::{self, Carousel, Cast, Picture, Scene, edit, forward, hub};
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use std::{rc::Rc, time::Instant};

/// One moment: its copy keys (`onboarding.value.<id>.*`) and the picture it
/// plays.
struct Moment {
    id: &'static str,
    scene: Scene,
}
/// `VALUE_SLIDES`, in their fixed order, and how long each holds before the
/// next opens. A new moment is one more row in both, with its copy in
/// `assets/onboarding-value.json`.
const MOMENTS: [Moment; 3] = [
    Moment {
        id: "assets",
        scene: hub::scene,
    },
    Moment {
        id: "edit",
        scene: edit::scene,
    },
    Moment {
        id: "forward",
        scene: forward::scene,
    },
];
const HOLDS: &[f32] = &[4., 4.5, 5.];
/// First run's cast: the pile is the person's project, and ChatGPT is
/// handed the link.
const CAST: Cast = Cast {
    center: "onboarding.value.center",
    agent: "chatgpt",
};

/// First run's moments, as the Homepage keeps them.
pub(in crate::app::home) fn carousel() -> Carousel {
    Carousel::new(HOLDS)
}

/// The picture's size steps with the window (`.onboarding-home-value` and
/// its media queries).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Layout {
    pub picture: Picture,
    /// Between the picture and the column.
    pub gap: f32,
    /// `--onboarding-column-width` on first run.
    pub column: f32,
}
pub(super) fn layout(width: f32) -> Layout {
    let (side, scale, gap, column) = if width >= 1040. {
        (270., 0.71, 64., 400.)
    } else if width >= 860. {
        (250., 0.66, 48., 400.)
    } else {
        (220., 0.58, 32., 340.)
    };
    Layout {
        picture: Picture { side, scale },
        gap,
        column,
    }
}

/// Nothing moves on by itself and every moment shows its outcome: with
/// reduced motion, and in the pixel lab, as the reference finishes its
/// animations before capturing.
fn at_rest(cx: &App) -> bool {
    #[cfg(feature = "dev-capture")]
    let lab = crate::lab::settled();
    #[cfg(not(feature = "dev-capture"))]
    let lab = false;
    lab || cx.reduce_motion()
}

impl Homepage {
    /// The pixel lab opens a moment by its case (`home-empty-<moment>`).
    #[cfg(feature = "dev-capture")]
    pub(in crate::app::home) fn lab_moment(&mut self, scenario: &str) {
        if let Some(index) = MOMENTS
            .iter()
            .position(|moment| scenario.contains(&format!("home-empty-{}", moment.id)))
        {
            self.moments.start_at(index);
        }
    }

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
        let rest = at_rest(cx);
        if !rest {
            let held = self.moments_hovered || self.intro.is_some();
            self.moments.tick(now, held);
            window.request_animation_frame();
        }
        let layout = layout(width);
        let scenes = MOMENTS.map(|moment| moment.scene);
        let entity = cx.entity().downgrade();
        let on_select: moments::OnSelect = Rc::new(move |index, _, cx| {
            let _ = entity.update(cx, |s, cx| {
                s.moments.open(index, Instant::now());
                cx.notify();
            });
        });
        let dots = moments::dots(
            &t,
            "home-value-dot",
            MOMENTS.iter().map(|moment| {
                (
                    moment.id,
                    tr(&format!("onboarding.value.{}.label", moment.id)),
                )
            }),
            self.moments.index(),
            self.moments.fill(rest),
            on_select,
        );
        let carousel = v_flex()
            .flex_none()
            .items_center()
            .gap(px(14.))
            .child(moments::stage(
                &t,
                layout.picture,
                CAST,
                &scenes,
                &self.moments,
                now,
                rest,
            ))
            .child(dots);
        h_flex()
            .id("home-value")
            .w_full()
            .min_w_0()
            .items_center()
            .justify_center()
            .gap(px(layout.gap))
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                s.moments_hovered = *hovered;
                cx.notify();
            }))
            .child(carousel)
            .child(column)
            .into_any_element()
    }

    /// `.onboarding-brand-moments`: every moment's title and line in one
    /// cell, so the keys below never move as they change; only the open one
    /// shows.
    pub(super) fn moment_copy(&self, cx: &App) -> impl IntoElement {
        let t = cx.palette();
        let (now, rest) = (Instant::now(), at_rest(cx));
        div()
            .w_full()
            .grid()
            .grid_cols(1)
            .grid_rows(1)
            .children(MOMENTS.iter().enumerate().map(|(index, moment)| {
                let key = |part: &str| tr(&format!("onboarding.value.{}.{part}", moment.id));
                v_flex()
                    .row_start(1)
                    .col_start(1)
                    .gap(px(12.))
                    .opacity(self.moments.opacity(index, now, rest))
                    .child(
                        div()
                            .text_color(t.text)
                            .text_size(px(theme::ty().ui.display))
                            .line_height(relative(1.28))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(key("title")),
                    )
                    .child(
                        div()
                            .text_color(t.muted)
                            .text_size(px(theme::ty().ui.body))
                            .line_height(relative(1.6))
                            .child(key("body")),
                    )
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn every_moment_has_its_hold_and_the_picture_steps_down_with_the_window() {
        assert_eq!(MOMENTS.len(), HOLDS.len());
        assert_eq!(layout(1280.).picture.side, 270.);
        assert_eq!(layout(1039.).picture.side, 250.);
        let narrow = layout(720.);
        assert_eq!((narrow.picture.side, narrow.column), (220., 340.));
        // The smallest window still holds the picture beside the column.
        assert!(narrow.picture.side + narrow.gap + narrow.column <= 720. - 2. * 28.);
    }
}

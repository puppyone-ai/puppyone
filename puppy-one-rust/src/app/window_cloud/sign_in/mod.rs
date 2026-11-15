//! `CloudSignInDialog` (`cloud-sign-in-dialog.css` / `v3.html`): explains what
//! signing in unlocks before opening the browser OAuth flow, with first run's
//! stacked-files and link-handoff moments ([`crate::ui::moments`]) at `228px`
//! (`0.6` scale), labelled for Cloud and handing the link to Grok Bot.
use super::WindowCloud;
use crate::app::dialogs::DialogKey;
use crate::features::cloud::account::{self, Status};
use crate::localization::t as tr;
use crate::theme;
use crate::ui::{
    appearance::ActiveAppearance as _,
    components::{Button, ButtonVariant, Icon, IconButton, ProductIcon},
    loading::{LoaderSize, LoadingMark, Tone},
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Dialog as BaseDialog, h_flex, v_flex},
    component::Sizable as _,
};
use std::time::Instant;

use crate::ui::moments::{self, Carousel, Cast, Picture, Scene, forward, hub, paint};

const PICTURE: Picture = Picture {
    side: 228.,
    scale: 0.6,
};
/// The pile is Cloud, and Grok Bot is handed the link.
const CAST: Cast = Cast {
    center: "cloud.productName",
    agent: "grok-bot",
};

struct Moment {
    id: &'static str,
    label: &'static str,
    title: &'static str,
    body: &'static str,
    scene: Scene,
}

const MOMENTS: [Moment; 2] = [
    Moment {
        id: "cloud",
        label: "cloud.auth.explainer.cloud.label",
        title: "cloud.auth.explainer.cloud.title",
        body: "cloud.auth.explainer.cloud.body",
        scene: hub::scene,
    },
    Moment {
        id: "share",
        label: "cloud.auth.explainer.share.label",
        title: "cloud.auth.explainer.share.title",
        body: "cloud.auth.explainer.share.body",
        scene: forward::scene,
    },
];
/// How long each moment holds before the next opens.
const HOLDS: &[f32] = &[4., 5.];

fn at_rest(cx: &App) -> bool {
    #[cfg(feature = "dev-capture")]
    if crate::lab::settled() {
        return true;
    }
    cx.reduce_motion()
}

pub(in crate::app) struct SignInDialog {
    carousel: Carousel,
    /// The pointer is over the carousel, which holds the open moment.
    hovered: bool,
    primary_focus: FocusHandle,
    focused_initial: bool,
    submitted: bool,
    submitted_epoch: Option<u64>,
}

impl SignInDialog {
    fn new(cx: &mut Context<WindowCloud>) -> Self {
        Self {
            carousel: Carousel::new(HOLDS),
            hovered: false,
            primary_focus: cx.focus_handle(),
            focused_initial: false,
            submitted: false,
            submitted_epoch: None,
        }
    }

    #[cfg(test)]
    pub(in crate::app) fn active_moment(&self) -> &'static str {
        MOMENTS[self.carousel.index()].id
    }

    #[cfg(test)]
    pub(in crate::app) fn active_title(&self) -> &'static str {
        tr(MOMENTS[self.carousel.index()].title)
    }

    #[cfg(test)]
    pub(in crate::app) fn advance_for_test(&mut self, by: std::time::Duration) {
        let now = Instant::now();
        self.carousel.tick(now, self.hovered);
        self.carousel.tick(now + by, self.hovered);
    }

    #[cfg(test)]
    pub(in crate::app) fn primary_focused(&self, window: &Window) -> bool {
        self.primary_focus.is_focused(window)
    }
}

impl WindowCloud {
    /// Opens `CloudSignInDialog` before browser OAuth (`HeaderSignInButton`,
    /// `Navigate::SignIn`). Already-authenticated windows ignore it.
    pub(in crate::app) fn open_sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if account::has_account(cx) {
            return;
        }
        self.show_popover(None, cx);
        let state = SignInDialog::new(cx);
        let primary = state.primary_focus.clone();
        self.sign_in = Some(state);
        self.open_dialog(DialogKey::SignIn, cx);
        self.dialog_focus.focus(window, cx);
        primary.focus(window, cx);
        cx.notify();
    }

    pub(in crate::app) fn close_sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.sign_in.take().is_some() {
            self.close_dialog(DialogKey::SignIn, cx);
            self.focus_window(window, cx);
            cx.notify();
        }
    }

    /// Closes the explainer automatically as soon as an account session lands.
    pub(super) fn sync_sign_in(&mut self, cx: &mut Context<Self>) {
        if self.sign_in.is_some() && account::has_account(cx) {
            self.sign_in = None;
            self.close_dialog(DialogKey::SignIn, cx);
        }
    }

    fn submit_sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(state) = self.sign_in.as_mut() {
            state.submitted = true;
            state.submitted_epoch = account::snapshot(cx).map(|s| s.epoch);
        }
        if !account::sign_in_or_reopen(cx) {
            self.close_sign_in(window, cx);
            return;
        }
        cx.notify();
    }

    pub(super) fn sign_in_dialog(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if account::has_account(cx) {
            return Empty.into_any_element();
        }
        let t = cx.palette();
        let rest = at_rest(cx);
        let now = Instant::now();
        let (
            stage,
            active_index,
            fill,
            opacities,
            primary_focus,
            needs_focus,
            submitted,
            submitted_epoch,
        ) = {
            let Some(state) = self.sign_in.as_mut() else {
                return Empty.into_any_element();
            };
            if !rest {
                state.carousel.tick(now, state.hovered);
                window.request_animation_frame();
            }
            let needs_focus = !state.focused_initial;
            state.focused_initial = true;
            let scenes = MOMENTS.map(|moment| moment.scene);
            let carousel = &state.carousel;
            (
                moments::stage(&t, PICTURE, CAST, &scenes, carousel, now, rest),
                carousel.index(),
                carousel.fill(rest),
                (0..MOMENTS.len())
                    .map(|index| carousel.opacity(index, now, rest))
                    .collect::<Vec<_>>(),
                state.primary_focus.clone(),
                needs_focus,
                state.submitted,
                state.submitted_epoch,
            )
        };
        if needs_focus {
            let focus = primary_focus.clone();
            window.defer(cx, move |window, cx| focus.focus(window, cx));
        }

        let entity = cx.entity().downgrade();
        let on_select: moments::OnSelect = std::rc::Rc::new(move |index, _, cx| {
            let _ = entity.update(cx, |s, cx| {
                if let Some(state) = s.sign_in.as_mut() {
                    state.carousel.open(index, Instant::now());
                    cx.notify();
                }
            });
        });
        let dots = moments::dots(
            &t,
            "cloud-sign-in-dot",
            MOMENTS.iter().map(|moment| (moment.id, tr(moment.label))),
            active_index,
            fill,
            on_select,
        );
        let carousel = v_flex()
            .id("cloud-sign-in-carousel")
            .debug_selector(|| "cloud-sign-in-carousel".into())
            .flex_none()
            .items_center()
            .gap(px(10.))
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                if let Some(state) = s.sign_in.as_mut()
                    && state.hovered != *hovered
                {
                    state.hovered = *hovered;
                    cx.notify();
                }
            }))
            .child(stage)
            .child(dots);

        let eyebrow = h_flex()
            .items_center()
            .gap(px(6.))
            .mb(px(10.))
            .text_color(t.brand_blue)
            .text_size(px(theme::font_size(12.5)))
            .line_height(relative(1.3))
            .font_weight(FontWeight::SEMIBOLD)
            .child(
                Icon::product(ProductIcon::Cloud)
                    .with_size(px(15.))
                    .stroke(2.)
                    .color(t.brand_blue),
            )
            .child(tr("cloud.productName"));

        let moments_copy = div().w_full().grid().grid_cols(1).grid_rows(1).children(
            MOMENTS.iter().enumerate().map(|(index, moment)| {
                let opacity = opacities[index];
                v_flex()
                    .row_start(1)
                    .col_start(1)
                    .min_w_0()
                    .opacity(opacity)
                    .child(
                        div()
                            .text_color(t.text)
                            .text_size(px(theme::font_size(22.)))
                            .line_height(relative(1.3))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(tr(moment.title)),
                    )
                    .child(
                        div()
                            .mt(px(10.))
                            .text_color(t.muted)
                            .text_size(px(theme::font_size(13.5)))
                            .line_height(relative(1.6))
                            .child(tr(moment.body)),
                    )
            }),
        );

        let actions = v_flex()
            .w_full()
            .mt(px(24.))
            .gap(px(4.))
            .child(
                Button::new("cloud-sign-in-primary")
                    .debug_selector(|| "cloud-sign-in-primary".into())
                    .variant(ButtonVariant::Brand)
                    .w_full()
                    .track_focus(&primary_focus)
                    .label(tr("cloud.auth.explainer.submit"))
                    .trailing(
                        Icon::new("external-link")
                            .with_size(px(14.))
                            .stroke(1.8)
                            .color(theme::on_solid()),
                    )
                    .on_click(cx.listener(|s, _, window, cx| s.submit_sign_in(window, cx))),
            )
            .child(
                Button::new("cloud-sign-in-later")
                    .debug_selector(|| "cloud-sign-in-later".into())
                    .variant(ButtonVariant::Ghost)
                    .w_full()
                    .h(px(30.))
                    .px(px(10.))
                    .rounded(px(6.))
                    .text_size(px(theme::font_size(13.)))
                    .line_height(px(theme::font_size(13.)))
                    .font_weight(FontWeight::NORMAL)
                    .label(tr("cloud.auth.explainer.later"))
                    .on_click(cx.listener(|s, _, window, cx| s.close_sign_in(window, cx))),
            );

        let snapshot = account::snapshot(cx);
        let signing_in = snapshot
            .as_ref()
            .is_some_and(|s| s.status == Status::SigningIn);
        let auth_error = submitted
            .then(|| {
                account::unavailable(cx).or_else(|| {
                    let s = snapshot.as_ref()?;
                    (Some(s.epoch) != submitted_epoch
                        && s.status != Status::SigningIn
                        && s.account.is_none())
                    .then_some(s.error)
                    .flatten()
                })
            })
            .flatten()
            .map(|e| e.to_string());

        let viewport = window.viewport_size();
        let viewport_w = f32::from(viewport.width);
        let narrow = viewport_w <= 660.;

        let copy = v_flex()
            .min_w_0()
            .map(|d| if narrow { d.w_full() } else { d.w(px(268.)) })
            .child(eyebrow)
            .child(moments_copy)
            .child(actions)
            .when(signing_in, |d| {
                d.child(
                    h_flex()
                        .id("cloud-sign-in-status")
                        .debug_selector(|| "cloud-sign-in-status".into())
                        .mt(px(10.))
                        .items_center()
                        .gap(px(6.))
                        .text_size(px(theme::ty().ui.meta))
                        .line_height(relative(1.5))
                        .text_color(t.muted)
                        .child(
                            LoadingMark::new("cloud-sign-in-loading")
                                .size(LoaderSize::Xs)
                                .tone(Tone::Neutral),
                        )
                        .child(tr("cloud.home.waitingForSignIn")),
                )
            })
            .when_some(auth_error, |d, message| {
                d.child(
                    div()
                        .id("cloud-sign-in-error")
                        .debug_selector(|| "cloud-sign-in-error".into())
                        .mt(px(10.))
                        .text_size(px(theme::ty().ui.meta))
                        .line_height(relative(1.5))
                        .text_color(t.danger)
                        .child(message),
                )
            });

        let close_button = div().absolute().top(px(12.)).right(px(12.)).child(
            IconButton::new("cloud-sign-in-close", "dialog-close")
                .debug_selector(|| "cloud-sign-in-close".into())
                .label(tr("cloud.common.close"))
                .no_tooltip()
                .with_size(px(24.))
                .color(t.subtle)
                .on_click(cx.listener(|s, _, window, cx| s.close_sign_in(window, cx))),
        );

        let layout = if narrow {
            v_flex()
                .w(px((viewport_w - 32.).clamp(0., 360.)))
                .items_center()
                .gap(px(24.))
                .pt(px(32.))
                .px(px(24.))
                .pb(px(24.))
                .child(carousel)
                .child(copy)
        } else {
            h_flex()
                .items_center()
                .gap(px(40.))
                .pt(px(36.))
                .pb(px(30.))
                .pl(px(34.))
                .pr(px(40.))
                .child(carousel)
                .child(copy)
        };

        let surface = div()
            .id("cloud-sign-in-dialog")
            .debug_selector(|| "cloud-sign-in-dialog".into())
            .occlude()
            .relative()
            .max_w(viewport.width - px(32.))
            .max_h(viewport.height - px(32.))
            .border_1()
            .border_color(t.border)
            .rounded(px(theme::metric::TASK_DIALOG_RADIUS))
            .bg(t.overlay)
            .text_color(t.text)
            .shadow(vec![paint::shadow(t.shadow, px(24.), px(48.), px(0.))])
            .child(layout)
            .child(close_button);

        let host = self.weak.clone();
        BaseDialog::new(cx)
            .focus_handle(self.dialog_focus.clone())
            .close_on_escape(true)
            .close_on_backdrop_press(true)
            .on_ok(|_, _, _| false)
            .on_cancel(move |_, window, cx| {
                let _ = host.update(cx, |s, cx| s.close_sign_in(window, cx));
                false
            })
            .backdrop(div().size_full().bg(t.backdrop))
            .popup(surface)
            .into_any_element()
    }
}

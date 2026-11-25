//! The sidebar card (`.sc`: the screen folded to a row or unfolded to a
//! preview, its title and status, Wake and the fold toggle) and the live
//! screen that moves between the card and the main area (`.shell`), with
//! the main area's `Take control` / `Release control`, for
//! [`super::CloudScreen`].
use super::{
    CloudScreen, ScreenLayout, StreamPhase,
    motion::{Card, Place, Pose, STAGE_RADIUS},
};
use crate::{
    geometry::Rect,
    localization::{t as tr, tf},
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Icon, tooltip},
    },
    workspace::cloud::sandbox::ScreenAvailability,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
use std::sync::Arc;

/// What the card's status line says.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    Running,
    Provisioning,
    Asleep,
    Disconnected,
    Off,
}

impl CloudScreen {
    fn status(&self, cx: &App) -> Status {
        // The computer on this computer runs whether or not it has a
        // desktop yet; its display can still drop.
        if let Some(screen) = self.local_screen(cx) {
            use crate::features::computer_mode::Screen;
            return match screen {
                Screen::Asleep => Status::Asleep,
                Screen::Starting => Status::Provisioning,
                Screen::Workspace { .. } => Status::Running,
                Screen::Desktop { .. } if self.phase == StreamPhase::Failed => Status::Disconnected,
                Screen::Desktop { .. } => Status::Running,
            };
        }
        match self.sandbox.availability() {
            ScreenAvailability::Stream { .. } => match self.phase {
                StreamPhase::Asleep => Status::Asleep,
                StreamPhase::Failed => Status::Disconnected,
                StreamPhase::Idle | StreamPhase::Connecting | StreamPhase::Connected => {
                    Status::Running
                }
            },
            ScreenAvailability::Preview | ScreenAvailability::Install { pending: true } => {
                Status::Provisioning
            }
            ScreenAvailability::Install { pending: false }
            | ScreenAvailability::StreamOff
            | ScreenAvailability::Unavailable => Status::Off,
        }
    }

    /// The sidebar card at the top of the Explorer, while the Explorer shows.
    pub fn render_card(
        &self,
        entity: &Entity<Self>,
        layout: &ScreenLayout,
        cx: &App,
    ) -> Option<AnyElement> {
        let card = layout.card?;
        let t = cx.palette();
        let ty = theme::ty();
        let status = self.status(cx);
        let on = self.shown;
        let live = layout.shown.is_some();
        let unfold = layout.shown.map_or(0., |s| s.pose.unfold);
        let tint = theme::alpha(t.hover, 0.86);
        let quiet = theme::alpha(t.sidebar_text, 0.35);
        let (dot, line) = match status {
            Status::Running => (
                t.success,
                match &self.operator {
                    Some(name) => tf(
                        "native.screen.operating",
                        &[("name", name.to_string().into())],
                    )
                    .into(),
                    None => SharedString::from(tr(if self.is_local() {
                        "cloud.sandbox.screen.status.running-device"
                    } else {
                        "cloud.sandbox.screen.status.running-cloud"
                    })),
                },
            ),
            Status::Provisioning => (
                t.warning,
                tr("cloud.sandbox.screen.status.provisioning").into(),
            ),
            Status::Asleep => (quiet, tr("cloud.sandbox.screen.status.asleep").into()),
            Status::Disconnected => (quiet, tr("native.screen.disconnected").into()),
            Status::Off => (quiet, tr("cloud.sandbox.screen.status.desktop-off").into()),
        };

        // While the screen is over the main area, the row mirrors its live
        // picture; without a picture the slot holds a still: a desktop while
        // the screen comes up, an unlit one otherwise.
        let mirror = layout
            .shown
            .filter(|_| on)
            .and_then(|_| Some((self.frame_image.clone()?, self.frame_dims?)))
            .and_then(|(image, (fw, fh))| {
                let slot = card.slot(unfold);
                let radius = Card::radius(unfold);
                let pose = Pose {
                    rect: slot,
                    radius,
                    unfold,
                    opacity: 1.,
                    fit: 0.,
                };
                let shot = pose.picture(fw, fh)?;
                Some(
                    div()
                        .absolute()
                        .left(px(slot.x))
                        .top(px(slot.y))
                        .w(px(slot.w))
                        .h(px(slot.h))
                        .rounded(px(radius))
                        .child(picture(image, slot, shot, radius).absolute().inset_0())
                        .child(
                            div()
                                .absolute()
                                .inset_0()
                                .rounded(px(radius))
                                .border_1()
                                .border_color(theme::alpha(t.text, 0.08)),
                        ),
                )
            });
        let still = (!live).then(|| {
            let slot = card.slot(0.);
            let lit = status == Status::Running || status == Status::Provisioning;
            let (from, to) = theme::screen_thumb_wallpaper();
            div()
                .absolute()
                .left(px(slot.x))
                .top(px(slot.y))
                .w(px(slot.w))
                .h(px(slot.h))
                .rounded(px(Card::radius(0.)))
                .overflow_hidden()
                .when(lit, |d| {
                    d.bg(linear_gradient(
                        135.,
                        linear_color_stop(from, 0.),
                        linear_color_stop(to, 1.),
                    ))
                    .child(
                        div()
                            .absolute()
                            .left(px(slot.w * 0.18))
                            .top(px(slot.h * 0.22))
                            .w(px(slot.w * 0.64))
                            .h(px(slot.h * 0.52))
                            .rounded(px(2.))
                            .bg(theme::screen_thumb_window(true)),
                    )
                })
                .when(!lit, |d| d.bg(theme::alpha(t.text, 0.06)))
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .rounded(px(Card::radius(0.)))
                        .border_1()
                        .border_color(theme::alpha(t.text, 0.08)),
                )
        });

        let asleep = status == Status::Asleep;
        // Folding is for a live picture beside the main area.
        let foldable = live && !on;
        let (meta_x, meta_y) = card.meta(unfold);
        let end = if asleep {
            76.
        } else if foldable {
            36.
        } else {
            12.
        };
        let meta = v_flex()
            .absolute()
            .left(px(meta_x))
            .top(px(meta_y))
            .w(px((card.w - meta_x - end).max(0.)))
            .gap(px(3.))
            .child(
                div()
                    .truncate()
                    .text_size(px(ty.left.content))
                    .line_height(px(18.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if on { t.text } else { t.sidebar_text })
                    .child(tr("cloud.sandbox.screen.title")),
            )
            .child(
                h_flex()
                    .gap(px(6.))
                    .items_center()
                    .min_w_0()
                    .child(div().size(px(6.)).flex_shrink_0().rounded_full().bg(dot))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(ty.ui.meta))
                            .line_height(px(16.))
                            .text_color(t.subtle)
                            .child(line),
                    ),
            );

        let toggle = foldable.then(|| {
            let folded = unfold < 0.5;
            let fold_screen = entity.clone();
            div()
                .id("cloud-screen-card-toggle")
                .debug_selector(|| "cloud-screen-card-toggle".into())
                .absolute()
                .right(px(6.))
                .top(px(card.toggle_top(unfold)))
                .size(px(24.))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.))
                .text_color(t.muted)
                .opacity(0.)
                .group_hover("cloud-screen-card", |s| s.opacity(1.))
                .hover(|s| s.bg(t.hover).text_color(t.text))
                .cursor(theme::clickable_cursor())
                .tooltip(tooltip(tr(if folded {
                    "native.screen.unfold"
                } else {
                    "native.screen.fold"
                })))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    fold_screen.update(cx, |s, cx| s.toggle_fold(cx));
                })
                .child(
                    // It unfolds upwards, from the Explorer's bottom edge.
                    Icon::new(if folded { "chevron-up" } else { "chevron-down" })
                        .with_size(px(14.)),
                )
        });

        let wake = asleep.then(|| {
            let wake_screen = entity.clone();
            div()
                .id("cloud-screen-card-wake")
                .debug_selector(|| "cloud-screen-card-wake".into())
                .absolute()
                .right(px(Card::PAD))
                .top(px((Card::ROW - 24.) / 2.))
                .h(px(24.))
                .px(px(10.))
                .flex()
                .items_center()
                .rounded(px(6.))
                .bg(theme::alpha(t.text, 0.06))
                .text_size(px(ty.ui.meta))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .cursor(theme::clickable_cursor())
                .hover(|s| s.bg(theme::alpha(t.text, 0.1)))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    wake_screen.update(cx, |s, cx| s.wake(cx));
                })
                .child(tr("cloud.sandbox.screen.wake"))
        });

        let open_screen = entity.clone();
        Some(
            div()
                .w_full()
                .px(px(Card::INSET_X))
                .pb(px(Card::INSET_BOTTOM))
                .bg(t.sidebar)
                .child(
                    div()
                        .id("cloud-screen-card")
                        .debug_selector(|| "cloud-screen-card".into())
                        .group("cloud-screen-card")
                        .relative()
                        .w_full()
                        .h(px(card.height(unfold)))
                        .rounded(px(Card::RADIUS))
                        .when(on, |d| d.bg(tint))
                        .when(!on, |d| d.hover(|s| s.bg(tint)))
                        .cursor(theme::clickable_cursor())
                        .on_click(move |_, window, cx| {
                            open_screen.update(cx, |s, cx| s.open(window, cx));
                        })
                        // The title slides under the picture as the card unfolds.
                        .child(meta)
                        .children(mirror)
                        .children(still)
                        .children(toggle)
                        .children(wake),
                )
                .into_any_element(),
        )
    }

    /// The live screen where it is this frame: in the card's slot, over the
    /// main area, or between them. It never shows past the Explorer's edge
    /// unless it is moving to or from the main area.
    pub fn render_live(
        &self,
        entity: &Entity<Self>,
        layout: &ScreenLayout,
        cx: &App,
    ) -> Option<AnyElement> {
        let shown = layout.shown?;
        let image = self.frame_image.clone()?;
        let (fw, fh) = self.frame_dims?;
        if shown.place == Place::Away && !shown.moving {
            return None;
        }
        let pose = shown.pose;
        let shot = pose.picture(fw, fh)?;
        let stage = layout.stage;
        let right = if shown.crosses || shown.place == Place::Stage {
            stage.right()
        } else {
            stage.x
        };
        // Landed, it is drawn inside the main area; on its way it crosses
        // from the Explorer.
        let left = if shown.place == Place::Stage && !shown.moving {
            stage.x
        } else {
            layout.clip_x
        };
        let clip = Rect::new(left, stage.y, right - left, stage.h);
        if clip.w <= 0. {
            return None;
        }
        let on_stage = shown.place == Place::Stage && !shown.moving;
        let t = cx.palette();
        let preview = shown.place == Place::Card { unfolded: true } && !shown.moving;
        let (rect, radius) = (pose.rect, pose.radius);
        let screen = div()
            .id("cloud-screen-live")
            .debug_selector(|| "cloud-screen-live".into())
            .group("cloud-screen-live")
            .absolute()
            .left(px(rect.x - clip.x))
            .top(px(rect.y - clip.y))
            .w(px(rect.w))
            .h(px(rect.h))
            .rounded(px(radius))
            .opacity(pose.opacity)
            // A screen: dark where a picture of another shape leaves room,
            // standing on the main area with a soft shadow as it lands.
            .bg(theme::screen_surface())
            // A blurred shadow is not clipped, so it fades out within the
            // margin at the sides and top (`STAGE_MARGIN`).
            .shadow(vec![BoxShadow {
                color: theme::alpha(theme::screen_stage_shadow(t.dark), pose.fit).into(),
                offset: point(px(0.), px(10. * pose.fit)),
                blur_radius: px(20. * pose.fit),
                spread_radius: px(-4. * pose.fit),
                inset: false,
            }])
            .child(picture(image, rect, shot, radius).absolute().inset_0())
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(radius))
                    .border_1()
                    .border_color(theme::alpha(t.text, 0.08)),
            )
            .when(preview, |d| d.child(grow_hint()))
            .when(on_stage, |d| d.child(self.stage_controls(entity)));
        Some(
            div()
                .absolute()
                .left(px(clip.x))
                .top(px(clip.y))
                .w(px(clip.w))
                .h(px(clip.h))
                .overflow_hidden()
                .child(screen)
                .into_any_element(),
        )
    }

    /// Over the open screen: `Take control` on hover, `Release control`
    /// while taken, or Connecting while the stream comes back.
    fn stage_controls(&self, entity: &Entity<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        if self.phase != StreamPhase::Connected {
            return div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .child(
                    pill()
                        .h(px(30.))
                        .px(px(12.))
                        .text_size(px(ty.meta))
                        .child(tr("cloud.sandbox.screen.connecting")),
                )
                .into_any_element();
        }

        if self.interactive {
            let release = entity.clone();
            return div()
                .absolute()
                .top(px(12.))
                .left_0()
                .right_0()
                .flex()
                .justify_center()
                .child(
                    pill()
                        .id("cloud-screen-release-control")
                        .debug_selector(|| "cloud-screen-release-control".into())
                        .h(px(30.))
                        .pl(px(12.))
                        .pr(px(7.))
                        .gap(px(8.))
                        .text_size(px(ty.meta))
                        .cursor(theme::clickable_cursor())
                        .hover(|s| s.bg(theme::screen_overlay_hover()))
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(move |_, _, cx| {
                            cx.stop_propagation();
                            release.update(cx, |s, cx| s.release_control(cx));
                        })
                        .child(tr("cloud.sandbox.screen.release-control"))
                        .child(
                            div()
                                .px(px(5.))
                                .py(px(2.))
                                .rounded(px(4.))
                                .bg(theme::screen_overlay_border())
                                .font_family(theme::mono())
                                .text_size(px(ty.caption))
                                .text_color(theme::screen_overlay_muted())
                                .child(tr("cloud.sandbox.screen.release-shortcut")),
                        ),
                )
                .into_any_element();
        }

        let take = entity.clone();
        div()
            .absolute()
            .inset_0()
            .rounded(px(STAGE_RADIUS))
            .flex()
            .items_center()
            .justify_center()
            .group_hover("cloud-screen-live", |s| s.bg(theme::screen_veil()))
            .child(
                pill()
                    .id("cloud-screen-take-control")
                    .debug_selector(|| "cloud-screen-take-control".into())
                    .h(px(36.))
                    .px(px(16.))
                    .gap(px(7.))
                    .text_size(px(ty.control))
                    .opacity(0.)
                    .group_hover("cloud-screen-live", |s| s.opacity(1.))
                    .hover(|s| s.bg(theme::screen_overlay_hover()))
                    .cursor(theme::clickable_cursor())
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, window, cx| {
                        cx.stop_propagation();
                        take.update(cx, |s, cx| s.take_control(window, cx));
                    })
                    .child(Icon::new("mouse-pointer-2").with_size(px(14.)).stroke(2.))
                    .child(tr("cloud.sandbox.screen.take-control")),
            )
            // A computer on this computer can be put to sleep from its screen.
            .when(self.is_local(), |d| {
                let sleep = entity.clone();
                d.child(
                    pill()
                        .id("local-screen-sleep")
                        .debug_selector(|| "local-screen-sleep".into())
                        .absolute()
                        .top(px(12.))
                        .right(px(12.))
                        .h(px(30.))
                        .px(px(12.))
                        .gap(px(6.))
                        .text_size(px(ty.meta))
                        .opacity(0.)
                        .group_hover("cloud-screen-live", |s| s.opacity(1.))
                        .hover(|s| s.bg(theme::screen_overlay_hover()))
                        .cursor(theme::clickable_cursor())
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(move |_, _, cx| {
                            cx.stop_propagation();
                            sleep.update(cx, |s, cx| s.sleep_local(cx));
                        })
                        .child(Icon::new("moon").with_size(px(13.)).stroke(2.))
                        .child(tr("onboarding.computerMode.screen.sleepAction")),
                )
            })
            .into_any_element()
    }
}

/// The frame painted as `picture` (window coordinates) inside the element
/// at `rect`, its corners rounded where it shows.
fn picture(image: Arc<RenderImage>, rect: Rect, picture: Rect, radius: f32) -> Canvas<()> {
    let offset = point(px(picture.x - rect.x), px(picture.y - rect.y));
    let extent = size(px(picture.w), px(picture.h));
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let picture = Bounds {
                origin: bounds.origin + offset,
                size: extent,
            };
            let _ = window.paint_image(bounds, picture, Corners::all(px(radius)), image, 0, false);
        },
    )
}

/// `.pill`: a dark glass capsule over the live picture in either theme.
fn pill() -> Div {
    h_flex()
        .items_center()
        .rounded_full()
        .bg(theme::screen_overlay_surface())
        .border_1()
        .border_color(theme::screen_overlay_border())
        .shadow(vec![BoxShadow {
            color: theme::screen_pill_shadow().into(),
            offset: point(px(0.), px(10.)),
            blur_radius: px(30.),
            spread_radius: px(0.),
            inset: false,
        }])
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme::screen_overlay_ink())
}

/// `.grow-hint`: the preview's corner says it opens larger.
fn grow_hint() -> impl IntoElement {
    pill()
        .absolute()
        .top(px(8.))
        .right(px(8.))
        .h(px(24.))
        .px(px(6.))
        .opacity(0.)
        .group_hover("cloud-screen-live", |s| s.opacity(1.))
        .child(Icon::new("maximize-2").with_size(px(12.)).stroke(2.))
}

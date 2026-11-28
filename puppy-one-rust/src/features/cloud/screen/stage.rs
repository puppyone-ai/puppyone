//! What the screen says about itself (its [`ScreenState`] and status line,
//! which the Header's Computer button and its hover preview read), the
//! live screen over the main area (`.shell`) as it grows in or fades out,
//! and the main area's `Take control` / `Release control`, for
//! [`super::CloudScreen`].
use super::{
    CloudScreen, ScreenLayout, StreamPhase,
    motion::{Place, STAGE_RADIUS},
};
use crate::{
    geometry::Rect,
    localization::{t as tr, tf},
    theme,
    ui::{appearance::ActiveAppearance, components::Icon},
    workspace::cloud::sandbox::ScreenAvailability,
};
use gpui::{prelude::*, *};
use gpui_kit::{base::h_flex, component::Sizable as _};
use std::sync::Arc;

/// Where the computer stands, as its status line says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScreenState {
    Running,
    Provisioning,
    Asleep,
    Disconnected,
    Off,
}

impl CloudScreen {
    /// Where the computer stands now.
    pub fn state(&self, cx: &App) -> ScreenState {
        // The computer on this computer runs whether or not it has a
        // desktop yet; its display can still drop.
        if let Some(screen) = self.local_screen(cx) {
            use crate::features::computer_mode::Screen;
            return match screen {
                Screen::Asleep => ScreenState::Asleep,
                Screen::Starting => ScreenState::Provisioning,
                Screen::Workspace { .. } => ScreenState::Running,
                Screen::Desktop { .. } if self.phase == StreamPhase::Failed => {
                    ScreenState::Disconnected
                }
                Screen::Desktop { .. } => ScreenState::Running,
            };
        }
        match self.sandbox.availability() {
            ScreenAvailability::Stream { .. } => match self.phase {
                StreamPhase::Asleep => ScreenState::Asleep,
                StreamPhase::Failed => ScreenState::Disconnected,
                StreamPhase::Idle | StreamPhase::Connecting | StreamPhase::Connected => {
                    ScreenState::Running
                }
            },
            ScreenAvailability::Preview | ScreenAvailability::Install { pending: true } => {
                ScreenState::Provisioning
            }
            ScreenAvailability::Install { pending: false }
            | ScreenAvailability::StreamOff
            | ScreenAvailability::Unavailable => ScreenState::Off,
        }
    }

    /// The status line under the computer's name: who works there, else
    /// where it stands.
    pub fn status_line(&self, cx: &App) -> SharedString {
        match self.state(cx) {
            ScreenState::Running => match &self.operator {
                Some(name) => tf(
                    "native.screen.operating",
                    &[("name", name.to_string().into())],
                )
                .into(),
                None => tr(if self.is_local() {
                    "cloud.sandbox.screen.status.running-device"
                } else {
                    "cloud.sandbox.screen.status.running-cloud"
                })
                .into(),
            },
            ScreenState::Provisioning => tr("cloud.sandbox.screen.status.provisioning").into(),
            ScreenState::Asleep => tr("cloud.sandbox.screen.status.asleep").into(),
            ScreenState::Disconnected => tr("native.screen.disconnected").into(),
            ScreenState::Off => tr("cloud.sandbox.screen.status.desktop-off").into(),
        }
    }

    /// The Agent at work in this computer now, by name.
    pub fn operator(&self) -> Option<&SharedString> {
        self.operator.as_ref()
    }

    /// The latest picture of the desktop and its size, while it streams.
    pub fn preview_frame(&self, cx: &App) -> Option<(Arc<RenderImage>, (u32, u32))> {
        if !self.live(cx) {
            return None;
        }
        Some((self.frame_image.clone()?, self.frame_dims?))
    }

    /// The live screen where it is this frame: over the main area, or
    /// growing in or fading out there.
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
        // It never leaves the main area, which clips it while it grows in or
        // fades out.
        let clip = stage;
        if clip.w <= 0. {
            return None;
        }
        let on_stage = shown.place == Place::Stage && !shown.moving;
        let t = cx.palette();
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

//! Sidebar top entry (`CloudScreenSidebarEntry`), Full-Pane explicit takeover
//! controls (`Take control` / `Release control` / `Full screen`), and the
//! persistent bottom-right PiP window (`288×180`) for [`super::CloudScreen`].
use super::{CloudScreen, StreamPhase, glyph, keys::fit_bounds};
use crate::{
    geometry::Rect,
    localization::t as tr,
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
use std::time::Duration;

pub(super) const PIP_WIDTH: f32 = 288.;
pub(super) const PIP_HEIGHT: f32 = 180.;
pub(super) const PIP_INSET: f32 = 16.;
pub(super) const PIP_RADIUS: f32 = 10.;
const MORPH_DURATION_MS: u64 = 320;

#[derive(Clone, Copy, PartialEq, Eq)]
enum SidebarScreenState {
    Running,
    Provisioning,
    Asleep,
    Inactive,
}

fn ease_out_cubic(t: f32) -> f32 {
    1. - (1. - t).powi(3)
}

impl CloudScreen {
    fn sidebar_state(&self) -> SidebarScreenState {
        match self.sandbox.availability() {
            ScreenAvailability::Stream { .. } => match self.phase {
                StreamPhase::Asleep => SidebarScreenState::Asleep,
                StreamPhase::Failed => SidebarScreenState::Inactive,
                StreamPhase::Idle | StreamPhase::Connecting | StreamPhase::Connected => {
                    SidebarScreenState::Running
                }
            },
            ScreenAvailability::Preview | ScreenAvailability::Install { pending: true } => {
                SidebarScreenState::Provisioning
            }
            ScreenAvailability::Install { pending: false }
            | ScreenAvailability::StreamOff
            | ScreenAvailability::Unavailable => SidebarScreenState::Inactive,
        }
    }

    pub fn render_thumbnail(&self, entity: &Entity<Self>, cx: &App) -> Option<AnyElement> {
        if !self.entry_available(cx) {
            return None;
        }
        let t = cx.palette();
        let ty = theme::ty().ui;
        let active = self.shown;
        let state = self.sidebar_state();
        let live_art = matches!(
            state,
            SidebarScreenState::Running | SidebarScreenState::Provisioning
        );
        let (dot_color, status_key) = match state {
            SidebarScreenState::Running => (t.success, "cloud.sandbox.screen.status.running-cloud"),
            SidebarScreenState::Provisioning => {
                (t.warning, "cloud.sandbox.screen.status.provisioning")
            }
            SidebarScreenState::Asleep => (
                theme::alpha(t.sidebar_text, 0.35),
                "cloud.sandbox.screen.status.asleep",
            ),
            SidebarScreenState::Inactive => (
                theme::alpha(t.sidebar_text, 0.35),
                "cloud.sandbox.screen.status.desktop-off",
            ),
        };
        let (wp_start, wp_end) = theme::screen_thumb_wallpaper();
        let thumb = div()
            .relative()
            .w(px(52.))
            .h(px(34.))
            .flex_shrink_0()
            .rounded(px(7.))
            .overflow_hidden()
            .border_1()
            .border_color(theme::alpha(t.text, 0.12))
            .when(live_art, |d| {
                d.bg(linear_gradient(
                    135.,
                    linear_color_stop(wp_start, 0.),
                    linear_color_stop(wp_end, 1.),
                ))
            })
            .when(!live_art, |d| d.bg(theme::alpha(t.text, 0.08)))
            .child(
                div()
                    .absolute()
                    .left(px(8.))
                    .top(px(7.))
                    .w(px(30.))
                    .h(px(19.))
                    .rounded(px(3.))
                    .bg(theme::screen_thumb_window(live_art)),
            )
            .when(live_art, |d| {
                d.child(
                    div()
                        .absolute()
                        .right(px(4.))
                        .bottom(px(4.))
                        .size(px(4.))
                        .rounded_full()
                        .bg(dot_color),
                )
            });

        let open_screen = entity.clone();
        let wake_screen = entity.clone();
        let entry = h_flex()
            .id("cloud-screen-thumbnail")
            .debug_selector(|| "cloud-screen-thumbnail".into())
            .flex_1()
            .min_w_0()
            .h_full()
            .gap(px(10.))
            .items_center()
            .cursor(theme::clickable_cursor())
            .tooltip(tooltip(tr("cloud.sandbox.screen.open")))
            .on_click(move |_, window, cx| {
                open_screen.update(cx, |s, cx| s.open(window, cx));
            })
            .child(thumb)
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(ty.caption))
                            .line_height(px(16.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(if active { t.text } else { t.sidebar_text })
                            .child(tr("cloud.sandbox.screen.title")),
                    )
                    .child(
                        h_flex()
                            .gap(px(5.))
                            .items_center()
                            .min_w_0()
                            .child(
                                div()
                                    .size(px(6.))
                                    .flex_shrink_0()
                                    .rounded_full()
                                    .bg(dot_color),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(ty.micro))
                                    .line_height(px(14.))
                                    .text_color(t.muted)
                                    .child(tr(status_key)),
                            ),
                    ),
            );

        let mut row = h_flex()
            .w_full()
            .h(px(50.))
            .px(px(6.))
            .gap(px(6.))
            .items_center()
            .rounded(px(8.))
            .when(active, |d| d.bg(t.selected))
            .when(!active, |d| d.hover(|s| s.bg(t.hover)))
            .child(entry);

        if state == SidebarScreenState::Asleep {
            row = row.child(
                div()
                    .id("cloud-screen-sidebar-wake")
                    .debug_selector(|| "cloud-screen-sidebar-wake".into())
                    .h(px(24.))
                    .px(px(8.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(6.))
                    .bg(theme::alpha(t.text, 0.08))
                    .text_size(px(ty.micro))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.sidebar_text)
                    .cursor(theme::clickable_cursor())
                    .hover(|s| s.bg(t.active).text_color(t.text))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, _, cx| {
                        wake_screen.update(cx, |s, cx| s.wake(cx));
                    })
                    .child(tr("cloud.sandbox.screen.wake")),
            );
        }

        Some(
            div()
                .w_full()
                .pt(px(8.))
                .pb(px(6.))
                .px(px(8.))
                .border_b_1()
                .border_color(t.sidebar_divider)
                .child(row)
                .into_any_element(),
        )
    }

    pub(super) fn pip_visible(&self, cx: &App) -> bool {
        !self.shown
            && !self.pip_hidden
            && self.entry_available(cx)
            && matches!(
                self.sandbox.availability(),
                ScreenAvailability::Stream { .. }
            )
            && self.phase == StreamPhase::Connected
            && self.frame_image.is_some()
    }

    pub fn render_pip(&self, entity: &Entity<Self>, editor: Rect, cx: &App) -> Option<AnyElement> {
        if !self.pip_visible(cx) {
            return None;
        }
        let image = self.frame_image.clone()?;
        let (fw, fh) = self.frame_dims?;
        let t = cx.palette();
        let ty = theme::ty().ui;

        let target_x = (editor.w - PIP_WIDTH - PIP_INSET).max(PIP_INSET);
        let target_y = (editor.h - PIP_HEIGHT - PIP_INSET).max(PIP_INSET);
        let pip_bounds = Bounds {
            origin: point(px(0.), px(0.)),
            size: size(px(PIP_WIDTH), px(PIP_HEIGHT)),
        };
        let fitted = fit_bounds(pip_bounds, fw, fh);

        let expand_entity = entity.clone();
        let hide_entity = entity.clone();
        let surface = theme::screen_overlay_surface();
        let hover_bg = theme::screen_overlay_hover();
        let ink = theme::screen_overlay_ink();
        let border = theme::screen_overlay_border();

        let card = div()
            .id("cloud-screen-pip")
            .debug_selector(|| "cloud-screen-pip".into())
            .group("cloud-screen-pip")
            .occlude()
            .overflow_hidden()
            .bg(theme::screen_pip_surface())
            .border_1()
            .border_color(border)
            .shadow(vec![BoxShadow {
                color: theme::screen_pip_shadow().into(),
                offset: point(px(0.), px(14.)),
                blur_radius: px(34.),
                spread_radius: px(0.),
                inset: false,
            }])
            .when_some(fitted, |d, rect| {
                d.child(
                    img(image)
                        .absolute()
                        .left(rect.origin.x)
                        .top(rect.origin.y)
                        .w(rect.size.width)
                        .h(rect.size.height),
                )
            })
            .child(
                div()
                    .id("cloud-screen-pip-expand")
                    .debug_selector(|| "cloud-screen-pip-expand".into())
                    .absolute()
                    .inset_0()
                    .cursor(theme::clickable_cursor())
                    .tooltip(tooltip(tr("cloud.sandbox.screen.expand")))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, window, cx| {
                        expand_entity.update(cx, |s, cx| s.open(window, cx));
                    }),
            )
            .child(
                h_flex()
                    .absolute()
                    .left(px(8.))
                    .top(px(8.))
                    .h(px(22.))
                    .px(px(8.))
                    .gap(px(5.))
                    .items_center()
                    .rounded_full()
                    .bg(surface)
                    .border_1()
                    .border_color(border)
                    .text_size(px(ty.micro))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(ink)
                    .child(div().size(px(6.)).rounded_full().bg(t.success))
                    .child(tr("cloud.sandbox.screen.title")),
            )
            .child(
                div()
                    .id("cloud-screen-pip-close")
                    .debug_selector(|| "cloud-screen-pip-close".into())
                    .absolute()
                    .right(px(8.))
                    .top(px(8.))
                    .size(px(22.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(surface)
                    .border_1()
                    .border_color(border)
                    .text_color(ink)
                    .opacity(0.)
                    .group_hover("cloud-screen-pip", |s| s.opacity(1.))
                    .hover(move |s| s.bg(hover_bg))
                    .cursor(theme::clickable_cursor())
                    .tooltip(tooltip(tr("cloud.sandbox.screen.hide-pip")))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, _, cx| {
                        hide_entity.update(cx, |s, cx| s.hide_pip(cx));
                        cx.stop_propagation();
                    })
                    .child(Icon::new("x").with_size(px(12.)).stroke(2.)),
            );

        let animate = self.transition_seq > 0 && !cfg!(test) && !cx.reduce_motion();
        if animate {
            let ew = editor.w;
            let eh = editor.h;
            Some(
                card.absolute()
                    .with_animation(
                        ("cloud-screen-pip-morph", self.transition_seq),
                        Animation::new(Duration::from_millis(MORPH_DURATION_MS)),
                        move |d, delta| {
                            let k = ease_out_cubic(delta);
                            let x = target_x * k;
                            let y = target_y * k;
                            let w = ew + (PIP_WIDTH - ew) * k;
                            let h = eh + (PIP_HEIGHT - eh) * k;
                            let r = PIP_RADIUS * k;
                            d.left(px(x)).top(px(y)).w(px(w)).h(px(h)).rounded(px(r))
                        },
                    )
                    .into_any_element(),
            )
        } else {
            Some(
                card.absolute()
                    .left(px(target_x))
                    .top(px(target_y))
                    .w(px(PIP_WIDTH))
                    .h(px(PIP_HEIGHT))
                    .rounded(px(PIP_RADIUS))
                    .into_any_element(),
            )
        }
    }

    pub(super) fn render_stage_controls(
        &self,
        fullscreen: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let surface = theme::screen_overlay_surface();
        let hover_bg = theme::screen_overlay_hover();
        let ink = theme::screen_overlay_ink();
        let muted = theme::screen_overlay_muted();
        let border = theme::screen_overlay_border();

        if self.interactive {
            let pill = h_flex()
                .id("cloud-screen-release-control")
                .debug_selector(|| "cloud-screen-release-control".into())
                .h(px(30.))
                .px(px(12.))
                .gap(px(7.))
                .items_center()
                .rounded_full()
                .bg(surface)
                .border_1()
                .border_color(border)
                .text_size(px(ty.caption))
                .font_weight(FontWeight::MEDIUM)
                .text_color(ink)
                .cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(hover_bg))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(|s, _, _, cx| {
                    s.release_control(cx);
                    cx.stop_propagation();
                }))
                .child(div().size(px(6.)).rounded_full().bg(t.success))
                .child(tr("cloud.sandbox.screen.release-control"))
                .child(
                    div()
                        .px(px(5.))
                        .py(px(1.))
                        .rounded(px(4.))
                        .bg(border)
                        .font_family(theme::MONO)
                        .text_size(px(ty.micro))
                        .text_color(muted)
                        .child(tr("cloud.sandbox.screen.release-shortcut")),
                );
            return div()
                .absolute()
                .top(px(12.))
                .left_0()
                .right_0()
                .flex()
                .justify_center()
                .child(pill)
                .into_any_element();
        }

        let take_btn = h_flex()
            .id("cloud-screen-take-control")
            .debug_selector(|| "cloud-screen-take-control".into())
            .h(px(36.))
            .px(px(16.))
            .gap(px(7.))
            .items_center()
            .rounded_full()
            .bg(surface)
            .border_1()
            .border_color(border)
            .text_size(px(ty.control))
            .font_weight(FontWeight::MEDIUM)
            .text_color(ink)
            .opacity(0.)
            .group_hover("cloud-screen-stage", |s| s.opacity(1.))
            .hover(move |s| s.bg(hover_bg))
            .cursor(theme::clickable_cursor())
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(cx.listener(|s, _, window, cx| {
                s.take_control(window, cx);
                cx.stop_propagation();
            }))
            .child(Icon::new("mouse-pointer-2").with_size(px(14.)).stroke(2.))
            .child(tr("cloud.sandbox.screen.take-control"));

        let fs_label = if fullscreen {
            tr("cloud.sandbox.screen.exit-fullscreen")
        } else {
            tr("cloud.sandbox.screen.fullscreen")
        };
        let fs_btn = h_flex()
            .id("cloud-screen-fullscreen")
            .debug_selector(|| "cloud-screen-fullscreen".into())
            .absolute()
            .right(px(14.))
            .bottom(px(14.))
            .h(px(30.))
            .px(px(11.))
            .gap(px(6.))
            .items_center()
            .rounded_full()
            .bg(surface)
            .border_1()
            .border_color(border)
            .text_size(px(ty.caption))
            .font_weight(FontWeight::MEDIUM)
            .text_color(ink)
            .opacity(0.)
            .group_hover("cloud-screen-stage", |s| s.opacity(1.))
            .hover(move |s| s.bg(hover_bg))
            .cursor(theme::clickable_cursor())
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(|_, window, cx| {
                window.toggle_fullscreen();
                cx.stop_propagation();
            })
            .child(glyph::fullscreen_glyph(12., ink))
            .child(fs_label);

        div()
            .absolute()
            .inset_0()
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(take_btn),
            )
            .child(fs_btn)
            .into_any_element()
    }
}

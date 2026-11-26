//! The Header's Computer button (`CloudWorkspaceComputerTool`): the Cloud
//! Computer of a hosted project, or Computer Mode's computer on this
//! computer, beside the window's other tools. It is a workspace tool, so it
//! lives in the Header rather than among the files.
//!
//! - A press opens the computer's screen over the main area, or closes it
//!   back to the files (the button stays selected while it is open).
//! - While an Agent works there, a small dot on the button says so.
//! - Resting on the button while the screen is closed previews the live
//!   desktop after a moment and says who is using it; it leaves with the
//!   pointer and never takes it.
use super::window_cloud::WindowCloud;
use super::*;
use crate::features::cloud::ScreenState;
use crate::localization::t as tr;
use crate::ui::components::{Button, ButtonVariant, Icon, SurfaceFrame};
use gpui_kit::base::{Positioner, Selectable as _, h_flex};
use std::{cell::Cell, rc::Rc, sync::Arc, time::Duration};

/// Where the Header's Computer button is: its preview hangs under it.
pub(super) type ComputerAnchor = Rc<Cell<Bounds<Pixels>>>;
/// Long enough that passing over the Header shows nothing.
const PEEK_DELAY: Duration = Duration::from_millis(300);
const PEEK_WIDTH: f32 = 288.;
const PEEK_PAD: f32 = 8.;
const PEEK_RADIUS: f32 = 6.;

/// `frame` shown whole inside `bounds`, centred.
fn contain(bounds: Bounds<Pixels>, (fw, fh): (u32, u32)) -> Option<Bounds<Pixels>> {
    let (w, h) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
    let (fw, fh) = (fw as f32, fh as f32);
    if fw <= 0. || fh <= 0. || w <= 0. || h <= 0. {
        return None;
    }
    let scale = (w / fw).min(h / fh);
    let size = size(px(fw * scale), px(fh * scale));
    Some(Bounds {
        origin: point(
            bounds.origin.x + (bounds.size.width - size.width) / 2.,
            bounds.origin.y + (bounds.size.height - size.height) / 2.,
        ),
        size,
    })
}

/// The desktop's latest picture, whole and centred in its box.
fn picture(image: Arc<RenderImage>, frame: (u32, u32)) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            if let Some(shown) = contain(bounds, frame) {
                let corners = Corners::all(px(PEEK_RADIUS));
                let _ = window.paint_image(bounds, shown, corners, image, 0, false);
            }
        },
    )
    .absolute()
    .inset_0()
}

impl WindowCloud {
    /// The Header's Computer button, while there is a computer screen to
    /// offer here.
    pub(super) fn computer_control(&self, cx: &App) -> Option<AnyElement> {
        let screen = self.screen.read(cx);
        if !screen.entry_available(cx) {
            return None;
        }
        let t = cx.palette();
        let shown = screen.is_shown(cx);
        let working = screen.operator().is_some() && screen.state(cx) == ScreenState::Running;
        let label = tr(if shown {
            "native.computer.close"
        } else {
            "native.computer.open"
        });
        let anchor = self.computer_anchor.clone();
        let hover = self.weak.clone();
        let mut control = div()
            .id("cloud-computer-tool")
            .relative()
            .flex_none()
            .on_hover(move |hovered, _, cx| {
                let _ = hover.update(cx, |s, cx| s.hover_computer(*hovered, cx));
            })
            .child(
                Button::new("cloud-computer")
                    .debug_selector(|| "header-cloud-computer".into())
                    .variant(ButtonVariant::Titlebar)
                    .icon(Icon::new("monitor").stroke(1.75))
                    .accessibility_label(label)
                    .selected(shown)
                    .w(px(theme::metric::TITLEBAR_TOOL_ACTION_WIDTH))
                    .on_click(self.listener(|s, _, window, cx| s.toggle_computer(window, cx))),
            )
            // An Agent at work there: a small dot on the screen's corner,
            // ringed in the Header's colour.
            .when(working, |d| {
                d.child(
                    div()
                        .debug_selector(|| "header-cloud-computer-working".into())
                        .absolute()
                        .top(px(8.))
                        .right(px(9.))
                        .size(px(7.))
                        .rounded_full()
                        .bg(t.success)
                        .border(px(1.5))
                        .border_color(t.header),
                )
            })
            .child(
                canvas(move |bounds, _, _| anchor.set(bounds), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            );
        if let Some(peek) = self.computer_peek_card(cx) {
            control = control.child(peek);
        }
        Some(control.into_any_element())
    }

    /// The pointer came onto the button or left it. The preview waits a
    /// moment, and never shows over the open screen.
    pub(super) fn hover_computer(&mut self, hovered: bool, cx: &mut Context<Self>) {
        self.computer_peek_timer = None;
        if !hovered || self.screen.read(cx).is_shown(cx) {
            if self.computer_peek {
                self.computer_peek = false;
                cx.notify();
            }
            return;
        }
        if self.computer_peek {
            return;
        }
        self.computer_peek_timer = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(PEEK_DELAY).await;
            let _ = this.update(cx, |s, cx| {
                s.computer_peek = true;
                cx.notify();
            });
        }));
    }

    /// A press on the button: the screen opens over the main area, or goes
    /// back to the files.
    pub(super) fn toggle_computer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.computer_peek = false;
        self.computer_peek_timer = None;
        self.agents_panel = false;
        self.screen.update(cx, |s, cx| {
            if s.is_shown(cx) {
                s.close(cx)
            } else {
                s.open(window, cx)
            }
        });
        cx.notify();
    }

    /// `CloudWorkspaceComputerPreview`: the live desktop at its own shape,
    /// then the computer's name and who works there (or where it stands).
    fn computer_peek_card(&self, cx: &App) -> Option<AnyElement> {
        if !self.computer_peek {
            return None;
        }
        let screen = self.screen.read(cx);
        if screen.is_shown(cx) {
            return None;
        }
        let t = cx.palette();
        let ty = theme::ty().ui;
        let inner = PEEK_WIDTH - 2. * PEEK_PAD;
        let height = (inner * 0.625).round();
        let state = screen.state(cx);
        let status = screen.status_line(cx);
        let frame: AnyElement = match screen.preview_frame(cx) {
            Some((image, dims)) => picture(image, dims).into_any_element(),
            None => div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(ty.meta))
                .text_color(theme::screen_overlay_muted())
                .child(status.clone())
                .into_any_element(),
        };
        let dot = match state {
            ScreenState::Running => Some(t.success),
            ScreenState::Provisioning => Some(t.warning),
            _ => None,
        };
        let card = SurfaceFrame::popover_card("cloud-computer-peek")
            .occlude(false)
            .debug_selector(|| "cloud-computer-peek".into())
            .w(px(PEEK_WIDTH))
            .p(px(PEEK_PAD))
            .child(
                div()
                    .relative()
                    .w(px(inner))
                    .h(px(height))
                    .rounded(px(PEEK_RADIUS))
                    .overflow_hidden()
                    .bg(theme::screen_surface())
                    .child(frame)
                    .child(
                        div()
                            .absolute()
                            .inset_0()
                            .rounded(px(PEEK_RADIUS))
                            .border_1()
                            .border_color(theme::alpha(t.text, 0.08)),
                    ),
            )
            .child(
                h_flex()
                    .items_center()
                    .gap(px(7.))
                    .px(px(2.))
                    .pt(px(8.))
                    .pb(px(1.))
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .children(dot.map(|dot| div().size(px(6.)).flex_none().rounded_full().bg(dot)))
                    .child(
                        div()
                            .flex_none()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("native.computer.title")),
                    )
                    .child(div().min_w_0().truncate().text_color(t.muted).child(status)),
            );
        let anchor = self.computer_anchor.get();
        let left = (f32::from(anchor.right()) - PEEK_WIDTH).max(8.);
        Some(
            deferred(
                Positioner::corner(Anchor::TopLeft, point(px(left), anchor.bottom() + px(6.)))
                    .margin(px(8.))
                    .child(card),
            )
            .with_priority(gpui_kit::base::POPUP_PRIORITY + 1)
            .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// The preview shows the whole desktop at its own shape, centred.
    #[test]
    fn the_preview_shows_the_whole_desktop_centred() {
        let bounds = Bounds {
            origin: point(px(10.), px(20.)),
            size: size(px(272.), px(170.)),
        };
        let wide = contain(bounds, (4, 2)).unwrap();
        assert_eq!(wide.size.width, px(272.));
        assert_eq!(wide.size.height, px(136.));
        assert_eq!(wide.origin.y, px(37.));
        let square = contain(bounds, (100, 100)).unwrap();
        assert_eq!(square.size, size(px(170.), px(170.)));
        assert_eq!(square.origin.x, px(61.));
        assert!(contain(bounds, (0, 10)).is_none());
    }
}

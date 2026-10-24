//! Port of `AuxiliaryWorkbenchCloseDialog` (`auxiliary-workbench-close-dialog.css`
//! over `DesktopDialog`). Closing a busy item asks first: a running chat uses
//! `createAgentChatCloseAdapter`'s copy, a live shell the terminal's.
use super::*;
use crate::localization::{t as tr, tf};
use crate::ui::{icon_stroke, tooltip};

/// `DesktopDialogSurface width={380}`.
const WIDTH: f32 = 380.;
/// `.desktop-dialog-backdrop` padding.
const INSET: f32 = 16.;

/// Copy of the `confirm` decision for one item (`AuxiliaryWorkbenchCloseDialogCopy`).
pub(super) struct CloseCopy {
    title: String,
    detail: &'static str,
    action: &'static str,
}

impl Workbench {
    pub(super) fn close_copy(&self, tab: Id, cx: &App) -> Option<CloseCopy> {
        let content = self.project()?.content.get(&tab)?;
        let title = content.title(cx);
        Some(match content {
            Content::Terminal(..) => CloseCopy {
                title: tf("terminal.closeDialog.title", &[("title", title.into())]),
                detail: tr("terminal.closeDialog.detail"),
                action: tr("terminal.closeDialog.confirm"),
            },
            _ => CloseCopy {
                title: tf("agent.closeDialog.activeTitle", &[("title", title.into())]),
                detail: tr("agent.closeDialog.activeDetail"),
                action: tr("common.action.close"),
            },
        })
    }
    /// Present the dialog for `tab`; the Cancel action takes initial focus
    /// (`data-desktop-dialog-initial-focus`).
    pub(super) fn request_close_confirmation(&mut self, tab: Id, cx: &mut Context<Self>) {
        self.confirm = Some(tab);
        self.close_choice = 0;
        self.close_keyboard = false;
        self.close_focus_pending = true;
        cx.notify();
    }
    pub(super) fn dismiss_close(&mut self, cx: &mut Context<Self>) {
        self.confirm = None;
        cx.notify();
    }
    /// Whether the window-level close dialog is up (gates native surfaces).
    pub fn dialog_open(&self) -> bool {
        self.confirm.is_some()
    }
    pub(super) fn render_close_dialog(
        &self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let tab = self.confirm?;
        let copy = self.close_copy(tab, cx)?;
        let t = Theme::new(self.dark);
        let m = theme::ty();
        let viewport = window.viewport_size();
        let width = WIDTH.min(f32::from(viewport.width) - 2. * INSET);
        // `.desktop-workbench-close-dialog-icon.is-danger`.
        let danger_icon = theme::mix(t.danger, t.muted, 0.74);
        let header = row()
            .items_center()
            .justify_between()
            .gap(px(16.))
            .pt(px(14.))
            .px(px(16.))
            .pb(px(6.))
            .child(
                row()
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .size(px(18.))
                            .flex_shrink_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(icon_stroke("circle-alert", 16., 1.7, danger_icon)),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .text_color(t.muted)
                            .text_size(px(m.right.content))
                            .line_height(px(m.right.control_line_height))
                            .font_weight(FontWeight::MEDIUM)
                            .child(copy.title.clone()),
                    ),
            )
            .child(
                // `DesktopDialogCloseButton`: 24px, its cross drawn in a 12px box.
                div()
                    .id("workbench-close-dialog-dismiss")
                    .size(px(24.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(6.))
                    .text_color(t.subtle)
                    .hover(|s| s.bg(t.active).text_color(t.muted))
                    .tooltip(tooltip(tr("common.action.close")))
                    .on_click(cx.listener(|s, _, _, cx| s.dismiss_close(cx)))
                    .child(
                        svg()
                            .path("icons/dialog-close.svg")
                            .size(px(12.))
                            .text_color(t.subtle),
                    ),
            );
        let body = div()
            .pt(px(6.))
            .pr(px(16.))
            .pb(px(16.))
            .pl(px(42.))
            .text_color(t.subtle)
            .text_size(px(m.right.meta))
            .line_height(px(m.right.meta_line_height))
            .child(copy.detail);
        let ring = |d: Stateful<Div>, on: bool| {
            d.when(on, |d| {
                d.shadow(vec![BoxShadow {
                    inset: false,
                    color: t.focus_ring.into(),
                    offset: point(px(0.), px(0.)),
                    blur_radius: px(0.),
                    spread_radius: px(2.),
                }])
            })
        };
        let action = |id: &'static str| {
            div()
                .id(id)
                .h(px(theme::control_compact()))
                .px(px(10.))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.))
                .border_1()
                .text_size(px(m.right.meta))
                .line_height(px(17.))
                .font_weight(FontWeight::MEDIUM)
        };
        // Neutral: `.po-button--neutral` is overridden in the features layer,
        // so it keeps its transparent face on hover.
        let cancel = ring(
            action("workbench-close-dialog-cancel")
                .border_color(theme::alpha(t.border, 0.))
                .text_color(t.muted)
                .on_click(cx.listener(|s, _, _, cx| s.dismiss_close(cx)))
                .child(tr("common.action.cancel")),
            self.close_keyboard && self.close_choice == 0,
        );
        let confirm = ring(
            action("workbench-close-dialog-confirm")
                .border_color(theme::alpha(t.danger, 0.22))
                .bg(theme::alpha(t.danger, 0.10))
                .text_color(theme::mix(t.danger, t.text, 0.84))
                .hover(|s| {
                    s.border_color(theme::alpha(t.danger, 0.30))
                        .bg(theme::alpha(t.danger, 0.15))
                        .text_color(t.danger)
                })
                .on_click(cx.listener(move |s, _, _, cx| s.close(tab, true, cx)))
                .child(copy.action),
            self.close_keyboard && self.close_choice == 1,
        );
        let footer = row()
            .justify_end()
            .items_center()
            .gap(px(6.))
            .px(px(16.))
            .pb(px(14.))
            // The footer's own `--po-overlay` fill equals the surface; GPUI
            // clips children to the rect, not the 10px corners, so it is not
            // repainted here.
            .child(cancel)
            .child(confirm);
        let surface = column()
            .id("workbench-close-dialog")
            .w(px(width))
            .overflow_hidden()
            .border_1()
            .border_color(t.border_subtle)
            .rounded(px(10.))
            .bg(t.overlay)
            .shadow(vec![BoxShadow {
                inset: false,
                color: Rgba {
                    a: t.shadow.a * 0.82,
                    ..t.shadow
                }
                .into(),
                offset: point(px(0.), px(18.)),
                blur_radius: px(42.),
                spread_radius: px(0.),
            }])
            .text_color(t.text)
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(header)
            .child(body)
            .child(footer);
        let backdrop = div()
            .id("workbench-close-dialog-backdrop")
            .track_focus(&self.close_focus)
            .occlude()
            .w(viewport.width)
            .h(viewport.height)
            .p(px(INSET))
            .flex()
            .items_center()
            .justify_center()
            .bg(t.backdrop)
            .font_family("Geist")
            // `dismissOnBackdrop`.
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|s, _, _, cx| s.dismiss_close(cx)),
            )
            .on_key_down(cx.listener(move |s, e: &KeyDownEvent, _, cx| {
                match e.keystroke.key.as_str() {
                    "escape" => s.dismiss_close(cx),
                    "tab" | "left" | "right" => {
                        s.close_choice = 1 - s.close_choice;
                        s.close_keyboard = true;
                        cx.notify();
                    }
                    "enter" | "space" => {
                        if s.close_choice == 1 {
                            s.close(tab, true, cx);
                        } else {
                            s.dismiss_close(cx);
                        }
                    }
                    _ => return,
                }
                cx.stop_propagation();
            }))
            .child(surface);
        Some(
            deferred(
                anchored()
                    .position(point(px(0.), px(0.)))
                    .position_mode(AnchoredPositionMode::Window)
                    .child(backdrop),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use core::prelude::v1::test;
    #[test]
    fn dialog_width_fits_the_window() {
        assert_eq!(super::WIDTH.min(420. - 2. * super::INSET), 380.);
        assert_eq!(super::WIDTH.min(300. - 2. * super::INSET), 268.);
    }
}

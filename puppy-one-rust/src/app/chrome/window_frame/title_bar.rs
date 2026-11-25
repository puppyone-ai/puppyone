//! Cross-platform title bar layout frame used by `app::header::TitleBar`.
//!
//! - macOS (`WindowControlsSide::Leading`): preserves the exact traffic-light
//!   leading inset and unchanged layout.
//! - Windows (`WindowControlsSide::Trailing`, `native_nonclient_window_controls`):
//!   places the compact application menu on the leading edge, lets GPUI's
//!   `WindowControlArea::Drag` (`HTCAPTION`) flow natively to `DefWindowProcW`
//!   for smooth dragging, Aero Snap, double-click maximize/restore toggling,
//!   and right-click Win32 system menus, and mounts flush 46×40px trailing
//!   caption buttons (hidden automatically in fullscreen).
//! - Linux CSD (`WindowControlsSide::Trailing`, `!native_nonclient_window_controls`):
//!   handles drag/double-click/right-click window menu explicitly and hides
//!   trailing caption buttons automatically under server-side decorations.
use super::{app_menu, window_controls};
use crate::{
    platform::conventions::{Conventions, WindowControlsSide},
    theme::metric,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;

/// A frame with no bar of its own (`TitleBar::seamless`): the panes show
/// through it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seamless {
    /// Where the Explorer column ends while it shows: the leading entries
    /// stay over it.
    pub sidebar: Option<f32>,
    /// How far before the window's end the actions stop.
    pub end: f32,
}

/// Composes the title bar frame around `leading`, optional `tabs`, and
/// `actions`, with a bar of its own unless `seamless`.
pub fn render_frame(
    leading: Vec<AnyElement>,
    tabs: Option<AnyElement>,
    actions: Vec<AnyElement>,
    seamless: Option<Seamless>,
    window: &mut Window,
    cx: &mut App,
) -> Div {
    let t = cx.palette();
    let conventions = Conventions::current();
    let leading_inset = match conventions.window_controls_side {
        WindowControlsSide::Leading => {
            metric::TITLEBAR_NATIVE_CONTROLS_INSET + metric::TITLEBAR_CONTENT_START
        }
        WindowControlsSide::Trailing => metric::TITLEBAR_TRAILING_CONTROLS_LEADING_START,
    };
    let in_window_menu = app_menu::render(cx);
    let trailing_controls = window_controls::render(window, cx);
    let has_trailing_controls = trailing_controls.is_some();

    let with_tabs = tabs.is_some();
    // Empty space that moves the window.
    let drag_area = |id: &'static str| {
        div()
            .id(id)
            .window_control_area(WindowControlArea::Drag)
            .h_full()
            // On Windows, leaving `WindowControlArea::Drag` (`HTCAPTION`) free of
            // mouse-down handlers lets `DefWindowProcW` handle native window drag,
            // Aero Snap, double-click maximize/restore toggle, and right-click
            // system window menus.
            .when(!conventions.native_nonclient_window_controls, |d| {
                d.on_mouse_down(MouseButton::Left, |e, window, _| {
                    if e.click_count == 2 {
                        window.zoom_window();
                    } else {
                        window.start_window_move();
                    }
                })
                .on_mouse_down(MouseButton::Right, |e, window, _| {
                    window.show_window_menu(e.position);
                })
            })
    };
    let drag = drag_area("header-drag")
        .when(!with_tabs, |d| d.flex_1())
        .when(with_tabs, |d| {
            d.w(px(metric::TITLEBAR_DRAG_MIN_WIDTH)).flex_shrink_0()
        })
        .min_w(px(metric::TITLEBAR_DRAG_MIN_WIDTH));
    // A seamless frame's actions stop where the document does; the caption
    // buttons keep the window's end.
    let sidebar = seamless.and_then(|s| s.sidebar);
    let end = seamless
        .map(|Seamless { end, .. }| {
            let captions = if has_trailing_controls {
                3. * metric::TITLEBAR_CAPTION_BUTTON_WIDTH
            } else {
                0.
            };
            (end - captions).max(0.)
        })
        .filter(|end| *end > 0.);

    div()
        .size_full()
        .flex()
        .items_center()
        .when(seamless.is_none(), |d| {
            d.bg(t.header)
                .map(|mut d| {
                    d.style().border_widths.bottom = Some(px(metric::SHELL_DIVIDER_WIDTH).into());
                    d
                })
                .border_color(t.shell_divider)
        })
        .child(
            h_flex()
                .h_full()
                .min_w_0()
                .pl(px(leading_inset))
                .gap(px(2.))
                // Over the Explorer: its own width, the rest of it moves
                // the window.
                .when_some(sidebar, |d, end| {
                    d.w(px(end))
                        .flex_shrink_0()
                        .overflow_hidden()
                        .pr(px(metric::TITLEBAR_CONTENT_END))
                })
                .children(in_window_menu)
                .children(leading)
                .when(sidebar.is_some(), |d| {
                    d.child(drag_area("header-drag-sidebar").flex_1().min_w_0())
                }),
        )
        .when_some(tabs, |d, tabs| {
            d.child(div().flex_1().min_w_0().h_full().child(tabs))
        })
        .child(drag)
        .child(
            h_flex()
                .h_full()
                .gap(px(2.))
                .pr(px(if has_trailing_controls && end.is_none() {
                    metric::TITLEBAR_CAPTION_ACTIONS_GAP
                } else {
                    metric::TITLEBAR_CONTENT_END
                }))
                .children(actions),
        )
        .when_some(end, |d, end| {
            d.child(drag_area("header-drag-end").w(px(end)).flex_shrink_0())
        })
        .children(trailing_controls)
}

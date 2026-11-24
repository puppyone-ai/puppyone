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

/// Composes the title bar frame around `leading`, optional `tabs`, and `actions`.
pub fn render_frame(
    leading: Vec<AnyElement>,
    tabs: Option<AnyElement>,
    actions: Vec<AnyElement>,
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
    let drag = div()
        .id("header-drag")
        .window_control_area(WindowControlArea::Drag)
        .when(!with_tabs, |d| d.flex_1())
        .when(with_tabs, |d| {
            d.w(px(metric::TITLEBAR_DRAG_MIN_WIDTH)).flex_shrink_0()
        })
        .h_full()
        .min_w(px(metric::TITLEBAR_DRAG_MIN_WIDTH))
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
        });

    div()
        .size_full()
        .flex()
        .items_center()
        .bg(t.header)
        .border_b_1()
        .border_color(t.shell_divider)
        .child(
            h_flex()
                .h_full()
                .min_w_0()
                .pl(px(leading_inset))
                .gap(px(2.))
                .children(in_window_menu)
                .children(leading),
        )
        .when_some(tabs, |d, tabs| {
            d.child(div().flex_1().min_w_0().h_full().child(tabs))
        })
        .child(drag)
        .child(
            h_flex()
                .h_full()
                .gap(px(2.))
                .pr(px(if has_trailing_controls {
                    metric::TITLEBAR_CAPTION_ACTIONS_GAP
                } else {
                    metric::TITLEBAR_CONTENT_END
                }))
                .children(actions),
        )
        .children(trailing_controls)
}

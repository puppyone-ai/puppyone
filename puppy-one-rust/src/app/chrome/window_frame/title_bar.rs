//! Cross-platform title bar layout frame used by `app::header::TitleBar`.
//!
//! - macOS (`WindowControlsSide::Leading`): preserves the exact traffic-light
//!   leading inset and unchanged layout.
//! - Windows / Linux (`WindowControlsSide::Trailing`): places the in-window
//!   menu bar on the leading edge, tags the drag strip with
//!   `WindowControlArea::Drag` + right-click `show_window_menu`, and mounts
//!   trailing caption buttons (hidden automatically under Linux SSD).
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
        WindowControlsSide::Trailing => metric::TITLEBAR_CONTENT_START,
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
        .on_mouse_down(MouseButton::Left, |e, window, _| {
            if e.click_count == 2 {
                window.zoom_window();
            } else {
                window.start_window_move();
            }
        })
        .on_mouse_down(MouseButton::Right, |e, window, _| {
            window.show_window_menu(e.position);
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
                    metric::TITLEBAR_CONTENT_END / 2.
                } else {
                    metric::TITLEBAR_CONTENT_END
                }))
                .children(actions),
        )
        .children(trailing_controls)
}

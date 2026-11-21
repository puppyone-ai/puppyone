//! Trailing Minimize / Maximize-Restore / Close window buttons for Windows and
//! Linux CSD (`window-chrome-and-menus.md`).
//!
//! Hidden automatically on macOS (leading traffic lights) and on Linux under
//! server-side decorations (`Decorations::Server`), avoiding double titlebars.
use crate::{
    localization::t as tr,
    platform::conventions::Conventions,
    ui::{appearance::ActiveAppearance, components::Icon},
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;

/// Returns `true` when client-rendered trailing window controls should appear.
pub fn should_show(window: &Window) -> bool {
    if !Conventions::current().uses_custom_titlebar_controls {
        return false;
    }
    matches!(window.window_decorations(), Decorations::Client { .. })
}

/// Renders the Windows/Linux-CSD trailing caption buttons (Minimize, Maximize /
/// Restore, Close) tagged with GPUI [`WindowControlArea`] hit-testing regions
/// so Windows Snap Layouts and compositor hit-testing work natively.
pub fn render(window: &Window, cx: &App) -> Option<AnyElement> {
    if !should_show(window) {
        return None;
    }
    let t = cx.palette();
    let maximized = window.is_maximized();
    let minimize_label = tr("native.window.minimize");
    let maximize_label = tr(if maximized {
        "native.window.restore"
    } else {
        "native.window.maximize"
    });
    let close_label = tr("native.window.close");

    let caption_button = |id: &'static str,
                          icon: &'static str,
                          area: WindowControlArea,
                          danger: bool,
                          label: &'static str| {
        let hover_bg = if danger { t.danger } else { t.hover };
        let hover_fg = if danger { t.text_inverse } else { t.text };
        div()
            .id(id)
            .debug_selector(move || id.into())
            .window_control_area(area)
            .w(px(46.))
            .h_full()
            .flex()
            .items_center()
            .justify_center()
            .text_color(t.muted)
            .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
            .tooltip(crate::ui::components::tooltip(label))
            .child(Icon::new(icon).size(px(14.)).stroke(1.5))
    };

    let min_btn = caption_button(
        "window-control-minimize",
        "minus",
        WindowControlArea::Min,
        false,
        minimize_label,
    )
    .on_mouse_down(MouseButton::Left, |_, window, cx| {
        cx.stop_propagation();
        window.minimize_window();
    });

    let max_btn = caption_button(
        "window-control-maximize",
        if maximized { "copy" } else { "square" },
        WindowControlArea::Max,
        false,
        maximize_label,
    )
    .on_mouse_down(MouseButton::Left, |_, window, cx| {
        cx.stop_propagation();
        window.zoom_window();
    });

    let close_btn = caption_button(
        "window-control-close",
        "x",
        WindowControlArea::Close,
        true,
        close_label,
    )
    .on_mouse_down(MouseButton::Left, |_, window, cx| {
        cx.stop_propagation();
        window.dispatch_action(Box::new(crate::app::command::CloseWindow), cx);
    });

    Some(
        h_flex()
            .h_full()
            .flex_shrink_0()
            .child(min_btn)
            .child(max_btn)
            .child(close_btn)
            .into_any_element(),
    )
}

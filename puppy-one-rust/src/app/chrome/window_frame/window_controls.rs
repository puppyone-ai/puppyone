//! Trailing Minimize / Maximize-Restore / Close window buttons for Windows and
//! Linux CSD (`window-chrome-and-menus.md`).
//!
//! - macOS (`uses_custom_titlebar_controls == false`): hidden (uses leading
//!   AppKit traffic lights).
//! - Windows (`caption_controls_depend_on_csd == false`,
//!   `native_nonclient_window_controls == true`): always shown outside
//!   fullscreen; tagged with GPUI [`WindowControlArea`] regions and left
//!   unintercepted so Win32 `WM_NCHITTEST` + `WM_NCLBUTTONUP` natively handle
//!   minimize, maximize/restore toggling, Windows 11 Snap Layouts on hover,
//!   drag-out cancellation, and `WM_CLOSE` → `on_window_should_close`.
//! - Linux (`caption_controls_depend_on_csd == true`): shown only under
//!   `Decorations::Client` (avoids double title bars under SSD) and wired with
//!   explicit click handlers.
use crate::{
    localization::t as tr,
    platform::conventions::Conventions,
    theme::{self, metric},
    ui::{appearance::ActiveAppearance, components::Icon},
};
use gpui::{prelude::*, *};
use gpui_kit::{base::h_flex, component::Sizable as _};

/// Pure visibility rule for trailing client caption buttons, deterministic for
/// cross-OS unit tests.
pub(crate) fn should_show_for(
    conventions: Conventions,
    decorations: Decorations,
    fullscreen: bool,
) -> bool {
    if !conventions.uses_custom_titlebar_controls || fullscreen {
        return false;
    }
    if conventions.caption_controls_depend_on_csd {
        matches!(decorations, Decorations::Client { .. })
    } else {
        true
    }
}

/// Returns `true` when client-rendered trailing window controls should appear.
pub fn should_show(window: &Window) -> bool {
    should_show_for(
        Conventions::current(),
        window.window_decorations(),
        window.is_fullscreen(),
    )
}

#[derive(Clone, Copy)]
enum CaptionAction {
    Minimize,
    MaximizeOrRestore,
    Close,
}

/// Renders the Windows/Linux-CSD trailing caption buttons (Minimize, Maximize /
/// Restore, Close) tagged with GPUI [`WindowControlArea`] hit-testing regions
/// so Windows Snap Layouts and compositor hit-testing work natively.
pub fn render(window: &Window, cx: &App) -> Option<AnyElement> {
    if !should_show(window) {
        return None;
    }
    let conventions = Conventions::current();

    let t = cx.palette();
    let active = window.is_window_active();
    let maximized = window.is_maximized();
    let supported = window.window_controls();
    let native_nc = conventions.native_nonclient_window_controls;

    let rest_fg = if active {
        t.text
    } else {
        theme::window_control_inactive_fg(t.text)
    };
    let neutral_hover_bg = theme::window_control_hover(t.text);
    let neutral_active_bg = theme::window_control_active(t.text);
    let close_hover_bg = theme::window_control_close_hover();
    let close_active_bg = theme::window_control_close_active();
    let close_fg = theme::window_control_close_fg();

    let caption_button = |id: &'static str,
                          icon: &'static str,
                          area: WindowControlArea,
                          action: CaptionAction,
                          label: &'static str| {
        let is_close = matches!(action, CaptionAction::Close);
        let hover_bg = if is_close {
            close_hover_bg
        } else {
            neutral_hover_bg
        };
        let active_bg = if is_close {
            close_active_bg
        } else {
            neutral_active_bg
        };
        let hover_fg = if is_close { close_fg } else { t.text };

        div()
            .id(id)
            .group(id)
            .debug_selector(move || id.into())
            .window_control_area(area)
            .w(px(metric::TITLEBAR_CAPTION_BUTTON_WIDTH))
            .h_full()
            .flex()
            .items_center()
            .justify_center()
            .text_color(rest_fg)
            .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
            .active(move |s| s.bg(active_bg).text_color(hover_fg))
            // On Windows, `HTMAXBUTTON` triggers the OS Snap Layouts flyout on
            // hover; keep custom tooltips on Linux CSD only so we never collide
            // with native Windows caption chrome.
            .when(!native_nc, |d| {
                d.tooltip(crate::ui::components::tooltip(label))
                    .on_mouse_down(MouseButton::Left, |_, window, cx| {
                        window.prevent_default();
                        cx.stop_propagation();
                    })
                    .on_click(move |_, window, cx| {
                        cx.stop_propagation();
                        match action {
                            CaptionAction::Minimize => window.minimize_window(),
                            CaptionAction::MaximizeOrRestore => {
                                if !crate::platform::window::toggle_maximize(window) {
                                    window.zoom_window();
                                }
                            }
                            CaptionAction::Close => {
                                window.dispatch_action(
                                    Box::new(crate::app::command::CloseWindow),
                                    cx,
                                );
                            }
                        }
                    })
            })
            .child(
                Icon::new(icon)
                    .with_size(px(metric::TITLEBAR_CAPTION_ICON_SIZE))
                    .color(rest_fg)
                    .group_hover_color(id, hover_fg),
            )
    };

    let mut row = h_flex().id("window-controls").h_full().flex_shrink_0();
    if supported.minimize {
        row = row.child(caption_button(
            "window-control-minimize",
            "window-minimize",
            WindowControlArea::Min,
            CaptionAction::Minimize,
            tr("native.window.minimize"),
        ));
    }
    if supported.maximize {
        row = row.child(caption_button(
            "window-control-maximize",
            if maximized {
                "window-restore"
            } else {
                "window-maximize"
            },
            WindowControlArea::Max,
            CaptionAction::MaximizeOrRestore,
            tr(if maximized {
                "native.window.restore"
            } else {
                "native.window.maximize"
            }),
        ));
    }
    row = row.child(caption_button(
        "window-control-close",
        "window-close",
        WindowControlArea::Close,
        CaptionAction::Close,
        tr("native.window.close"),
    ));

    Some(row.into_any_element())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::os::Os;
    use core::prelude::v1::test;

    #[test]
    fn visibility_follows_os_decorations_and_fullscreen() {
        let mac = Conventions::for_os(Os::Macos);
        let win = Conventions::for_os(Os::Windows);
        let linux = Conventions::for_os(Os::Linux);
        let client = Decorations::Client {
            tiling: Tiling::default(),
        };

        // macOS always uses native leading traffic lights.
        assert!(!should_show_for(mac, Decorations::Server, false));
        assert!(!should_show_for(mac, client, false));

        // Windows hides the native titlebar via `appears_transparent` while
        // GPUI reports `Decorations::Server`: caption controls must show in
        // windowed/maximized states and hide in fullscreen.
        assert!(should_show_for(win, Decorations::Server, false));
        assert!(should_show_for(win, client, false));
        assert!(!should_show_for(win, Decorations::Server, true));

        // Linux shows custom buttons only under CSD, never under SSD or fullscreen.
        assert!(!should_show_for(linux, Decorations::Server, false));
        assert!(should_show_for(linux, client, false));
        assert!(!should_show_for(linux, client, true));
    }
}

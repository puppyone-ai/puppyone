//! Global shell keybindings and application-scoped menu actions.
use crate::app::command::{
    CloseWindow, Escape, Minimize, NewWindow, NextEditor, OpenSettings, PasteTemplateLink,
    PreviousEditor, Quit, Save, ToggleFullScreen, ToggleMarkdownSource,
};
use gpui::*;

// App-level visibility commands need no window.
actions!(shell, [HideApp, HideOtherApps, ShowAllApps]);

/// Registers all cross-platform global keybindings using GPUI's `secondary-`
/// modifier (`Cmd` on macOS, `Ctrl` on Windows/Linux).
pub fn bind_keys(cx: &mut App) {
    crate::app::home::import_sources::bind_keys(cx);
    cx.bind_keys([
        KeyBinding::new("secondary-,", OpenSettings, None),
        KeyBinding::new("secondary-s", Save, None),
        KeyBinding::new("secondary-w", CloseWindow, None),
        KeyBinding::new("secondary-q", Quit, None),
        KeyBinding::new("secondary-n", NewWindow, None),
        KeyBinding::new("secondary-/", ToggleMarkdownSource, None),
        KeyBinding::new("secondary-shift-m", ToggleMarkdownSource, None),
        KeyBinding::new("secondary-v", PasteTemplateLink, Some("Homepage")),
    ]);
    cx.bind_keys([
        KeyBinding::new("ctrl-tab", NextEditor, None),
        KeyBinding::new("ctrl-shift-tab", PreviousEditor, None),
    ]);
    if crate::platform::os::Os::current().is_macos() {
        cx.bind_keys([
            KeyBinding::new("ctrl-secondary-f", ToggleFullScreen, None),
            KeyBinding::new("secondary-h", HideApp, None),
            KeyBinding::new("alt-secondary-h", HideOtherApps, None),
            KeyBinding::new("secondary-m", Minimize, None),
        ]);
    } else {
        cx.bind_keys([KeyBinding::new("f11", ToggleFullScreen, None)]);
    }
    cx.bind_keys([KeyBinding::new("escape", Escape, None)]);
    crate::app::explorer::bind_keys(cx);
    crate::app::file_mode::bind_keys(cx);
}

/// Application-scoped menu actions (hide/show and sub-theme switching).
pub fn on_app_actions(cx: &mut App) {
    cx.on_action(|_: &HideApp, cx| cx.hide());
    cx.on_action(|_: &HideOtherApps, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAllApps, cx| cx.unhide_other_apps());
    use crate::features::sub_theme_catalog::{self, OpenThemesFolder, SelectSubTheme};
    use crate::ui::appearance::ActiveAppearance as _;
    cx.on_action(|_: &OpenThemesFolder, cx| sub_theme_catalog::open_directory(cx));
    cx.on_action(|action: &SelectSubTheme, cx| {
        let Some(store) = crate::app::windows::preferences(cx) else {
            return;
        };
        let (dark, id) = (cx.is_dark(), action.id.clone());
        store.update(cx, |p, cx| p.change(|p| p.sub_theme_ids.set(dark, id), cx));
    });
}

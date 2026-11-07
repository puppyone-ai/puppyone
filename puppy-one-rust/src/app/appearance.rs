//! The window's side of the preferences: the shared store, and what the
//! window projects of it itself — the process-wide appearance (theme, Sub
//! Theme, type scale, fonts, cursors, loading style, language), the Agent
//! and editor switches, and the pane layout. Every other owner takes its
//! own part (`observe_slice`).
use super::{command::app_menus, panes::StoredPanes};
use crate::features::settings::{Preferences, PreferencesStore, Slice, SubThemeIds, ThemeMode};
use crate::localization::Locale;
use gpui::*;

/// What the process-wide appearance is projected from: a change to any of
/// these renders the whole window again; nothing else does.
#[derive(Clone, PartialEq)]
struct AppearanceInputs {
    theme_mode: ThemeMode,
    sub_theme_ids: SubThemeIds,
    text_scale: crate::typography::Scale,
    fonts: crate::typography::fonts::Selection,
    pointer_cursors: bool,
    loading_style: crate::ui::loading::LoadingStyle,
    locale: String,
}
impl AppearanceInputs {
    fn of(p: &Preferences) -> Self {
        Self {
            theme_mode: p.theme_mode,
            sub_theme_ids: p.sub_theme_ids.clone(),
            text_scale: p.text_scale,
            fonts: p.fonts.clone(),
            pointer_cursors: p.pointer_cursors,
            loading_style: p.loading_style,
            locale: p.locale.clone(),
        }
    }
}

pub(super) struct WindowPreferences {
    /// One preference owner for every window.
    pub store: Entity<PreferencesStore>,
    appearance: Slice<AppearanceInputs>,
    panes: Slice<StoredPanes>,
    /// The window shows its dark appearance.
    pub dark: bool,
    /// The catalog the window's text is in.
    pub locale: Locale,
}

impl WindowPreferences {
    pub fn new(store: Entity<PreferencesStore>) -> Self {
        Self {
            store,
            appearance: Slice::default(),
            panes: Slice::default(),
            dark: std::env::var("PUPPYONE_THEME").as_deref() != Ok("light"),
            locale: Locale::default(),
        }
    }
    /// The preferences changed. `true` when the appearance changed (it is
    /// projected, and the whole window renders again); the pane layout
    /// when it changed (this window's own commits arrive back as no
    /// change). Every other reader takes its own part.
    pub fn changed(&mut self, window: &mut Window, cx: &mut App) -> (bool, Option<StoredPanes>) {
        let p = self.store.read(cx).state.clone();
        // The built-in Agent offers PuppyOne compute only while Payments is on.
        crate::cloud::auth::set_payments(p.experimental.payments);
        crate::editor::markdown::core::commands::block_move::set_enabled(
            p.experimental.markdown_block_drag,
        );
        let appearance = self.appearance.changed(AppearanceInputs::of(&p)).is_some();
        if appearance {
            self.apply(window, cx);
        }
        // `useDesktopExplorerFrame`.
        let stored = StoredPanes {
            explorer_collapsed: p.sidebar_collapsed,
            explorer_width: p.explorer_width,
            right_width: p.right_sidebar_width,
        };
        (appearance, self.panes.changed(stored).copied())
    }
    /// Project persisted appearance/locale preferences onto the process-wide
    /// theme, type scale and catalog. `System` follows the window
    /// appearance.
    pub fn apply(&mut self, window: &mut Window, cx: &mut App) {
        let p = self.store.read(cx).state.clone();
        self.dark = match p.theme_mode {
            ThemeMode::Dark => true,
            ThemeMode::Light => false,
            ThemeMode::System => matches!(
                window.appearance(),
                WindowAppearance::Dark | WindowAppearance::VibrantDark
            ),
        };
        // Captures pin the appearance (`PUPPYONE_THEME=light|dark`).
        if let Ok(theme) = std::env::var("PUPPYONE_THEME")
            && std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
        {
            self.dark = theme != "light";
        }
        let mut scale = p.text_scale;
        // Captures pin the text size (`PUPPYONE_TEXT_SCALE=small|medium|large`).
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
            match std::env::var("PUPPYONE_TEXT_SCALE").as_deref() {
                Ok("small") => scale = crate::typography::Scale::Small,
                Ok("large") => scale = crate::typography::Scale::Large,
                Ok("medium") => scale = crate::typography::Scale::Medium,
                _ => {}
            }
        }
        let sub_theme = crate::features::sub_theme_catalog::effective(
            p.sub_theme_ids.get(self.dark),
            self.dark,
            cx,
        );
        crate::ui::appearance::Appearance::new(self.dark, &sub_theme, scale, p.pointer_cursors)
            .with_loading(p.loading_style)
            .with_fonts(p.fonts.normalized())
            .apply(Some(window), cx);
        let code = crate::localization::resolve_preference(
            &p.locale,
            crate::platform::environment::system_languages(),
        );
        crate::localization::set_current(code);
        let theme_menu = crate::features::sub_theme_catalog::sync_menu(
            p.sub_theme_ids.get(self.dark),
            self.dark,
            cx,
        );
        if self.locale.set(code) | theme_menu {
            cx.set_menus(app_menus());
        }
        // Appearance, type scale and locale are process-wide: the cached
        // panes (Explorer, workbench, Changes) read them while rendering, so
        // the whole window renders again.
        window.refresh();
    }
    /// Until preferences load: the default Sub Theme in the start-up mode.
    pub fn apply_default(&self, window: &mut Window, cx: &mut App) {
        crate::ui::appearance::Appearance::default()
            .with_dark(self.dark)
            .apply(Some(window), cx);
    }
}

//! Settings → Appearance as the window shows it (`AppearanceSettingsView`):
//! hiding file icons hides only file glyphs and keeps their slot
//! (`file-icons.css`), folders keep their disclosure, the File icons choice
//! exists only once a second icon theme is registered, and the theme row
//! offers the variants, the Themes Folder and a new theme.
use super::*;
use crate::features::settings::{Page, PreferencesStore};
use core::prelude::v1::test;

fn isolate_preferences(shell: &Entity<Shell>, cx: &mut VisualTestContext, root: &std::path::Path) {
    shell.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            *p = PreferencesStore::isolated(root.join("preferences"), cx);
        });
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !shell.read_with(cx, |s, cx| s.prefs.store.read(cx).loaded) {
        assert!(
            std::time::Instant::now() < deadline,
            "preferences did not load"
        );
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

fn bounds(cx: &mut VisualTestContext, kind: &str, path: &std::path::Path) -> Bounds<Pixels> {
    let selector: &'static str = Box::leak(format!("{kind}:{}", path.display()).into_boxed_str());
    cx.debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing selector `{selector}`"))
}

#[gpui::test]
fn hidden_file_icons_keep_the_slot_and_leave_folder_disclosures(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let root = tempfile::tempdir().unwrap();
    isolate_preferences(&view, cx, root.path());
    let session = session_of(&view, cx);
    let (file, folder) = session.read_with(cx, |e, _| {
        let rows = &e.tree().rows;
        let top = |folder: bool| {
            rows.iter()
                .find(|r| r.folder == folder && r.depth == 0)
                .unwrap()
                .path
                .clone()
        };
        (top(false), top(true))
    });
    draw(cx);
    let glyph = bounds(cx, "tree-row-glyph", &file);
    assert!(glyph.size.width > px(0.), "the file glyph is drawn");
    let shown = (
        bounds(cx, "tree-row-name", &file).origin.x,
        bounds(cx, "tree-row-name", &folder).origin.x,
    );

    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, cx| p.change(|p| p.show_file_icons = false, cx))
    });
    draw(cx);
    assert_eq!(
        bounds(cx, "tree-row-glyph", &file).size.width,
        px(0.),
        "the file glyph is hidden"
    );
    assert_eq!(
        (
            bounds(cx, "tree-row-name", &file).origin.x,
            bounds(cx, "tree-row-name", &folder).origin.x,
        ),
        shown,
        "file names keep their place and folders keep their disclosure"
    );
}

#[gpui::test]
fn the_appearance_page_offers_icon_and_theme_choices_like_the_product(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let root = tempfile::tempdir().unwrap();
    isolate_preferences(&view, cx, root.path());
    view.update_in(cx, |s, w, cx| s.open_settings(Page::Appearance, w, cx));
    draw(cx);
    assert_eq!(crate::file_kind::themes().count(), 1);
    cx.update(|w, _| {
        let snapshots = gpui_kit::base::test_support::snapshots(w);
        let has = |id: &'static str| {
            snapshots
                .iter()
                .any(|s| s.path().contains(&ElementId::from(id)))
        };
        assert!(has("show-file-icons"), "Show file icons is always offered");
        assert!(!has("file-icons"), "one icon theme offers no choice");
        // `SubThemeSettingsSection`: one row, the variant select before the
        // Themes Folder and New Theme actions.
        assert!(has("theme-pack"));
        for (id, label) in [
            (
                "theme-pack-folder-open",
                "settings.appearance.themes.openFolder",
            ),
            ("theme-pack-plus", "settings.appearance.themes.add"),
        ] {
            let action = snapshots
                .iter()
                .find(|s| s.path().contains(&ElementId::from(id)))
                .unwrap_or_else(|| panic!("{id}"));
            assert_eq!(action.role(), Some(Role::Button), "{id}");
            assert_eq!(action.label(), Some(crate::localization::t(label)), "{id}");
        }
    });
}

/// `appearanceArchitecture`: the window resolves its Color Mode first and
/// only then reads the Sub Theme remembered for that mode.
#[gpui::test]
fn the_remembered_sub_theme_follows_the_effective_color_mode(cx: &mut TestAppContext) {
    use crate::features::settings::{SubThemeIds, ThemeMode};
    let (view, cx) = setup(cx);
    let root = tempfile::tempdir().unwrap();
    isolate_preferences(&view, cx, root.path());
    for (mode, expected) in [
        (ThemeMode::Light, "default.github"),
        (ThemeMode::Dark, "default.newspaper"),
        (ThemeMode::Light, "default.github"),
    ] {
        view.update(cx, |s, cx| {
            s.prefs.store.update(cx, |p, cx| {
                p.change(
                    |p| {
                        p.theme_mode = mode;
                        p.sub_theme_ids = SubThemeIds {
                            light: "default.github".into(),
                            dark: "default.newspaper".into(),
                        };
                    },
                    cx,
                )
            })
        });
        cx.run_until_parked();
        draw(cx);
        assert_eq!(crate::theme::pack_id(), expected, "{mode:?}");
    }
}

//! The window across windows: the locale, shared preferences.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn locale_changes_catalog_without_document_work(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.prefs.locale.set("zh-Hans");
        cx.notify();
    });
    view.update(cx, |s, cx| {
        assert_eq!(s.prefs.locale.text("settings.general.title"), "通用");
        assert!(matches!(s.files(cx).phase, Phase::Idle));
        assert_eq!(crate::localization::Locale::choices().count(), 8);
    });
}
/// `workspace-window-index.mjs`: the app never chooses a user's destination
/// window, so a project open in one window opens in another too.
#[gpui::test]
fn windows_share_preferences_and_a_project_opens_where_it_was_chosen(cx: &mut TestAppContext) {
    let (first, vcx) = setup(cx);
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    first.update(vcx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while first.read_with(vcx, |s, cx| s.workspace_root(cx).is_none()) {
        assert!(std::time::Instant::now() < deadline);
        vcx.run_until_parked();
        first.update_in(vcx, |s, w, cx| s.receive(w, cx));
    }
    // A second window registers beside the first.
    let mut second = None;
    let (_, vcx2) = cx.add_window_view(|w, cx| {
        let view = cx.new(|cx| Shell::new(w, cx));
        second = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let second = second.unwrap();
    vcx2.update(|_, cx| {
        assert_eq!(windows::count(cx), 2);
        assert!(!windows::quitting(cx));
        assert_eq!(windows::last_close_quits(cx), !cfg!(target_os = "macos"));
    });
    // The same project opens in the second window as well.
    second.update_in(vcx2, |s, w, cx| s.open_project(root.clone(), w, cx));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while second.read_with(vcx2, |s, cx| s.workspace_root(cx).is_none()) {
        assert!(std::time::Instant::now() < deadline);
        vcx2.run_until_parked();
        second.update_in(vcx2, |s, w, cx| s.receive(w, cx));
    }
    first.read_with(vcx2, |s, cx| {
        assert_eq!(s.workspace_root(cx).as_deref(), Some(root.as_path()))
    });
    // ⌘N from either window opens another (deferred) window; Quit marks
    // every window closing through its own barrier, and only then does the
    // last close end the app.
    vcx2.update(|_, cx| {
        windows::quit_all(cx);
        assert!(windows::quitting(cx));
        assert!(windows::last_close_quits(cx));
        windows::cancel_quit(cx);
        assert!(!windows::quitting(cx));
    });
}

/// `interfaceStyleFirstPaint`: a window paints the persisted palette, and
/// opening another window never resets the shared appearance to the
/// start-up default.
#[gpui::test]
fn a_new_window_keeps_the_persisted_appearance(cx: &mut TestAppContext) {
    use crate::features::settings::ThemeMode;
    use crate::ui::appearance::ActiveAppearance as _;
    let (first, vcx) = setup(cx);
    let store = first.read_with(vcx, |s, _| s.prefs.store.clone());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !store.read_with(vcx, |s, _| s.loaded) {
        assert!(std::time::Instant::now() < deadline, "preferences load");
        vcx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    store.update(vcx, |s, cx| {
        s.change(|p| p.theme_mode = ThemeMode::Light, cx)
    });
    vcx.run_until_parked();
    vcx.update(|w, cx| {
        w.draw(cx).clear(cx);
        assert!(
            !cx.is_dark(),
            "the first window follows the light preference"
        );
    });
    let mut dark_when_built = None;
    let (_, vcx2) = cx.add_window_view(|w, cx| {
        let view = cx.new(|cx| Shell::new(w, cx));
        dark_when_built = Some(cx.is_dark());
        gpui_kit::base::Root::new(view, w, cx)
    });
    assert_eq!(
        dark_when_built,
        Some(false),
        "a window built after preferences loaded never paints the start-up default"
    );
    vcx2.run_until_parked();
    vcx2.update(|w, cx| {
        w.draw(cx).clear(cx);
        assert!(
            !cx.is_dark(),
            "a second window keeps the persisted light palette"
        );
    });
}

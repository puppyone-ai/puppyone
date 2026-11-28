//! The Settings entry must reach the same import owner as the Homepage.
use super::*;
use crate::features::settings::{Page, PreferencesStore};
use core::prelude::v1::test;
use std::{cell::RefCell, rc::Rc, sync::Arc};

use crate::test_support::RecordingText;

#[test]
fn experimental_import_settings_names_the_sources_and_opens_the_shared_picker_once() {
    let text = Arc::new(RecordingText::default());
    let mut app =
        TestAppContext::build_with_text_system(TestDispatcher::new(0), None, text.clone());
    app.update(gpui_kit::init);
    let (shell, cx) = setup(&mut app);
    let root = tempfile::tempdir().unwrap();
    shell.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            *p = PreferencesStore::isolated(root.path().join("preferences"), cx);
        });
        s.home.update(cx, |h, _| {
            h.app_places = Some(crate::platform::app_folders::Places {
                home: root.path().join("home"),
                app_data: root.path().join("app-data"),
            });
        });
    });
    settle_cloud(&shell, cx, "isolated Settings preferences", &|s, cx| {
        s.prefs.store.read(cx).loaded
    });
    text.0.lock().unwrap().clear();
    let (dialogs, previous_workspace) = shell.update_in(cx, |s, w, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.other_app_imports = true, cx)
        });
        s.open_settings(Page::OtherAppImports, w, cx);
        (s.dialogs.clone(), s.workspace_root(cx))
    });
    draw(cx);
    let drawn = text.0.lock().unwrap().clone();
    for label in [
        "Notion",
        "Google Drive",
        "Obsidian",
        "VS Code",
        "Cursor",
        "Typora",
        "Airtable",
    ] {
        assert!(
            drawn.iter().any(|s| s == label),
            "Settings did not render {label}: {drawn:?}"
        );
    }
    cx.update(|w, _| {
        let snapshots = gpui_kit::base::test_support::snapshots(w);
        let action = snapshots
            .iter()
            .find(|s| s.path().contains(&ElementId::from("open-import")))
            .unwrap();
        assert_eq!(action.role(), Some(Role::Button));
        assert_eq!(
            action.label(),
            Some(crate::localization::t("onboarding.entry.import.title"))
        );
        assert_ne!(action.disabled(), Some(true));
    });
    let events = Rc::new(RefCell::new(Vec::new()));
    let _sub = cx.update(|_, cx| {
        let events = events.clone();
        cx.subscribe(&dialogs, move |_, event, _| match event {
            DialogEvent::Closed => events.borrow_mut().push("closed"),
            DialogEvent::OpenImport => events.borrow_mut().push("import"),
            _ => {}
        })
    });
    let bounds = cx.debug_bounds("settings-open-import").unwrap();
    cx.simulate_click(bounds.center(), Modifiers::default());
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
        w.simulate_next_frame(cx);
        w.draw(cx).clear(cx);
    });
    assert_eq!(*events.borrow(), ["closed", "import"]);
    shell.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        assert_eq!(s.dialogs.read(cx).task(), None);
        assert_eq!(s.dialogs.read(cx).iter().count(), 1);
        assert!(s.dialogs.read(cx).contains(DialogKey::ImportRepository));
        assert!(home.import_picker.as_ref().unwrap().source.is_none());
        assert!(home.import.is_none());
        assert_eq!(home.import_sources(cx).len(), 9);
        assert_eq!(s.workspace_root(cx), previous_workspace);
    });
    assert!(!cx.did_prompt_for_paths());
    // Quit through the owning application, not the VisualTestContext stored
    // inside it: quitting drops those contexts.
    app.quit();
}

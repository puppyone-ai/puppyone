//! Actual Header hit targets must drive the bound editor's contributions.
use super::*;
use crate::editor::workbench::pane::ItemKind;
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt;

fn click(cx: &mut VisualTestContext, selector: &'static str) {
    draw(cx);
    cx.update(|w, cx| w.click(selector, cx));
    cx.run_until_parked();
    draw(cx);
}

#[gpui::test]
fn file_header_buttons_toggle_the_bound_markdown_editor(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("note.md");
    std::fs::write(&path, "# Bound\n").unwrap();
    let (view, cx) = setup(cx);
    super::file_window_parity::bind(&view, cx, path);
    settle_cloud(&view, cx, "Markdown header", &|s, cx| {
        s.files(cx).opened().is_some()
    });
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    draw(cx);
    for control in editor.read_with(cx, |e, cx| e.title_controls(cx).toggles) {
        cx.update(|w, _| {
            let node = w.find(control.id);
            assert_eq!(node.role(), Some(gpui::Role::Button));
            assert_eq!(node.label(), Some(control.label.as_ref()));
            assert_eq!(node.checked(), Some(control.checked));
            assert!(node.bounds().top() >= px(0.) && node.bounds().bottom() <= px(40.));
        });
    }
    for (id, other) in [
        ("document-editing", "document-source-panel"),
        ("document-source-panel", "document-editing"),
    ] {
        for expected in [true, false] {
            click(cx, id);
            cx.update(|w, _| assert_eq!(w.find(id).checked(), Some(expected)));
            view.read_with(cx, |_, cx| {
                let controls = editor.read(cx).title_controls(cx);
                assert_eq!(
                    controls
                        .toggles
                        .iter()
                        .find(|t| t.id == id)
                        .unwrap()
                        .checked,
                    expected
                );
                assert!(
                    !controls
                        .toggles
                        .iter()
                        .find(|t| t.id == other)
                        .unwrap()
                        .checked
                );
            });
        }
    }
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.files(cx).opened().unwrap().1,
            std::path::Path::new("note.md")
        );
        assert!(s.dialogs.read(cx).is_empty());
    });
}

#[gpui::test]
fn file_header_csv_settings_drive_the_live_document(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("data.csv");
    std::fs::write(&path, "name,value\nfirst,1\n").unwrap();
    let (view, cx) = setup(cx);
    super::file_window_parity::bind(&view, cx, path);
    settle_cloud(&view, cx, "CSV header", &|s, cx| {
        s.files(cx).opened().is_some()
    });
    let editor = view.read_with(cx, |s, cx| {
        let file = s.file.clone().unwrap();
        file.read(cx).file_editor(cx).unwrap()
    });
    let initial = editor.read_with(cx, |e, cx| e.title_controls(cx));
    assert!(initial.segmented.is_none());
    assert!(!initial.find && !initial.open_external);
    draw(cx);
    cx.update(|w, _| {
        let settings = w.find("file-settings");
        assert_eq!(settings.role(), Some(gpui::Role::Button));
        assert!(settings.label().unwrap().contains("data.csv"));
        assert_eq!(settings.expanded(), Some(false));
        assert!(w.try_find("file-view-mode").is_none());
    });
    let header = initial
        .items
        .iter()
        .find(|i| i.id == "csv-header-row")
        .unwrap();
    let ItemKind::Toggle(before) = header.kind else {
        panic!("header must be a toggle")
    };
    click(cx, "file-settings");
    cx.update(|w, _| {
        assert_eq!(w.find("file-settings").expanded(), Some(true));
        let item = w.find("csv-header-row");
        assert_eq!(item.role(), Some(gpui::Role::MenuItemCheckBox));
        assert_eq!(item.label(), Some(header.label.as_ref()));
        assert_eq!(item.checked(), Some(before));
    });
    let close = crate::localization::t("editor.panes.closePane");
    assert!(
        cx.debug_bounds(Box::leak(format!("menu-item:{close}").into_boxed_str()))
            .is_none()
    );
    click(cx, "csv-header-row");
    cx.update(|w, _| {
        assert_eq!(
            w.find("file-settings").expanded(),
            Some(true),
            "a checkbox must keep its settings menu open"
        );
        assert_eq!(w.find("csv-header-row").checked(), Some(!before));
    });
    editor.read_with(cx, |e, cx| {
        assert_eq!(
            e.title_controls(cx)
                .items
                .iter()
                .find(|i| i.id == "csv-header-row")
                .unwrap()
                .kind,
            ItemKind::Toggle(!before)
        )
    });
    click(cx, "csv-header-row");
    cx.update(|w, _| assert_eq!(w.find("csv-header-row").checked(), Some(before)));
    cx.simulate_keystrokes("escape");
    draw(cx);
    cx.update(|w, _| assert_eq!(w.find("file-settings").expanded(), Some(false)));
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.files(cx).opened().unwrap().1,
            std::path::Path::new("data.csv")
        )
    });
}

#[gpui::test]
fn file_settings_keyboard_navigates_and_restores_its_trigger(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("keyboard.csv");
    std::fs::write(&path, "name,value\nfirst,1\n").unwrap();
    let (view, cx) = setup(cx);
    super::file_window_parity::bind(&view, cx, path.clone());
    settle_cloud(&view, cx, "CSV keyboard menu", &|s, cx| {
        s.files(cx).opened().is_some()
    });
    let original = std::fs::read(&path).unwrap();
    click(cx, "file-settings");
    cx.update(|w, _| assert_eq!(w.find("csv-header-row").focused(), Some(true)));
    for (key, id) in [
        ("end", "csv-reset-column-widths"),
        ("down", "csv-header-row"),
        ("up", "csv-reset-column-widths"),
        ("home", "csv-header-row"),
        ("down", "csv-row-numbers"),
    ] {
        cx.simulate_keystrokes(key);
        draw(cx);
        cx.update(|w, _| assert_eq!(w.find(id).focused(), Some(true), "{key} -> {id}"));
    }
    let before = cx.update(|w, _| w.find("csv-row-numbers").checked().unwrap());
    for (key, expected) in [("space", !before), ("enter", before)] {
        cx.simulate_keystrokes(key);
        draw(cx);
        cx.update(|w, _| {
            assert_eq!(w.find("file-settings").expanded(), Some(true));
            assert_eq!(w.find("csv-row-numbers").checked(), Some(expected));
            assert_eq!(w.find("csv-row-numbers").focused(), Some(true));
        });
    }
    cx.simulate_keystrokes("escape");
    draw(cx);
    cx.update(|w, _| {
        assert_eq!(w.find("file-settings").expanded(), Some(false));
        assert_eq!(w.find("file-settings").focused(), Some(true));
    });
    // Reopening must focus the first setting, not a stale row from the previous menu.
    click(cx, "file-settings");
    cx.update(|w, _| assert_eq!(w.find("csv-header-row").focused(), Some(true)));
    cx.simulate_keystrokes("end enter");
    draw(cx);
    cx.update(|w, _| {
        assert_eq!(w.find("file-settings").expanded(), Some(false));
        assert_eq!(w.find("file-settings").focused(), Some(true));
    });
    assert_eq!(
        std::fs::read(path).unwrap(),
        original,
        "view settings cannot rewrite CSV bytes"
    );
}

use super::*;
use crate::documents::Phase;
use core::prelude::v1::test;
use gpui::EntityInputHandler;
fn setup(cx: &mut TestAppContext) -> (Entity<Shell>, &mut VisualTestContext) {
    // Shell integration tests exercise real filesystem workers.
    cx.executor().allow_parking();
    cx.update(|cx| {
        bind_keys(cx);
        ui::input::bind_keys(cx);
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        crate::editor::host::bind_keys(cx);
    });
    let mut content = None;
    let (_, cx) = cx.add_window_view(|w, cx| {
        let view = cx.new(|cx| Shell::new(w, cx));
        content = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let view = content.unwrap();
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    (view, cx)
}
fn command(view: &Entity<Shell>, cx: &mut VisualTestContext, name: &str) {
    view.update_in(cx, |s, w, cx| s.command(name, w, cx));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}

#[gpui::test]
fn native_keyboard_autosaves_and_closes_without_prompt_and_adopts_disk(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("native.md");
    std::fs::write(&path, b"\xef\xbb\xbf# Original\r\n\r\nBody\r\n").unwrap();
    let workspace = crate::workspace::Workspace::open(temp.path()).unwrap();
    let document = workspace.read(std::path::Path::new("native.md")).unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s,w,cx| {
        s.files=Documents::default(); s.files.workspace=Some(workspace); s.files.document=Some(document.clone());
        s.files.outgoing.push(serde_json::json!({"kind":"open","id":document.id,"name":"native.md","text":document.text}));
        s.sync_editor(w,cx);
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // Home lands on the heading's visible start (after its hidden marker);
    // then select the title and replace it.
    cx.simulate_keystrokes("cmd-right cmd-left cmd-shift-right");
    cx.simulate_input("Native 中🐶");
    let settle = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            if !view.read_with(cx, |s, _| s.files.busy() || s.files.saving()) {
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    };
    settle(&view, cx);
    assert_eq!(
        std::fs::read(&path).unwrap(),
        "\u{feff}# Native 中🐶\r\n\r\nBody\r\n".as_bytes()
    );
    std::fs::write(&path, "External edit\n").unwrap();
    // A user edit racing the external writer is reconciled at the storage port.
    cx.simulate_input("local");
    settle(&view, cx);
    view.update(cx, |s, _| {
        assert!(!s.files.dirty);
        assert!(s.files.error.is_none());
        assert_eq!(s.files.document.as_ref().unwrap().text, "External edit\n");
    });
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "External edit\n");
    command(&view, cx, "close-file");
    settle(&view, cx);
    view.update(cx, |s, _| assert!(s.files.document.is_none()));
}
#[gpui::test]
fn native_buttons_toggle_slots_and_open_settings(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // ⌘B collapses the Explorer; the Header then offers the expand button.
    command(&view, cx, "toggle-explorer");
    view.update(cx, |s, _| assert!(!s.left_open));
    cx.simulate_click(point(px(100.), px(20.)), Modifiers::none());
    view.update(cx, |s, _| assert!(s.left_open));
    command(&view, cx, "toggle-right");
    view.update(cx, |s, _| assert!(s.right_open));
    command(&view, cx, "settings");
    view.update(cx, |s, _| assert!(s.settings));
    let retained = view.update(cx, |s, cx| {
        s.task_ui.settings.update(cx, |s, cx| {
            s.select_page(crate::features::settings::Page::ModelConnections, cx)
        });
        cx.notify();
        s.task_ui.settings.entity_id()
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |s, cx| {
        s.task_ui.settings.update(cx, |s, cx| {
            s.select_page(crate::features::settings::Page::LocalAgents, cx)
        });
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    command(&view, cx, "escape");
    command(&view, cx, "settings");
    view.update(cx, |s, _| {
        assert_eq!(s.task_ui.settings.entity_id(), retained)
    });
}
#[gpui::test]
fn git_header_uses_changes_outlet_and_terminal_returns_to_retained_workbench(
    cx: &mut TestAppContext,
) {
    let (view, cx) = setup(cx);
    command(&view, cx, "changes");
    view.update(cx, |s, _| assert!(!s.right_open));
    let dir = tempfile::tempdir().unwrap();
    view.update(cx, |s, _| {
        s.files.workspace = Some(crate::workspace::Workspace::open(dir.path()).unwrap())
    });
    command(&view, cx, "changes");
    view.update(cx, |s, _| {
        assert!(s.changes && s.right_open);
        assert!(!s.modal());
    });
    command(&view, cx, "toggle-right");
    view.update(cx, |s, _| assert!(s.right_open && !s.changes));
    command(&view, cx, "changes");
    command(&view, cx, "changes");
    view.update(cx, |s, _| assert!(!s.right_open && !s.changes));
}
#[gpui::test]
fn task_shortcuts_do_not_save_or_close_the_retained_document(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, "settings");
    cx.simulate_keystrokes("cmd-s");
    view.update(cx, |s, _| {
        assert!(s.settings);
        assert!(matches!(s.files.phase, Phase::Idle));
        assert!(s.files.outgoing.is_empty());
    });
    cx.simulate_keystrokes("cmd-w");
    view.update(cx, |s, _| {
        assert!(!s.settings);
        assert!(!s.files.allow_quit);
    });
}
#[gpui::test]
fn feedback_backdrop_keeps_draft_and_escape_resets_it(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, "feedback");
    let field = view.update(cx, |s, _| s.task_ui.message.clone());
    field.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(None, "draft 中🐶", w, cx)
    });
    cx.simulate_click(point(px(2.), px(100.)), Modifiers::none());
    view.update(cx, |s, cx| {
        assert!(s.help);
        assert_eq!(s.task_ui.message.read(cx).text(), "draft 中🐶");
    });
    cx.simulate_keystrokes("escape");
    view.update(cx, |s, cx| {
        assert!(!s.help);
        assert!(s.task_ui.message.read(cx).text().is_empty());
        assert!(s.task_ui.email.read(cx).text().is_empty());
    });
}
#[gpui::test]
fn kit_dialog_tab_order_keeps_focus_inside_feedback(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, "feedback");
    cx.simulate_input("draft");
    for key in ["tab", "shift-tab"] {
        for _ in 0..8 {
            cx.simulate_keystrokes(key);
            view.update_in(cx, |s, w, cx| {
                assert!(s.modal_focus.contains_focused(w, cx));
                assert_eq!(s.task_ui.message.read(cx).text(), "draft");
            });
        }
    }
}
#[gpui::test]
fn project_popup_toggle_outside_and_escape_restore_focus(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, "project-menu");
    view.update(cx, |s, _| assert_eq!(s.popover, Some(Popover::Project)));
    command(&view, cx, "project-menu");
    view.update(cx, |s, _| assert!(s.popover.is_none()));
    command(&view, cx, "project-menu");
    cx.simulate_click(point(px(30.), px(700.)), Modifiers::none());
    view.update(cx, |s, _| assert!(s.popover.is_none()));
    command(&view, cx, "project-menu");
    cx.simulate_keystrokes("escape");
    view.update_in(cx, |s, w, _| {
        assert!(s.popover.is_none());
        assert!(s.project_focus.is_focused(w));
    });
}
#[gpui::test]
fn choosing_local_closes_popup_and_restores_trigger(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, "location-menu");
    let r = view.update(cx, |s, cx| s.popover_bounds(cx).unwrap());
    // Section label, then the selected "This Mac" row.
    cx.simulate_click(
        point(px(r.x + 60.), px(r.y + 5. + 23. + 16.)),
        Modifiers::none(),
    );
    view.update_in(cx, |s, w, _| {
        assert!(s.popover.is_none());
        assert!(s.project_focus.is_focused(w));
    });
}
#[gpui::test]
fn project_menu_home_shows_the_homepage_and_hides_the_editor(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, "project-menu");
    command(&view, cx, "home");
    view.update(cx, |s, _| {
        assert!(s.home && s.popover.is_none());
        // Fixture shells stay on the workspace surface for visual capture.
        assert!(!s.home_visible());
    });
    view.update(cx, |s, _| s.fixture = false);
    view.update(cx, |s, _| assert!(s.home_visible()));
}
#[gpui::test]
fn opening_settings_dismisses_popup_without_document_transition(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, "project-menu");
    command(&view, cx, "settings");
    view.update(cx, |s, _| {
        assert!(s.settings);
        assert!(s.popover.is_none());
        assert!(matches!(s.files.phase, Phase::Idle));
        assert!(s.files.outgoing.is_empty());
    });
}
#[gpui::test]
fn locale_changes_catalog_without_document_work(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.locale.set("zh-Hans");
        cx.notify();
    });
    view.update(cx, |s, _| {
        assert_eq!(s.locale.text("settings.general.title"), "通用");
        assert!(matches!(s.files.phase, Phase::Idle));
        assert_eq!(Locale::choices().count(), 8);
    });
}
#[gpui::test]
fn folder_selection_expands_tree_without_resetting_to_editor(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let index = s.tree.rows.iter().position(|r| r.folder).unwrap();
        let path = s.tree.rows[index].path.clone();
        let before = s.tree.rows[index].expanded;
        s.open_row(index, w, cx);
        assert_eq!(s.tree.selected, path);
        assert_eq!(s.tree.find_mut(&path).unwrap().expanded, !before);
        s.receive(w, cx);
        assert_eq!(s.tree.selected, path);
    });
}
#[gpui::test]
fn large_tree_uses_gpui_virtual_rows(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.tree.rows = (0..100_000)
            .map(|i| crate::model::Row {
                path: format!("{i}.txt").into(),
                name: format!("{i}.txt"),
                folder: false,
                expanded: false,
                depth: i % 200,
                display: format!("{i}"),
                extension: None,
                error: None,
            })
            .collect();
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |s, _| {
        assert!(s.painted_rows > 0);
        assert!(s.painted_rows < 1000, "painted {}", s.painted_rows);
    });
}
#[test]
fn sidebar_tree_fade_follows_use_scroll_edge_state() {
    use explorer_ui::bottom_fade;
    // Not scrollable (overflow within the 1px threshold): no fade.
    assert_eq!(bottom_fade(0., 0.), 0.);
    assert_eq!(bottom_fade(0., 1.), 0.);
    // Rows remain below: full fade until within 24px of the end.
    assert_eq!(bottom_fade(0., 400.), 1.);
    assert_eq!(bottom_fade(-376., 400.), 1.);
    assert_eq!(bottom_fade(-388., 400.), 0.5);
    assert_eq!(bottom_fade(-400., 400.), 0.);
    // Overscroll is clamped like `scrollTop`.
    assert_eq!(bottom_fade(-480., 400.), 0.);
    assert_eq!(bottom_fade(30., 400.), 1.);
}
#[gpui::test]
fn sidebar_tree_fades_into_the_footer_only_while_rows_remain_below(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.tree.rows = (0..500)
            .map(|i| crate::model::Row {
                path: format!("{i}.txt").into(),
                name: format!("{i}.txt"),
                folder: false,
                expanded: false,
                depth: 0,
                display: format!("{i}"),
                extension: None,
                error: None,
            })
            .collect();
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let fade = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        view.update(cx, |s, _| {
            let state = s.scroll.0.borrow();
            explorer_ui::bottom_fade(
                f32::from(state.base_handle.offset().y),
                f32::from(state.base_handle.max_offset().y),
            )
        })
    };
    assert_eq!(fade(&view, cx), 1.);
    view.update(cx, |s, cx| {
        s.scroll.scroll_to_bottom();
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    assert_eq!(fade(&view, cx), 0.);
}
#[gpui::test]
fn idle_shell_does_not_schedule_continuous_frames(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.run_until_parked();
    let before = view.update(cx, |s, _| s.frames);
    cx.run_until_parked();
    view.update(cx, |s, _| assert_eq!(s.frames, before));
}

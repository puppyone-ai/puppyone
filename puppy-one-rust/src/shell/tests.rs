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
fn command(view: &Entity<Shell>, cx: &mut VisualTestContext, command: Command) {
    view.update_in(cx, |s, w, cx| s.command(command, w, cx));
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
    view.update_in(cx, |s, w, cx| {
        s.files = Documents::default();
        s.files.workspace = Some(workspace);
        s.files.document = Some(document.clone());
        s.files.outgoing.push(crate::documents::HostMessage::Open {
            id: document.id.clone(),
            name: "native.md".into(),
            text: document.text.clone(),
            revision: 0,
            external: false,
        });
        s.sync_editor(w, cx);
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
    command(&view, cx, Command::CloseFile);
    settle(&view, cx);
    view.update(cx, |s, _| assert!(s.files.document.is_none()));
}
#[gpui::test]
fn native_buttons_toggle_slots_and_open_settings(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // ⌘B collapses the Explorer; the Header then offers the expand button.
    command(&view, cx, Command::ToggleExplorer);
    view.update(cx, |s, _| assert!(!s.panes.explorer().open));
    cx.simulate_click(point(px(100.), px(20.)), Modifiers::none());
    view.update(cx, |s, _| assert!(s.panes.explorer().open));
    command(&view, cx, Command::ToggleRightSidebar);
    view.update(cx, |s, _| assert!(s.panes.right().open));
    command(&view, cx, Command::Settings);
    view.update(cx, |s, _| assert_eq!(s.modals.task(), Some(Task::Settings)));
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
    command(&view, cx, Command::Escape);
    command(&view, cx, Command::Settings);
    view.update(cx, |s, _| {
        assert_eq!(s.task_ui.settings.entity_id(), retained)
    });
}
#[gpui::test]
fn git_header_uses_changes_outlet_and_terminal_returns_to_retained_workbench(
    cx: &mut TestAppContext,
) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Changes);
    view.update(cx, |s, _| assert!(!s.panes.right().open));
    let dir = tempfile::tempdir().unwrap();
    view.update(cx, |s, _| {
        s.files.workspace = Some(crate::workspace::Workspace::open(dir.path()).unwrap())
    });
    command(&view, cx, Command::Changes);
    view.update(cx, |s, _| {
        assert!(s.panes.shows(RightContent::Changes));
        assert!(!s.modal());
    });
    command(&view, cx, Command::ToggleRightSidebar);
    view.update(cx, |s, _| assert!(s.panes.shows(RightContent::Workbench)));
    command(&view, cx, Command::Changes);
    command(&view, cx, Command::Changes);
    view.update(cx, |s, _| {
        assert!(!s.panes.right().open && s.panes.content() == RightContent::Workbench)
    });
}
#[gpui::test]
fn task_shortcuts_do_not_save_or_close_the_retained_document(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Settings);
    cx.simulate_keystrokes("cmd-s");
    view.update(cx, |s, _| {
        assert_eq!(s.modals.task(), Some(Task::Settings));
        assert!(matches!(s.files.phase, Phase::Idle));
        assert!(s.files.outgoing.is_empty());
    });
    cx.simulate_keystrokes("cmd-w");
    view.update(cx, |s, _| {
        assert_eq!(s.modals.task(), None);
        assert!(!s.files.allow_quit);
    });
}
#[gpui::test]
fn escape_answers_the_topmost_dialog(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Settings);
    view.update(cx, |s, cx| {
        s.show_error("first");
        s.show_error("second");
        s.files.error = Some("save failed".into());
        cx.notify();
    });
    draw(cx);
    // The Documents error sits above the layer, then the newest notice
    // (which replaced the first), then Settings.
    command(&view, cx, Command::Escape);
    view.update(cx, |s, _| {
        assert!(s.files.error.is_none());
        assert!(matches!(s.modals.top(), Some(Modal::Error(e)) if e == "second"));
    });
    command(&view, cx, Command::Escape);
    view.update(cx, |s, _| {
        assert_eq!(s.modals.task(), Some(Task::Settings));
        assert!(matches!(s.modals.top(), Some(Modal::Task(_))));
    });
    command(&view, cx, Command::Escape);
    view.update(cx, |s, _| assert!(!s.modal()));
}
#[gpui::test]
fn feedback_backdrop_keeps_draft_and_escape_resets_it(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Feedback);
    let field = view.update(cx, |s, _| s.task_ui.message.clone());
    field.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(None, "draft 中🐶", w, cx)
    });
    cx.simulate_click(point(px(2.), px(100.)), Modifiers::none());
    view.update(cx, |s, cx| {
        assert_eq!(s.modals.task(), Some(Task::Feedback));
        assert_eq!(s.task_ui.message.read(cx).text(), "draft 中🐶");
    });
    cx.simulate_keystrokes("escape");
    view.update(cx, |s, cx| {
        assert_eq!(s.modals.task(), None);
        assert!(s.task_ui.message.read(cx).text().is_empty());
        assert!(s.task_ui.email.read(cx).text().is_empty());
    });
}
#[gpui::test]
fn kit_dialog_tab_order_keeps_focus_inside_feedback(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Feedback);
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
    command(&view, cx, Command::ProjectMenu);
    view.update(cx, |s, _| assert_eq!(s.popover, Some(Popover::Project)));
    command(&view, cx, Command::ProjectMenu);
    view.update(cx, |s, _| assert!(s.popover.is_none()));
    command(&view, cx, Command::ProjectMenu);
    cx.simulate_click(point(px(30.), px(700.)), Modifiers::none());
    view.update(cx, |s, _| assert!(s.popover.is_none()));
    command(&view, cx, Command::ProjectMenu);
    cx.simulate_keystrokes("escape");
    view.update_in(cx, |s, w, _| {
        assert!(s.popover.is_none());
        assert!(s.project_focus.is_focused(w));
    });
}
/// The shell's Explorer entity.
fn explorer_of(view: &Entity<Shell>, cx: &mut VisualTestContext) -> Entity<Explorer> {
    view.read_with(cx, |s, _| s.explorer.clone())
}
fn draw(cx: &mut VisualTestContext) {
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}
#[gpui::test]
fn explorer_row_menus_light_their_trigger_and_dismiss(cx: &mut TestAppContext) {
    use explorer::{MenuAt, RowTrigger};
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let (index, path) = explorer.read_with(cx, |e, _| {
        let index = e.tree().rows.iter().position(|r| !r.folder).unwrap();
        (index, e.tree().rows[index].path.clone())
    });
    // "⋮" leaves the selection alone and lights its own trigger.
    explorer.update(cx, |e, cx| {
        let before = e.tree().selected.clone();
        e.open_node_menu(index, MenuAt::Row(path.clone(), RowTrigger::More), cx);
        assert_eq!(e.tree().selected, before);
        let menu = e.menu().unwrap();
        assert_eq!(menu.row_trigger(&path), Some(RowTrigger::More));
    });
    draw(cx);
    // GPUI Kit dismisses the popover on a press outside it.
    cx.simulate_click(point(px(900.), px(500.)), Modifiers::none());
    explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
    // A right click selects the row and pins the menu at the pointer.
    explorer.update(cx, |e, cx| {
        e.open_node_menu(index, MenuAt::Pointer(point(px(100.), px(100.))), cx);
        assert_eq!(e.tree().selected, path);
        assert!(e.tree().selection.contains(&path));
    });
    draw(cx);
    cx.simulate_keystrokes("escape");
    explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
}
#[gpui::test]
fn explorer_keys_move_the_selection_and_fill_the_clipboard(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    explorer.update_in(cx, |e, w, cx| {
        let first = e.tree().rows[0].path.clone();
        e.tree_mut().select(&first, false, false);
        e.focus_handle(cx).focus(w, cx);
    });
    draw(cx);
    cx.simulate_keystrokes("down");
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, e.tree().rows[1].path)
    });
    cx.simulate_keystrokes("end");
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, e.tree().rows.last().unwrap().path)
    });
    cx.simulate_keystrokes("secondary-x");
    explorer.read_with(cx, |e, _| {
        let selected = e.tree().selected.clone();
        assert_eq!(
            e.clipboard(),
            Some(&explorer::FileClipboard::Cut(vec![selected]))
        );
    });
}
#[gpui::test]
fn rename_dialog_focuses_its_name_and_escape_cancels(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let path = s.explorer.read(cx).tree().rows[0].path.clone();
        s.begin_rename(path, false, w, cx);
    });
    draw(cx);
    view.update(cx, |s, _| assert!(s.modals.rename().is_some() && s.modal()));
    cx.simulate_keystrokes("escape");
    view.update_in(cx, |s, w, _| {
        assert!(s.modals.rename().is_none());
        assert!(s.focus.is_focused(w));
    });
}
#[gpui::test]
fn explorer_requests_open_the_shell_dialogs(cx: &mut TestAppContext) {
    use crate::features::create_new::create_entry_menu_registry::Entry;
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, _| {
        s.files.workspace = Some(crate::workspace::Workspace::open(temp.path()).unwrap())
    });
    let explorer = explorer_of(&view, cx);
    // A create menu item asks for the create form…
    explorer.update(cx, |_, cx| {
        cx.emit(ExplorerEvent::Create {
            entry: Entry::Folder,
            parent: PathBuf::new(),
        })
    });
    draw(cx);
    view.update(cx, |s, _| assert!(s.modals.create_entry().is_some()));
    command(&view, cx, Command::Escape);
    // …"Rename" for the rename dialog, and a failure for a notice.
    explorer.update(cx, |_, cx| {
        cx.emit(ExplorerEvent::Rename {
            path: "a.md".into(),
            change_type: true,
        })
    });
    draw(cx);
    view.update(cx, |s, _| assert!(s.modals.rename().is_some()));
    explorer.update(cx, |_, cx| cx.emit(ExplorerEvent::Error("denied".into())));
    draw(cx);
    view.update(cx, |s, _| {
        assert!(matches!(s.modals.top(), Some(Modal::Error(e)) if e == "denied"))
    });
}
#[gpui::test]
fn choosing_local_closes_popup_and_restores_trigger(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // The location switcher shows only with Cloud workspaces on.
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    draw(cx);
    command(&view, cx, Command::LocationMenu);
    draw(cx);
    draw(cx);
    let device = crate::localization::t(if cfg!(target_os = "macos") {
        "shell.workspaceSwitcher.location.thisMac"
    } else {
        "shell.workspaceSwitcher.location.thisComputer"
    });
    let selector: &'static str = Box::leak(format!("menu-item:{device}").into_boxed_str());
    let row = cx
        .debug_bounds(selector)
        .expect("the location menu is open");
    cx.simulate_click(row.center(), Modifiers::none());
    view.update_in(cx, |s, w, _| {
        assert!(s.popover.is_none());
        assert!(s.project_focus.is_focused(w));
    });
}
#[gpui::test]
fn project_menu_home_shows_the_homepage_and_hides_the_editor(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::ProjectMenu);
    command(&view, cx, Command::Home);
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
    command(&view, cx, Command::ProjectMenu);
    command(&view, cx, Command::Settings);
    view.update(cx, |s, _| {
        assert_eq!(s.modals.task(), Some(Task::Settings));
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
    let explorer = explorer_of(&view, cx);
    let path = explorer.update(cx, |e, cx| {
        let index = e.tree().rows.iter().position(|r| r.folder).unwrap();
        let path = e.tree().rows[index].path.clone();
        let before = e.tree().rows[index].expanded;
        e.open_row(index, cx);
        assert_eq!(e.tree().selected, path);
        assert_eq!(e.tree_mut().find_mut(&path).unwrap().expanded, !before);
        path
    });
    view.update_in(cx, |s, w, cx| s.receive(w, cx));
    explorer.read_with(cx, |e, _| assert_eq!(e.tree().selected, path));
}
#[gpui::test]
fn renaming_the_open_document_closes_it_first_and_reopens_it_renamed(cx: &mut TestAppContext) {
    use std::path::Path;
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("notes.md"), "# Notes\n").unwrap();
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    // Real workers answer: pump the shell (and its frames, where the
    // Explorer hears about the documents) until `done`.
    let settle = |cx: &mut VisualTestContext, done: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            draw(cx);
            cx.run_until_parked();
            if view.read_with(cx, |s, cx| done(s, cx)) {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "timed out");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    let root = temp.path().to_path_buf();
    view.update(cx, |s, _| s.files.begin(Intent::OpenFolder(root), &s.wake));
    settle(cx, &|s, cx| {
        s.explorer
            .read(cx)
            .tree()
            .index_of(Path::new("notes.md"))
            .is_some()
    });
    view.update(cx, |s, _| {
        s.files.begin(Intent::OpenFile("notes.md".into()), &s.wake)
    });
    let opened = |name: &'static str| {
        move |s: &Shell, _: &App| {
            !s.files.busy()
                && s.files
                    .document
                    .as_ref()
                    .is_some_and(|d| d.relative == Path::new(name))
        }
    };
    settle(cx, &opened("notes.md"));
    // The rename touches the open document: the Explorer has it closed,
    // renames once nothing is open, then has it reopened at its new path.
    explorer.update(cx, |e, cx| {
        e.rename("notes.md".into(), "renamed.md".into(), cx)
    });
    settle(cx, &opened("renamed.md"));
    assert!(temp.path().join("renamed.md").exists());
    assert!(!temp.path().join("notes.md").exists());
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, Path::new("renamed.md"));
        assert!(!e.busy());
    });
}
#[gpui::test]
fn large_tree_uses_gpui_virtual_rows(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    explorer.update(cx, |e, cx| {
        e.tree_mut().rows = (0..100_000)
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
    explorer.read_with(cx, |e, _| {
        assert!(e.painted_rows > 0);
        assert!(e.painted_rows < 1000, "painted {}", e.painted_rows);
    });
}
#[test]
fn sidebar_tree_fade_follows_use_scroll_edge_state() {
    use explorer::bottom_fade;
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
    let explorer = explorer_of(&view, cx);
    explorer.update(cx, |e, cx| {
        e.tree_mut().rows = (0..500)
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
    let fade = |explorer: &Entity<Explorer>, cx: &mut VisualTestContext| {
        explorer.read_with(cx, |e, _| {
            let state = e.scroll().0.borrow();
            explorer::bottom_fade(
                f32::from(state.base_handle.offset().y),
                f32::from(state.base_handle.max_offset().y),
            )
        })
    };
    assert_eq!(fade(&explorer, cx), 1.);
    explorer.update(cx, |e, cx| {
        e.scroll().scroll_to_bottom();
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    assert_eq!(fade(&explorer, cx), 0.);
}
#[cfg(target_os = "macos")]
#[gpui::test]
fn macos_has_no_sidebar_footer_and_settings_stays_in_the_app_menu(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.read_with(cx, |s, _| {
        assert_eq!(s.layout.footer.h, 0.);
        assert_eq!(s.layout.explorer.bottom(), s.layout.editor.bottom());
    });
    let menus = app_menus();
    assert_eq!(menus[0].name.as_ref(), "PuppyOne");
    cx.simulate_keystrokes("cmd-,");
    draw(cx);
    view.read_with(cx, |s, _| assert_eq!(s.modals.task(), Some(Task::Settings)));
    cx.simulate_keystrokes("escape");
    view.read_with(cx, |s, _| assert_eq!(s.modals.task(), None));
}

#[gpui::test]
fn idle_shell_does_not_schedule_continuous_frames(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.run_until_parked();
    let before = view.update(cx, |s, _| s.frames);
    cx.run_until_parked();
    view.update(cx, |s, _| assert_eq!(s.frames, before));
}
#[gpui::test]
fn opening_a_folder_animates_its_rows_unless_motion_is_reduced(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    // A collapsed fixture folder whose children are already loaded.
    let folder = explorer.read_with(cx, |e, _| {
        e.tree()
            .rows
            .iter()
            .position(|r| r.folder && !r.expanded)
            .unwrap()
    });
    explorer.update(cx, |e, cx| {
        let path = e.tree().rows[folder].path.clone();
        assert!(!e.tree_mut().toggle(&path));
        cx.notify();
    });
    draw(cx);
    explorer.read_with(cx, |e, _| {
        // The first child starts hidden and the marker starts closed.
        assert!(e.motion().row(folder + 1).reveal.unwrap() < 0.5);
        assert!(e.motion().disclosure(folder).unwrap() < 0.5);
    });
    // With reduced motion the same disclosure lands at once.
    cx.update(|_, cx| cx.set_reduce_motion(true));
    explorer.update(cx, |e, cx| {
        let path = e.tree().rows[folder].path.clone();
        e.tree_mut().toggle(&path);
        cx.notify();
    });
    draw(cx);
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.motion().disclosure(folder), None);
        assert_eq!(e.motion().row(folder + 1), Default::default());
    });
}
#[gpui::test]
fn closing_the_explorer_moves_its_frame_unless_motion_is_reduced(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let open = view.update(cx, |s, _| s.layout.editor.x);
    assert!(open > 0.);
    command(&view, cx, Command::ToggleExplorer);
    view.update(cx, |s, _| {
        // Mid-motion the editor has not reached the window edge, and the
        // Explorer keeps its open width behind the moving frame.
        assert!(s.layout.editor.x > 0.);
        assert_eq!(s.layout.explorer.w, open);
    });
    cx.update(|_, cx| cx.set_reduce_motion(true));
    command(&view, cx, Command::ToggleExplorer);
    view.update(cx, |s, _| assert_eq!(s.layout.editor.x, open));
}

#[gpui::test]
fn opening_a_pane_in_a_narrow_window_widens_it_to_the_pane_minima(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.simulate_resize(size(px(760.), px(700.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // Explorer alone fits: the window keeps its width.
    assert_eq!(cx.update(|w, _| f32::from(w.bounds().size.width)), 760.);
    // Explorer + right sidebar need 320 + 8 + 220 + 320.
    command(&view, cx, Command::ToggleRightSidebar);
    assert_eq!(cx.update(|w, _| f32::from(w.bounds().size.width)), 868.);
    view.update(cx, |s, _| assert_eq!(s.panes.window_minimum(), 868.));
}

#[gpui::test]
fn changes_open_file_opens_it_in_the_editor(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("notes.md"), "# Notes\n").unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, _| {
        s.files = Documents::default();
        s.files.workspace = Some(crate::workspace::Workspace::open(temp.path()).unwrap());
    });
    view.update(cx, |s, cx| {
        s.source_control.update(cx, |_, cx| {
            cx.emit(
                crate::features::source_control::SourceControlEvent::OpenFile("notes.md".into()),
            )
        })
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        if view.read_with(cx, |s, _| s.files.document.is_some()) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the file did not open"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    view.read_with(cx, |s, _| {
        assert_eq!(
            s.files.document.as_ref().unwrap().relative,
            std::path::Path::new("notes.md")
        )
    });
}

fn drag(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    from: (f32, f32),
    path: &[(f32, f32)],
    release: bool,
) {
    let at = |p: (f32, f32)| point(px(p.0), px(p.1));
    cx.simulate_mouse_down(at(from), MouseButton::Left, Modifiers::default());
    for p in path {
        cx.simulate_mouse_move(at(*p), Some(MouseButton::Left), Modifiers::default());
    }
    if release {
        cx.simulate_mouse_up(
            at(*path.last().unwrap_or(&from)),
            MouseButton::Left,
            Modifiers::default(),
        );
    }
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let _ = view;
}

#[gpui::test]
fn dragging_the_explorer_edge_past_half_its_minimum_collapses_it(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let edge = view.read_with(cx, |s, _| s.layout.editor.x);
    assert_eq!(edge, 320.);
    // The divider is the Explorer's last column; its lane runs 8px on.
    // Narrowing within range follows the pointer.
    drag(&view, cx, (322., 400.), &[(280., 400.)], true);
    view.read_with(cx, |s, _| {
        assert_eq!(
            (s.panes.explorer().open, s.panes.explorer().width),
            (true, 278.)
        )
    });
    // Past the 110px boundary the pane previews closed before release…
    drag(
        &view,
        cx,
        (277., 400.),
        &[(200., 400.), (100., 400.)],
        false,
    );
    view.read_with(cx, |s, _| {
        assert!(s.panes.explorer().open, "nothing is committed mid-drag");
        assert_eq!(s.layout.editor.x, 0., "the preview is closed");
    });
    // …and releasing commits it, reopening later at the minimum.
    cx.simulate_mouse_up(
        point(px(100.), px(400.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    view.read_with(cx, |s, _| {
        assert_eq!(
            (s.panes.explorer().open, s.panes.explorer().width),
            (false, 220.)
        )
    });
    // Both commits are the stored layout.
    view.read_with(cx, |s, cx| {
        let p = &s.preferences.read(cx).state;
        assert_eq!((p.sidebar_collapsed, p.explorer_width), (true, 220.));
    });
}

#[gpui::test]
fn the_stored_pane_layout_is_the_starting_layout(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // The stored layout arriving is shown at once, not as a close.
    let store = view.read_with(cx, |s, _| s.preferences.clone());
    store.update(cx, |store, cx| {
        store.change(
            |p| {
                p.sidebar_collapsed = true;
                p.explorer_width = 260.;
                p.right_sidebar_width = 400.;
            },
            cx,
        )
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, _| {
        assert_eq!(
            (
                s.panes.explorer().open,
                s.panes.explorer().width,
                s.panes.right().width
            ),
            (false, 260., 400.)
        );
        assert_eq!(s.layout.editor.x, 0.);
        assert_eq!(s.layout.explorer.w, 0.);
    });
    // Reopening comes back at the stored width, and is stored.
    command(&view, cx, Command::ToggleExplorer);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (s.panes.explorer().open, s.panes.explorer().width),
            (true, 260.)
        );
        assert!(!s.preferences.read(cx).state.sidebar_collapsed);
    });
}

#[gpui::test]
fn a_collapse_preview_retreats_and_escape_rolls_back(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // Armed at 100, still armed at 134 (hysteresis), open again at 200.
    drag(
        &view,
        cx,
        (322., 400.),
        &[(100., 400.), (134., 400.)],
        false,
    );
    view.read_with(cx, |s, _| assert_eq!(s.layout.editor.x, 0.));
    cx.simulate_mouse_move(
        point(px(200.), px(400.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    cx.simulate_mouse_up(
        point(px(200.), px(400.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    view.read_with(cx, |s, _| {
        assert_eq!(
            (s.panes.explorer().open, s.panes.explorer().width),
            (true, 220.)
        )
    });
    // Escape mid-drag (focus anywhere, before any binding) restores what was
    // committed; the release that follows changes nothing.
    drag(&view, cx, (221., 400.), &[(60., 400.)], false);
    view.read_with(cx, |s, _| assert_eq!(s.layout.editor.x, 0.));
    cx.simulate_keystrokes("escape");
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, _| {
        assert!(s.panes.dragging().is_none());
        assert_eq!(s.layout.editor.x, 220.);
    });
    cx.simulate_mouse_up(
        point(px(60.), px(400.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    view.read_with(cx, |s, _| {
        assert_eq!(
            (s.panes.explorer().open, s.panes.explorer().width),
            (true, 220.)
        )
    });
}

#[gpui::test]
fn a_closed_right_sidebar_is_pulled_out_from_the_window_edge(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, _| assert!(!s.panes.right().open));
    // A short pull snaps back closed…
    drag(&view, cx, (1275., 400.), &[(1200., 400.)], true);
    view.read_with(cx, |s, _| assert!(!s.panes.right().open));
    // …one past the 160px threshold opens it.
    drag(
        &view,
        cx,
        (1275., 400.),
        &[(1000., 400.), (900., 400.)],
        true,
    );
    view.read_with(cx, |s, _| {
        assert_eq!((s.panes.right().open, s.panes.right().width), (true, 375.))
    });
}

#[gpui::test]
fn the_cached_panes_render_again_only_when_they_change(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let text: String = (0..400).map(|i| format!("Line {i}\n\n")).collect();
    std::fs::write(temp.path().join("long.md"), &text).unwrap();
    let workspace = crate::workspace::Workspace::open(temp.path()).unwrap();
    let document = workspace.read(std::path::Path::new("long.md")).unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.files = Documents::default();
        s.files.workspace = Some(workspace);
        s.files.document = Some(document.clone());
        s.files.outgoing.push(crate::documents::HostMessage::Open {
            id: document.id.clone(),
            name: "long.md".into(),
            text: document.text.clone(),
            revision: 0,
            external: false,
        });
        s.sync_editor(w, cx);
    });
    draw(cx);
    draw(cx);
    let explorer = explorer_of(&view, cx);
    let renders = |cx: &mut VisualTestContext| explorer.read_with(cx, |e, _| e.renders);
    let frames = |cx: &mut VisualTestContext| view.read_with(cx, |s, _| s.frames);
    // Scrolling the editor renders the window, not the Explorer.
    let editor = view.read_with(cx, |s, _| s.layout.editor);
    let (before, shell_before) = (renders(cx), frames(cx));
    for _ in 0..5 {
        cx.simulate_event(ScrollWheelEvent {
            position: point(px(editor.x + editor.w / 2.), px(editor.y + editor.h / 2.)),
            delta: ScrollDelta::Pixels(point(px(0.), px(-40.))),
            ..Default::default()
        });
        draw(cx);
    }
    assert!(frames(cx) > shell_before, "the scroll rendered frames");
    assert_eq!(renders(cx), before, "the Explorer was reused");
    // What the shell pushes renders it again.
    view.update(cx, |s, cx| {
        s.pending = true;
        cx.notify();
    });
    draw(cx);
    let pushed = renders(cx);
    assert!(pushed > before, "a host change renders the Explorer");
    // So does a preference change: appearance is process-wide.
    view.update_in(cx, |s, w, cx| s.apply_preferences(w, cx));
    draw(cx);
    assert!(renders(cx) > pushed, "the window refreshed");
}

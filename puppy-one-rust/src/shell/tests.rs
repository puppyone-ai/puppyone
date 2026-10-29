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
fn workbench_tabs_splits_and_project_switch_retain_the_same_native_history(
    cx: &mut TestAppContext,
) {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::write(first.path().join("a.md"), "# Original\n").unwrap();
    std::fs::write(first.path().join("b.md"), "# Second\n").unwrap();
    let (view, cx) = setup(cx);
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                if view.read_with(cx, |s, _| ready(s)) {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "Workbench did not settle"
                );
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            cx.update(|w, cx| {
                let _ = w.draw(cx);
            });
        };
    view.update(cx, |s, _| {
        s.files
            .begin(Intent::OpenFolder(first.path().into()), &s.wake)
    });
    settle(&view, cx, &|s| s.files.state().is_some());
    view.update(cx, |s, _| {
        s.files.begin(Intent::OpenFile("a.md".into()), &s.wake)
    });
    settle(&view, cx, &|s| s.files.opened().is_some());
    let (slot, entity, key) = view.read_with(cx, |s, _| {
        (
            s.files.active_slot(),
            s.native.entity_id(),
            s.files
                .state()
                .unwrap()
                .layout
                .active_editor()
                .unwrap()
                .to_owned(),
        )
    });
    cx.simulate_keystrokes("cmd-right cmd-left cmd-shift-right");
    cx.simulate_input("Retained");
    settle(&view, cx, &|s| !s.files.saving());
    assert_eq!(
        std::fs::read_to_string(first.path().join("a.md")).unwrap(),
        "# Retained\n"
    );
    view.update(cx, |s, _| {
        s.files
            .state_mut()
            .unwrap()
            .split(crate::editor::workbench::layout::Direction::Horizontal);
        s.files.begin(Intent::OpenFile("b.md".into()), &s.wake);
    });
    settle(&view, cx, &|s| {
        s.files
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("b.md"))
    });
    view.read_with(cx, |s, _| {
        assert_eq!(s.files.visible_slots().len(), 2);
        assert_eq!(s.native_hosts[&slot].entity_id(), entity);
    });
    view.update_in(cx, |s, w, cx| {
        let pane = s.files.state().unwrap().layout.active.clone();
        s.files.state_mut().unwrap().close_pane(&pane);
        s.files.activate(&key);
        s.sync_editor(w, cx);
    });
    view.read_with(cx, |s, _| {
        assert_eq!(s.files.state().unwrap().catalog.editors.len(), 2);
        assert_eq!(s.native.entity_id(), entity);
    });
    view.update(cx, |s, _| {
        s.files
            .begin(Intent::OpenFolder(second.path().into()), &s.wake)
    });
    settle(&view, cx, &|s| {
        s.files
            .state()
            .is_some_and(|state| state.catalog.editors.is_empty())
    });
    view.update(cx, |s, _| {
        s.files.begin(
            Intent::OpenFolder(first.path().canonicalize().unwrap()),
            &s.wake,
        )
    });
    settle(&view, cx, &|s| s.files.active_slot() == slot);
    view.read_with(cx, |s, _| assert_eq!(s.native.entity_id(), entity));
    command(&view, cx, Command::Undo);
    settle(&view, cx, &|s| !s.files.saving());
    assert_eq!(
        std::fs::read_to_string(first.path().join("a.md")).unwrap(),
        "# Original\n"
    );
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
        "shell.projectOpen.onMac"
    } else {
        "shell.projectOpen.onComputer"
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
fn renaming_a_hidden_document_rebinds_its_native_history_without_changing_focus(
    cx: &mut TestAppContext,
) {
    use std::path::Path;
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("notes.md"), "# Notes\n").unwrap();
    std::fs::write(temp.path().join("unrelated.md"), "# Other\n").unwrap();
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
    let (slot, entity, session) = view.read_with(cx, |s, _| {
        (
            s.files.active_slot(),
            s.native.entity_id(),
            s.files.document.as_ref().unwrap().id.clone(),
        )
    });
    cx.simulate_keystrokes("cmd-right cmd-left cmd-shift-right");
    cx.simulate_input("Edited");
    settle(cx, &|s, _| !s.files.saving());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("notes.md")).unwrap(),
        "# Edited\n"
    );
    view.update(cx, |s, _| {
        s.files
            .begin(Intent::OpenFile("unrelated.md".into()), &s.wake)
    });
    settle(cx, &opened("unrelated.md"));
    let unrelated = view.read_with(cx, |s, _| s.files.active_slot());
    // Drain the hidden affected copy, not the unrelated focused copy. Waiting
    // for the entire workbench to become empty would deadlock with multiple tabs.
    explorer.update(cx, |e, cx| {
        e.rename("notes.md".into(), "renamed.md".into(), cx)
    });
    settle(cx, &|s, cx| {
        !s.explorer.read(cx).busy()
            && s.files.slot(slot).is_some_and(|f| {
                f.opened()
                    .is_some_and(|(_, p)| p == Path::new("renamed.md"))
            })
    });
    assert!(temp.path().join("renamed.md").exists());
    assert!(!temp.path().join("notes.md").exists());
    view.read_with(cx, |s, _| {
        assert!(s.files.retained_slots().contains(&unrelated));
        assert_eq!(s.files.state().unwrap().catalog.editors.len(), 2);
        assert_eq!(s.files.active_slot(), unrelated);
        assert_eq!(s.native_hosts[&slot].entity_id(), entity);
        assert_eq!(
            s.files.slot(slot).unwrap().document.as_ref().unwrap().id,
            session
        );
    });
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, Path::new("renamed.md"));
        assert!(!e.busy());
    });
    view.update_in(cx, |s, w, cx| {
        s.files
            .begin(Intent::OpenFile("renamed.md".into()), &s.wake);
        s.sync_editor(w, cx);
    });
    command(&view, cx, Command::Undo);
    settle(cx, &|s, _| !s.files.saving());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("renamed.md")).unwrap(),
        "# Notes\n"
    );
    assert!(!temp.path().join("notes.md").exists());
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

#[gpui::test]
fn csv_references_use_real_workspace_and_follow_directory_rebinds(cx: &mut TestAppContext) {
    use crate::editor::navigation::Reference;
    fn settle(
        view: &Entity<Shell>,
        cx: &mut VisualTestContext,
        ready: impl Fn(&Shell, &App) -> bool,
    ) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            if view.read_with(cx, |s, cx| ready(s, cx)) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "reference workbench did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
    fn path(csv: &Entity<crate::editor::csv::CsvEditor>, cx: &App, row: usize) -> Option<String> {
        match csv.read(cx).reference(row, 1) {
            Some(Reference::Workspace { path, .. }) => path,
            _ => None,
        }
    }
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::create_dir(first.path().join("dir")).unwrap();
    std::fs::write(first.path().join("dir/Target.md"), "# First target").unwrap();
    std::fs::write(
        first.path().join("dir/table.csv"),
        "name,link\nnote,[[Target]]\nlater,[[Later]]\n",
    )
    .unwrap();
    std::fs::write(second.path().join("Target.md"), "# Second target").unwrap();
    std::fs::write(
        second.path().join("table.csv"),
        "name,link\nnote,[[Target]]\n",
    )
    .unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, _| {
        s.files
            .begin(Intent::OpenFolder(first.path().into()), &s.wake)
    });
    settle(&view, cx, |s, _| s.files.state().is_some());
    view.update(cx, |s, _| s.files.load_children("dir".into(), &s.wake));
    settle(&view, cx, |s, cx| {
        s.explorer
            .read(cx)
            .tree()
            .rows
            .iter()
            .any(|row| row.path == std::path::Path::new("dir/table.csv"))
    });
    view.update(cx, |s, _| {
        s.files
            .begin(Intent::OpenFile("dir/table.csv".into()), &s.wake)
    });
    settle(&view, cx, |s, cx| s.native.read(cx).csv_editor().is_some());
    let csv = view.read_with(cx, |s, cx| s.native.read(cx).csv_editor().unwrap());
    assert_eq!(
        cx.read(|cx| path(&csv, cx, 1)),
        Some("dir/Target.md".into())
    );
    assert_eq!(cx.read(|cx| path(&csv, cx, 2)), None);
    std::fs::write(first.path().join("dir/Later.md"), "# Later").unwrap();
    view.update(cx, |s, _| s.files.load_children("dir".into(), &s.wake));
    settle(&view, cx, |_, cx| {
        path(&csv, cx, 2).as_deref() == Some("dir/Later.md")
    });
    csv.update_in(cx, |csv, w, cx| {
        assert!(csv.activate_reference(1, 1, w, cx));
    });
    settle(&view, cx, |s, _| {
        s.files
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("dir/Target.md"))
    });
    let explorer = view.read_with(cx, |s, _| s.explorer.clone());
    explorer.update(cx, |e, cx| e.rename("dir".into(), "moved".into(), cx));
    settle(&view, cx, |s, cx| {
        !s.files.busy()
            && !s.explorer.read(cx).busy()
            && path(&csv, cx, 1).as_deref() == Some("moved/Target.md")
    });
    assert!(first.path().join("moved/table.csv").exists());
    view.update(cx, |s, _| {
        s.files
            .begin(Intent::OpenFolder(second.path().into()), &s.wake)
    });
    settle(&view, cx, |s, _| {
        s.files.workspace.as_ref().is_some_and(|w| {
            w.local_root() == Some(second.path().canonicalize().unwrap().as_path())
        })
    });
    view.update(cx, |s, _| {
        s.files.begin(Intent::OpenFile("table.csv".into()), &s.wake)
    });
    settle(&view, cx, |s, cx| {
        s.native
            .read(cx)
            .csv_editor()
            .is_some_and(|other| other != csv)
    });
    let other = view.read_with(cx, |s, cx| s.native.read(cx).csv_editor().unwrap());
    assert_eq!(cx.read(|cx| path(&other, cx, 1)), Some("Target.md".into()));
    assert_eq!(
        cx.read(|cx| path(&csv, cx, 1)),
        Some("moved/Target.md".into()),
        "hidden editors retain their own workspace resolver"
    );
    other.update_in(cx, |csv, w, cx| {
        assert!(csv.activate_reference(1, 1, w, cx));
    });
    settle(&view, cx, |s, _| {
        s.files
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("Target.md"))
    });
}

#[gpui::test]
fn manage_running_sessions_lists_this_windows_hosts_and_terminates_them(cx: &mut TestAppContext) {
    use crate::platform::host_budget::{Budget, Cleanup, Exceeded, Role};
    let (view, cx) = setup(cx);
    let owner = view.read_with(cx, |s, _| s.window_key.clone());
    let lease = Budget::global()
        .reserve("terminal:manage-test", owner, "/tmp/p", "terminal")
        .unwrap();
    let stopped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = stopped.clone();
    lease.bind_process(u32::MAX - 7, Role::Utility, move |code| {
        assert_eq!(code, Exceeded::Terminated);
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    command(&view, cx, Command::ManageExecutions);
    view.read_with(cx, |s, _| {
        assert!(matches!(s.modals.top(), Some(Modal::Executions)))
    });
    // The list comes from the budget, so it survives the tab.
    let row = Budget::global()
        .snapshot()
        .into_iter()
        .find(|r| r.key == "terminal:manage-test")
        .unwrap();
    assert_eq!(row.cleanup, Cleanup::Pending);
    assert!(Budget::global().terminate("terminal:manage-test"));
    assert!(stopped.load(std::sync::atomic::Ordering::SeqCst));
    drop(lease);
    command(&view, cx, Command::CloseExecutions);
    view.read_with(cx, |s, _| assert!(s.modals.is_empty()));
}

#[gpui::test]
fn windows_share_preferences_and_one_project_lives_in_one_window(cx: &mut TestAppContext) {
    let (first, vcx) = setup(cx);
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    first.update(vcx, |s, _| {
        s.files.begin(Intent::OpenFolder(root.clone()), &s.wake)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while first.read_with(vcx, |s, _| s.workspace_root().is_none()) {
        assert!(std::time::Instant::now() < deadline);
        vcx.run_until_parked();
        first.update_in(vcx, |s, w, cx| s.receive(w, cx));
    }
    let first_handle = vcx.window_handle();
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
    });
    let second_handle = vcx2.window_handle();
    vcx2.update(|_, cx| {
        assert_eq!(
            windows::window_showing(&root, second_handle, cx),
            Some(first_handle)
        );
        assert_eq!(windows::window_showing(&root, first_handle, cx), None);
    });
    // Opening the project in the second window reveals the first instead.
    second.update_in(vcx2, |s, w, cx| s.open_project(root.clone(), w, cx));
    second.read_with(vcx2, |s, _| assert!(s.workspace_root().is_none()));
    // ⌘N from either window opens another (deferred) window; Quit marks
    // every window closing through its own barrier.
    vcx2.update(|_, cx| {
        windows::quit_all(cx);
        assert!(windows::quitting(cx));
        windows::cancel_quit(cx);
        assert!(!windows::quitting(cx));
    });
}

#[gpui::test]
fn app_menu_about_and_check_for_updates_follow_the_product_menu(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let menus = app_menus();
    let names: Vec<String> = menus.iter().map(|m| m.name.to_string()).collect();
    assert_eq!(names.first().map(String::as_str), Some("PuppyOne"));
    assert!(
        names.len() >= 6,
        "app, file, edit, format, view, window, help: {names:?}"
    );
    command(&view, cx, Command::About);
    view.read_with(cx, |s, _| {
        assert!(matches!(s.modals.top(), Some(Modal::About)))
    });
    command(&view, cx, Command::CloseAbout);
    view.read_with(cx, |s, _| assert!(s.modals.is_empty()));
    command(&view, cx, Command::CheckForUpdates);
    view.read_with(cx, |s, _| assert_eq!(s.modals.task(), Some(Task::Settings)));
}

#[gpui::test]
fn cloud_share_dialog_copies_the_captured_link(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.modals.open(Modal::Share {
            url: Some("https://app.puppyone.ai/0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab/docs/".into()),
            copied: None,
        });
        s.command(Command::CopyShareLink, w, cx);
        assert!(matches!(
            s.modals.top(),
            Some(Modal::Share {
                copied: Some(true),
                ..
            })
        ));
    });
    let copied = cx.read_from_clipboard().and_then(|c| c.text());
    assert_eq!(
        copied.as_deref(),
        Some("https://app.puppyone.ai/0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab/docs/")
    );
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    command(&view, cx, Command::CloseShare);
    view.read_with(cx, |s, _| assert!(s.modals.is_empty()));
}

#[gpui::test]
fn cloud_history_closes_outside_a_hosted_project(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // No hosted Project: the Header command does nothing.
    command(&view, cx, Command::CloudHistory);
    view.read_with(cx, |s, _| {
        assert!(!s.panes.shows(panes::RightContent::CloudHistory))
    });
    // A History sidebar left without its scope closes on the next frame.
    view.update(cx, |s, _| {
        assert!(s.panes.toggle_cloud_history());
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, _| {
        assert!(!s.panes.right().open);
        assert_eq!(s.panes.content(), panes::RightContent::Workbench);
    });
}

/// A Cloud API for one hosted Project root with a single file.
fn cloud_project_responder() -> crate::cloud_auth::Responder {
    std::sync::Arc::new(|request| {
        let project = "project-a";
        let path = request.path.as_str();
        Ok(if path.ends_with("/repository-context") {
            serde_json::json!({"code": 0, "data": {
                "target": {"kind": "project_root", "project_id": project},
                "project": {"id": project, "name": "Fixture Cloud",
                            "capabilities": ["content.read", "content.write"]},
                "scope_path": null}})
        } else if path.ends_with("/workbench/files") {
            serde_json::json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 3}]})
        } else if path.ends_with("/workbench") {
            serde_json::json!({"workspace": {"id": "workspace-a", "project_id": project,
                "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859", "state": "running",
                "target_ref": "refs/heads/main"}})
        } else {
            serde_json::json!({})
        })
    })
}

#[gpui::test]
fn the_header_switches_a_linked_checkout_to_cloud_and_back_keeping_both_hosts(
    cx: &mut TestAppContext,
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("local.md"), "# Local\n").unwrap();
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&root)
                .status()
                .unwrap()
                .success()
        )
    };
    git(&["init", "-q"]);
    git(&[
        "remote",
        "add",
        "origin",
        "http://127.0.0.1:18080/git/project-a.git",
    ]);
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud_auth::responding_account_fixture(cloud_project_responder());
    cx.update(|_, cx| {
        crate::features::cloud_account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
            });
            if cx.update(|_, cx| ready(view.read(cx), cx)) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{what} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    settle(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud_account::has_account(cx)
    });
    view.update(cx, |s, _| {
        s.files.begin(Intent::OpenFolder(root.clone()), &s.wake)
    });
    settle(&view, cx, "the local project", &|s, _| {
        s.workspace_root().as_deref() == Some(root.as_path())
    });
    settle(&view, cx, "the association", &|s, cx| {
        s.repository_cloud.read(cx).context.project() == Some("project-a")
    });
    // The Agent sidebar is open before the switch.
    view.update(cx, |s, _| s.panes.toggle_workbench());
    let local_key = view.read_with(cx, |s, _| s.files.workspace_key().unwrap().to_owned());
    // Choose Cloud: preparation happens in place, the Header already names
    // the Cloud Computer and the right sidebar closes.
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    view.update_in(cx, |s, _, cx| {
        assert!(!s.panes.right().open);
        assert!(s.cloud_switch.is_some());
        assert!(!s.modals.iter().any(|m| matches!(m, Modal::CloudSwitch)));
        assert_eq!(
            s.header_location(cx),
            (cloud_switch::Place::Cloud, cloud_switch::Readiness::Opening)
        );
    });
    settle(&view, cx, "the Cloud switch", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a")
    });
    view.update_in(cx, |s, _, cx| {
        assert!(s.cloud_switch.is_none());
        assert_eq!(s.project, "Fixture Cloud");
        assert_eq!(
            s.header_location(cx),
            (cloud_switch::Place::Cloud, cloud_switch::Readiness::Ready)
        );
        assert_eq!(
            s.retained_local.as_ref().map(|r| r.key.as_str()),
            Some(local_key.as_str())
        );
    });
    let cloud_key = view.read_with(cx, |s, _| s.files.workspace_key().unwrap().to_owned());
    command(&view, cx, Command::LocationMenu);
    draw(cx);
    // Back to This Mac: the retained local host shows again, no I/O.
    view.update_in(cx, |s, w, cx| s.view_local(w, cx));
    view.read_with(cx, |s, _| {
        assert_eq!(s.files.workspace_key(), Some(local_key.as_str()));
        assert_eq!(
            s.retained_cloud.as_ref().map(|r| r.key.as_str()),
            Some(cloud_key.as_str())
        );
    });
    settle(&view, cx, "the local host", &|s, _| {
        s.workspace_root().as_deref() == Some(root.as_path())
    });
    // And Cloud again: the kept-alive Cloud host, without a new opening.
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    view.read_with(cx, |s, _| {
        assert!(s.cloud_switch.is_none());
        assert_eq!(s.files.workspace_key(), Some(cloud_key.as_str()));
    });
}

#[gpui::test]
fn a_signed_out_switch_waits_in_a_dialog_and_escape_cancels_it(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud_auth::account_fixture();
    cx.update(|_, cx| {
        let account = crate::features::cloud_account::install_fixture(broker, browser, cx);
        account.update(cx, |a, _| a.sign_out());
    });
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while cx.update(|_, cx| crate::features::cloud_account::has_account(cx)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    draw(cx);
    view.update_in(cx, |s, _, cx| {
        // Sign-in waits in the dialog; the Header stays on this computer.
        assert!(s.modals.iter().any(|m| matches!(m, Modal::CloudSwitch)));
        assert_eq!(s.header_location(cx).0, cloud_switch::Place::Local);
    });
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, _| {
        assert!(s.cloud_switch.is_none());
        assert!(s.modals.is_empty());
    });
}

#[gpui::test]
fn the_homepage_merges_a_linked_checkout_and_remembers_where_it_opened(cx: &mut TestAppContext) {
    use crate::workspace::cloud::catalog::{Location, Opening};
    let temp = tempfile::tempdir().unwrap();
    let linked = temp.path().canonicalize().unwrap().join("linked");
    let plain = temp.path().canonicalize().unwrap().join("plain");
    for dir in [&linked, &plain] {
        std::fs::create_dir(dir).unwrap();
        std::fs::write(dir.join("a.md"), "# A\n").unwrap();
    }
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&linked)
                .status()
                .unwrap()
                .success()
        )
    };
    git(&["init", "-q"]);
    git(&[
        "remote",
        "add",
        "origin",
        "http://127.0.0.1:18080/git/project-a.git",
    ]);
    let project = cloud_project_responder();
    let responder: crate::cloud_auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/projects/") {
            return Ok(serde_json::json!({"code": 0, "data": [
                {"id": "project-a", "name": "Fixture Cloud", "updated_at": "2026-01-01T00:00:00Z"},
                {"id": "project-b", "name": "Hosted only"}
            ]}));
        }
        if request.path.ends_with("/commits") {
            return Ok(serde_json::json!({"code": 0, "data": {"commits": []}}));
        }
        project(request)
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
    cx.update(|_, cx| {
        crate::features::cloud_account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.preferences.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.remember_project(&plain, 2);
            p.state.remember_project(&linked, 1);
        });
        s.recent_projects = s.preferences.read(cx).state.recent_projects.clone();
        s.refresh_cloud_catalog(true, cx);
        // The Header project menu hydrates the same list as the Homepage.
        s.popover = Some(Popover::Project);
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
            });
            if cx.update(|_, cx| ready(view.read(cx), cx)) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{what} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    let locations = |s: &Shell, cx: &App| {
        s.project_items(cx)
            .iter()
            .map(|i| (i.label.clone(), i.location()))
            .collect::<Vec<_>>()
    };
    settle(&view, cx, "the merged catalog", &|s, cx| {
        let found = locations(s, cx);
        found.len() == 3 && found.iter().any(|(_, l)| *l == Location::Linked)
    });
    view.update(cx, |s, cx| {
        let found = locations(s, cx);
        assert!(found.contains(&("linked".into(), Location::Linked)));
        assert!(found.contains(&("plain".into(), Location::Local)));
        assert!(found.contains(&("Hosted only".into(), Location::CloudOnly)));
        // Without history a linked row opens on this computer.
        let linked_row = s
            .project_items(cx)
            .into_iter()
            .find(|i| i.location() == Location::Linked)
            .unwrap();
        assert_eq!(linked_row.opening(), Opening::Local);
        assert_eq!(linked_row.last_opened, None);
        // The Open menu renders for the linked row.
        s.homepage.open_menu = Some(linked_row.id.clone());
    });
    draw(cx);
    // Opening the checkout remembers "This Mac" for this account and API.
    let row = view.read_with(cx, |s, cx| {
        s.project_items(cx)
            .into_iter()
            .find(|i| i.location() == Location::Linked)
            .unwrap()
    });
    view.update_in(cx, |s, w, cx| s.open_item(&row, Opening::Local, w, cx));
    settle(&view, cx, "the local opening", &|s, cx| {
        s.workspace_root().as_deref() == Some(linked.as_path())
            && s.project_items(cx)
                .iter()
                .any(|i| i.last_opened == Some(Opening::Local))
    });
    // Open in Cloud from the same row: once committed, Cloud is remembered
    // and becomes the row's default.
    view.update_in(cx, |s, w, cx| {
        s.home = true;
        s.open_item(&row, Opening::Cloud, w, cx)
    });
    settle(&view, cx, "the Cloud opening", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a")
    });
    settle(&view, cx, "the remembered Cloud opening", &|s, cx| {
        s.preferences
            .read(cx)
            .state
            .project_open_history
            .values()
            .flatten()
            .any(|e| {
                e.project == "project-a"
                    && e.opened == crate::workspace::cloud::catalog::history::Opened::Cloud
            })
    });
    view.read_with(cx, |s, cx| {
        let items = s.project_items(cx);
        let row = items
            .iter()
            .find(|i| i.location() == Location::Linked)
            .unwrap();
        assert_eq!(row.opening(), Opening::Cloud);
        // The hosted Project offers This Mac only through its trusted
        // checkout in the account list.
        assert_eq!(s.matching_checkout(cx).as_deref(), Some(linked.as_path()));
    });
}

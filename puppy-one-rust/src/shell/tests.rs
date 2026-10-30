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
fn feedback_leaves_only_by_its_close_button_and_forgets_the_draft(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Feedback);
    let feedback = view.update(cx, |s, _| s.feedback.clone());
    let field = feedback.read_with(cx, |f, _| f.message.clone());
    field.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(None, "draft 中🐶", w, cx)
    });
    // Backdrop, Escape, ⌘W and Help again all keep it and its draft.
    cx.simulate_click(point(px(2.), px(100.)), Modifiers::none());
    cx.simulate_keystrokes("escape");
    command(&view, cx, Command::Escape);
    command(&view, cx, Command::CloseFile);
    command(&view, cx, Command::Feedback);
    view.update(cx, |s, cx| {
        assert_eq!(s.modals.task(), Some(Task::Feedback));
        assert_eq!(s.feedback.read(cx).message.read(cx).text(), "draft 中🐶");
    });
    feedback.update(cx, |f, cx| f.close(cx));
    view.update_in(cx, |s, w, cx| {
        assert_eq!(s.modals.task(), None);
        assert!(s.feedback.read(cx).message.read(cx).text().is_empty());
        assert!(s.feedback.read(cx).email.read(cx).text().is_empty());
        assert!(s.focus.is_focused(w));
    });
    // Reopened, it starts empty with the message focused.
    command(&view, cx, Command::Feedback);
    view.update_in(cx, |s, w, cx| {
        assert_eq!(s.modals.task(), Some(Task::Feedback));
        assert!(s.feedback.read(cx).message.focus_handle(cx).is_focused(w));
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
                assert!(s.feedback.read(cx).contains_focused(w, cx));
                assert_eq!(s.feedback.read(cx).message.read(cx).text(), "draft");
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
/// How soon after a change a frame still shows the motion's early part.
const MOTION_EARLY: std::time::Duration = std::time::Duration::from_millis(40);
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
                status: false,
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
                status: false,
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
    let started = std::time::Instant::now();
    explorer.update(cx, |e, cx| {
        let path = e.tree().rows[folder].path.clone();
        assert!(!e.tree_mut().toggle(&path));
        cx.notify();
    });
    draw(cx);
    // Motion runs on the real clock: a stalled machine may be past half way.
    if started.elapsed() < MOTION_EARLY {
        explorer.read_with(cx, |e, _| {
            // The first child starts hidden and the marker starts closed.
            assert!(e.motion().row(folder + 1).reveal.unwrap() < 0.5);
            assert!(e.motion().disclosure(folder).unwrap() < 0.5);
        });
    }
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
    let started = std::time::Instant::now();
    command(&view, cx, Command::ToggleExplorer);
    if started.elapsed() < MOTION_EARLY {
        view.update(cx, |s, _| {
            // Mid-motion the editor has not reached the window edge, and the
            // Explorer keeps its open width behind the moving frame.
            assert!(s.layout.editor.x > 0.);
            assert_eq!(s.layout.explorer.w, open);
        });
    }
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
    // The switch ends on the frame after the Project shows.
    settle(&view, cx, "the Cloud switch", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a") && s.cloud_switch.is_none()
    });
    view.update_in(cx, |s, _, cx| {
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

#[gpui::test]
fn signing_out_revokes_the_hosted_selection_and_returns_home(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud_auth::responding_account_fixture(cloud_project_responder());
    let account =
        cx.update(|_, cx| crate::features::cloud_account::install_fixture(broker, browser, cx));
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
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle(&view, cx, "the hosted Project", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a")
    });
    // Signing out revokes it: no hosted Project, the Homepage shows, and
    // nothing is left to reuse under another session.
    cx.update(|_, cx| account.update(cx, |a, _| a.sign_out()));
    settle(&view, cx, "the revocation", &|s, _| {
        s.hosted_project().is_none() && s.cloud_project.is_none()
    });
    view.read_with(cx, |s, _| {
        assert!(s.home);
        assert!(s.retained_cloud.is_none());
        assert!(s.cloud_authority.is_none());
    });
}

#[gpui::test]
fn turning_cloud_off_cancels_an_opening_in_flight(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // A responder that never answers the root read keeps the opening going.
    let responder: crate::cloud_auth::Responder = std::sync::Arc::new(|request| {
        if request.path.ends_with("/workbench/files") {
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
    cx.update(|_, cx| {
        crate::features::cloud_account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while !cx.update(|_, cx| crate::features::cloud_account::has_account(cx)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    view.read_with(cx, |s, _| assert!(s.files.cloud_opening().is_some()));
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = false)
    });
    draw(cx);
    view.read_with(cx, |s, _| {
        assert!(s.files.cloud_opening().is_none());
        assert!(s.cloud_authority.is_none());
    });
    // The late root never commits.
    std::thread::sleep(std::time::Duration::from_millis(600));
    view.update_in(cx, |s, w, cx| s.receive(w, cx));
    cx.run_until_parked();
    view.read_with(cx, |s, _| assert!(s.hosted_project().is_none()));
}

#[gpui::test]
fn the_same_cloud_target_joins_its_pending_opening(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let roots = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = roots.clone();
    let responder: crate::cloud_auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context") {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
    cx.update(|_, cx| {
        crate::features::cloud_account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while !cx.update(|_, cx| crate::features::cloud_account::has_account(cx)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    // A second click on the same Project joins the pending opening.
    view.update(cx, |s, cx| {
        s.open_cloud("project-a".into(), cx);
        s.open_cloud("project-a".into(), cx);
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    while view.read_with(cx, |s, _| s.hosted_project().is_none()) {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        assert!(
            std::time::Instant::now() < deadline,
            "opening did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(roots.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[gpui::test]
fn a_failed_cloud_subscription_offers_retry_which_rebinds_the_same_host(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // The fixture transport has no event stream: the subscription fails.
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
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle(&view, cx, "the hosted Project", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a")
    });
    settle(&view, cx, "the workspace notice", &|s, _| {
        s.workspace_notice.is_some()
    });
    // A notice floats; it is not a dialog.
    view.read_with(cx, |s, _| assert!(!s.modal()));
    let (key, first) = view.read_with(cx, |s, _| {
        (
            s.files.workspace_key().unwrap().to_owned(),
            s.files.workspace.clone().unwrap(),
        )
    });
    view.update(cx, |s, cx| s.retry_workspace_surface(cx));
    settle(&view, cx, "the rebound host", &|s, _| {
        s.files
            .workspace
            .as_ref()
            .is_some_and(|ws| !std::sync::Arc::ptr_eq(ws, &first))
    });
    // The same retained host, bound to the new lease.
    view.read_with(cx, |s, _| {
        assert_eq!(s.files.workspace_key(), Some(key.as_str()));
        assert_eq!(s.hosted_project().as_deref(), Some("project-a"));
    });
}

#[gpui::test]
fn a_failed_opening_offers_its_recovery_and_retry_repeats_that_opening(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let attempts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = attempts.clone();
    let responder: crate::cloud_auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context")
            && counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0
        {
            return Err(crate::cloud_auth::Error::Response(503, None));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
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
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle(&view, cx, "the recovery", &|s, _| {
        s.modals
            .iter()
            .any(|m| matches!(m, Modal::CloudRecovery { .. }))
    });
    view.update(cx, |s, cx| {
        let Some(Modal::CloudRecovery { project, failure }) = s.modals.top() else {
            panic!("no recovery")
        };
        let (project, failure) = (project.clone(), failure.clone());
        assert_eq!(project, "project-a");
        // 5xx: the service is unavailable, retry; the status is a detail.
        assert_eq!(failure.code, "service-unavailable");
        assert_eq!(failure.status, Some(503));
        assert!(matches!(
            failure.recovery,
            crate::workspace::cloud::opening::Recovery::Retry
        ));
        s.recovery_details = true;
        cx.notify();
    });
    draw(cx);
    // Retry repeats the same opening, which now succeeds.
    view.update(cx, |s, cx| {
        s.modals
            .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
        s.open_cloud("project-a".into(), cx);
    });
    settle(&view, cx, "the retried opening", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a")
    });
    assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[gpui::test]
fn the_rail_offers_rename_and_unlink_for_a_remembered_project(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let path = PathBuf::from("/p/notes");
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.remember_project(&path, 1));
        s.recent_projects = s.preferences.read(cx).state.recent_projects.clone();
        s.open_project_actions(path.clone(), point(px(20.), px(80.)), cx);
    });
    draw(cx);
    view.update_in(cx, |s, w, cx| {
        assert!(s.project_actions.is_some());
        s.begin_project_rename(path.clone(), w, cx);
        assert!(s.project_actions.is_none());
        let Some(Modal::RenameProject(rename)) = s.modals.top() else {
            panic!("no rename dialog")
        };
        let input = rename.input.clone();
        input.update(cx, |i, cx| i.set_text(String::from("Field notes"), cx));
        s.submit_project_rename(w, cx);
    });
    view.read_with(cx, |s, cx| {
        assert!(s.modals.is_empty());
        assert_eq!(
            s.preferences.read(cx).state.recent_projects[0].name,
            "Field notes"
        );
    });
    // Unlink forgets the Project (its files stay where they are).
    view.update(cx, |s, cx| {
        s.modals.open(Modal::UnlinkProject(path.clone()));
        cx.notify();
    });
    draw(cx);
    view.update(cx, |s, cx| {
        s.modals.remove(|m| matches!(m, Modal::UnlinkProject(_)));
        s.preferences
            .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
    });
    view.read_with(cx, |s, cx| {
        assert!(s.preferences.read(cx).state.recent_projects.is_empty())
    });
}

#[gpui::test]
fn an_unlinked_checkout_publishes_from_the_header_switch(cx: &mut TestAppContext) {
    use crate::cloud_publication::tests::{Fake, coordinator};
    let (temp, fake) = Fake::new();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
    std::process::Command::new("git")
        .args(["init", "-q", "-b", "main"])
        .current_dir(&root)
        .status()
        .unwrap();
    let (view, cx) = setup(cx);
    let responder: crate::cloud_auth::Responder = std::sync::Arc::new(|request| {
        if request.path.ends_with("/organizations/") {
            return Ok(serde_json::json!({"code": 0, "data": [{"id": "org-1", "name": "Mine"}]}));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
    cx.update(|_, cx| {
        crate::features::cloud_account::install_fixture(broker, browser, cx);
        let fake = fake.clone();
        crate::features::cloud_publish::install_factory(
            std::sync::Arc::new(move |_, _| coordinator(&fake).0),
            cx,
        );
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
    // No Cloud remote: choosing Cloud shows the activation page.
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    settle(&view, cx, "the organization", &|s, cx| {
        s.modals.iter().any(|m| matches!(m, Modal::CloudSwitch))
            && s.cloud_publish.read(cx).selected.as_deref() == Some("org-1")
    });
    // Upload to Cloud runs the publication; the dialog can go to the
    // background while the Header states the run.
    view.update(cx, |s, cx| {
        s.cloud_publish.update(cx, |p, cx| {
            p.start(crate::cloud_publication::Action::Initialize, cx)
        })
    });
    settle(&view, cx, "the publication", &|s, cx| {
        let p = s.cloud_publish.read(cx);
        if let Some(error) = p.outcome.as_ref().and_then(|o| o.error.as_ref()) {
            panic!("{error:?}");
        }
        p.published.as_deref() == Some("project-a")
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.cloud_publish.read(cx).header_status(),
            Some(crate::features::cloud_publish::HeaderStatus::Completed)
        );
        assert!(
            crate::cloud_publication::journal::Journal::in_git_dir(&fake.git_dir)
                .read()
                .unwrap()
                .is_none()
        );
    });
}

#[gpui::test]
fn a_vanished_cloud_project_is_replaced_only_after_a_second_404(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
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
    git(&["init", "-q", "-b", "main"]);
    let url = "http://127.0.0.1:18080/git/project-a.git";
    git(&["remote", "add", "puppyone", url]);
    let authorizations = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = authorizations.clone();
    let responder: crate::cloud_auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context") {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            return Err(crate::cloud_auth::Error::Http(404));
        }
        cloud_project_responder()(request)
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
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
    settle(&view, cx, "the missing association", &|s, cx| {
        matches!(
            s.repository_cloud.read(cx).context,
            crate::workspace::cloud::repository::Context::NotFound { .. }
        )
    });
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    view.update(cx, |s, cx| s.begin_replace(cx));
    settle(&view, cx, "the reviewed remote", &|s, _| {
        s.cloud_switch
            .as_ref()
            .and_then(|c| c.replace.as_ref())
            .is_some_and(|r| r.url.as_deref() == Some(url))
    });
    let before = authorizations.load(std::sync::atomic::Ordering::SeqCst);
    view.update(cx, |s, cx| s.confirm_replace("project-a".into(), cx));
    settle(&view, cx, "the local detach", &|s, cx| {
        matches!(
            s.repository_cloud.read(cx).context,
            crate::workspace::cloud::repository::Context::LocalOnly
        )
    });
    // Authorized once more before anything local changed.
    assert!(authorizations.load(std::sync::atomic::Ordering::SeqCst) > before);
    let remotes = std::process::Command::new("git")
        .args(["remote"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&remotes.stdout).trim().is_empty());
}

#[gpui::test]
fn first_run_offers_sign_in_once_on_an_empty_launch(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud_auth::account_fixture();
    let account = cx.update(|_, cx| {
        let account = crate::features::cloud_account::install_fixture(broker, browser, cx);
        account.update(cx, |a, _| a.sign_out());
        account
    });
    view.update(cx, |s, cx| {
        s.preferences.update(cx, |p, _| {
            p.loaded = true;
            p.state.experimental.cloud_workspace = true;
        })
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while cx.update(|_, cx| crate::features::cloud_account::has_account(cx)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.first_run_sign_in(cx)));
    // Continue locally completes it for good.
    view.update(cx, |s, cx| {
        s.complete_first_run(cx);
        s.sync_first_run(cx);
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.first_run_sign_in(cx));
        assert!(s.preferences.read(cx).state.first_run_sign_in_completed);
    });
    let _ = account;
}

#[gpui::test]
fn an_unsupported_repository_url_is_refused_before_cloning(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().canonicalize().unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| s.begin_import(w, cx));
    // An unsupported URL is refused before anything runs.
    view.update_in(cx, |s, w, cx| {
        let Some(Modal::ImportRepository(import)) = s.modals.top() else {
            panic!("no import dialog")
        };
        let url = import.url.clone();
        url.update(cx, |i, cx| {
            i.set_text(String::from("https://example.com/a/b"), cx)
        });
        s.submit_import(w, cx);
    });
    draw(cx);
    view.read_with(cx, |s, _| {
        assert!(
            s.modals
                .iter()
                .any(|m| matches!(m, Modal::ImportRepository(_)))
        );
        assert!(s.workspace_root().is_none());
    });
    let _ = parent;
}

#[gpui::test]
fn finder_drops_open_only_one_file_of_this_workspace(cx: &mut TestAppContext) {
    let (view, vcx) = setup(cx);
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("docs")).unwrap();
    std::fs::write(root.join("docs/a.md"), "a").unwrap();
    std::fs::write(root.join("b.md"), "b").unwrap();
    let outside = tempfile::tempdir().unwrap();
    view.update(vcx, |s, _| {
        s.files.begin(Intent::OpenFolder(root.clone()), &s.wake)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while view.read_with(vcx, |s, cx| {
        s.workspace_root().is_none()
            || !s
                .explorer
                .read(cx)
                .tree()
                .is_folder(std::path::Path::new("docs"))
    }) {
        assert!(std::time::Instant::now() < deadline);
        vcx.run_until_parked();
        view.update_in(vcx, |s, w, cx| s.receive(w, cx));
    }
    let drop = |paths: Vec<std::path::PathBuf>| ExternalPaths(paths.into());
    view.read_with(vcx, |s, cx| {
        assert_eq!(
            s.external_document(&drop(vec![root.join("docs/a.md")]), cx),
            Some("docs/a.md".into())
        );
        // Folders, several files and files outside the project are not admitted.
        for paths in [
            vec![root.join("docs")],
            vec![root.join("docs/a.md"), root.join("b.md")],
            vec![outside.path().join("c.md")],
            vec![root.clone()],
        ] {
            assert_eq!(s.external_document(&drop(paths), cx), None);
        }
    });
}

#[gpui::test]
fn create_new_opens_the_project_entry_launcher_and_hands_off(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::CreateNew);
    view.read_with(cx, |s, _| {
        assert!(matches!(s.modals.top(), Some(Modal::ProjectEntry)))
    });
    // Escape closes the launcher without choosing.
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, _| assert!(s.modals.is_empty()));
    command(&view, cx, Command::CreateNew);
    view.update_in(cx, |s, w, cx| {
        s.choose_project_entry(super::home::project_entry::Route::Create, w, cx)
    });
    view.read_with(cx, |s, _| {
        assert!(!s.modals.iter().any(|m| matches!(m, Modal::ProjectEntry)));
        assert!(matches!(s.modals.top(), Some(Modal::CreateProject(_))));
    });
    command(&view, cx, Command::Escape);
    command(&view, cx, Command::CreateNew);
    view.update_in(cx, |s, w, cx| {
        s.choose_project_entry(super::home::project_entry::Route::Import, w, cx)
    });
    view.read_with(cx, |s, _| {
        assert!(matches!(s.modals.top(), Some(Modal::ImportRepository(_))))
    });
}

#[gpui::test]
fn a_project_that_cannot_open_reports_why_and_retries(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("gone");
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| s.open_project(missing.clone(), w, cx));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        if view.read_with(cx, |s, _| {
            s.modals
                .iter()
                .any(|m| matches!(m, Modal::ProjectFailure { .. }))
        }) {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "no failure dialog");
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    view.read_with(cx, |s, _| {
        let Some(Modal::ProjectFailure { path, message }) = s.modals.top() else {
            panic!("the failure is the top dialog")
        };
        assert_eq!(path, &missing);
        assert!(!message.is_empty());
        // Not the generic error dialog.
        assert!(s.files.error.is_none());
    });
    // Retry opens the same folder again.
    command(&view, cx, Command::RetryProjectOpen);
    view.read_with(cx, |s, _| {
        assert!(
            !s.modals
                .iter()
                .any(|m| matches!(m, Modal::ProjectFailure { .. }))
        );
        assert!(s.files.opening_root());
    });
}

#[gpui::test]
fn an_empty_homepage_plays_its_intro_then_shows_the_analytics_disclosure(cx: &mut TestAppContext) {
    use crate::{features::telemetry, platform::telemetry::Level};
    cx.update(|cx| {
        telemetry::install_fixture(Some(telemetry::fixture(Level::Basic, true, true)), cx)
    });
    let (view, cx) = setup(cx);
    view.update(cx, |s, _| s.fixture = false);
    command(&view, cx, Command::Home);
    view.update(cx, |s, cx| {
        assert!(s.home_visible() && s.project_items(cx).is_empty());
        assert!(s.homepage.intro.is_some());
        // The disclosure waits for the intro.
        assert!(!s.homepage.disclosure_shown);
    });
    assert!(cx.debug_bounds("onboarding-empty-state-intro").is_some());
    assert!(cx.debug_bounds("onboarding-telemetry-disclosure").is_none());
    view.update(cx, |s, _| {
        s.homepage
            .intro
            .as_mut()
            .unwrap()
            .advance(std::time::Duration::from_millis(1200))
    });
    draw(cx);
    draw(cx);
    view.update(cx, |s, _| {
        assert!(s.homepage.intro.is_none() && s.homepage.disclosure_shown);
    });
    assert!(cx.debug_bounds("onboarding-empty-state-intro").is_none());
    let disclosure = cx.debug_bounds("onboarding-telemetry-disclosure").unwrap();
    // Bottom end corner: 24px in, 16px up.
    let window = cx.update(|w, _| w.viewport_size());
    assert!((f32::from(window.width - disclosure.right()) - 24.).abs() < 0.5);
    assert!((f32::from(window.height - disclosure.bottom()) - 16.).abs() < 0.5);

    // Once seen, a Homepage shown again replays the intro but asks no more.
    let state = cx.update(|_, cx| telemetry::global(cx).unwrap());
    state.update(cx, |t, _| {
        t.snapshot = Some(telemetry::fixture(Level::Basic, true, false))
    });
    view.update(cx, |s, _| s.fixture = true);
    draw(cx);
    view.update(cx, |s, _| s.fixture = false);
    draw(cx);
    view.update(cx, |s, _| {
        assert!(s.homepage.intro.is_some() && !s.homepage.disclosure_shown);
        s.homepage
            .intro
            .as_mut()
            .unwrap()
            .advance(std::time::Duration::from_millis(1200));
    });
    draw(cx);
    draw(cx);
    assert!(cx.debug_bounds("onboarding-telemetry-disclosure").is_none());

    // Reduced motion: no intro at all.
    cx.update(|_, cx| cx.set_reduce_motion(true));
    view.update(cx, |s, _| s.fixture = true);
    draw(cx);
    view.update(cx, |s, _| s.fixture = false);
    draw(cx);
    view.update(cx, |s, _| assert!(s.homepage.intro.is_none()));
}

#[gpui::test]
fn escape_acknowledges_the_header_introduction_wherever_focus_is(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, _| {
        s.files = Documents::default();
        s.files.workspace = Some(crate::workspace::Workspace::open(temp.path()).unwrap());
    });
    // The entry is measured on one frame and introduced on the next.
    draw(cx);
    draw(cx);
    view.update(cx, |s, _| {
        assert_eq!(s.coachmarks.active, Some(coachmarks::Coachmark::Agent));
        assert!(s.coachmark_shown());
    });
    // Nothing in the overlay holds focus; Escape still reaches it.
    view.update_in(cx, |s, w, cx| s.focus.focus(w, cx));
    cx.simulate_keystrokes("escape");
    draw(cx);
    view.update(cx, |s, cx| {
        assert!(!s.coachmark_shown());
        assert!(s.preferences.read(cx).state.header_coachmarks.agent);
    });
    // A dialog hides it, and Escape then answers the dialog, not the overlay.
    let mut prefs = view.read_with(cx, |s, cx| s.preferences.read(cx).state.clone());
    prefs.header_coachmarks.agent = false;
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, cx| p.change(|p| *p = prefs, cx));
        s.coachmarks = Default::default();
    });
    draw(cx);
    draw(cx);
    view.update(cx, |s, _| assert!(s.coachmark_shown()));
    command(&view, cx, Command::Settings);
    view.update(cx, |s, _| assert!(!s.coachmark_shown()));
    cx.simulate_keystrokes("escape");
    draw(cx);
    view.update(cx, |s, cx| {
        assert!(s.modals.is_empty());
        assert!(!s.preferences.read(cx).state.header_coachmarks.agent);
        assert!(s.coachmark_shown());
    });
}

struct Linked {
    root: std::path::PathBuf,
    _temp: tempfile::TempDir,
    /// Signs the fixture account in again.
    relogin: Box<dyn Fn()>,
}
/// A Git checkout linked to `project-a` on a signed-in fixture account with
/// Cloud on; `responder` answers the Cloud API.
fn linked_checkout(
    cx: &mut TestAppContext,
    responder: crate::cloud_auth::Responder,
) -> (Entity<Shell>, &mut VisualTestContext, Linked) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("local.md"), "# Local\n").unwrap();
    for args in [
        &["init", "-q"][..],
        &[
            "remote",
            "add",
            "origin",
            "http://127.0.0.1:18080/git/project-a.git",
        ],
    ] {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&root)
                .status()
                .unwrap()
                .success()
        );
    }
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
    let kept = broker.clone();
    cx.update(|_, cx| crate::features::cloud_account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud_account::has_account(cx)
    });
    view.update(cx, |s, _| {
        s.files.begin(Intent::OpenFolder(root.clone()), &s.wake)
    });
    settle_cloud(&view, cx, "the local project", &|s, _| {
        s.workspace_root().as_deref() == Some(root.as_path())
    });
    let relogin = Box::new(move || crate::cloud_auth::relogin(&kept, "alice"));
    (
        view,
        cx,
        Linked {
            root,
            _temp: temp,
            relogin,
        },
    )
}
fn settle_cloud(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    what: &str,
    ready: &dyn Fn(&Shell, &App) -> bool,
) {
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
}
/// `GET /projects/` with `project-a`, else `fallback`.
fn with_catalog(fallback: crate::cloud_auth::Responder) -> crate::cloud_auth::Responder {
    std::sync::Arc::new(move |request| {
        if request.path.contains("/projects/") && !request.path.contains("/projects/project-a") {
            return Ok(serde_json::json!({"code": 0, "data": [
                {"id": "project-a", "name": "Fixture Cloud", "updated_at": "2026-10-01T00:00:00Z"}]}));
        }
        fallback(request)
    })
}

#[gpui::test]
fn a_refused_association_leaves_the_account_catalog_usable(cx: &mut TestAppContext) {
    let base = cloud_project_responder();
    let responder = with_catalog(std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context") {
            return Err(crate::cloud_auth::Error::Http(403));
        }
        base(request)
    }));
    let (view, cx, Linked { root, _temp, .. }) = linked_checkout(cx, responder);
    settle_cloud(&view, cx, "the refusal", &|s, cx| {
        s.repository_cloud.read(cx).context
            == crate::workspace::cloud::repository::Context::NotAuthorized
    });
    // The catalog still loads and lists the Cloud Project (merged by the
    // checkout's trusted locator, not by the refused authorization).
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        s.project_items(cx)
            .iter()
            .any(|i| i.cloud_project.as_deref() == Some("project-a"))
    });
    view.update(cx, |s, cx| {
        assert_eq!(s.workspace_root().as_deref(), Some(root.as_path()));
        assert_eq!(
            s.cloud_catalog.read(cx).state,
            crate::features::cloud_catalog::State::Ready(vec![
                crate::workspace::cloud::catalog::CloudEntry {
                    id: "project-a".into(),
                    name: "Fixture Cloud".into(),
                    updated: Some(1_790_812_800_000),
                }
            ])
        );
        assert!(!s.modal());
    });
}

#[gpui::test]
fn a_failed_header_switch_stays_local_with_its_recovery_in_place(cx: &mut TestAppContext) {
    let base = cloud_project_responder();
    let responder = with_catalog(std::sync::Arc::new(move |request| {
        if request.path.ends_with("/workbench/files") {
            return Err(crate::cloud_auth::Error::Http(503));
        }
        base(request)
    }));
    let (view, cx, Linked { root, _temp, .. }) = linked_checkout(cx, responder);
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.repository_cloud.read(cx).context.project() == Some("project-a")
    });
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    settle_cloud(&view, cx, "the failure", &|s, _| {
        s.cloud_switch.as_ref().is_some_and(|c| c.failure.is_some())
    });
    view.update(cx, |s, cx| {
        // Still the local project, never the project picker or the Homepage.
        assert_eq!(s.workspace_root().as_deref(), Some(root.as_path()));
        assert!(!s.home_visible());
        assert!(!s.modals.iter().any(|m| matches!(m, Modal::ProjectEntry)));
        assert!(s.modals.iter().any(|m| matches!(m, Modal::CloudSwitch)));
        assert!(s.hosted_project().is_none());
        // The catalog is untouched.
        assert!(
            s.project_items(cx)
                .iter()
                .any(|i| i.cloud_project.as_deref() == Some("project-a"))
        );
    });
}

#[gpui::test]
fn a_catalog_reload_keeps_an_open_failure_and_retry_reopens_that_project(cx: &mut TestAppContext) {
    use std::sync::atomic::{AtomicBool, Ordering};
    let failing = std::sync::Arc::new(AtomicBool::new(true));
    let base = cloud_project_responder();
    let responder = with_catalog({
        let failing = failing.clone();
        std::sync::Arc::new(move |request| {
            if failing.load(Ordering::SeqCst) && request.path.ends_with("/workbench/files") {
                return Err(crate::cloud_auth::Error::Http(503));
            }
            base(request)
        })
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud_account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        matches!(
            s.cloud_catalog.read(cx).state,
            crate::features::cloud_catalog::State::Ready(_)
        )
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the open failure", &|s, _| {
        s.modals
            .iter()
            .any(|m| matches!(m, Modal::CloudRecovery { .. }))
    });
    // Reloading the catalog leaves the failure in place.
    view.update(cx, |s, cx| s.refresh_cloud_catalog(true, cx));
    settle_cloud(&view, cx, "the reloaded catalog", &|s, cx| {
        matches!(
            s.cloud_catalog.read(cx).state,
            crate::features::cloud_catalog::State::Ready(_)
        )
    });
    view.update(cx, |s, _| {
        assert!(
            s.modals.iter().any(
                |m| matches!(m, Modal::CloudRecovery { project, .. } if project == "project-a")
            )
        );
        assert!(s.hosted_project().is_none());
    });
    // Retry repeats that opening, not a list refresh.
    failing.store(false, Ordering::SeqCst);
    view.update(cx, |s, cx| {
        s.modals
            .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
        s.open_cloud("project-a".into(), cx);
    });
    settle_cloud(&view, cx, "the reopened project", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a")
    });
}

/// §15 "User signs out after link": the Header shows the sign-in gate, and
/// signing in again resolves the same Project instead of offering to
/// create one.
#[gpui::test]
fn signing_out_after_a_link_gates_the_header_and_signing_in_finds_the_same_project(
    cx: &mut TestAppContext,
) {
    use crate::workspace::cloud::repository::{CloudState, Context};
    let (view, cx, Linked { relogin, _temp, .. }) =
        linked_checkout(cx, with_catalog(cloud_project_responder()));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.repository_cloud.read(cx).context.project() == Some("project-a")
    });
    cx.update(|_, cx| crate::features::cloud_account::sign_out(cx));
    settle_cloud(&view, cx, "the sign-in gate", &|s, cx| {
        let signed_in = crate::features::cloud_account::has_account(cx);
        !signed_in
            && s.repository_cloud.read(cx).context.cloud_state(signed_in) == CloudState::SignedOut
    });
    relogin();
    settle_cloud(&view, cx, "signing in", &|_, cx| {
        crate::features::cloud_account::has_account(cx)
    });
    settle_cloud(&view, cx, "the same Project", &|s, cx| {
        crate::features::cloud_account::has_account(cx)
            && s.repository_cloud.read(cx).context.project() == Some("project-a")
    });
    view.read_with(cx, |s, cx| {
        assert!(!matches!(
            s.repository_cloud.read(cx).context,
            Context::LocalOnly | Context::NotFound { .. }
        ));
        assert!(s.cloud_publish.read(cx).outcome.is_none());
    });
}

/// C-10.1/10.2: in Cloud the right sidebar's workbench is the hosted Agent —
/// one Puppyone Agent recipe, no local discovery or shell — and opening it
/// sends nothing; back on This Mac the local workbench returns.
#[gpui::test]
fn the_hosted_project_gets_the_cloud_agent_workbench_and_this_mac_gets_its_own(
    cx: &mut TestAppContext,
) {
    let agent_requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let base = cloud_project_responder();
    let responder = with_catalog({
        let agent_requests = agent_requests.clone();
        std::sync::Arc::new(move |request| {
            if request.path.starts_with("/agents") {
                agent_requests.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            base(request)
        })
    });
    let (view, cx, Linked { root, _temp, .. }) = linked_checkout(cx, responder);
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.repository_cloud.read(cx).context.project() == Some("project-a")
    });
    view.read_with(cx, |s, cx| assert!(!s.workbench.read(cx).cloud_location()));
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    settle_cloud(&view, cx, "the hosted Agent", &|s, cx| {
        s.hosted_project().as_deref() == Some("project-a") && s.workbench.read(cx).cloud_location()
    });
    view.read_with(cx, |s, cx| {
        let offered = s.workbench.read(cx).visible_installations();
        assert_eq!(offered.len(), 1);
        assert_eq!(
            offered[0].label,
            crate::features::desktop_agent::infrastructure::cloud::LABEL
        );
    });
    // Opening the Agent sidebar sends nothing.
    view.update(cx, |s, _| s.panes.toggle_workbench());
    draw(cx);
    std::thread::sleep(std::time::Duration::from_millis(200));
    draw(cx);
    assert_eq!(agent_requests.load(std::sync::atomic::Ordering::SeqCst), 0);
    view.update_in(cx, |s, w, cx| s.view_local(w, cx));
    settle_cloud(&view, cx, "the local workbench", &|s, cx| {
        s.workspace_root().as_deref() == Some(root.as_path())
            && !s.workbench.read(cx).cloud_location()
    });
}

/// C-15.2: each injected failure reaches the Homepage opening's recovery
/// with the product's code and action; the failure never navigates.
#[gpui::test]
fn injected_opening_failures_reach_the_recovery_with_the_product_code(cx: &mut TestAppContext) {
    use crate::cloud_auth::{Error, ServiceCode};
    use crate::workspace::cloud::opening::Recovery;
    let cases: Vec<(&str, Error, &str, Recovery)> = vec![
        (
            "/workbench",
            Error::Unavailable,
            "connection-unreachable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(504, None),
            "connection-timeout",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(408, None),
            "connection-timeout",
            Recovery::Retry,
        ),
        // A generic 5xx names the service only at the project stage.
        (
            "/workbench",
            Error::Response(503, None),
            "workspace-open-failed",
            Recovery::Retry,
        ),
        (
            "/repository-context",
            Error::Response(503, None),
            "service-unavailable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(429, None),
            "service-busy",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Http(426),
            "app-update-required",
            Recovery::None,
        ),
        (
            "/workbench",
            Error::Http(402),
            "workspace-plan-required",
            Recovery::Account,
        ),
        (
            "/workbench",
            Error::Http(403),
            "workspace-access-denied",
            Recovery::None,
        ),
        (
            "/workbench",
            Error::Http(404),
            "workspace-service-unavailable",
            Recovery::None,
        ),
        (
            "/repository-context",
            Error::Http(404),
            "project-unavailable",
            Recovery::None,
        ),
        (
            "/repository-context",
            Error::Http(403),
            "project-access-denied",
            Recovery::None,
        ),
        (
            "/repository-context",
            Error::Response(503, Some("project_authorization_unavailable")),
            "access-check-unavailable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(503, Some("database_schema_outdated")),
            "service-updating",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Service(409, ServiceCode::GenerationChanged),
            "workspace-open-failed",
            Recovery::Retry,
        ),
    ];
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let mut seen = vec![];
    for (suffix, error, _, _) in &cases {
        let base = cloud_project_responder();
        let (suffix, error) = (*suffix, *error);
        let responder: crate::cloud_auth::Responder = std::sync::Arc::new(move |request| {
            if request.path.ends_with(suffix) {
                return Err(error);
            }
            base(request)
        });
        let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
        cx.update(|_, cx| crate::features::cloud_account::install_fixture(broker, browser, cx));
        settle_cloud(&view, cx, "sign-in", &|_, cx| {
            crate::features::cloud_account::has_account(cx)
        });
        view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
        settle_cloud(&view, cx, "the recovery", &|s, _| {
            s.modals
                .iter()
                .any(|m| matches!(m, Modal::CloudRecovery { .. }))
        });
        view.update(cx, |s, _| {
            let failure = s.modals.iter().find_map(|m| match m {
                Modal::CloudRecovery { failure, .. } => Some(failure.clone()),
                _ => None,
            });
            let failure = failure.unwrap();
            seen.push((failure.code, failure.recovery));
            assert!(s.hosted_project().is_none());
            s.modals
                .remove(|m| matches!(m, Modal::CloudRecovery { .. }));
        });
    }
    let expected: Vec<_> = cases.iter().map(|(_, _, c, r)| (*c, *r)).collect();
    assert_eq!(seen, expected);
}

/// C-12: the local Header's Share opens the linked Project's services, and
/// signing out ends them.
#[gpui::test]
fn share_opens_the_linked_projects_services_and_signing_out_closes_them(cx: &mut TestAppContext) {
    let (view, cx, Linked { _temp, .. }) =
        linked_checkout(cx, with_catalog(cloud_project_responder()));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.repository_cloud.read(cx).context.project() == Some("project-a")
    });
    command(&view, cx, Command::CloudServices);
    view.read_with(cx, |s, _| {
        assert!(s.modals.iter().any(|m| matches!(m, Modal::CloudServices)));
    });
    // Escape answers it, like the product's dialog root.
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, _| assert!(s.modals.is_empty()));
    command(&view, cx, Command::CloudServices);
    cx.update(|_, cx| crate::features::cloud_account::sign_out(cx));
    settle_cloud(&view, cx, "the closed dialog", &|s, _| {
        !s.modals.iter().any(|m| matches!(m, Modal::CloudServices))
    });
}

#[gpui::test]
fn share_on_an_unlinked_checkout_shows_the_value_page(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    assert!(
        std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&root)
            .status()
            .unwrap()
            .success()
    );
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud_auth::responding_account_fixture(cloud_project_responder());
    cx.update(|_, cx| crate::features::cloud_account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud_account::has_account(cx)
    });
    view.update(cx, |s, _| {
        s.files.begin(Intent::OpenFolder(root.clone()), &s.wake)
    });
    settle_cloud(&view, cx, "the local project", &|s, _| {
        s.workspace_root().as_deref() == Some(root.as_path())
    });
    command(&view, cx, Command::CloudServices);
    view.read_with(cx, |s, _| {
        assert!(!s.modals.iter().any(|m| matches!(m, Modal::CloudServices)));
        assert!(s.cloud_switch.is_some());
    });
}

/// An opening is not over until its result is applied: between the worker
/// finishing and the window taking the result, the Header switch must not
/// read a finished opening without a Project as a failure.
#[gpui::test]
fn an_opening_stays_open_until_its_result_is_applied(cx: &mut TestAppContext) {
    let (view, cx, Linked { _temp, .. }) =
        linked_checkout(cx, with_catalog(cloud_project_responder()));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.repository_cloud.read(cx).context.project() == Some("project-a")
    });
    view.update_in(cx, |s, w, cx| s.view_cloud(w, cx));
    // The worker finishes while nothing on this thread runs.
    std::thread::sleep(std::time::Duration::from_millis(300));
    view.update(cx, |s, cx| {
        assert!(s.files.cloud_opening().is_some());
        s.advance_cloud_switch(cx);
        assert!(s.cloud_switch.as_ref().is_some_and(|c| c.failure.is_none()));
    });
    settle_cloud(&view, cx, "the Cloud switch", &|s, _| {
        s.hosted_project().as_deref() == Some("project-a") && s.cloud_switch.is_none()
    });
    view.read_with(cx, |s, _| assert!(s.files.cloud_opening().is_none()));
}

/// C-8.2: the preview comes from what is already loaded: no service files,
/// at most eight entries, and the open document always among them.
#[test]
fn the_share_preview_uses_cached_entries_and_keeps_the_open_file() {
    use crate::model::Node;
    let node = |name: &str, folder: bool| {
        serde_json::from_value::<Node>(serde_json::json!({"name": name, "folder": folder,
            "expanded": false, "children": []}))
        .unwrap()
    };
    let mut nodes = vec![
        node(".git", true),
        node(".DS_Store", false),
        node("docs", true),
    ];
    nodes.extend((0..10).map(|i| node(&format!("{i}.md"), false)));
    let entries = tasks::share_preview_entries(&nodes, Some("deep.md"));
    assert_eq!(entries.len(), 9);
    assert_eq!(entries[0], ("docs".to_owned(), true));
    assert_eq!(entries[8], ("deep.md".to_owned(), false));
    assert!(tasks::share_preview_entries(&[], None).is_empty());
}

/// C-13.2: with payments off no price is read; with them on the account's
/// plan is the server's, and an outage keeps the published offer.
#[gpui::test]
fn the_plan_page_reads_billing_only_with_payments_on_and_survives_an_outage(
    cx: &mut TestAppContext,
) {
    use crate::features::settings::Page;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };
    let (reads, down) = (
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicBool::new(false)),
    );
    let responder: crate::cloud_auth::Responder = {
        let (reads, down) = (reads.clone(), down.clone());
        Arc::new(move |request| {
            if request.path.starts_with("/billing") || request.path == "/organizations/" {
                reads.fetch_add(1, Ordering::SeqCst);
                if down.load(Ordering::SeqCst) {
                    return Err(crate::cloud_auth::Error::Response(503, None));
                }
            }
            Ok(match request.path.as_str() {
                "/organizations/" => serde_json::json!([{"id": "org-1", "name": "One"}]),
                "/billing/catalog" => serde_json::json!({"schema_version": "1.0", "plans": [
                    {"id": "personal", "name": "Personal", "public": true, "purchasable": true,
                     "currency": "USD", "price_per_seat_cents": 2500}]}),
                "/billing/organizations/org-1/summary" => serde_json::json!({"org_id": "org-1",
                    "plan_id": "personal", "status": "active", "seat_quantity": 1,
                    "portal_available": true}),
                "/billing/organizations/org-1/usage" => serde_json::json!({
                    "storage": {"logical_bytes": 1024, "limit_bytes": 2048}}),
                _ => serde_json::json!({}),
            })
        })
    };
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud_auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud_account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud_account::has_account(cx)
    });
    let settings = view.read_with(cx, |s, _| s.task_ui.settings.clone());
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.payments = false)
    });
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    cx.run_until_parked();
    std::thread::sleep(std::time::Duration::from_millis(100));
    cx.run_until_parked();
    assert_eq!(reads.load(Ordering::SeqCst), 0);
    view.update(cx, |s, cx| {
        s.preferences
            .update(cx, |p, _| p.state.experimental.payments = true)
    });
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while settings
        .read_with(cx, |s, _| s.plan_summary_held())
        .is_none()
    {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(
        settings.read_with(cx, |s, _| s.plan_summary_held()),
        Some(true)
    );
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // An outage leaves the page on the published offer, with no plan held.
    down.store(true, Ordering::SeqCst);
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while settings
        .read_with(cx, |s, _| s.plan_summary_held())
        .is_some()
    {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}

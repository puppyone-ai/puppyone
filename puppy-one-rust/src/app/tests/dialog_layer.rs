//! The dialog layer: task dialogs, notices, Escape, focus, rename and create, running sessions, the close question.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn task_shortcuts_do_not_save_and_cmd_w_stays_the_windows(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Settings);
    cx.simulate_keystrokes("cmd-s");
    view.update(cx, |s, cx| {
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Settings));
        assert!(matches!(s.files(cx).phase, Phase::Idle));
        assert!(s.files(cx).outgoing.is_empty());
    });
    // Settings takes no ⌘W of its own (`SettingsDialog`): with no editor
    // open it is the menu's Close Window.
    cx.simulate_keystrokes("cmd-w");
    cx.run_until_parked();
    assert!(cx.read(|app| app.windows().is_empty()));
}
#[gpui::test]
fn escape_answers_the_topmost_dialog(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Settings);
    view.update(cx, |s, cx| {
        s.show_error("first", cx);
        s.show_error("second", cx);
        s.session
            .docs
            .update(cx, |d, _| d.error = Some("save failed".into()));
        cx.notify();
    });
    draw(cx);
    // The Documents error sits above the layer, then the newest notice
    // (which replaced the first), then Settings.
    command(&view, cx, Command::Escape);
    view.update(cx, |s, cx| {
        assert!(s.files(cx).error.is_none());
        assert!(s.top_dialog(cx).as_deref() == Some("Error(second)"));
    });
    command(&view, cx, Command::Escape);
    view.update(cx, |s, cx| {
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Settings));
        assert!(s.top_dialog(cx).is_some_and(|d| d.starts_with("Task")));
    });
    command(&view, cx, Command::Escape);
    view.update(cx, |s, cx| assert!(!s.modal(cx)));
}
#[gpui::test]
fn feedback_leaves_only_by_its_close_button_and_forgets_the_draft(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Feedback);
    let feedback = view.update(cx, |s, cx| s.dialogs.read(cx).feedback.clone());
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
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Feedback));
        assert_eq!(
            s.dialogs.read(cx).feedback.read(cx).message.read(cx).text(),
            "draft 中🐶"
        );
    });
    feedback.update(cx, |f, cx| f.close(cx));
    view.update_in(cx, |s, w, cx| {
        assert_eq!(s.dialogs.read(cx).task(), None);
        assert!(
            s.dialogs
                .read(cx)
                .feedback
                .read(cx)
                .message
                .read(cx)
                .text()
                .is_empty()
        );
        assert!(
            s.dialogs
                .read(cx)
                .feedback
                .read(cx)
                .email
                .read(cx)
                .text()
                .is_empty()
        );
        assert!(s.frame.focus.is_focused(w));
    });
    // Reopened, it starts empty with the message focused.
    command(&view, cx, Command::Feedback);
    view.update_in(cx, |s, w, cx| {
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Feedback));
        assert!(
            s.dialogs
                .read(cx)
                .feedback
                .read(cx)
                .message
                .focus_handle(cx)
                .is_focused(w)
        );
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
                assert!(s.dialogs.read(cx).feedback.read(cx).contains_focused(w, cx));
                assert_eq!(
                    s.dialogs.read(cx).feedback.read(cx).message.read(cx).text(),
                    "draft"
                );
            });
        }
    }
}
#[gpui::test]
fn rename_dialog_focuses_its_name_and_escape_cancels(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let path = s.explorer.session.read(cx).tree().rows[0].path.clone();
        s.dialogs.update(cx, |d, cx| d.rename(path, false, w, cx));
    });
    draw(cx);
    view.update(cx, |s, cx| {
        assert!(s.has_dialog("Rename", cx) && s.modal(cx))
    });
    cx.simulate_keystrokes("escape");
    view.update_in(cx, |s, w, cx| {
        assert!(!s.has_dialog("Rename", cx));
        assert!(s.frame.focus.is_focused(w));
    });
}
#[gpui::test]
fn a_dialog_keeps_focus_when_its_focused_control_goes(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let path = s.explorer.session.read(cx).tree().rows[0].path.clone();
        s.dialogs.update(cx, |d, cx| d.rename(path, false, w, cx));
    });
    draw(cx);
    // Focus moves to a control that is no longer there (removed or disabled).
    let gone = cx.update(|_, cx| cx.focus_handle());
    view.update_in(cx, |_, w, cx| gone.focus(w, cx));
    draw(cx);
    draw(cx);
    // The dialog still holds the keyboard: Escape cancels it.
    cx.simulate_keystrokes("escape");
    view.update(cx, |s, cx| assert!(!s.has_dialog("Rename", cx)));
}
#[gpui::test]
fn explorer_requests_open_the_shell_dialogs(cx: &mut TestAppContext) {
    use crate::features::create_new::create_entry_menu_registry::Entry;
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.workspace = Some(crate::workspace::Workspace::open(temp.path()).unwrap())
        });
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
    view.update(cx, |s, cx| {
        assert!(s.dialogs.read(cx).create_form().is_some())
    });
    command(&view, cx, Command::Escape);
    // …"Rename" for the rename dialog, and a failure for a notice.
    explorer.update(cx, |_, cx| {
        cx.emit(ExplorerEvent::Rename {
            path: "a.md".into(),
            change_type: true,
        })
    });
    draw(cx);
    view.update(cx, |s, cx| assert!(s.has_dialog("Rename", cx)));
    explorer.update(cx, |_, cx| cx.emit(ExplorerEvent::Error("denied".into())));
    draw(cx);
    view.update(cx, |s, cx| {
        assert!(s.top_dialog(cx).as_deref() == Some("Error(denied)"))
    });
}
#[gpui::test]
fn manage_running_sessions_lists_this_windows_hosts_and_terminates_them(cx: &mut TestAppContext) {
    use crate::platform::host_budget::{Budget, Cleanup, Exceeded, Role};
    let (view, cx) = setup(cx);
    let owner = view.read_with(cx, |s, _| s.session.key.clone());
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
    view.read_with(cx, |s, cx| {
        assert!(s.top_dialog(cx).as_deref() == Some("Executions"))
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
    view.read_with(cx, |s, cx| assert!(s.dialogs.read(cx).is_empty()));
}
/// `finishInterceptedClose`: a refused close asks "Keep Window Open" or
/// "Close Anyway" instead of showing the save error.
#[gpui::test]
fn a_refused_close_asks_to_keep_the_window_or_close_anyway(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.error = Some("save failed".into()));
        s.session.docs.update(cx, |d, _| d.close_refused = true);
        s.receive(w, cx);
        assert!(s.top_dialog(cx).as_deref() == Some("CloseAnyway"));
        assert!(s.files(cx).error.is_none());
    });
    draw(cx);
    command(&view, cx, Command::KeepWindowOpen);
    view.update(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(!windows::quitting(cx));
        assert!(!s.files(cx).allow_quit);
    });
}

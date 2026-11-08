//! A file window.
use super::*;
use core::prelude::v1::test;

/// W-2, qubits `822dbe7b2`, `68ab98d83`, `b012ce39e`: a file window shows
/// its one file under a title bar that floats over it, with no project
/// around it. Edits are saved as they are made, an outside change shows,
/// and closing asks nothing.
#[gpui::test]
fn a_file_window_shows_one_file_and_saves_it_as_it_is_edited(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("notes.md"), "# Notes\n").unwrap();
    std::fs::write(root.join("other.md"), "# Other\n").unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("notes.md")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the file", &|s, cx| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("notes.md"))
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.home_visible(cx));
        assert!(!s.opening(cx));
        // The document spans the window under the title bar.
        assert_eq!(s.frame.layout.editor.x, 0.);
        assert_eq!(s.frame.layout.explorer.w, 0.);
        // Not remembered as a project, never shared or put in the Cloud.
        assert!(s.prefs.store.read(cx).state.recent_projects.is_empty());
        assert!(s.cloud.read(cx).local_folder_notice(cx).is_none());
        // The one file is watched, so an Agent's edits show.
        assert!(s.files(cx).watching());
    });
    std::fs::write(root.join("notes.md"), "# Notes, changed\n").unwrap();
    settle_cloud(&view, cx, "the reread", &|s, cx| {
        s.files(cx)
            .document
            .as_ref()
            .is_some_and(|d| d.text == "# Notes, changed\n")
    });
    // Project commands, Settings, Help and Close File do nothing here.
    command(&view, cx, Command::Home);
    view.read_with(cx, |s, cx| {
        assert!(!s.session.project.read(cx).home && !s.home_visible(cx))
    });
    for c in [
        Command::Settings,
        Command::Feedback,
        Command::CloseFile,
        Command::NextEditor,
    ] {
        command(&view, cx, c);
    }
    cx.run_until_parked();
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(s.files(cx).opened().is_some());
    });
    // A link to a neighbour opens nothing: the file has none.
    let slot = view.read_with(cx, |s, cx| s.files(cx).active_slot());
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.client_for(
                slot,
                crate::documents::ClientMessage::OpenPaths {
                    paths: vec!["other.md".into()],
                },
            )
        })
    });
    cx.run_until_parked();
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.files(cx).opened().map(|(_, p)| p.to_owned()),
            Some(PathBuf::from("notes.md"))
        )
    });
    // The document fills the window from its top edge, keeping the bar's
    // row as room above its content; the controls show only near the top.
    draw(cx);
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    view.read_with(cx, |s, cx| {
        let file = s.file.as_ref().unwrap();
        assert!(!file.read(cx).revealed);
        assert_eq!(editor.read(cx).scroll_state(cx), (0., false));
    });
    view.update(cx, |s, cx| {
        let file = s.file.clone().unwrap();
        file.update(cx, |f, cx| f.point(Some(40.), 760., cx));
        assert!(file.read(cx).revealed);
        file.update(cx, |f, cx| f.point(Some(400.), 760., cx));
        assert!(!file.read(cx).revealed);
    });
    // Typing saves: no save step, no unsaved mark, no question on close.
    editor.update_in(cx, |e, w, cx| e.lab_type("Hello ", w, cx));
    settle_cloud(&view, cx, "the autosave", &|s, cx| {
        !s.files(cx).busy()
            && !s.files(cx).saving()
            && !s.files(cx).dirty
            && std::fs::read_to_string(root.join("notes.md"))
                .is_ok_and(|text| text.contains("Hello "))
    });
    view.read_with(cx, |s, _| {
        assert_eq!(s.session.title.as_ref().map(|t| t.2), Some(false))
    });
    view.update_in(cx, |s, w, cx| {
        s.command(Command::Quit, w, cx);
        s.receive(w, cx);
    });
    cx.run_until_parked();
    assert!(!cx.has_pending_prompt());
    if !cx.read(|app| app.windows().is_empty()) {
        view.read_with(cx, |s, cx| {
            assert!(s.dialogs.read(cx).is_empty());
            assert!(s.files(cx).allow_quit);
        });
    }
}

/// FM-6: a scroll over the floating title bar scrolls the document under it.
#[gpui::test]
fn scrolling_over_the_file_windows_bar_scrolls_its_document(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let long: String = (0..300).map(|i| format!("Line {i}\n\n")).collect();
    std::fs::write(root.join("long.md"), long).unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("long.md")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the file", &|s, cx| {
        s.files(cx).opened().is_some() && !s.files(cx).busy()
    });
    draw(cx);
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    for _ in 0..3 {
        cx.simulate_event(ScrollWheelEvent {
            position: point(px(300.), px(12.)),
            delta: ScrollDelta::Pixels(point(px(0.), px(-120.))),
            modifiers: Modifiers::default(),
            touch_phase: TouchPhase::Moved,
        });
        draw(cx);
    }
    view.read_with(cx, |_, cx| {
        assert!(editor.read(cx).scroll_state(cx).0 > 0., "the document scrolled")
    });
}

//! A file window.
use super::*;
use core::prelude::v1::test;

/// W-2: a file window shows its one file under a title bar of its own, with
/// no project around it, and asks before closing over unsaved edits.
#[gpui::test]
fn a_file_window_shows_one_file_and_asks_before_losing_edits(cx: &mut TestAppContext) {
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
        // Nothing watches the file.
        assert!(!s.files(cx).watching());
    });
    // It is read again when the window comes back.
    std::fs::write(root.join("notes.md"), "# Notes, changed\n").unwrap();
    view.update_in(cx, |s, w, cx| {
        s.session.docs.update(cx, |d, _| d.revalidate());
        s.receive(w, cx);
    });
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
    // Unsaved edits: the native Save, Don't Save or Cancel, asked once.
    view.update(cx, |s, cx| s.session.docs.update(cx, |d, _| d.dirty = true));
    command(&view, cx, Command::CloseEditorOrWindow);
    command(&view, cx, Command::Quit);
    assert!(cx.has_pending_prompt());
    view.read_with(cx, |s, cx| assert!(s.dialogs.read(cx).is_empty()));
    cx.simulate_prompt_answer("Cancel");
    cx.run_until_parked();
    view.read_with(cx, |s, cx| {
        assert!(!s.files(cx).allow_quit);
        assert!(!s.file.as_ref().unwrap().read(cx).asking);
    });
    assert!(!cx.has_pending_prompt());
}

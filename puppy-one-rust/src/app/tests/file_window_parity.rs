//! FileModeApp acceptance through the actual native window and document host.
use super::*;
use crate::workspace::TextEncoding;
use core::prelude::v1::test;

pub(super) fn bind(view: &Entity<Shell>, cx: &mut VisualTestContext, path: PathBuf) {
    view.update_in(cx, |s, w, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file_mode::FileTarget::of(path).unwrap(), false, w, cx);
    });
}

fn check_legacy_encoding(cx: &mut TestAppContext, bytes: &[u8], encoding: TextEncoding) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("legacy.md");
    std::fs::write(&path, bytes).unwrap();
    let (view, cx) = setup(cx);
    bind(&view, cx, path.clone());
    settle_cloud(&view, cx, "legacy file admission", &|s, cx| {
        s.files(cx).document.is_some()
    });
    let editor = view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).document.as_ref().unwrap().encoding, encoding);
        assert!(s.editor.read(cx).read_only(cx));
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    draw(cx);
    assert!(cx.debug_bounds("file-mode-encoding-notice").is_some());
    editor.update_in(cx, |e, w, cx| {
        e.run_title_action(
            crate::editor::workbench::pane::Action::Item("document-editing"),
            w,
            cx,
        );
        e.lab_type("must not persist", w, cx);
    });
    cx.run_until_parked();
    view.read_with(cx, |s, cx| {
        assert!(!s.files(cx).dirty);
        assert!(!s.files(cx).saving());
    });
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

#[gpui::test]
fn gb18030_file_window_explains_read_only_and_preserves_the_original_bytes(
    cx: &mut TestAppContext,
) {
    check_legacy_encoding(cx, &[0xc4, 0xe3, 0xba, 0xc3], TextEncoding::Gb18030);
}

#[gpui::test]
fn undecodable_file_window_explains_read_only_and_preserves_the_original_bytes(
    cx: &mut TestAppContext,
) {
    check_legacy_encoding(cx, &[0xff, 0xff], TextEncoding::Unknown);
}

#[gpui::test]
fn unavailable_and_oversized_file_windows_show_errors_without_opening_documents(
    cx: &mut TestAppContext,
) {
    use file_mode::{MAX_EDITOR_BYTES, Shown};
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let large = root.join("large.md");
    std::fs::File::create(&large)
        .unwrap()
        .set_len(MAX_EDITOR_BYTES + 1)
        .unwrap();
    let (view, cx) = setup(cx);
    for (path, limit) in [
        (large, Some(MAX_EDITOR_BYTES)),
        (root.join("missing.md"), None),
        (root, None),
    ] {
        bind(&view, cx, path);
        cx.run_until_parked();
        draw(cx);
        view.read_with(cx, |s, cx| {
            assert!(s.files(cx).workspace.is_none());
            assert!(s.files(cx).document.is_none());
            assert!(s.files(cx).opened().is_none());
            let file = s.file.as_ref().unwrap().read(cx);
            assert_eq!(file.shown(cx), Shown::Unavailable(limit));
        });
        assert!(cx.debug_bounds("file-mode-unavailable").is_some());
        assert!(!cx.has_pending_prompt());
    }
}

#[gpui::test]
fn file_window_ignores_project_commands_and_neighbour_navigation(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("note.md"), "# Bound\n").unwrap();
    std::fs::write(root.join("neighbour.md"), "# Neighbour\n").unwrap();
    let (view, cx) = setup(cx);
    bind(&view, cx, root.join("note.md"));
    settle_cloud(&view, cx, "bound document", &|s, cx| {
        s.files(cx).document.is_some()
    });
    for cmd in [
        Command::Home,
        Command::ToggleExplorer,
        Command::ToggleRightSidebar,
        Command::Changes,
        Command::CloudHistory,
        Command::OpenFolder,
        Command::CreateNew,
        Command::Settings,
        Command::Feedback,
        Command::CloseFile,
        Command::ProjectMenu,
        Command::LocationMenu,
    ] {
        command(&view, cx, cmd);
    }
    for path in ["neighbour.md", "sub/note.md", "../note.md", "/note.md", ""] {
        view.update(cx, |s, cx| {
            s.session.docs.update(cx, |d, _| {
                d.client_for(
                    d.active_slot(),
                    crate::documents::ClientMessage::OpenPaths {
                        paths: vec![path.into()],
                    },
                );
            })
        });
    }
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.files(cx).opened().map(|(_, p)| p),
            Some(std::path::Path::new("note.md"))
        );
        assert_eq!(s.files(cx).document.as_ref().unwrap().text, "# Bound\n");
        assert!(!s.home_visible(cx));
        assert!(!s.opening(cx));
        assert!(s.dialogs.read(cx).is_empty());
        assert!(s.prefs.store.read(cx).state.recent_projects.is_empty());
        assert_eq!(s.frame.layout.explorer.w, 0.);
        assert!(!s.panes.read(cx).right().open);
    });
    assert!(!cx.has_pending_prompt());
    assert_eq!(
        std::fs::read_to_string(root.join("neighbour.md")).unwrap(),
        "# Neighbour\n"
    );
}

#[gpui::test]
fn focus_revalidates_the_file_even_when_the_background_watch_is_paused(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("note.md");
    std::fs::write(&path, "before focus\n").unwrap();
    let (view, cx) = setup(cx);
    bind(&view, cx, path.clone());
    settle_cloud(&view, cx, "bound document", &|s, cx| {
        s.files(cx).document.is_some()
    });
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| d.pause_watch())
    });
    std::fs::write(path, "changed while inactive\n").unwrap();
    cx.update(|w, _| w.activate_window());
    cx.run_until_parked();
    view.update_in(cx, |s, w, cx| {
        assert!(w.is_window_active());
        s.window_activated(w, cx);
    });
    settle_cloud(&view, cx, "focus refresh", &|s, cx| {
        s.files(cx)
            .document
            .as_ref()
            .is_some_and(|d| d.text == "changed while inactive\n")
    });
}

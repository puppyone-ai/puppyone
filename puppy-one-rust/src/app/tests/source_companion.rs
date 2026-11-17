//! The native source companion must preserve the file's storage representation.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn source_panel_keyboard_edits_and_shared_undo_preserve_crlf_on_disk(cx: &mut TestAppContext) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("note.md");
    std::fs::write(&path, "a\r\nb").unwrap();
    let (view, cx) = setup(cx);
    file_window_parity::bind(&view, cx, path.clone());
    settle_cloud(&view, cx, "CRLF source admission", &|s, cx| {
        s.files(cx).document.is_some() && !s.files(cx).busy()
    });
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    editor.update_in(cx, |e, w, cx| e.command("source", w, cx));
    draw(cx);
    editor.read_with(cx, |e, cx| {
        assert_eq!(e.text(cx).as_deref(), Some("a\nb"));
        assert!(
            e.title_controls(cx)
                .toggles
                .iter()
                .any(|t| { t.id == "document-editing" && !t.checked })
        );
    });
    cx.simulate_keystrokes("cmd-down");
    cx.simulate_input("c🦀");
    settle_cloud(&view, cx, "CRLF source save", &|s, cx| {
        !s.files(cx).dirty
            && !s.files(cx).saving()
            && std::fs::read(&path).is_ok_and(|bytes| bytes == "a\r\nbc🦀".as_bytes())
    });
    editor.read_with(cx, |e, cx| {
        assert_eq!(e.text(cx).as_deref(), Some("a\nbc🦀"));
    });
    // The native buffer is LF-only; the provider owns re-encoding CRLF.
    // Undo and redo from the source must use the page's one history and
    // preserve that original storage representation on every actual save.
    cx.simulate_keystrokes("cmd-z");
    settle_cloud(&view, cx, "CRLF source undo", &|s, cx| {
        !s.files(cx).dirty
            && !s.files(cx).saving()
            && std::fs::read(&path).is_ok_and(|bytes| bytes == b"a\r\nb")
    });
    cx.simulate_keystrokes("cmd-shift-z");
    settle_cloud(&view, cx, "CRLF source redo", &|s, cx| {
        !s.files(cx).dirty
            && !s.files(cx).saving()
            && std::fs::read(&path).is_ok_and(|bytes| bytes == "a\r\nbc🦀".as_bytes())
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(editor.read(cx).text(cx).as_deref(), Some("a\nbc🦀"));
        assert!(s.files(cx).save_error.is_none());
        assert!(s.dialogs.read(cx).is_empty());
    });
}

use super::*;
use tempfile::tempdir;

fn setup(bytes: &[u8]) -> (tempfile::TempDir, Arc<Workspace>) {
    let temp = tempdir().unwrap();
    std::fs::write(temp.path().join("note.md"), bytes).unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    (temp, ws)
}
#[test]
fn real_utf8_read_edit_atomic_save_and_reopen() {
    let (temp, ws) = setup("你好\noriginal\n".as_bytes());
    let doc = ws.read(Path::new("note.md")).unwrap();
    let saved = ws.save(&doc, "你好\nchanged\n").unwrap();
    assert_eq!(saved.document.id, doc.id);
    assert!(!saved.updated);
    assert_eq!(
        ws.read(Path::new("note.md")).unwrap().text,
        "你好\nchanged\n"
    );
    assert_eq!(
        std::fs::read_dir(temp.path()).unwrap().count(),
        1,
        "No staging file should remain"
    );
}
#[test]
fn bom_crlf_and_final_newline_are_preserved() {
    let (temp, ws) = setup(b"\xef\xbb\xbfhello\r\nworld\r\n");
    let doc = ws.read(Path::new("note.md")).unwrap();
    assert_eq!(doc.text, "hello\nworld\n");
    ws.save(&doc, "hello\nupdated\n").unwrap();
    assert_eq!(
        std::fs::read(temp.path().join("note.md")).unwrap(),
        b"\xef\xbb\xbfhello\r\nupdated\r\n"
    );
}
#[test]
fn external_modification_does_not_get_overwritten() {
    let (temp, ws) = setup(b"original");
    let doc = ws.read(Path::new("note.md")).unwrap();
    std::fs::write(temp.path().join("note.md"), b"external").unwrap();
    let result = ws.save(&doc, "mine").unwrap();
    assert!(result.updated);
    assert_eq!(result.document.text, "external");
    assert_eq!(result.document.id, doc.id);
    assert_eq!(
        std::fs::read(temp.path().join("note.md")).unwrap(),
        b"external"
    );
}
#[test]
fn deletion_is_not_silently_recreated() {
    let (temp, ws) = setup(b"original");
    let doc = ws.read(Path::new("note.md")).unwrap();
    std::fs::remove_file(temp.path().join("note.md")).unwrap();
    assert!(ws.save(&doc, "mine").is_err());
    assert!(!temp.path().join("note.md").exists());
}
#[test]
fn traversal_absolute_paths_and_directories_are_rejected() {
    let (_temp, ws) = setup(b"ok");
    for path in ["../note.md", "/etc/hosts", "", ".", "one/../../note.md"] {
        assert!(ws.read(Path::new(path)).is_err(), "{path}");
    }
}
#[test]
fn unsupported_files_fail_without_modifying_bytes() {
    for bytes in [
        vec![0xff, 0xfe],
        b"a\0b".to_vec(),
        b"one\r\ntwo\n".to_vec(),
        b"one\rtwo".to_vec(),
        vec![b'a'; MAX_TEXT_BYTES + 1],
    ] {
        let (temp, ws) = setup(&bytes);
        assert!(ws.read(Path::new("note.md")).is_err());
        assert_eq!(std::fs::read(temp.path().join("note.md")).unwrap(), bytes);
    }
}
#[test]
fn document_grants_cannot_be_used_in_another_workspace() {
    let (_a, first) = setup(b"same");
    let (_b, second) = setup(b"same");
    let document = first.read(Path::new("note.md")).unwrap();
    assert!(
        second
            .save(&document, "wrong workspace")
            .unwrap_err()
            .to_string()
            .contains("different workspace")
    );
}
#[test]
fn unchanged_save_does_not_replace_the_file() {
    let (temp, ws) = setup(b"same");
    let document = ws.read(Path::new("note.md")).unwrap();
    let before = std::fs::metadata(temp.path().join("note.md")).unwrap();
    let saved = ws.save(&document, "same").unwrap();
    let after = std::fs::metadata(temp.path().join("note.md")).unwrap();
    assert_eq!(saved.document.text, document.text);
    assert_eq!(before.modified().unwrap(), after.modified().unwrap());
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(before.ino(), after.ino());
    }
}
#[test]
fn invalid_save_payload_leaves_original_bytes_untouched() {
    let (temp, ws) = setup(b"original");
    let document = ws.read(Path::new("note.md")).unwrap();
    for text in [
        "a\0b".into(),
        "bad\rinput".into(),
        "x".repeat(MAX_TEXT_BYTES + 1),
    ] {
        assert!(ws.save(&document, &text).is_err());
        assert_eq!(
            std::fs::read(temp.path().join("note.md")).unwrap(),
            b"original"
        );
    }
}
#[cfg(unix)]
#[test]
fn saving_a_hard_link_does_not_break_link_semantics() {
    let (temp, ws) = setup(b"original");
    std::fs::hard_link(temp.path().join("note.md"), temp.path().join("other.md")).unwrap();
    let document = ws.read(Path::new("note.md")).unwrap();
    assert!(ws.save(&document, "new").is_err());
    assert_eq!(
        std::fs::read(temp.path().join("other.md")).unwrap(),
        b"original"
    );
}
#[test]
fn lists_are_relative_and_directories_sort_first() {
    let (temp, ws) = setup(b"ok");
    std::fs::create_dir(temp.path().join("z-dir")).unwrap();
    let list = ws.list(Path::new("")).unwrap();
    assert_eq!(list[0].name, "z-dir");
    assert_eq!(list[1].path, Path::new("note.md"));
}
#[cfg(unix)]
#[test]
fn permissions_are_preserved_and_readonly_save_is_refused() {
    use std::os::unix::fs::PermissionsExt;
    let (temp, ws) = setup(b"ok");
    let path = temp.path().join("note.md");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
    let doc = ws.read(Path::new("note.md")).unwrap();
    ws.save(&doc, "edit").unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o640
    );
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o440)).unwrap();
    let doc = ws.read(Path::new("note.md")).unwrap();
    assert!(ws.save(&doc, "no").is_err());
}
#[cfg(unix)]
#[test]
fn symlinks_cannot_read_or_write_outside_granted_root() {
    use std::os::unix::fs::symlink;
    let (temp, ws) = setup(b"ok");
    let outside = tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), b"private").unwrap();
    symlink(outside.path(), temp.path().join("escape")).unwrap();
    symlink(
        outside.path().join("secret.txt"),
        temp.path().join("link.txt"),
    )
    .unwrap();
    assert!(ws.read(Path::new("escape/secret.txt")).is_err());
    assert!(ws.read(Path::new("link.txt")).is_err());
    let doc = ws.read(Path::new("note.md")).unwrap();
    std::fs::remove_file(temp.path().join("note.md")).unwrap();
    symlink(
        outside.path().join("secret.txt"),
        temp.path().join("note.md"),
    )
    .unwrap();
    assert!(ws.save(&doc, "attempt").is_err());
    assert_eq!(
        std::fs::read(outside.path().join("secret.txt")).unwrap(),
        b"private"
    );
}

#[test]
fn creation_publishes_complete_bytes_without_replacing_an_existing_name() {
    let temp = tempfile::tempdir().unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let root = std::path::Path::new("");
    ws.create_entry(root, "Folder", true, "").unwrap();
    ws.create_entry(
        std::path::Path::new("Folder"),
        "Note.md",
        false,
        "# Created\n",
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(temp.path().join("Folder/Note.md")).unwrap(),
        "# Created\n"
    );
    assert!(
        ws.create_entry(
            std::path::Path::new("Folder"),
            "Note.md",
            false,
            "overwrite"
        )
        .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(temp.path().join("Folder/Note.md")).unwrap(),
        "# Created\n"
    );
    for name in ["../escape", "/escape", "a/b", "."] {
        assert!(ws.create_entry(root, name, false, "no").is_err());
    }
    assert_eq!(ws.list(std::path::Path::new("Folder")).unwrap().len(), 1);
}
#[test]
fn rename_move_copy_import_and_delete_stay_inside_the_grant() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("docs")).unwrap();
    std::fs::write(dir.path().join("note.md"), "hi").unwrap();
    std::fs::write(dir.path().join("other.md"), "x").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let p = std::path::Path::new;
    // Rename refuses to replace and rejects separators.
    assert!(ws.rename_entry(p("note.md"), "other.md").is_err());
    assert!(ws.rename_entry(p("note.md"), "a/b.md").is_err());
    assert_eq!(
        ws.rename_entry(p("note.md"), "renamed.md").unwrap(),
        p("renamed.md")
    );
    // Duplicate in place gets keep-both names; copies into a folder keep the name.
    assert_eq!(
        ws.copy_entry(p("renamed.md"), p("")).unwrap(),
        p("renamed copy.md")
    );
    assert_eq!(
        ws.copy_entry(p("renamed.md"), p("")).unwrap(),
        p("renamed copy 2.md")
    );
    assert_eq!(
        ws.copy_entry(p("renamed copy.md"), p("")).unwrap(),
        p("renamed copy 3.md")
    );
    assert_eq!(
        ws.copy_entry(p("renamed.md"), p("docs")).unwrap(),
        p("docs/renamed.md")
    );
    assert!(ws.copy_entry(p("docs"), p("docs")).is_err());
    // Move keeps the name and refuses folders into themselves.
    assert!(ws.move_entry(p("other.md"), p("docs")).is_ok());
    assert!(ws.move_entry(p("docs"), p("docs")).is_err());
    assert!(dir.path().join("docs/other.md").is_file());
    // Import copies from outside; delete removes whole folders.
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("in.txt"), "imported").unwrap();
    assert_eq!(
        ws.import_external(&outside.path().join("in.txt"), p("docs"))
            .unwrap(),
        p("docs/in.txt")
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("docs/in.txt")).unwrap(),
        "imported"
    );
    assert!(outside.path().join("in.txt").exists());
    ws.remove_entry(p("docs")).unwrap();
    assert!(!dir.path().join("docs").exists());
    assert!(ws.remove_entry(p("../escape")).is_err());
}

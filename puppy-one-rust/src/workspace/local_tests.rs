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
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666)).unwrap();
    let doc = ws.read(Path::new("note.md")).unwrap();
    ws.save(&doc, "edit").unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o666
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
#[test]
fn a_file_windows_folder_reads_legacy_text_and_never_writes_it() {
    let temp = tempdir().unwrap();
    let gb = encoding_rs::GB18030.encode("旧编码\n").0.into_owned();
    std::fs::write(temp.path().join("gb.md"), &gb).unwrap();
    std::fs::write(temp.path().join("bytes.md"), b"caf\xe9\n").unwrap();
    // A project refuses text that is not UTF-8.
    let project = Workspace::open(temp.path()).unwrap();
    assert!(project.read(Path::new("gb.md")).is_err());
    // A file window decodes GB18030, else shows replacement characters.
    let window = Workspace::open_with(temp.path(), true).unwrap();
    let doc = window.read(Path::new("gb.md")).unwrap();
    assert_eq!(
        (doc.text.as_str(), doc.encoding),
        ("旧编码\n", TextEncoding::Gb18030)
    );
    let doc = window.read(Path::new("bytes.md")).unwrap();
    assert_eq!(doc.encoding, TextEncoding::Unknown);
    assert!(doc.text.contains('\u{fffd}'));
    // Neither is ever written back.
    assert!(window.save(&doc, "café\n").is_err());
    assert_eq!(
        std::fs::read(temp.path().join("bytes.md")).unwrap(),
        b"caf\xe9\n"
    );
}

#[test]
fn simultaneous_same_path_saves_across_independent_grants_have_exactly_one_winner() {
    for _ in 0..8 {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("race.txt"), "base").unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let mut workers = Vec::new();
        for i in 0..8 {
            let ws = Workspace::open(dir.path()).unwrap();
            let doc = ws.read(Path::new("race.txt")).unwrap();
            let barrier = barrier.clone();
            workers.push(std::thread::spawn(move || {
                let text = char::from(b'a' + i).to_string().repeat(1024 * 1024);
                barrier.wait();
                let result = ws.save(&doc, &text).unwrap();
                (text, result.updated)
            }));
        }
        let results: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
        let winners: Vec<_> = results.iter().filter(|(_, updated)| !updated).collect();
        assert_eq!(
            winners.len(),
            1,
            "same baseline admitted more than one writer"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("race.txt")).unwrap(),
            winners[0].0
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
#[test]
fn simultaneous_copies_keep_every_complete_result_and_never_remove_another_winner() {
    for _ in 0..8 {
        let dir = tempdir().unwrap();
        let content = "copy me".repeat(128 * 1024);
        std::fs::write(dir.path().join("source.txt"), &content).unwrap();
        std::fs::create_dir(dir.path().join("target")).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let ws = Workspace::open(dir.path()).unwrap();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    ws.copy_entry(Path::new("source.txt"), Path::new("target"))
                })
            })
            .collect();
        let paths: Vec<_> = workers
            .into_iter()
            .map(|w| w.join().unwrap().unwrap())
            .collect();
        assert_eq!(
            paths.iter().collect::<std::collections::HashSet<_>>().len(),
            8
        );
        for path in paths {
            assert_eq!(
                std::fs::read_to_string(dir.path().join(path)).unwrap(),
                content
            );
        }
        assert_eq!(
            std::fs::read_dir(dir.path().join("target"))
                .unwrap()
                .count(),
            8
        );
    }
}
#[cfg(unix)]
#[test]
fn direct_symlink_mutations_are_rejected_without_removing_the_link_or_target() {
    use std::os::unix::fs::symlink;
    for action in ["rename", "remove", "move", "copy"] {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        symlink(
            outside.path().join("secret.txt"),
            dir.path().join("linked.txt"),
        )
        .unwrap();
        std::fs::create_dir(dir.path().join("target")).unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        let result = match action {
            "rename" => ws
                .rename_entry(Path::new("linked.txt"), "renamed.txt")
                .map(|_| ()),
            "remove" => ws.remove_entry(Path::new("linked.txt")),
            "move" => ws
                .move_entry(Path::new("linked.txt"), Path::new("target"))
                .map(|_| ()),
            "copy" => ws
                .copy_entry(Path::new("linked.txt"), Path::new("target"))
                .map(|_| ()),
            _ => unreachable!(),
        };
        assert!(result.is_err(), "{action} accepted a symbolic link");
        assert!(
            std::fs::symlink_metadata(dir.path().join("linked.txt"))
                .unwrap()
                .is_symlink()
        );
        assert_eq!(
            std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "secret"
        );
    }
}
#[cfg(unix)]
#[test]
fn symlinked_parent_folders_are_refused_even_when_they_point_inside_the_grant() {
    use std::os::unix::fs::symlink;
    for action in [
        "read", "list", "resource", "create", "copy", "move", "import",
    ] {
        let (dir, ws) = setup(b"source");
        std::fs::create_dir(dir.path().join("real")).unwrap();
        std::fs::write(dir.path().join("real/inside.txt"), "inside").unwrap();
        symlink("real", dir.path().join("linked")).unwrap();
        let result = match action {
            "read" => ws.read(Path::new("linked/inside.txt")).map(|_| ()),
            "list" => ws.list(Path::new("linked")).map(|_| ()),
            "resource" => ws.resource(Path::new("linked/inside.txt")).map(|_| ()),
            "create" => ws
                .create_entry(Path::new("linked"), "new.txt", false, "new")
                .map(|_| ()),
            "copy" => ws
                .copy_entry(Path::new("note.md"), Path::new("linked"))
                .map(|_| ()),
            "move" => ws
                .move_entry(Path::new("note.md"), Path::new("linked"))
                .map(|_| ()),
            "import" => ws
                .import_external(&dir.path().join("note.md"), Path::new("linked"))
                .map(|_| ()),
            _ => unreachable!(),
        };
        assert!(result.is_err(), "{action} followed a linked directory");
        assert_eq!(
            std::fs::read_dir(dir.path().join("real")).unwrap().count(),
            1
        );
    }
}
#[cfg(unix)]
#[test]
fn copying_a_readonly_directory_preserves_modes_after_copying_its_children() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let src = dir.path().join("source");
    std::fs::create_dir(&src).unwrap();
    std::fs::write(src.join("note.txt"), "readonly").unwrap();
    std::fs::set_permissions(&src, std::fs::Permissions::from_mode(0o555)).unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let copied = ws.copy_entry(Path::new("source"), Path::new("")).unwrap();
    let target = dir.path().join(&copied);
    let mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;
    let content = std::fs::read_to_string(target.join("note.txt")).unwrap();
    std::fs::set_permissions(&src, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(copied, Path::new("source copy"));
    assert_eq!(mode, 0o555);
    assert_eq!(content, "readonly");
}
#[test]
fn import_rejects_relative_sources_and_name_collisions_without_touching_either_file() {
    let (dir, ws) = setup(b"existing");
    assert!(
        ws.import_external(Path::new("Cargo.toml"), Path::new(""))
            .is_err()
    );
    let outside = tempdir().unwrap();
    std::fs::write(outside.path().join("note.md"), "incoming").unwrap();
    assert!(
        ws.import_external(&outside.path().join("note.md"), Path::new(""))
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("note.md")).unwrap(),
        "existing"
    );
    assert_eq!(
        std::fs::read_to_string(outside.path().join("note.md")).unwrap(),
        "incoming"
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
#[cfg(unix)]
#[test]
fn failed_recursive_copy_and_import_leave_no_partial_tree() {
    use std::os::unix::fs::symlink;
    for import in [false, true] {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source_root = if import { outside.path() } else { dir.path() };
        std::fs::create_dir(source_root.join("source")).unwrap();
        std::fs::write(source_root.join("source/safe.txt"), "safe").unwrap();
        symlink("safe.txt", source_root.join("source/linked.txt")).unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        let result = if import {
            ws.import_external(&source_root.join("source"), Path::new(""))
        } else {
            ws.copy_entry(Path::new("source"), Path::new(""))
        };
        assert!(result.is_err());
        assert!(
            !dir.path()
                .join(if import { "source" } else { "source copy" })
                .exists()
        );
        assert_eq!(
            std::fs::read_to_string(source_root.join("source/safe.txt")).unwrap(),
            "safe"
        );
    }
}

#[test]
fn real_entry_creation_and_raw_previews_preserve_exact_bytes_and_empty_files() {
    let dir = tempdir().unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let root = Path::new("");
    assert!(Workspace::open(&dir.path().join("missing")).is_err());
    ws.create_entry(root, "empty.txt", false, "").unwrap();
    assert!(Workspace::open(&dir.path().join("empty.txt")).is_err());
    assert_eq!(std::fs::read(dir.path().join("empty.txt")).unwrap(), b"");
    ws.create_entry(root, "docs", true, "").unwrap();
    let body = "# Title\n\nHello **world** — 你好\n";
    ws.create_entry(Path::new("docs"), "note.md", false, body)
        .unwrap();
    assert_eq!(ws.read(Path::new("docs/note.md")).unwrap().text, body);
    assert_eq!(
        std::fs::read(dir.path().join("docs/note.md")).unwrap(),
        body.as_bytes()
    );
    let bytes = [0x50, 0x4b, 0x03, 0x04, 0x00, 0xff];
    std::fs::write(dir.path().join("bytes.bin"), bytes).unwrap();
    assert_eq!(
        ws.resource(Path::new("bytes.bin"))
            .unwrap()
            .bytes(100)
            .unwrap(),
        bytes
    );
    assert!(ws.read(Path::new("bytes.bin")).is_err());
    assert!(ws.resource(Path::new("docs")).is_err());
    assert!(ws.read(Path::new("docs")).is_err());
    assert!(ws.resource(Path::new("../../etc/passwd")).is_err());
}
#[test]
fn moving_to_a_parent_and_removing_entries_never_mutates_the_root() {
    let dir = tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("parent/child")).unwrap();
    std::fs::write(dir.path().join("parent/child/nested.txt"), "nested").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let moved = ws
        .move_entry(Path::new("parent/child/nested.txt"), Path::new("parent"))
        .unwrap();
    assert_eq!(moved, Path::new("parent/nested.txt"));
    assert!(!dir.path().join("parent/child/nested.txt").exists());
    assert_eq!(ws.read(&moved).unwrap().text, "nested");
    assert!(ws.rename_entry(Path::new(""), "renamed").is_err());
    assert!(ws.remove_entry(Path::new("")).is_err());
    assert!(ws.copy_entry(Path::new(""), Path::new("parent")).is_err());
    ws.remove_entry(&moved).unwrap();
    assert!(!dir.path().join(moved).exists());
    assert!(dir.path().join("parent/child").is_dir());
}
#[test]
fn copy_keeps_exact_names_compound_extensions_and_every_recursive_source_byte() {
    let dir = tempdir().unwrap();
    std::fs::create_dir(dir.path().join("target")).unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    for (name, duplicate) in [
        (" note ", " note  copy"),
        (".env", ".env copy"),
        ("archive.tar.gz", "archive copy.tar.gz"),
    ] {
        std::fs::write(dir.path().join(name), name).unwrap();
        assert_eq!(
            ws.copy_entry(Path::new(name), Path::new("target")).unwrap(),
            Path::new("target").join(name)
        );
        assert_eq!(
            ws.copy_entry(Path::new(name), Path::new("target")).unwrap(),
            Path::new("target").join(duplicate)
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("target").join(name)).unwrap(),
            name
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("target").join(duplicate)).unwrap(),
            name
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join(name)).unwrap(),
            name
        );
    }
    std::fs::create_dir_all(dir.path().join("folder.name/nested")).unwrap();
    std::fs::write(dir.path().join("folder.name/nested/note.md"), "# Copy").unwrap();
    let copied = ws
        .copy_entry(Path::new("folder.name"), Path::new(""))
        .unwrap();
    assert_eq!(copied, Path::new("folder.name copy"));
    for folder in ["folder.name", "folder.name copy"] {
        assert_eq!(
            std::fs::read_to_string(dir.path().join(folder).join("nested/note.md")).unwrap(),
            "# Copy"
        );
    }
    let outside = tempdir().unwrap();
    std::fs::create_dir_all(outside.path().join("imported/child")).unwrap();
    std::fs::write(outside.path().join("imported/child/bytes"), [0, 1, 255]).unwrap();
    assert_eq!(
        ws.import_external(&outside.path().join("imported"), Path::new(""))
            .unwrap(),
        Path::new("imported")
    );
    for root in [dir.path(), outside.path()] {
        assert_eq!(
            std::fs::read(root.join("imported/child/bytes")).unwrap(),
            [0, 1, 255]
        );
    }
}
#[test]
fn every_local_mutation_and_listing_rejects_traversal_and_absolute_targets() {
    let (dir, ws) = setup(b"untouched");
    for path in ["..", "../..", "a/../../escape", "/etc"] {
        let escape = Path::new(path);
        assert!(ws.create_entry(escape, "new.txt", false, "no").is_err());
        assert!(ws.list(escape).is_err());
        assert!(ws.read(escape).is_err());
        assert!(ws.remove_entry(escape).is_err());
        assert!(ws.rename_entry(escape, "renamed").is_err());
        assert!(ws.move_entry(escape, Path::new("")).is_err());
        assert!(ws.move_entry(Path::new("note.md"), escape).is_err());
        assert!(ws.copy_entry(escape, Path::new("")).is_err());
        assert!(ws.copy_entry(Path::new("note.md"), escape).is_err());
    }
    assert_eq!(
        std::fs::read(dir.path().join("note.md")).unwrap(),
        b"untouched"
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
#[cfg(unix)]
#[test]
fn listing_and_import_reject_links_without_hiding_real_entries() {
    use std::os::unix::fs::symlink;
    let (dir, ws) = setup(b"real");
    let outside = tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();
    symlink(
        outside.path().join("secret.txt"),
        dir.path().join("link.txt"),
    )
    .unwrap();
    symlink(
        outside.path().join("secret.txt"),
        outside.path().join("link.txt"),
    )
    .unwrap();
    assert_eq!(
        ws.list(Path::new(""))
            .unwrap()
            .iter()
            .map(|n| n.name.as_str())
            .collect::<Vec<_>>(),
        ["note.md"]
    );
    assert!(
        ws.import_external(&outside.path().join("link.txt"), Path::new(""))
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
        "secret"
    );
}

#[cfg(unix)]
#[test]
fn recursive_failure_cleans_copied_readonly_children_without_changing_sources() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let dir = tempdir().unwrap();
    std::fs::create_dir(dir.path().join("source")).unwrap();
    for i in 0..16 {
        let child = dir.path().join(format!("source/child-{i}"));
        std::fs::create_dir(&child).unwrap();
        std::fs::write(child.join("keep.txt"), "keep").unwrap();
        std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o555)).unwrap();
    }
    symlink("child-0/keep.txt", dir.path().join("source/reject-link")).unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let result = ws.copy_entry(Path::new("source"), Path::new(""));
    let residual = dir.path().join("source copy").exists();
    for i in 0..16 {
        let child = dir.path().join(format!("source/child-{i}"));
        assert_eq!(std::fs::read(child.join("keep.txt")).unwrap(), b"keep");
        assert_eq!(
            std::fs::metadata(&child).unwrap().permissions().mode() & 0o777,
            0o555
        );
        std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o755)).unwrap();
        let copied = dir.path().join(format!("source copy/child-{i}"));
        if copied.exists() {
            std::fs::set_permissions(copied, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    assert!(result.is_err());
    assert!(
        !residual,
        "failed copy left a partially copied readonly tree"
    );
}

use super::*;
use tempfile::tempdir;

fn setup(bytes: &[u8]) -> (tempfile::TempDir, Arc<Workspace>) {
    let temp = tempdir().unwrap();
    std::fs::write(temp.path().join("note.md"), bytes).unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    (temp, ws)
}

#[cfg(unix)]
#[test]
fn deferred_preview_reads_stay_bound_to_the_admitted_root_after_a_rename() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("project");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("file.bin"), b"admitted").unwrap();
    let ws = Workspace::open(&root).unwrap();
    let preview = ws.resource(Path::new("file.bin")).unwrap();
    std::fs::rename(&root, temp.path().join("renamed")).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("file.bin"), b"different workspace").unwrap();
    assert_eq!(preview.bytes(100).unwrap(), b"admitted");
}

#[cfg(unix)]
#[test]
fn deferred_preview_reads_refuse_replaced_leaf_and_parent_symlinks() {
    use std::os::unix::fs::symlink;
    for replace_parent in [false, true] {
        for inside in [false, true] {
            let temp = tempdir().unwrap();
            let outside = tempdir().unwrap();
            std::fs::create_dir(temp.path().join("docs")).unwrap();
            std::fs::create_dir(temp.path().join("other")).unwrap();
            std::fs::write(temp.path().join("docs/file.bin"), b"admitted").unwrap();
            let replacement = if inside {
                temp.path().join("other")
            } else {
                outside.path().to_path_buf()
            };
            std::fs::write(replacement.join("file.bin"), b"not admitted").unwrap();
            let ws = Workspace::open(temp.path()).unwrap();
            let preview = ws.resource(Path::new("docs/file.bin")).unwrap();
            if replace_parent {
                std::fs::rename(temp.path().join("docs"), temp.path().join("saved-docs")).unwrap();
                symlink(&replacement, temp.path().join("docs")).unwrap();
            } else {
                std::fs::remove_file(temp.path().join("docs/file.bin")).unwrap();
                symlink(
                    replacement.join("file.bin"),
                    temp.path().join("docs/file.bin"),
                )
                .unwrap();
            }
            assert!(
                preview.bytes(100).is_none(),
                "parent={replace_parent}, inside={inside}"
            );
        }
    }
}

#[test]
fn deferred_preview_byte_budgets_handle_growth_empty_files_and_integer_limits() {
    let (temp, ws) = setup(b"data");
    let preview = ws.resource(Path::new("note.md")).unwrap();
    assert!(preview.bytes(3).is_none());
    assert_eq!(preview.bytes(4).unwrap(), b"data");
    assert_eq!(preview.bytes(u64::MAX).unwrap(), b"data");
    std::fs::write(temp.path().join("note.md"), b"grown after admission").unwrap();
    assert!(preview.bytes(4).is_none());
    std::fs::write(temp.path().join("note.md"), b"").unwrap();
    assert_eq!(preview.bytes(0).unwrap(), b"");
    ws.revoke();
    assert!(preview.bytes(u64::MAX).is_none());
}

#[test]
fn deferred_preview_identity_cannot_be_retargeted_after_admission() {
    let (temp, ws) = setup(b"admitted");
    std::fs::write(temp.path().join("other.bin"), b"another resource").unwrap();
    let preview = ws.resource(Path::new("note.md")).unwrap();
    let mut changed_path = preview.clone();
    changed_path.identity.path = contracts::RelativePath::new(Path::new("other.bin")).unwrap();
    assert_eq!(
        changed_path.data().unwrap_err().kind,
        ErrorKind::ForeignResource
    );
    assert!(changed_path.bytes(100).is_none());
    let mut changed_storage = preview.clone();
    changed_storage.identity.storage =
        contracts::StorageId::new("memory://foreign/project/").unwrap();
    assert_eq!(
        changed_storage.data().unwrap_err().kind,
        ErrorKind::ForeignResource
    );
    assert!(changed_storage.bytes(100).is_none());
    assert_eq!(preview.bytes(100).unwrap(), b"admitted");
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
    for (bytes, expected_kind) in [
        (b"a\0b".to_vec(), ErrorKind::InvalidData),
        (vec![0xff, 0xfe, 0x00, 0x00], ErrorKind::InvalidData),
        (vec![0xfe, 0xff, 0x00, 0x00], ErrorKind::InvalidData),
        (vec![b'a'; MAX_TEXT_BYTES + 1], ErrorKind::InvalidInput),
    ] {
        let (temp, ws) = setup(&bytes);
        let err = ws.read(Path::new("note.md")).unwrap_err();
        assert_eq!(err.kind, expected_kind);
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
    use std::os::unix::fs::MetadataExt;
    let (temp, ws) = setup(b"original content");
    let primary = temp.path().join("note.md");
    let peer = temp.path().join("other.md");
    std::fs::hard_link(&primary, &peer).unwrap();
    let ino_before = std::fs::metadata(&primary).unwrap().ino();
    assert_eq!(ino_before, std::fs::metadata(&peer).unwrap().ino());

    // DP-30: hard-linked files save in place via sibling backup, preserving
    // shared inode identity across all links (both growing and shrinking).
    let document = ws.read(Path::new("note.md")).unwrap();
    let saved = ws
        .save(&document, "expanded hard-link content\nsecond line\n")
        .unwrap();
    assert!(!saved.updated);
    assert_eq!(
        std::fs::read_to_string(&peer).unwrap(),
        "expanded hard-link content\nsecond line\n"
    );
    assert_eq!(std::fs::metadata(&primary).unwrap().ino(), ino_before);
    assert_eq!(std::fs::metadata(&peer).unwrap().ino(), ino_before);
    assert_eq!(std::fs::metadata(&primary).unwrap().nlink(), 2);

    // Shrinking in place must truncate cleanly and leave no backup file behind.
    let shrunk = ws.save(&saved.document, "tiny").unwrap();
    assert!(!shrunk.updated);
    assert_eq!(std::fs::read_to_string(&peer).unwrap(), "tiny");
    assert_eq!(std::fs::metadata(&primary).unwrap().ino(), ino_before);
    assert_eq!(
        std::fs::read_dir(temp.path()).unwrap().count(),
        2,
        "only the two hard-linked entries should exist"
    );
}

#[cfg(unix)]
#[test]
fn xattrs_and_creation_time_survive_atomic_save() {
    use std::ffi::CString;
    let (temp, ws) = setup(b"initial\n");
    let file_path = temp.path().join("note.md");
    let c_path = CString::new(file_path.as_os_str().as_encoded_bytes()).unwrap();
    #[cfg(target_os = "macos")]
    let attr_name = CString::new("com.puppyone.test-tag").unwrap();
    #[cfg(not(target_os = "macos"))]
    let attr_name = CString::new("user.puppyone.test-tag").unwrap();
    let attr_val = b"finder-tag-payload";

    #[cfg(target_os = "macos")]
    let set_rc = unsafe {
        libc::setxattr(
            c_path.as_ptr(),
            attr_name.as_ptr(),
            attr_val.as_ptr().cast(),
            attr_val.len(),
            0,
            0,
        )
    };
    #[cfg(not(target_os = "macos"))]
    let set_rc = unsafe {
        libc::setxattr(
            c_path.as_ptr(),
            attr_name.as_ptr(),
            attr_val.as_ptr().cast(),
            attr_val.len(),
            0,
        )
    };
    assert_eq!(
        set_rc,
        0,
        "setxattr failed: {}",
        std::io::Error::last_os_error()
    );

    #[cfg(target_os = "macos")]
    let pinned_birthtime: libc::time_t = 1_700_000_123;
    #[cfg(target_os = "macos")]
    {
        let mut attrlist = libc::attrlist {
            bitmapcount: libc::ATTR_BIT_MAP_COUNT,
            reserved: 0,
            commonattr: libc::ATTR_CMN_CRTIME,
            volattr: 0,
            dirattr: 0,
            fileattr: 0,
            forkattr: 0,
        };
        let mut crtime = libc::timespec {
            tv_sec: pinned_birthtime,
            tv_nsec: 0,
        };
        let rc = unsafe {
            libc::setattrlist(
                c_path.as_ptr(),
                (&raw mut attrlist).cast(),
                (&raw mut crtime).cast(),
                std::mem::size_of::<libc::timespec>(),
                0,
            )
        };
        assert_eq!(
            rc,
            0,
            "setattrlist failed: {}",
            std::io::Error::last_os_error()
        );
    }

    let doc = ws.read(Path::new("note.md")).unwrap();
    let saved = ws.save(&doc, "saved with metadata intact\n").unwrap();
    assert!(!saved.updated);

    let mut got = vec![0u8; 64];
    #[cfg(target_os = "macos")]
    let got_len = unsafe {
        libc::getxattr(
            c_path.as_ptr(),
            attr_name.as_ptr(),
            got.as_mut_ptr().cast(),
            got.len(),
            0,
            0,
        )
    };
    #[cfg(not(target_os = "macos"))]
    let got_len = unsafe {
        libc::getxattr(
            c_path.as_ptr(),
            attr_name.as_ptr(),
            got.as_mut_ptr().cast(),
            got.len(),
        )
    };
    assert_eq!(got_len, attr_val.len() as isize);
    assert_eq!(&got[..got_len as usize], attr_val);

    #[cfg(target_os = "macos")]
    {
        let mut st = std::mem::MaybeUninit::<libc::stat>::zeroed();
        assert_eq!(unsafe { libc::stat(c_path.as_ptr(), st.as_mut_ptr()) }, 0);
        let st = unsafe { st.assume_init() };
        assert_eq!(st.st_birthtime, pinned_birthtime);
    }
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
    let gb = encoding_rs::GB18030
        .encode("旧编码\r\n第二行\r\n")
        .0
        .into_owned();
    std::fs::write(temp.path().join("gb.md"), &gb).unwrap();
    std::fs::write(temp.path().join("bytes.md"), b"caf\xe9\n").unwrap();

    // DP-32: both project windows and file windows decode lossless GB18030 and
    // UTF-16 with BOM identically and save back in their original encoding,
    // while lossy bytes open read-only (`TextEncoding::Lossy`).
    for ws in [
        Workspace::open(temp.path()).unwrap(),
        Workspace::open_with(temp.path(), true).unwrap(),
    ] {
        let gb_doc = ws.read(Path::new("gb.md")).unwrap();
        assert_eq!(gb_doc.encoding, TextEncoding::Gb18030);
        assert_eq!(gb_doc.line_ending, LineEnding::Crlf);
        assert!(!gb_doc.is_lossy_readonly());
        assert_eq!(gb_doc.readonly_reason(), None);

        let lossy_doc = ws.read(Path::new("bytes.md")).unwrap();
        assert_eq!(lossy_doc.encoding, TextEncoding::Lossy);
        assert!(lossy_doc.is_lossy_readonly());
        assert!(lossy_doc.readonly_reason().is_some());
        assert!(lossy_doc.text.contains('\u{fffd}'));
        assert_eq!(
            ws.save(&lossy_doc, "café\n").unwrap_err().kind,
            ErrorKind::PermissionDenied
        );
        assert_eq!(
            std::fs::read(temp.path().join("bytes.md")).unwrap(),
            b"caf\xe9\n"
        );
    }

    // Round-trip save in GB18030 preserves GB18030 encoding and CRLF line endings.
    let project = Workspace::open(temp.path()).unwrap();
    let gb_doc = project.read(Path::new("gb.md")).unwrap();
    assert_eq!(gb_doc.text, "旧编码\n第二行\n");
    let saved = project.save(&gb_doc, "新编码保存\n第二行\n").unwrap();
    assert!(!saved.updated);
    assert_eq!(saved.document.encoding, TextEncoding::Gb18030);
    let expected_gb = encoding_rs::GB18030
        .encode("新编码保存\r\n第二行\r\n")
        .0
        .into_owned();
    assert_eq!(
        std::fs::read(temp.path().join("gb.md")).unwrap(),
        expected_gb
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
    let spaced = if cfg!(windows) {
        (" note", " note copy")
    } else {
        (" note ", " note  copy")
    };
    for (name, duplicate) in [
        spaced,
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

#[test]
fn simultaneous_renames_and_moves_publish_one_winner_without_losing_sources() {
    use std::sync::Barrier;
    for moving in [false, true] {
        for _ in 0..32 {
            let dir = tempdir().unwrap();
            std::fs::create_dir(dir.path().join("target")).unwrap();
            let starts = Arc::new(Barrier::new(8));
            let results = std::thread::scope(|scope| {
                let handles: Vec<_> = (0..8)
                    .map(|i| {
                        let source = if moving {
                            std::fs::create_dir(dir.path().join(format!("source-{i}"))).unwrap();
                            format!("source-{i}/winner.txt")
                        } else {
                            format!("source-{i}.txt")
                        };
                        std::fs::write(dir.path().join(&source), format!("writer-{i}")).unwrap();
                        let ws = Workspace::open(dir.path()).unwrap();
                        let starts = starts.clone();
                        scope.spawn(move || {
                            starts.wait();
                            let result = if moving {
                                ws.move_entry(Path::new(&source), Path::new("target"))
                            } else {
                                ws.rename_entry(Path::new(&source), "winner.txt")
                            };
                            (i, source, result)
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|h| h.join().unwrap())
                    .collect::<Vec<_>>()
            });
            let winners: Vec<_> = results
                .iter()
                .filter(|(_, _, result)| result.is_ok())
                .collect();
            assert_eq!(
                winners.len(),
                1,
                "multiple sources were replaced: {results:?}"
            );
            let destination = dir.path().join(if moving {
                "target/winner.txt"
            } else {
                "winner.txt"
            });
            assert_eq!(
                std::fs::read_to_string(destination).unwrap(),
                format!("writer-{}", winners[0].0)
            );
            for (i, source, result) in results {
                if let Err(error) = result {
                    assert_eq!(error.kind, ErrorKind::AlreadyExists);
                    assert_eq!(
                        std::fs::read_to_string(dir.path().join(source)).unwrap(),
                        format!("writer-{i}")
                    );
                } else {
                    assert!(!dir.path().join(source).exists());
                }
            }
        }
    }
}

#[test]
fn case_only_renames_follow_filesystem_identity_without_replacing_distinct_files() {
    use std::io::Write;
    let dir = match std::env::var_os("PUPPYONE_CASE_SENSITIVE_TEST_ROOT") {
        Some(root) => tempfile::tempdir_in(root).unwrap(),
        None => tempdir().unwrap(),
    };
    let ws = Workspace::open(dir.path()).unwrap();
    std::fs::write(dir.path().join("note.txt"), "original").unwrap();
    let separate = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.path().join("NOTE.txt"));
    match separate {
        Ok(mut file) => {
            file.write_all(b"existing destination").unwrap();
            drop(file);
            assert!(ws.rename_entry(Path::new("note.txt"), "NOTE.txt").is_err());
            assert_eq!(
                std::fs::read(dir.path().join("note.txt")).unwrap(),
                b"original"
            );
            assert_eq!(
                std::fs::read(dir.path().join("NOTE.txt")).unwrap(),
                b"existing destination"
            );
        }
        Err(error) => {
            assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
            assert!(
                std::env::var_os("PUPPYONE_CASE_SENSITIVE_TEST_ROOT").is_none(),
                "the required case-sensitive fixture is not case-sensitive"
            );
            assert_eq!(
                ws.rename_entry(Path::new("note.txt"), "NOTE.txt").unwrap(),
                Path::new("NOTE.txt")
            );
            assert_eq!(
                std::fs::read(dir.path().join("NOTE.txt")).unwrap(),
                b"original"
            );
            assert_eq!(
                std::fs::read_dir(dir.path())
                    .unwrap()
                    .next()
                    .unwrap()
                    .unwrap()
                    .file_name(),
                "NOTE.txt"
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn existing_hardlink_and_symlink_destinations_are_never_replaced() {
    use std::os::unix::fs::symlink;
    let (dir, ws) = setup(b"source");
    std::fs::hard_link(dir.path().join("note.md"), dir.path().join("existing.md")).unwrap();
    symlink("missing.md", dir.path().join("dangling.md")).unwrap();
    for target in ["existing.md", "dangling.md"] {
        assert!(ws.rename_entry(Path::new("note.md"), target).is_err());
        assert_eq!(
            std::fs::read(dir.path().join("note.md")).unwrap(),
            b"source"
        );
    }
    assert_eq!(
        std::fs::read(dir.path().join("existing.md")).unwrap(),
        b"source"
    );
    assert_eq!(
        std::fs::read_link(dir.path().join("dangling.md")).unwrap(),
        Path::new("missing.md")
    );
}

#[test]
fn openknowledge_metadata_requires_the_exact_regular_config_file() {
    use crate::formats::markdown::MarkdownDialect;
    for case in [
        "absent",
        "empty",
        "yaml",
        "directory",
        "regular",
        "not-directory",
    ] {
        let dir = tempdir().unwrap();
        if case == "not-directory" {
            std::fs::write(dir.path().join(".ok"), "not a folder").unwrap();
        } else if case != "absent" {
            std::fs::create_dir(dir.path().join(".ok")).unwrap();
            match case {
                "yaml" => std::fs::write(dir.path().join(".ok/config.yaml"), "version: 1").unwrap(),
                "directory" => std::fs::create_dir(dir.path().join(".ok/config.yml")).unwrap(),
                "regular" => {
                    std::fs::write(dir.path().join(".ok/config.yml"), "version: 1").unwrap()
                }
                _ => {}
            }
        }
        let ws = Workspace::open(dir.path()).unwrap();
        let expected = (case == "regular").then_some(MarkdownDialect::OpenKnowledgeMdx);
        assert_eq!(ws.markdown_dialect(), expected, "{case}");
        assert!(!dir.path().join(".puppyone").exists());
        if case == "regular" {
            std::fs::remove_file(dir.path().join(".ok/config.yml")).unwrap();
            assert_eq!(
                ws.markdown_dialect(),
                expected,
                "foreground metadata must be the admitted snapshot"
            );
            assert_eq!(
                Workspace::open(dir.path()).unwrap().markdown_dialect(),
                None
            );
        }
        ws.revoke();
        assert_eq!(
            ws.markdown_dialect(),
            None,
            "retired workspace metadata is not reused"
        );
    }
}

#[cfg(unix)]
#[test]
fn openknowledge_metadata_never_follows_config_or_parent_links() {
    use std::os::unix::fs::symlink;
    let outside = tempdir().unwrap();
    std::fs::write(outside.path().join("config.yml"), "private metadata").unwrap();
    for parent in [false, true] {
        let dir = tempdir().unwrap();
        if parent {
            symlink(outside.path(), dir.path().join(".ok")).unwrap();
        } else {
            std::fs::create_dir(dir.path().join(".ok")).unwrap();
            symlink(
                outside.path().join("config.yml"),
                dir.path().join(".ok/config.yml"),
            )
            .unwrap();
        }
        let ws = Workspace::open(dir.path()).unwrap();
        assert_eq!(ws.markdown_dialect(), None);
        assert_eq!(
            std::fs::read_to_string(outside.path().join("config.yml")).unwrap(),
            "private metadata"
        );
    }
}

#[test]
fn whiteboard_text_admission_and_duplicate_names_keep_the_full_registered_suffix() {
    let dir = tempdir().unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let body = "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[],\"note\":\"中文\"}\n";
    for (name, copy) in [
        ("a.excalidraw", "a copy.excalidraw"),
        ("b.EXCALIDRAW.JSON", "b copy.EXCALIDRAW.JSON"),
    ] {
        std::fs::write(dir.path().join(name), body).unwrap();
        assert_eq!(crate::formats::of(name).semantic_kind(), "whiteboard");
        assert!(crate::formats::of(name).is_text_like());
        assert_eq!(ws.read(Path::new(name)).unwrap().text, body);
        assert_eq!(
            ws.copy_entry(Path::new(name), Path::new("")).unwrap(),
            Path::new(copy)
        );
        assert_eq!(ws.read(Path::new(copy)).unwrap().text, body);
        assert_eq!(
            ws.resource(Path::new(copy)).unwrap().bytes(4096).unwrap(),
            body.as_bytes()
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join(name)).unwrap(),
            body
        );
    }
}

#[test]
fn utf16_bom_encodings_and_mixed_line_endings_round_trip_cleanly() {
    let temp = tempdir().unwrap();

    // UTF-16LE with BOM (`FF FE`) + LF
    let mut utf16le = vec![0xff, 0xfe];
    for u in "你好 UTF-16LE\nline 2\n".encode_utf16() {
        utf16le.extend_from_slice(&u.to_le_bytes());
    }
    std::fs::write(temp.path().join("le.txt"), &utf16le).unwrap();

    // UTF-16BE with BOM (`FE FF`) + CRLF
    let mut utf16be = vec![0xfe, 0xff];
    for u in "你好 UTF-16BE\r\nline 2\r\n".encode_utf16() {
        utf16be.extend_from_slice(&u.to_be_bytes());
    }
    std::fs::write(temp.path().join("be.txt"), &utf16be).unwrap();

    // Mixed line endings (dominant CRLF) and lone CR
    std::fs::write(temp.path().join("mixed.txt"), b"a\r\nb\r\nc\n").unwrap();
    std::fs::write(temp.path().join("cr.txt"), b"first\rsecond\r").unwrap();

    let ws = Workspace::open(temp.path()).unwrap();

    let le_doc = ws.read(Path::new("le.txt")).unwrap();
    assert_eq!(le_doc.encoding, TextEncoding::Utf16Le);
    assert_eq!(le_doc.line_ending, LineEnding::Lf);
    assert_eq!(le_doc.text, "你好 UTF-16LE\nline 2\n");
    let le_saved = ws.save(&le_doc, "更新 LE 🚀\n").unwrap();
    assert_eq!(le_saved.document.encoding, TextEncoding::Utf16Le);
    let le_disk = std::fs::read(temp.path().join("le.txt")).unwrap();
    assert!(le_disk.starts_with(&[0xff, 0xfe]));
    assert_eq!(ws.read(Path::new("le.txt")).unwrap().text, "更新 LE 🚀\n");

    let be_doc = ws.read(Path::new("be.txt")).unwrap();
    assert_eq!(be_doc.encoding, TextEncoding::Utf16Be);
    assert_eq!(be_doc.line_ending, LineEnding::Crlf);
    assert_eq!(be_doc.text, "你好 UTF-16BE\nline 2\n");
    ws.save(&be_doc, "更新 BE\n第二行\n").unwrap();
    let be_disk = std::fs::read(temp.path().join("be.txt")).unwrap();
    assert!(be_disk.starts_with(&[0xfe, 0xff]));
    let be_reopened = ws.read(Path::new("be.txt")).unwrap();
    assert_eq!(be_reopened.text, "更新 BE\n第二行\n");
    assert_eq!(be_reopened.line_ending, LineEnding::Crlf);

    // DP-31: Mixed line endings open read-only until normalized explicitly.
    let mut mixed_doc = ws.read(Path::new("mixed.txt")).unwrap();
    assert_eq!(mixed_doc.text, "a\nb\nc\n");
    assert_eq!(
        mixed_doc.line_ending,
        LineEnding::Mixed {
            dominant_crlf: true
        }
    );
    assert!(mixed_doc.line_ending_anomaly());
    assert!(mixed_doc.readonly_reason().is_some());
    assert_eq!(
        ws.save(&mixed_doc, "a\nb\nc\nd\n").unwrap_err().kind,
        ErrorKind::LineEndingNormalizationRequired
    );
    assert_eq!(
        std::fs::read(temp.path().join("mixed.txt")).unwrap(),
        b"a\r\nb\r\nc\n",
        "un-normalized save must never touch disk"
    );

    mixed_doc.normalize_line_endings();
    assert_eq!(mixed_doc.line_ending, LineEnding::Crlf);
    assert!(!mixed_doc.line_ending_anomaly());
    ws.save(&mixed_doc, "a\nb\nc\nd\n").unwrap();
    assert_eq!(
        std::fs::read(temp.path().join("mixed.txt")).unwrap(),
        b"a\r\nb\r\nc\r\nd\r\n"
    );

    // Lone CR normalizes to LF on explicit confirmation.
    let mut cr_doc = ws.read(Path::new("cr.txt")).unwrap();
    assert_eq!(cr_doc.text, "first\nsecond\n");
    assert_eq!(cr_doc.line_ending, LineEnding::Cr);
    assert_eq!(
        ws.save(&cr_doc, "first\nsecond\n").unwrap_err().kind,
        ErrorKind::LineEndingNormalizationRequired
    );
    cr_doc.normalize_line_endings();
    assert_eq!(cr_doc.line_ending, LineEnding::Lf);
    ws.save(&cr_doc, "first\nsecond\n").unwrap();
    assert_eq!(
        std::fs::read(temp.path().join("cr.txt")).unwrap(),
        b"first\nsecond\n"
    );
}

#[test]
fn gb18030_round_trip_fidelity_guard_and_local_version_helpers() {
    let temp = tempdir().unwrap();
    let gb_initial = encoding_rs::GB18030.encode("测试往返\n").0.into_owned();
    std::fs::write(temp.path().join("gb.txt"), &gb_initial).unwrap();
    std::fs::write(temp.path().join("cr_only.txt"), b"a\rb\r").unwrap();

    let local_ws = local::Workspace::open_with(temp.path(), false).unwrap();
    let local_cr = local_ws.read(Path::new("cr_only.txt")).unwrap();
    assert!(local_cr.version.requires_line_ending_normalization());
    assert_eq!(local_cr.encoding, TextEncoding::Utf8);
    assert_eq!(local_cr.line_ending, LineEnding::Cr);

    // U+E5E5 is unmappable in WHATWG's gb18030 encoder (`&#58853;` fallback):
    // DP-32's round-trip fidelity guard must reject the write with
    // `ErrorKind::EncodingRoundTrip` without modifying disk bytes.
    let ws = Workspace::open(temp.path()).unwrap();
    let doc = ws.read(Path::new("gb.txt")).unwrap();
    let (_, _, unmappable) = encoding_rs::GB18030.encode("\u{e5e5}");
    if unmappable {
        let err = ws.save(&doc, "测试\u{e5e5}\n").unwrap_err();
        assert_eq!(err.kind, ErrorKind::EncodingRoundTrip);
        assert_eq!(
            std::fs::read(temp.path().join("gb.txt")).unwrap(),
            gb_initial,
            "failed round-trip guard must never touch disk"
        );
    }
}

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

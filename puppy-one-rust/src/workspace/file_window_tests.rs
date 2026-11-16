use super::*;
use crate::workspace::{ErrorKind, TextEncoding, Workspace, testing::Memory};
use std::sync::atomic::Ordering;

#[test]
fn project_grants_keep_directory_and_neighbour_access() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("other.md"), "other").unwrap();
    let project = Workspace::open(temp.path()).unwrap();
    assert_eq!(project.list(Path::new("")).unwrap().len(), 1);
    let doc = project.read(Path::new("other.md")).unwrap();
    assert!(!project.save(&doc, "edited").unwrap().updated);
    project
        .create_entry(Path::new(""), "new.md", false, "new")
        .unwrap();
}

#[test]
fn bound_provider_checks_the_path_before_every_read_write_preview_and_watch() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("note.md"), "bound").unwrap();
    std::fs::write(temp.path().join("other.md"), "neighbour").unwrap();
    let provider = open(&temp.path().join("note.md")).unwrap();
    let other = RelativePath::new(Path::new("other.md")).unwrap();
    assert!(provider.read(&other).is_err());
    assert!(
        provider
            .write(&other, &Revision("forged".into()), "overwrite")
            .is_err()
    );
    assert!(provider.preview(&other).is_err());
    assert!(provider.preview_bytes(&other, 100).is_err());
    assert!(provider.preview_reader(&other).is_err());
    assert!(provider.preview_session_reader(&other).is_err());
    assert!(provider.platform_path(&other).is_err());
    assert!(
        provider
            .watch(&other, &Revision("forged".into()), Arc::new(|| {}))
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(temp.path().join("other.md")).unwrap(),
        "neighbour"
    );
}

#[test]
fn physical_file_limit_survives_growth_and_bom_or_crlf_expansion_on_save() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("note.md");
    let max = 1024 * 1024;
    std::fs::write(&path, vec![b'a'; max]).unwrap();
    let ws = Workspace::open_file(&path).unwrap();
    let doc = ws.read(Path::new("note.md")).unwrap();
    assert_eq!(doc.text.len(), max);
    assert!(ws.save(&doc, &"a".repeat(max + 1)).is_err());
    assert_eq!(std::fs::metadata(&path).unwrap().len(), max as u64);
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(max as u64 + 1)
        .unwrap();
    assert!(ws.observe(&doc).is_err());
    for (bytes, next) in [
        (b"\xef\xbb\xbfnote".as_slice(), "a".repeat(max - 2)),
        (b"note\r\n".as_slice(), "\n".repeat(max / 2 + 1)),
    ] {
        std::fs::write(&path, bytes).unwrap();
        let doc = ws.read(Path::new("note.md")).unwrap();
        assert!(ws.save(&doc, &next).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
}

#[test]
fn legacy_decoding_can_expand_within_the_physical_file_limit_and_remains_read_only() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("note.md");
    for (bytes, encoding) in [
        ([0xc4, 0xe3].repeat(400_000), TextEncoding::Gb18030),
        ([0xff].repeat(400_000), TextEncoding::Unknown),
    ] {
        assert!(bytes.len() < 1024 * 1024);
        std::fs::write(&path, &bytes).unwrap();
        let ws = Workspace::open_file(&path).unwrap();
        let doc = ws.read(Path::new("note.md")).unwrap();
        assert_eq!(doc.encoding, encoding);
        assert!(doc.text.len() > 1024 * 1024);
        assert_eq!(
            ws.save(&doc, "no").unwrap_err().kind,
            ErrorKind::PermissionDenied
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}

#[cfg(unix)]
#[test]
fn scoped_media_keeps_its_admitted_directory_and_refuses_retargeted_symlinks() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("original");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("note.md"), "bound").unwrap();
    std::fs::write(root.join("image.png"), "admitted").unwrap();
    let ws = Workspace::open_file(&root.join("note.md")).unwrap();
    let retained = temp.path().join("retained");
    std::fs::rename(&root, &retained).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("image.png"), "outside grant").unwrap();
    assert_eq!(
        ws.markdown_asset_bytes(Path::new("image.png"), 100)
            .unwrap(),
        b"admitted"
    );
    std::fs::remove_file(retained.join("image.png")).unwrap();
    std::os::unix::fs::symlink(root.join("image.png"), retained.join("image.png")).unwrap();
    assert!(
        ws.markdown_asset_bytes(Path::new("image.png"), 100)
            .is_err()
    );
}

#[test]
fn media_port_enforces_its_byte_budget_and_fences_revocation_before_and_after_dispatch() {
    let provider = Arc::new(Memory::new("memory://file-window-media/project/"));
    let ws = Workspace::from_provider(provider.clone()).unwrap();
    assert!(ws.markdown_asset_bytes(Path::new("image.png"), 2).is_err());
    assert_eq!(
        ws.markdown_asset_bytes(Path::new("image.png"), 3).unwrap(),
        [1, 2, 3]
    );
    let revoke = Arc::downgrade(&ws);
    *provider.hook.lock().unwrap() = Some(Box::new(move || revoke.upgrade().unwrap().revoke()));
    assert_eq!(
        ws.markdown_asset_bytes(Path::new("image.png"), 3)
            .unwrap_err()
            .kind,
        ErrorKind::StaleLease
    );
    let calls = provider.calls.load(Ordering::SeqCst);
    assert_eq!(
        ws.markdown_asset_bytes(Path::new("image.png"), 3)
            .unwrap_err()
            .kind,
        ErrorKind::StaleLease
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), calls);
}

use super::*;
use super::{contracts::StorageId, testing::Memory};
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

#[test]
fn identity_is_stable_but_open_grants_are_not_interchangeable() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("note.md"), "hi").unwrap();
    let a = Workspace::open(dir.path()).unwrap();
    let b = Workspace::open(dir.path()).unwrap();
    let doc = a.read(Path::new("note.md")).unwrap();
    assert_eq!(doc.identity, b.resource_id(Path::new("note.md")).unwrap());
    assert_eq!(
        b.save(&doc, "wrong lease").unwrap_err().kind,
        ErrorKind::ForeignResource
    );
    let memory =
        Workspace::from_provider(Arc::new(Memory::new("memory://account/project/"))).unwrap();
    assert_ne!(
        doc.identity,
        memory.resource_id(Path::new("note.md")).unwrap()
    );
    assert_eq!(
        memory.read_resource(&doc.identity).unwrap_err().kind,
        ErrorKind::ForeignResource
    );
}
#[test]
fn local_provider_roundtrip_preserves_encoding_conflicts_and_operations() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("note.md"), b"\xef\xbb\xbfhi\r\n").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let root = Path::new("");
    let doc = ws.read(Path::new("note.md")).unwrap();
    let saved = ws.save(&doc, "changed\n").unwrap();
    assert!(!saved.updated);
    assert_eq!(
        std::fs::read(dir.path().join("note.md")).unwrap(),
        b"\xef\xbb\xbfchanged\r\n"
    );
    std::fs::write(dir.path().join("note.md"), "external").unwrap();
    assert!(ws.save(&saved.document, "stale").unwrap().updated);
    ws.create_entry(root, "folder", true, "").unwrap();
    ws.create_entry(root, "new.md", false, "body").unwrap();
    assert_eq!(
        ws.create_entry(root, "new.md", false, "overwrite")
            .unwrap_err()
            .kind,
        ErrorKind::AlreadyExists
    );
    let renamed = ws.rename_entry(Path::new("new.md"), "renamed.md").unwrap();
    let copied = ws.copy_entry(&renamed, Path::new("folder")).unwrap();
    ws.remove_entry(&copied).unwrap();
    let moved = ws.move_entry(&renamed, Path::new("folder")).unwrap();
    assert_eq!(ws.read(&moved).unwrap().text, "body");
    assert_eq!(ws.list(root).unwrap()[0].name, "folder");
    assert!(ws.resource(&moved).unwrap().data().is_ok());
    assert_eq!(
        ws.read(Path::new("absent")).unwrap_err().kind,
        ErrorKind::NotFound
    );
}
#[test]
fn revocation_fences_reads_writes_and_existing_preview_leases() {
    let memory = Arc::new(Memory::new("memory://account/project/"));
    let ws = Workspace::from_provider(memory.clone()).unwrap();
    assert!(ws.local_root().is_none());
    let doc = ws.read(Path::new("note.md")).unwrap();
    let preview = ws.resource(Path::new("image.png")).unwrap();
    assert!(matches!(preview.data(), Ok(PreviewData::Bytes { .. })));
    ws.revoke();
    let calls = memory.calls.load(Ordering::SeqCst);
    assert_eq!(ws.save(&doc, "no").unwrap_err().kind, ErrorKind::StaleLease);
    assert_eq!(
        ws.list(Path::new("")).unwrap_err().kind,
        ErrorKind::StaleLease
    );
    assert_eq!(preview.data().unwrap_err().kind, ErrorKind::StaleLease);
    assert_eq!(calls, memory.calls.load(Ordering::SeqCst));
}
#[test]
fn readonly_capabilities_are_enforced_before_dispatch() {
    let mut memory = Memory::new("memory://account/project/");
    memory.descriptor.capabilities.write = false;
    let memory = Arc::new(memory);
    let ws = Workspace::from_provider(memory.clone()).unwrap();
    let doc = ws.read(Path::new("note.md")).unwrap();
    let calls = memory.calls.load(Ordering::SeqCst);
    assert_eq!(
        ws.save(&doc, "no").unwrap_err().kind,
        ErrorKind::Unsupported
    );
    assert_eq!(
        ws.absolute(Path::new("note.md")).unwrap_err().kind,
        ErrorKind::Unsupported
    );
    assert_eq!(
        ws.create_entry(Path::new(""), "new.md", false, "")
            .unwrap_err()
            .kind,
        ErrorKind::Unsupported
    );
    assert_eq!(calls, memory.calls.load(Ordering::SeqCst));
}
#[test]
fn late_read_is_discarded_and_late_write_is_not_reported_as_safe_to_retry() {
    for writing in [false, true] {
        let memory = Arc::new(Memory::new("memory://account/project/"));
        let ws = Workspace::from_provider(memory.clone()).unwrap();
        let doc = ws.read(Path::new("note.md")).unwrap();
        let weak = Arc::downgrade(&ws);
        *memory.hook.lock().unwrap() = Some(Box::new(move || weak.upgrade().unwrap().revoke()));
        let error = if writing {
            ws.save(&doc, "sent").unwrap_err()
        } else {
            ws.read(Path::new("note.md")).unwrap_err()
        };
        assert_eq!(
            error.kind,
            if writing {
                ErrorKind::OutcomeUnknown
            } else {
                ErrorKind::StaleLease
            }
        );
    }
}
#[test]
fn provider_revision_and_resource_binding_cannot_be_retargeted() {
    let ws = Workspace::from_provider(Arc::new(Memory::new("memory://account/project/"))).unwrap();
    let mut doc = ws.read(Path::new("note.md")).unwrap();
    doc.relative = "other.md".into();
    assert_eq!(
        ws.save(&doc, "no").unwrap_err().kind,
        ErrorKind::ForeignResource
    );
    for path in ["../secret", "/absolute", ".", "a/../../x", "a\0b"] {
        assert!(ws.read(Path::new(path)).is_err(), "{path}");
    }
    for uri in [
        "https://user:secret@host/root/",
        "https://host/root/?key=secret",
        "https://host/root/#fragment",
        "data:x",
    ] {
        assert!(StorageId::new(uri).is_err());
    }
}
#[test]
fn local_watch_coalesces_changes_and_drop_releases_its_worker() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("note.md"), "before").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let doc = ws.read(Path::new("note.md")).unwrap();
    let wake = Arc::new(AtomicBool::new(false));
    let flag = wake.clone();
    let watch = ws
        .watch(
            &doc,
            Arc::new(move || {
                flag.store(true, Ordering::SeqCst);
            }),
        )
        .unwrap();
    std::fs::write(dir.path().join("note.md"), "after").unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while !wake.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(matches!(watch.next(), Some(WatchEvent::Invalidated)));
    assert!(watch.next().is_none());
    drop(watch);
    // The notify closure is held only while the watch worker lives.
    while Arc::strong_count(&wake) > 1 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let flag = wake.clone();
    let watch = ws
        .watch(
            &doc,
            Arc::new(move || {
                flag.store(true, Ordering::SeqCst);
            }),
        )
        .unwrap();
    assert_eq!(
        ws.lease.watches.lock().unwrap().len(),
        1,
        "No historical subscriptions retained"
    );
    ws.revoke();
    while Arc::strong_count(&wake) > 1 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(matches!(
        watch.next(),
        Some(WatchEvent::Failed(Error {
            kind: ErrorKind::StaleLease,
            ..
        }))
    ));
}

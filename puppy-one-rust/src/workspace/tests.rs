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
fn deferred_preview_reads_use_the_provider_and_discard_bytes_after_revocation() {
    use super::ports::{DataPort, DocumentStoragePort, ResourcePort, ResourceWatchPort};
    struct Deferred(Memory);
    impl DataPort for Deferred {
        fn descriptor(&self) -> Descriptor {
            self.0.descriptor()
        }
        fn list(&self, path: &RelativePath) -> Result<Vec<contracts::Entry>> {
            self.0.list(path)
        }
    }
    impl DocumentStoragePort for Deferred {
        fn read(&self, path: &RelativePath) -> Result<TextSnapshot> {
            self.0.read(path)
        }
        fn write(&self, path: &RelativePath, base: &Revision, text: &str) -> Result<WriteResult> {
            self.0.write(path, base, text)
        }
    }
    impl ResourcePort for Deferred {
        fn preview(&self, _: &RelativePath) -> Result<PreviewData> {
            // This is deliberately not an accessible ambient filename.
            Ok(PreviewData::LocalFile("provider-owned-resource".into()))
        }
        fn preview_bytes(&self, path: &RelativePath, _: u64) -> Result<Vec<u8>> {
            // Deliberately ignore the budget: the public facade must also
            // enforce its output limit when a provider violates its contract.
            Ok(self.0.read(path)?.text.into_bytes())
        }
    }
    impl ResourceWatchPort for Deferred {
        fn watch(&self, _: &RelativePath, _: &Revision, _: Notify) -> Result<WatchSubscription> {
            Err(Error::unsupported())
        }
    }
    let provider = Arc::new(Deferred(Memory::new("memory://deferred/project/")));
    let ws = Workspace::from_provider(provider.clone()).unwrap();
    let preview = ws.resource(Path::new("note.md")).unwrap();
    assert_eq!(preview.bytes(64).unwrap(), b"original");
    assert_eq!(provider.0.calls.load(Ordering::SeqCst), 1);
    assert!(preview.bytes(2).is_none());
    let weak = Arc::downgrade(&ws);
    *provider.0.hook.lock().unwrap() = Some(Box::new(move || weak.upgrade().unwrap().revoke()));
    assert!(preview.bytes(64).is_none());
    let calls = provider.0.calls.load(Ordering::SeqCst);
    assert_eq!(calls, 3);
    assert!(preview.bytes(u64::MAX).is_none());
    assert_eq!(provider.0.calls.load(Ordering::SeqCst), calls);
}

#[test]
fn cached_preview_snapshots_obey_budgets_without_fetching_the_provider_again() {
    let memory = Arc::new(Memory::new("memory://snapshots/project/"));
    let ws = Workspace::from_provider(memory.clone()).unwrap();
    let preview = ws.resource(Path::new("image.png")).unwrap();
    let calls = memory.calls.load(Ordering::SeqCst);
    assert_eq!(preview.bytes(3), Some(vec![1, 2, 3]));
    assert_eq!(preview.bytes(u64::MAX), Some(vec![1, 2, 3]));
    assert!(preview.bytes(2).is_none());
    assert_eq!(memory.calls.load(Ordering::SeqCst), calls);
    ws.revoke();
    assert!(preview.bytes(3).is_none());
    assert_eq!(memory.calls.load(Ordering::SeqCst), calls);
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
/// A stream of changes that never quiets (a build, an install) still
/// rereads the tree while it runs, not only once it stops.
#[test]
fn local_root_watch_publishes_during_a_continuous_stream() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = count.clone();
    let _watch = ws
        .watch_root(Arc::new(move || {
            seen.fetch_add(1, Ordering::SeqCst);
        }))
        .unwrap();
    let started = Instant::now();
    let mut n = 0;
    while started.elapsed() < Duration::from_millis(3000) {
        n += 1;
        std::fs::write(dir.path().join("out.js"), n.to_string()).unwrap();
        std::thread::sleep(Duration::from_millis(40));
    }
    assert!(
        count.load(Ordering::SeqCst) >= 1,
        "no reread while changes kept arriving"
    );
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
    // Subscribe performs an immediate baseline check. Publish a completed
    // replacement so this coalescing/lifetime test never races a truncated file.
    // In-place writes and failure recovery have their own real-watch acceptance.
    let replacement = dir.path().join("note.tmp");
    std::fs::write(&replacement, "after").unwrap();
    std::fs::rename(&replacement, dir.path().join("note.md")).unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while !wake.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let event = watch.next();
    assert!(matches!(event, Some(WatchEvent::Invalidated)), "{event:?}");
    assert_eq!(ws.read(Path::new("note.md")).unwrap().text, "after");
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

#[test]
fn moving_an_expanded_subtree_carries_state_into_the_destination_listing() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("from/nested")).unwrap();
    std::fs::create_dir(root.path().join("to")).unwrap();
    std::fs::write(root.path().join("from/nested/a.md"), "a").unwrap();
    let ws = Workspace::open(root.path()).unwrap();
    let mut tree = crate::model::Tree {
        roots: ws.list(Path::new("")).unwrap(),
        ..crate::model::Tree::new()
    };
    for path in ["from", "from/nested", "to"] {
        tree.attach_children(Path::new(path), ws.list(Path::new(path)).unwrap());
    }
    tree.select(Path::new("from/nested/a.md"), false, false);
    ws.move_entry(Path::new("from"), Path::new("to")).unwrap();
    tree.rebind(Path::new("from"), Path::new("to/from"));
    for path in ["", "to"] {
        tree.refresh_children(Path::new(path), ws.list(Path::new(path)).unwrap());
    }
    for path in ["to/from", "to/from/nested"] {
        let node = tree.find_mut(Path::new(path)).unwrap();
        assert!(node.expanded && node.loaded);
    }
    assert!(tree.selection.contains(Path::new("to/from/nested/a.md")));
    assert_eq!(
        tree.anchor.as_deref(),
        Some(Path::new("to/from/nested/a.md"))
    );
    assert!(tree.index_of(Path::new("to/from/nested/a.md")).is_some());
    assert!(tree.find_mut(Path::new("from")).is_none());
}

/// DP-51 regression gate: multiple open watched local documents sitting idle
/// perform exact `0` full-file observation reads, and editing one file reads
/// only that changed file via the shared root watcher.
#[test]
fn idle_open_documents_perform_zero_full_file_observation_reads() {
    let dir = tempfile::tempdir().unwrap();
    let names = ["one.md", "two.md", "three.md", "four.md"];
    for name in names {
        std::fs::write(dir.path().join(name), format!("initial {name}\n")).unwrap();
    }
    let ws = Workspace::open(dir.path()).unwrap();
    let root_wakes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let root_seen = root_wakes.clone();
    let _root_sub = ws
        .watch_root(Arc::new(move || {
            root_seen.fetch_add(1, Ordering::SeqCst);
        }))
        .unwrap();

    let mut subs = Vec::new();
    let mut flags = Vec::new();
    for name in names {
        let doc = ws.read(Path::new(name)).unwrap();
        let woke = Arc::new(AtomicBool::new(false));
        let flag = woke.clone();
        let sub = ws
            .watch(
                &doc,
                Arc::new(move || {
                    flag.store(true, Ordering::SeqCst);
                }),
            )
            .unwrap();
        subs.push(sub);
        flags.push(woke);
    }

    // Sit idle across >2x the retired 500ms polling interval.
    std::thread::sleep(Duration::from_millis(1200));
    assert_eq!(
        ws.observation_full_reads(),
        0,
        "DP-51: idle open documents must perform 0 full-file observation reads"
    );
    assert!(flags.iter().all(|f| !f.load(Ordering::SeqCst)));

    // Modify only `two.md`; only its subscription wakes.
    std::fs::write(dir.path().join("two.md"), "updated two\n").unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while !flags[1].load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "two.md watch did not wake");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(matches!(subs[1].next(), Some(WatchEvent::Invalidated)));
    assert!(!flags[0].load(Ordering::SeqCst));
    assert!(!flags[2].load(Ordering::SeqCst));
    assert!(!flags[3].load(Ordering::SeqCst));
    assert_eq!(ws.observation_full_reads(), 1);
}

/// RG-01 / RG-02 support: `stat_entry` and `read_head` inspect oversized
/// binary files without reading the entire payload into memory.
#[test]
fn stat_entry_and_read_head_work_on_files_exceeding_text_limit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("oversized_blob");
    let mut payload = b"%PDF-1.7\nheader-bytes\n".to_vec();
    payload.resize(MAX_TEXT_BYTES + 4096, b'x');
    std::fs::write(&path, &payload).unwrap();

    let ws = Workspace::open(dir.path()).unwrap();
    let stat = ws.stat_entry(Path::new("oversized_blob")).unwrap();
    assert_eq!(stat.size, (MAX_TEXT_BYTES + 4096) as u64);
    assert!(stat.is_file);
    assert!(!stat.readonly);

    let head = ws.read_head(Path::new("oversized_blob"), 64).unwrap();
    assert_eq!(head.len(), 64);
    assert!(head.starts_with(b"%PDF-1.7\nheader-bytes\n"));
}

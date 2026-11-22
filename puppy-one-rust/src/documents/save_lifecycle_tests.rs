//! Storage and close-lifetime acceptance through the real document coordinator.
use super::*;
use crate::workspace::{contracts::*, ports::*, testing::Memory};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

fn memory_document() -> (Arc<Memory>, Documents, Wake) {
    let provider = Arc::new(Memory::new("memory://late-save/project/"));
    let workspace = Workspace::from_provider(provider.clone()).unwrap();
    let document = workspace.read(Path::new("note.md")).unwrap();
    let mut d = Documents::in_workspace(workspace);
    d.document = Some(document);
    let wake = Wake::default();
    d.ensure_session(&wake);
    (provider, d, wake)
}

fn edit(d: &mut Documents, wake: &Wake, revision: u64, text: &str, dirty: bool) {
    let id = d.document.as_ref().unwrap().id.clone();
    d.client(
        ClientMessage::LiveBuffer {
            id: id.clone(),
            revision,
            text: Buffer::new(text),
        },
        wake,
    );
    d.client(
        ClientMessage::Dirty {
            id,
            revision,
            dirty,
        },
        wake,
    );
}

fn late_revision_during_drain(intent: Intent, latest: &str, dirty: bool) {
    let (provider, mut d, wake) = memory_document();
    let calls_before = provider.calls.load(Ordering::SeqCst);
    let (started, entered) = mpsc::channel();
    let (release, finish) = mpsc::channel();
    *provider.hook.lock().unwrap() = Some(Box::new(move || {
        let _ = started.send(());
        let _ = finish.recv_timeout(Duration::from_secs(10));
    }));
    edit(&mut d, &wake, 1, "first", true);
    d.begin(intent.clone(), &wake);
    let first_request = match d.phase {
        Phase::Snapshot { request, .. } => request,
        _ => panic!("initial barrier did not request a snapshot"),
    };
    reply(&mut d, &wake, first_request, 1, "first");
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    d.outgoing.clear();
    edit(&mut d, &wake, 2, latest, dirty);
    release.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while d.session.as_ref().unwrap().has_active_write() {
        d.poll(&wake);
        assert!(
            Instant::now() < deadline,
            "first storage write did not finish"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(!d.allow_quit && d.document.is_some());
    let request = match &d.phase {
        Phase::Snapshot {
            request,
            intent: next,
            ..
        } => {
            assert_eq!(
                std::mem::discriminant(next),
                std::mem::discriminant(&intent)
            );
            *request
        }
        _ => panic!(
            "newer input must be captured before the drain can finish: {}",
            d.status
        ),
    };
    assert!(request > first_request);
    assert!(d.outgoing.contains(&HostMessage::Snapshot {
        request,
        freeze: true
    }));
    assert!(!d.outgoing.contains(&HostMessage::Thaw));
    reply(&mut d, &wake, request, 2, latest);
    wait(&mut d, &wake);
    assert!(d.error.is_none() && !d.dirty && !d.saving());
    assert_eq!(*provider.text.lock().unwrap(), latest);
    assert_eq!(
        provider.calls.load(Ordering::SeqCst) - calls_before,
        if latest == "first" { 1 } else { 2 }
    );
    match intent {
        Intent::CloseFile => {
            assert!(d.document.is_none());
            // Reopening reads the drained revision.
            d.begin(Intent::OpenFile("note.md".into()), &wake);
            wait(&mut d, &wake);
            assert_eq!(d.document.as_ref().unwrap().text, latest);
        }
        Intent::Quit => assert!(d.allow_quit),
        Intent::Save => {
            assert!(d.outgoing.contains(&HostMessage::Thaw));
            *provider.text.lock().unwrap() = "later disk change".into();
            d.revalidate();
            wait_for_adoption(&mut d, &wake, "later disk change");
            assert!(!d.dirty && !d.cloud_conflict() && d.error.is_none());
            assert_eq!(
                provider.calls.load(Ordering::SeqCst) - calls_before,
                if latest == "first" { 2 } else { 3 }
            );
        }
        _ => unreachable!(),
    }
}

fn wait_for_adoption(d: &mut Documents, wake: &Wake, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        d.poll(wake);
        if d.document.as_ref().unwrap().text == expected && !d.saving() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "external reconciliation did not settle"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn drains_the_latest_revision_arriving_during_save_close_or_quit() {
    for intent in [Intent::Save, Intent::CloseFile, Intent::Quit] {
        late_revision_during_drain(intent, "latest closing draft", true);
    }
}

#[test]
fn projection_revisions_during_save_do_not_leave_dirty_state_or_a_duplicate_write() {
    late_revision_during_drain(Intent::Save, "first", false);
}

#[test]
fn clean_initialization_and_projection_changes_never_schedule_persistence() {
    let (provider, mut d, wake) = memory_document();
    let calls_before = provider.calls.load(Ordering::SeqCst);
    edit(&mut d, &wake, 1, "original", false);
    edit(&mut d, &wake, 2, "projection-only replacement", false);
    d.poll_at(&wake, Instant::now() + Duration::from_secs(3));
    assert!(!d.dirty && !d.saving() && d.error.is_none());
    assert!(d.autosave_request.is_none());
    assert!(
        !d.outgoing
            .iter()
            .any(|m| matches!(m, HostMessage::Snapshot { .. }))
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), calls_before);
    assert_eq!(*provider.text.lock().unwrap(), "original");
}

#[test]
fn matching_external_text_and_edits_undone_before_autosave_adopt_without_writing() {
    for undone in [false, true] {
        let (provider, mut d, wake) = memory_document();
        edit(&mut d, &wake, 1, "agent content", true);
        if undone {
            edit(&mut d, &wake, 2, "original", false);
        }
        *provider.text.lock().unwrap() = "agent content".into();
        let before_read = provider.calls.load(Ordering::SeqCst);
        d.revalidate();
        wait_for_adoption(&mut d, &wake, "agent content");
        assert!(!d.dirty && !d.cloud_conflict() && d.error.is_none());
        assert_eq!(
            provider.calls.load(Ordering::SeqCst),
            before_read + 1,
            "only the observation reads storage"
        );
        d.poll_at(&wake, Instant::now() + Duration::from_secs(3));
        assert_eq!(provider.calls.load(Ordering::SeqCst), before_read + 1);
        assert!(d.autosave_request.is_none());
        assert_eq!(*provider.text.lock().unwrap(), "agent content");
        // The next conditional write must use the newly adopted storage
        // revision, otherwise Memory rejects it and this draft cannot persist.
        let revision = d.revision + 1;
        edit(&mut d, &wake, revision, "input after adoption", true);
        d.begin(Intent::Save, &wake);
        let request = match d.phase {
            Phase::Snapshot { request, .. } => request,
            _ => panic!("save did not request the adopted draft"),
        };
        reply(&mut d, &wake, request, revision, "input after adoption");
        wait(&mut d, &wake);
        assert_eq!(*provider.text.lock().unwrap(), "input after adoption");
        assert!(!d.dirty && d.error.is_none());
    }
}

#[test]
fn a_conditional_save_converges_without_replacing_the_matching_file_on_disk() {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    let (temp, mut d, wake) = setup();
    edit(&mut d, &wake, 1, "candidate", true);
    d.begin(Intent::Save, &wake);
    let path = temp.path().join("a.md");
    std::fs::write(&path, "candidate").unwrap();
    let before = std::fs::metadata(&path).unwrap();
    snapshot(&mut d, &wake, "candidate");
    wait(&mut d, &wake);
    assert!(!d.dirty && !d.saving() && d.error.is_none());
    assert_eq!(d.document.as_ref().unwrap().text, "candidate");
    let after = std::fs::metadata(&path).unwrap();
    #[cfg(unix)]
    assert_eq!(before.ino(), after.ino());
    assert_eq!(before.modified().unwrap(), after.modified().unwrap());
    assert_eq!(std::fs::read_to_string(path).unwrap(), "candidate");
}

#[test]
fn typing_after_a_rejected_save_uses_the_adopted_disk_version_without_old_input() {
    let (temp, mut d, wake) = setup();
    edit(&mut d, &wake, 1, "discarded human text", true);
    d.begin(Intent::Save, &wake);
    let path = temp.path().join("a.md");
    std::fs::write(&path, "agent text").unwrap();
    snapshot(&mut d, &wake, "discarded human text");
    wait(&mut d, &wake);
    assert_eq!(d.document.as_ref().unwrap().text, "agent text");
    assert!(!d.dirty && d.error.is_none());
    let revision = d.revision + 1;
    edit(&mut d, &wake, revision, "agent text plus new input", true);
    d.begin(Intent::Save, &wake);
    let request = match d.phase {
        Phase::Snapshot { request, .. } => request,
        _ => panic!("explicit save did not request the new draft"),
    };
    reply(
        &mut d,
        &wake,
        request,
        revision,
        "agent text plus new input",
    );
    wait(&mut d, &wake);
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "agent text plus new input"
    );
    assert_eq!(
        d.document.as_ref().unwrap().text,
        "agent text plus new input"
    );
    assert!(!d.dirty && d.error.is_none() && !d.saving());
}

struct PanickingWrite {
    inner: Memory,
    after_commit: bool,
    panic_once: AtomicBool,
    writes: AtomicUsize,
}

impl DataPort for PanickingWrite {
    fn descriptor(&self) -> Descriptor {
        self.inner.descriptor()
    }
    fn list(&self, path: &RelativePath) -> workspace::Result<Vec<Entry>> {
        self.inner.list(path)
    }
}
impl DocumentStoragePort for PanickingWrite {
    fn read(&self, path: &RelativePath) -> workspace::Result<TextSnapshot> {
        self.inner.read(path)
    }
    fn write(
        &self,
        path: &RelativePath,
        base: &Revision,
        text: &str,
    ) -> workspace::Result<WriteResult> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        if self.panic_once.swap(false, Ordering::SeqCst) {
            if self.after_commit {
                self.inner.write(path, base, text)?;
            }
            panic!("Desktop bridge unavailable");
        }
        self.inner.write(path, base, text)
    }
}
impl ResourcePort for PanickingWrite {
    fn preview(&self, path: &RelativePath) -> workspace::Result<PreviewData> {
        self.inner.preview(path)
    }
    fn stat_entry(&self, path: &RelativePath) -> workspace::Result<EntryStat> {
        self.inner.stat_entry(path)
    }
    fn read_head(&self, path: &RelativePath, max: usize) -> workspace::Result<Vec<u8>> {
        self.inner.read_head(path, max)
    }
}
impl ResourceWatchPort for PanickingWrite {
    fn watch(
        &self,
        path: &RelativePath,
        revision: &Revision,
        notify: Notify,
    ) -> workspace::Result<WatchSubscription> {
        self.inner.watch(path, revision, notify)
    }
}

#[test]
fn panicking_storage_settles_close_retains_the_draft_and_retries_unknown_outcomes() {
    for after_commit in [false, true] {
        let provider = Arc::new(PanickingWrite {
            inner: Memory::new("memory://panic-write/project/"),
            after_commit,
            panic_once: AtomicBool::new(true),
            writes: AtomicUsize::new(0),
        });
        let workspace = Workspace::from_provider(provider.clone()).unwrap();
        let document = workspace.read(Path::new("note.md")).unwrap();
        let id = document.id.clone();
        let mut d = Documents::in_workspace(workspace);
        d.document = Some(document);
        let wake = Wake::default();
        d.ensure_session(&wake);
        d.client(
            ClientMessage::LiveBuffer {
                id: id.clone(),
                revision: 1,
                text: Buffer::new("closing draft"),
            },
            &wake,
        );
        d.client(
            ClientMessage::Dirty {
                id: id.clone(),
                revision: 1,
                dirty: true,
            },
            &wake,
        );
        d.begin(Intent::CloseFile, &wake);
        snapshot(&mut d, &wake, "closing draft");
        wait(&mut d, &wake);
        assert_eq!(d.document.as_ref().unwrap().id, id);
        assert!(d.dirty && !d.busy());
        assert_eq!(d.save_status(), SaveStatus::Failed);
        assert_eq!(
            d.save_error_kind,
            Some(workspace::ErrorKind::OutcomeUnknown)
        );
        assert!(
            d.error
                .as_ref()
                .unwrap()
                .contains("Desktop bridge unavailable")
        );
        assert_eq!(
            d.session.as_ref().unwrap().latest_draft_buffer(),
            Buffer::new("closing draft")
        );
        assert!(d.outgoing.contains(&HostMessage::Thaw));
        assert!(!d.outgoing.contains(&HostMessage::Clear));
        assert_eq!(
            *provider.inner.text.lock().unwrap(),
            if after_commit {
                "closing draft"
            } else {
                "original"
            }
        );
        // A panic is not permission to claim success or spin on writes.
        d.poll_at(&wake, Instant::now() + Duration::from_secs(10));
        assert_eq!(provider.writes.load(Ordering::SeqCst), 1);
        d.error = None;
        d.begin(Intent::Save, &wake);
        snapshot(&mut d, &wake, "closing draft");
        wait(&mut d, &wake);
        assert!(d.error.is_none() && !d.dirty && !d.saving());
        assert_eq!(*provider.inner.text.lock().unwrap(), "closing draft");
        assert_eq!(provider.writes.load(Ordering::SeqCst), 2);
        d.begin(Intent::CloseFile, &wake);
        snapshot(&mut d, &wake, "closing draft");
        wait(&mut d, &wake);
        assert!(d.document.is_none());
        assert_eq!(provider.writes.load(Ordering::SeqCst), 2);
    }
}

#[test]
fn abandonment_cancels_a_queued_write_before_the_provider_is_entered() {
    let (provider, mut d, wake) = memory_document();
    let calls = provider.calls.load(Ordering::SeqCst);
    let (started, entered) = mpsc::channel();
    let (release, finish) = mpsc::channel();
    *provider.hook.lock().unwrap() = Some(Box::new(move || {
        let _ = started.send(());
        let _ = finish.recv_timeout(Duration::from_secs(10));
    }));
    // This real observation owns the resource lock, so the following save
    // stays in the bounded I/O queue until we release it.
    d.revalidate();
    d.poll(&wake);
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    edit(&mut d, &wake, 1, "must never reach storage", true);
    d.begin(Intent::Save, &wake);
    snapshot(&mut d, &wake, "must never reach storage");
    d.abandon_unsaved();
    release.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(working_copy::CopyCompleted::Save { result, .. }) = d.copy_rx.try_recv() {
            assert!(
                result.is_err(),
                "the queued save must exit without committing"
            );
            break;
        }
        assert!(Instant::now() < deadline, "queued save did not retire");
        std::thread::sleep(Duration::from_millis(1));
    }
    edit(&mut d, &wake, 2, "late input", true);
    d.cancel_quit(&wake);
    d.begin(Intent::Save, &wake);
    d.retry_save(&wake);
    d.poll_at(&wake, Instant::now() + Duration::from_secs(10));
    assert!(d.allow_quit && !d.dirty && !d.saving());
    assert_eq!(provider.calls.load(Ordering::SeqCst), calls + 1);
    assert_eq!(*provider.text.lock().unwrap(), "original");
    assert!(d.outgoing.is_empty());
}

#[test]
fn abandonment_does_not_replay_newer_input_after_an_already_started_write() {
    let (provider, mut d, wake) = memory_document();
    let calls = provider.calls.load(Ordering::SeqCst);
    let (started, entered) = mpsc::channel();
    let (release, finish) = mpsc::channel();
    *provider.hook.lock().unwrap() = Some(Box::new(move || {
        let _ = started.send(());
        let _ = finish.recv_timeout(Duration::from_secs(10));
    }));
    edit(&mut d, &wake, 1, "already entered storage", true);
    d.begin(Intent::Save, &wake);
    snapshot(&mut d, &wake, "already entered storage");
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    edit(&mut d, &wake, 2, "newer discarded input", true);
    d.abandon_unsaved();
    release.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(working_copy::CopyCompleted::Save { result, .. }) = d.copy_rx.try_recv() {
            assert!(
                result.is_ok(),
                "an entered provider call cannot be rolled back"
            );
            break;
        }
        assert!(Instant::now() < deadline, "started save did not finish");
        std::thread::sleep(Duration::from_millis(1));
    }
    d.poll_at(&wake, Instant::now() + Duration::from_secs(10));
    d.flush_pending_auto_save(&wake);
    assert!(!d.saving() && !d.dirty && d.allow_quit);
    assert_eq!(*provider.text.lock().unwrap(), "already entered storage");
    assert_eq!(provider.calls.load(Ordering::SeqCst), calls + 1);
    assert!(d.outgoing.is_empty());
}

#[test]
fn recreated_storage_adapter_preserves_identity_until_close_and_reopen() {
    let namespace = "memory://recreated-adapter/project/";
    let first = Arc::new(Memory::new(namespace));
    let original = Workspace::from_provider(first.clone()).unwrap();
    let wake = Wake::default();
    let mut d = Documents::in_workspace(original.clone());
    d.begin(Intent::OpenFile("note.md".into()), &wake);
    wait(&mut d, &wake);
    let document = d.document.as_ref().unwrap().clone();
    edit(&mut d, &wake, 1, "retained draft", true);
    original.revoke();
    let second = Arc::new(Memory::new(namespace));
    let replacement = Workspace::from_provider(second.clone()).unwrap();
    d.rebind_workspace(replacement.clone(), &wake);
    let deadline = Instant::now() + Duration::from_secs(10);
    while replacement.observe(d.document.as_ref().unwrap()).is_err() {
        d.poll(&wake);
        assert!(
            Instant::now() < deadline,
            "replacement adapter did not bind"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
    assert_eq!(d.document.as_ref().unwrap().id, document.id);
    assert_eq!(d.document.as_ref().unwrap().identity, document.identity);
    assert_eq!(
        d.session.as_ref().unwrap().latest_draft_buffer(),
        Buffer::new("retained draft")
    );
    d.begin(Intent::Save, &wake);
    snapshot(&mut d, &wake, "retained draft");
    wait(&mut d, &wake);
    assert_eq!(*second.text.lock().unwrap(), "retained draft");
    assert_eq!(*first.text.lock().unwrap(), "original");
    assert!(!d.dirty && d.error.is_none());
    d.begin(Intent::CloseFile, &wake);
    snapshot(&mut d, &wake, "retained draft");
    wait(&mut d, &wake);
    assert!(d.document.is_none() && d.session.is_none());
    d.begin(Intent::OpenFile("note.md".into()), &wake);
    wait(&mut d, &wake);
    assert_ne!(d.document.as_ref().unwrap().id, document.id);
    assert_eq!(d.document.as_ref().unwrap().identity, document.identity);
    assert_eq!(d.document.as_ref().unwrap().text, "retained draft");
}

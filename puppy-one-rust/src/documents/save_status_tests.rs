use super::*;
use crate::workspace::testing::Memory;
use std::sync::atomic::Ordering;

struct HeldWrite {
    release: Option<mpsc::Sender<()>>,
    entered: mpsc::Receiver<()>,
}

impl HeldWrite {
    fn new(provider: &Memory) -> Self {
        let (release, finish) = mpsc::channel();
        let (started, entered) = mpsc::channel();
        *provider.hook.lock().unwrap() = Some(Box::new(move || {
            let _ = started.send(());
            let _ = finish.recv_timeout(Duration::from_secs(15));
        }));
        Self {
            release: Some(release),
            entered,
        }
    }

    fn entered(&self) {
        self.entered.recv_timeout(Duration::from_secs(10)).unwrap();
    }

    fn release(mut self) {
        let _ = self.release.take().unwrap().send(());
    }
}

impl Drop for HeldWrite {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }
}

fn hosted() -> (Arc<Memory>, Documents, Wake) {
    let provider = Arc::new(Memory::new("memory://save-status/project/"));
    let workspace = Workspace::from_provider(provider.clone()).unwrap();
    let document = workspace.read(Path::new("note.md")).unwrap();
    let mut documents = Documents::in_workspace(workspace);
    documents.document = Some(document);
    let wake = Wake::default();
    documents.ensure_session(&wake);
    (provider, documents, wake)
}

fn edit(d: &mut Documents, wake: &Wake, revision: u64, text: &str) {
    let id = d.document.as_ref().unwrap().id.clone();
    // Match the real host's ordering: the O(1) live rope precedes Dirty.
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
            dirty: true,
        },
        wake,
    );
}

fn save(d: &mut Documents, wake: &Wake, revision: u64, text: &str, explicit: bool) {
    let request = if explicit {
        d.begin(Intent::Save, wake);
        match d.phase {
            Phase::Snapshot { request, .. } => request,
            _ => panic!("no explicit save snapshot"),
        }
    } else {
        d.flush_pending_auto_save(wake);
        d.autosave_request.unwrap().0
    };
    reply(d, wake, request, revision, text);
}

#[test]
fn quick_hosted_save_stays_unsaved_and_quiet_until_storage_acknowledges() {
    let (provider, mut d, wake) = hosted();
    let held = HeldWrite::new(&provider);
    edit(&mut d, &wake, 1, "quick draft");
    assert!(d.dirty);
    assert_eq!(d.save_status(), SaveStatus::Clean);
    save(&mut d, &wake, 1, "quick draft", false);
    held.entered();
    let started = d.saving_since.unwrap();
    d.poll_at(
        &wake,
        started + auto_save::SLOW_SAVE - Duration::from_millis(1),
    );
    assert!(d.dirty && d.saving());
    assert_eq!(d.save_status(), SaveStatus::Clean);
    assert_eq!(*provider.text.lock().unwrap(), "original");
    held.release();
    wait(&mut d, &wake);
    assert_eq!(*provider.text.lock().unwrap(), "quick draft");
    assert!(!d.dirty && !d.saving());
    assert_eq!(d.save_status(), SaveStatus::Clean);
    d.poll_at(&wake, started + auto_save::SLOW_SAVE * 3);
    assert_eq!(d.save_status(), SaveStatus::Clean);
}

#[test]
fn slow_save_announces_at_the_boundary_and_new_typing_retires_its_saved_confirmation() {
    let (provider, mut d, wake) = hosted();
    let held = HeldWrite::new(&provider);
    edit(&mut d, &wake, 1, "slow draft");
    save(&mut d, &wake, 1, "slow draft", false);
    held.entered();
    let started = d.saving_since.unwrap();
    d.poll_at(
        &wake,
        started + auto_save::SLOW_SAVE - Duration::from_millis(1),
    );
    assert_eq!(d.save_status(), SaveStatus::Clean);
    d.poll_at(&wake, started + auto_save::SLOW_SAVE);
    assert_eq!(d.save_status(), SaveStatus::Saving);
    held.release();
    wait(&mut d, &wake);
    assert_eq!(d.save_status(), SaveStatus::Saved);
    assert!(!d.dirty);
    assert_eq!(
        d.save_status_expiry(),
        d.saved_at.map(|at| at + SAVED_STATUS_DURATION)
    );
    // Stale revisions cannot dismiss the current successful save.
    d.client(
        ClientMessage::Dirty {
            id: d.document.as_ref().unwrap().id.clone(),
            revision: 0,
            dirty: true,
        },
        &wake,
    );
    assert_eq!(d.save_status(), SaveStatus::Saved);
    edit(&mut d, &wake, 2, "next draft");
    assert!(d.dirty);
    assert!(d.save_status_expiry().is_none());
    assert_eq!(
        d.save_status(),
        SaveStatus::Clean,
        "Saved cannot describe newer unsaved input"
    );
    let second = HeldWrite::new(&provider);
    save(&mut d, &wake, 2, "next draft", false);
    second.entered();
    assert_eq!(
        d.save_status(),
        SaveStatus::Clean,
        "a previous slow save cannot announce this one"
    );
    second.release();
    wait(&mut d, &wake);
    assert_eq!(d.save_status(), SaveStatus::Clean);
    assert_eq!(*provider.text.lock().unwrap(), "next draft");
}

#[test]
fn explicit_save_announces_immediately_and_write_failures_never_become_quiet_success() {
    let (provider, mut d, wake) = hosted();
    let held = HeldWrite::new(&provider);
    edit(&mut d, &wake, 1, "explicit draft");
    save(&mut d, &wake, 1, "explicit draft", true);
    held.entered();
    assert_eq!(d.save_status(), SaveStatus::Saving);
    held.release();
    wait(&mut d, &wake);
    assert_eq!(d.save_status(), SaveStatus::Saved);
    provider.failing_writes.store(1, Ordering::SeqCst);
    edit(&mut d, &wake, 2, "failed draft");
    save(&mut d, &wake, 2, "failed draft", false);
    let deadline = Instant::now() + Duration::from_secs(10);
    while d.save_error.is_none() {
        d.poll(&wake);
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(d.dirty);
    assert_eq!(d.save_status(), SaveStatus::Failed);
    assert_eq!(*provider.text.lock().unwrap(), "explicit draft");
    d.poll_at(&wake, Instant::now() + Duration::from_secs(10));
    assert_eq!(d.save_status(), SaveStatus::Failed);
    assert!(d.error.is_none());
    d.retry_save(&wake);
    d.poll(&wake);
    let request = d.autosave_request.unwrap().0;
    reply(&mut d, &wake, request, 2, "failed draft");
    wait(&mut d, &wake);
    assert_eq!(d.save_status(), SaveStatus::Clean);
    assert_eq!(*provider.text.lock().unwrap(), "failed draft");
}

use super::*;
use crate::workspace::{
    Error, ErrorKind, contracts::RelativePath, ports::WatchEvent, testing::Resources,
};
use std::sync::atomic::{AtomicBool, Ordering};

fn settle(d: &mut Documents, wake: &Wake, done: impl Fn(&Documents) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        d.poll(wake);
        if done(d) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "preview did not settle: {:?}",
            d.error
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn open(provider: Arc<Resources>, name: &str) -> (Documents, Wake) {
    let wake = Wake::default();
    let mut documents = Documents::in_workspace(Workspace::from_provider(provider).unwrap());
    documents.begin(Intent::OpenFile(name.into()), &wake);
    settle(&mut documents, &wake, |d| d.resource.is_some());
    (documents, wake)
}
fn bytes(d: &Documents) -> Vec<u8> {
    d.resource.as_ref().unwrap().preview.bytes(1024).unwrap()
}
fn change(provider: &Resources, path: &str) {
    provider.publish(WatchEvent::Changed(vec![
        RelativePath::new(path.as_ref()).unwrap(),
    ]));
}

#[test]
fn every_binary_preview_watches_its_own_path_and_unknown_changes_without_text_or_writeback() {
    for name in [
        "picture.png",
        "paper.pdf",
        "report.docx",
        "sound.mp3",
        "movie.mp4",
    ] {
        let provider = Arc::new(Resources::default());
        provider.bytes.lock().unwrap().insert(name.into(), vec![1]);
        let (mut d, wake) = open(provider.clone(), name);
        assert!(d.watching(), "{name} must own a preview watch");
        settle(&mut d, &wake, |d| {
            !d.observation_pending && d.resource_observing.is_none()
        });
        d.outgoing.clear();
        provider.reads.lock().unwrap().clear();
        change(&provider, "unrelated.png");
        d.poll(&wake);
        assert!(provider.reads.lock().unwrap().is_empty());
        assert!(d.outgoing.is_empty());
        let id = d.resource.as_ref().unwrap().id.clone();
        let workspace::PreviewData::Bytes {
            bytes: old_bytes, ..
        } = d.resource.as_ref().unwrap().preview.data().unwrap()
        else {
            panic!("hosted snapshot")
        };
        let retired = Arc::downgrade(old_bytes);
        provider.bytes.lock().unwrap().insert(name.into(), vec![2]);
        change(&provider, name);
        settle(&mut d, &wake, |d| bytes(d) == [2]);
        assert_eq!(d.resource.as_ref().unwrap().id, id);
        assert_eq!(*provider.reads.lock().unwrap(), [name]);
        assert_eq!(
            d.outgoing
                .iter()
                .filter(|m| matches!(m, HostMessage::Rebind { .. }))
                .count(),
            1
        );
        assert!(!d.dirty && !d.busy());
        assert!(
            retired.upgrade().is_none(),
            "the replaced native snapshot must be released"
        );
        provider.bytes.lock().unwrap().insert(name.into(), vec![3]);
        provider.publish(WatchEvent::Invalidated);
        settle(&mut d, &wake, |d| bytes(d) == [3]);
        drop(d);
        assert_eq!(provider.subscribers(), 0);
    }
}

#[test]
fn a_preview_refresh_lost_in_transit_keeps_the_committed_snapshot_and_refreshes_quietly() {
    let provider = Arc::new(Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![1]);
    let (mut d, wake) = open(provider.clone(), "image.png");
    settle(&mut d, &wake, |d| {
        !d.observation_pending && d.resource_observing.is_none()
    });
    let original = d.resource.as_ref().unwrap().preview.clone();
    provider.failures.lock().unwrap().insert(
        "image.png".into(),
        Error::new(ErrorKind::Io, "preview offline"),
    );
    change(&provider, "image.png");
    // Nothing is said; the committed preview stays.
    settle(&mut d, &wake, |d| d.observation_retry.is_some());
    assert!(d.error.is_none());
    assert_eq!(d.resource.as_ref().unwrap().preview, original);
    assert_eq!(bytes(&d), [1]);
    provider.failures.lock().unwrap().clear();
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![2]);
    d.client(
        ClientMessage::RetryInput {
            id: "retired surface".into(),
        },
        &wake,
    );
    d.poll(&wake);
    assert_eq!(
        bytes(&d),
        [1],
        "late retries cannot refresh another document"
    );
    // It refreshes on its own once the retry is due.
    let later = Instant::now() + OBSERVATION_RETRIES[0];
    let deadline = Instant::now() + Duration::from_secs(5);
    while bytes(&d) != [2] {
        d.poll_at(&wake, later);
        assert!(Instant::now() < deadline, "the preview never refreshed");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(d.error.is_none());
}

/// A change subscription that ends is never the person's error: a passing
/// fault subscribes again later and rereads; a lease that ended waits for the
/// Project to reconnect and rebind the copy.
#[test]
fn a_change_subscription_that_ends_says_nothing_and_subscribes_again() {
    let provider = Arc::new(Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![1]);
    let (mut d, wake) = open(provider.clone(), "image.png");
    settle(&mut d, &wake, |d| {
        d.watching() && !d.observation_pending && d.resource_observing.is_none()
    });
    provider.publish(WatchEvent::Failed(Error::new(ErrorKind::Io, "stream lost")));
    d.poll(&wake);
    assert!(d.error.is_none(), "{:?}", d.error);
    assert!(!d.watching());
    assert!(d.watch_retry.is_some());
    // Due, it subscribes again and rereads what changed meanwhile.
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![2]);
    let later = Instant::now() + super::WATCH_RETRIES[0];
    let deadline = Instant::now() + Duration::from_secs(5);
    while !(d.watching() && bytes(&d) == [2]) {
        d.poll_at(&wake, later);
        assert!(Instant::now() < deadline, "it never subscribed again");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(provider.subscribers(), 1);
    // A lease that ended: nothing said, nothing retried here.
    provider.publish(WatchEvent::Failed(Error::new(
        ErrorKind::StaleLease,
        "Cloud access changed; reopen this workspace",
    )));
    d.poll(&wake);
    assert!(d.error.is_none(), "{:?}", d.error);
    assert!(!d.watching() && d.watch_retry.is_none());
    let logged = crate::platform::diagnostics::recorded("[cloud-recovery] document watch ended");
    assert!(
        logged.iter().any(|l| l["fields"]["kind"] == "StaleLease"),
        "{logged:?}"
    );
}

#[test]
fn a_newer_resource_change_fences_an_inflight_snapshot_and_hidden_previews_resume_fresh() {
    let provider = Arc::new(Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![1]);
    let (mut d, wake) = open(provider.clone(), "image.png");
    settle(&mut d, &wake, |d| {
        !d.observation_pending && d.resource_observing.is_none()
    });
    let arrived = Arc::new(AtomicBool::new(false));
    let (release, wait) = std::sync::mpsc::channel();
    let flag = arrived.clone();
    *provider.after_read.lock().unwrap() = Some(Box::new(move || {
        flag.store(true, Ordering::SeqCst);
        wait.recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![2]);
    change(&provider, "image.png");
    settle(&mut d, &wake, |_| arrived.load(Ordering::SeqCst));
    assert_eq!(bytes(&d), [1], "keep the old preview during preparation");
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![3]);
    change(&provider, "image.png");
    d.outgoing.clear();
    release.send(()).unwrap();
    // Both channels are ready before the foreground wakes. A late read must
    // not be published ahead of the already-arrived change notification.
    let completion = d.copy_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    d.copy_tx.send(completion).unwrap();
    settle(&mut d, &wake, |d| {
        assert_ne!(bytes(d), [2], "superseded preview must never be published");
        bytes(d) == [3]
    });
    assert_eq!(
        d.outgoing
            .iter()
            .filter(|m| matches!(m, HostMessage::Rebind { .. }))
            .count(),
        1
    );
    d.pause_watch();
    assert_eq!(provider.subscribers(), 0);
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![4]);
    change(&provider, "image.png");
    d.poll(&wake);
    assert_eq!(bytes(&d), [3]);
    d.resume_watch(&wake);
    settle(&mut d, &wake, |d| bytes(d) == [4]);
    assert_eq!(provider.subscribers(), 1);
}

#[test]
fn a_late_previous_provider_cannot_replace_a_rebound_preview_or_subscription() {
    let provider = Arc::new(Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![1]);
    let (mut d, wake) = open(provider.clone(), "image.png");
    settle(&mut d, &wake, |d| {
        !d.observation_pending && d.resource_observing.is_none()
    });
    let stale = Arc::new(Resources::default());
    stale
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![2]);
    let arrived = Arc::new(AtomicBool::new(false));
    let flag = arrived.clone();
    let (release, wait) = std::sync::mpsc::channel();
    *stale.after_read.lock().unwrap() = Some(Box::new(move || {
        flag.store(true, Ordering::SeqCst);
        wait.recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    d.rebind_workspace(Workspace::from_provider(stale.clone()).unwrap(), &wake);
    settle(&mut d, &wake, |_| arrived.load(Ordering::SeqCst));
    let current = Arc::new(Resources::default());
    current
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), vec![3]);
    d.rebind_workspace(Workspace::from_provider(current.clone()).unwrap(), &wake);
    settle(&mut d, &wake, |d| {
        bytes(d) == [3] && !d.observation_pending && d.resource_observing.is_none()
    });
    d.outgoing.clear();
    release.send(()).unwrap();
    let late = d.copy_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    d.copy_tx.send(late).unwrap();
    d.poll(&wake);
    assert_eq!(bytes(&d), [3]);
    assert!(d.outgoing.is_empty());
    assert_eq!(provider.subscribers(), 0);
    assert_eq!(stale.subscribers(), 0);
    assert_eq!(current.subscribers(), 1);
}

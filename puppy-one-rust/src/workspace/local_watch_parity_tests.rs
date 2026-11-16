//! Real single-file watch acceptance, including atomic-save inode replacement.
use super::*;
use std::{
    fs::{File, FileTimes},
    os::unix::fs::MetadataExt,
    sync::mpsc::{self, RecvTimeoutError},
    time::{Duration, SystemTime},
};

fn set_modified(path: &Path, time: SystemTime) {
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(FileTimes::new().set_modified(time))
        .unwrap();
}

#[test]
fn single_file_watch_tracks_metadata_content_identity_and_recovery_then_releases_its_worker() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("note.md");
    std::fs::write(&path, "before").unwrap();
    let time = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    set_modified(&path, time);
    let ws = Workspace::open_with(dir.path(), true).unwrap();
    let document = ws.read(Path::new("note.md")).unwrap();
    let (tx, rx) = mpsc::channel();
    let watch = ws
        .watch(
            &document,
            Arc::new(move || {
                let _ = tx.send(());
            }),
        )
        .unwrap();
    let notified = || {
        rx.recv_timeout(Duration::from_secs(5))
            .expect("single-file watch did not notify")
    };
    let invalidated = || {
        notified();
        assert!(matches!(watch.next(), Some(WatchEvent::Invalidated)));
        assert!(watch.next().is_none());
    };

    // A sibling write and an unchanged baseline must not wake this subscriber.
    std::fs::write(dir.path().join("neighbour.md"), "unrelated").unwrap();
    assert_eq!(
        rx.recv_timeout(Duration::from_millis(650)),
        Err(RecvTimeoutError::Timeout)
    );
    assert!(watch.next().is_none());

    set_modified(&path, time + Duration::from_secs(1));
    invalidated();
    // Changed bytes with the same length and timestamp still invalidate.
    std::fs::write(&path, "edited").unwrap();
    set_modified(&path, time + Duration::from_secs(1));
    invalidated();
    std::fs::write(&path, "different size").unwrap();
    invalidated();

    // Editor save-through-rename: content, size and mtime remain identical.
    let old = std::fs::metadata(&path).unwrap();
    let replacement = dir.path().join("save.tmp");
    std::fs::write(&replacement, "different size").unwrap();
    set_modified(&replacement, old.modified().unwrap());
    assert_ne!(std::fs::metadata(&replacement).unwrap().ino(), old.ino());
    std::fs::rename(&replacement, &path).unwrap();
    invalidated();

    std::fs::remove_file(&path).unwrap();
    notified();
    assert!(matches!(
        watch.next(),
        Some(WatchEvent::Failed(Error {
            kind: ErrorKind::NotFound,
            ..
        }))
    ));
    std::fs::write(&path, "restored").unwrap();
    invalidated();
    assert_eq!(ws.read(Path::new("note.md")).unwrap().text, "restored");

    // Recovery replaces an unconsumed failure; the UI cannot remain stuck on it.
    std::fs::remove_file(&path).unwrap();
    notified();
    std::fs::write(&path, "recovered before UI consumption").unwrap();
    invalidated();
    drop(watch);
    // The channel disconnects only once the actual worker drops its callback.
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(5)),
        Err(RecvTimeoutError::Disconnected)
    );
    std::fs::write(&path, "after stop").unwrap();
    assert_eq!(rx.try_recv(), Err(mpsc::TryRecvError::Disconnected));
}

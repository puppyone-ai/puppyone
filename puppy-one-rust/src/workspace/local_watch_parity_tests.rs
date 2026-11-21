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

/// `workspaceMutationPipeline`: each root has its own watch, so the same
/// name changing in one root invalidates only that root's open document.
#[test]
fn same_name_documents_in_two_roots_are_invalidated_only_by_their_own_root() {
    let alpha = tempfile::tempdir().unwrap();
    let beta = tempfile::tempdir().unwrap();
    let watch = |dir: &Path| {
        std::fs::write(dir.join("README.md"), "before").unwrap();
        let ws = Workspace::open_with(dir, true).unwrap();
        let document = ws.read(Path::new("README.md")).unwrap();
        let (tx, rx) = mpsc::channel();
        let watch = ws
            .watch(
                &document,
                Arc::new(move || {
                    let _ = tx.send(());
                }),
            )
            .unwrap();
        (ws, watch, rx)
    };
    let (_alpha_ws, alpha_watch, alpha_rx) = watch(alpha.path());
    let (_beta_ws, beta_watch, beta_rx) = watch(beta.path());
    std::fs::write(alpha.path().join("README.md"), "alpha edited").unwrap();
    alpha_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("alpha's document is invalidated");
    assert!(matches!(alpha_watch.next(), Some(WatchEvent::Invalidated)));
    assert_eq!(
        beta_rx.recv_timeout(Duration::from_millis(650)),
        Err(RecvTimeoutError::Timeout)
    );
    assert!(beta_watch.next().is_none());
}

/// `directoryTreeWatch`: the root's recursive watch keeps naming a file
/// through repeated atomic saves and in-place writes, in an existing
/// folder and in folders created after it started; after it is dropped
/// nothing more arrives.
#[test]
fn the_root_watch_names_files_through_atomic_saves_and_new_nested_folders() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("existing")).unwrap();
    let ws = Workspace::open_with(&root, true).unwrap();
    let (tx, rx) = mpsc::channel();
    let watch = ws
        .watch_root(Arc::new(move || {
            let _ = tx.send(());
        }))
        .unwrap();
    let names = |path: &str| {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            rx.recv_timeout(left)
                .unwrap_or_else(|_| panic!("{path} was never named"));
            match watch.next() {
                Some(WatchEvent::Changed(paths))
                    if paths.iter().any(|p| p.as_path() == Path::new(path)) =>
                {
                    return;
                }
                Some(WatchEvent::Invalidated) => return,
                _ => {}
            }
        }
    };
    for folder in ["existing", "created/nested"] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
        let file = format!("{folder}/board.excalidraw");
        std::fs::write(root.join(&file), "initial").unwrap();
        names(&file);
        for index in 0..3 {
            let temporary = root.join(folder).join(format!("save-{index}.tmp"));
            std::fs::write(&temporary, format!("saved-{index}")).unwrap();
            std::fs::rename(&temporary, root.join(&file)).unwrap();
            names(&file);
            std::fs::write(root.join(&file), format!("agent-{index}")).unwrap();
            names(&file);
        }
    }
    drop(watch);
    // The worker drops its callback with the subscription.
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(5)),
        Err(RecvTimeoutError::Disconnected)
    );
}

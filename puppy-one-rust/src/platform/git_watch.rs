//! Repository metadata events are invalidation hints. A bounded snapshot
//! reconciles silent native streams; recoverable failures rearm with backoff.
//! Each handle owns its worker and cancels it on drop.
use super::git::git_read;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool, mpsc},
};

mod snapshot;
mod worker;
#[cfg(test)]
use snapshot::snapshot;

/// Dropping the subscription wakes and stops its worker.
pub struct GitWatch {
    stop: mpsc::Sender<worker::Signal>,
    cancelled: Arc<AtomicBool>,
}
impl Drop for GitWatch {
    fn drop(&mut self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = self.stop.send(worker::Signal::Stop);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity {
    top_level: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
}
fn identity(root: &Path) -> Result<Identity, String> {
    let bytes = git_read(
        root,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-dir",
            "--git-common-dir",
        ],
        None,
        &AtomicBool::new(false),
    )?;
    let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    let mut paths = text.lines().map(PathBuf::from);
    let result = Identity {
        top_level: paths.next().ok_or("no worktree root")?,
        git_dir: paths.next().ok_or("no Git directory")?,
        common_dir: paths.next().ok_or("no common directory")?,
    };
    if [&result.top_level, &result.git_dir, &result.common_dir]
        .iter()
        .any(|p| !p.is_absolute())
    {
        return Err("Git metadata identity must be absolute".into());
    }
    Ok(result)
}
#[cfg(test)]
fn directories(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    identity(root).map(|i| (i.git_dir, i.common_dir))
}

pub fn watch(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
) -> Result<GitWatch, String> {
    worker::start(root, noise, changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::git::git;
    use core::prelude::v1::test;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use std::time::Duration;

    #[test]
    fn ref_changes_invalidate_and_lock_files_do_not() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let cancel = AtomicBool::new(false);
        git(&root, &["init", "-q"], None, &cancel).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let seen = count.clone();
        let _watch = watch(
            &root,
            |rel| rel.ends_with(".lock"),
            move || {
                seen.fetch_add(1, Ordering::SeqCst);
            },
        )
        .unwrap();
        // FSEvents may deliver `git init`'s own writes after the stream
        // starts. Events arrive in order: once a write made now has been
        // seen and the deliveries have gone quiet, count from zero.
        std::fs::write(root.join(".git/description"), b"sync\n").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let before = count.load(Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(500));
            if before > 0 && count.load(Ordering::SeqCst) == before {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the watch never started"
            );
        }
        count.store(0, Ordering::SeqCst);
        std::fs::write(root.join(".git/index.lock"), b"").unwrap();
        std::thread::sleep(Duration::from_millis(800));
        assert_eq!(count.load(Ordering::SeqCst), 0, "lock files are noise");
        std::fs::write(root.join(".git/refs/heads/topic"), b"0\n").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while count.load(Ordering::SeqCst) == 0 {
            assert!(std::time::Instant::now() < deadline, "no invalidation");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    /// v0.4.4 `a7474c5f5`: what the snapshot sees is Git's own metadata,
    /// so a missed event is still found; lock files are not a change.
    #[cfg(unix)]
    #[test]
    fn the_metadata_snapshot_moves_with_refs_and_not_with_locks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git(&root, &["init", "-q"], None, &AtomicBool::new(false)).unwrap();
        let (git_dir, common) = directories(&root).unwrap();
        let read = || snapshot(&root, &git_dir, &common).unwrap();
        let before = read();
        assert_eq!(read(), before, "stable while nothing changes");
        std::fs::write(root.join(".git/index.lock"), b"").unwrap();
        assert_eq!(read(), before, "lock files are noise");
        std::fs::write(root.join(".git/refs/heads/topic"), b"0\n").unwrap();
        assert_ne!(read(), before);
    }

    /// A folder that becomes a repository later starts its watch and
    /// invalidates, without an event from the folder itself.
    #[test]
    fn a_later_git_init_is_noticed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let seen = count.clone();
        let _watch = watch(
            &root,
            |rel| rel.ends_with(".lock"),
            move || {
                seen.fetch_add(1, Ordering::SeqCst);
            },
        )
        .unwrap();
        git(&root, &["init", "-q"], None, &AtomicBool::new(false)).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while count.load(Ordering::SeqCst) == 0 {
            assert!(
                std::time::Instant::now() < deadline,
                "git init went unnoticed"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

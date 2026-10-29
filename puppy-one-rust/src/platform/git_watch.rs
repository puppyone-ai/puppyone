//! `git-metadata-watch-service.mjs`: an OS watcher on the repository's own
//! metadata (the Git directory, its refs, and a linked worktree's common
//! directory), separate from the working-tree watcher. Events are
//! invalidation hints only; lock files, objects and cookies are filtered and
//! bursts coalesce. Paths come from Git itself, never from the caller.
use super::git::git;
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, mpsc},
    time::Duration,
};

/// Dropping it stops the watcher.
pub struct GitWatch {
    stop: mpsc::Sender<()>,
}
impl Drop for GitWatch {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

/// The Git directory and the common directory of the work tree at `root`.
fn directories(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let out = git(
        root,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-dir",
            "--git-common-dir",
        ],
        None,
        &AtomicBool::new(false),
    )?;
    let text = String::from_utf8(out).map_err(|e| e.to_string())?;
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let git_dir = PathBuf::from(lines.next().ok_or("no Git directory")?);
    let common = lines
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| git_dir.clone());
    Ok((git_dir, common))
}

/// Watch the repository of `root`; `changed` runs on a worker after each
/// coalesced burst. `noise` names the paths (relative to a watched Git
/// directory) that never invalidate.
pub fn watch(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
) -> Result<GitWatch, String> {
    use notify::{RecursiveMode, Watcher};
    let (git_dir, common) = directories(root)?;
    let bases = if common == git_dir {
        vec![git_dir.clone()]
    } else {
        vec![git_dir.clone(), common.clone()]
    };
    let (tx, rx) = mpsc::channel::<()>();
    let filter = bases.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let relevant = match &result {
            Ok(event) => event.paths.iter().any(|path| {
                filter.iter().any(|base| {
                    path.strip_prefix(base).is_ok_and(|rel| {
                        let rel = rel.to_string_lossy().replace('\\', "/");
                        !noise(&rel)
                    })
                })
            }),
            Err(_) => true,
        };
        if relevant {
            let _ = tx.send(());
        }
    })
    .map_err(|e| e.to_string())?;
    // The directory itself (HEAD, index, packed-refs, …) and refs below it.
    for base in &bases {
        watcher
            .watch(base, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
    }
    let refs = common.join("refs");
    if refs.is_dir() {
        watcher
            .watch(&refs, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }
    let (stop, stopped) = mpsc::channel::<()>();
    crate::localization::spawn(move || {
        // Owns the watcher: dropping it here stops the OS subscription.
        let _watcher = watcher;
        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(()) => {
                    // `GIT_METADATA_INVALIDATION_DEBOUNCE_MS`.
                    while rx.recv_timeout(Duration::from_millis(120)).is_ok() {}
                    changed();
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if !matches!(stopped.try_recv(), Err(mpsc::TryRecvError::Empty)) {
                return;
            }
        }
    });
    Ok(GitWatch { stop })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

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
        std::thread::sleep(Duration::from_millis(300));
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
}

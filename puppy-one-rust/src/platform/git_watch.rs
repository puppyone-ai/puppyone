//! `git-metadata-watch-service.mjs`: an OS watcher on the repository's own
//! metadata (the Git directory, its refs, and a linked worktree's common
//! directory), separate from the working-tree watcher. Events are
//! invalidation hints only; lock files, objects and cookies are filtered and
//! bursts coalesce. Paths come from Git itself, never from the caller.
//!
//! OS events can be missed (a cold or silently failed stream), so every 2 s
//! a bounded metadata snapshot (`git-metadata-snapshot.mjs`) is compared
//! with the last one, whose baseline is taken before the watch is returned.
//! A folder that is not a repository yet is looked at as often, so a later
//! `git init` starts the watch and invalidates.
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

/// `GIT_METADATA_RECONCILE_MS`.
const RECONCILE: Duration = Duration::from_millis(2000);
/// `GIT_METADATA_SNAPSHOT_MAX_ENTRIES`.
const MAX_ENTRIES: usize = 10_000;
const FILES: [&str; 16] = [
    "HEAD",
    "index",
    "config",
    "packed-refs",
    "FETCH_HEAD",
    "ORIG_HEAD",
    "MERGE_HEAD",
    "MERGE_MSG",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "BISECT_LOG",
    "BISECT_START",
    "shallow",
    "commondir",
    "gitdir",
];
const TREES: [&str; 4] = ["refs", "rebase-merge", "rebase-apply", "sequencer"];

/// `readGitMetadataSnapshot`: a digest of Git-resolved metadata only — no
/// file contents, object database, logs or work tree. A directory counts by
/// its identity and its (bounded, sorted) children; a file by identity,
/// mode, size and times. `None` when it exceeds its budget.
fn snapshot(top_level: &Path, git_dir: &Path, common: &Path) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        struct Walk {
            hash: blake3::Hasher,
            entries: usize,
        }
        impl Walk {
            fn inspect(&mut self, location: &Path, recursive: bool) -> Option<()> {
                let Ok(info) = std::fs::symlink_metadata(location) else {
                    return Some(());
                };
                let kind = info.file_type();
                if !kind.is_file() && !kind.is_dir() && !kind.is_symlink() {
                    return Some(());
                }
                self.entries += 1;
                if self.entries > MAX_ENTRIES {
                    return None;
                }
                // Directory times move with ignored lock and object activity.
                let version = if kind.is_dir() {
                    format!("{}:{}", info.dev(), info.ino())
                } else {
                    format!(
                        "{}:{}:{}:{}:{}.{}:{}.{}",
                        info.dev(),
                        info.ino(),
                        info.mode(),
                        info.size(),
                        info.mtime(),
                        info.mtime_nsec(),
                        info.ctime(),
                        info.ctime_nsec()
                    )
                };
                self.hash.update(location.as_os_str().as_encoded_bytes());
                self.hash.update(b"\0");
                self.hash.update(version.as_bytes());
                self.hash.update(b"\0");
                if !recursive || !kind.is_dir() {
                    return Some(());
                }
                let mut children: Vec<_> = std::fs::read_dir(location)
                    .ok()?
                    .flatten()
                    .map(|entry| entry.file_name())
                    .collect();
                if children.len() + self.entries >= MAX_ENTRIES {
                    return None;
                }
                children.sort();
                for name in children {
                    let text = name.to_string_lossy();
                    if text.ends_with(".lock") || text.ends_with(".cookie") || text == "cookies" {
                        continue;
                    }
                    self.inspect(&location.join(&name), true)?;
                }
                Some(())
            }
        }
        let mut walk = Walk {
            hash: blake3::Hasher::new(),
            entries: 0,
        };
        walk.inspect(&top_level.join(".git"), false)?;
        let mut directories = vec![git_dir.to_path_buf(), common.to_path_buf()];
        directories.sort();
        directories.dedup();
        for directory in directories {
            for file in FILES {
                walk.inspect(&directory.join(file), false)?;
            }
            for tree in TREES {
                walk.inspect(&directory.join(tree), true)?;
            }
        }
        Some(walk.hash.finalize().to_hex().to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = (top_level, git_dir, common);
        None
    }
}

/// Watch the repository of `root`, or wait for `root` to become one;
/// `changed` runs on a worker after each coalesced burst, after a missed
/// change is found, and once a repository appears. `noise` names the paths
/// (relative to a watched Git directory) that never invalidate.
pub fn watch(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
) -> Result<GitWatch, String> {
    let Ok(directories) = directories(root) else {
        return Ok(pending(root.to_path_buf(), noise, changed));
    };
    let (stop, stopped) = mpsc::channel::<()>();
    let root = root.to_path_buf();
    let (watcher, rx) = arm(&directories, noise)?;
    // The comparison baseline comes before the watch is handed back: a
    // cold or silently failed OS stream must not lose its first operation.
    let baseline = snapshot(&root, &directories.0, &directories.1);
    crate::localization::spawn(move || {
        run(root, directories, watcher, rx, baseline, stopped, &changed);
    });
    Ok(GitWatch { stop })
}

/// `subscribePendingRoot`: a folder that is not a repository yet, looked at
/// every 2 s; `git init` arms the watch and invalidates.
fn pending(
    root: PathBuf,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
) -> GitWatch {
    let (stop, stopped) = mpsc::channel::<()>();
    crate::localization::spawn(move || {
        loop {
            match stopped.recv_timeout(RECONCILE) {
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                _ => return,
            }
            if !root.join(".git").exists() {
                continue;
            }
            // Git initialization can race identity resolution: next tick.
            let Ok(directories) = directories(&root) else {
                continue;
            };
            let Ok((watcher, rx)) = arm(&directories, noise) else {
                continue;
            };
            let baseline = snapshot(&root, &directories.0, &directories.1);
            changed();
            return run(root, directories, watcher, rx, baseline, stopped, &changed);
        }
    });
    GitWatch { stop }
}

type Armed = (notify::RecommendedWatcher, mpsc::Receiver<()>);

/// The OS watcher on the Git and common directories and the refs below.
fn arm((git_dir, common): &(PathBuf, PathBuf), noise: fn(&str) -> bool) -> Result<Armed, String> {
    use notify::{RecursiveMode, Watcher};
    let (git_dir, common) = (git_dir.clone(), common.clone());
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
    Ok((watcher, rx))
}

/// The watch's worker: OS events, then the 2 s reconciliation.
fn run(
    root: PathBuf,
    directories: (PathBuf, PathBuf),
    watcher: notify::RecommendedWatcher,
    rx: mpsc::Receiver<()>,
    mut last: Option<String>,
    stopped: mpsc::Receiver<()>,
    changed: &dyn Fn(),
) {
    // Owns the watcher: dropping it here stops the OS subscription.
    let _watcher = watcher;
    let mut reconciled = std::time::Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(()) => {
                // `GIT_METADATA_INVALIDATION_DEBOUNCE_MS`.
                while rx.recv_timeout(Duration::from_millis(120)).is_ok() {}
                last = snapshot(&root, &directories.0, &directories.1);
                changed();
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if !matches!(stopped.try_recv(), Err(mpsc::TryRecvError::Empty)) {
            return;
        }
        if reconciled.elapsed() >= RECONCILE {
            reconciled = std::time::Instant::now();
            // A change the OS did not report; an unreadable snapshot too.
            let now = snapshot(&root, &directories.0, &directories.1);
            if now.is_none() || now != last {
                last = now;
                changed();
            }
        }
    }
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

use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

/// `GIT_METADATA_SNAPSHOT_MAX_ENTRIES`.
pub(super) const MAX_ENTRIES: usize = 10_000;
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
#[cfg(test)]
pub(super) fn snapshot(top_level: &Path, git_dir: &Path, common: &Path) -> Option<String> {
    snapshot_with(
        top_level,
        git_dir,
        common,
        &AtomicBool::new(false),
        MAX_ENTRIES,
    )
}

pub(super) fn snapshot_with(
    top_level: &Path,
    git_dir: &Path,
    common: &Path,
    cancelled: &AtomicBool,
    max_entries: usize,
) -> Option<String> {
    if cancelled.load(Ordering::Relaxed) {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        struct Walk<'a> {
            hash: blake3::Hasher,
            entries: usize,
            max_entries: usize,
            cancelled: &'a AtomicBool,
        }
        impl Walk<'_> {
            fn inspect(&mut self, location: &Path, recursive: bool) -> Option<()> {
                if self.cancelled.load(Ordering::Relaxed) {
                    return None;
                }
                let info = match std::fs::symlink_metadata(location) {
                    Ok(info) => info,
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                        ) =>
                    {
                        return Some(());
                    }
                    Err(_) => return None,
                };
                let kind = info.file_type();
                if !kind.is_file() && !kind.is_dir() && !kind.is_symlink() {
                    return Some(());
                }
                self.entries += 1;
                if self.entries > self.max_entries {
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
                if std::fs::canonicalize(location).ok()? != location {
                    return None;
                }
                let mut children = Vec::new();
                for entry in std::fs::read_dir(location).ok()? {
                    if self.cancelled.load(Ordering::Relaxed)
                        || children.len() + self.entries >= self.max_entries
                    {
                        return None;
                    }
                    children.push(entry.ok()?.file_name());
                }
                let after = std::fs::symlink_metadata(location).ok()?;
                if after.dev() != info.dev()
                    || after.ino() != info.ino()
                    || std::fs::canonicalize(location).ok()? != location
                {
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
            max_entries,
            cancelled,
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
        (!cancelled.load(Ordering::Relaxed)).then(|| walk.hash.finalize().to_hex().to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = (top_level, git_dir, common, max_entries);
        None
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        let git = root.path().join(".git");
        std::fs::create_dir_all(git.join("refs/heads")).unwrap();
        std::fs::write(git.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(git.join("refs/heads/main"), "a".repeat(40)).unwrap();
        root
    }
    fn read(root: &Path) -> Option<String> {
        let root = root.canonicalize().unwrap();
        snapshot(&root, &root.join(".git"), &root.join(".git"))
    }
    #[test]
    fn snapshots_ignore_worktree_objects_logs_locks_and_cookies_but_observe_refs() {
        let root = fixture();
        let original = read(root.path()).unwrap();
        for (name, contents) in [
            ("note.md", "working tree"),
            (".git/objects/data", "object"),
            (".git/logs/HEAD", "log"),
            (".git/refs/heads/main.lock", "lock"),
            (".git/refs/heads/main.cookie", "cookie"),
            (".git/refs/cookies/ignored", "cookie"),
        ] {
            let path = root.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }
        assert_eq!(read(root.path()).unwrap(), original);
        std::fs::write(root.path().join(".git/refs/heads/main"), "b".repeat(40)).unwrap();
        assert_ne!(read(root.path()).unwrap(), original);
    }
    #[test]
    fn snapshot_never_follows_metadata_symlinks() {
        let root = fixture();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join(".git/refs/escape")).unwrap();
        let original = read(root.path()).unwrap();
        std::fs::write(outside.path().join("private"), "outside change").unwrap();
        assert_eq!(read(root.path()).unwrap(), original);
    }
    #[test]
    fn entry_budget_refuses_the_scan_instead_of_returning_a_partial_fingerprint() {
        let directory = fixture();
        let root = directory.path().canonicalize().unwrap();
        let git = root.join(".git");
        assert!(snapshot_with(&root, &git, &git, &AtomicBool::new(false), 2).is_none());
        assert!(snapshot_with(&root, &git, &git, &AtomicBool::new(false), 32).is_some());
        for i in 0..64 {
            std::fs::write(
                git.join("refs/heads").join(format!("branch-{i}")),
                "reference",
            )
            .unwrap();
        }
        assert!(snapshot_with(&root, &git, &git, &AtomicBool::new(false), 32).is_none());
        assert!(snapshot_with(&root, &git, &git, &AtomicBool::new(false), 128).is_some());
    }
    #[test]
    fn cancelled_snapshots_do_not_inspect_even_the_first_path() {
        let unused = Path::new("/unused-metadata-snapshot-path");
        assert!(
            snapshot_with(unused, unused, unused, &AtomicBool::new(true), MAX_ENTRIES).is_none()
        );
    }
}

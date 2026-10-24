//! When a project last changed, for the homepage (`readWorkspaceModifiedAt`
//! in `local-api/files/workspace-activity.mjs`). Read-only and bounded: it
//! never uses the opening time and never reads file contents.
//!
//! - A Git repository: the newest of the HEAD commit time and the change
//!   times of the paths `git status` reports (a removed path counts its
//!   nearest surviving parent).
//! - Any other folder: the newest file modification time.
//! - Unknown (`None`) past 1024 entries, on a Git failure other than "not a
//!   repository", or when nothing could be read.
use super::{git, process};
use std::{
    fs,
    path::{Component, Path},
    sync::atomic::AtomicBool,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// `MAX_ENTRIES`: an incomplete scan is unknown, not a falsely precise time.
const MAX_ENTRIES: usize = 1024;
/// Names that never count as project activity (`INTERNAL`).
const INTERNAL: [&str; 4] = [".git", ".puppyone", ".DS_Store", "node_modules"];
/// The product gives each Git read two seconds.
const GIT_TIMEOUT: Duration = Duration::from_secs(2);

pub fn last_modified(root: &Path) -> Option<SystemTime> {
    let cancel = AtomicBool::new(false);
    let run = |args: &[&str]| {
        process::run(
            Path::new("/usr/bin/git"),
            args,
            root,
            None,
            GIT_TIMEOUT,
            &cancel,
        )
    };
    let status = match run(&["status", "--porcelain=v1", "-z", "--untracked-files=all"]) {
        Ok(status) => status,
        Err(error) if error.to_lowercase().contains("not a git repository") => {
            return folder_activity(root);
        }
        Err(_) => return None,
    };
    let changes = git::parse_status(&status).ok()?;
    if changes.truncated || changes.changes.len() > MAX_ENTRIES {
        return None;
    }
    let mut latest = run(&["log", "-1", "--format=%ct"])
        .ok()
        .and_then(|out| String::from_utf8(out).ok())
        .and_then(|text| text.trim().parse::<u64>().ok())
        .map(|secs| UNIX_EPOCH + Duration::from_secs(secs));
    for change in &changes.changes {
        let relative = Path::new(&change.path);
        if relative.components().any(|part| match part {
            Component::Normal(name) => INTERNAL.iter().any(|internal| name == *internal),
            // Git reports paths inside the repository; anything else is skipped.
            _ => true,
        }) {
            continue;
        }
        // A deletion or rename changes its nearest surviving parent.
        let mut path = Some(relative);
        while let Some(candidate) = path.filter(|p| !p.as_os_str().is_empty()) {
            if let Ok(metadata) = fs::symlink_metadata(root.join(candidate)) {
                latest = latest.max(changed_at(&metadata));
                break;
            }
            path = candidate.parent();
        }
    }
    latest
}

/// `readFolderActivity`: the newest file modification time.
fn folder_activity(root: &Path) -> Option<SystemTime> {
    let mut visited = 0;
    let mut latest = None;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).ok()? {
            let entry = entry.ok()?;
            visited += 1;
            if visited > MAX_ENTRIES {
                return None;
            }
            let name = entry.file_name();
            if INTERNAL.iter().any(|internal| name == *internal) {
                continue;
            }
            let kind = entry.file_type().ok()?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                latest = latest.max(entry.metadata().ok()?.modified().ok());
            }
        }
    }
    latest
}

/// The later of a path's modification and status-change times.
fn changed_at(metadata: &fs::Metadata) -> Option<SystemTime> {
    let modified = metadata.modified().ok();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let changed = u64::try_from(metadata.ctime())
            .ok()
            .map(|secs| UNIX_EPOCH + Duration::new(secs, metadata.ctime_nsec() as u32));
        modified.max(changed)
    }
    #[cfg(not(unix))]
    modified
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_plain_folder_reports_its_newest_file_and_skips_internal_entries() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(last_modified(temp.path()), None, "nothing to read");
        fs::create_dir(temp.path().join("notes")).unwrap();
        fs::write(temp.path().join("notes/a.md"), "a").unwrap();
        let file = fs::metadata(temp.path().join("notes/a.md"))
            .unwrap()
            .modified()
            .unwrap();
        fs::create_dir(temp.path().join("node_modules")).unwrap();
        assert_eq!(last_modified(temp.path()), Some(file));
    }

    #[test]
    fn too_many_entries_is_unknown() {
        let temp = tempfile::tempdir().unwrap();
        for index in 0..=MAX_ENTRIES {
            fs::write(temp.path().join(format!("{index}.md")), "").unwrap();
        }
        assert_eq!(last_modified(temp.path()), None);
    }

    #[test]
    fn a_repository_counts_its_commit_and_its_changes() {
        let temp = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            std::process::Command::new("/usr/bin/git")
                .args(args)
                .current_dir(temp.path())
                .env("GIT_AUTHOR_NAME", "t")
                .env("GIT_AUTHOR_EMAIL", "t@example.com")
                .env("GIT_COMMITTER_NAME", "t")
                .env("GIT_COMMITTER_EMAIL", "t@example.com")
                .env("GIT_COMMITTER_DATE", "2001-09-09T01:46:40Z")
                .output()
                .unwrap()
        };
        git(&["init", "-q"]);
        fs::write(temp.path().join("a.md"), "a").unwrap();
        git(&["add", "a.md"]);
        git(&["commit", "-q", "-m", "a"]);
        // A clean tree reports the commit time.
        assert_eq!(
            last_modified(temp.path()),
            Some(UNIX_EPOCH + Duration::from_secs(1_000_000_000))
        );
        // An edit after the commit is newer.
        fs::write(temp.path().join("b.md"), "b").unwrap();
        let edited = last_modified(temp.path()).unwrap();
        assert!(edited > UNIX_EPOCH + Duration::from_secs(1_000_000_000));
    }
}

//! Commit history for the History timeline: the product's `readGitHistory`
//! (`--name-status` and `--numstat` passes merged per commit). Dates are the
//! author dates in the local zone, so the timeline groups by local day.
#[cfg(test)]
mod integrity_tests;
use super::{git::git_read as git, git_diff::Status};
use std::{path::Path, sync::atomic::AtomicBool};
mod records;

/// `GIT_HISTORY_LIMIT`.
pub const LIMIT: usize = 100;

/// `GitCommitChange`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: Status,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// `GitCommitSummary`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitSummary {
    pub id: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    /// ISO 8601 in the local zone (`2026-10-24T09:05:00+08:00`).
    pub created_at: Option<String>,
    pub message: String,
    pub changes: Vec<CommitChange>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct History {
    pub commits: Vec<CommitSummary>,
    /// The checked-out commit (`HEAD` badge).
    pub head: Option<String>,
}

const FORMAT: &str = "--format=%x00%H%x00%P%x00%an%x00%ae%x00%ad%x00%s%x00";

pub fn history(root: &Path, cancel: &AtomicBool) -> Result<History, String> {
    super::git::coordinator::wait_for_reads(root, cancel)?;
    let head = match git(
        root,
        &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        None,
        cancel,
    ) {
        Ok(bytes) => String::from_utf8(bytes)
            .map_err(|_| "Invalid Git history HEAD")?
            .trim()
            .to_owned(),
        Err(cause) => {
            // Only an existing repository with a symbolic HEAD whose exact
            // branch has no ref is unborn. Corruption and read/cancel failures
            // must reach the owner's retry state instead of inventing emptiness.
            let symbolic = git(root, &["symbolic-ref", "--quiet", "HEAD"], None, cancel)
                .map_err(|_| cause.clone())?;
            let symbolic = std::str::from_utf8(&symbolic)
                .map_err(|_| cause.clone())?
                .trim();
            if !symbolic.starts_with("refs/heads/") {
                return Err(cause);
            }
            let refs = git(
                root,
                &["for-each-ref", "--format=%(refname)", symbolic],
                None,
                cancel,
            )?;
            if std::str::from_utf8(&refs)
                .map_err(|_| "Invalid Git history refs")?
                .lines()
                .any(|name| name == symbolic)
            {
                return Err(cause);
            }
            if cancel.load(std::sync::atomic::Ordering::Acquire) {
                return Err("Git history read cancelled".into());
            }
            return Ok(History::default());
        }
    };
    read_at(root, &head, cancel)
}
fn read_at(root: &Path, head: &str, cancel: &AtomicBool) -> Result<History, String> {
    let limit = LIMIT.to_string();
    // Both passes and the HEAD badge refer to the same immutable commit even
    // if a concurrent local Git command advances or checks out the branch.
    let read = |kind: &str| -> Result<String, String> {
        let bytes = git(
            root,
            &[
                "log",
                "--topo-order",
                "-n",
                &limit,
                "-z",
                "--no-show-signature",
                "--no-ext-diff",
                "--no-textconv",
                "--date=iso-strict-local",
                FORMAT,
                kind,
                head,
                "--",
            ],
            None,
            cancel,
        )?;
        String::from_utf8(bytes)
            .map_err(|_| "Git history contains non-UTF-8 metadata or paths".into())
    };
    let status = read("--name-status")?;
    let numstat = read("--numstat")?;
    let commits = records::parse(&status, &numstat)?;
    if commits.is_empty() {
        return Err("Git history omitted its captured HEAD".into());
    }
    if cancel.load(std::sync::atomic::Ordering::Acquire) {
        return Err("Git history read cancelled".into());
    }
    Ok(History {
        commits,
        head: Some(head.into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn logs_merge_like_read_git_history() {
        let first_header = format!(
            "\0{}\0p1 p2\0Ada\0ada@x\02026-10-24T09:05:00+08:00\0Clarify usage\0\0",
            "a".repeat(40)
        );
        let empty_header = format!("\0{}\0\0\0\0\0\0\0", "b".repeat(40));
        let status = format!(
            "{first_header}\nM\0README.md\0R100\0old.txt\0new.txt\0A\0src/util.ts\0{empty_header}"
        );
        let numstat = format!(
            "{first_header}\n1\t1\tREADME.md\00\t0\t\0old.txt\0new.txt\04\t0\tsrc/util.ts\0-\t-\tassets/logo.png\0{empty_header}"
        );
        let commits = records::parse(&status, &numstat).unwrap();
        assert_eq!(commits.len(), 2);
        let first = &commits[0];
        assert_eq!(
            (first.parents.len(), first.message.as_str()),
            (2, "Clarify usage")
        );
        assert_eq!(
            first.created_at.as_deref(),
            Some("2026-10-24T09:05:00+08:00")
        );
        let stats: Vec<_> = first
            .changes
            .iter()
            .map(|c| (c.path.as_str(), c.status, c.additions, c.deletions))
            .collect();
        assert_eq!(
            stats,
            [
                ("README.md", Status::Modified, Some(1), Some(1)),
                ("new.txt", Status::Renamed, Some(0), Some(0)),
                ("src/util.ts", Status::Added, Some(4), Some(0)),
                // A stat without a name-status line is "changed"; binary is unknown.
                ("assets/logo.png", Status::Changed, None, None),
            ]
        );
        let empty = &commits[1];
        assert_eq!(
            (
                empty.author_name.as_str(),
                empty.message.as_str(),
                empty.created_at.as_deref()
            ),
            ("Unknown", "(no message)", None)
        );
    }

    #[test]
    fn a_repository_reads_its_history_and_head() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let run = |args: &[&str]| {
            assert!(
                std::process::Command::new("/usr/bin/git")
                    .args(args)
                    .current_dir(root)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        };
        let cancel = AtomicBool::new(false);
        run(&["init", "-q"]);
        assert_eq!(history(root, &cancel).unwrap(), History::default());
        run(&["config", "user.email", "a@b.c"]);
        run(&["config", "user.name", "Ada"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "First"]);
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        run(&["commit", "-qam", "Second"]);
        let history = history(root, &cancel).unwrap();
        assert_eq!(
            history
                .commits
                .iter()
                .map(|c| c.message.as_str())
                .collect::<Vec<_>>(),
            ["Second", "First"]
        );
        assert_eq!(
            history.head.as_deref(),
            Some(history.commits[0].id.as_str())
        );
        assert_eq!(history.commits[0].changes[0].additions, Some(1));
    }
}

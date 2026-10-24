//! Commit history for the History timeline: the product's `readGitHistory`
//! (`--name-status` and `--numstat` passes merged per commit). Dates are the
//! author dates in the local zone, so the timeline groups by local day.
use super::{git::git, git_diff::Status};
use std::{collections::HashMap, path::Path, sync::atomic::AtomicBool};

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

const FORMAT: &str = "--pretty=format:%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s";

/// `parseGitNameStatusLine`.
fn name_status(line: &str) -> Option<CommitChange> {
    if line.trim().is_empty() {
        return None;
    }
    let parts: Vec<&str> = line.split('\t').collect();
    let code = parts.first().copied().unwrap_or_default();
    let change = |status, path: &str, old: Option<&str>| CommitChange {
        path: path.to_owned(),
        old_path: old.filter(|o| !o.is_empty()).map(str::to_owned),
        status,
        additions: None,
        deletions: None,
    };
    let path = |i: usize| parts.get(i).copied().unwrap_or_default();
    Some(match code.chars().next() {
        Some('R') => change(
            Status::Renamed,
            if path(2).is_empty() { path(1) } else { path(2) },
            Some(path(1)),
        ),
        Some('C') => change(
            Status::Copied,
            if path(2).is_empty() { path(1) } else { path(2) },
            Some(path(1)),
        ),
        Some('A') => change(Status::Added, path(1), None),
        Some('D') => change(Status::Deleted, path(1), None),
        Some('M') => change(Status::Modified, path(1), None),
        _ => change(Status::Changed, path(1), None),
    })
}

/// `normalizeNumstatPath`: `dir/{old => new}/file` and `old => new` name
/// the new path.
fn numstat_path(value: &str) -> String {
    let value = value.trim();
    if !value.contains("=>") {
        return value.to_owned();
    }
    if let (Some(open), Some(close)) = (value.find('{'), value.rfind('}'))
        && open < close
        && let Some((old, new)) = value[open + 1..close].split_once(" => ")
        && !old.is_empty()
        && !new.is_empty()
    {
        let joined = format!("{}{}{}", &value[..open], new, &value[close + 1..]);
        let mut collapsed = String::with_capacity(joined.len());
        for c in joined.chars() {
            if !(c == '/' && collapsed.ends_with('/')) {
                collapsed.push(c);
            }
        }
        return collapsed;
    }
    value.rsplit(" => ").next().unwrap_or(value).to_owned()
}

/// Sections of `git log` output: `\x1e<header>` followed by change lines.
fn sections(output: &str) -> impl Iterator<Item = (Vec<&str>, Vec<&str>)> {
    output.split('\x1e').filter_map(|section| {
        let mut lines = section.trim_start_matches(['\r', '\n']).lines();
        let header = lines.next()?;
        let fields: Vec<&str> = header.split('\x1f').collect();
        (!fields.first()?.is_empty()).then(|| (fields, lines.collect()))
    })
}

/// `--numstat` rows per commit: path, additions, deletions (`-` is unknown).
type Stats = HashMap<String, Vec<(String, Option<u32>, Option<u32>)>>;

/// `parseGitCommitSection` + `mergeGitChangeStats`.
pub fn parse(name_status_log: &str, numstat_log: &str) -> Vec<CommitSummary> {
    let mut stats = Stats::new();
    for (fields, lines) in sections(numstat_log) {
        let rows = lines
            .iter()
            .filter_map(|line| {
                let mut parts = line.splitn(3, '\t');
                let (added, deleted, path) = (parts.next()?, parts.next()?, parts.next()?);
                let count = |v: &str| v.parse().ok();
                Some((numstat_path(path), count(added), count(deleted)))
            })
            .collect();
        stats.insert(fields[0].to_owned(), rows);
    }
    sections(name_status_log)
        .map(|(fields, lines)| {
            let field = |i: usize| fields.get(i).copied().unwrap_or_default();
            let mut changes: Vec<CommitChange> =
                lines.iter().filter_map(|l| name_status(l)).collect();
            let mut unused = stats.remove(field(0)).unwrap_or_default();
            for change in &mut changes {
                if let Some(at) = unused.iter().position(|(path, ..)| *path == change.path) {
                    let (_, added, deleted) = unused.remove(at);
                    change.additions = added;
                    change.deletions = deleted;
                }
            }
            changes.extend(
                unused
                    .into_iter()
                    .map(|(path, additions, deletions)| CommitChange {
                        path,
                        old_path: None,
                        status: Status::Changed,
                        additions,
                        deletions,
                    }),
            );
            let message = fields.get(5..).map(|m| m.join("\x1f")).unwrap_or_default();
            CommitSummary {
                id: field(0).to_owned(),
                parents: field(1)
                    .split(' ')
                    .filter(|p| !p.is_empty())
                    .map(str::to_owned)
                    .collect(),
                author_name: if field(2).is_empty() {
                    "Unknown".into()
                } else {
                    field(2).to_owned()
                },
                author_email: field(3).to_owned(),
                created_at: (!field(4).is_empty()).then(|| field(4).to_owned()),
                message: if message.is_empty() {
                    "(no message)".into()
                } else {
                    message
                },
                changes,
            }
        })
        .collect()
}

pub fn history(root: &Path, cancel: &AtomicBool) -> Result<History, String> {
    let limit = LIMIT.to_string();
    let base = [
        "log",
        "--topo-order",
        "-n",
        &limit,
        "--date=iso-strict-local",
        FORMAT,
    ];
    let run = |extra: &str| -> Result<String, String> {
        let mut args = base.to_vec();
        args.push(extra);
        git(root, &args, None, cancel).map(|out| String::from_utf8_lossy(&out).into_owned())
    };
    // An unborn branch has no history yet.
    let Ok(status) = run("--name-status") else {
        return Ok(History::default());
    };
    let numstat = run("--numstat").unwrap_or_default();
    let head = git(
        root,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        None,
        cancel,
    )
    .ok()
    .map(|out| String::from_utf8_lossy(&out).trim().to_owned())
    .filter(|h| !h.is_empty());
    Ok(History {
        commits: parse(&status, &numstat),
        head,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn logs_merge_like_read_git_history() {
        let status = "\x1eaaa\x1fp1 p2\x1fAda\x1fada@x\x1f2026-10-24T09:05:00+08:00\x1fClarify usage\nM\tREADME.md\nR100\told.txt\tnew.txt\nA\tsrc/util.ts\n\x1ebbb\x1f\x1f\x1f\x1f\x1f\n";
        let numstat = "\x1eaaa\x1f...\n1\t1\tREADME.md\n0\t0\t{old.txt => new.txt}\n4\t0\tsrc/util.ts\n-\t-\tassets/logo.png\n\x1ebbb\x1f\n";
        let commits = parse(status, numstat);
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
        assert_eq!(numstat_path("src/{a => b}/c.rs"), "src/b/c.rs");
        assert_eq!(numstat_path("{x => }/y"), "}/y");
        assert_eq!(numstat_path("a.txt => b.txt"), "b.txt");
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

//! Git CLI is the authority. Paths are NUL parsed and literal pathspecs; never shell strings.
use super::process;
use std::{
    path::{Component, Path},
    sync::atomic::AtomicBool,
    time::Duration,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub path: String,
    pub original: Option<String>,
    pub index: char,
    pub worktree: char,
}
impl Change {
    pub fn conflict(&self) -> bool {
        self.index == 'U'
            || self.worktree == 'U'
            || matches!((self.index, self.worktree), ('A', 'A') | ('D', 'D'))
    }
    pub fn staged(&self) -> bool {
        self.index != ' ' && self.index != '?' && !self.conflict()
    }
    pub fn unstaged(&self) -> bool {
        self.worktree != ' ' && self.index != '?' && !self.conflict()
    }
    pub fn untracked(&self) -> bool {
        self.index == '?'
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub head: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<Change>,
    pub truncated: bool,
}
pub fn parse_status(bytes: &[u8]) -> Result<Snapshot, String> {
    let mut result = Snapshot::default();
    let mut records = bytes.split(|b| *b == 0).filter(|x| !x.is_empty());
    while let Some(record) = records.next() {
        let text = std::str::from_utf8(record)
            .map_err(|_| crate::localization::t("native.git.nonUtf8Paths"))?;
        if let Some(header) = text.strip_prefix("## ") {
            let (branch, rest) = header.split_once("...").unwrap_or((header, ""));
            result.branch = branch
                .trim_start_matches("No commits yet on ")
                .trim_start_matches("Initial commit on ")
                .to_owned();
            if !rest.is_empty() {
                result.upstream = Some(rest.split(" [").next().unwrap().into());
            }
            if let Some((_, counts)) = rest.split_once('[') {
                for part in counts.trim_end_matches(']').split(", ") {
                    if let Some(n) = part.strip_prefix("ahead ") {
                        result.ahead = n.parse().unwrap_or(0);
                    }
                    if let Some(n) = part.strip_prefix("behind ") {
                        result.behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if record.len() < 4 {
            return Err("Malformed Git status record".into());
        }
        let index = record[0] as char;
        let worktree = record[1] as char;
        let original = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            Some(
                std::str::from_utf8(records.next().ok_or("Missing rename source")?)
                    .map_err(|_| "Invalid rename path")?
                    .to_owned(),
            )
        } else {
            None
        };
        if result.changes.len() == 10_000 {
            result.truncated = true;
        } else {
            result.changes.push(Change {
                path: text[3..].into(),
                original,
                index,
                worktree,
            });
        }
    }
    Ok(result)
}
pub(super) fn git(
    root: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let mut all = vec![
        "--literal-pathspecs",
        "-c",
        "color.ui=false",
        "-c",
        "core.quotepath=false",
        "-c",
        "core.pager=cat",
    ];
    all.extend(args);
    process::run(
        Path::new("/usr/bin/git"),
        &all,
        root,
        input,
        Duration::from_secs(
            if args.first() == Some(&"pull") || args.first() == Some(&"push") {
                120
            } else {
                60
            },
        ),
        cancel,
    )
}
pub fn status(root: &Path, cancel: &AtomicBool) -> Result<Snapshot, String> {
    verify_root(root, cancel)?;
    let mut snapshot = parse_status(&git(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--branch",
            "--untracked-files=all",
        ],
        None,
        cancel,
    )?)?;
    snapshot.head = git(root, &["rev-parse", "--verify", "HEAD"], None, cancel)
        .map(|b| String::from_utf8_lossy(&b).trim().to_owned())
        .unwrap_or_default();
    Ok(snapshot)
}
fn verify_root(root: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let top = git(root, &["rev-parse", "--show-toplevel"], None, cancel)?;
    let top = Path::new(
        std::str::from_utf8(&top)
            .map_err(|_| "Invalid repository path")?
            .trim_end_matches('\n'),
    )
    .canonicalize()
    .map_err(|e| e.to_string())?;
    if top != root.canonicalize().map_err(|e| e.to_string())? {
        return Err(crate::localization::tf(
            "native.git.subdirectory",
            &[("path", top.display().to_string().into())],
        ));
    }
    Ok(())
}
pub fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || Path::new(path).is_absolute()
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        Err(crate::localization::t("native.git.pathOutside").into())
    } else {
        Ok(())
    }
}
#[derive(Clone, Debug)]
pub enum Operation {
    Stage(Change),
    Unstage(Change),
    Discard(Change),
    /// An empty message commits with the product default
    /// (`normalizeCommitMessage` in `local-api/workspace.mjs`).
    Commit(String),
    /// "Stage and Commit": stage every local change, then commit.
    StageAndCommit,
    Pull,
    Push,
    Init,
}
pub fn operate(root: &Path, op: &Operation, cancel: &AtomicBool) -> Result<Snapshot, String> {
    if !matches!(op, Operation::Init) {
        verify_root(root, cancel)?;
    }
    let mut paths = Vec::new();
    if let Operation::Stage(c) | Operation::Unstage(c) | Operation::Discard(c) = op {
        validate_path(&c.path)?;
        paths.push(c.path.as_str());
        if let Some(old) = &c.original {
            validate_path(old)?;
            paths.push(old);
        }
    }
    let mut args = match op {
        Operation::Stage(_) => vec!["add", "--"],
        Operation::Unstage(_) => vec!["reset", "-q", "HEAD", "--"],
        Operation::Discard(c) => {
            if c.conflict() {
                return Err(crate::localization::t("native.git.discardTrackedOnly").into());
            }
            if c.untracked() {
                // `discardWorkspaceGitPaths`: an untracked path is removed.
                // `validate_path` admits only normal components, and a
                // symlink is removed itself, never followed.
                let target = root.join(&c.path);
                let meta = std::fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
                if meta.is_dir() {
                    std::fs::remove_dir_all(&target)
                } else {
                    std::fs::remove_file(&target)
                }
                .map_err(|e| e.to_string())?;
                return status(root, cancel);
            }
            vec!["restore", "--worktree", "--"]
        }
        Operation::Commit(_) => vec!["commit", "-F", "-"],
        Operation::StageAndCommit => {
            git(root, &["add", "--all", "--", "."], None, cancel)?;
            vec!["commit", "-F", "-"]
        }
        Operation::Pull => vec!["pull", "--ff-only"],
        Operation::Push => vec!["push"],
        Operation::Init => vec!["init"],
    };
    args.extend(paths);
    let message = match op {
        Operation::Commit(message) if !message.trim().is_empty() => Some(message.trim().to_owned()),
        Operation::Commit(_) | Operation::StageAndCommit => {
            Some(default_commit_message(root, cancel))
        }
        _ => None,
    };
    let input = message.as_deref().map(str::as_bytes);
    // An unborn branch has no HEAD: remove paths from the index without touching working files.
    if matches!(op, Operation::Unstage(_))
        && git(root, &["rev-parse", "--verify", "HEAD"], None, cancel).is_err()
    {
        args = vec!["rm", "--cached", "-r", "--ignore-unmatch", "--"];
        if let Operation::Unstage(c) = op {
            args.push(&c.path);
            if let Some(old) = &c.original {
                args.push(old);
            }
        }
    }
    git(root, &args, input, cancel)?;
    status(root, cancel)
}
/// `buildDefaultCommitMessage`: names the one staged file, counts several.
fn default_commit_message(root: &Path, cancel: &AtomicBool) -> String {
    let staged = git(
        root,
        &["diff", "--cached", "--name-only", "-z"],
        None,
        cancel,
    )
    .unwrap_or_default();
    let paths = staged
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .map(String::from_utf8_lossy)
        .collect::<Vec<_>>();
    match paths.as_slice() {
        [] => "Update workspace".into(),
        [one] => format!(
            "Update {}",
            Path::new(one.as_ref())
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| one.to_string())
        ),
        many => format!("Update {} files", many.len()),
    }
}
/// Repository facts for Settings → Git (`GitSettingsView`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RepositoryInfo {
    pub is_repo: bool,
    /// `None` on a detached HEAD.
    pub branch: Option<String>,
    pub local_branches: usize,
    pub remote_branches: usize,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub head: Option<String>,
    pub remotes: Vec<Remote>,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Remote {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
    pub branches: usize,
}
fn text(root: &Path, args: &[&str], cancel: &AtomicBool) -> Option<String> {
    git(root, args, None, cancel)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).trim().to_owned())
        .filter(|s| !s.is_empty())
}
pub fn repository_info(root: &Path, cancel: &AtomicBool) -> Result<RepositoryInfo, String> {
    if text(root, &["rev-parse", "--is-inside-work-tree"], cancel).as_deref() != Some("true") {
        return Ok(RepositoryInfo::default());
    }
    let mut info = RepositoryInfo {
        is_repo: true,
        branch: text(
            root,
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
            cancel,
        ),
        head: text(root, &["rev-parse", "--verify", "--quiet", "HEAD"], cancel),
        ..Default::default()
    };
    info.upstream = info.branch.as_ref().and_then(|_| {
        text(
            root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
            cancel,
        )
    });
    if info.upstream.is_some()
        && let Some(counts) = text(
            root,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            cancel,
        )
    {
        let mut parts = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
        info.ahead = parts.next().unwrap_or(0);
        info.behind = parts.next().unwrap_or(0);
    }
    let refs = text(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
        ],
        cancel,
    )
    .unwrap_or_default();
    let mut remote_refs = vec![];
    for name in refs.lines() {
        if name.starts_with("refs/heads/") {
            info.local_branches += 1;
        } else if let Some(rest) = name.strip_prefix("refs/remotes/")
            && !rest.ends_with("/HEAD")
        {
            info.remote_branches += 1;
            remote_refs.push(rest.to_owned());
        }
    }
    for line in text(root, &["remote", "-v"], cancel)
        .unwrap_or_default()
        .lines()
    {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(url), kind) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let index = match info.remotes.iter().position(|r| r.name == name) {
            Some(i) => i,
            None => {
                info.remotes.push(Remote {
                    name: name.into(),
                    branches: remote_refs
                        .iter()
                        .filter(|r| r.starts_with(&format!("{name}/")))
                        .count(),
                    ..Default::default()
                });
                info.remotes.len() - 1
            }
        };
        let remote = &mut info.remotes[index];
        if kind == Some("(push)") {
            remote.push_url = Some(url.into());
        } else {
            remote.fetch_url = Some(url.into());
        }
    }
    Ok(info)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nul_paths_renames_and_counts() {
        let s = parse_status(b"## main...origin/main [ahead 2, behind 3]\0R  new\nname\0old name\0 M file\0?? -flag\0UU conflict\0").unwrap();
        assert_eq!((s.ahead, s.behind), (2, 3));
        assert_eq!(s.changes.len(), 4);
        assert_eq!(s.changes[0].original.as_deref(), Some("old name"));
        assert!(s.changes[3].conflict());
        assert!(validate_path("../outside").is_err());
        assert!(validate_path("/tmp/file").is_err());
        assert!(validate_path("-flag").is_ok());
    }
    #[test]
    fn empty_commits_take_the_product_default_message() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let cancel = AtomicBool::new(false);
        operate(root, &Operation::Init, &cancel).unwrap();
        for (key, value) in [
            ("user.name", "GPUI Test"),
            ("user.email", "gpui@example.invalid"),
        ] {
            git(root, &["config", key, value], None, &cancel).unwrap();
        }
        let subject = |cancel: &AtomicBool| {
            String::from_utf8(git(root, &["log", "-1", "--format=%s"], None, cancel).unwrap())
                .unwrap()
                .trim()
                .to_owned()
        };
        std::fs::create_dir(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/a.md"), "a\n").unwrap();
        std::fs::write(root.join("b.md"), "b\n").unwrap();
        let s = operate(root, &Operation::StageAndCommit, &cancel).unwrap();
        assert!(s.changes.is_empty());
        assert_eq!(subject(&cancel), "Update 2 files");
        std::fs::write(root.join("docs/a.md"), "aa\n").unwrap();
        let s = status(root, &cancel).unwrap();
        operate(root, &Operation::Stage(s.changes[0].clone()), &cancel).unwrap();
        operate(root, &Operation::Commit("  ".into()), &cancel).unwrap();
        assert_eq!(subject(&cancel), "Update a.md");
        operate(root, &Operation::Commit(" Explicit ".into()), &cancel).unwrap_err();
        assert_eq!(subject(&cancel), "Update a.md");
    }
    #[test]
    fn real_repository_stage_commit_diff_and_unborn_unstage() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let cancel = AtomicBool::new(false);
        operate(root, &Operation::Init, &cancel).unwrap();
        git(root, &["config", "user.name", "GPUI Test"], None, &cancel).unwrap();
        git(
            root,
            &["config", "user.email", "gpui@example.invalid"],
            None,
            &cancel,
        )
        .unwrap();
        std::fs::write(root.join("a\n-b"), "one\n").unwrap();
        let s = status(root, &cancel).unwrap();
        let s = operate(root, &Operation::Stage(s.changes[0].clone()), &cancel).unwrap();
        assert!(s.changes[0].staged());
        let s = operate(root, &Operation::Unstage(s.changes[0].clone()), &cancel).unwrap();
        assert!(s.changes[0].untracked());
        operate(root, &Operation::Stage(s.changes[0].clone()), &cancel).unwrap();
        operate(root, &Operation::Commit("Initial".into()), &cancel).unwrap();
        std::fs::write(root.join("a\n-b"), "two\n").unwrap();
        let s = status(root, &cancel).unwrap();
        let files = super::super::git_diff::file_diff(
            root,
            &s.changes[0].path,
            None,
            super::super::git_diff::Scope::Unstaged,
            &cancel,
        )
        .unwrap();
        assert!(files[0].lines.iter().any(|l| l.text == "two"));
        assert_eq!(
            super::super::git_history::history(root, &cancel)
                .unwrap()
                .commits
                .len(),
            1
        );
        git(
            root,
            &["remote", "add", "origin", "https://github.com/a/b.git"],
            None,
            &cancel,
        )
        .unwrap();
        let info = repository_info(root, &cancel).unwrap();
        assert!(info.is_repo && info.head.is_some() && info.local_branches == 1);
        assert_eq!(info.remotes[0].name, "origin");
        assert_eq!(
            info.remotes[0].fetch_url.as_deref(),
            Some("https://github.com/a/b.git")
        );
        let plain = tempfile::tempdir().unwrap();
        assert!(!repository_info(plain.path(), &cancel).unwrap().is_repo);
        operate(root, &Operation::Discard(s.changes[0].clone()), &cancel).unwrap();
        assert!(status(root, &cancel).unwrap().changes.is_empty());
        // Discarding an untracked file removes it; a symlink goes, not its target.
        std::fs::write(root.join("scratch.txt"), "x").unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep.txt"), "keep").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), root.join("link")).unwrap();
        for change in status(root, &cancel).unwrap().changes {
            assert!(change.untracked());
            operate(root, &Operation::Discard(change), &cancel).unwrap();
        }
        assert!(!root.join("scratch.txt").exists());
        assert!(outside.path().join("keep.txt").exists());
        assert!(status(root, &cancel).unwrap().changes.is_empty());
    }
}

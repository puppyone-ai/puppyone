//! Git CLI is the authority. Paths are NUL parsed and literal pathspecs; never shell strings.
//!
//! Like the product (`getWorkspaceGitStatus`: `rev-parse --is-inside-work-tree`),
//! a folder anywhere inside a work tree is managed and its status is the whole
//! repository's, with repository-relative paths. Mutations and file reads stay
//! inside the opened folder: a change elsewhere in the repository is shown but
//! cannot be staged, discarded or opened from here.
#[cfg(test)]
#[path = "git/push_tests.rs"]
mod push_tests;
#[path = "git/sync_config.rs"]
mod sync_config;
use sync_config::binding;
pub mod coordinator;
pub mod runner;
pub mod sync_state;
use std::{
    path::{Component, Path},
    sync::atomic::AtomicBool,
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
    /// The opened folder within its repository (`rev-parse --show-prefix`):
    /// empty at the root, `docs/` for a subfolder.
    pub prefix: String,
    pub head: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<Change>,
    pub truncated: bool,
    /// Where the current branch synchronizes (`syncTarget`); `None` on a
    /// detached HEAD or with no remote to go to.
    pub target: Option<SyncTarget>,
    /// A merge, rebase, cherry-pick or revert waiting to be continued or
    /// aborted (`sourceControl.operation`).
    pub operation: Option<RepositoryOperation>,
    /// The configured remotes' names.
    pub remotes: Vec<String>,
    /// `.puppyone/config.json` turns Cloud backup on (`backup.enabled`).
    pub cloud_backup: bool,
    /// Presentation metadata is kept separately from the authorized target.
    pub sync_metadata: sync_state::Metadata,
}
/// `readGitRepositoryOperationKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepositoryOperation {
    Rebase,
    Merge,
    CherryPick,
    Revert,
}
impl RepositoryOperation {
    /// The Git command that continues or aborts it.
    pub fn command(self) -> &'static str {
        match self {
            Self::Rebase => "rebase",
            Self::Merge => "merge",
            Self::CherryPick => "cherry-pick",
            Self::Revert => "revert",
        }
    }
}
/// `readGitSyncTarget`: a remote branch and whether its remote-tracking ref
/// exists. Without `exists` the branch has not been published there yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncTarget {
    pub remote: String,
    pub branch: String,
    pub exists: bool,
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
    let kind = if matches!(args.first(), Some(&"pull" | &"push" | &"fetch")) {
        runner::Kind::Network
    } else {
        runner::Kind::Mutation
    };
    runner::execute(root, args, input, cancel, kind, runner::MAX_BUFFER)
}
pub(super) fn git_read(
    root: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    git_read_bounded(root, args, input, cancel, runner::MAX_BUFFER)
}
pub(super) fn git_read_bounded(
    root: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    cancel: &AtomicBool,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    runner::execute(root, args, input, cancel, runner::Kind::Read, max_bytes)
}
pub(super) fn clone_repository(root: &Path, url: &str, cancel: &AtomicBool) -> Result<(), String> {
    runner::execute(
        root,
        &["clone", "--progress", "--", url, "."],
        None,
        cancel,
        runner::Kind::Clone,
        runner::MAX_BUFFER,
    )
    .map(|_| ())
}
pub fn status(root: &Path, cancel: &AtomicBool) -> Result<Snapshot, String> {
    coordinator::wait_for_reads(root, cancel)?;
    status_owned(root, cancel)
}
fn status_owned(root: &Path, cancel: &AtomicBool) -> Result<Snapshot, String> {
    let prefix = prefix(root, cancel)?;
    let mut snapshot = parse_status(&git_read_bounded(
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
        runner::MAX_STREAM_BYTES,
    )?)?;
    snapshot.head = git_read(root, &["rev-parse", "--verify", "HEAD"], None, cancel)
        .map(|b| String::from_utf8_lossy(&b).trim().to_owned())
        .unwrap_or_default();
    snapshot.prefix = prefix;
    snapshot.operation = repository_operation(root, cancel);
    let remotes = remotes(root, cancel);
    let config = workspace_config(root);
    snapshot.target = sync_target(root, &snapshot, &remotes, config.as_ref(), cancel);
    snapshot.remotes = remotes.iter().map(|r| r.name.clone()).collect();
    snapshot.cloud_backup = config
        .as_ref()
        .and_then(|c| c.pointer("/backup/enabled"))
        .and_then(serde_json::Value::as_bool)
        == Some(true);
    // A branch that tracks nothing compares with the branch a first push
    // would create, once that exists (`readGitAheadBehindCounts`).
    if snapshot.upstream.is_none()
        && !snapshot.head.is_empty()
        && let Some(target) = snapshot.target.as_ref().filter(|t| t.exists)
    {
        let range = format!("HEAD...refs/remotes/{}/{}", target.remote, target.branch);
        if let Some(counts) = text(
            root,
            &["rev-list", "--left-right", "--count", &range],
            cancel,
        ) {
            let mut parts = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
            snapshot.ahead = parts.next().unwrap_or(0);
            snapshot.behind = parts.next().unwrap_or(0);
        }
    }
    snapshot.sync_metadata = sync_state::Metadata::from_git(&snapshot, &remotes, config);
    Ok(snapshot)
}
/// `readGitRepositoryOperationKind`: the first of the rebase directories and
/// the merge, cherry-pick and revert heads that exists.
fn repository_operation(root: &Path, cancel: &AtomicBool) -> Option<RepositoryOperation> {
    use RepositoryOperation::*;
    let candidates = [
        ("rebase-merge", Rebase),
        ("rebase-apply", Rebase),
        ("MERGE_HEAD", Merge),
        ("CHERRY_PICK_HEAD", CherryPick),
        ("REVERT_HEAD", Revert),
    ];
    let mut args = vec!["rev-parse"];
    for (name, _) in &candidates {
        args.extend(["--git-path", name]);
    }
    let out = text(root, &args, cancel)?;
    out.lines()
        .zip(candidates)
        .find(|(path, _)| root.join(path.trim()).exists())
        .map(|(_, (_, kind))| kind)
}
fn sync_target(
    root: &Path,
    snapshot: &Snapshot,
    remotes: &[Remote],
    config: Option<&serde_json::Value>,
    cancel: &AtomicBool,
) -> Option<SyncTarget> {
    let (remote, branch) = choose_target(
        remotes,
        snapshot.current_branch(),
        snapshot.upstream.as_deref(),
        config.and_then(configured_remote).as_deref(),
    )?;
    let exists = text(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/remotes/{remote}/{branch}"),
        ],
        cancel,
    )
    .is_some();
    Some(SyncTarget {
        remote,
        branch,
        exists,
    })
}
/// `chooseGitSyncTarget`: the upstream (remote names may hold slashes, so
/// the longest matching name wins, and a removed one is not replaced), else
/// the configured remote, else the Cloud remote, `origin` or the first one,
/// under the branch's own name. A detached HEAD has none.
fn choose_target(
    remotes: &[Remote],
    branch: Option<&str>,
    upstream: Option<&str>,
    configured: Option<&str>,
) -> Option<(String, String)> {
    let branch = branch?;
    if let Some(upstream) = upstream {
        return remotes
            .iter()
            .filter(|r| {
                upstream
                    .strip_prefix(r.name.as_str())
                    .is_some_and(|rest| rest.starts_with('/'))
            })
            .max_by_key(|r| r.name.len())
            .map(|r| (r.name.clone(), upstream[r.name.len() + 1..].to_owned()));
    }
    if let Some(configured) = configured {
        return remotes
            .iter()
            .any(|r| r.name == configured)
            .then(|| (configured.to_owned(), branch.to_owned()));
    }
    default_remote(remotes).map(|r| (r.name.clone(), branch.to_owned()))
}
/// `choosePuppyoneRemoteName ?? origin ?? remotes[0]`: a remote whose URL
/// is a Puppyone Cloud locator, else one named `puppyone`.
fn default_remote(remotes: &[Remote]) -> Option<&Remote> {
    let cloud = |r: &&Remote| {
        [&r.fetch_url, &r.push_url]
            .into_iter()
            .any(|url| url.as_deref().is_some_and(cloud_locator))
    };
    remotes
        .iter()
        .find(cloud)
        .or_else(|| {
            remotes
                .iter()
                .find(|r| r.name.eq_ignore_ascii_case("puppyone"))
        })
        .or_else(|| remotes.iter().find(|r| r.name == "origin"))
        .or(remotes.first())
}
/// `parsePuppyoneRemoteInfo(url) !== null` (`workspace::cloud::locator`,
/// which this crate cannot reach): a credential-free http(s) URL whose path
/// is `/git/ap/<key>.git`, `/git/<project>.git` or
/// `/git/<project>/scopes/<scope>.git`.
fn cloud_locator(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw.trim()) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none_or(str::is_empty)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let id = |s: &str| {
        let b = s.as_bytes();
        !b.is_empty()
            && b.len() <= 200
            && b[0].is_ascii_alphanumeric()
            && b.iter()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
    };
    let Some(body) = url
        .path()
        .strip_prefix("/git/")
        .and_then(|p| p.strip_suffix(".git"))
    else {
        return false;
    };
    match body.split('/').collect::<Vec<_>>().as_slice() {
        ["ap", key] => !key.is_empty(),
        [project] => id(project),
        [project, "scopes", scope] => id(project) && id(scope),
        _ => false,
    }
}
/// The workspace's `.puppyone/config.json` (`readPuppyoneWorkspaceConfig`).
fn workspace_config(root: &Path) -> Option<serde_json::Value> {
    serde_json::from_slice(&std::fs::read(root.join(".puppyone/config.json")).ok()?).ok()
}
/// The workspace's chosen remote
/// (`sync.sourceOfTruth.remote ?? git.primaryRemote ?? backup.remote`).
fn configured_remote(config: &serde_json::Value) -> Option<String> {
    [
        "/sync/sourceOfTruth/remote",
        "/git/primaryRemote",
        "/backup/remote",
    ]
    .into_iter()
    .find_map(|pointer| {
        config
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
    })
}
/// The opened folder's place in its repository; an error outside a work tree.
pub fn prefix(root: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let out = git_read(root, &["rev-parse", "--show-prefix"], None, cancel)?;
    let prefix = std::str::from_utf8(&out)
        .map_err(|_| crate::localization::t("native.git.nonUtf8Paths"))?
        .trim_end_matches('\n')
        .to_owned();
    Ok(prefix)
}
/// A repository-relative path as a path under the opened folder (`prefix`),
/// or `None` when it lies elsewhere in the repository.
pub fn local<'a>(prefix: &str, path: &'a str) -> Option<&'a str> {
    path.strip_prefix(prefix).filter(|p| !p.is_empty())
}
impl Snapshot {
    /// The checked-out branch; `None` on a detached HEAD.
    pub fn current_branch(&self) -> Option<&str> {
        Some(self.branch.as_str()).filter(|b| !b.is_empty() && *b != "HEAD (no branch)")
    }
    /// `remote.canPublish`: a branch with a commit whose sync target does not
    /// exist yet (`publishWorkspaceGitBranch` creates and tracks it).
    pub fn can_publish(&self) -> bool {
        self.operation.is_none()
            && self.current_branch().is_some()
            && !self.head.is_empty()
            && self.target.as_ref().is_some_and(|t| !t.exists)
    }
    /// `remote.canPush`: commits to send and none to receive first.
    pub fn can_push(&self) -> bool {
        self.operation.is_none() && self.remote_exists() && self.ahead > 0 && self.behind == 0
    }
    /// `GitSyncState.setupRequired` for a repository: a branch that tracks
    /// nothing, with no remote and no Cloud backup configured.
    pub fn setup_required(&self) -> bool {
        self.upstream.is_none() && self.remotes.is_empty() && !self.cloud_backup
    }
    /// The sync target exists: incoming and outgoing commits are counted.
    pub fn remote_exists(&self) -> bool {
        self.target.as_ref().is_some_and(|t| t.exists)
    }
    /// Whether the change lies inside the opened folder (it, and a rename's
    /// source, can be acted on here).
    pub fn owns(&self, change: &Change) -> bool {
        local(&self.prefix, &change.path).is_some()
            && change
                .original
                .as_deref()
                .is_none_or(|o| local(&self.prefix, o).is_some())
    }
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
    /// (`normalizeCommitMessage` in `electron/local-api/workspace.mjs`).
    Commit(String),
    /// "Stage and Commit": stage every local change, then commit.
    StageAndCommit,
    Pull,
    Push,
    /// `publishWorkspaceGitBranch`: push the branch to its sync target and
    /// track it.
    Publish,
    /// `continueWorkspaceGitOperation`: once every conflict is resolved and
    /// staged.
    Continue,
    /// `abortWorkspaceGitOperation`: back to the state before it began.
    Abort,
    Init,
}
impl Operation {
    /// The product's operation label (`runGitOperation(label, …)`).
    pub fn label(&self) -> &'static str {
        match self {
            Self::Stage(_) => "stage",
            Self::Unstage(_) => "unstage",
            Self::Discard(_) => "discard",
            Self::Commit(_) => "commit",
            Self::StageAndCommit => "stage-commit",
            Self::Pull => "pull",
            Self::Push => "push",
            Self::Publish => "publish",
            Self::Continue => "continue",
            Self::Abort => "abort",
            Self::Init => "init",
        }
    }
}
pub fn operate(root: &Path, op: &Operation, cancel: &AtomicBool) -> Result<Snapshot, String> {
    let domains = if matches!(op, Operation::Init) {
        coordinator::Domains::resolve(root, cancel)
            .or_else(|_| coordinator::Domains::uninitialized(root))?
    } else {
        coordinator::Domains::resolve(root, cancel)?
    };
    let keys = match op {
        Operation::Stage(_) | Operation::Unstage(_) | Operation::Discard(_) => {
            vec![domains.worktree]
        }
        Operation::Push | Operation::Publish => vec![domains.repository],
        _ => domains.both().to_vec(),
    };
    let _ownership = coordinator::GLOBAL.acquire(&keys, cancel)?;
    operate_owned(root, op, cancel)
}
fn operate_owned(root: &Path, op: &Operation, cancel: &AtomicBool) -> Result<Snapshot, String> {
    let prefix = if matches!(op, Operation::Init) {
        String::new()
    } else {
        prefix(root, cancel)?
    };
    // Pathspecs are relative to the opened folder (the working directory);
    // a change elsewhere in the repository is refused.
    let outside = || crate::localization::t("native.git.pathOutside").to_owned();
    let mut paths = Vec::new();
    if let Operation::Stage(c) | Operation::Unstage(c) | Operation::Discard(c) = op {
        validate_path(&c.path)?;
        paths.push(local(&prefix, &c.path).ok_or_else(outside)?);
        if let Some(old) = &c.original {
            validate_path(old)?;
            paths.push(local(&prefix, old).ok_or_else(outside)?);
        }
    }
    if matches!(op, Operation::Pull | Operation::Push | Operation::Publish) {
        return synchronize(root, op, cancel);
    }
    if matches!(op, Operation::Continue | Operation::Abort) {
        return resolve_operation(root, op, cancel);
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
                let target = root.join(paths[0]);
                let meta = std::fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
                if meta.is_dir() {
                    std::fs::remove_dir_all(&target)
                } else {
                    std::fs::remove_file(&target)
                }
                .map_err(|e| e.to_string())?;
                return status_owned(root, cancel);
            }
            vec!["restore", "--worktree", "--"]
        }
        Operation::Commit(_) => vec!["commit", "-F", "-"],
        Operation::StageAndCommit => {
            git(root, &["add", "--all", "--", "."], None, cancel)?;
            vec!["commit", "-F", "-"]
        }
        Operation::Pull
        | Operation::Push
        | Operation::Publish
        | Operation::Continue
        | Operation::Abort => unreachable!(),
        Operation::Init => vec!["init"],
    };
    args.extend(paths.iter().copied());
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
        && git_read(root, &["rev-parse", "--verify", "HEAD"], None, cancel).is_err()
    {
        args = vec!["rm", "--cached", "-r", "--ignore-unmatch", "--"];
        args.extend(paths.iter().copied());
    }
    git(root, &args, input, cancel)?;
    status_owned(root, cancel)
}
/// Pull, Push and Publish (`pullWorkspaceGit`, `pushWorkspaceGit`,
/// `publishWorkspaceGitBranch`): refused while conflicts remain.
fn synchronize(root: &Path, op: &Operation, cancel: &AtomicBool) -> Result<Snapshot, String> {
    let current = status_owned(root, cancel)?;
    // `assertNoInProgressGitOperation`.
    if let Some(operation) = current.operation {
        return Err(format!(
            "Unable to {} changes while {} is in progress. Resolve and continue it, or abort it first.",
            op.label(),
            operation.command()
        ));
    }
    if current.changes.iter().any(Change::conflict) {
        return Err(format!(
            "Unable to {} changes while unresolved file conflicts remain. Resolve and stage them first.",
            op.label()
        ));
    }
    match op {
        // A branch that tracks nothing pulls its sync target by name.
        Operation::Pull => {
            let args = sync_config::pull_args(root, cancel)?;
            let args: Vec<_> = args.iter().map(String::as_str).collect();
            git(root, &args, None, cancel).map_err(|e| format!("Unable to pull changes: {e}"))?;
        }
        // Hosted projects send the captured commit to the branch's binding,
        // even when local/upstream names differ. Hosting does not select main.
        Operation::Push
            if remotes(root, cancel).iter().any(|remote| {
                remote.name.eq_ignore_ascii_case("puppyone")
                    || [&remote.fetch_url, &remote.push_url]
                        .into_iter()
                        .any(|url| url.as_deref().is_some_and(cloud_locator))
            }) =>
        {
            publish(root, cancel)?;
        }
        // `isMissingUpstreamError`: a first generic push publishes the branch.
        Operation::Push => match git(root, &["push"], None, cancel) {
            Err(e) if missing_upstream(&e) => publish(root, cancel)?,
            other => drop(other.map_err(|e| format!("Unable to push changes: {e}"))?),
        },
        _ => publish(root, cancel)?,
    }
    status_owned(root, cancel)
}
/// Continue (`-c core.editor=true <kind> --continue`, keeping Git's own
/// message) or abort the operation in progress.
fn resolve_operation(root: &Path, op: &Operation, cancel: &AtomicBool) -> Result<Snapshot, String> {
    let current = status_owned(root, cancel)?;
    let verb = op.label();
    let Some(operation) = current.operation else {
        return Err(format!(
            "Unable to {verb} Git operation: no merge, rebase, cherry-pick, or revert is in progress."
        ));
    };
    let kind = operation.command();
    let args = if matches!(op, Operation::Continue) {
        if current.changes.iter().any(Change::conflict) {
            return Err(
                "Unable to continue Git operation: resolve and stage all conflicted files first."
                    .into(),
            );
        }
        vec!["-c", "core.editor=true", kind, "--continue"]
    } else {
        vec![kind, "--abort"]
    };
    git(root, &args, None, cancel).map_err(|e| format!("Unable to {verb} {kind}: {e}"))?;
    status_owned(root, cancel)
}
fn missing_upstream(message: &str) -> bool {
    let message = message.to_lowercase();
    [
        "no upstream branch",
        "has no upstream branch",
        "--set-upstream",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}
/// `pushWorkspaceGitWithDefaultUpstream`: push the branch's commit (the
/// object, not a moving HEAD; never forced) to the default remote, then make
/// it the upstream if the branch had none and is still where it was.
fn publish(root: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let before = binding(root, cancel)?;
    let remote = push_remote(
        root,
        before.push_remote.as_deref().or(before.remote.as_deref()),
        cancel,
    )?;
    let target = match &before.destination {
        Some(destination) if before.remote.as_deref() == Some(remote.as_str()) => destination,
        _ => &before.branch,
    }
    .clone();
    let head = text(
        root,
        &[
            "rev-parse",
            "--verify",
            &format!("refs/heads/{}^{{commit}}", before.branch),
        ],
        cancel,
    )
    .ok_or("Unable to synchronize changes: the branch has no commit.")?;
    git(
        root,
        &["push", &remote, &format!("{head}:refs/heads/{target}")],
        None,
        cancel,
    )
    .map_err(|e| format!("Unable to push changes: {e}"))?;
    if before.remote.is_none() {
        let after = binding(root, cancel)?;
        let after_head = text(root, &["rev-parse", "--verify", "HEAD"], cancel);
        if after.branch != before.branch
            || after_head.as_deref() != Some(&head)
            || after.remote.is_some()
        {
            return Err("Push completed for the captured commit, but local branch state changed; upstream was not replaced.".into());
        }
        git(
            root,
            &[
                "branch",
                &format!("--set-upstream-to={remote}/{target}"),
                &before.branch,
            ],
            None,
            cancel,
        )?;
    }
    Ok(())
}
/// `chooseDefaultPushRemote`: the requested remote if it exists, else the
/// configured one, else the Cloud remote, `origin` or the first.
fn push_remote(
    root: &Path,
    requested: Option<&str>,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let remotes = remotes(root, cancel);
    let has = |name: &str| remotes.iter().any(|r| r.name == name);
    if let Some(requested) = requested {
        if requested.starts_with('-') {
            return Err("Remote name is invalid.".into());
        }
        return if has(requested) {
            Ok(requested.to_owned())
        } else {
            Err(format!(
                "Unable to synchronize changes: remote '{requested}' is not configured."
            ))
        };
    }
    if let Some(preferred) = workspace_config(root).as_ref().and_then(configured_remote) {
        return if has(&preferred) {
            Ok(preferred)
        } else {
            Err(format!(
                "Unable to push changes: remote '{preferred}' is not configured."
            ))
        };
    }
    default_remote(&remotes)
        .map(|r| r.name.clone())
        .ok_or_else(|| "Unable to push changes: no Git remote is configured.".into())
}
/// `fetchWorkspaceGit`: refresh `remote`'s tracking refs (`--prune`); the
/// working tree and the index are untouched.
pub fn fetch(root: &Path, remote: &str, cancel: &AtomicBool) -> Result<(), String> {
    let domains = coordinator::Domains::resolve(root, cancel)?;
    let _ownership = coordinator::GLOBAL.acquire(&[domains.repository], cancel)?;
    if remote.is_empty() || remote.starts_with('-') {
        return Err(crate::localization::t("native.git.pathOutside").into());
    }
    git(root, &["fetch", "--prune", "--quiet", remote], None, cancel)?;
    // Status publication belongs to the caller's single-flight refresh queue.
    // A second read here could finish after a mutation and overwrite it.
    Ok(())
}
/// `buildDefaultCommitMessage`: names the one staged file, counts several.
fn default_commit_message(root: &Path, cancel: &AtomicBool) -> String {
    let staged = git_read(
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
    git_read(root, args, None, cancel)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).trim().to_owned())
        .filter(|s| !s.is_empty())
}
/// `readGitRemotes`: each remote with its fetch and push URLs (`remote -v`).
fn remotes(root: &Path, cancel: &AtomicBool) -> Vec<Remote> {
    let mut remotes: Vec<Remote> = vec![];
    for line in text(root, &["remote", "-v"], cancel)
        .unwrap_or_default()
        .lines()
    {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(url), kind) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let index = match remotes.iter().position(|r| r.name == name) {
            Some(i) => i,
            None => {
                remotes.push(Remote {
                    name: name.into(),
                    ..Default::default()
                });
                remotes.len() - 1
            }
        };
        let remote = &mut remotes[index];
        if kind == Some("(push)") {
            remote.push_url = Some(url.into());
        } else {
            remote.fetch_url = Some(url.into());
        }
    }
    remotes
}
pub fn repository_info(root: &Path, cancel: &AtomicBool) -> Result<RepositoryInfo, String> {
    coordinator::wait_for_reads(root, cancel)?;
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
    info.remotes = remotes(root, cancel);
    for remote in &mut info.remotes {
        let prefix = format!("{}/", remote.name);
        remote.branches = remote_refs
            .iter()
            .filter(|r| r.starts_with(&prefix))
            .count();
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
    /// `gitSyncTarget.test.mjs`.
    #[test]
    fn the_sync_target_is_the_upstream_else_a_first_push_under_the_branch_name() {
        let remote = |name: &str| Remote {
            name: name.into(),
            ..Default::default()
        };
        let remotes = [remote("origin"), remote("puppyone")];
        let pick = |remotes: &[Remote], branch, upstream, configured| {
            choose_target(remotes, branch, upstream, configured)
        };
        let pair = |r: &str, b: &str| Some((r.to_owned(), b.to_owned()));
        for upstream in ["puppyone/topic", "origin/release", "puppyone/main"] {
            let (r, b) = upstream.split_once('/').unwrap();
            assert_eq!(
                pick(
                    &remotes,
                    Some("feature/private"),
                    Some(upstream),
                    Some("puppyone")
                ),
                pair(r, b)
            );
        }
        // A new branch is published under its own name, configured or not.
        for configured in [Some("puppyone"), None] {
            assert_eq!(
                pick(&remotes, Some("feature/private"), None, configured),
                pair("puppyone", "feature/private")
            );
        }
        // Detached: no guessed destination; a removed upstream is not
        // redirected; a configured remote that is gone is not replaced.
        assert_eq!(pick(&remotes, None, None, Some("puppyone")), None);
        assert_eq!(pick(&remotes, Some("f"), Some("removed/topic"), None), None);
        assert_eq!(pick(&remotes, Some("f"), None, Some("missing")), None);
        let mut slashed = remotes.to_vec();
        slashed.push(remote("team/cloud"));
        assert_eq!(
            pick(&slashed, Some("f"), Some("team/cloud/release/one"), None),
            pair("team/cloud", "release/one")
        );
        // Without a Cloud remote, `origin`, else the first; none without remotes.
        assert_eq!(
            pick(&[remote("other"), remote("origin")], Some("f"), None, None),
            pair("origin", "f")
        );
        assert_eq!(
            pick(&[remote("other"), remote("second")], Some("f"), None, None),
            pair("other", "f")
        );
        assert_eq!(pick(&[], Some("f"), None, None), None);
        let cloud = Remote {
            fetch_url: Some("https://example.com/git/project.git".into()),
            ..remote("backup")
        };
        assert_eq!(
            pick(&[remote("origin"), cloud], Some("f"), None, None),
            pair("backup", "f")
        );
        for url in [
            "https://example.com/git/project.git",
            "https://example.com/git/project/scopes/docs.git",
            "https://example.com/git/ap/key.git",
        ] {
            assert!(cloud_locator(url), "{url}");
        }
        for url in [
            "https://user@example.com/git/project.git",
            "https://example.com/git/project.git?token=x",
            "ssh://example.com/git/project.git",
            "https://example.com/repo.git",
            "/tmp/cloud.git",
        ] {
            assert!(!cloud_locator(url), "{url}");
        }
    }
    /// `workspace.branch-target.integration.test.mjs`, against local bare
    /// repositories.
    #[test]
    fn publishing_a_new_branch_pushes_its_commit_and_tracks_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("work");
        let cancel = AtomicBool::new(false);
        let run = |cwd: &Path, args: &[&str]| {
            String::from_utf8(git(cwd, args, None, &cancel).unwrap())
                .unwrap()
                .trim()
                .to_owned()
        };
        run(dir.path(), &["init", "-q", "-b", "main", "work"]);
        for bare in ["origin.git", "cloud.git"] {
            run(dir.path(), &["init", "-q", "--bare", "-b", "main", bare]);
        }
        for (k, v) in [
            ("user.name", "Branch fixture"),
            ("user.email", "fixture@example.invalid"),
            ("commit.gpgsign", "false"),
        ] {
            run(&root, &["config", k, v]);
        }
        let origin = dir.path().join("origin.git");
        let cloud = dir.path().join("cloud.git");
        run(
            &root,
            &["remote", "add", "origin", origin.to_str().unwrap()],
        );
        run(
            &root,
            &["remote", "add", "puppyone", cloud.to_str().unwrap()],
        );
        std::fs::write(root.join("base.txt"), "base\n").unwrap();
        run(&root, &["add", "--", "base.txt"]);
        run(&root, &["commit", "-q", "-m", "base"]);
        let initial = run(&root, &["rev-parse", "HEAD"]);
        for remote in ["origin", "puppyone"] {
            run(&root, &["push", "-q", remote, "main"]);
        }
        // A new branch with a commit and an untracked private file.
        run(&root, &["switch", "-q", "-c", "feature/new"]);
        std::fs::write(root.join("feature.txt"), "feature\n").unwrap();
        run(&root, &["add", "--", "feature.txt"]);
        run(&root, &["commit", "-q", "-m", "feature"]);
        let head = run(&root, &["rev-parse", "HEAD"]);
        std::fs::write(root.join("private.txt"), "not uploaded\n").unwrap();
        let s = status(&root, &cancel).unwrap();
        assert_eq!(
            s.target,
            Some(SyncTarget {
                remote: "puppyone".into(),
                branch: "feature/new".into(),
                exists: false,
            })
        );
        assert!(s.can_publish() && !s.can_push());
        let s = operate(&root, &Operation::Publish, &cancel).unwrap();
        assert_eq!(run(&cloud, &["rev-parse", "refs/heads/feature/new"]), head);
        assert_eq!(run(&cloud, &["rev-parse", "refs/heads/main"]), initial);
        assert_eq!(run(&origin, &["rev-parse", "refs/heads/main"]), initial);
        assert_eq!(
            run(&root, &["rev-parse", "--abbrev-ref", "@{u}"]),
            "puppyone/feature/new"
        );
        assert!(!run(&cloud, &["ls-tree", "-r", "--name-only", "feature/new"]).contains("private"));
        assert!(s.remote_exists() && !s.can_publish());
        assert!(
            s.changes
                .iter()
                .any(|c| c.path == "private.txt" && c.untracked())
        );
        // Push on a branch that tracks nothing publishes it too.
        run(&root, &["switch", "-q", "-c", "second"]);
        std::fs::write(root.join("second.txt"), "second\n").unwrap();
        run(&root, &["add", "--", "second.txt"]);
        run(&root, &["commit", "-q", "-m", "second"]);
        let s = operate(&root, &Operation::Push, &cancel).unwrap();
        assert_eq!(
            run(&root, &["rev-parse", "--abbrev-ref", "@{u}"]),
            "puppyone/second"
        );
        assert!(s.remote_exists() && s.ahead == 0);
        // A branch whose same-named remote branch exists counts against it.
        run(&root, &["branch", "--unset-upstream"]);
        std::fs::write(root.join("third.txt"), "third\n").unwrap();
        run(&root, &["add", "--", "third.txt"]);
        run(&root, &["commit", "-q", "-m", "third"]);
        let s = status(&root, &cancel).unwrap();
        assert!(s.upstream.is_none() && s.remote_exists() && s.can_push());
        assert_eq!((s.ahead, s.behind), (1, 0));
        // Detached: nowhere to go.
        run(&root, &["switch", "-q", "--detach"]);
        let s = status(&root, &cancel).unwrap();
        assert!(s.current_branch().is_none() && s.target.is_none() && !s.can_publish());
        assert!(operate(&root, &Operation::Publish, &cancel).is_err());
    }
    #[test]
    fn a_conflicted_merge_continues_once_resolved_or_aborts() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let cancel = AtomicBool::new(false);
        let run = |args: &[&str]| git(root, args, None, &cancel);
        run(&["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "Merge fixture"),
            ("user.email", "fixture@example.invalid"),
            ("commit.gpgsign", "false"),
        ] {
            run(&["config", k, v]).unwrap();
        }
        let commit = |content: &str, message: &str| {
            std::fs::write(root.join("a.md"), content).unwrap();
            run(&["commit", "-q", "-am", message]).unwrap();
        };
        std::fs::write(root.join("a.md"), "base\n").unwrap();
        run(&["add", "a.md"]).unwrap();
        run(&["commit", "-q", "-m", "base"]).unwrap();
        run(&["switch", "-q", "-c", "other"]).unwrap();
        commit("theirs\n", "theirs");
        run(&["switch", "-q", "main"]).unwrap();
        commit("ours\n", "ours");
        let merged = |cancel: &AtomicBool| {
            assert!(git(root, &["merge", "other"], None, cancel).is_err());
            status(root, cancel).unwrap()
        };
        let s = merged(&cancel);
        assert_eq!(s.operation, Some(RepositoryOperation::Merge));
        assert!(s.changes[0].conflict());
        // Nothing else runs while it is in progress.
        let refused = operate(root, &Operation::Continue, &cancel).unwrap_err();
        assert!(refused.contains("resolve and stage"), "{refused}");
        let refused = operate(root, &Operation::Pull, &cancel).unwrap_err();
        assert!(refused.contains("while merge is in progress"), "{refused}");
        // Abort restores the branch.
        let s = operate(root, &Operation::Abort, &cancel).unwrap();
        assert_eq!(s.operation, None);
        assert!(s.changes.is_empty());
        assert_eq!(
            std::fs::read_to_string(root.join("a.md")).unwrap(),
            "ours\n"
        );
        // Resolved and staged, Continue commits the merge without an editor.
        merged(&cancel);
        std::fs::write(root.join("a.md"), "both\n").unwrap();
        run(&["add", "a.md"]).unwrap();
        let s = operate(root, &Operation::Continue, &cancel).unwrap();
        assert_eq!(s.operation, None);
        let parents =
            String::from_utf8(run(&["show", "-s", "--format=%P", "HEAD"]).unwrap()).unwrap();
        assert_eq!(parents.split_whitespace().count(), 2);
        let none = operate(root, &Operation::Abort, &cancel).unwrap_err();
        assert!(none.contains("no merge, rebase"), "{none}");
        // A stopped rebase is recognised too.
        run(&["switch", "-q", "other"]).unwrap();
        commit("again\n", "again");
        assert!(run(&["rebase", "main"]).is_err());
        assert_eq!(
            status(root, &cancel).unwrap().operation,
            Some(RepositoryOperation::Rebase)
        );
        assert_eq!(
            operate(root, &Operation::Abort, &cancel).unwrap().operation,
            None
        );
    }
    #[test]
    fn a_repository_without_remotes_needs_a_place_to_go() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let cancel = AtomicBool::new(false);
        operate(root, &Operation::Init, &cancel).unwrap();
        let s = status(root, &cancel).unwrap();
        assert!(s.remotes.is_empty() && s.setup_required());
        // Cloud backup configured: the product's own setup takes over.
        std::fs::create_dir(root.join(".puppyone")).unwrap();
        std::fs::write(
            root.join(".puppyone/config.json"),
            r#"{"version":3,"backup":{"enabled":true}}"#,
        )
        .unwrap();
        assert!(!status(root, &cancel).unwrap().setup_required());
        std::fs::remove_dir_all(root.join(".puppyone")).unwrap();
        git(
            root,
            &["remote", "add", "origin", "/tmp/x.git"],
            None,
            &cancel,
        )
        .unwrap();
        let s = status(root, &cancel).unwrap();
        assert_eq!(s.remotes, ["origin"]);
        assert!(!s.setup_required());
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
    fn a_subfolder_lists_its_repository_and_acts_only_inside_itself() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let cancel = AtomicBool::new(false);
        operate(root, &Operation::Init, &cancel).unwrap();
        for (k, v) in [
            ("user.name", "GPUI Test"),
            ("user.email", "gpui@example.invalid"),
        ] {
            git(root, &["config", k, v], None, &cancel).unwrap();
        }
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("top.md"), "a\n").unwrap();
        std::fs::write(root.join("sub/in.md"), "b\n").unwrap();
        git(root, &["add", "--all"], None, &cancel).unwrap();
        operate(root, &Operation::Commit("Initial".into()), &cancel).unwrap();
        std::fs::write(root.join("top.md"), "a2\n").unwrap();
        std::fs::write(root.join("sub/in.md"), "b2\n").unwrap();
        std::fs::write(root.join("sub/new.md"), "n\n").unwrap();
        let sub = root.join("sub");
        // The product's scope: the whole repository, repository-relative paths.
        let s = status(&sub, &cancel).unwrap();
        assert_eq!(s.prefix, "sub/");
        let mut paths: Vec<&str> = s.changes.iter().map(|c| c.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, ["sub/in.md", "sub/new.md", "top.md"]);
        let find = |s: &Snapshot, p: &str| s.changes.iter().find(|c| c.path == p).unwrap().clone();
        let top = find(&s, "top.md");
        assert!(!s.owns(&top));
        assert!(operate(&sub, &Operation::Stage(top.clone()), &cancel).is_err());
        assert!(operate(&sub, &Operation::Discard(top), &cancel).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("top.md")).unwrap(),
            "a2\n"
        );
        // Inside the folder, pathspecs and files map to the folder.
        let inside = find(&s, "sub/in.md");
        assert!(s.owns(&inside));
        let s = operate(&sub, &Operation::Stage(inside), &cancel).unwrap();
        assert!(find(&s, "sub/in.md").staged());
        let staged = super::super::git_diff::file_diff(
            &sub,
            &s.prefix,
            "sub/in.md",
            None,
            super::super::git_diff::Scope::Staged,
            &cancel,
        )
        .unwrap();
        assert!(staged[0].lines.iter().any(|l| l.text == "b2"));
        assert_eq!(staged[0].path, "sub/in.md");
        let untracked = super::super::git_diff::file_diff(
            &sub,
            &s.prefix,
            "sub/new.md",
            None,
            super::super::git_diff::Scope::Untracked,
            &cancel,
        )
        .unwrap();
        assert_eq!(untracked[0].lines[0].text, "n");
        operate(&sub, &Operation::Discard(find(&s, "sub/new.md")), &cancel).unwrap();
        assert!(!root.join("sub/new.md").exists());
        let s = operate(&sub, &Operation::Commit(String::new()), &cancel).unwrap();
        assert_eq!(
            s.changes
                .iter()
                .map(|c| c.path.as_str())
                .collect::<Vec<_>>(),
            ["top.md"]
        );
        assert_eq!(local("sub/", "sub/a/b.md"), Some("a/b.md"));
        assert_eq!(local("sub/", "sub/"), None);
        assert_eq!(local("sub/", "other/a.md"), None);
        assert_eq!(local("", "a.md"), Some("a.md"));
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
            "",
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

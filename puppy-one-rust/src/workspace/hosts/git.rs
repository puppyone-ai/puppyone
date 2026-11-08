//! Named Git operations in a shared folder (`host-git-service.mjs`), for
//! the owner's other computers' Changes panel. The client never sends a
//! command line: each operation is a fixed Git invocation, run one at a time
//! per folder. Hooks, filters and repository config can run code, so Git is
//! execution like a terminal: under the folder tier it runs in the sandbox
//! ([`SandboxedGit`]). Results are JSON in the shape the TypeScript host
//! gives (`getWorkspaceGitStatus`), so either side can be either app.
use super::{exec::FolderSandbox, protocol::relative_path};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// One named operation (`{op, paths?, path?, scope?, commit?, message?}`).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitRequest {
    pub op: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
/// The reads; everything else changes the repository and is never replayed.
pub const READS: [&str; 4] = ["status", "graph", "commit_detail", "file_diff"];
impl GitRequest {
    pub fn reads(&self) -> bool {
        READS.contains(&self.op.as_str())
    }
}
const MAX_PATHS: usize = 1000;

/// Runs `git` for a folder under this computer's policy.
pub trait Git: Send + Sync {
    fn git(&self, root: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String>;
}
/// The folder tier's Git: the system's own `git`, inside the folder sandbox.
pub struct SandboxedGit(pub Arc<FolderSandbox>);
impl Git for SandboxedGit {
    fn git(&self, root: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
        let prepared = self
            .0
            .prepare_program("git", args.iter().map(|a| (*a).to_owned()).collect(), root)
            .map_err(str::to_owned)?;
        run(
            &prepared.program,
            &prepared.args,
            &prepared.env,
            root,
            input,
        )
    }
}
/// Git as this user, for tests and a folder tier with no sandbox to keep.
pub struct PlainGit;
impl Git for PlainGit {
    fn git(&self, root: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
        let args: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
        run(Path::new("git"), &args, &[], root, input)
    }
}
fn run(
    program: &Path,
    args: &[String],
    env: &[(String, String)],
    root: &Path,
    input: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    use std::io::Write;
    let mut child = std::process::Command::new(program)
        .args(args)
        .current_dir(root)
        .envs(env.iter().cloned())
        // Never prompt for credentials on a computer nobody is watching.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take()
        && let Some(bytes) = input
    {
        let _ = stdin.write_all(bytes);
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

/// `gitPath`: folder-relative, the host file protocol's rules.
fn git_path(value: &str) -> Result<String, &'static str> {
    relative_path(value, false).map_err(|_| "invalid_path")
}
fn git_paths(values: &[String]) -> Result<Vec<String>, &'static str> {
    if values.is_empty() || values.len() > MAX_PATHS {
        return Err("invalid_path");
    }
    values.iter().map(|v| git_path(v)).collect()
}

/// `getWorkspaceGitStatus`'s snapshot, inside the folder.
fn status(git: &dyn Git, root: &Path) -> Result<Value, &'static str> {
    let inside = git
        .git(root, &["rev-parse", "--is-inside-work-tree"], None)
        .is_ok_and(|out| String::from_utf8_lossy(&out).trim() == "true");
    if !inside {
        return Ok(json!({
            "isRepo": false, "branch": null, "headCommitId": null, "totalCommits": 0,
            "entries": [], "stagedEntries": [], "unstagedEntries": [], "untrackedEntries": [],
            "branches": [], "remotes": [], "syncTarget": null, "commits": [], "allCommits": [],
        }));
    }
    let prefix = git
        .git(root, &["rev-parse", "--show-prefix"], None)
        .map(|out| {
            String::from_utf8_lossy(&out)
                .trim_end_matches('\n')
                .to_owned()
        })
        .map_err(|_| "file_operation_failed")?;
    let porcelain = git
        .git(
            root,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
            None,
        )
        .map_err(|_| "file_operation_failed")?;
    let snapshot =
        crate::platform::git::parse_status(&porcelain).map_err(|_| "file_operation_failed")?;
    let head = git
        .git(root, &["rev-parse", "--verify", "HEAD"], None)
        .map(|out| String::from_utf8_lossy(&out).trim().to_owned())
        .ok()
        .filter(|h| !h.is_empty());
    let local = |path: &str| crate::platform::git::local(&prefix, path).map(str::to_owned);
    let entries: Vec<Value> = snapshot
        .changes
        .iter()
        .filter_map(|change| {
            let path = local(&change.path)?;
            let original = change.original.as_deref().and_then(local);
            let (index, worktree) = (change.index, change.worktree);
            let conflicted = index == 'U'
                || worktree == 'U'
                || (index == 'A' && worktree == 'A')
                || (index == 'D' && worktree == 'D');
            let code = if index != ' ' && index != '?' {
                index
            } else {
                worktree
            };
            let status = if index == '?' {
                "untracked"
            } else if conflicted {
                "conflicted"
            } else {
                match code {
                    'A' => "added",
                    'D' => "deleted",
                    'R' => "renamed",
                    'C' => "copied",
                    _ => "modified",
                }
            };
            Some(json!({
                "path": path, "originalPath": original, "status": status,
                "indexStatus": index.to_string(), "worktreeStatus": worktree.to_string(),
            }))
        })
        .collect();
    let staged = |e: &&Value| !matches!(e["indexStatus"].as_str(), Some(" " | "?"));
    let unstaged = |e: &&Value| !matches!(e["worktreeStatus"].as_str(), Some(" " | "?"));
    let untracked = |e: &&Value| e["status"] == "untracked";
    Ok(json!({
        "isRepo": true,
        "branch": snapshot.branch,
        "headCommitId": head,
        "entries": entries,
        "stagedEntries": entries.iter().filter(staged).collect::<Vec<_>>(),
        "unstagedEntries": entries.iter().filter(unstaged).collect::<Vec<_>>(),
        "untrackedEntries": entries.iter().filter(untracked).collect::<Vec<_>>(),
        "branches": [], "remotes": [], "syncTarget": null, "commits": [], "allCommits": [],
        "didHitStatusLimit": snapshot.truncated,
    }))
}

/// The host's Git for its shared folders.
pub struct GitService {
    git: Arc<dyn Git>,
    queues: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}
impl GitService {
    pub fn new(git: Arc<dyn Git>) -> Self {
        Self {
            git,
            queues: Mutex::default(),
        }
    }
    /// One operation in the folder at `root`, after the others there.
    pub fn run(&self, root: &Path, request: &GitRequest) -> Result<Value, &'static str> {
        let queue = self
            .queues
            .lock()
            .unwrap()
            .entry(root.to_path_buf())
            .or_default()
            .clone();
        let _serial = queue.lock().unwrap();
        let git = self.git.as_ref();
        let done = |result: Result<Vec<u8>, String>| {
            result
                .map(|_| json!({"ok": true}))
                .map_err(|_| "file_operation_failed")
        };
        let with_paths = |head: &[&str], paths: &[String]| {
            let mut args: Vec<&str> = head.to_vec();
            args.push("--");
            args.extend(paths.iter().map(String::as_str));
            done(git.git(root, &args, None))
        };
        match request.op.as_str() {
            "status" => status(git, root),
            "stage" => with_paths(&["add"], &git_paths(&request.paths)?),
            "stage_all" => done(git.git(root, &["add", "--all", "--", "."], None)),
            "unstage" => {
                let paths = git_paths(&request.paths)?;
                // An unborn branch has no HEAD to reset to.
                if git
                    .git(root, &["rev-parse", "--verify", "HEAD"], None)
                    .is_err()
                {
                    return with_paths(&["rm", "--cached", "-r", "--ignore-unmatch"], &paths);
                }
                with_paths(&["reset", "-q", "HEAD"], &paths)
            }
            "unstage_all" => {
                if git
                    .git(root, &["rev-parse", "--verify", "HEAD"], None)
                    .is_err()
                {
                    return done(git.git(root, &["rm", "--cached", "-r", "-q", "--", "."], None));
                }
                done(git.git(root, &["reset", "-q", "HEAD", "--", "."], None))
            }
            "discard" => with_paths(&["restore", "--worktree"], &git_paths(&request.paths)?),
            "commit" => {
                let message = request.message.as_deref().unwrap_or_default();
                if message.trim().is_empty() || message.chars().count() > 10_000 {
                    return Err("invalid_content");
                }
                done(git.git(
                    root,
                    &["commit", "-F", "-"],
                    Some(message.trim().as_bytes()),
                ))
            }
            "pull" => done(git.git(root, &["pull", "--ff-only"], None)),
            "push" => done(git.git(root, &["push"], None)),
            "file_diff" => {
                let path = git_path(request.path.as_deref().unwrap_or_default())?;
                let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
                if request.scope.as_deref() == Some("staged") {
                    args.push("--cached");
                }
                args.extend(["--", path.as_str()]);
                let diff = git
                    .git(root, &args, None)
                    .map_err(|_| "file_operation_failed")?;
                Ok(json!({"path": path, "diff": String::from_utf8_lossy(&diff)}))
            }
            // History is not offered to other computers yet.
            _ => Err("file_operation_failed"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(root: &Path, args: &[&str]) {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(root)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    fn request(op: &str) -> GitRequest {
        GitRequest {
            op: op.into(),
            ..Default::default()
        }
    }

    /// Status, staging and a commit in a shared folder, in the shape the
    /// other app reads; nothing outside the folder is named.
    #[test]
    fn the_changes_panel_runs_named_git_operations_in_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let service = GitService::new(Arc::new(PlainGit));
        assert_eq!(
            service.run(&root, &request("status")).unwrap()["isRepo"],
            false
        );
        git(&root, &["init", "-q", "-b", "main"]);
        git(&root, &["config", "user.email", "a@example.test"]);
        git(&root, &["config", "user.name", "A"]);
        std::fs::write(root.join("note.md"), "hello").unwrap();
        let status = service.run(&root, &request("status")).unwrap();
        assert_eq!(status["isRepo"], true);
        assert_eq!(status["branch"], "main");
        assert_eq!(status["untrackedEntries"][0]["path"], "note.md");
        service
            .run(
                &root,
                &GitRequest {
                    paths: vec!["note.md".into()],
                    ..request("stage")
                },
            )
            .unwrap();
        let status = service.run(&root, &request("status")).unwrap();
        assert_eq!(status["stagedEntries"][0]["status"], "added");
        assert_eq!(
            service.run(&root, &request("commit")),
            Err("invalid_content")
        );
        service
            .run(
                &root,
                &GitRequest {
                    message: Some("First".into()),
                    ..request("commit")
                },
            )
            .unwrap();
        let status = service.run(&root, &request("status")).unwrap();
        assert!(status["entries"].as_array().unwrap().is_empty());
        assert!(
            status["headCommitId"]
                .as_str()
                .is_some_and(|h| h.len() >= 40)
        );
        for path in ["../x", ".git/config", "/etc/passwd"] {
            let refused = service.run(
                &root,
                &GitRequest {
                    paths: vec![path.into()],
                    ..request("stage")
                },
            );
            assert_eq!(refused, Err("invalid_path"), "{path}");
        }
        assert_eq!(
            service.run(&root, &request("rebase")),
            Err("file_operation_failed")
        );
        assert!(request("status").reads() && !request("commit").reads());
    }
}

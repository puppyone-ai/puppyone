//! `cloud-publish-git.mjs` + `cloud-publish-git-credentials.mjs`: the Git side
//! of a first publication through the stock `git` CLI.
//!
//! - One canonical remote named `puppyone`, created only by this operation.
//! - The secret reaches Git only through the system's secure credential
//!   helper, installed URL-scoped in the repository's local config with an
//!   ownership marker and a snapshot of what it replaced, so cleanup restores
//!   exactly the previous values. Every network command resets the inherited
//!   helper chain on the command line for that URL.
//! - The push sends one immutable commit to `refs/heads/main` with
//!   `--force-with-lease=refs/heads/main:` (the destination must be absent).
use super::{
    Code, PublishError,
    journal::{CredentialConfig, Record, commit_id},
};
use base64::Engine as _;
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Duration,
};

pub const REMOTE: &str = "puppyone";
pub const DESTINATION_REF: &str = "refs/heads/main";
const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
const NETWORK_TIMEOUT: Duration = Duration::from_secs(60);
/// `CLOUD_INITIAL_PUSH_TIMEOUT_MS`.
const PUSH_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// A single push may carry at most 2 GiB.
pub const PUSH_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const LFS_PREAMBLE: &str = "version https://git-lfs.github.com/spec/v1";

/// What `git remote` says about `puppyone`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Remote {
    Missing,
    Exact(String),
    Conflict,
}

/// Identity of a repository worktree (`resolveGitRepositoryIdentity`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
    pub top_level: PathBuf,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub head: Option<String>,
    pub branch: Option<String>,
    pub commits: u64,
    pub dirty: bool,
}

/// The Git operations the coordinator needs.
pub trait GitOps: Send + Sync {
    fn identity(&self, root: &Path) -> Result<Identity, PublishError>;
    fn status(&self, root: &Path) -> Result<Status, PublishError>;
    fn remote(&self, root: &Path) -> Result<Remote, PublishError>;
    fn source_commit(&self, root: &Path, branch: &str) -> Result<String, PublishError>;
    fn preflight(&self, root: &Path, commit: &str) -> Result<(), PublishError>;
    fn commit_exists(&self, root: &Path, commit: &str) -> bool;
    fn prepare_credential_config(
        &self,
        root: &Path,
        url: &str,
        operation: &str,
    ) -> Result<CredentialConfig, PublishError>;
    /// Stores the credential and creates the remote when missing; `Ok(true)`
    /// when it was created now.
    fn configure_remote(
        &self,
        root: &Path,
        record: &Record,
        secret: &str,
    ) -> Result<bool, PublishError>;
    fn push(&self, root: &Path, record: &Record, secret: &str) -> Result<(), PublishError>;
    /// `refs/heads/main` on the canonical URL (`None`: absent).
    fn remote_main(
        &self,
        root: &Path,
        record: &Record,
        secret: &str,
    ) -> Result<Option<String>, PublishError>;
    fn finalize(&self, root: &Path, record: &Record) -> Result<(), PublishError>;
    fn cleanup(&self, root: &Path, record: &Record) -> Result<(), PublishError>;
}

/// The stock `git` CLI. `helper` overrides the secure helper (tests).
pub struct Cli {
    pub helper: Option<String>,
}

fn git(
    root: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<String, String> {
    crate::platform::process::run(
        Path::new("/usr/bin/git"),
        args,
        root,
        input,
        timeout,
        &AtomicBool::new(false),
    )
    .map(|out| String::from_utf8_lossy(&out).into_owned())
}
fn local(root: &Path, args: &[&str]) -> Result<String, String> {
    git(root, args, None, LOCAL_TIMEOUT)
}
fn values(out: Result<String, String>) -> Vec<String> {
    out.map(|text| text.lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

/// `credentialScope`.
struct Scope {
    helper: String,
    marker: String,
    snapshot: String,
    use_http_path: String,
}
fn scope(url: &str) -> Result<Scope, PublishError> {
    let parsed = url::Url::parse(url).map_err(|_| config_conflict("URL is invalid"))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(config_conflict("URL is invalid"));
    }
    let prefix = format!("credential.{parsed}");
    Ok(Scope {
        helper: format!("{prefix}.helper"),
        marker: format!("{prefix}.puppyonemanaged"),
        snapshot: format!("{prefix}.puppyonesnapshot"),
        use_http_path: format!("{prefix}.useHttpPath"),
    })
}
fn config_conflict(detail: &str) -> PublishError {
    PublishError::new(
        Code::RemoteConfigFailed,
        format!("PuppyOne credential configuration: {detail}."),
        false,
    )
}
/// `isKnownSecureCredentialHelper`: never a `!` shell command or a path.
pub fn secure_helper(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "osxkeychain"
            | "manager"
            | "manager-core"
            | "git-credential-manager"
            | "git-credential-manager-core"
            | "libsecret"
            | "secretservice"
            | "pass"
    )
}
fn encode(config: &CredentialConfig) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(config).unwrap_or_default())
}
/// `secureCredentialCommandArgs`: command-line config outranks the local
/// file, and the empty helper resets the inherited chain for this URL.
fn secure_args(
    url: &str,
    config: &CredentialConfig,
    args: &[&str],
) -> Result<Vec<String>, PublishError> {
    let scope = scope(url)?;
    let mut all = vec![
        "-c".to_owned(),
        format!("{}=", scope.helper),
        "-c".to_owned(),
        format!("{}={}", scope.helper, config.helper),
        "-c".to_owned(),
        format!("{}=true", scope.use_http_path),
    ];
    all.extend(args.iter().map(|a| (*a).to_owned()));
    Ok(all)
}
fn credential_input(url: &str, username: &str, password: Option<&str>) -> String {
    let parsed = url::Url::parse(url).ok();
    let (protocol, host, path) = parsed
        .map(|u| {
            let host = match u.port() {
                Some(port) => format!("{}:{port}", u.host_str().unwrap_or_default()),
                None => u.host_str().unwrap_or_default().to_owned(),
            };
            (
                u.scheme().to_owned(),
                host,
                u.path().trim_start_matches('/').to_owned(),
            )
        })
        .unwrap_or_default();
    let mut text = format!("protocol={protocol}\nhost={host}\npath={path}\nusername={username}\n");
    if let Some(password) = password {
        text.push_str(&format!("password={password}\n"));
    }
    text.push('\n');
    text
}
#[derive(Debug, PartialEq, Eq)]
struct Scoped {
    helpers: Vec<String>,
    use_http_path: Vec<String>,
    markers: Vec<String>,
    snapshots: Vec<String>,
}
fn read_scoped(root: &Path, scope: &Scope) -> Scoped {
    let get = |key: &str| values(local(root, &["config", "--local", "--get-all", key]));
    Scoped {
        helpers: get(&scope.helper),
        use_http_path: get(&scope.use_http_path),
        markers: get(&scope.marker),
        snapshots: get(&scope.snapshot),
    }
}
fn replace(root: &Path, key: &str, new: &[String]) -> Result<(), PublishError> {
    let _ = local(root, &["config", "--local", "--unset-all", key]);
    for value in new {
        local(root, &["config", "--local", "--add", key, value])
            .map_err(|_| config_conflict("unable to write the local config"))?;
    }
    Ok(())
}
impl Cli {
    fn install(
        &self,
        root: &Path,
        config: &CredentialConfig,
        operation: &str,
    ) -> Result<(), PublishError> {
        let scope = scope(&config.scope_url)?;
        // Ownership metadata first: a crash between writes stays recoverable.
        replace(root, &scope.snapshot, &[encode(config)])?;
        replace(root, &scope.marker, &[operation.to_owned()])?;
        replace(root, &scope.use_http_path, &["true".to_owned()])?;
        replace(root, &scope.helper, &[String::new(), config.helper.clone()])
    }
    fn restore(&self, root: &Path, config: &CredentialConfig) -> Result<(), PublishError> {
        let scope = scope(&config.scope_url)?;
        replace(root, &scope.helper, &config.previous_helpers)?;
        replace(root, &scope.use_http_path, &config.previous_use_http_path)?;
        replace(root, &scope.marker, &[])?;
        replace(root, &scope.snapshot, &[])
    }
    /// `approve`: store, then read back the same secret (`credential fill`).
    fn approve(&self, root: &Path, record: &Record, secret: &str) -> Result<(), PublishError> {
        let (url, config, user) = complete(record)?;
        self.install(root, config, &record.operation_id)?;
        let args = secure_args(url, config, &["credential", "approve"])?;
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        git(
            root,
            &args,
            Some(credential_input(url, user, Some(secret)).as_bytes()),
            LOCAL_TIMEOUT,
        )
        .map_err(|_| self.rollback(root, record, "storing the Git credential"))?;
        let fill = secure_args(url, config, &["credential", "fill"])?;
        let fill: Vec<&str> = fill.iter().map(String::as_str).collect();
        let returned = git(
            root,
            &fill,
            Some(credential_input(url, user, None).as_bytes()),
            LOCAL_TIMEOUT,
        )
        .map_err(|_| self.rollback(root, record, "reading back the Git credential"))?;
        let password = returned
            .lines()
            .take_while(|l| !l.is_empty())
            .find_map(|l| l.strip_prefix("password="));
        if password != Some(secret) {
            return Err(self.rollback(root, record, "verifying the secure Git credential helper"));
        }
        Ok(())
    }
    fn reject(&self, root: &Path, record: &Record) {
        if let Ok((url, config, user)) = complete(record)
            && let Ok(args) = secure_args(url, config, &["credential", "reject"])
        {
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            let _ = git(
                root,
                &args,
                Some(credential_input(url, user, None).as_bytes()),
                LOCAL_TIMEOUT,
            );
        }
    }
    fn rollback(&self, root: &Path, record: &Record, stage: &str) -> PublishError {
        self.reject(root, record);
        if let Some(config) = &record.credential_config_snapshot {
            let _ = self.restore(root, config);
        }
        PublishError::new(
            Code::RemoteConfigFailed,
            format!("Unable to finish {stage}."),
            true,
        )
    }
    fn secure(&self, record: &Record, args: &[&str]) -> Result<Vec<String>, PublishError> {
        let (url, config, _) = complete(record)?;
        secure_args(url, config, args)
    }
}
fn complete(record: &Record) -> Result<(&str, &CredentialConfig, &str), PublishError> {
    match (
        record.canonical_remote_url.as_deref(),
        record.credential_config_snapshot.as_ref(),
        record.credential_username.as_deref(),
        record.project_id.as_deref(),
        record.credential_id.as_deref(),
    ) {
        (Some(url), Some(config), Some(user), Some(_), Some(_)) => Ok((url, config, user)),
        _ => Err(PublishError::new(
            Code::CredentialFailed,
            "Pending credential state is incomplete.",
            false,
        )),
    }
}
/// `isPushLimitFailure`: the receiver refused the size (413 / pack limit).
pub fn push_limit_failure(stderr: &str) -> bool {
    let text = stderr.to_lowercase();
    text.contains("413")
        || text.contains("request entity too large")
        || text.contains("pack exceeds maximum allowed size")
        || text.contains("push_limit_exceeded")
}
/// `isUncertainPushFailure`: transport loss after the request may have
/// arrived.
pub fn uncertain_push_failure(stderr: &str) -> bool {
    let text = stderr.to_lowercase();
    [
        "the remote end hung up",
        "connection reset",
        "timed out",
        "timeout",
        "early eof",
        "broken pipe",
        "rpc failed",
        "cancelled",
        "could not read from remote",
        "http/2 stream",
        "ssl_error",
        "502",
        "503",
        "504",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

impl GitOps for Cli {
    fn identity(&self, root: &Path) -> Result<Identity, PublishError> {
        let required = || {
            PublishError::new(
                Code::RepositoryRequired,
                "Current workspace is not a Git repository.",
                false,
            )
        };
        let out = local(
            root,
            &[
                "rev-parse",
                "--absolute-git-dir",
                "--git-common-dir",
                "--show-toplevel",
            ],
        )
        .map_err(|_| required())?;
        let mut lines = out.lines();
        let (Some(git_dir), Some(common), Some(top)) = (lines.next(), lines.next(), lines.next())
        else {
            return Err(required());
        };
        let common = PathBuf::from(common);
        let common = if common.is_absolute() {
            common
        } else {
            root.join(common)
        };
        Ok(Identity {
            git_dir: PathBuf::from(git_dir),
            common_dir: common.canonicalize().unwrap_or(common),
            top_level: PathBuf::from(top),
        })
    }
    fn status(&self, root: &Path) -> Result<Status, PublishError> {
        let head = local(root, &["rev-parse", "--verify", "--quiet", "HEAD"])
            .ok()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| commit_id(s));
        let branch = local(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        let commits = head
            .as_ref()
            .and_then(|_| local(root, &["rev-list", "--count", "HEAD"]).ok())
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let dirty = local(
            root,
            &["status", "--porcelain=v1", "--untracked-files=normal"],
        )
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
        Ok(Status {
            head,
            branch,
            commits,
            dirty,
        })
    }
    fn remote(&self, root: &Path) -> Result<Remote, PublishError> {
        let names = values(local(root, &["remote"]));
        let collisions: Vec<&String> = names
            .iter()
            .filter(|n| n.eq_ignore_ascii_case(REMOTE))
            .collect();
        if collisions.is_empty() {
            return Ok(Remote::Missing);
        }
        if collisions.len() != 1 || collisions[0] != REMOTE {
            return Ok(Remote::Conflict);
        }
        let fetch = values(local(root, &["remote", "get-url", "--all", REMOTE]));
        let push = values(local(
            root,
            &["remote", "get-url", "--push", "--all", REMOTE],
        ));
        Ok(
            if fetch.len() == 1 && push.len() == 1 && fetch[0] == push[0] {
                Remote::Exact(fetch[0].clone())
            } else {
                Remote::Conflict
            },
        )
    }
    fn source_commit(&self, root: &Path, branch: &str) -> Result<String, PublishError> {
        let missing = || {
            PublishError::new(
                Code::SourceMissing,
                format!("Source branch '{branch}' is unavailable."),
                false,
            )
        };
        let commit = local(
            root,
            &[
                "rev-parse",
                "--verify",
                &format!("refs/heads/{branch}^{{commit}}"),
            ],
        )
        .map_err(|_| missing())?
        .trim()
        .to_lowercase();
        if commit_id(&commit) {
            Ok(commit)
        } else {
            Err(missing())
        }
    }
    /// `assertVersionEnginePreflight`: no merge tip, no Git LFS pointers, and
    /// the pack within the single-push limit.
    fn preflight(&self, root: &Path, commit: &str) -> Result<(), PublishError> {
        let parents = local(root, &["rev-list", "--parents", "-n", "1", commit]).map_err(|_| {
            PublishError::new(
                Code::CommitRequired,
                "Unable to inspect the expected Git commit.",
                false,
            )
        })?;
        if parents.split_whitespace().count() > 2 {
            return Err(PublishError::new(
                Code::MergeTipUnsupported,
                "The current merge commit cannot be the initial Puppyone Cloud tip. Publish a linearized tip.",
                false,
            ));
        }
        let pattern = format!("^{}$", regex_escape(LFS_PREAMBLE));
        if let Ok(matches) = local(
            root,
            &[
                "grep",
                "-z",
                "-l",
                "--full-name",
                "-e",
                &pattern,
                commit,
                "--",
            ],
        ) {
            for entry in matches.split('\0').filter(|e| !e.is_empty()) {
                let path = entry.strip_prefix(&format!("{commit}:")).unwrap_or(entry);
                let spec = format!("{commit}:{path}");
                let size: u64 = local(root, &["cat-file", "-s", &spec])
                    .ok()
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(u64::MAX);
                if size > 512 {
                    continue;
                }
                let body = local(root, &["cat-file", "blob", &spec]).unwrap_or_default();
                if body.starts_with(&format!("{LFS_PREAMBLE}\n"))
                    && body.contains("\noid sha256:")
                    && body.contains("\nsize ")
                {
                    return Err(PublishError::new(
                        Code::LfsUnsupported,
                        "Git LFS pointer files are not supported by the Puppyone Cloud repository engine.",
                        false,
                    ));
                }
            }
        }
        // The whole history is one pack; estimate it from the object sizes.
        let objects = local(root, &["rev-list", "--objects", "--disk-usage", commit])
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok());
        if objects.is_some_and(|bytes| bytes > PUSH_LIMIT_BYTES) {
            return Err(PublishError::new(
                Code::PushLimitExceeded,
                "This project is larger than a single Cloud upload allows (2 GB).",
                true,
            ));
        }
        Ok(())
    }
    fn commit_exists(&self, root: &Path, commit: &str) -> bool {
        commit_id(commit)
            && local(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")]).is_ok()
    }
    fn prepare_credential_config(
        &self,
        root: &Path,
        url: &str,
        _operation: &str,
    ) -> Result<CredentialConfig, PublishError> {
        let scope = scope(url)?;
        let current = read_scoped(root, &scope);
        if !current.markers.is_empty() || !current.snapshots.is_empty() {
            return Err(config_conflict(
                "a managed scope already exists for this URL",
            ));
        }
        let helper = match &self.helper {
            Some(helper) => helper.clone(),
            None => {
                let matched = values(local(
                    root,
                    &["config", "--get-urlmatch", "credential.helper", url],
                ));
                let general = values(local(root, &["config", "--get-all", "credential.helper"]));
                matched
                    .into_iter()
                    .chain(general)
                    .find(|h| secure_helper(h))
                    .map(|h| h.trim().to_lowercase())
                    .or_else(|| cfg!(target_os = "macos").then(|| "osxkeychain".into()))
                    .ok_or_else(|| {
                        PublishError::new(
                            Code::RemoteConfigFailed,
                            "No secure Git credential helper is configured. Install Git Credential Manager or libsecret.",
                            false,
                        )
                    })?
            }
        };
        Ok(CredentialConfig {
            version: 1,
            scope_url: url::Url::parse(url)
                .map(|u| u.to_string())
                .unwrap_or_default(),
            helper,
            previous_helpers: current.helpers,
            previous_use_http_path: current.use_http_path,
        })
    }
    fn configure_remote(
        &self,
        root: &Path,
        record: &Record,
        secret: &str,
    ) -> Result<bool, PublishError> {
        let (url, _, _) = complete(record)?;
        if !self.commit_exists(root, &record.attempt.commit_oid) {
            return Err(PublishError::new(
                Code::CommitRequired,
                "The selected push commit is no longer available locally.",
                false,
            ));
        }
        let remote = self.remote(root)?;
        let ours = record.remote_add_intent && remote == Remote::Exact(url.to_owned());
        if remote != Remote::Missing && !ours {
            return Err(PublishError::new(
                Code::RemoteConflict,
                "A Git remote named 'puppyone' already exists with a different canonical URL.",
                false,
            ));
        }
        self.approve(root, record, secret)?;
        let created = remote == Remote::Missing;
        if created {
            local(root, &["remote", "add", REMOTE, url])
                .map_err(|_| self.rollback(root, record, "creating the local Cloud remote"))?;
        }
        if self.remote(root)? != Remote::Exact(url.to_owned()) {
            return Err(PublishError::new(
                Code::RemoteConflict,
                "Canonical PuppyOne Git remote changed during publish.",
                false,
            ));
        }
        Ok(created)
    }
    fn push(&self, root: &Path, record: &Record, secret: &str) -> Result<(), PublishError> {
        let (url, _, _) = complete(record)?;
        if self.remote(root)? != Remote::Exact(url.to_owned()) {
            return Err(PublishError::new(
                Code::RemoteConflict,
                "Canonical PuppyOne Git remote changed during publish.",
                false,
            ));
        }
        self.approve(root, record, secret)?;
        let header = format!(
            "http.{url}.extraHeader=X-PuppyOne-Initial-Attempt: {}",
            record.attempt.attempt_id
        );
        let lease = format!("--force-with-lease={DESTINATION_REF}:");
        let refspec = format!("{}:{DESTINATION_REF}", record.attempt.commit_oid);
        let args = self.secure(
            record,
            &["-c", &header, "push", "--porcelain", &lease, url, &refspec],
        )?;
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        match git(root, &args, None, PUSH_TIMEOUT) {
            Ok(_) => Ok(()),
            Err(stderr) => {
                // One bounded check of what Cloud main now is.
                let head = self.remote_main(root, record, secret).ok().flatten();
                if head.as_deref() == Some(record.attempt.commit_oid.as_str()) {
                    return Ok(());
                }
                if head.is_some() {
                    return Err(PublishError::new(
                        Code::RemoteRefConflict,
                        "Cloud main changed while the initial push was in flight.",
                        false,
                    ));
                }
                if push_limit_failure(&stderr) {
                    return Err(PublishError::new(
                        Code::PushLimitExceeded,
                        "Cloud refused an upload larger than its single-push limit (2 GB).",
                        true,
                    ));
                }
                if uncertain_push_failure(&stderr) {
                    return Err(PublishError::new(
                        Code::PushUncertain,
                        "The connection was interrupted. Retry to check the result and send again if needed.",
                        true,
                    ));
                }
                Err(PublishError::new(
                    Code::PushFailed,
                    "Cloud did not accept the upload. Retry after correcting the cause.",
                    true,
                ))
            }
        }
    }
    fn remote_main(
        &self,
        root: &Path,
        record: &Record,
        secret: &str,
    ) -> Result<Option<String>, PublishError> {
        let (url, _, _) = complete(record)?;
        let _ = secret;
        let args = self.secure(record, &["ls-remote", "--refs", url, DESTINATION_REF])?;
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = git(root, &args, None, NETWORK_TIMEOUT).map_err(|_| {
            PublishError::new(Code::PushUncertain, "Unable to read Cloud main.", true)
        })?;
        let lines: Vec<&str> = out
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        match lines.as_slice() {
            [] => Ok(None),
            [line] => {
                let mut parts = line.split_whitespace();
                match (parts.next(), parts.next()) {
                    (Some(oid), Some(DESTINATION_REF)) if commit_id(oid) => {
                        Ok(Some(oid.to_lowercase()))
                    }
                    _ => Err(PublishError::new(
                        Code::PushFailed,
                        "Cloud main ref response is invalid.",
                        false,
                    )),
                }
            }
            _ => Err(PublishError::new(
                Code::PushFailed,
                "Cloud main ref response is ambiguous.",
                false,
            )),
        }
    }
    /// `finalizeUpstreamAndStatus`: the tracking ref and upstream of the
    /// source branch.
    fn finalize(&self, root: &Path, record: &Record) -> Result<(), PublishError> {
        let failed = || {
            PublishError::new(
                Code::LocalFinalizeFailed,
                "Unable to finish the local setup.",
                true,
            )
        };
        local(
            root,
            &[
                "update-ref",
                &format!("refs/remotes/{REMOTE}/main"),
                &record.attempt.commit_oid,
            ],
        )
        .map_err(|_| failed())?;
        local(
            root,
            &[
                "branch",
                &format!("--set-upstream-to={REMOTE}/main"),
                &record.selected_source_branch,
            ],
        )
        .map_err(|_| failed())?;
        Ok(())
    }
    /// `cleanupAfterServerAbandon`: forget the credential, restore the
    /// helper config and remove the remote this operation created.
    fn cleanup(&self, root: &Path, record: &Record) -> Result<(), PublishError> {
        if let Some(config) = &record.credential_config_snapshot {
            self.reject(root, record);
            self.restore(root, config)?;
        }
        if (record.remote_add_intent || record.remote_created_by_operation)
            && let Some(url) = &record.canonical_remote_url
            && self.remote(root)? == Remote::Exact(url.clone())
        {
            local(root, &["remote", "remove", REMOTE]).map_err(|_| {
                PublishError::new(
                    Code::CleanupFailed,
                    "Unable to remove the local Cloud remote.",
                    true,
                )
            })?;
        }
        Ok(())
    }
}
fn regex_escape(text: &str) -> String {
    text.chars()
        .flat_map(|c| {
            if ".*+?^${}()|[]\\".contains(c) {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect()
}

/// `detachManaged` + removing the remote: the local half of replacing a
/// Cloud association whose Project no longer exists. Nothing happens unless
/// `puppyone` still points exactly at the reviewed URL.
pub fn detach(root: &Path, reviewed_url: &str) -> Result<(), PublishError> {
    let cli = Cli { helper: None };
    if cli.remote(root)? != Remote::Exact(reviewed_url.to_owned()) {
        return Err(PublishError::new(
            Code::RemoteConflict,
            "The Cloud remote changed after it was reviewed.",
            false,
        ));
    }
    let scope = scope(reviewed_url)?;
    let current = read_scoped(root, &scope);
    if !current.markers.is_empty() || !current.snapshots.is_empty() {
        if current.snapshots.len() != 1 {
            return Err(config_conflict("managed metadata is ambiguous"));
        }
        let config: CredentialConfig = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(current.snapshots[0].as_bytes())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or_else(|| config_conflict("managed snapshot is corrupt"))?;
        if let Ok(args) = secure_args(reviewed_url, &config, &["credential", "reject"]) {
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            let _ = git(
                root,
                &args,
                Some(credential_input(reviewed_url, super::api::GIT_USERNAME, None).as_bytes()),
                LOCAL_TIMEOUT,
            );
        }
        cli.restore(root, &config)?;
    }
    local(root, &["remote", "remove", REMOTE]).map_err(|_| {
        PublishError::new(
            Code::RemoteConfigFailed,
            "Unable to remove the Cloud remote.",
            true,
        )
    })?;
    Ok(())
}

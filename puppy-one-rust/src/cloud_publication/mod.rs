//! `electron/main/cloud-initialization/*` (`initialization-and-first-push.md`),
//! the main-owned publication service beside `cloud_auth`:
//! publishing a local repository to a new Cloud Project as one durable,
//! resumable operation.
//!
//! Checkpoints, in order: prepared → project-created (idempotent creation) →
//! credential-issued (a client-generated secret kept in the keychain) →
//! remote-configured (the canonical `puppyone` remote and a URL-scoped
//! secure helper) → push-attempt (one immutable commit to `refs/heads/main`,
//! which must be absent) → push-accepted → completed. Every transition is a
//! compare-and-swap journal write before its side effect is trusted; a lost
//! response is reconciled against the remote's actual `main`, never replayed
//! blindly. Failure is a retryable state, never an automatic rollback;
//! deleting the empty Project is an explicit cleanup.
#![cfg_attr(not(test), allow(dead_code))]
pub mod api;
pub mod git;
pub mod journal;
mod migrate;
#[cfg(test)]
pub(crate) mod tests;
pub mod vault;

use crate::workspace::cloud::publish;
use api::CloudOps;
use git::{GitOps, Remote};
use journal::{Attempt, CreatePayload, Expect, Journal, Record, StoredError};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vault::SecretVault;

/// `CLOUD_PUBLISH_ERROR_CODES`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Code {
    SessionRequired,
    IdentityMismatch,
    OrganizationRequired,
    RepositoryRequired,
    CommitRequired,
    BranchRequired,
    SourceMissing,
    MergeTipUnsupported,
    LfsUnsupported,
    RemoteConflict,
    RemoteRefConflict,
    ProjectCreateFailed,
    ProjectUnavailable,
    CredentialFailed,
    ServiceUpgradeRequired,
    RemoteConfigFailed,
    PushFailed,
    PushLimitExceeded,
    PushUncertain,
    LocalFinalizeFailed,
    CleanupFailed,
    CleanupNotAllowed,
    CompensationFailed,
    JournalCorrupt,
    JournalIoFailed,
    PermissionDenied,
    Unknown,
}
const CODES: [(Code, &str); 27] = [
    (Code::SessionRequired, "SESSION_REQUIRED"),
    (Code::IdentityMismatch, "IDENTITY_MISMATCH"),
    (Code::OrganizationRequired, "ORGANIZATION_REQUIRED"),
    (Code::RepositoryRequired, "REPOSITORY_REQUIRED"),
    (Code::CommitRequired, "COMMIT_REQUIRED"),
    (Code::BranchRequired, "BRANCH_REQUIRED"),
    (Code::SourceMissing, "SOURCE_MISSING"),
    (Code::MergeTipUnsupported, "MERGE_TIP_UNSUPPORTED"),
    (Code::LfsUnsupported, "LFS_UNSUPPORTED"),
    (Code::RemoteConflict, "REMOTE_CONFLICT"),
    (Code::RemoteRefConflict, "REMOTE_REF_CONFLICT"),
    (Code::ProjectCreateFailed, "PROJECT_CREATE_FAILED"),
    (Code::ProjectUnavailable, "PROJECT_UNAVAILABLE"),
    (Code::CredentialFailed, "CREDENTIAL_FAILED"),
    (Code::ServiceUpgradeRequired, "SERVICE_UPGRADE_REQUIRED"),
    (Code::RemoteConfigFailed, "REMOTE_CONFIG_FAILED"),
    (Code::PushFailed, "PUSH_FAILED"),
    (Code::PushLimitExceeded, "PUSH_LIMIT_EXCEEDED"),
    (Code::PushUncertain, "PUSH_UNCERTAIN"),
    (Code::LocalFinalizeFailed, "LOCAL_FINALIZE_FAILED"),
    (Code::CleanupFailed, "CLEANUP_FAILED"),
    (Code::CleanupNotAllowed, "CLEANUP_NOT_ALLOWED"),
    (Code::CompensationFailed, "COMPENSATION_FAILED"),
    (Code::JournalCorrupt, "JOURNAL_CORRUPT"),
    (Code::JournalIoFailed, "JOURNAL_IO_FAILED"),
    (Code::PermissionDenied, "PERMISSION_DENIED"),
    (Code::Unknown, "UNKNOWN"),
];
impl Code {
    pub fn as_str(self) -> &'static str {
        CODES
            .iter()
            .find(|(c, _)| *c == self)
            .map(|(_, s)| *s)
            .unwrap_or("UNKNOWN")
    }
    pub fn parse(value: &str) -> Option<Self> {
        CODES.iter().find(|(_, s)| *s == value).map(|(c, _)| *c)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublishError {
    pub code: Code,
    /// A diagnostic; secrets and credential-bearing URLs never enter it.
    pub message: String,
    pub retryable: bool,
}
impl PublishError {
    pub fn new(code: Code, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: sanitize(&message.into()),
            retryable,
        }
    }
}
/// `sanitizeDiagnostic`.
fn sanitize(message: &str) -> String {
    let mut out = String::new();
    for word in message.split_inclusive(char::is_whitespace) {
        if word.trim_start().starts_with("pwg_") {
            out.push_str("[redacted]");
            if word.ends_with(char::is_whitespace) {
                out.push(' ');
            }
        } else if let Some(at) = word.find('@')
            && word.contains("://")
        {
            let scheme = word.find("://").unwrap() + 3;
            out.push_str(&word[..scheme]);
            out.push_str("[redacted]");
            out.push_str(&word[at..]);
        } else {
            out.push_str(word);
        }
    }
    out.chars().take(500).collect()
}

/// `normalizeStartRequest` / `normalizeReadRequest`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub root: PathBuf,
    pub api_base_url: String,
    pub user_id: String,
    pub organization_id: String,
    pub project_name: String,
    pub source_branch: String,
    pub operation_id: Option<String>,
    pub action: Action,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Initialize,
    RetryPush,
    PushLatest,
    ChooseSource,
    Reconcile,
}
/// `normalizeBranch`.
pub fn valid_branch(branch: &str) -> bool {
    let b = branch.trim();
    !b.is_empty()
        && !b.eq_ignore_ascii_case("head")
        && !b.eq_ignore_ascii_case("detached")
        && !b.starts_with('-')
        && !b.starts_with("refs/")
        && !b.contains("..")
        && !b
            .chars()
            .any(|c| "~^:?*[\\".contains(c) || c.is_control() || c == ' ')
        && !b.ends_with('/')
        && !b.ends_with('.')
        && !b.contains("@{")
}

/// Visible steps (`createCloudPublishProgressChannel`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Validating,
    CreatingProject,
    SecuringCredential,
    ConfiguringRemote,
    CheckingRemote,
    Uploading,
    Confirming,
    Finalizing,
    Completed,
}

/// `successResult` / `failureResult`.
#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    pub state: Option<publish::State>,
    /// The operation still pending (its id drives Discard).
    pub record: Option<Record>,
    pub error: Option<PublishError>,
    /// The published Project (on success).
    pub project: Option<String>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn state_of(value: &str) -> Option<publish::Push> {
    publish::Push::from_journal(value)
}

/// The facts a record is projected with (`readLocalFacts` + remote truth).
#[derive(Clone, Debug, Default)]
struct Facts {
    status: git::Status,
    source_tip: Option<String>,
    source_missing: bool,
    local_remote_conflict: bool,
    remote_kind: Option<Remote>,
    remote_head: Option<String>,
    remote_read: bool,
}
impl Facts {
    fn remote_accepted(&self, record: &Record) -> bool {
        self.remote_head.as_deref() == Some(record.attempt.commit_oid.as_str())
    }
    fn remote_conflict(&self, record: &Record) -> bool {
        self.remote_head
            .as_ref()
            .is_some_and(|h| *h != record.attempt.commit_oid)
    }
}
/// `deriveCloudInitializationState` over the journal's spellings.
pub fn derive(
    record: &Record,
    facts_status: &git::Status,
    source_tip: Option<&str>,
    source_missing: bool,
    local_remote_conflict: bool,
    remote_accepted: bool,
    remote_conflict: bool,
) -> publish::State {
    let projection = publish::Record {
        project: publish::Project::from_journal(&record.project_state)
            .unwrap_or(publish::Project::Absent),
        push: state_of(&record.push_state).unwrap_or(publish::Push::Idle),
        cleanup: publish::Cleanup::from_journal(&record.cleanup_state)
            .unwrap_or(publish::Cleanup::None),
        selected_source_branch: record.selected_source_branch.clone(),
        attempt_commit: Some(record.attempt.commit_oid.clone()),
        attempt_history: record
            .attempt_history
            .iter()
            .filter_map(|a| state_of(&a.state))
            .collect(),
        last_error: record.last_error.as_ref().map(|e| e.code.clone()),
    };
    publish::derive(
        &projection,
        &publish::Facts {
            remote_accepted,
            remote_conflict,
            local_remote_conflict,
            source_missing,
            source_tip: source_tip.map(str::to_owned),
            current_branch: facts_status.branch.clone(),
            dirty: facts_status.dirty,
        },
    )
}

/// The main-owned coordinator (`createCloudPublishCoordinator`).
pub struct Coordinator {
    pub git: Arc<dyn GitOps>,
    pub cloud: Arc<dyn CloudOps>,
    pub vault: Arc<dyn SecretVault>,
}

struct Context {
    journal: Journal,
    fingerprint: String,
}

impl Coordinator {
    /// `resolveRepositoryContext`: the worktree's journal and a fingerprint
    /// of the repository's identity (device, inode, git dirs).
    fn context(&self, root: &Path) -> Result<Context, PublishError> {
        use sha2::Digest as _;
        let identity = self.git.identity(root)?;
        let metadata = std::fs::metadata(&identity.common_dir).map_err(|_| {
            PublishError::new(
                Code::RepositoryRequired,
                "Unable to inspect the Git repository.",
                false,
            )
        })?;
        #[cfg(unix)]
        let (dev, ino) = {
            use std::os::unix::fs::MetadataExt;
            (metadata.dev(), metadata.ino())
        };
        #[cfg(not(unix))]
        let (dev, ino) = (0u64, 0u64);
        let _ = &metadata;
        let fingerprint = format!(
            "{:x}",
            sha2::Sha256::digest(
                [
                    "puppyone-publish-repository-v1".to_owned(),
                    dev.to_string(),
                    ino.to_string(),
                    identity.common_dir.display().to_string(),
                    identity.git_dir.display().to_string(),
                    identity.top_level.display().to_string(),
                ]
                .join("\0")
                .as_bytes()
            )
        );
        Ok(Context {
            journal: Journal::in_git_dir(&identity.git_dir),
            fingerprint,
        })
    }
    fn persist(
        &self,
        journal: &Journal,
        record: &Record,
        patch: impl FnOnce(&mut Record),
    ) -> Result<Record, PublishError> {
        let mut next = record.clone();
        patch(&mut next);
        next.revision = record.revision + 1;
        next.updated_at = now_iso();
        journal.write(&next, Expect::of(record))
    }
    fn local_facts(&self, root: &Path, record: &Record) -> Facts {
        let status = self.git.status(root).unwrap_or_default();
        let source = self
            .git
            .source_commit(root, &record.selected_source_branch)
            .ok();
        let remote = self.git.remote(root).ok();
        let local_remote_conflict = match (&remote, &record.canonical_remote_url) {
            (Some(Remote::Conflict), _) => true,
            (Some(Remote::Exact(url)), Some(canonical)) => url != canonical,
            _ => false,
        };
        Facts {
            status,
            source_missing: source.is_none(),
            source_tip: source,
            local_remote_conflict,
            remote_kind: remote,
            remote_head: None,
            remote_read: false,
        }
    }
    /// `readFacts`: local facts, plus Cloud main when the operation has
    /// everything needed to ask.
    fn facts(&self, root: &Path, record: &Record) -> Result<Facts, PublishError> {
        let mut facts = self.local_facts(root, record);
        if facts.local_remote_conflict
            || record.canonical_remote_url.is_none()
            || record.credential_config_snapshot.is_none()
            || record.credential_id.is_none()
            || !record.secret_stored
        {
            return Ok(facts);
        }
        let Some(secret) = record
            .secret_ref
            .as_deref()
            .and_then(|r| self.vault.get(r).ok().flatten())
        else {
            return Ok(facts);
        };
        match self.git.remote_main(root, record, &secret) {
            Ok(head) => {
                facts.remote_head = head;
                facts.remote_read = true;
            }
            Err(e) if matches!(e.code, Code::RemoteConflict | Code::PushFailed) => return Err(e),
            Err(_) => {}
        }
        Ok(facts)
    }
    fn project_state(&self, record: &Record, facts: &Facts) -> publish::State {
        derive(
            record,
            &facts.status,
            facts.source_tip.as_deref(),
            facts.source_missing,
            facts.local_remote_conflict,
            facts.remote_accepted(record),
            facts.remote_conflict(record),
        )
    }
    /// `persistRemoteTruth`.
    fn remote_truth(
        &self,
        journal: &Journal,
        record: Record,
        facts: &Facts,
    ) -> Result<Record, PublishError> {
        if facts.remote_accepted(&record) && record.push_state != "accepted" {
            return self.persist(journal, &record, |r| {
                r.checkpoint = "push-accepted".into();
                r.project_state = "published".into();
                r.push_state = "accepted".into();
                r.cleanup_state = "none".into();
                r.last_error = None;
                finish_attempt(&mut r.attempt, "accepted");
            });
        }
        if facts.remote_conflict(&record) && record.push_state != "conflict" {
            return self.persist(journal, &record, |r| {
                r.checkpoint = "push-accepted".into();
                r.project_state = "published".into();
                r.push_state = "conflict".into();
                r.cleanup_state = "none".into();
                r.last_error = Some(stored(Code::RemoteRefConflict, false));
                finish_attempt(&mut r.attempt, "conflict");
            });
        }
        if matches!(record.push_state.as_str(), "uploading" | "confirming") {
            // The earlier local execution has ended: its result is unknown.
            return self.persist(journal, &record, |r| {
                r.push_state = "uncertain".into();
                finish_attempt(&mut r.attempt, "uncertain");
            });
        }
        Ok(record)
    }
    fn check_identity(
        record: &Record,
        request: &Request,
        context: &Context,
    ) -> Result<(), PublishError> {
        if record.api_base_url != request.api_base_url
            || record.user_id != request.user_id
            || record.repository_fingerprint != context.fingerprint
        {
            return Err(PublishError::new(
                Code::IdentityMismatch,
                "Cloud initialization does not match this account or Git repository.",
                false,
            ));
        }
        Ok(())
    }
    /// `getState`: the pending operation, reconciled with Cloud.
    pub fn state(&self, request: &Request) -> Outcome {
        let context = match self.context(&request.root) {
            Ok(c) => c,
            Err(e) => return failure(e, None, None),
        };
        let record = match context.journal.read() {
            Ok(Some(record)) => record,
            Ok(None) => return success(None, None, None),
            Err(e) => return failure(e, None, None),
        };
        let result = (|| {
            Self::check_identity(&record, request, &context)?;
            let facts = self.facts(&request.root, &record)?;
            let record = self.remote_truth(&context.journal, record.clone(), &facts)?;
            if record.push_state == "accepted" {
                return Ok(self.finish(&request.root, &context, record));
            }
            let state = self.project_state(&record, &facts);
            Ok(success(Some(state), Some(record), None))
        })();
        result.unwrap_or_else(|e| {
            let facts = self.local_facts(&request.root, &record);
            failure(e, Some(self.project_state(&record, &facts)), Some(record))
        })
    }
    /// `startOrResume`: begin, or continue from the durable checkpoint.
    pub fn start(&self, request: &Request, progress: &mut dyn FnMut(Stage)) -> Outcome {
        progress(Stage::Validating);
        if !valid_branch(&request.source_branch) {
            return failure(
                PublishError::new(
                    Code::BranchRequired,
                    "Select a local Git branch before publishing.",
                    false,
                ),
                None,
                None,
            );
        }
        if request.organization_id.trim().is_empty() {
            return failure(
                PublishError::new(
                    Code::OrganizationRequired,
                    "Select a PuppyOne organization before publishing.",
                    false,
                ),
                None,
                None,
            );
        }
        let context = match self.context(&request.root) {
            Ok(c) => c,
            Err(e) => return failure(e, None, None),
        };
        let mut latest: Option<Record> = None;
        let result = self.run(request, &context, progress, &mut latest);
        match result {
            Ok(outcome) => outcome,
            Err(error) => {
                let failed = context
                    .journal
                    .read()
                    .ok()
                    .flatten()
                    .or(latest)
                    .map(|r| self.persist_failure(&context.journal, r, &error));
                let state = failed.as_ref().map(|r| {
                    let facts = self.local_facts(&request.root, r);
                    self.project_state(r, &facts)
                });
                failure(error, state, failed)
            }
        }
    }
    fn run(
        &self,
        request: &Request,
        context: &Context,
        progress: &mut dyn FnMut(Stage),
        latest: &mut Option<Record>,
    ) -> Result<Outcome, PublishError> {
        let root = &request.root;
        let journal = &context.journal;
        let mut record = match journal.read()? {
            None => {
                let status = self.git.status(root)?;
                if status.head.is_none() || status.commits < 1 {
                    return Err(PublishError::new(
                        Code::CommitRequired,
                        "Create a Git commit before publishing.",
                        false,
                    ));
                }
                if status.branch.as_deref() != Some(request.source_branch.as_str()) {
                    return Err(PublishError::new(
                        Code::BranchRequired,
                        "The selected source branch changed before initialization started.",
                        false,
                    ));
                }
                if self.git.remote(root)? != Remote::Missing {
                    return Err(PublishError::new(
                        Code::RemoteConflict,
                        "A Git remote named 'puppyone' already exists. Rename or remove it before publishing.",
                        false,
                    ));
                }
                let commit = self.git.source_commit(root, &request.source_branch)?;
                self.git.preflight(root, &commit)?;
                let record = initial_record(request, &context.fingerprint, &commit);
                journal.write(
                    &record,
                    Expect {
                        create_only: true,
                        ..Default::default()
                    },
                )?
            }
            Some(record) => {
                Self::check_identity(&record, request, context)?;
                if record.organization_id != request.organization_id
                    || record.project_name != request.project_name
                    || (request.action != Action::ChooseSource
                        && record.selected_source_branch != request.source_branch)
                    || request
                        .operation_id
                        .as_ref()
                        .is_some_and(|id| *id != record.operation_id)
                {
                    return Err(PublishError::new(
                        Code::IdentityMismatch,
                        "Request does not match the pending Cloud initialization.",
                        false,
                    ));
                }
                if matches!(
                    record.cleanup_state.as_str(),
                    "requested" | "deleting" | "failed"
                ) {
                    return Err(PublishError::new(
                        Code::CleanupFailed,
                        "This operation is deleting an empty Cloud Project. Finish cleanup to continue.",
                        true,
                    ));
                }
                let facts = self.facts(root, &record)?;
                let record = self.remote_truth(journal, record, &facts)?;
                if record.push_state == "accepted" {
                    return Ok(self.finish(root, context, record));
                }
                if record.push_state == "conflict" {
                    return Err(PublishError::new(
                        Code::RemoteRefConflict,
                        "Cloud main contains a different commit.",
                        false,
                    ));
                }
                let same_commit = publish::requires_same_commit_retry(&derive_projection(&record));
                if same_commit {
                    self.retry_attempt(root, journal, &record, None)?
                } else if request.action == Action::ChooseSource {
                    if !facts.source_missing {
                        return Err(PublishError::new(
                            Code::IdentityMismatch,
                            "The selected source branch still exists; source replacement is not available.",
                            false,
                        ));
                    }
                    self.retry_attempt(root, journal, &record, Some(&request.source_branch))?
                } else if record.last_error.is_some()
                    || matches!(request.action, Action::RetryPush | Action::PushLatest)
                {
                    self.retry_attempt(root, journal, &record, None)?
                } else {
                    record
                }
            }
        };
        *latest = Some(record.clone());
        if record.checkpoint == "prepared" {
            progress(Stage::CreatingProject);
            record = self.persist(journal, &record, |r| {
                r.project_state = "creating".into();
                r.last_error = None;
            })?;
            *latest = Some(record.clone());
            let project = self.cloud.create_project(&record)?;
            record = self.persist(journal, &record, |r| {
                r.checkpoint = "project-created".into();
                r.project_state = "empty".into();
                r.project_id = Some(project);
            })?;
            *latest = Some(record.clone());
        }
        if record.checkpoint == "project-created" {
            progress(Stage::SecuringCredential);
            let (next, secret) = self.ensure_secret(journal, record)?;
            record = next;
            *latest = Some(record.clone());
            let credential = self.cloud.issue_credential(&record, &secret)?;
            record = self.persist(journal, &record, |r| {
                r.checkpoint = "credential-issued".into();
                r.credential_id = Some(credential.id);
                r.canonical_remote_url = Some(credential.remote_url);
                r.credential_username = Some(credential.username);
            })?;
            *latest = Some(record.clone());
        }
        if record.checkpoint == "credential-issued" {
            record = self.configure_remote(root, journal, record, progress, "remote-configured")?;
            *latest = Some(record.clone());
        }
        if matches!(
            record.checkpoint.as_str(),
            "remote-configured" | "push-attempt"
        ) {
            // A remote removed by someone else is recreated, never rewound.
            let remote = self.git.remote(root)?;
            if remote != Remote::Exact(record.canonical_remote_url.clone().unwrap_or_default()) {
                if remote != Remote::Missing {
                    return Err(PublishError::new(
                        Code::RemoteConflict,
                        "Canonical PuppyOne Git remote has conflicting configuration.",
                        false,
                    ));
                }
                let checkpoint = record.checkpoint.clone();
                record = self.configure_remote(root, journal, record, progress, &checkpoint)?;
            }
            progress(Stage::CheckingRemote);
            record = self.persist(journal, &record, |r| {
                r.checkpoint = "push-attempt".into();
                r.push_state = "uploading".into();
                r.last_error = None;
                r.attempt.state = "uploading".into();
                r.attempt.updated_at = now_iso();
            })?;
            *latest = Some(record.clone());
            let secret = self.stored_secret(&record)?;
            progress(Stage::Uploading);
            self.git.push(root, &record, &secret)?;
            progress(Stage::Confirming);
            record = self.persist(journal, &record, |r| {
                r.checkpoint = "push-accepted".into();
                r.project_state = "published".into();
                r.push_state = "accepted".into();
                r.cleanup_state = "none".into();
                r.last_error = None;
                finish_attempt(&mut r.attempt, "accepted");
            })?;
            *latest = Some(record.clone());
        }
        progress(Stage::Finalizing);
        let outcome = self.finish(root, context, record);
        progress(Stage::Completed);
        Ok(outcome)
    }
    fn configure_remote(
        &self,
        root: &Path,
        journal: &Journal,
        mut record: Record,
        progress: &mut dyn FnMut(Stage),
        checkpoint: &str,
    ) -> Result<Record, PublishError> {
        progress(Stage::ConfiguringRemote);
        if record.credential_config_snapshot.is_none() {
            let config = self.git.prepare_credential_config(
                root,
                record.canonical_remote_url.as_deref().unwrap_or_default(),
                &record.operation_id,
            )?;
            record = self.persist(journal, &record, |r| {
                r.credential_config_snapshot = Some(config)
            })?;
        }
        if !record.remote_add_intent {
            if self.git.remote(root)? != Remote::Missing {
                return Err(PublishError::new(
                    Code::RemoteConflict,
                    "The canonical 'puppyone' remote appeared before this operation could claim it.",
                    false,
                ));
            }
            record = self.persist(journal, &record, |r| r.remote_add_intent = true)?;
        }
        let secret = self.stored_secret(&record)?;
        let created = self.git.configure_remote(root, &record, &secret)?;
        let checkpoint = checkpoint.to_owned();
        self.persist(journal, &record, |r| {
            r.checkpoint = checkpoint;
            r.remote_created_by_operation = r.remote_add_intent || created;
        })
    }
    /// `beginRetryAttempt`: a new physical attempt; an unresolved earlier
    /// send keeps its exact commit.
    fn retry_attempt(
        &self,
        root: &Path,
        journal: &Journal,
        record: &Record,
        source: Option<&str>,
    ) -> Result<Record, PublishError> {
        let preserve = publish::requires_same_commit_retry(&derive_projection(record));
        let branch = source.unwrap_or(&record.selected_source_branch).to_owned();
        let commit = if preserve {
            record.attempt.commit_oid.clone()
        } else {
            self.git.source_commit(root, &branch)?
        };
        self.git.preflight(root, &commit)?;
        let outcome = if preserve {
            "uncertain".to_owned()
        } else {
            terminal(&record.push_state).to_owned()
        };
        self.persist(journal, record, |r| {
            let mut previous = r.attempt.clone();
            finish_attempt(&mut previous, &outcome);
            r.attempt_history.push(previous);
            let excess = r.attempt_history.len().saturating_sub(20);
            r.attempt_history.drain(..excess);
            if !preserve {
                r.selected_source_branch = branch.clone();
                r.selected_source_ref = format!("refs/heads/{branch}");
            }
            r.attempt_count += 1;
            r.attempt = new_attempt(r.attempt_count, &commit);
            r.push_state = "preparing".into();
            r.last_error = None;
        })
    }
    /// `ensureCredentialSecret`: a `pwg_` secret generated here, stored in
    /// the keychain before the journal says it exists.
    fn ensure_secret(
        &self,
        journal: &Journal,
        mut record: Record,
    ) -> Result<(Record, String), PublishError> {
        if record.secret_ref.is_none() {
            let reference = self.vault.create_ref();
            record = self.persist(journal, &record, |r| {
                r.secret_ref = Some(reference);
                r.secret_stored = false;
            })?;
        }
        let reference = record.secret_ref.clone().unwrap_or_default();
        let secret = match self.vault.get(&reference).map_err(|_| {
            PublishError::new(
                Code::CredentialFailed,
                "Unable to read the protected Git credential.",
                false,
            )
        })? {
            Some(secret) => secret,
            None if record.secret_stored => {
                return Err(PublishError::new(
                    Code::CredentialFailed,
                    "Protected Git credential is unavailable.",
                    false,
                ));
            }
            None => {
                use base64::Engine as _;
                let mut bytes = [0u8; 32];
                getrandom::fill(&mut bytes).map_err(|_| {
                    PublishError::new(
                        Code::CredentialFailed,
                        "Unable to generate the Git credential.",
                        false,
                    )
                })?;
                let secret = format!(
                    "pwg_{}",
                    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
                );
                self.vault.put(&reference, &secret).map_err(|_| {
                    PublishError::new(
                        Code::CredentialFailed,
                        "Unable to protect the Git credential.",
                        false,
                    )
                })?;
                secret
            }
        };
        if !record.secret_stored {
            record = self.persist(journal, &record, |r| r.secret_stored = true)?;
        }
        Ok((record, secret))
    }
    fn stored_secret(&self, record: &Record) -> Result<String, PublishError> {
        let unavailable = || {
            PublishError::new(
                Code::CredentialFailed,
                "Protected Git credential is unavailable.",
                false,
            )
        };
        let reference = record
            .secret_ref
            .as_deref()
            .filter(|_| record.secret_stored)
            .ok_or_else(unavailable)?;
        self.vault
            .get(reference)
            .ok()
            .flatten()
            .ok_or_else(unavailable)
    }
    /// `persistFailure`: a retryable state, never a rollback.
    fn persist_failure(&self, journal: &Journal, record: Record, error: &PublishError) -> Record {
        if matches!(record.checkpoint.as_str(), "push-accepted" | "completed") {
            return record;
        }
        let mut push = "failed";
        if error.code == Code::PushUncertain
            || record
                .attempt_history
                .iter()
                .any(|a| a.state == "uncertain")
        {
            push = "uncertain";
        }
        if matches!(error.code, Code::RemoteRefConflict | Code::RemoteConflict) {
            push = "conflict";
        }
        let code = error.code;
        let retryable = error.retryable;
        self.persist(journal, &record, |r| {
            if code == Code::ProjectUnavailable {
                r.project_state = "unavailable".into();
            }
            r.push_state = push.into();
            r.last_error = Some(stored(code, retryable));
            finish_attempt(&mut r.attempt, terminal(push));
        })
        .unwrap_or(record)
    }
    /// `finishAcceptedOperation`: upstream and tracking ref, then the journal
    /// and the secret go away. A local finalization failure is not a publish
    /// failure.
    fn finish(&self, root: &Path, context: &Context, record: Record) -> Outcome {
        let _ = self.git.finalize(root, &record);
        let record = if record.checkpoint != "completed" {
            self.persist(&context.journal, &record, |r| {
                r.checkpoint = "completed".into();
                r.project_state = "published".into();
                r.push_state = "accepted".into();
                r.cleanup_state = "none".into();
                r.last_error = None;
            })
            .unwrap_or(record)
        } else {
            record
        };
        let status = self.git.status(root).unwrap_or_default();
        let state = derive(
            &record,
            &status,
            Some(&record.attempt.commit_oid),
            false,
            false,
            true,
            false,
        );
        if let Some(reference) = &record.secret_ref {
            let _ = self.vault.clear(reference);
        }
        let _ = context.journal.clear(Expect::of(&record));
        let project = record.project_id.clone();
        Outcome {
            ok: true,
            state: Some(state),
            record: None,
            error: None,
            project,
        }
    }
    /// `cleanup`: delete the empty Cloud Project this operation created,
    /// revoke its credential and remove what it configured locally. Only a
    /// definite refusal clears the cleanup intent; a lost response keeps it.
    pub fn cleanup(&self, request: &Request) -> Outcome {
        let context = match self.context(&request.root) {
            Ok(c) => c,
            Err(e) => return failure(e, None, None),
        };
        let record = match context.journal.read() {
            Ok(Some(r)) => r,
            Ok(None) => return success(None, None, None),
            Err(e) => return failure(e, None, None),
        };
        let journal = &context.journal;
        let attempt = (|| -> Result<Outcome, PublishError> {
            Self::check_identity(&record, request, &context)?;
            if request.operation_id.as_deref() != Some(record.operation_id.as_str()) {
                return Err(PublishError::new(
                    Code::IdentityMismatch,
                    "Cleanup operation id does not match.",
                    false,
                ));
            }
            let local = self.local_facts(&request.root, &record);
            let facts = if record.checkpoint == "cleanup-server-complete"
                || !matches!(local.remote_kind, Some(Remote::Exact(_)))
                || local.local_remote_conflict
            {
                local
            } else {
                self.facts(&request.root, &record)?
            };
            let mut record = self.remote_truth(journal, record.clone(), &facts)?;
            if record.push_state == "accepted" {
                return Ok(self.finish(&request.root, &context, record));
            }
            if record.push_state == "conflict" || facts.remote_conflict(&record) {
                return Err(PublishError::new(
                    Code::RemoteRefConflict,
                    "Cloud main contains content, so this Project is no longer empty and cannot be deleted by initialization cleanup.",
                    false,
                ));
            }
            if record.cleanup_state == "none" {
                record = self.persist(journal, &record, |r| {
                    r.checkpoint = "cleanup-requested".into();
                    r.project_state = "deleting".into();
                    r.cleanup_state = "requested".into();
                    r.last_error = None;
                })?;
            }
            if record.project_id.is_some() && record.checkpoint != "cleanup-server-complete" {
                if !self.cloud.abandon_empty_project(&record)? {
                    // CLEANUP_NOT_ALLOWED: back to a sendable state, nothing
                    // deleted locally or in Cloud.
                    let checkpoint = if record.credential_config_snapshot.is_some() {
                        "push-attempt"
                    } else if record.credential_id.is_some() {
                        "credential-issued"
                    } else {
                        "project-created"
                    };
                    let refused = PublishError::new(
                        Code::CleanupNotAllowed,
                        "Cloud did not allow this Project to be discarded. Retry sending or manage it in Cloud.",
                        false,
                    );
                    let record = self.persist(journal, &record, |r| {
                        r.checkpoint = checkpoint.into();
                        r.project_state = "empty".into();
                        r.cleanup_state = "none".into();
                        r.last_error = Some(stored(Code::CleanupNotAllowed, false));
                    })?;
                    let facts = self.local_facts(&request.root, &record);
                    return Ok(failure(
                        refused,
                        Some(self.project_state(&record, &facts)),
                        Some(record),
                    ));
                }
                record = self.persist(journal, &record, |r| {
                    r.checkpoint = "cleanup-server-complete".into();
                    r.project_state = "deleted".into();
                    r.cleanup_state = "deleting".into();
                    r.last_error = None;
                })?;
            }
            self.cloud.revoke_credential(&record)?;
            self.git.cleanup(&request.root, &record)?;
            if let Some(reference) = &record.secret_ref {
                let _ = self.vault.clear(reference);
            }
            journal.clear(Expect::of(&record))?;
            Ok(success(None, None, None))
        })();
        attempt.unwrap_or_else(|error| {
            let latest = journal.read().ok().flatten().unwrap_or(record);
            let failed = if !matches!(latest.push_state.as_str(), "accepted" | "conflict") {
                let code = if error.code == Code::CompensationFailed {
                    Code::CleanupFailed
                } else {
                    error.code
                };
                self.persist(journal, &latest, |r| {
                    r.checkpoint = "cleanup-requested".into();
                    r.project_state = "deleting".into();
                    r.cleanup_state = "failed".into();
                    r.last_error = Some(stored(code, error.retryable));
                })
                .unwrap_or(latest)
            } else {
                latest
            };
            let facts = self.local_facts(&request.root, &failed);
            failure(
                error,
                Some(self.project_state(&failed, &facts)),
                Some(failed),
            )
        })
    }
}

fn derive_projection(record: &Record) -> publish::Record {
    publish::Record {
        project: publish::Project::from_journal(&record.project_state)
            .unwrap_or(publish::Project::Absent),
        push: state_of(&record.push_state).unwrap_or(publish::Push::Idle),
        cleanup: publish::Cleanup::from_journal(&record.cleanup_state)
            .unwrap_or(publish::Cleanup::None),
        selected_source_branch: record.selected_source_branch.clone(),
        attempt_commit: Some(record.attempt.commit_oid.clone()),
        attempt_history: record
            .attempt_history
            .iter()
            .filter_map(|a| state_of(&a.state))
            .collect(),
        last_error: record.last_error.as_ref().map(|e| e.code.clone()),
    }
}
fn terminal(state: &str) -> &str {
    if matches!(state, "accepted" | "failed" | "uncertain" | "conflict") {
        state
    } else {
        "failed"
    }
}
fn finish_attempt(attempt: &mut Attempt, state: &str) {
    let now = now_iso();
    attempt.state = state.into();
    attempt.updated_at = now.clone();
    attempt.completed_at = Some(now);
}
fn stored(code: Code, retryable: bool) -> StoredError {
    StoredError {
        code: code.as_str().into(),
        retryable,
        occurred_at: now_iso(),
    }
}
fn new_attempt(sequence: u32, commit: &str) -> Attempt {
    let now = now_iso();
    Attempt {
        attempt_id: uuid::Uuid::new_v4().to_string(),
        sequence,
        commit_oid: commit.to_owned(),
        expected_remote_oid: None,
        state: "preparing".into(),
        started_at: now.clone(),
        updated_at: now,
        completed_at: None,
    }
}
/// `createInitialRecord`.
fn initial_record(request: &Request, fingerprint: &str, commit: &str) -> Record {
    let now = now_iso();
    let origin = url::Url::parse(&request.api_base_url)
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_default();
    Record {
        version: 2,
        kind: "puppyone-cloud-initialization".into(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        revision: 0,
        checkpoint: "prepared".into(),
        api_base_url: request.api_base_url.clone(),
        api_origin: origin,
        user_id: request.user_id.clone(),
        organization_id: request.organization_id.clone(),
        project_name: request.project_name.clone(),
        create_payload: CreatePayload {
            org_id: request.organization_id.clone(),
            name: request.project_name.clone(),
            description: None,
        },
        repository_fingerprint: fingerprint.to_owned(),
        selected_source_branch: request.source_branch.clone(),
        selected_source_ref: format!("refs/heads/{}", request.source_branch),
        destination_ref: git::DESTINATION_REF.into(),
        project_state: "absent".into(),
        push_state: "preparing".into(),
        cleanup_state: "none".into(),
        project_id: None,
        credential_id: None,
        secret_ref: None,
        secret_stored: false,
        canonical_remote_url: None,
        credential_username: None,
        credential_config_snapshot: None,
        remote_add_intent: false,
        remote_created_by_operation: false,
        attempt_count: 1,
        attempt: new_attempt(1, commit),
        attempt_history: vec![],
        last_error: None,
        migrated_from: None,
        created_at: now.clone(),
        updated_at: now,
    }
}
fn success(
    state: Option<publish::State>,
    record: Option<Record>,
    project: Option<String>,
) -> Outcome {
    Outcome {
        ok: true,
        state,
        record,
        error: None,
        project,
    }
}
fn failure(error: PublishError, state: Option<publish::State>, record: Option<Record>) -> Outcome {
    Outcome {
        ok: false,
        state,
        record,
        error: Some(error),
        project: None,
    }
}

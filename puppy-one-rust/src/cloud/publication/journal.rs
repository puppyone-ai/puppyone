//! `cloud-publish-journal.mjs` + `journal/schema-v2.mjs`: the durable,
//! worktree-specific write-ahead log of one first publication, kept in Git's
//! own git-dir (`puppyone/pending-cloud-publish.v1.json`, schema v2 inside).
//! Writes are compare-and-swap on the operation id, revision and checkpoint
//! under a lock file; the file is 0600 in a 0700 directory and atomically
//! replaced.
use super::{Code, PublishError};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub const FILENAME: &str = "pending-cloud-publish.v1.json";
const MAX_BYTES: u64 = 128 * 1024;
const LOCK_TIMEOUT: Duration = Duration::from_secs(5);
const LOCK_STALE: Duration = Duration::from_secs(30);

/// `CLOUD_INITIALIZATION_CHECKPOINTS`, in order.
pub const CHECKPOINTS: [&str; 9] = [
    "prepared",
    "project-created",
    "credential-issued",
    "remote-configured",
    "push-attempt",
    "push-accepted",
    "cleanup-requested",
    "cleanup-server-complete",
    "completed",
];
const PROJECT_STATES: [&str; 7] = [
    "absent",
    "creating",
    "empty",
    "published",
    "deleting",
    "deleted",
    "unavailable",
];
const PUSH_STATES: [&str; 8] = [
    "idle",
    "preparing",
    "uploading",
    "confirming",
    "accepted",
    "failed",
    "uncertain",
    "conflict",
];
const CLEANUP_STATES: [&str; 5] = ["none", "requested", "deleting", "failed", "completed"];
const ATTEMPT_STATES: [&str; 7] = [
    "preparing",
    "uploading",
    "confirming",
    "accepted",
    "failed",
    "uncertain",
    "conflict",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreatePayload {
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attempt {
    pub attempt_id: String,
    pub sequence: u32,
    pub commit_oid: String,
    pub expected_remote_oid: Option<String>,
    pub state: String,
    pub started_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredError {
    pub code: String,
    pub retryable: bool,
    pub occurred_at: String,
}
/// The URL-scoped credential helper configuration this operation installs
/// (`normalizeCredentialConfigSnapshot`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialConfig {
    pub version: u32,
    pub scope_url: String,
    pub helper: String,
    pub previous_helpers: Vec<String>,
    pub previous_use_http_path: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Migration {
    pub version: u32,
    pub phase: String,
    pub migrated_at: String,
    pub persisted: bool,
}
/// Schema v2 (`normalizeCloudInitializationJournalRecord`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub version: u32,
    pub kind: String,
    pub operation_id: String,
    pub revision: u64,
    pub checkpoint: String,
    pub api_base_url: String,
    pub api_origin: String,
    pub user_id: String,
    pub organization_id: String,
    pub project_name: String,
    pub create_payload: CreatePayload,
    pub repository_fingerprint: String,
    pub selected_source_branch: String,
    pub selected_source_ref: String,
    pub destination_ref: String,
    pub project_state: String,
    pub push_state: String,
    pub cleanup_state: String,
    pub project_id: Option<String>,
    pub credential_id: Option<String>,
    pub secret_ref: Option<String>,
    pub secret_stored: bool,
    pub canonical_remote_url: Option<String>,
    pub credential_username: Option<String>,
    pub credential_config_snapshot: Option<CredentialConfig>,
    pub remote_add_intent: bool,
    pub remote_created_by_operation: bool,
    pub attempt_count: u32,
    pub attempt: Attempt,
    pub attempt_history: Vec<Attempt>,
    pub last_error: Option<StoredError>,
    pub migrated_from: Option<Migration>,
    pub created_at: String,
    pub updated_at: String,
}

fn corrupt(field: &str) -> PublishError {
    PublishError::new(
        Code::JournalCorrupt,
        format!("Cloud initialization journal field '{field}' is invalid."),
        false,
    )
}
fn uuid_v4(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|u| u.get_version_num() == 4)
        && value == value.to_lowercase()
}
pub fn commit_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn iso(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}
impl Attempt {
    fn validate(&self, history: bool) -> Result<(), PublishError> {
        if !uuid_v4(&self.attempt_id) {
            return Err(corrupt("attempt.attempt_id"));
        }
        if self.sequence < 1 || !commit_id(&self.commit_oid) {
            return Err(corrupt("attempt"));
        }
        if !ATTEMPT_STATES.contains(&self.state.as_str())
            || (history
                && !["accepted", "failed", "uncertain", "conflict"].contains(&self.state.as_str()))
        {
            return Err(corrupt("attempt.state"));
        }
        if !iso(&self.started_at) || !iso(&self.updated_at) {
            return Err(corrupt("attempt.started_at"));
        }
        Ok(())
    }
}
impl Record {
    /// `normalizeCloudInitializationJournalRecord` for schema v2; version 1
    /// is migrated first.
    pub fn decode(value: serde_json::Value) -> Result<Self, PublishError> {
        let value = if value["version"] == 1 && value["kind"] == "puppyone-cloud-publish" {
            super::migrate::version1(&value)?
        } else {
            value
        };
        let record: Self = serde_json::from_value(value).map_err(|_| corrupt("record"))?;
        record.validate()?;
        Ok(record)
    }
    pub fn validate(&self) -> Result<(), PublishError> {
        if self.version != 2 || self.kind != "puppyone-cloud-initialization" {
            return Err(corrupt("version"));
        }
        if !uuid_v4(&self.operation_id) {
            return Err(corrupt("operation_id"));
        }
        for (field, value) in [
            ("api_base_url", &self.api_base_url),
            ("api_origin", &self.api_origin),
            ("user_id", &self.user_id),
            ("organization_id", &self.organization_id),
            ("project_name", &self.project_name),
            ("repository_fingerprint", &self.repository_fingerprint),
            ("selected_source_branch", &self.selected_source_branch),
        ] {
            if value.trim().is_empty() {
                return Err(corrupt(field));
            }
        }
        if self.selected_source_ref != format!("refs/heads/{}", self.selected_source_branch)
            || self.destination_ref != "refs/heads/main"
        {
            return Err(corrupt("refs"));
        }
        if self.create_payload.org_id != self.organization_id
            || self.create_payload.name != self.project_name
            || self.create_payload.description.is_some()
        {
            return Err(corrupt("create_payload"));
        }
        if !CHECKPOINTS.contains(&self.checkpoint.as_str()) {
            return Err(corrupt("checkpoint"));
        }
        if !PROJECT_STATES.contains(&self.project_state.as_str())
            || !PUSH_STATES.contains(&self.push_state.as_str())
            || !CLEANUP_STATES.contains(&self.cleanup_state.as_str())
        {
            return Err(corrupt("state"));
        }
        if self.secret_ref.as_deref().is_some_and(|r| !uuid_v4(r)) {
            return Err(corrupt("secret_ref"));
        }
        if self.attempt_count < 1 || self.attempt_history.len() > 20 {
            return Err(corrupt("attempt_count"));
        }
        self.attempt.validate(false)?;
        for attempt in &self.attempt_history {
            attempt.validate(true)?;
        }
        if let Some(error) = &self.last_error
            && Code::parse(&error.code).is_none()
        {
            return Err(corrupt("last_error.code"));
        }
        if !iso(&self.created_at) || !iso(&self.updated_at) {
            return Err(corrupt("created_at"));
        }
        Ok(())
    }
}

/// Expectations of a compare-and-swap write.
#[derive(Clone, Debug, Default)]
pub struct Expect {
    pub create_only: bool,
    pub operation_id: Option<String>,
    pub revision: Option<u64>,
    pub checkpoint: Option<String>,
}
impl Expect {
    pub fn of(record: &Record) -> Self {
        Self {
            create_only: false,
            operation_id: Some(record.operation_id.clone()),
            revision: Some(record.revision),
            checkpoint: Some(record.checkpoint.clone()),
        }
    }
}

/// The journal of one worktree (`<git-dir>/puppyone/`).
pub struct Journal {
    pub directory: PathBuf,
}
impl Journal {
    pub fn in_git_dir(git_dir: &Path) -> Self {
        Self {
            directory: git_dir.join("puppyone"),
        }
    }
    fn path(&self) -> PathBuf {
        self.directory.join(FILENAME)
    }
    pub fn read(&self) -> Result<Option<Record>, PublishError> {
        let path = self.path();
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(io_failed("inspect")),
        };
        #[cfg(unix)]
        let private = {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode() & 0o077 == 0
        };
        #[cfg(not(unix))]
        let private = true;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_BYTES
            || !private
        {
            return Err(PublishError::new(
                Code::JournalCorrupt,
                "Cloud Git operation journal is invalid.",
                false,
            ));
        }
        let bytes = std::fs::read(&path).map_err(|_| io_failed("read"))?;
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
            PublishError::new(
                Code::JournalCorrupt,
                "Cloud Git operation journal is corrupt.",
                false,
            )
        })?;
        Record::decode(value).map(Some)
    }
    pub fn write(&self, record: &Record, expect: Expect) -> Result<Record, PublishError> {
        record.validate()?;
        self.ensure_directory()?;
        self.locked(|| {
            let current = self.read()?;
            check_swap(current.as_ref(), &expect)?;
            if let Some(current) = &current
                && (record.revision <= current.revision
                    || record.operation_id != current.operation_id)
            {
                return Err(PublishError::new(
                    Code::IdentityMismatch,
                    "Cloud initialization journal update is not monotonic.",
                    false,
                ));
            }
            write_atomic(&self.path(), record)?;
            Ok(record.clone())
        })
    }
    pub fn clear(&self, expect: Expect) -> Result<(), PublishError> {
        if !self.directory.exists() {
            return Ok(());
        }
        self.locked(|| {
            let Some(current) = self.read()? else {
                return Ok(());
            };
            check_swap(Some(&current), &expect)?;
            std::fs::remove_file(self.path()).map_err(|_| io_failed("clear"))
        })
    }
    fn ensure_directory(&self) -> Result<(), PublishError> {
        std::fs::create_dir_all(&self.directory).map_err(|_| io_failed("create"))?;
        let metadata =
            std::fs::symlink_metadata(&self.directory).map_err(|_| io_failed("inspect"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(io_failed("directory"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                std::fs::set_permissions(&self.directory, std::fs::Permissions::from_mode(0o700));
        }
        Ok(())
    }
    fn locked<T>(
        &self,
        operation: impl FnOnce() -> Result<T, PublishError>,
    ) -> Result<T, PublishError> {
        let lock = self.directory.join(format!("{FILENAME}.lock"));
        let started = Instant::now();
        loop {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock)
            {
                Ok(mut file) => {
                    use std::io::Write as _;
                    let _ = writeln!(file, "{}", std::process::id());
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = std::fs::metadata(&lock)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .is_some_and(|age| age > LOCK_STALE);
                    if stale {
                        let _ = std::fs::remove_file(&lock);
                        continue;
                    }
                    if started.elapsed() >= LOCK_TIMEOUT {
                        return Err(PublishError::new(
                            Code::JournalIoFailed,
                            "Cloud Git operation journal is busy.",
                            false,
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => return Err(io_failed("lock")),
            }
        }
        let result = operation();
        let _ = std::fs::remove_file(&lock);
        result
    }
}
fn io_failed(what: &str) -> PublishError {
    PublishError::new(
        Code::JournalIoFailed,
        format!("Unable to {what} the Cloud Git operation journal."),
        false,
    )
}
fn check_swap(current: Option<&Record>, expect: &Expect) -> Result<(), PublishError> {
    let mismatch = || {
        PublishError::new(
            Code::IdentityMismatch,
            "A Cloud Git operation is already pending for this worktree.",
            false,
        )
    };
    if expect.create_only {
        return if current.is_none() {
            Ok(())
        } else {
            Err(mismatch())
        };
    }
    let Some(current) = current else {
        return Err(mismatch());
    };
    if expect
        .operation_id
        .as_ref()
        .is_some_and(|id| *id != current.operation_id)
        || expect.revision.is_some_and(|r| r != current.revision)
        || expect
            .checkpoint
            .as_ref()
            .is_some_and(|c| *c != current.checkpoint)
    {
        return Err(mismatch());
    }
    Ok(())
}
fn write_atomic(path: &Path, record: &Record) -> Result<(), PublishError> {
    let bytes = serde_json::to_vec_pretty(record).map_err(|_| io_failed("encode"))?;
    let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    let write = || -> std::io::Result<()> {
        use std::io::Write as _;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    };
    write().map_err(|_| {
        let _ = std::fs::remove_file(&temporary);
        io_failed("write")
    })
}

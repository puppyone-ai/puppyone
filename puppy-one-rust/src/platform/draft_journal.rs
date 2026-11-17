//! Local draft journal storage port (`DP-10`, `DP-11`).
//!
//! Persists drafts that cannot immediately land in their authoritative storage
//! (save failure, pending hosted conflict, `OutcomeUnknown`, offline or stale
//! lease) under `<app_data_dir>/draft-journal/<workspace_hash>/<resource_hash>.json`.
//!
//! Invariants:
//! - Atomic staging write (`0o600` on Unix) + `fsync` + `rename`.
//! - Bounded total journal size (`32 MiB` default) with oldest-`updated_at_ms`
//!   (LRU) eviction so abandoned entries cannot grow unboundedly.
//! - Zero credentials stored: workspace keys with embedded userinfo, query
//!   parameters or fragments are rejected.

use serde::{Deserialize, Serialize};
use std::{
    fmt,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

/// Default total byte cap across the entire draft journal (`32 MiB`).
pub const MAX_TOTAL_JOURNAL_BYTES: u64 = 32 * 1024 * 1024;

/// Why a draft was written to the local recovery journal (`DP-10`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraftReason {
    SaveFailed,
    ConflictPending,
    OutcomeUnknown,
    Offline,
    StaleLease,
}

impl DraftReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SaveFailed => "save_failed",
            Self::ConflictPending => "conflict_pending",
            Self::OutcomeUnknown => "outcome_unknown",
            Self::Offline => "offline",
            Self::StaleLease => "stale_lease",
        }
    }
}

/// One persisted recovery draft (`<workspace_hash>/<resource_hash>.json`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftEntry {
    /// Credential-free workspace storage identifier (for example `file:///…/` or `https://…/`).
    pub workspace_key: String,
    /// Stable resource key within the workspace.
    pub resource_key: String,
    /// Relative path inside the workspace.
    pub path: PathBuf,
    /// Baseline content hash / revision token recorded when the draft diverged.
    pub baseline_hash: String,
    /// Unsaved UTF-8 document text.
    pub draft_text: String,
    /// Persistence blocker that triggered journaling.
    pub reason: DraftReason,
    /// Unix timestamp in milliseconds when this entry was updated (drives LRU eviction).
    pub updated_at_ms: u64,
}

#[derive(Debug)]
pub enum DraftJournalError {
    InvalidKey(&'static str),
    CredentialRejected,
    EntryTooLarge { size: u64, limit: u64 },
    CorruptEntry(String),
    Io(std::io::Error),
}

impl fmt::Display for DraftJournalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidKey(msg) => f.write_str(msg),
            Self::CredentialRejected => {
                f.write_str("Draft journal refuses keys containing credentials or query tokens")
            }
            Self::EntryTooLarge { size, limit } => {
                write!(
                    f,
                    "Draft entry ({size} bytes) exceeds journal limit ({limit} bytes)"
                )
            }
            Self::CorruptEntry(detail) => write!(f, "Corrupt draft journal entry: {detail}"),
            Self::Io(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for DraftJournalError {}

impl From<std::io::Error> for DraftJournalError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

/// Self-contained atomic disk store for unsaved document drafts.
#[derive(Clone, Debug)]
pub struct DraftJournal {
    base_dir: PathBuf,
    max_bytes: u64,
}

impl DraftJournal {
    /// Journal rooted at `<app_data_dir>/draft-journal` with the `32 MiB` cap.
    pub fn native() -> Self {
        Self::new(super::data_dir().join("draft-journal"))
    }

    /// Journal rooted at `base_dir` with [`MAX_TOTAL_JOURNAL_BYTES`].
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self::with_max_bytes(base_dir, MAX_TOTAL_JOURNAL_BYTES)
    }

    /// Journal rooted at `base_dir` with an explicit total byte budget.
    pub fn with_max_bytes(base_dir: impl Into<PathBuf>, max_bytes: u64) -> Self {
        Self {
            base_dir: base_dir.into(),
            max_bytes,
        }
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    pub fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    fn workspace_dir(&self, workspace_key: &str) -> PathBuf {
        let hash = blake3::hash(workspace_key.as_bytes()).to_hex();
        self.base_dir.join(hash.as_str())
    }

    fn entry_path(&self, workspace_key: &str, resource_key: &str) -> PathBuf {
        let resource_hash = blake3::hash(resource_key.as_bytes()).to_hex();
        self.workspace_dir(workspace_key)
            .join(format!("{}.json", resource_hash.as_str()))
    }

    /// Atomically persists `entry` and evicts oldest entries if total journal
    /// usage exceeds `max_bytes`.
    pub fn write_entry(&self, entry: &DraftEntry) -> Result<(), DraftJournalError> {
        validate_keys(&entry.workspace_key, &entry.resource_key)?;
        let bytes = serde_json::to_vec(entry)
            .map_err(|e| DraftJournalError::CorruptEntry(e.to_string()))?;
        if bytes.len() as u64 > self.max_bytes {
            return Err(DraftJournalError::EntryTooLarge {
                size: bytes.len() as u64,
                limit: self.max_bytes,
            });
        }

        let ws_dir = self.workspace_dir(&entry.workspace_key);
        create_private_dir_all(&ws_dir)?;
        let target = self.entry_path(&entry.workspace_key, &entry.resource_key);
        let temp = ws_dir.join(format!(".draft-{}.tmp", Uuid::new_v4()));

        let write_result = (|| -> std::io::Result<()> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temp, &target)?;
            sync_dir_best_effort(&ws_dir);
            Ok(())
        })();

        if let Err(err) = write_result {
            let _ = std::fs::remove_file(&temp);
            return Err(DraftJournalError::Io(err));
        }

        self.enforce_budget(Some(&target))?;
        Ok(())
    }

    /// Reads one recovery entry if present and matching `(workspace_key, resource_key)`.
    pub fn read_entry(
        &self,
        workspace_key: &str,
        resource_key: &str,
    ) -> Result<Option<DraftEntry>, DraftJournalError> {
        validate_keys(workspace_key, resource_key)?;
        let path = self.entry_path(workspace_key, resource_key);
        let Some(entry) = self.read_entry_file(&path)? else {
            return Ok(None);
        };
        if entry.workspace_key != workspace_key || entry.resource_key != resource_key {
            return Ok(None);
        }
        Ok(Some(entry))
    }

    /// Deletes one recovery entry (after successful save or explicit discard).
    /// Returns `true` when an entry existed and was removed.
    pub fn remove_entry(
        &self,
        workspace_key: &str,
        resource_key: &str,
    ) -> Result<bool, DraftJournalError> {
        validate_keys(workspace_key, resource_key)?;
        let path = self.entry_path(workspace_key, resource_key);
        let existed = match std::fs::remove_file(&path) {
            Ok(()) => true,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => false,
            Err(err) => return Err(DraftJournalError::Io(err)),
        };
        if let Some(parent) = path.parent() {
            prune_if_empty(parent);
        }
        Ok(existed)
    }

    /// Lists every valid recovery entry recorded for `workspace_key`, sorted
    /// oldest-to-newest by `(updated_at_ms, resource_key)`. Corrupt files are
    /// skipped so recovery never blocks opening a workspace (`DP-11`).
    pub fn list_workspace_entries(
        &self,
        workspace_key: &str,
    ) -> Result<Vec<DraftEntry>, DraftJournalError> {
        validate_workspace_key(workspace_key)?;
        let ws_dir = self.workspace_dir(workspace_key);
        let dir_iter = match std::fs::read_dir(&ws_dir) {
            Ok(iter) => iter,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(DraftJournalError::Io(err)),
        };
        let mut entries = Vec::new();
        for item in dir_iter {
            let Ok(item) = item else { continue };
            let path = item.path();
            if !is_entry_json(&path) {
                continue;
            }
            if let Ok(Some(entry)) = self.read_entry_file(&path)
                && entry.workspace_key == workspace_key
            {
                entries.push(entry);
            }
        }
        entries.sort_by(|a, b| {
            a.updated_at_ms
                .cmp(&b.updated_at_ms)
                .then_with(|| a.resource_key.cmp(&b.resource_key))
        });
        Ok(entries)
    }

    /// Clears all non-local (hosted / Cloud / remote) draft entries on sign-out,
    /// keeping local `file://` drafts intact (`DP-10` / edge cases).
    /// Returns the number of removed entries.
    pub fn clear_hosted_entries(&self) -> Result<usize, DraftJournalError> {
        let root_iter = match std::fs::read_dir(&self.base_dir) {
            Ok(iter) => iter,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(err) => return Err(DraftJournalError::Io(err)),
        };
        let mut removed = 0usize;
        for ws_item in root_iter {
            let Ok(ws_item) = ws_item else { continue };
            let ws_path = ws_item.path();
            if !ws_path.is_dir() {
                continue;
            }
            let Ok(files) = std::fs::read_dir(&ws_path) else {
                continue;
            };
            for file_item in files {
                let Ok(file_item) = file_item else { continue };
                let file_path = file_item.path();
                if !is_entry_json(&file_path) {
                    continue;
                }
                let hosted = match self.read_entry_file(&file_path) {
                    Ok(Some(entry)) => is_hosted_workspace_key(&entry.workspace_key),
                    _ => false,
                };
                if hosted && std::fs::remove_file(&file_path).is_ok() {
                    removed += 1;
                }
            }
            prune_if_empty(&ws_path);
        }
        Ok(removed)
    }

    /// Current total size in bytes of all persisted `.json` journal entries.
    pub fn total_bytes(&self) -> Result<u64, DraftJournalError> {
        Ok(self
            .collect_entry_files()?
            .into_iter()
            .map(|item| item.size)
            .sum())
    }

    fn read_entry_file(&self, path: &Path) -> Result<Option<DraftEntry>, DraftJournalError> {
        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(DraftJournalError::Io(err)),
        };
        let cap = self.max_bytes.saturating_add(1);
        let mut bytes = Vec::new();
        file.take(cap).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > self.max_bytes {
            return Err(DraftJournalError::EntryTooLarge {
                size: bytes.len() as u64,
                limit: self.max_bytes,
            });
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| DraftJournalError::CorruptEntry(e.to_string()))
    }

    fn collect_entry_files(&self) -> Result<Vec<StoredFile>, DraftJournalError> {
        let root_iter = match std::fs::read_dir(&self.base_dir) {
            Ok(iter) => iter,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(DraftJournalError::Io(err)),
        };
        let mut files = Vec::new();
        for ws_item in root_iter {
            let Ok(ws_item) = ws_item else { continue };
            let ws_path = ws_item.path();
            if !ws_path.is_dir() {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&ws_path) else {
                continue;
            };
            for item in entries {
                let Ok(item) = item else { continue };
                let path = item.path();
                if !is_entry_json(&path) {
                    continue;
                }
                let Ok(meta) = std::fs::symlink_metadata(&path) else {
                    continue;
                };
                if !meta.is_file() {
                    continue;
                }
                let updated_at_ms = self
                    .read_entry_file(&path)
                    .ok()
                    .flatten()
                    .map_or(0, |entry| entry.updated_at_ms);
                files.push(StoredFile {
                    path,
                    size: meta.len(),
                    updated_at_ms,
                });
            }
        }
        Ok(files)
    }

    fn enforce_budget(&self, protected: Option<&Path>) -> Result<(), DraftJournalError> {
        let mut files = self.collect_entry_files()?;
        let mut total: u64 = files.iter().map(|f| f.size).sum();
        if total <= self.max_bytes {
            return Ok(());
        }
        // Evict oldest `updated_at_ms` first (corrupt entries have `0` and go first).
        files.sort_by(|a, b| {
            a.updated_at_ms
                .cmp(&b.updated_at_ms)
                .then_with(|| a.path.cmp(&b.path))
        });
        for file in files {
            if total <= self.max_bytes {
                break;
            }
            if protected.is_some_and(|keep| keep == file.path) {
                continue;
            }
            if std::fs::remove_file(&file.path).is_ok() {
                total = total.saturating_sub(file.size);
                if let Some(parent) = file.path.parent() {
                    prune_if_empty(parent);
                }
            }
        }
        Ok(())
    }
}

struct StoredFile {
    path: PathBuf,
    size: u64,
    updated_at_ms: u64,
}

/// Convenience wrapper over [`DraftJournal::native`].
pub fn write_entry(entry: &DraftEntry) -> Result<(), DraftJournalError> {
    DraftJournal::native().write_entry(entry)
}

/// Convenience wrapper over [`DraftJournal::native`].
pub fn read_entry(
    workspace_key: &str,
    resource_key: &str,
) -> Result<Option<DraftEntry>, DraftJournalError> {
    DraftJournal::native().read_entry(workspace_key, resource_key)
}

/// Convenience wrapper over [`DraftJournal::native`].
pub fn remove_entry(workspace_key: &str, resource_key: &str) -> Result<bool, DraftJournalError> {
    DraftJournal::native().remove_entry(workspace_key, resource_key)
}

/// Convenience wrapper over [`DraftJournal::native`].
pub fn list_workspace_entries(workspace_key: &str) -> Result<Vec<DraftEntry>, DraftJournalError> {
    DraftJournal::native().list_workspace_entries(workspace_key)
}

/// Convenience wrapper over [`DraftJournal::native`].
pub fn clear_hosted_entries() -> Result<usize, DraftJournalError> {
    DraftJournal::native().clear_hosted_entries()
}

fn is_entry_json(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    !name.starts_with('.') && name.ends_with(".json")
}

fn is_hosted_workspace_key(workspace_key: &str) -> bool {
    match url::Url::parse(workspace_key) {
        Ok(url) => url.scheme() != "file",
        Err(_) => !workspace_key.starts_with("file://"),
    }
}

fn validate_workspace_key(workspace_key: &str) -> Result<(), DraftJournalError> {
    if workspace_key.trim().is_empty() || workspace_key.contains('\0') {
        return Err(DraftJournalError::InvalidKey("Workspace key is required"));
    }
    if let Ok(url) = url::Url::parse(workspace_key) {
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(DraftJournalError::CredentialRejected);
        }
    } else if workspace_key.contains('@') || workspace_key.contains('?') {
        return Err(DraftJournalError::CredentialRejected);
    }
    Ok(())
}

fn validate_keys(workspace_key: &str, resource_key: &str) -> Result<(), DraftJournalError> {
    validate_workspace_key(workspace_key)?;
    if resource_key.trim().is_empty() || resource_key.contains('\0') {
        return Err(DraftJournalError::InvalidKey("Resource key is required"));
    }
    if resource_key.contains("?token=") || resource_key.contains("Bearer ") {
        return Err(DraftJournalError::CredentialRejected);
    }
    Ok(())
}

fn create_private_dir_all(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

fn prune_if_empty(dir: &Path) {
    if std::fs::read_dir(dir).is_ok_and(|mut iter| iter.next().is_none()) {
        let _ = std::fs::remove_dir(dir);
    }
}

fn sync_dir_best_effort(dir: &Path) {
    #[cfg(unix)]
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry(
        workspace_key: &str,
        resource_key: &str,
        text: &str,
        updated_at_ms: u64,
    ) -> DraftEntry {
        DraftEntry {
            workspace_key: workspace_key.into(),
            resource_key: resource_key.into(),
            path: PathBuf::from(resource_key),
            baseline_hash: blake3::hash(b"baseline").to_hex().to_string(),
            draft_text: text.into(),
            reason: DraftReason::SaveFailed,
            updated_at_ms,
        }
    }

    #[test]
    fn write_read_list_and_remove_entries_under_hashed_layout() {
        let temp = tempfile::tempdir().unwrap();
        let journal = DraftJournal::new(temp.path());
        let ws = "file:///Users/alice/project/";
        let entry_a = sample_entry(ws, "docs/a.md", "unsaved a", 200);
        let entry_b = sample_entry(ws, "docs/b.md", "unsaved b", 100);

        journal.write_entry(&entry_a).unwrap();
        journal.write_entry(&entry_b).unwrap();

        let expected_path = temp
            .path()
            .join(blake3::hash(ws.as_bytes()).to_hex().as_str())
            .join(format!(
                "{}.json",
                blake3::hash(b"docs/a.md").to_hex().as_str()
            ));
        assert!(expected_path.is_file());

        assert_eq!(
            journal.read_entry(ws, "docs/a.md").unwrap(),
            Some(entry_a.clone())
        );
        assert_eq!(journal.read_entry(ws, "docs/missing.md").unwrap(), None);

        let listed = journal.list_workspace_entries(ws).unwrap();
        assert_eq!(listed, vec![entry_b.clone(), entry_a.clone()]);

        assert!(journal.remove_entry(ws, "docs/a.md").unwrap());
        assert!(!journal.remove_entry(ws, "docs/a.md").unwrap());
        assert_eq!(journal.read_entry(ws, "docs/a.md").unwrap(), None);
        assert!(journal.remove_entry(ws, "docs/b.md").unwrap());
        assert!(
            !temp
                .path()
                .join(blake3::hash(ws.as_bytes()).to_hex().as_str())
                .exists(),
            "empty workspace bucket directory should be pruned"
        );
    }

    #[test]
    fn lru_eviction_removes_oldest_entries_when_budget_is_exceeded() {
        let temp = tempfile::tempdir().unwrap();
        let ws = "file:///Users/alice/project/";
        let e1 = sample_entry(ws, "one.md", &"1".repeat(300), 1_000);
        let e2 = sample_entry(ws, "two.md", &"2".repeat(300), 2_000);
        let e3 = sample_entry(ws, "three.md", &"3".repeat(300), 3_000);

        let one_size = serde_json::to_vec(&e1).unwrap().len() as u64;
        // Cap holds two entries comfortably, but not three.
        let journal = DraftJournal::with_max_bytes(temp.path(), one_size * 2 + 32);

        journal.write_entry(&e1).unwrap();
        journal.write_entry(&e2).unwrap();
        assert!(journal.read_entry(ws, "one.md").unwrap().is_some());
        assert!(journal.read_entry(ws, "two.md").unwrap().is_some());

        journal.write_entry(&e3).unwrap();
        assert!(journal.total_bytes().unwrap() <= journal.max_bytes());
        assert_eq!(
            journal.read_entry(ws, "one.md").unwrap(),
            None,
            "oldest entry must be evicted first"
        );
        assert_eq!(journal.read_entry(ws, "two.md").unwrap(), Some(e2));
        assert_eq!(journal.read_entry(ws, "three.md").unwrap(), Some(e3));
    }

    #[test]
    fn clear_hosted_entries_removes_cloud_drafts_and_keeps_local_drafts() {
        let temp = tempfile::tempdir().unwrap();
        let journal = DraftJournal::new(temp.path());
        let local_ws = "file:///Users/alice/local-repo/";
        let cloud_ws = "https://api.puppyone.ai/projects/proj-123/";

        let local_entry = sample_entry(local_ws, "local.md", "keep local", 10);
        let mut cloud_entry = sample_entry(cloud_ws, "remote.md", "hosted conflict", 20);
        cloud_entry.reason = DraftReason::ConflictPending;

        journal.write_entry(&local_entry).unwrap();
        journal.write_entry(&cloud_entry).unwrap();

        let removed = journal.clear_hosted_entries().unwrap();
        assert_eq!(removed, 1);
        assert_eq!(
            journal.read_entry(local_ws, "local.md").unwrap(),
            Some(local_entry)
        );
        assert_eq!(journal.read_entry(cloud_ws, "remote.md").unwrap(), None);
    }

    #[test]
    fn rejects_credentials_and_tolerates_corrupt_sibling_files() {
        let temp = tempfile::tempdir().unwrap();
        let journal = DraftJournal::new(temp.path());

        for bad_ws in [
            "https://user:secret@api.puppyone.ai/projects/1/",
            "https://api.puppyone.ai/projects/1/?access_token=abc",
            "https://api.puppyone.ai/projects/1/#token=abc",
        ] {
            let entry = sample_entry(bad_ws, "a.md", "draft", 1);
            assert!(matches!(
                journal.write_entry(&entry),
                Err(DraftJournalError::CredentialRejected)
            ));
        }

        let ws = "file:///Users/alice/project/";
        let valid = sample_entry(ws, "good.md", "hello", 50);
        journal.write_entry(&valid).unwrap();
        let ws_dir = temp
            .path()
            .join(blake3::hash(ws.as_bytes()).to_hex().as_str());
        std::fs::write(ws_dir.join("corrupt.json"), b"{not valid json").unwrap();

        let listed = journal.list_workspace_entries(ws).unwrap();
        assert_eq!(listed, vec![valid]);
    }
}

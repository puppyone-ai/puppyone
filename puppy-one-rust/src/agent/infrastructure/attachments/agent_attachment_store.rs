//! `infrastructure/attachments/agent-attachment-store.mjs`: Main-owned,
//! process-scoped immutable snapshots for external Agent inputs. A
//! snapshot's opaque grant is bound to its owner, workspace and draft
//! epoch, leased by one turn at a time, expired after the TTL and swept
//! with the staging of exited processes.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::ports::{AttachmentStore, Pending};
use crate::agent::contract::js;
use crate::agent::event_loop::{SharedTask, shared, spawn};
use base64::Engine;
use regex::Regex;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::LazyLock;

const MAX_REFERENCES: usize = 32;
const MAX_REFERENCE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES: u64 = 25 * 1024 * 1024;
const DEFAULT_TTL_MS: i64 = 30 * 60_000;
const COPY_CHUNK_BYTES: usize = 64 * 1024;

/// `agentAttachmentStoreLimits`.
pub mod limits {
    pub const MAX_REFERENCES: usize = super::MAX_REFERENCES;
    pub const MAX_REFERENCE_BYTES: u64 = super::MAX_REFERENCE_BYTES;
    pub const MAX_TOTAL_REFERENCE_BYTES: u64 = super::MAX_TOTAL_REFERENCE_BYTES;
    pub const DEFAULT_TTL_MS: i64 = super::DEFAULT_TTL_MS;
}

static OPAQUE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));
static CONTROL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\x00-\x1f\x7f]").expect("pattern"));
static INLINE_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\\/\x00-\x1f\x7f]").expect("pattern"));

/// What `sameFileSnapshot` compares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileSnapshot {
    pub is_file: bool,
    pub size: u64,
    pub modified_ns: i128,
    pub ino: u64,
    pub dev: u64,
}

impl FileSnapshot {
    pub fn of(metadata: &std::fs::Metadata) -> Self {
        let modified_ns = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_nanos() as i128);
        #[cfg(unix)]
        let (ino, dev) = {
            use std::os::unix::fs::MetadataExt;
            (metadata.ino(), metadata.dev())
        };
        #[cfg(not(unix))]
        let (ino, dev) = (0, 0);
        Self {
            is_file: metadata.is_file(),
            size: metadata.len(),
            modified_ns,
            ino,
            dev,
        }
    }
}

/// `handle.stat()` of an opened source (injectable for TOCTOU tests).
pub type SourceStat = Rc<dyn Fn(&std::fs::File) -> std::io::Result<FileSnapshot>>;

/// `createAgentAttachmentStore({ rootPath, now, ttlMs })`.
#[derive(Clone, Default)]
pub struct AttachmentStoreOptions {
    pub root_path: PathBuf,
    pub now: Option<Rc<dyn Fn() -> i64>>,
    pub ttl_ms: Option<i64>,
    pub source_stat: Option<SourceStat>,
}

#[derive(Clone, Debug)]
struct Entry {
    id: String,
    token: String,
    owner_id: i64,
    workspace_root: String,
    epoch: String,
    snapshot_path: PathBuf,
    display_name: String,
    mime: String,
    size: u64,
    digest: String,
    expires_at: i64,
    lease_id: Option<String>,
    group_key: String,
}

struct Inner {
    root_path: PathBuf,
    process_directory: PathBuf,
    now: Rc<dyn Fn() -> i64>,
    ttl_ms: i64,
    source_stat: SourceStat,
    entries: RefCell<Vec<Entry>>,
    groups: RefCell<HashMap<String, (usize, u64)>>,
    initialization: RefCell<Option<SharedTask<AgentResult<()>>>>,
    sweep_task: RefCell<Option<tokio::task::JoinHandle<()>>>,
    closed: Cell<bool>,
}

/// The attachment staging store.
#[derive(Clone)]
pub struct AgentAttachmentStore(Rc<Inner>);

fn error(message: impl Into<String>) -> AgentError {
    AgentError::new(message)
}

fn owner(value: Option<&Value>) -> AgentResult<i64> {
    value
        .and_then(js::safe_integer)
        .filter(|id| *id > 0)
        .ok_or_else(|| error("Agent attachment owner is invalid."))
}

fn workspace(value: Option<&Value>) -> AgentResult<String> {
    value
        .and_then(Value::as_str)
        .filter(|root| crate::agent::node_path::is_absolute(root))
        .map(str::to_string)
        .ok_or_else(|| error("Agent attachment workspace is invalid."))
}

fn opaque(value: Option<&Value>, label: &str) -> AgentResult<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| OPAQUE_ID.is_match(id))
        .map(str::to_string)
        .ok_or_else(|| error(format!("{label} is invalid.")))
}

fn tokens(value: Option<&Value>) -> Vec<String> {
    let mut unique: Vec<String> = Vec::new();
    for token in value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if !unique.iter().any(|t| t == token) {
            unique.push(token.to_string());
        }
    }
    unique
}

/// One `stage` input: a path, or an inline name and bytes.
enum Input {
    Path(Value),
    Inline { name: String, bytes: Vec<u8> },
}

impl Input {
    fn path(&self) -> Option<&str> {
        match self {
            Self::Path(path) => path.as_str(),
            Self::Inline { .. } => None,
        }
    }
}

impl AgentAttachmentStore {
    /// `createAgentAttachmentStore(options)`.
    pub fn new(options: AttachmentStoreOptions) -> AgentResult<Self> {
        if !options.root_path.is_absolute() {
            return Err(
                error("Agent attachment staging requires an absolute root path.")
                    .with_name("TypeError"),
            );
        }
        let process_directory =
            options
                .root_path
                .join(format!("{}-{}", std::process::id(), uuid::Uuid::new_v4()));
        Ok(Self(Rc::new(Inner {
            root_path: options.root_path,
            process_directory,
            now: options.now.unwrap_or_else(|| Rc::new(js::now_ms)),
            ttl_ms: options.ttl_ms.unwrap_or(DEFAULT_TTL_MS),
            source_stat: options.source_stat.unwrap_or_else(|| {
                Rc::new(|file: &std::fs::File| Ok(FileSnapshot::of(&file.metadata()?)))
            }),
            entries: RefCell::default(),
            groups: RefCell::default(),
            initialization: RefCell::default(),
            sweep_task: RefCell::default(),
            closed: Cell::new(false),
        })))
    }

    fn now(&self) -> i64 {
        (self.0.now)()
    }

    /// `store.initialize()`.
    pub async fn initialize(&self) -> AgentResult<()> {
        let existing = self.0.initialization.borrow().clone();
        let task = match existing {
            Some(task) => task,
            None => {
                let store = self.clone();
                let task = shared(async move { store.initialize_once().await });
                *self.0.initialization.borrow_mut() = Some(task.clone());
                task
            }
        };
        task.await
    }

    async fn initialize_once(&self) -> AgentResult<()> {
        let inner = &self.0;
        create_private_directory(&inner.root_path)?;
        self.sweep_orphan_directories();
        create_private_directory(&inner.process_directory)?;
        let interval = inner.ttl_ms.clamp(1_000, 60_000) as u64;
        let weak = Rc::downgrade(&self.0);
        let task = spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(interval)).await;
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                AgentAttachmentStore(inner).sweep_expired().await;
            }
        });
        *inner.sweep_task.borrow_mut() = Some(task);
        Ok(())
    }

    fn assert_open(&self) -> AgentResult<()> {
        if self.0.closed.get() {
            return Err(error("Agent attachment staging is closed."));
        }
        Ok(())
    }

    /// `store.stage({ ownerId, workspaceRoot, epoch, sourcePaths, sources })`.
    pub async fn stage(&self, request: &Value) -> AgentResult<Vec<Value>> {
        self.assert_open()?;
        let owner_id = owner(request.get("ownerId"))?;
        let workspace_root = workspace(request.get("workspaceRoot"))?;
        let epoch = opaque(request.get("epoch"), "reference epoch")?;
        let sources = request.get("sources").filter(|v| !v.is_null());
        let paths = request.get("sourcePaths").filter(|v| !v.is_null());
        if sources.is_some() && paths.is_some() {
            return Err(error("Attachment sources are invalid."));
        }
        let selected: Option<Vec<Value>> = match (sources, paths) {
            (Some(sources), _) => sources.as_array().cloned(),
            (None, Some(paths)) => paths
                .as_array()
                .map(|paths| paths.iter().map(|path| json!({ "path": path })).collect()),
            (None, None) => None,
        };
        let Some(selected) = selected.filter(|s| !s.is_empty() && s.len() <= MAX_REFERENCES) else {
            return Err(error("Select between 1 and 32 attachment files."));
        };
        // Inline bytes are copied first. Only these bytes are granted; names
        // or MIME supplied by the Renderer never authorize a path.
        let mut inline_bytes = 0u64;
        let mut inputs = Vec::new();
        for input in &selected {
            if input.get("path").is_some() && input.get("bytes").is_none() {
                inputs.push(Input::Path(input["path"].clone()));
                continue;
            }
            let bytes = input.get("bytes").and_then(js::as_uint8array);
            let name = input.get("name").and_then(Value::as_str).unwrap_or("");
            let Some(bytes) = bytes.filter(|_| {
                input.get("path").is_none()
                    && !name.is_empty()
                    && js::len16(name) <= 512
                    && !INLINE_NAME.is_match(name)
            }) else {
                return Err(error("The inline attachment is invalid."));
            };
            if bytes.is_empty() {
                return Err(error("The selected attachment is empty."));
            }
            inline_bytes += bytes.len() as u64;
            if inline_bytes > MAX_TOTAL_REFERENCE_BYTES {
                return Err(error("Attachments exceed the 25 MB total safety limit."));
            }
            inputs.push(Input::Inline {
                name: name.to_string(),
                bytes,
            });
        }
        self.initialize().await?;
        self.sweep_expired().await;
        let mut result = Vec::new();
        let mut created = Vec::new();
        for input in &inputs {
            match self.stage_one(owner_id, &workspace_root, &epoch, input) {
                Ok((reference, entry, is_new)) => {
                    result.push(reference);
                    if is_new {
                        created.push(entry);
                    }
                }
                Err(failure) => {
                    self.revoke_entries(&created);
                    let paths: Vec<String> = inputs
                        .iter()
                        .filter_map(|input| input.path().map(str::to_string))
                        .collect();
                    return Err(error(safe_staging_error(
                        &failure.message,
                        &paths,
                        &self.0.process_directory,
                    )));
                }
            }
        }
        Ok(result)
    }

    fn stage_one(
        &self,
        owner_id: i64,
        workspace_root: &str,
        epoch: &str,
        input: &Input,
    ) -> AgentResult<(Value, Entry, bool)> {
        let inner = &self.0;
        let (mut source, source_lstat, source_path) = match input {
            Input::Inline { .. } => (None, None, None),
            Input::Path(path) => {
                let Some(path) = path
                    .as_str()
                    .filter(|p| crate::agent::node_path::is_absolute(p))
                else {
                    return Err(error("The selected attachment could not be resolved."));
                };
                let lstat = std::fs::symlink_metadata(path).ok();
                if !lstat
                    .as_ref()
                    .is_some_and(|m| !m.file_type().is_symlink() && m.is_file())
                {
                    return Err(error(
                        "Only regular, non-symbolic-link files can be attached.",
                    ));
                }
                let file = crate::agent::security::authorized_project_instructions::open_no_follow(
                    Path::new(path),
                )
                .map_err(|_| error("The selected attachment changed before it could be staged."))?;
                (
                    Some(file),
                    lstat.map(|m| FileSnapshot::of(&m)),
                    Some(path.to_string()),
                )
            }
        };
        let snapshot_path = inner
            .process_directory
            .join(format!("{}.snapshot", uuid::Uuid::new_v4()));
        let attempt = (|| -> AgentResult<(Value, Entry, bool)> {
            let before = match (source.as_ref(), input) {
                (Some(file), _) => Some((inner.source_stat)(file)?),
                _ => None,
            };
            let size = match (before.as_ref(), input) {
                (Some(before), _) => {
                    if !before.is_file {
                        return Err(error("Only regular files can be attached."));
                    }
                    if source_lstat.is_some_and(|lstat| !same_file_snapshot(&lstat, before)) {
                        return Err(error(
                            "The selected attachment changed before it could be staged.",
                        ));
                    }
                    before.size
                }
                (None, Input::Inline { bytes, .. }) => bytes.len() as u64,
                (None, Input::Path(_)) => 0,
            };
            if size > MAX_REFERENCE_BYTES {
                return Err(error("An attachment exceeds the 25 MB safety limit."));
            }
            let group_key = format!("{owner_id}\0{workspace_root}\0{epoch}");
            let mut destination = {
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                options.open(&snapshot_path)?
            };
            let mut hash = Sha256::new();
            let mut header: Vec<u8> = Vec::new();
            let mut buffer = vec![0u8; COPY_CHUNK_BYTES];
            let mut offset = 0u64;
            while offset < size {
                let length = (COPY_CHUNK_BYTES as u64).min(size - offset) as usize;
                let read = match (source.as_mut(), input) {
                    (Some(file), _) => {
                        file.seek(SeekFrom::Start(offset))?;
                        file.read(&mut buffer[..length])?
                    }
                    (None, Input::Inline { bytes, .. }) => {
                        let start = offset as usize;
                        buffer[..length].copy_from_slice(&bytes[start..start + length]);
                        length
                    }
                    (None, Input::Path(_)) => 0,
                };
                if read == 0 {
                    return Err(error(
                        "The selected attachment changed while it was being staged.",
                    ));
                }
                if header.len() < 16 {
                    header = buffer[..read.min(16)].to_vec();
                }
                hash.update(&buffer[..read]);
                destination.write_all(&buffer[..read])?;
                offset += read as u64;
            }
            let changed_after = match (source.as_ref(), before.as_ref()) {
                (Some(file), Some(before)) => {
                    !same_file_snapshot(before, &(inner.source_stat)(file)?)
                }
                _ => false,
            };
            if changed_after || offset != size {
                return Err(error(
                    "The selected attachment changed while it was being staged.",
                ));
            }
            destination.sync_all()?;
            drop(destination);
            let display_name = safe_display_name(match input {
                Input::Inline { name, .. } => Some(name.clone()),
                Input::Path(_) => source_path
                    .as_deref()
                    .and_then(|path| Path::new(path).file_name())
                    .map(|name| name.to_string_lossy().into_owned()),
            });
            let mime = infer_mime_type(&display_name, &header);
            let digest: String = hash
                .finalize()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            let duplicate = inner
                .entries
                .borrow()
                .iter()
                .find(|entry| {
                    entry.owner_id == owner_id
                        && entry.workspace_root == workspace_root
                        && entry.epoch == epoch
                        && entry.display_name == display_name
                        && entry.mime == mime
                        && entry.size == size
                        && entry.digest == digest
                })
                .cloned();
            if let Some(duplicate) = duplicate {
                let _ = std::fs::remove_file(&snapshot_path);
                return Ok((draft_for_entry(&duplicate), duplicate, false));
            }
            let (count, bytes) = inner
                .groups
                .borrow()
                .get(&group_key)
                .copied()
                .unwrap_or((0, 0));
            if count >= MAX_REFERENCES {
                return Err(error("Attachments exceed the 32-file safety limit."));
            }
            if bytes + size > MAX_TOTAL_REFERENCE_BYTES {
                return Err(error("Attachments exceed the 25 MB total safety limit."));
            }
            let mut token = [0u8; 32];
            getrandom::fill(&mut token).map_err(|e| error(e.to_string()))?;
            let created_at = self.now();
            let entry = Entry {
                id: format!("ref-{}", uuid::Uuid::new_v4()),
                token: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token),
                owner_id,
                workspace_root: workspace_root.to_string(),
                epoch: epoch.to_string(),
                snapshot_path: snapshot_path.clone(),
                display_name,
                mime,
                size,
                digest,
                expires_at: created_at + inner.ttl_ms,
                lease_id: None,
                group_key: group_key.clone(),
            };
            inner.entries.borrow_mut().push(entry.clone());
            inner
                .groups
                .borrow_mut()
                .insert(group_key, (count + 1, bytes + size));
            Ok((draft_for_entry(&entry), entry, true))
        })();
        if attempt.is_err() {
            let _ = std::fs::remove_file(&snapshot_path);
        }
        attempt
    }

    /// `store.authorize({ ownerId, workspaceRoot, epoch, references })`.
    pub async fn authorize(&self, request: &Value) -> AgentResult<Vec<Value>> {
        self.assert_open()?;
        let owner_id = owner(request.get("ownerId"))?;
        let workspace_root = workspace(request.get("workspaceRoot"))?;
        let epoch = opaque(request.get("epoch"), "reference epoch")?;
        self.initialize().await?;
        self.sweep_expired().await;
        let mut authorized = Vec::new();
        for reference in request["references"]
            .as_array()
            .into_iter()
            .flatten()
            .take(MAX_REFERENCES)
        {
            let token = reference.get("token").and_then(Value::as_str).unwrap_or("");
            let entry = self
                .0
                .entries
                .borrow()
                .iter()
                .find(|e| e.token == token)
                .cloned();
            let Some(entry) = entry.filter(|entry| {
                entry.owner_id == owner_id
                    && entry.workspace_root == workspace_root
                    && entry.epoch == epoch
                    && reference.get("id").and_then(Value::as_str) == Some(entry.id.as_str())
            }) else {
                return Err(error(
                    "An attachment grant is invalid, expired, or belongs to another workspace.",
                ));
            };
            if entry.lease_id.is_some() {
                return Err(error(
                    "An attachment grant is already in use by another turn.",
                ));
            }
            if entry.expires_at <= self.now() {
                self.revoke_entries(std::slice::from_ref(&entry));
                return Err(error("An attachment grant expired. Add the file again."));
            }
            let intact = std::fs::read(&entry.snapshot_path)
                .ok()
                .is_some_and(|bytes| {
                    bytes.len() as u64 == entry.size
                        && Sha256::digest(&bytes)
                            .iter()
                            .map(|byte| format!("{byte:02x}"))
                            .collect::<String>()
                            == entry.digest
                });
            if !intact {
                self.revoke_entries(std::slice::from_ref(&entry));
                return Err(error("A staged attachment is no longer available."));
            }
            authorized.push(json!({
                "authorized": true,
                "id": entry.id,
                "kind": "staged-attachment",
                "path": entry.snapshot_path.to_string_lossy(),
                "name": entry.display_name,
                "mime": entry.mime,
                "size": entry.size,
            }));
        }
        Ok(authorized)
    }

    /// `store.lease({ ownerId, workspaceRoot, epoch, tokens, leaseId })`.
    pub async fn lease(&self, request: &Value) -> AgentResult<Value> {
        self.assert_open()?;
        let owner_id = owner(request.get("ownerId"))?;
        let workspace_root = workspace(request.get("workspaceRoot"))?;
        let epoch = opaque(request.get("epoch"), "reference epoch")?;
        let lease_id = opaque(request.get("leaseId"), "reference lease")?;
        self.initialize().await?;
        self.sweep_expired().await;
        let tokens = tokens(request.get("tokens"));
        let mut entries = self.0.entries.borrow_mut();
        let eligible = tokens.iter().all(|token| {
            entries.iter().any(|entry| {
                entry.token == *token
                    && entry.owner_id == owner_id
                    && entry.workspace_root == workspace_root
                    && entry.epoch == epoch
                    && entry.lease_id.is_none()
            })
        });
        if !eligible {
            return Err(error("An attachment grant cannot be leased for this turn."));
        }
        for entry in entries
            .iter_mut()
            .filter(|entry| tokens.contains(&entry.token))
        {
            entry.lease_id = Some(lease_id.clone());
        }
        Ok(json!({ "leaseId": lease_id, "leased": tokens.len() }))
    }

    /// `store.releaseLease({ ownerId, workspaceRoot, tokens, leaseId })`.
    pub fn release_lease(&self, request: &Value) -> AgentResult<Value> {
        let owner_id = owner(request.get("ownerId"))?;
        let workspace_root = workspace(request.get("workspaceRoot"))?;
        let lease_id = request.get("leaseId").and_then(Value::as_str);
        let tokens = tokens(request.get("tokens"));
        let expires_at = self.now() + self.0.ttl_ms;
        let mut released = 0;
        for entry in self.0.entries.borrow_mut().iter_mut() {
            if tokens.contains(&entry.token)
                && entry.owner_id == owner_id
                && entry.workspace_root == workspace_root
                && entry.lease_id.as_deref() == lease_id
            {
                entry.lease_id = None;
                entry.expires_at = expires_at;
                released += 1;
            }
        }
        Ok(json!({ "released": released }))
    }

    fn matching(&self, request: &Value, include_leased: bool) -> AgentResult<Vec<Entry>> {
        let owner_id = owner(request.get("ownerId"))?;
        let workspace_root = workspace(request.get("workspaceRoot"))?;
        let tokens = tokens(request.get("tokens"));
        Ok(tokens
            .iter()
            .filter_map(|token| {
                self.0
                    .entries
                    .borrow()
                    .iter()
                    .find(|entry| {
                        entry.token == *token
                            && (include_leased || entry.lease_id.is_none())
                            && entry.owner_id == owner_id
                            && entry.workspace_root == workspace_root
                    })
                    .cloned()
            })
            .collect())
    }

    /// `store.revoke({ ownerId, workspaceRoot, tokens })`: a Renderer
    /// revocation cannot break a live lease.
    pub fn revoke(&self, request: &Value) -> AgentResult<Value> {
        let matches = self.matching(request, false)?;
        self.revoke_entries(&matches);
        Ok(json!({ "revoked": matches.len() }))
    }

    /// `store.revokeLeased({ ownerId, workspaceRoot, tokens })`: Main-only
    /// terminal cleanup.
    pub fn revoke_leased(&self, request: &Value) -> AgentResult<Value> {
        let matches = self.matching(request, true)?;
        self.revoke_entries(&matches);
        Ok(json!({ "revoked": matches.len() }))
    }

    /// `store.revokeOwner(ownerId)`.
    pub fn revoke_owner(&self, owner_id: i64) {
        let matches: Vec<Entry> = self
            .0
            .entries
            .borrow()
            .iter()
            .filter(|entry| entry.owner_id == owner_id)
            .cloned()
            .collect();
        self.revoke_entries(&matches);
    }

    /// `store.revokeWorkspace(ownerId, workspaceRoot)`.
    pub fn revoke_workspace(&self, owner_id: i64, workspace_root: &str) -> AgentResult<()> {
        owner(Some(&Value::from(owner_id)))?;
        workspace(Some(&Value::from(workspace_root)))?;
        let matches: Vec<Entry> = self
            .0
            .entries
            .borrow()
            .iter()
            .filter(|entry| entry.owner_id == owner_id && entry.workspace_root == workspace_root)
            .cloned()
            .collect();
        self.revoke_entries(&matches);
        Ok(())
    }

    /// `store.sweepExpired()`.
    pub async fn sweep_expired(&self) {
        let now = self.now();
        let expired: Vec<Entry> = self
            .0
            .entries
            .borrow()
            .iter()
            .filter(|entry| entry.lease_id.is_none() && entry.expires_at <= now)
            .cloned()
            .collect();
        self.revoke_entries(&expired);
        self.sweep_orphan_directories();
    }

    fn revoke_entries(&self, values: &[Entry]) {
        for entry in values {
            let removed = {
                let mut entries = self.0.entries.borrow_mut();
                let before = entries.len();
                entries.retain(|e| e.token != entry.token);
                entries.len() != before
            };
            if !removed {
                continue;
            }
            let mut groups = self.0.groups.borrow_mut();
            if let Some((count, bytes)) = groups.get(&entry.group_key).copied() {
                let next = (count.saturating_sub(1), bytes.saturating_sub(entry.size));
                if next.0 == 0 {
                    groups.remove(&entry.group_key);
                } else {
                    groups.insert(entry.group_key.clone(), next);
                }
            }
            let _ = std::fs::remove_file(&entry.snapshot_path);
        }
    }

    /// `store.close()`.
    pub async fn close(&self) {
        if self.0.closed.replace(true) {
            return;
        }
        if let Some(task) = self.0.sweep_task.borrow_mut().take() {
            task.abort();
        }
        let all = self.0.entries.borrow().clone();
        self.revoke_entries(&all);
        let _ = std::fs::remove_dir_all(&self.0.process_directory);
    }

    /// `sweepOrphanDirectories()`: staging of exited processes.
    fn sweep_orphan_directories(&self) {
        let inner = &self.0;
        let Ok(children) = std::fs::read_dir(&inner.root_path) else {
            return;
        };
        let now = self.now();
        for child in children.filter_map(Result::ok) {
            if !child.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let candidate = inner.root_path.join(child.file_name());
            if candidate == inner.process_directory {
                continue;
            }
            let modified = std::fs::metadata(&candidate)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as i64);
            if modified.is_some_and(|modified| modified + inner.ttl_ms <= now) {
                let _ = std::fs::remove_dir_all(&candidate);
            }
        }
    }
}

fn create_private_directory(path: &Path) -> AgentResult<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        builder.mode(0o700);
        builder.create(path)?;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    builder.create(path)?;
    Ok(())
}

fn draft_for_entry(entry: &Entry) -> Value {
    json!({
        "id": entry.id,
        "kind": "staged-attachment",
        "token": entry.token,
        "displayName": entry.display_name,
        "mime": entry.mime,
        "size": entry.size,
        "status": "ready",
    })
}

/// `sameFileSnapshot(before, after)`.
fn same_file_snapshot(before: &FileSnapshot, after: &FileSnapshot) -> bool {
    before.size == after.size
        && before.modified_ns == after.modified_ns
        && before.ino == after.ino
        && before.dev == after.dev
}

fn safe_display_name(value: Option<String>) -> String {
    let raw = value
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "attachment".into());
    let cleaned = CONTROL.replace_all(&raw, "");
    let name = js::head16(js::trim(&cleaned), 512);
    if name.is_empty() {
        "attachment".into()
    } else {
        name.to_string()
    }
}

/// `safeStagingError(error, sourcePaths, processDirectory)`.
fn safe_staging_error(message: &str, source_paths: &[String], process_directory: &Path) -> String {
    let mut message = message.to_string();
    for path in source_paths.iter().filter(|p| !p.is_empty()) {
        message = message.replace(path.as_str(), "[selected file]");
    }
    message = message.replace(&*process_directory.to_string_lossy(), "[private staging]");
    let message = Regex::new(r"[\r\n]+")
        .expect("pattern")
        .replace_all(&message, " ")
        .into_owned();
    let message = js::head16(&message, 500).to_string();
    if message.is_empty() {
        "The attachment could not be staged safely.".into()
    } else {
        message
    }
}

fn sniff_mime_type(header: &[u8]) -> Option<&'static str> {
    if header.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Some("image/png");
    }
    if header.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if header.len() >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if header.starts_with(b"%PDF-") {
        return Some("application/pdf");
    }
    None
}

fn extension_mime(name: &str) -> Option<&'static str> {
    let extension = Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))?;
    Some(match extension.as_str() {
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        ".pdf" => "application/pdf",
        ".txt" => "text/plain",
        ".md" | ".mdx" => "text/markdown",
        ".json" | ".jsonl" => "application/json",
        ".csv" => "text/csv",
        ".tsv" => "text/tab-separated-values",
        ".html" | ".htm" => "text/html",
        ".xml" => "application/xml",
        ".yaml" | ".yml" => "application/yaml",
        ".toml" => "application/toml",
        ".js" | ".mjs" | ".cjs" | ".jsx" => "text/javascript",
        ".ts" | ".tsx" => "text/typescript",
        ".css" => "text/css",
        ".py" => "text/x-python",
        ".rb" => "text/x-ruby",
        ".go" => "text/x-go",
        ".rs" => "text/x-rust",
        ".java" => "text/x-java-source",
        ".swift" => "text/x-swift",
        ".sh" | ".bash" | ".zsh" => "text/x-shellscript",
        ".sql" => "text/x-sql",
        ".graphql" | ".gql" => "text/x-graphql",
        _ => return None,
    })
}

/// `inferMimeType(name, header)`: an image or PDF extension must agree
/// with the file's magic bytes.
fn infer_mime_type(name: &str, header: &[u8]) -> String {
    let detected = sniff_mime_type(header);
    let extension = extension_mime(name);
    let verified = matches!(
        extension,
        Some("image/png" | "image/jpeg" | "image/gif" | "image/webp" | "application/pdf")
    );
    if verified && detected != extension {
        return "application/octet-stream".into();
    }
    detected
        .or(extension)
        .unwrap_or("application/octet-stream")
        .to_string()
}

impl AttachmentStore for AgentAttachmentStore {
    fn supports(&self, method: &str) -> bool {
        matches!(
            method,
            "stage"
                | "authorize"
                | "lease"
                | "releaseLease"
                | "revoke"
                | "revokeLeased"
                | "revokeOwner"
                | "revokeWorkspace"
                | "close"
        )
    }
    fn stage(&self, request: Value) -> Pending<Vec<Value>> {
        let store = self.clone();
        Box::pin(async move { store.stage(&request).await })
    }
    fn authorize(&self, request: Value) -> Pending<Vec<Value>> {
        let store = self.clone();
        Box::pin(async move { store.authorize(&request).await })
    }
    fn lease(&self, request: Value) -> Pending<()> {
        let store = self.clone();
        Box::pin(async move { store.lease(&request).await.map(drop) })
    }
    fn release_lease(&self, request: Value) -> Pending<()> {
        let result = self.release_lease(&request).map(drop);
        Box::pin(async move { result })
    }
    fn revoke(&self, request: Value) -> Pending<Value> {
        // `store.revokeLeased(...)`, falling back to `store.revoke(...)`.
        let result = self.revoke_leased(&request);
        Box::pin(async move { result })
    }
    fn revoke_owner(&self, owner_id: u64) -> Pending<()> {
        self.revoke_owner(owner_id as i64);
        Box::pin(async { Ok(()) })
    }
    fn revoke_workspace(&self, owner_id: u64, workspace_root: String) -> Pending<()> {
        let result = self.revoke_workspace(owner_id as i64, &workspace_root);
        Box::pin(async move { result })
    }
    fn close(&self) -> Pending<()> {
        let store = self.clone();
        Box::pin(async move {
            store.close().await;
            Ok(())
        })
    }
}

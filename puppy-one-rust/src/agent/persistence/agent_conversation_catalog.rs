//! `persistence/agent-conversation-catalog.mjs`: the durable,
//! metadata-only index of native conversations. Native harnesses alone own
//! the transcript; a read/modify/persist operation is serialized and memory
//! is published only after a successful atomic replacement.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::ports::{Guard, HistoryCatalog, Pending};
use crate::agent::contract::history_schema::{history_date, history_native_id};
use crate::agent::contract::js::{self, Obj};
use crate::agent::event_loop::{SharedTask, shared};
use crate::agent::migrations::legacy_session_format::{
    migrated_runtime_descriptor, resolve_persisted_runtime_id,
};
use crate::agent::node_path;
use base64::Engine;
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::LazyLock;

const CATALOG_VERSION: i64 = 2;
const MAX_RECORDS: usize = 500;

static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));

const TERMINAL_STATES: &[&str] = &[
    "idle",
    "running",
    "completed",
    "failed",
    "interrupted",
    "provider-exited",
    "outcome-unknown",
];

/// The product-owned fields native discovery never changes.
const PRESERVED_ON_DISCOVERY: &[&str] = &[
    "archivedAt",
    "terminalState",
    "lastSequence",
    "selectedProviderId",
    "selectedModel",
    "selectedVariant",
    "selectedEffort",
    "selectedMode",
    "capabilityRevision",
    "modelBindingRevision",
];

/// `logger.warn(message)`.
pub type Logger = Rc<dyn Fn(&str)>;

/// The catalog's file operations (`fs.promises.readFile` / `rename`).
pub trait CatalogFileSystem {
    fn read(&self, path: &Path) -> LocalBoxFuture<'static, std::io::Result<String>>;
    fn rename(&self, from: &Path, to: &Path) -> LocalBoxFuture<'static, std::io::Result<()>>;
}

struct NativeFileSystem;

impl CatalogFileSystem for NativeFileSystem {
    fn read(&self, path: &Path) -> LocalBoxFuture<'static, std::io::Result<String>> {
        let path = path.to_path_buf();
        Box::pin(async move { std::fs::read_to_string(path) })
    }
    fn rename(&self, from: &Path, to: &Path) -> LocalBoxFuture<'static, std::io::Result<()>> {
        let (from, to) = (from.to_path_buf(), to.to_path_buf());
        Box::pin(async move { std::fs::rename(from, to) })
    }
}

/// `createAgentConversationCatalog({ filePath, logger, maxRecords })`.
#[derive(Clone, Default)]
pub struct CatalogOptions {
    pub file_path: PathBuf,
    pub logger: Option<Logger>,
    pub max_records: Option<i64>,
    pub file_system: Option<Rc<dyn CatalogFileSystem>>,
}

struct Inner {
    file_path: PathBuf,
    logger: Option<Logger>,
    capacity: usize,
    file_system: Rc<dyn CatalogFileSystem>,
    records: RefCell<Vec<Value>>,
    load: RefCell<Option<SharedTask<AgentResult<()>>>>,
    write_lock: tokio::sync::Mutex<()>,
    revision: Cell<i64>,
    changed_at: RefCell<HashMap<String, i64>>,
    truncated: Cell<bool>,
}

/// The durable conversation catalog.
#[derive(Clone)]
pub struct AgentConversationCatalog(Rc<Inner>);

/// What a mutation produced.
struct Outcome<T> {
    value: T,
    unchanged: bool,
    touched: Vec<String>,
}

impl<T> Outcome<T> {
    fn changed(value: T, touched: Vec<String>) -> Self {
        Self {
            value,
            unchanged: false,
            touched,
        }
    }
    fn unchanged(value: T) -> Self {
        Self {
            value,
            unchanged: true,
            touched: Vec::new(),
        }
    }
}

fn type_error(message: &str) -> AgentError {
    AgentError::new(message).with_name("TypeError")
}

/// `{ workspaceRoot, runtimeId, sourceScopeId, providerSessionIds, reconciledAt, startedRevision }`.
#[derive(Clone, Debug, Default)]
pub struct ReconcileScope {
    pub workspace_root: Option<String>,
    pub runtime_id: Option<String>,
    pub source_scope_id: Option<String>,
    pub provider_session_ids: Vec<String>,
    pub reconciled_at: Option<String>,
    pub started_revision: Option<i64>,
}

impl ReconcileScope {
    /// The scope as the History indexer passes it.
    pub fn from_json(value: &Value) -> Self {
        let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
        Self {
            workspace_root: text("workspaceRoot"),
            runtime_id: text("runtimeId"),
            source_scope_id: text("sourceScopeId"),
            provider_session_ids: value
                .get("providerSessionIds")
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            reconciled_at: text("reconciledAt"),
            started_revision: value.get("startedRevision").and_then(Value::as_i64),
        }
    }
}

impl AgentConversationCatalog {
    /// `createAgentConversationCatalog(options)`.
    pub fn new(options: CatalogOptions) -> AgentResult<Self> {
        if !options.file_path.is_absolute() {
            return Err(type_error(
                "Agent conversation catalog requires an absolute file path.",
            ));
        }
        let capacity = options
            .max_records
            .filter(|max| *max > 0 && *max <= js::MAX_SAFE_INTEGER)
            .map_or(MAX_RECORDS, |max| (max as usize).min(MAX_RECORDS));
        Ok(Self(Rc::new(Inner {
            file_path: options.file_path,
            logger: options.logger,
            capacity,
            file_system: options
                .file_system
                .unwrap_or_else(|| Rc::new(NativeFileSystem)),
            records: RefCell::default(),
            load: RefCell::default(),
            write_lock: tokio::sync::Mutex::new(()),
            revision: Cell::new(0),
            changed_at: RefCell::default(),
            truncated: Cell::new(false),
        })))
    }

    /// `load()`: once, shared by every reader and writer.
    fn load(&self) -> SharedTask<AgentResult<()>> {
        if let Some(load) = self.0.load.borrow().clone() {
            return load;
        }
        let catalog = self.clone();
        let load = shared(async move { catalog.read_file().await });
        *self.0.load.borrow_mut() = Some(load.clone());
        load
    }

    async fn read_file(&self) -> AgentResult<()> {
        let inner = &self.0;
        let text = match inner.file_system.read(&inner.file_path).await {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(self.unreadable(error.into())),
        };
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|error| self.unreadable(AgentError::new(error.to_string())))?;
        let version = parsed.get("version").and_then(Value::as_i64);
        let Some(entries) = parsed
            .get("records")
            .and_then(Value::as_array)
            .filter(|_| matches!(version, Some(1 | CATALOG_VERSION)))
        else {
            return Err(self.unreadable(AgentError::new(
                "Agent conversation catalog has an unsupported format.",
            )));
        };
        let normalized: Option<Vec<Value>> = entries.iter().map(normalize_record).collect();
        let Some(mut normalized) = normalized else {
            return Err(self.unreadable(AgentError::new(
                "Agent conversation catalog contains invalid metadata.",
            )));
        };
        let native: HashSet<String> = normalized.iter().map(native_key).collect();
        let product: HashSet<&str> = normalized
            .iter()
            .filter_map(|r| r["sessionId"].as_str())
            .collect();
        if native.len() != normalized.len() || product.len() != normalized.len() {
            return Err(self.unreadable(AgentError::new(
                "Agent conversation catalog contains conflicting identities.",
            )));
        }
        inner
            .truncated
            .set(parsed.get("truncated") == Some(&Value::Bool(true)));
        normalized.sort_by(compare_records);
        *inner.records.borrow_mut() = normalized;
        Ok(())
    }

    fn unreadable(&self, error: AgentError) -> AgentError {
        if let Some(logger) = self.0.logger.as_ref() {
            logger("Agent conversation catalog could not be read; preserving the existing file.");
        }
        error
    }

    /// `persist(next, truncated, guard)`: an atomic owner-only replacement.
    async fn persist(
        &self,
        next: &[Value],
        truncated: bool,
        guard: Option<&Guard>,
    ) -> AgentResult<()> {
        let path = &self.0.file_path;
        if let Some(parent) = path.parent() {
            let mut builder = std::fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(parent)?;
        }
        let temporary = PathBuf::from(format!(
            "{}.{}.{}.tmp",
            path.to_string_lossy(),
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let result = async {
            let payload = serde_json::to_string_pretty(&json!({
                "version": CATALOG_VERSION,
                "records": next,
                "truncated": truncated,
            }))
            .map_err(|error| AgentError::new(error.to_string()))?;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            std::io::Write::write_all(
                &mut options.open(&temporary)?,
                format!("{payload}\n").as_bytes(),
            )?;
            if let Some(guard) = guard {
                guard()?;
            }
            self.0.file_system.rename(&temporary, path).await?;
            Ok(())
        }
        .await;
        let _ = std::fs::remove_file(&temporary);
        result
    }

    /// `mutate(operation, guard)`: the whole read/modify/persist is
    /// serialized; memory is published only after the file is replaced.
    async fn mutate<T>(
        &self,
        guard: Option<Guard>,
        operation: impl FnOnce(&Self, &mut Vec<Value>) -> AgentResult<Outcome<T>>,
    ) -> AgentResult<T> {
        let inner = &self.0;
        let _serialized = inner.write_lock.lock().await;
        self.load().await?;
        if let Some(guard) = guard.as_ref() {
            guard()?;
        }
        let mut draft = inner.records.borrow().clone();
        let outcome = operation(self, &mut draft)?;
        if outcome.unchanged {
            return Ok(outcome.value);
        }
        draft.sort_by(compare_records);
        let truncated = inner.truncated.get();
        self.persist(&draft, truncated, guard.as_ref()).await?;
        let revision = inner.revision.get() + 1;
        inner.revision.set(revision);
        let previous: HashMap<String, String> = inner
            .records
            .borrow()
            .iter()
            .map(|entry| {
                (
                    js::to_js_string(entry.get("sessionId")),
                    js::stringify(entry),
                )
            })
            .collect();
        let mut changed_at = inner.changed_at.borrow_mut();
        for record in &draft {
            let id = js::to_js_string(record.get("sessionId"));
            if outcome.touched.contains(&id)
                || previous.get(&id).map(String::as_str) != Some(js::stringify(record).as_str())
            {
                changed_at.insert(id, revision);
            }
        }
        let retained: HashSet<String> = draft
            .iter()
            .map(|record| js::to_js_string(record.get("sessionId")))
            .collect();
        changed_at.retain(|id, _| retained.contains(id));
        drop(changed_at);
        *inner.records.borrow_mut() = draft;
        Ok(outcome.value)
    }

    /// `read(operation)`: the last atomically published snapshot, even while
    /// a write is settling.
    async fn read<T>(&self, operation: impl FnOnce(&[Value]) -> AgentResult<T>) -> AgentResult<T> {
        self.load().await?;
        operation(&self.0.records.borrow())
    }

    /// `put(draft, value)`.
    fn put(draft: &mut Vec<Value>, value: &Value) -> AgentResult<Value> {
        let Some(normalized) = normalize_record(value) else {
            return Err(type_error("Agent conversation metadata is invalid."));
        };
        let identity = native_key(&normalized);
        if let Some(existing) = draft.iter().find(|entry| native_key(entry) == identity)
            && existing["sessionId"] != normalized["sessionId"]
        {
            return Err(AgentError::new(
                "Native conversation identity already has a product session id.",
            ));
        }
        if let Some(index) = draft
            .iter()
            .position(|entry| entry["sessionId"] == normalized["sessionId"])
        {
            if native_key(&draft[index]) != identity {
                return Err(AgentError::new(
                    "Product session id cannot be rebound to a different native conversation.",
                ));
            }
            draft.remove(index);
        }
        draft.push(normalized.clone());
        Ok(normalized)
    }

    /// `upsert(draft, record)`: one stable product id per native
    /// conversation.
    fn upsert(draft: &mut Vec<Value>, record: &Value) -> AgentResult<Value> {
        let Some(candidate) = normalize_record(&js::with(record, "sessionId", "native-candidate"))
        else {
            return Err(type_error("Agent conversation metadata is invalid."));
        };
        let existing = draft
            .iter()
            .find(|entry| native_key(entry) == native_key(&candidate))
            .cloned();
        let mut merged = existing.as_ref().map_or_else(Obj::new, Obj::from);
        if let Some(fields) = record.as_object() {
            for (key, value) in fields {
                if !value.is_null() {
                    merged.insert(key, value.clone());
                }
            }
        }
        let known = record.get("updatedAtKnown") != Some(&Value::Bool(false));
        merged.insert(
            "sessionId",
            existing
                .as_ref()
                .and_then(|e| e.get("sessionId").cloned())
                .unwrap_or_else(|| Value::from(uuid::Uuid::new_v4().to_string())),
        );
        merged.insert("updatedAtKnown", known);
        if let Some(existing) = existing.as_ref() {
            if !known
                && existing.get("updatedAtKnown") != Some(&Value::Bool(false))
                && existing.get("updatedAt").is_some_and(js::truthy)
            {
                merged.insert("updatedAt", existing["updatedAt"].clone());
                merged.insert(
                    "createdAt",
                    existing.get("createdAt").cloned().unwrap_or(Value::Null),
                );
                merged.insert("updatedAtKnown", true);
            }
            // Discovery cannot change product-owned selections, archive or
            // session observations.
            for key in PRESERVED_ON_DISCOVERY {
                if let Some(value) = existing.get(*key).filter(|v| !v.is_null()) {
                    merged.insert(key, value.clone());
                }
            }
        }
        merged.insert(
            "origin",
            existing
                .as_ref()
                .and_then(|e| e.get("origin").filter(|o| !o.is_null()).cloned())
                .unwrap_or_else(|| Value::from("native-discovery")),
        );
        merged.insert("availability", "available");
        merged.insert("lastSeenAt", js::now_iso());
        merged.insert("unavailableAt", Value::Null);
        Self::put(draft, &merged.build())
    }

    /// `reconcile(draft, scope)`.
    fn reconcile(
        &self,
        draft: &mut [Value],
        scope: &ReconcileScope,
    ) -> AgentResult<(Vec<String>, bool)> {
        let Some(workspace_root) = scope.workspace_root.as_deref() else {
            return Err(type_error(
                "The \"paths[0]\" argument must be of type string. Received undefined",
            ));
        };
        let root = node_path::resolve_one(workspace_root)
            .to_string_lossy()
            .into_owned();
        let source = scope.source_scope_id.as_deref().unwrap_or("default");
        let reconciled_at = scope.reconciled_at.clone().unwrap_or_else(js::now_iso);
        let started = scope.started_revision.unwrap_or(self.0.revision.get());
        let seen: HashSet<&str> = scope
            .provider_session_ids
            .iter()
            .map(String::as_str)
            .collect();
        let changed_at = self.0.changed_at.borrow();
        let mut unavailable = Vec::new();
        let mut changed = false;
        for entry in draft.iter_mut() {
            let id = js::to_js_string(entry.get("sessionId"));
            if entry["workspaceRoot"] != root.as_str()
                || entry["runtimeId"].as_str() != scope.runtime_id.as_deref()
                || entry["sourceScopeId"] != source
                || entry.get("archivedAt").is_some_and(js::truthy)
                || entry["providerSessionId"]
                    .as_str()
                    .is_some_and(|native| seen.contains(native))
                || changed_at.get(&id).copied().unwrap_or(0) > started
            {
                continue;
            }
            unavailable.push(id);
            if entry["availability"] != "unavailable" {
                *entry = Obj::from(entry)
                    .set("availability", "unavailable")
                    .set("unavailableAt", reconciled_at.as_str())
                    .build();
                changed = true;
            }
        }
        Ok((unavailable, changed))
    }

    /// `catalog.bindNative(record)`: reserves identity before a live
    /// Session becomes visible; reservation is not persistence proof.
    pub async fn bind_native(&self, record: &Value) -> AgentResult<Value> {
        let record = record.clone();
        self.mutate(None, move |_, draft| {
            let Some(candidate) = normalize_record(&record) else {
                return Err(type_error("Agent conversation identity is invalid."));
            };
            if let Some(existing) = draft
                .iter()
                .find(|entry| native_key(entry) == native_key(&candidate))
            {
                return Ok(Outcome::unchanged(existing.clone()));
            }
            let saved = Self::put(draft, &js::with(&record, "availability", "unverified"))?;
            let id = js::to_js_string(saved.get("sessionId"));
            Ok(Outcome::changed(saved, vec![id]))
        })
        .await
    }

    /// `catalog.save(record)`.
    pub async fn save(&self, record: &Value) -> AgentResult<Value> {
        let record = record.clone();
        self.mutate(None, move |_, draft| {
            let id = safe_id(record.get("sessionId"));
            let existing = draft
                .iter()
                .find(|entry| id.is_some() && entry["sessionId"].as_str() == id.as_deref())
                .cloned()
                .unwrap_or_else(|| json!({}));
            let pick = |key: &str| existing.get(key).filter(|v| !v.is_null()).cloned();
            let origin = pick("origin")
                .or_else(|| record.get("origin").filter(|v| !v.is_null()).cloned())
                .unwrap_or_else(|| Value::from("puppyone"));
            let archived = pick("archivedAt").or_else(|| record.get("archivedAt").cloned());
            let availability = record
                .get("availability")
                .filter(|v| !v.is_null())
                .cloned()
                .or_else(|| pick("availability"))
                .unwrap_or_else(|| Value::from("unverified"));
            let merged = Obj::from(&existing)
                .spread(&record)
                .set("origin", origin)
                .set("archivedAt", archived.unwrap_or(Value::Null))
                .set("availability", availability)
                .build();
            let saved = Self::put(draft, &merged)?;
            let id = js::to_js_string(saved.get("sessionId"));
            Ok(Outcome::changed(saved, vec![id]))
        })
        .await
    }

    /// `catalog.upsertNative(record)`.
    pub async fn upsert_native(&self, record: &Value) -> AgentResult<Value> {
        let record = record.clone();
        self.mutate(None, move |_, draft| {
            let saved = Self::upsert(draft, &record)?;
            let id = js::to_js_string(saved.get("sessionId"));
            Ok(Outcome::changed(saved, vec![id]))
        })
        .await
    }

    /// `catalog.applyNativePage({ entries, scope, reconcileMissing, guard })`:
    /// one native page committed atomically with an optional final
    /// reconciliation.
    pub async fn apply_native_page_with(
        &self,
        entries: Vec<Value>,
        scope: ReconcileScope,
        reconcile_missing: bool,
        guard: Option<Guard>,
    ) -> AgentResult<Value> {
        self.mutate(guard, move |catalog, draft| {
            let saved: Vec<Value> = entries
                .iter()
                .map(|record| Self::upsert(draft, record))
                .collect::<AgentResult<_>>()?;
            let unavailable = if reconcile_missing {
                catalog.reconcile(draft, &scope)?.0
            } else {
                Vec::new()
            };
            let touched = saved
                .iter()
                .map(|record| js::to_js_string(record.get("sessionId")))
                .collect();
            Ok(Outcome::changed(
                json!({
                    "indexed": saved.len(),
                    "unavailableSessionIds": unavailable,
                    "sessions": saved,
                    "truncated": catalog.0.truncated.get(),
                }),
                touched,
            ))
        })
        .await
    }

    /// `catalog.reconcileNative(scope)`.
    pub async fn reconcile_native(&self, scope: ReconcileScope) -> AgentResult<Value> {
        self.mutate(None, move |catalog, draft| {
            let (unavailable, changed) = catalog.reconcile(draft, &scope)?;
            let value = json!({ "unavailableSessionIds": unavailable });
            Ok(if changed {
                Outcome::changed(value, Vec::new())
            } else {
                Outcome::unchanged(value)
            })
        })
        .await
    }

    /// `catalog.markUnavailable(id, unavailableAt)`.
    pub async fn mark_unavailable(
        &self,
        id: &str,
        unavailable_at: Option<String>,
    ) -> AgentResult<bool> {
        let at = unavailable_at.unwrap_or_else(js::now_iso);
        self.update(
            id,
            json!({ "availability": "unavailable", "unavailableAt": at }),
        )
        .await
    }

    /// `catalog.archive(id, archivedAt)`.
    pub async fn archive(&self, id: &str, archived_at: Option<String>) -> AgentResult<bool> {
        let at = archived_at.unwrap_or_else(js::now_iso);
        self.update(id, json!({ "archivedAt": at })).await
    }

    async fn update(&self, id: &str, patch: Value) -> AgentResult<bool> {
        let id = safe_id(Some(&Value::from(id)));
        self.mutate(None, move |_, draft| {
            let Some(index) = draft
                .iter()
                .position(|entry| id.is_some() && entry["sessionId"].as_str() == id.as_deref())
            else {
                return Ok(Outcome::unchanged(false));
            };
            let merged = Obj::from(&draft[index]).spread(&patch).build();
            if let Some(normalized) = normalize_record(&merged) {
                draft[index] = normalized;
            }
            Ok(Outcome::changed(true, Vec::new()))
        })
        .await
    }

    /// `catalog.remove(id)`.
    pub async fn remove(&self, id: &str) -> AgentResult<bool> {
        let id = safe_id(Some(&Value::from(id)));
        self.mutate(None, move |_, draft| {
            let Some(index) = draft
                .iter()
                .position(|entry| id.is_some() && entry["sessionId"].as_str() == id.as_deref())
            else {
                return Ok(Outcome::unchanged(false));
            };
            draft.remove(index);
            Ok(Outcome::changed(true, Vec::new()))
        })
        .await
    }

    /// `catalog.findById(id, workspaceRoot)`.
    pub async fn find_by_id(
        &self,
        id: &str,
        workspace_root: Option<&str>,
    ) -> AgentResult<Option<Value>> {
        let id = safe_id(Some(&Value::from(id)));
        let root = workspace_root.map(absolute_path);
        self.read(move |records| {
            Ok(records
                .iter()
                .find(|entry| {
                    id.is_some()
                        && entry["sessionId"].as_str() == id.as_deref()
                        && root
                            .as_ref()
                            .is_none_or(|root| entry["workspaceRoot"].as_str() == root.as_deref())
                })
                .cloned())
        })
        .await
    }

    /// `catalog.findLatest(workspaceRoot, runtimeId)`.
    pub async fn find_latest(
        &self,
        workspace_root: &str,
        runtime_id: Option<&str>,
    ) -> AgentResult<Option<Value>> {
        let root = absolute_path(workspace_root);
        let runtime = runtime_id.map(str::to_string);
        self.read(move |records| {
            Ok(records
                .iter()
                .find(|entry| {
                    !entry.get("archivedAt").is_some_and(js::truthy)
                        && entry["availability"] == "available"
                        && entry["workspaceRoot"].as_str() == root.as_deref()
                        && runtime
                            .as_deref()
                            .is_none_or(|runtime| entry["runtimeId"] == runtime)
                })
                .cloned())
        })
        .await
    }

    /// `catalog.list(workspaceRoot, { runtimeId, includeArchived, includeUnavailable, includeUnverified })`.
    pub async fn list(
        &self,
        workspace_root: Option<&str>,
        options: &Value,
    ) -> AgentResult<Vec<Value>> {
        let root = workspace_root.map(absolute_path);
        let runtime = options
            .get("runtimeId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let flag = |key: &str| js::truthy_opt(options.get(key));
        let (archived, unavailable, unverified) = (
            flag("includeArchived"),
            flag("includeUnavailable"),
            flag("includeUnverified"),
        );
        self.read(move |records| {
            Ok(records
                .iter()
                .filter(|entry| {
                    root.as_ref()
                        .is_none_or(|root| entry["workspaceRoot"].as_str() == root.as_deref())
                        && runtime
                            .as_deref()
                            .is_none_or(|runtime| entry["runtimeId"] == runtime)
                        && (archived || !entry.get("archivedAt").is_some_and(js::truthy))
                        && (unavailable || entry["availability"] != "unavailable")
                        && (unverified || entry["availability"] != "unverified")
                })
                .cloned()
                .collect())
        })
        .await
    }

    /// `catalog.listPage(workspaceRoot, { runtimeId, includeArchived, cursor })`.
    pub async fn list_page(&self, workspace_root: &str, options: &Value) -> AgentResult<Value> {
        let root = absolute_path(workspace_root);
        let runtime = options
            .get("runtimeId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let include_archived = js::truthy_opt(options.get("includeArchived"));
        let scope = js::stringify(&json!([root, runtime, include_archived]));
        let scope_id: String = Sha256::digest(scope.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let after = match options
            .get("cursor")
            .and_then(Value::as_str)
            .filter(|c| !c.is_empty())
        {
            None => None,
            Some(cursor) => {
                let decoded = base64::engine::GeneralPurpose::new(
                    &base64::alphabet::URL_SAFE,
                    base64::engine::GeneralPurposeConfig::new()
                        .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent),
                )
                .decode(cursor)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .ok_or_else(|| type_error("History catalog cursor is invalid."))?;
                if decoded.get("scope").and_then(Value::as_str) != Some(scope_id.as_str())
                    || history_date(decoded.get("updatedAt")).is_none()
                    || safe_id(decoded.get("sessionId")).is_none()
                {
                    return Err(type_error(
                        "History catalog cursor does not match this query.",
                    ));
                }
                Some(decoded)
            }
        };
        let capacity = self.0.capacity;
        self.read(move |records| {
            let eligible: Vec<&Value> = records
                .iter()
                .filter(|entry| {
                    entry["workspaceRoot"].as_str() == root.as_deref()
                        && runtime
                            .as_deref()
                            .is_none_or(|runtime| entry["runtimeId"] == runtime)
                        && entry["availability"] != "unverified"
                        && after
                            .as_ref()
                            .is_none_or(|after| compare_records(entry, after).is_gt())
                })
                .collect();
            // Explicit removals share the page budget; absence from a page
            // proves nothing.
            let page = &eligible[..eligible.len().min(capacity)];
            let visible = |entry: &Value| {
                entry["availability"] == "available"
                    && (include_archived || !entry.get("archivedAt").is_some_and(js::truthy))
            };
            let sessions: Vec<Value> = page
                .iter()
                .filter(|entry| visible(entry))
                .map(|entry| (*entry).clone())
                .collect();
            let excluded: Vec<Value> = page
                .iter()
                .filter(|entry| !visible(entry))
                .map(|entry| entry["sessionId"].clone())
                .collect();
            let next_cursor = (eligible.len() > capacity).then(|| {
                let last = page[page.len() - 1];
                base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(js::stringify(&json!({
                    "scope": scope_id,
                    "updatedAt": last["updatedAt"],
                    "sessionId": last["sessionId"],
                })))
            });
            Ok(json!({ "sessions": sessions, "excludedSessionIds": excluded, "nextCursor": next_cursor }))
        })
        .await
    }

    /// `catalog.getRevision()`.
    pub async fn get_revision(&self) -> AgentResult<i64> {
        let inner = self.0.clone();
        self.read(move |_| Ok(inner.revision.get())).await
    }

    /// `catalog.getCoverage()`.
    pub async fn get_coverage(&self) -> AgentResult<Value> {
        let inner = self.0.clone();
        self.read(move |records| {
            Ok(json!({
                "truncated": inner.truncated.get(),
                "capacity": inner.capacity,
                "retained": records.len(),
            }))
        })
        .await
    }
}

impl HistoryCatalog for AgentConversationCatalog {
    fn supports_list_page(&self) -> bool {
        true
    }
    fn list_page(&self, workspace_root: String, options: Value) -> Pending<Value> {
        let catalog = self.clone();
        Box::pin(async move { catalog.list_page(&workspace_root, &options).await })
    }
    fn list(&self, workspace_root: String, options: Value) -> Pending<Vec<Value>> {
        let catalog = self.clone();
        Box::pin(async move {
            let root = Some(workspace_root.as_str()).filter(|root| !root.is_empty());
            catalog.list(root, &options).await
        })
    }
    fn get_revision(&self) -> Pending<i64> {
        let catalog = self.clone();
        Box::pin(async move { catalog.get_revision().await })
    }
    fn get_coverage(&self) -> Pending<Value> {
        let catalog = self.clone();
        Box::pin(async move { catalog.get_coverage().await })
    }
    fn apply_native_page(
        &self,
        entries: Vec<Value>,
        scope: Value,
        reconcile_missing: bool,
        guard: Guard,
    ) -> Pending<Value> {
        let catalog = self.clone();
        Box::pin(async move {
            catalog
                .apply_native_page_with(
                    entries,
                    ReconcileScope::from_json(&scope),
                    reconcile_missing,
                    Some(guard),
                )
                .await
        })
    }
}

/// `nativeKey(record)`.
fn native_key(record: &Value) -> String {
    js::stringify(&json!([
        record["workspaceRoot"],
        record["runtimeId"],
        record["sourceScopeId"],
        record["providerSessionId"],
    ]))
}

fn safe_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| SAFE_ID.is_match(id))
        .map(str::to_string)
}

/// `absolutePath(value)`.
fn absolute_path(value: &str) -> Option<String> {
    node_path::is_absolute(value)
        .then(|| node_path::resolve_one(value).to_string_lossy().into_owned())
}

fn absolute(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).and_then(absolute_path)
}

/// `bounded(value, limit)`: a trimmed, non-empty string.
fn bounded(value: Option<&Value>, limit: usize) -> Option<String> {
    let text = js::head16(js::trim(value?.as_str()?), limit);
    (!text.is_empty()).then(|| text.to_string())
}

fn first<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| value.get(*key).filter(|v| !v.is_null()))
}

fn provider_id_from_model(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    let separator = text.find('/')?;
    (separator > 0)
        .then(|| safe_id(Some(&Value::from(&text[..separator]))))
        .flatten()
}

/// `normalizeRecord(value)`: bounded routing metadata, or `None`.
pub fn normalize_record(value: &Value) -> Option<Value> {
    if !value.is_object() {
        return None;
    }
    let session_id = safe_id(value.get("sessionId"))?;
    let workspace_root = absolute(value.get("workspaceRoot"))?;
    safe_id(first(value, &["runtimeId"]).or_else(|| value.pointer("/runtime/id")))?;
    let runtime_id = safe_id(Some(&Value::from(resolve_persisted_runtime_id(
        value, None,
    ))))?;
    let provider_session_id = history_native_id(value.get("providerSessionId"))?;
    let created_at = history_date(value.get("createdAt"))?;
    let updated_at = history_date(value.get("updatedAt"))?;
    let source = value.get("sourceScopeId").filter(|v| !v.is_null());
    if source.is_some() && history_native_id(source).is_none() {
        return None;
    }
    let origin = if value.get("origin").and_then(Value::as_str) == Some("native-discovery") {
        "native-discovery"
    } else {
        "puppyone"
    };
    let availability = match value.get("availability").and_then(Value::as_str) {
        Some(state @ ("available" | "unverified" | "unavailable")) => state,
        _ if origin == "native-discovery" => "available",
        _ => "unverified",
    };
    let terminal_state = value
        .get("terminalState")
        .and_then(Value::as_str)
        .filter(|state| TERMINAL_STATES.contains(state))
        .unwrap_or("idle");
    let last_sequence = value
        .get("lastSequence")
        .and_then(js::safe_integer)
        .filter(|n| *n >= 0)
        .unwrap_or(0);
    let runtime = normalize_runtime(
        &migrated_runtime_descriptor(value, &runtime_id),
        &runtime_id,
    );
    let record = Obj::new()
        .set("sessionId", session_id)
        .set("workspaceRoot", workspace_root)
        .set("runtimeId", runtime_id)
        .set("runtime", runtime)
        .set("providerSessionId", provider_session_id)
        .set(
            "sourceScopeId",
            history_native_id(source).unwrap_or_else(|| "default".into()),
        )
        .set(
            "title",
            bounded(value.get("title"), 500).unwrap_or_else(|| "Agent session".into()),
        )
        .set("createdAt", created_at)
        .set("updatedAt", updated_at)
        .opt(
            "updatedAtKnown",
            (value.get("updatedAtKnown") == Some(&Value::Bool(false))).then_some(false),
        )
        .opt("archivedAt", history_date(value.get("archivedAt")))
        .set("terminalState", terminal_state)
        .set("lastSequence", last_sequence)
        .set("partial", true)
        .opt(
            "selectedProviderId",
            safe_id(value.get("selectedProviderId"))
                .or_else(|| provider_id_from_model(first(value, &["selectedModel", "model"]))),
        )
        .opt(
            "selectedModel",
            bounded(first(value, &["selectedModel", "model"]), 512),
        )
        .opt(
            "modelBindingRevision",
            bounded(value.get("modelBindingRevision"), 160),
        )
        .opt(
            "selectedVariant",
            bounded(first(value, &["selectedVariant", "variant"]), 160),
        )
        .opt(
            "selectedEffort",
            bounded(first(value, &["selectedEffort", "effort"]), 160),
        )
        .opt(
            "selectedMode",
            bounded(first(value, &["selectedMode", "mode"]), 160),
        )
        .opt(
            "capabilityRevision",
            bounded(value.get("capabilityRevision"), 160),
        )
        .set("origin", origin)
        .set("availability", availability)
        .opt("lastSeenAt", history_date(value.get("lastSeenAt")))
        .opt("unavailableAt", history_date(value.get("unavailableAt")))
        .build();
    Some(record)
}

fn normalize_runtime(value: &Value, runtime_id: &str) -> Value {
    let empty = Value::Object(Map::new());
    let runtime = if value.is_object() { value } else { &empty };
    Obj::new()
        .set("id", runtime_id)
        .set(
            "displayName",
            bounded(runtime.get("displayName"), 160).unwrap_or_else(|| runtime_id.into()),
        )
        .opt("kind", bounded(runtime.get("kind"), 80))
        .opt("version", bounded(runtime.get("version"), 80))
        .opt("source", bounded(runtime.get("source"), 80))
        .opt("compatibility", bounded(runtime.get("compatibility"), 120))
        .build()
}

/// `compareRecords(left, right)`: newest first, then product id.
fn compare_records(left: &Value, right: &Value) -> std::cmp::Ordering {
    let text = |value: &Value, key: &str| js::to_js_string(value.get(key));
    js::locale_compare(&text(right, "updatedAt"), &text(left, "updatedAt"))
        .then_with(|| js::locale_compare(&text(left, "sessionId"), &text(right, "sessionId")))
}

//! `cache/ephemeral-agent-session-cache.mjs`: the process-local recovery
//! cache for currently active Agent connections. PuppyOne does not own Chat
//! History: this cache never writes transcripts or native session ids to
//! disk and disappears with the process. The legacy durable journal is
//! removed once during startup.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::{count_text_bytes, is_agent_event_envelope, redact_secrets};
use crate::agent::application::ports::{Pending, SessionCache};
use crate::agent::contract::js;
use crate::agent::contract::native_session_id::native_session_id;
use crate::agent::migrations::legacy_session_format::canonical_runtime_id;
use crate::agent::tasks::{SharedTask, shared};
use crate::clock;
use crate::text;
use regex::Regex;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::LazyLock;

const MAX_SESSIONS: usize = 8;
const MAX_EVENTS_PER_SESSION: usize = 1_000;
const MAX_SESSION_BYTES: usize = 2 * 1024 * 1024;
const LEGACY_JOURNAL_FILENAME: &str = "desktop-agent-sessions.json";

/// `agentSessionCachePolicy`.
pub mod policy {
    pub const DURABLE: bool = false;
    pub const MAX_SESSIONS: usize = super::MAX_SESSIONS;
    pub const MAX_EVENTS_PER_SESSION: usize = super::MAX_EVENTS_PER_SESSION;
    pub const MAX_SESSION_BYTES: usize = super::MAX_SESSION_BYTES;
    pub const LEGACY_JOURNAL_FILENAME: &str = super::LEGACY_JOURNAL_FILENAME;
}

static RUNTIME_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]{1,39}$").expect("pattern"));
static SESSION_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:_-]{1,160}$").expect("pattern"));
static NAME_SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[-_.]+").expect("pattern"));
static WORD_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\b\w)").expect("pattern"));

/// `logger.warn(message)`.
pub type Logger = Rc<dyn Fn(&str)>;

struct Inner {
    records: RefCell<Vec<Value>>,
    legacy_cleanup: SharedTask<()>,
}

/// `createEphemeralAgentSessionCache({ app, logger, legacyFilename })`.
#[derive(Clone)]
pub struct EphemeralAgentSessionCache(Rc<Inner>);

impl EphemeralAgentSessionCache {
    /// `userData` is `app.getPath("userData")`.
    pub fn new(
        user_data: Option<&Path>,
        logger: Option<Logger>,
        legacy_filename: Option<&str>,
    ) -> Self {
        let legacy_path =
            user_data.map(|dir| dir.join(legacy_filename.unwrap_or(LEGACY_JOURNAL_FILENAME)));
        let legacy_cleanup = shared(async move {
            if let Some(path) = legacy_path
                && let Err(error) = remove_legacy_journals(&path)
                && let Some(logger) = logger.as_ref()
            {
                logger(&format!(
                    "Unable to remove the legacy Desktop Agent chat journal: {error}"
                ));
            }
        });
        tokio::task::spawn_local(legacy_cleanup.clone());
        Self(Rc::new(Inner {
            records: RefCell::default(),
            legacy_cleanup,
        }))
    }

    async fn ready(&self) {
        self.0.legacy_cleanup.clone().await;
    }

    /// `cache.readAll()`.
    pub async fn read_all(&self) -> Vec<Value> {
        self.ready().await;
        self.0.records.borrow().clone()
    }

    /// `cache.findLatest(workspaceRoot, runtimeId)`.
    pub async fn find_latest(
        &self,
        workspace_root: &str,
        runtime_id: Option<&str>,
    ) -> Option<Value> {
        let mut matches: Vec<Value> = self
            .read_all()
            .await
            .into_iter()
            .filter(|entry| {
                entry["workspaceRoot"] == workspace_root
                    && js::truthy(&entry["providerSessionId"])
                    && !js::truthy(&entry["archivedAt"])
                    && runtime_id.is_none_or(|id| entry["runtimeId"] == id)
            })
            .collect();
        matches.sort_by(by_updated_descending);
        matches.into_iter().next()
    }

    /// `cache.findById(sessionId, workspaceRoot)`.
    pub async fn find_by_id(
        &self,
        session_id: &str,
        workspace_root: Option<&str>,
    ) -> Option<Value> {
        self.read_all().await.into_iter().find(|entry| {
            entry["sessionId"] == session_id
                && workspace_root
                    .filter(|root| !root.is_empty())
                    .is_none_or(|root| entry["workspaceRoot"] == root)
        })
    }

    /// `cache.save(record)`.
    pub async fn save(&self, record: &Value) -> AgentResult<()> {
        self.ready().await;
        let safe = normalize_record(record)?;
        let mut records = self.0.records.borrow_mut();
        let mut next = vec![safe.clone()];
        next.extend(
            records
                .iter()
                .filter(|entry| entry["sessionId"] != safe["sessionId"])
                .cloned(),
        );
        next.sort_by(by_updated_descending);
        next.truncate(MAX_SESSIONS);
        *records = next;
        Ok(())
    }

    /// `cache.archive(sessionId, archivedAt)`.
    pub async fn archive(&self, session_id: &str, archived_at: Option<String>) {
        self.ready().await;
        let archived_at = archived_at.unwrap_or_else(clock::now_iso);
        for entry in self.0.records.borrow_mut().iter_mut() {
            if entry["sessionId"] == session_id {
                entry["archivedAt"] = json!(archived_at);
                entry["updatedAt"] = json!(archived_at);
            }
        }
    }

    /// `cache.remove(sessionId)`.
    pub async fn remove(&self, session_id: &str) {
        self.ready().await;
        self.0
            .records
            .borrow_mut()
            .retain(|entry| entry["sessionId"] != session_id);
    }

    /// `cache.clear()`.
    pub fn clear(&self) {
        self.0.records.borrow_mut().clear();
    }
}

impl SessionCache for EphemeralAgentSessionCache {
    fn save(&self, record: Value, _promote_catalog: bool) -> Pending<()> {
        let cache = self.clone();
        Box::pin(async move { cache.save(&record).await })
    }
    fn find_by_id(
        &self,
        session_id: String,
        workspace_root: Option<String>,
    ) -> Pending<Option<Value>> {
        let cache = self.clone();
        Box::pin(async move {
            Ok(cache
                .find_by_id(&session_id, workspace_root.as_deref())
                .await)
        })
    }
    fn find_latest(
        &self,
        workspace_root: String,
        runtime_id: Option<String>,
    ) -> Pending<Option<Value>> {
        let cache = self.clone();
        Box::pin(async move {
            Ok(cache
                .find_latest(&workspace_root, runtime_id.as_deref())
                .await)
        })
    }
    /// Compatibility surface only. PuppyOne deliberately exposes no Chat History.
    fn list(&self, _workspace_root: String, _options: Value) -> Pending<Vec<Value>> {
        let cache = self.clone();
        Box::pin(async move {
            cache.ready().await;
            Ok(Vec::new())
        })
    }
    fn archive(&self, session_id: String, archived_at: String) -> Pending<()> {
        let cache = self.clone();
        Box::pin(async move {
            cache
                .archive(&session_id, Some(archived_at).filter(|a| !a.is_empty()))
                .await;
            Ok(())
        })
    }
    fn remove(&self, session_id: String) -> Pending<()> {
        let cache = self.clone();
        Box::pin(async move {
            cache.remove(&session_id).await;
            Ok(())
        })
    }
}

/// `removeLegacyJournals(legacyPath)`.
fn remove_legacy_journals(legacy_path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(legacy_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let Some(directory) = legacy_path.parent() else {
        return Ok(());
    };
    let prefix = format!(
        "{}.",
        legacy_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let stale: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(&prefix) && name.ends_with(".tmp"))
        .take(128)
        .map(|name| directory.join(name))
        .collect();
    for path in stale {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn by_updated_descending(left: &Value, right: &Value) -> std::cmp::Ordering {
    text::locale_compare(
        &js::to_js_string(right.get("updatedAt")),
        &js::to_js_string(left.get("updatedAt")),
    )
}

/// `normalizeRecord(record)`: bounded, redacted recovery events.
fn normalize_record(record: &Value) -> AgentResult<Value> {
    let runtime_id = normalize_runtime_id(
        record
            .get("runtimeId")
            .filter(|v| !v.is_null())
            .or(record.get("provider")),
    )?;
    let source_events: Vec<&Value> = record
        .get("events")
        .and_then(Value::as_array)
        .map(|events| {
            events
                .iter()
                .filter(|event| {
                    is_agent_event_envelope(event) && event["type"] != "command.output.delta"
                })
                .collect()
        })
        .unwrap_or_default();
    let start = source_events.len().saturating_sub(MAX_EVENTS_PER_SESSION);
    let candidate_events: Vec<Value> = source_events[start..]
        .iter()
        .map(|event| {
            redact_secrets(&js::with(
                &js::with(event, "runtimeId", runtime_id.as_str()),
                "provider",
                runtime_id.as_str(),
            ))
        })
        .collect();
    let text = |key: &str, limit: usize| normalize_text(record.get(key), limit);
    let non_empty = |value: String| (!value.is_empty()).then_some(value);
    let mut safe = redact_secrets(&json!({
        "sessionId": normalize_id(record.get("sessionId"))?,
        "workspaceRoot": normalize_path(record.get("workspaceRoot"))?,
        "runtimeId": runtime_id,
        "provider": runtime_id,
        "runtime": normalize_runtime(record.get("runtime"), &runtime_id),
        "providerSessionId": native_session_id(record.get("providerSessionId")),
        "sourceScopeId": native_session_id(record.get("sourceScopeId")).unwrap_or_else(|| "default".into()),
        "title": non_empty(text("title", 200)).unwrap_or_else(|| "Agent session".into()),
        "createdAt": normalize_date(record.get("createdAt")),
        "updatedAt": normalize_date(record.get("updatedAt")),
        "archivedAt": record.get("archivedAt").filter(|v| js::truthy(v)).map(|v| normalize_date(Some(v))),
        "terminalState": non_empty(text("terminalState", 40)).unwrap_or_else(|| "idle".into()),
        "selectedModel": non_empty(text("selectedModel", 300)),
        "selectedEffort": non_empty(text("selectedEffort", 160)),
        "selectedMode": non_empty(text("selectedMode", 160)),
        "lastSequence": normalize_sequence(record.get("lastSequence")),
        "partial": candidate_events.len() < source_events.len() || js::truthy_opt(record.get("partial")),
        "events": [],
    }));
    let mut retained = count_text_bytes(&safe);
    let mut kept = std::collections::VecDeque::new();
    for event in candidate_events.into_iter().rev() {
        let bytes = count_text_bytes(&event) + 1;
        if retained + bytes > MAX_SESSION_BYTES {
            safe["partial"] = json!(true);
            break;
        }
        retained += bytes;
        kept.push_front(event);
    }
    safe["events"] = Value::Array(kept.into_iter().collect());
    Ok(safe)
}

fn normalize_runtime(runtime: Option<&Value>, fallback_id: &str) -> Value {
    let field = |key: &str, limit: usize| {
        let value = normalize_text(runtime.and_then(|r| r.get(key)), limit);
        (!value.is_empty()).then_some(value)
    };
    json!({
        "id": fallback_id,
        "displayName": field("displayName", 100).unwrap_or_else(|| default_runtime_name(fallback_id)),
        "kind": field("kind", 40).unwrap_or_else(|| "native-cli".into()),
        "version": field("version", 80),
        "source": field("source", 40),
        "compatibility": field("compatibility", 80),
    })
}

fn default_runtime_name(id: &str) -> String {
    let spaced = NAME_SEPARATORS.replace_all(id, " ");
    WORD_START
        .replace_all(&spaced, |captures: &regex::Captures| {
            captures[0].to_uppercase()
        })
        .into_owned()
}

fn normalize_runtime_id(value: Option<&Value>) -> AgentResult<String> {
    match value.and_then(Value::as_str) {
        Some(id) if RUNTIME_ID.is_match(id) => Ok(canonical_runtime_id(id).to_string()),
        _ => Err(AgentError::new("Invalid Agent runtime id.")),
    }
}

fn normalize_id(value: Option<&Value>) -> AgentResult<String> {
    match value.and_then(Value::as_str) {
        Some(id) if SESSION_ID.is_match(id) => Ok(id.to_string()),
        _ => Err(AgentError::new("Invalid Agent session id.")),
    }
}

fn normalize_path(value: Option<&Value>) -> AgentResult<String> {
    match value.and_then(Value::as_str) {
        Some(path) if !path.is_empty() && text::len16(path) <= 4_096 => Ok(path.to_string()),
        _ => Err(AgentError::new("Invalid Agent workspace path.")),
    }
}

fn normalize_text(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|text| text::head16(text::trim(text), limit).to_string())
        .unwrap_or_default()
}

/// `normalizeDate(value)`.
fn normalize_date(value: Option<&Value>) -> String {
    let milliseconds = match value.filter(|v| js::truthy(v)) {
        None => Some(clock::now_ms()),
        Some(Value::String(text)) => clock::date_parse(text),
        Some(Value::Number(number)) => number.as_f64().filter(|n| n.is_finite()).map(|n| n as i64),
        Some(_) => None,
    };
    milliseconds.map_or_else(clock::now_iso, clock::iso_string)
}

fn normalize_sequence(value: Option<&Value>) -> i64 {
    let number = js::to_number(value);
    if number.fract() == 0.0 && number >= 0.0 && number <= js::MAX_SAFE_INTEGER as f64 {
        number as i64
    } else {
        0
    }
}

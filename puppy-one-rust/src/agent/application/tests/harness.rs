//! `tests/support/agent/agentServiceHarness.mjs`: an AgentService over the
//! Codex manifest with a scripted adapter and in-memory persistence.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::agent_service::{AgentService, AgentServiceOptions};
use crate::agent::application::ports::{
    AttachmentStore, Guard, HistoryCatalog, Logger, Pending, SessionCache,
};
use crate::agent::contract::js::Obj;
use crate::agent::event_loop::AbortSignal;
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AdapterOptions, AgentRuntimeAdapter,
};
use crate::agent::runtime::agent_runtime_registry::{
    AgentRuntimeRegistry, RuntimeDefinition, RuntimeDiscovery,
};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::sender::Sender;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;

/// Runs one async test on the Agent host's single-threaded runtime.
pub fn run<F: Future>(future: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime");
    tokio::task::LocalSet::new().block_on(&runtime, future)
}

/// Runs one async test with a paused clock (`vi.useFakeTimers()`).
pub fn run_paused<F: Future>(future: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .expect("test runtime");
    tokio::task::LocalSet::new().block_on(&runtime, future)
}

/// Lets spawned tasks run (`await new Promise(setImmediate)`).
pub async fn settle() {
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
}

pub const CODEX_MANIFEST: &str = r#"{
    "id": "codex", "displayName": "Codex",
    "description": "Codex's native app-server, login, models, tools, approvals and sessions.",
    "iconKey": "codex", "priority": 50,
    "execution": { "kind": "local-process", "distribution": "user-installed", "controller": "bundled-adapter" },
    "protocol": { "kind": "app-server", "transport": "stdio-json-rpc" },
    "integration": { "kind": "specialized-native", "adapter": "specialized" },
    "trust": { "level": "first-party", "publisher": "OpenAI" },
    "ownership": { "harness": "runtime", "credentials": ["runtime"], "models": "runtime", "billing": ["runtime"], "session": "runtime" }
}"#;

struct ReadyDiscovery;

impl RuntimeDiscovery for ReadyDiscovery {
    fn discover(
        &self,
        _refresh: bool,
        _signal: AbortSignal,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async {
            Ok(json!({
                "provider": "codex", "status": "ready", "code": "READY", "version": "0.144.1",
                "minimumVersion": "0.144.1", "executablePath": "/usr/local/bin/codex", "environment": {},
                "message": "ready", "selectable": true,
            }))
        })
    }
}

type Behavior = Rc<dyn Fn(Value) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// The scripted adapter (`createFakeAdapter`).
pub struct FakeAdapter {
    pub options: AdapterOptions,
    capabilities: Value,
    pub disposed: Cell<bool>,
    calls: RefCell<HashMap<&'static str, Vec<Value>>>,
    once: RefCell<HashMap<&'static str, VecDeque<Behavior>>>,
    always: RefCell<HashMap<&'static str, Behavior>>,
    resume_error: Option<AgentError>,
    native_sessions: Vec<Value>,
    resume_events: Vec<Value>,
    pub historical_events: Vec<Value>,
    /// `adapter.readHistory` calls.
    pub history_reads: Rc<Cell<usize>>,
}

impl FakeAdapter {
    /// `adapter.emit(event)`.
    pub fn emit(&self, event: Value) {
        (self.options.on_event)(event);
    }
    /// `adapter.exit(info)`.
    pub fn exit(&self, info: Value) {
        (self.options.on_exit)(info);
    }
    /// `adapter.confirmPersistence(id)`.
    pub fn confirm_persistence(&self) {
        if let Some(persisted) = &self.options.on_session_persisted {
            persisted(json!({ "providerSessionId": "thread-1", "sourceScopeId": "default" }));
        }
    }
    /// The recorded calls of `method`.
    pub fn calls(&self, method: &str) -> Vec<Value> {
        self.calls.borrow().get(method).cloned().unwrap_or_default()
    }
    /// `adapter.method.mockImplementationOnce(behavior)`.
    pub fn once(
        &self,
        method: &'static str,
        behavior: impl Fn(Value) -> LocalBoxFuture<'static, AgentResult<Value>> + 'static,
    ) {
        self.once
            .borrow_mut()
            .entry(method)
            .or_default()
            .push_back(Rc::new(behavior));
    }
    /// `adapter.method.mockImplementation(behavior)`.
    pub fn always(
        &self,
        method: &'static str,
        behavior: impl Fn(Value) -> LocalBoxFuture<'static, AgentResult<Value>> + 'static,
    ) {
        self.always.borrow_mut().insert(method, Rc::new(behavior));
    }
    /// An emitter usable inside a scripted behavior.
    pub fn emitter(&self) -> Rc<dyn Fn(Value)> {
        self.options.on_event.clone()
    }
    fn call(
        &self,
        method: &'static str,
        request: Value,
        default: impl FnOnce() -> AgentResult<Value>,
    ) -> AdapterFuture<'_, Value> {
        self.calls
            .borrow_mut()
            .entry(method)
            .or_default()
            .push(request.clone());
        let behavior = self
            .once
            .borrow_mut()
            .get_mut(method)
            .and_then(VecDeque::pop_front)
            .or_else(|| self.always.borrow().get(method).cloned());
        match behavior {
            Some(behavior) => behavior(request),
            None => {
                let result = default();
                Box::pin(async move { result })
            }
        }
    }
}

fn now() -> String {
    crate::agent::contract::js::now_iso()
}

impl AgentRuntimeAdapter for FakeAdapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        let capabilities = self.capabilities.clone();
        self.call("inspect", Value::Null, move || {
            Ok(json!({
                "account": { "account": { "type": "chatgpt", "email": "user@example.com", "planType": "plus" }, "requiresOpenaiAuth": true },
                "models": [{ "id": "gpt-5", "model": "gpt-5", "displayName": "GPT-5", "isDefault": true }],
                "capabilities": capabilities,
                "warnings": [],
            }))
        })
    }
    fn create_session(&self, selection: Value) -> AdapterFuture<'_, Value> {
        self.call("createSession", selection, || {
            Ok(json!({ "providerSessionId": "thread-1", "title": "Test session", "model": "gpt-5", "createdAt": now(), "updatedAt": now() }))
        })
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        let thread = request["threadId"].clone();
        let error = self.resume_error.clone();
        let events = self.resume_events.clone();
        let emit = self.emitter();
        self.call("resumeSession", request, move || {
            if let Some(error) = error {
                return Err(error);
            }
            for event in events {
                emit(event);
            }
            Ok(json!({ "providerSessionId": thread, "title": "Test session", "model": "gpt-5", "createdAt": now(), "updatedAt": now() }))
        })
    }
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        let emit = self.emitter();
        self.call("startTurn", request, move || {
            emit(json!({ "type": "turn.started", "providerSessionId": "thread-1", "turnId": "turn-1", "payload": { "status": "running" } }));
            Ok(json!({ "turnId": "turn-1" }))
        })
    }
    fn interrupt_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.call("interruptTurn", request, || Ok(Value::Null))
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        self.calls
            .borrow_mut()
            .entry("dispose")
            .or_default()
            .push(Value::Null);
        self.disposed.set(true);
        Box::pin(async { Ok(()) })
    }
    fn implements(&self, name: &str) -> bool {
        matches!(
            name,
            "resolveApproval" | "steerTurn" | "referenceMentionDelivery" | "getSessionHistoryPort"
        )
    }
    fn steer_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.call("steerTurn", request, || Ok(Value::Null))
    }
    fn resolve_approval(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.call("resolveApproval", request, || Ok(Value::Null))
    }
    fn reference_mention_delivery(&self, _reference: &Value) -> Option<&'static str> {
        Some("path")
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(FakeHistory {
            sessions: self.native_sessions.clone(),
            events: self.historical_events.clone(),
            thread: self
                .calls("resumeSession")
                .last()
                .and_then(|r| r["threadId"].as_str().map(str::to_string)),
            reads: self.history_reads.clone(),
        }))
    }
}

struct FakeHistory {
    sessions: Vec<Value>,
    events: Vec<Value>,
    thread: Option<String>,
    reads: Rc<Cell<usize>>,
}

impl SessionHistoryPort for FakeHistory {
    fn source_scope_id(&self) -> Option<String> {
        Some("default".into())
    }
    fn implements(&self, method: &str) -> bool {
        matches!(method, "discover" | "hydrate")
    }
    fn discover(
        &self,
        _cursor: Option<String>,
        _limit: usize,
        _signal: AbortSignal,
    ) -> AdapterFuture<'_, Value> {
        let sessions = self.sessions.clone();
        Box::pin(async move {
            Ok(json!({ "supported": true, "sessions": sessions, "nextCursor": null }))
        })
    }
    fn hydrate(&self, _signal: AbortSignal) -> AdapterFuture<'_, Value> {
        self.reads.set(self.reads.get() + 1);
        let events = self.events.clone();
        let thread = self.thread.clone().unwrap_or_else(|| "thread-1".into());
        Box::pin(async move {
            Ok(json!({ "events": events, "coverage": "unknown", "providerSessionId": thread }))
        })
    }
}

/// In-memory persistence (`persistence` and `conversationCatalog`).
#[derive(Default)]
pub struct FakePersistence {
    pub persisted: RefCell<Vec<(String, Value)>>,
    pub saves: RefCell<Vec<(Value, bool)>>,
    pub upserts: RefCell<Vec<Value>>,
    pub removed: RefCell<Vec<String>>,
    pub unavailable: RefCell<Vec<String>>,
}

impl FakePersistence {
    fn put(&self, id: String, entry: Value) {
        let mut persisted = self.persisted.borrow_mut();
        match persisted.iter_mut().find(|(k, _)| *k == id) {
            Some(slot) => slot.1 = entry,
            None => persisted.push((id, entry)),
        }
    }
    fn values(&self) -> Vec<Value> {
        self.persisted
            .borrow()
            .iter()
            .map(|(_, v)| v.clone())
            .collect()
    }
    /// `persistence.markUnavailable(id)`.
    pub fn mark(&self, id: &str) {
        let entry = self
            .persisted
            .borrow()
            .iter()
            .find(|(k, _)| k == id)
            .map(|(_, v)| v.clone());
        if let Some(entry) = entry {
            self.put(
                id.into(),
                Obj::from(&entry).set("availability", "unavailable").build(),
            );
        }
        self.unavailable.borrow_mut().push(id.into());
    }
}

fn ready<T: 'static>(value: T) -> Pending<T> {
    Box::pin(async move { Ok(value) })
}

impl SessionCache for Rc<FakePersistence> {
    fn supports(&self, method: &str) -> bool {
        method == "markUnavailable"
    }
    fn save(&self, record: Value, promote_catalog: bool) -> Pending<()> {
        self.saves
            .borrow_mut()
            .push((record.clone(), promote_catalog));
        let id = record["sessionId"].as_str().unwrap_or("").to_string();
        let mut entry = record;
        if promote_catalog {
            entry["availability"] = json!("available");
        }
        self.put(id, entry);
        ready(())
    }
    fn find_by_id(
        &self,
        session_id: String,
        workspace_root: Option<String>,
    ) -> Pending<Option<Value>> {
        let entry = self
            .persisted
            .borrow()
            .iter()
            .find(|(k, v)| {
                *k == session_id && v["workspaceRoot"].as_str() == workspace_root.as_deref()
            })
            .map(|(_, v)| v.clone());
        ready(entry)
    }
    fn find_latest(
        &self,
        workspace_root: String,
        _runtime_id: Option<String>,
    ) -> Pending<Option<Value>> {
        let entry = self.values().into_iter().find(|v| {
            v["workspaceRoot"] == workspace_root.as_str() && v["availability"] == "available"
        });
        ready(entry)
    }
    fn list(&self, workspace_root: String, _options: Value) -> Pending<Vec<Value>> {
        let entries = self
            .values()
            .into_iter()
            .filter(|v| {
                v["workspaceRoot"] == workspace_root.as_str() && v["availability"] == "available"
            })
            .collect();
        ready(entries)
    }
    fn archive(&self, _session_id: String, _archived_at: String) -> Pending<()> {
        ready(())
    }
    fn remove(&self, session_id: String) -> Pending<()> {
        self.removed.borrow_mut().push(session_id.clone());
        self.persisted
            .borrow_mut()
            .retain(|(k, _)| *k != session_id);
        ready(())
    }
    fn mark_unavailable(&self, session_id: String) -> Pending<()> {
        self.mark(&session_id);
        ready(())
    }
}

impl HistoryCatalog for Rc<FakePersistence> {
    fn list(&self, workspace_root: String, options: Value) -> Pending<Vec<Value>> {
        SessionCache::list(self, workspace_root, options)
    }
    fn get_revision(&self) -> Pending<i64> {
        ready(0)
    }
    fn get_coverage(&self) -> Pending<Value> {
        ready(
            json!({ "truncated": false, "capacity": 500, "retained": self.persisted.borrow().len() }),
        )
    }
    fn apply_native_page(
        &self,
        entries: Vec<Value>,
        scope: Value,
        reconcile_missing: bool,
        guard: Guard,
    ) -> Pending<Value> {
        if let Err(error) = guard() {
            return Box::pin(async move { Err(error) });
        }
        let count = entries.len();
        let mut saved = Vec::new();
        for entry in entries {
            self.upserts.borrow_mut().push(entry.clone());
            let existing = self.values().into_iter().find(|candidate| {
                candidate["workspaceRoot"] == entry["workspaceRoot"]
                    && candidate["runtimeId"] == entry["runtimeId"]
                    && candidate["providerSessionId"] == entry["providerSessionId"]
            });
            let id = existing
                .and_then(|e| e["sessionId"].as_str().map(str::to_string))
                .unwrap_or_else(|| format!("discovered-{}", self.persisted.borrow().len() + 1));
            let record = Obj::from(&entry)
                .set("sessionId", id.as_str())
                .set("origin", "native-discovery")
                .set("availability", "available")
                .build();
            self.put(id, record.clone());
            saved.push(record);
        }
        if reconcile_missing {
            let seen: Vec<Value> = scope["providerSessionIds"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            for (id, entry) in self.persisted.borrow_mut().iter_mut() {
                let _ = id;
                if entry["workspaceRoot"] == scope["workspaceRoot"]
                    && entry["runtimeId"] == scope["runtimeId"]
                    && !seen.contains(&entry["providerSessionId"])
                {
                    entry["availability"] = json!("unavailable");
                }
            }
        }
        ready(json!({ "indexed": count, "truncated": false, "sessions": saved }))
    }
}

/// Collected logger warnings.
#[derive(Default)]
pub struct RecordingLogger {
    pub warnings: RefCell<Vec<(String, Value)>>,
}

impl Logger for RecordingLogger {
    fn warn(&self, message: &str, detail: Value) {
        self.warnings.borrow_mut().push((message.into(), detail));
    }
}

/// `createServiceHarness(options)`.
#[derive(Default)]
pub struct HarnessOptions {
    pub capabilities: Option<Value>,
    pub attachment_store: Option<Rc<dyn AttachmentStore>>,
    pub resume_session_error: Option<AgentError>,
    pub native_sessions: Vec<Value>,
    pub resume_events: Vec<Value>,
    pub historical_events: Vec<Value>,
}

pub struct Harness {
    pub service: AgentService,
    pub adapters: Rc<RefCell<Vec<Rc<FakeAdapter>>>>,
    pub persistence: Rc<FakePersistence>,
    pub logger: Rc<RecordingLogger>,
}

impl Harness {
    pub fn adapter(&self, index: usize) -> Rc<FakeAdapter> {
        self.adapters.borrow()[index].clone()
    }
    pub fn last_adapter(&self) -> Rc<FakeAdapter> {
        self.adapters.borrow().last().cloned().expect("an adapter")
    }
}

pub fn create_service_harness(options: HarnessOptions) -> Harness {
    let adapters: Rc<RefCell<Vec<Rc<FakeAdapter>>>> = Rc::default();
    let capabilities = options
        .capabilities
        .unwrap_or_else(|| json!({ "manualApprovals": true }));
    let factory_adapters = adapters.clone();
    let resume_error = options.resume_session_error.clone();
    let native_sessions = options.native_sessions.clone();
    let resume_events = options.resume_events.clone();
    let historical_events = options.historical_events.clone();
    let definition = RuntimeDefinition {
        manifest: serde_json::from_str(CODEX_MANIFEST).expect("codex manifest"),
        discovery: Rc::new(ReadyDiscovery),
        create_adapter: Rc::new(move |adapter_options| {
            let adapter = Rc::new(FakeAdapter {
                options: adapter_options,
                capabilities: capabilities.clone(),
                disposed: Cell::new(false),
                calls: RefCell::default(),
                once: RefCell::default(),
                always: RefCell::default(),
                resume_error: resume_error.clone(),
                native_sessions: native_sessions.clone(),
                resume_events: resume_events.clone(),
                historical_events: historical_events.clone(),
                history_reads: Rc::default(),
            });
            factory_adapters.borrow_mut().push(adapter.clone());
            Ok(adapter as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: None,
        has_active_resources: None,
    };
    let registry = AgentRuntimeRegistry::new(vec![definition], None, None).expect("registry");
    let persistence = Rc::new(FakePersistence::default());
    let logger = Rc::new(RecordingLogger::default());
    let service = AgentService::new(AgentServiceOptions {
        runtime_registry: registry,
        session_cache: Rc::new(persistence.clone()),
        conversation_catalog: Some(Rc::new(persistence.clone())),
        logger: Some(logger.clone()),
        attachment_store: options.attachment_store,
        process_supervisor: None,
    });
    Harness {
        service,
        adapters,
        persistence,
        logger,
    }
}

/// A sender's recorded frames.
pub type Frames = Rc<RefCell<Vec<Value>>>;

/// `createSender(id)`: frames are recorded.
pub fn create_sender(id: u64) -> (Sender, Frames) {
    let frames: Frames = Rc::default();
    let sink = frames.clone();
    (
        Sender::new(id, Rc::new(move |frame| sink.borrow_mut().push(frame))),
        frames,
    )
}

/// `semanticReferenceCapabilities()`.
pub fn semantic_reference_capabilities() -> Value {
    json!({
        "schemaVersion": 1,
        "workspace": { "files": true, "directories": true },
        "attachments": {
            "image": { "accepted": true, "mimeTypes": ["image/png"] },
            "text": { "accepted": false }, "audio": { "accepted": false }, "video": { "accepted": false }, "binary": { "accepted": false },
        },
        "limits": { "maxCount": 32, "maxBytesPerReference": 26214400, "maxTotalBytes": 26214400 },
        "steer": false,
        "attachmentOnly": false,
    })
}

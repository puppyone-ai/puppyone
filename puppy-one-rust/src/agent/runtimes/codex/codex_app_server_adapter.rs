//! `runtimes/codex/codex-app-server-adapter.mjs`: Codex's native
//! app-server (`codex app-server --listen stdio://`) behind the runtime
//! port.
use super::codex_events::normalize_codex_notification;
use super::codex_history_discovery::discover_codex_history;
use super::codex_history_projection::normalize_historical_thread;
use super::codex_history_reader::{
    CodexRequest, read_codex_history, request_codex_metadata_only_thread,
};
use super::codex_history_source::codex_history_source;
use super::codex_identity::CODEX_RUNTIME_DESCRIPTOR;
use super::codex_interactions::{
    PendingApproval, PendingQuestion, codex_clear_pending_approvals,
    codex_clear_pending_approvals_for_turn, codex_clear_pending_questions,
    codex_clear_pending_questions_for_turn, codex_handle_server_request,
    codex_handle_server_request_resolved, codex_resolve_approval, codex_resolve_question,
};
use super::codex_native_values::{
    compatible_reasoning_effort, normalize_account, normalize_models, normalize_provider_session,
    require_string,
};
use super::codex_reference_input::{CODEX_NATIVE_IMAGE_MIME_TYPES, build_codex_turn_input};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::event_loop::{AbortSignal, spawn};
use crate::agent::runtime::agent_history_read_result::agent_history_read_result;
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AgentRuntimeAdapter, agent_provider_session_unavailable_error,
};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::runtime::native_persistence_reporter::NativePersistenceReporter;
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionEvent, ConnectionOptions, RequestOptions, Spawner,
};
use crate::agent::transports::rpc_connection::{
    ConnectionFactory, RpcConnection, jsonl_rpc_connection_factory,
};
use regex::Regex;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::sync::LazyLock;
use tokio::sync::oneshot;

/// `CODEX_CAPABILITIES`.
pub static CODEX_CAPABILITIES: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "streamingText": true,
        "structuredToolEvents": true,
        "commandOutputStreaming": true,
        "fileChangeEvents": true,
        "manualApprovals": true,
        "structuredQuestions": true,
        "resume": true,
        "fork": true,
        "steer": true,
        "queue": false,
        "attachments": true,
        "contextReferences": true,
        "modelSelection": true,
        "modeSelection": false,
        "slashCommands": false,
        "sessionHistory": true,
        "history": { "discovery": "paged", "exactOpen": "supported", "hydration": "paged" },
        "recovery": {
            "strategy": "object-reconciliation",
            "activeExecution": "outcome-unknown",
            "atomicHandoff": false,
        },
        "usage": true,
        "accountState": true,
        "mcp": true,
        "skills": true,
        "compaction": true,
        "revision": "codex-app-server:1",
        "protocol": { "name": "codex-app-server", "version": 1 },
        "constraints": {
            "modelSwitch": "turn-boundary",
            "modeSwitch": "unsupported",
            "forkRequiresIdle": true,
            "compactionRequiresIdle": true,
        },
        "referenceInputs": {
            "schemaVersion": 1,
            "workspace": { "files": true, "directories": true, "crossRoots": true },
            "attachments": {
                "image": { "accepted": true, "mimeTypes": CODEX_NATIVE_IMAGE_MIME_TYPES },
                "text": { "accepted": true },
                "audio": { "accepted": false },
                "video": { "accepted": false },
                "binary": { "accepted": true },
            },
            "limits": {
                "maxCount": 32,
                "maxBytesPerReference": 25 * 1024 * 1024,
                "maxTotalBytes": 25 * 1024 * 1024,
            },
            "steer": false,
            "attachmentOnly": false,
        },
    })
});

static NO_ROLLOUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bno rollout found for thread id\b").expect("pattern"));

/// `new CodexAppServerAdapter({ … })`.
pub struct CodexAdapterOptions {
    pub executable_path: String,
    /// The readiness environment (`{ NAME: value }`); `None` inherits ours.
    pub environment: Option<Value>,
    pub workspace_root: String,
    pub app_version: String,
    pub spawner: Option<Spawner>,
    pub connection_factory: Option<ConnectionFactory>,
    pub on_event: Rc<dyn Fn(Value)>,
    pub on_exit: Rc<dyn Fn(Value)>,
    pub on_session_persisted: Option<Rc<dyn Fn(Value)>>,
}

/// One `turn/start` awaiting its native correlation.
struct PendingTurnStart {
    resolve: RefCell<Option<oneshot::Sender<String>>>,
    uncertain: Cell<bool>,
    client_user_message_id: String,
}

/// The adapter's state, shared with its interaction handlers.
pub struct Inner {
    executable_path: String,
    environment: Option<Value>,
    source_scope_id: String,
    workspace_root: String,
    app_version: String,
    spawner: Option<Spawner>,
    connection_factory: ConnectionFactory,
    on_event: Rc<dyn Fn(Value)>,
    on_exit: Rc<dyn Fn(Value)>,
    persistence_reporter: NativePersistenceReporter,
    connection: RefCell<Option<Rc<dyn RpcConnection>>>,
    pub(super) thread_id: RefCell<Option<String>>,
    active_turn_id: RefCell<Option<String>>,
    terminal_turn_ids: RefCell<Vec<String>>,
    pending_turn_start: RefCell<Option<Rc<PendingTurnStart>>>,
    pub(super) pending_approvals: RefCell<Vec<PendingApproval>>,
    pub(super) pending_questions: RefCell<Vec<PendingQuestion>>,
    model_profiles: RefCell<HashMap<String, Value>>,
    session_lifecycle_type: Cell<Option<&'static str>>,
    disposed: Cell<bool>,
    last_connection_error: RefCell<Option<String>>,
}

impl Inner {
    pub(super) fn connection(&self) -> Option<Rc<dyn RpcConnection>> {
        self.connection.borrow().clone()
    }

    pub(super) fn require_connection(&self) -> AgentResult<Rc<dyn RpcConnection>> {
        self.connection()
            .ok_or_else(|| AgentError::new("The Codex app-server is not connected."))
    }

    /// `this.onEvent(event)`.
    pub(super) fn emit(&self, event: Value) {
        (self.on_event)(event);
    }

    /// `(method, params) => this.connection.request(method, params)`.
    fn history_request(&self) -> AgentResult<Rc<CodexRequest>> {
        let connection = self.require_connection()?;
        Ok(Rc::new(move |method: &str, params: Value| {
            connection.request(method, params, RequestOptions::default())
        }))
    }

    fn require_thread(&self) -> AgentResult<String> {
        self.thread_id
            .borrow()
            .clone()
            .ok_or_else(|| AgentError::new("No Codex thread is active."))
    }

    /// `#handleNotification(message)`.
    fn handle_notification(&self, message: &Value) {
        if message.get("method").and_then(Value::as_str) == Some("serverRequest/resolved") {
            let empty = json!({});
            let params = message
                .get("params")
                .filter(|p| !p.is_null())
                .unwrap_or(&empty);
            codex_handle_server_request_resolved(self, params);
            return;
        }
        for mut event in normalize_codex_notification(message) {
            if event["type"] == "session.started"
                && self.session_lifecycle_type.get() == Some("session.resumed")
            {
                event["type"] = Value::from("session.resumed");
            }
            let kind = js::str_or_empty(event.get("type")).to_string();
            let turn_id = event["turnId"]
                .as_str()
                .filter(|t| !t.is_empty())
                .map(str::to_string);
            if let Some(turn_id) = turn_id.filter(|_| kind.starts_with("turn.")) {
                let terminal = self.terminal_turn_ids.borrow().contains(&turn_id);
                if kind == "turn.started" && !terminal {
                    *self.active_turn_id.borrow_mut() = Some(turn_id.clone());
                    let pending = self.pending_turn_start.borrow_mut().take();
                    if let Some(pending) = pending {
                        event["payload"] = js::with(
                            &event["payload"],
                            "clientUserMessageId",
                            pending.client_user_message_id.as_str(),
                        );
                        if let Some(resolve) = pending.resolve.borrow_mut().take() {
                            let _ = resolve.send(turn_id.clone());
                        }
                    }
                }
                if matches!(
                    kind.as_str(),
                    "turn.completed" | "turn.failed" | "turn.interrupted"
                ) {
                    drop(self.persistence_reporter.confirm());
                    {
                        let mut terminal = self.terminal_turn_ids.borrow_mut();
                        if !terminal.contains(&turn_id) {
                            terminal.push(turn_id.clone());
                        }
                        while terminal.len() > 128 {
                            terminal.remove(0);
                        }
                    }
                    if self.active_turn_id.borrow().as_deref() == Some(turn_id.as_str()) {
                        *self.active_turn_id.borrow_mut() = None;
                    }
                    codex_clear_pending_approvals_for_turn(
                        self,
                        Some(&turn_id),
                        "turn-ended",
                        false,
                    );
                    codex_clear_pending_questions_for_turn(self, &turn_id, false);
                }
            }
            self.emit(event);
        }
    }
}

/// `CodexAppServerAdapter`.
#[derive(Clone)]
pub struct CodexAppServerAdapter(Rc<Inner>);

impl CodexAppServerAdapter {
    pub fn new(options: CodexAdapterOptions) -> Self {
        let environment = options.environment.clone();
        let read_env = |key: &str| match environment.as_ref() {
            Some(environment) => environment
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_string),
            None => std::env::var(key).ok(),
        };
        let (source_scope_id, _root): (String, PathBuf) = codex_history_source(&read_env);
        let report = options
            .on_session_persisted
            .clone()
            .unwrap_or_else(|| Rc::new(|_| {}));
        Self(Rc::new_cyclic(|weak: &Weak<Inner>| {
            let verifier = weak.clone();
            let closed = weak.clone();
            let reporter = NativePersistenceReporter::new(
                Rc::new(move || {
                    let weak = verifier.clone();
                    Box::pin(async move {
                        let Some(inner) = weak.upgrade() else {
                            return Ok(None);
                        };
                        let Some(id) = inner.thread_id.borrow().clone() else {
                            return Ok(None);
                        };
                        let request = inner.history_request()?;
                        let page = discover_codex_history(
                            &*request,
                            &inner.workspace_root,
                            None,
                            Some(&json!(100)),
                            None,
                        )
                        .await?;
                        let verified = page["sessions"].as_array().is_some_and(|sessions| {
                            sessions
                                .iter()
                                .any(|entry| entry["providerSessionId"] == id)
                        });
                        let current = inner.thread_id.borrow().as_deref() == Some(id.as_str());
                        Ok((verified && current).then(|| {
                            json!({ "providerSessionId": id, "sourceScopeId": inner.source_scope_id })
                        }))
                    })
                }),
                report,
                Rc::new(move || closed.upgrade().is_none_or(|inner| inner.disposed.get())),
            );
            Inner {
                executable_path: options.executable_path,
                environment: options.environment,
                source_scope_id,
                workspace_root: options.workspace_root,
                app_version: options.app_version,
                spawner: options.spawner,
                connection_factory: options
                    .connection_factory
                    .unwrap_or_else(jsonl_rpc_connection_factory),
                on_event: options.on_event,
                on_exit: options.on_exit,
                persistence_reporter: reporter,
                connection: RefCell::default(),
                thread_id: RefCell::default(),
                active_turn_id: RefCell::default(),
                terminal_turn_ids: RefCell::default(),
                pending_turn_start: RefCell::default(),
                pending_approvals: RefCell::default(),
                pending_questions: RefCell::default(),
                model_profiles: RefCell::default(),
                session_lifecycle_type: Cell::new(None),
                disposed: Cell::new(false),
                last_connection_error: RefCell::default(),
            }
        }))
    }

    /// `adapter.threadId`.
    pub fn thread_id(&self) -> Option<String> {
        self.0.thread_id.borrow().clone()
    }

    /// `adapter.activeTurnId`.
    pub fn active_turn_id(&self) -> Option<String> {
        self.0.active_turn_id.borrow().clone()
    }

    #[cfg(test)]
    pub(crate) fn set_thread_id(&self, id: Option<&str>) {
        *self.0.thread_id.borrow_mut() = id.map(str::to_string);
    }

    #[cfg(test)]
    pub(crate) fn set_active_turn_id(&self, id: Option<&str>) {
        *self.0.active_turn_id.borrow_mut() = id.map(str::to_string);
    }

    #[cfg(test)]
    pub(crate) fn has_pending_turn_start(&self) -> bool {
        self.0.pending_turn_start.borrow().is_some()
    }

    /// `adapter.connect()`.
    pub async fn connect(&self) -> AgentResult<()> {
        let inner = &self.0;
        if inner.connection.borrow().is_some() {
            return Ok(());
        }
        let env = inner
            .environment
            .as_ref()
            .and_then(Value::as_object)
            .map(|map| {
                map.iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect()
            });
        let connection = (inner.connection_factory)(ConnectionOptions {
            executable_path: PathBuf::from(&inner.executable_path),
            args: vec!["app-server".into(), "--listen".into(), "stdio://".into()],
            cwd: PathBuf::from(&inner.workspace_root),
            env,
            spawner: inner.spawner.clone(),
            ..Default::default()
        })?;
        *inner.connection.borrow_mut() = Some(connection.clone());
        let weak = Rc::downgrade(inner);
        connection.on(Rc::new(move |event| {
            let Some(inner) = weak.upgrade() else { return };
            match event {
                ConnectionEvent::Notification(message) => inner.handle_notification(&message),
                ConnectionEvent::Request(message) => codex_handle_server_request(&inner, &message),
                ConnectionEvent::ProtocolError(error) => {
                    *inner.last_connection_error.borrow_mut() =
                        Some(redact_secret_text(&error.message));
                }
                ConnectionEvent::Exit(info) => {
                    codex_clear_pending_approvals(&inner, "cancel", false);
                    (inner.on_exit)(info);
                }
            }
        }));
        let initialized = connection
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "puppyone_desktop",
                        "title": "PuppyOne Desktop",
                        "version": inner.app_version,
                    },
                    "capabilities": { "experimentalApi": false, "requestAttestation": false },
                }),
                RequestOptions::default(),
            )
            .await
            .and_then(|_| connection.notify("initialized", None));
        if let Err(error) = initialized {
            let diagnostic = connection.diagnostics();
            connection.dispose("JSONL-RPC connection closed.", true);
            let message = [error.message, diagnostic]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            return Err(AgentError::new(redact_secret_text(&message)));
        }
        Ok(())
    }

    async fn inspect_inner(&self) -> AgentResult<Value> {
        self.connect().await?;
        let connection = self.0.require_connection()?;
        let (account_result, model_result) = futures_util::future::join(
            connection.request(
                "account/read",
                json!({ "refreshToken": false }),
                RequestOptions::default(),
            ),
            connection.request(
                "model/list",
                json!({ "includeHidden": false, "limit": 100 }),
                RequestOptions::default(),
            ),
        )
        .await;
        let reason = |error: &AgentError| {
            if error.message.is_empty() {
                "Error".to_string()
            } else {
                error.message.clone()
            }
        };
        if let (Err(account_error), Err(model_error)) = (&account_result, &model_result) {
            let message = [&account_error.message, &model_error.message]
                .into_iter()
                .find(|m| !m.is_empty())
                .cloned()
                .unwrap_or_else(|| "Codex account and model inspection failed.".into());
            return Err(AgentError::new(redact_secret_text(&message)));
        }
        let account = match &account_result {
            Ok(value) => normalize_account(value),
            Err(error) => json!({
                "account": null,
                "requiresOpenaiAuth": false,
                "error": redact_secret_text(&reason(error)),
            }),
        };
        let models = match &model_result {
            Ok(value) => normalize_models(value),
            Err(_) => Vec::new(),
        };
        *self.0.model_profiles.borrow_mut() = models
            .iter()
            .map(|model| (js::to_js_string(model.get("model")), model.clone()))
            .collect();
        let mut warnings: Vec<Value> = Vec::new();
        if account_result.is_err() {
            warnings.push(account["error"].clone());
        }
        if let Err(error) = &model_result {
            warnings.push(Value::from(redact_secret_text(&reason(error))));
        }
        warnings.retain(js::truthy);
        let descriptor = &*CODEX_RUNTIME_DESCRIPTOR;
        Ok(json!({
            "account": account,
            "models": models,
            "modes": [],
            "commands": [],
            "capabilities": *CODEX_CAPABILITIES,
            "runtime": {
                "id": descriptor["id"],
                "displayName": descriptor["displayName"],
                "description": "Codex's native app-server runtime.",
                "kind": "native-cli",
                "iconKey": descriptor["iconKey"],
                "version": null,
                "source": "external",
                "compatibility": "versioned-app-server",
            },
            "warnings": warnings,
        }))
    }

    /// `adapter.discoverSessions({ cursor, limit, signal })`.
    pub async fn discover_sessions(
        &self,
        cursor: Option<String>,
        limit: Option<Value>,
        signal: Option<AbortSignal>,
    ) -> AgentResult<Value> {
        if let Some(signal) = signal.as_ref() {
            signal.throw_if_aborted()?;
        }
        self.connect().await?;
        let request = self.0.history_request()?;
        discover_codex_history(
            &*request,
            &self.0.workspace_root,
            cursor.as_deref(),
            limit.as_ref(),
            signal.as_ref(),
        )
        .await
    }

    async fn create_session_inner(&self, selection: Value) -> AgentResult<Value> {
        self.connect().await?;
        let model = selection.get("model").filter(|m| js::truthy(m)).cloned();
        let effort = selection.get("effort").cloned().unwrap_or(Value::Null);
        self.0.session_lifecycle_type.set(Some("session.started"));
        let result = self
            .0
            .require_connection()?
            .request(
                "thread/start",
                Obj::new()
                    .set("cwd", self.0.workspace_root.as_str())
                    .set("approvalPolicy", "on-request")
                    .set("sandbox", "workspace-write")
                    .set("ephemeral", false)
                    .set("threadSource", "puppyone-desktop")
                    .opt("model", model)
                    .build(),
                RequestOptions::default(),
            )
            .await;
        self.0.session_lifecycle_type.set(None);
        let result = result?;
        let thread_id = require_string(
            result.get("thread").and_then(|t| t.get("id")),
            "Codex thread/start did not return a thread id.",
        )?;
        *self.0.thread_id.borrow_mut() = Some(thread_id);
        Ok(js::with(
            &normalize_provider_session(&result),
            "effort",
            effort,
        ))
    }

    async fn resume_session_inner(&self, request: Value) -> AgentResult<Value> {
        self.connect().await?;
        let model = request.get("model").filter(|m| js::truthy(m)).cloned();
        let effort = request.get("effort").cloned().unwrap_or(Value::Null);
        self.0.session_lifecycle_type.set(Some("session.resumed"));
        let result = async {
            let history = self.0.history_request()?;
            request_codex_metadata_only_thread(
                &*history,
                "thread/resume",
                Obj::new()
                    .opt("threadId", request.get("threadId").cloned())
                    .set("cwd", self.0.workspace_root.as_str())
                    .set("approvalPolicy", "on-request")
                    .set("sandbox", "workspace-write")
                    .opt("model", model)
                    .build(),
            )
            .await
        }
        .await;
        self.0.session_lifecycle_type.set(None);
        let result = result.map_err(|error| {
            if NO_ROLLOUT.is_match(&error.message) {
                agent_provider_session_unavailable_error(Some(
                    "The saved Codex thread is no longer available.",
                ))
            } else {
                error
            }
        })?;
        let thread_id = require_string(
            result.get("thread").and_then(|t| t.get("id")),
            "Codex thread/resume did not return a thread id.",
        )?;
        *self.0.thread_id.borrow_mut() = Some(thread_id);
        Ok(js::with(
            &normalize_provider_session(&result),
            "effort",
            effort,
        ))
    }

    /// `adapter.readHistory()`.
    pub async fn read_history(&self) -> AgentResult<Vec<Value>> {
        let result = self.read_history_result().await?;
        Ok(result["events"].as_array().cloned().unwrap_or_default())
    }

    /// `adapter.readHistoryResult()`.
    pub async fn read_history_result(&self) -> AgentResult<Value> {
        let thread_id = self.0.require_thread()?;
        let request = self.0.history_request()?;
        let thread = read_codex_history(&*request, &thread_id).await?;
        let coverage = thread
            .get("coverage")
            .filter(|c| !c.is_null())
            .cloned()
            .unwrap_or_else(|| Value::from("unknown"));
        let reason = if coverage == "partial" {
            Value::from("read-limit")
        } else {
            Value::Null
        };
        agent_history_read_result(&json!({
            "providerSessionId": thread_id,
            "events": normalize_historical_thread(&thread),
            "coverage": coverage,
            "reason": reason,
        }))
    }

    async fn start_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let thread_id = inner.require_thread()?;
        if inner.pending_turn_start.borrow().is_some() {
            return Err(AgentError::new("A Codex turn is already starting."));
        }
        let client_user_message_id = match request.get("clientUserMessageId") {
            None => uuid::Uuid::new_v4().to_string(),
            Some(id) => js::to_js_string(Some(id)),
        };
        let model = request.get("model").filter(|m| !m.is_null()).cloned();
        let profile = model.as_ref().and_then(|model| {
            inner
                .model_profiles
                .borrow()
                .get(&js::to_js_string(Some(model)))
                .cloned()
        });
        let effort = compatible_reasoning_effort(profile.as_ref(), request.get("effort"))?;
        let list = |key: &str| {
            request
                .get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        let references = list("references");
        let references = if references.is_empty() {
            [list("contextReferences"), list("attachments")].concat()
        } else {
            references
        };
        let input = build_codex_turn_input(
            js::str_or_empty(request.get("prompt")),
            &references,
            Some(&inner.workspace_root),
        )?;
        let (resolve, mut native_start) = oneshot::channel::<String>();
        // Codex does not support a local prompt queue, so one pending start can
        // be correlated safely with the next native turn/started notification.
        let pending = Rc::new(PendingTurnStart {
            resolve: RefCell::new(Some(resolve)),
            uncertain: Cell::new(false),
            client_user_message_id: client_user_message_id.clone(),
        });
        *inner.pending_turn_start.borrow_mut() = Some(pending.clone());
        let late = {
            let weak = Rc::downgrade(inner);
            let pending = pending.clone();
            Rc::new(move |result: AgentResult<Value>| {
                let Some(inner) = weak.upgrade() else { return };
                let current = inner
                    .pending_turn_start
                    .borrow()
                    .as_ref()
                    .is_some_and(|p| Rc::ptr_eq(p, &pending));
                if inner.disposed.get() || !current {
                    return;
                }
                if let Ok(value) = result
                    && js::truthy_opt(value.get("turn").and_then(|t| t.get("id")))
                {
                    let thread_id = inner.thread_id.borrow().clone();
                    inner.handle_notification(&json!({
                        "method": "turn/started",
                        "params": { "threadId": thread_id, "turn": value["turn"] },
                    }));
                }
            })
        };
        let outcome = async {
            let connection = inner.require_connection()?;
            let mut rpc = connection.request(
                "turn/start",
                Obj::new()
                    .set("threadId", thread_id.as_str())
                    .set("clientUserMessageId", client_user_message_id.as_str())
                    .set("input", input)
                    .set("cwd", inner.workspace_root.as_str())
                    .set("approvalPolicy", "on-request")
                    .opt("model", model.clone().filter(js::truthy))
                    .opt("effort", effort)
                    .build(),
                RequestOptions {
                    on_late_response: Some(late),
                    ..Default::default()
                },
            );
            tokio::select! {
                biased;
                result = &mut rpc => result,
                Ok(turn_id) = &mut native_start => {
                    // A correlated native start is authoritative delivery
                    // evidence. The RPC response may still arrive later; a late
                    // timeout must not retire a live connection after the turn
                    // has already started or completed.
                    spawn(async move {
                        let _ = rpc.await;
                    });
                    Ok(json!({ "turn": { "id": turn_id } }))
                }
            }
        }
        .await;
        let outcome = outcome.map_err(|mut error| {
            if error.delivery_outcome.as_deref() == Some("unknown") {
                pending.uncertain.set(true);
            }
            // The request identity remains useful even when delivery is
            // ambiguous: a native user item may still arrive and confirm that
            // exact command.
            error.client_user_message_id = Some(client_user_message_id.clone());
            error
        });
        if !pending.uncertain.get() {
            let mut current = inner.pending_turn_start.borrow_mut();
            if current.as_ref().is_some_and(|p| Rc::ptr_eq(p, &pending)) {
                *current = None;
            }
        }
        let result = outcome?;
        let turn_id = require_string(
            result.get("turn").and_then(|t| t.get("id")),
            "Codex turn/start did not return a turn id.",
        )?;
        // A receipt confirms delivery. Notifications received while awaiting
        // it already describe newer native execution state and must win.
        if !inner.terminal_turn_ids.borrow().contains(&turn_id) {
            let mut active = inner.active_turn_id.borrow_mut();
            if active.as_ref().is_none_or(|active| *active == turn_id) {
                *active = Some(turn_id.clone());
            }
        }
        Ok(json!({ "turnId": turn_id, "clientUserMessageId": client_user_message_id }))
    }

    async fn interrupt_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let thread_id = self.0.require_thread()?;
        let turn_id = request.get("turnId").cloned().unwrap_or(Value::Null);
        self.0
            .require_connection()?
            .request(
                "turn/interrupt",
                Obj::new()
                    .set("threadId", thread_id)
                    .set("turnId", turn_id.clone())
                    .build(),
                RequestOptions::default(),
            )
            .await?;
        codex_clear_pending_approvals_for_turn(&self.0, turn_id.as_str(), "turn-interrupted", true);
        codex_clear_pending_questions_for_turn(&self.0, turn_id.as_str().unwrap_or(""), true);
        Ok(Value::Null)
    }

    async fn steer_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let thread_id = self.0.require_thread()?;
        if request
            .get("references")
            .and_then(Value::as_array)
            .is_some_and(|references| !references.is_empty())
        {
            return Err(AgentError::new(
                "Codex steer does not accept reference inputs.",
            ));
        }
        let input = build_codex_turn_input(js::str_or_empty(request.get("message")), &[], None)?;
        self.0
            .require_connection()?
            .request(
                "turn/steer",
                Obj::new()
                    .set("threadId", thread_id)
                    .set(
                        "expectedTurnId",
                        request.get("turnId").cloned().unwrap_or(Value::Null),
                    )
                    .set("input", input)
                    .build(),
                RequestOptions::default(),
            )
            .await?;
        Ok(Value::Null)
    }

    async fn fork_session_inner(&self, request: Value) -> AgentResult<Value> {
        let thread_id = self.0.require_thread()?;
        if self.0.active_turn_id.borrow().is_some() {
            return Err(AgentError::new(
                "Stop the active Codex turn before forking.",
            ));
        }
        let history = self.0.history_request()?;
        let result = request_codex_metadata_only_thread(
            &*history,
            "thread/fork",
            Obj::new()
                .set("threadId", thread_id)
                .opt(
                    "messageId",
                    request.get("messageId").filter(|m| js::truthy(m)).cloned(),
                )
                .build(),
        )
        .await?;
        let provider_session_id = require_string(
            result.get("thread").and_then(|t| t.get("id")),
            "Codex thread/fork did not return a thread id.",
        )?;
        Ok(json!({ "providerSessionId": provider_session_id }))
    }

    async fn compact_session_inner(&self) -> AgentResult<Value> {
        let thread_id = self.0.require_thread()?;
        if self.0.active_turn_id.borrow().is_some() {
            return Err(AgentError::new(
                "Stop the active Codex turn before compacting.",
            ));
        }
        self.0
            .require_connection()?
            .request(
                "thread/compact/start",
                json!({ "threadId": thread_id }),
                RequestOptions::default(),
            )
            .await?;
        Ok(Value::Null)
    }

    /// `adapter.resolveApproval(request)`.
    pub fn resolve_approval_now(&self, request: &Value) -> AgentResult<()> {
        codex_resolve_approval(&self.0, request)
    }

    /// `adapter.resolveQuestion(request)`.
    pub fn resolve_question_now(&self, request: &Value) -> AgentResult<()> {
        codex_resolve_question(&self.0, request)
    }

    /// `adapter.dispose(reason)`.
    pub async fn dispose_with(&self, reason: &str) -> AgentResult<()> {
        let inner = &self.0;
        let connection = inner.connection();
        if inner.disposed.replace(true) {
            if let Some(connection) = connection {
                connection.wait_for_exit().await?;
            }
            return Ok(());
        }
        codex_clear_pending_approvals(inner, "cancel", true);
        codex_clear_pending_questions(inner, true);
        if let Some(connection) = connection {
            connection.dispose(reason, true);
            connection.wait_for_exit().await?;
        }
        Ok(())
    }
}

impl AgentRuntimeAdapter for CodexAppServerAdapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        Box::pin(self.inspect_inner())
    }
    fn create_session(&self, selection: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.create_session_inner(selection))
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.resume_session_inner(request))
    }
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.start_turn_inner(request))
    }
    fn interrupt_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.interrupt_turn_inner(request))
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        Box::pin(self.dispose_with("Codex app-server adapter closed."))
    }
    fn implements(&self, name: &str) -> bool {
        matches!(
            name,
            "steerTurn"
                | "resolveApproval"
                | "resolveQuestion"
                | "forkSession"
                | "compactSession"
                | "referenceMentionDelivery"
                | "getSessionHistoryPort"
        )
    }
    fn steer_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.steer_turn_inner(request))
    }
    fn resolve_approval(&self, request: Value) -> AdapterFuture<'_, Value> {
        let result = self.resolve_approval_now(&request).map(|()| Value::Null);
        Box::pin(async move { result })
    }
    fn resolve_question(&self, request: Value) -> AdapterFuture<'_, Value> {
        let result = self.resolve_question_now(&request).map(|()| Value::Null);
        Box::pin(async move { result })
    }
    fn fork_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.fork_session_inner(request))
    }
    fn compact_session(&self) -> AdapterFuture<'_, Value> {
        Box::pin(self.compact_session_inner())
    }
    fn reference_mention_delivery(&self, _reference: &Value) -> Option<&'static str> {
        Some("path")
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(CodexHistoryPort(self.clone())))
    }
}

/// `adapter.getSessionHistoryPort()`.
struct CodexHistoryPort(CodexAppServerAdapter);

impl SessionHistoryPort for CodexHistoryPort {
    fn source_scope_id(&self) -> Option<String> {
        Some(self.0.0.source_scope_id.clone())
    }
    fn implements(&self, method: &str) -> bool {
        matches!(method, "discover" | "hydrate")
    }
    fn discover(
        &self,
        cursor: Option<String>,
        limit: usize,
        signal: AbortSignal,
    ) -> AdapterFuture<'_, Value> {
        Box::pin(
            self.0
                .discover_sessions(cursor, Some(Value::from(limit)), Some(signal)),
        )
    }
    fn hydrate(&self, _signal: AbortSignal) -> AdapterFuture<'_, Value> {
        Box::pin(self.0.read_history_result())
    }
}

//! `protocols/pi-rpc/pi-rpc-runtime-adapter.mjs`: the shared adapter for a
//! user-owned Pi CLI or a product-owned Pi SDK worker.
use super::pi_event_normalizer::{PiEventState, normalize_pi_history, normalize_pi_rpc_event};
use super::pi_prompt_input::{
    PI_NATIVE_IMAGE_MAX_BYTES, PI_NATIVE_IMAGE_MIME_TYPES, build_pi_turn_input,
};
use super::pi_rpc_client::{
    PiClient, PiClientEvent, PiClientFactory, PiClientOptions, pi_rpc_client_factory,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::{bound_renderer_value, redact_secret_text, redact_secrets};
use crate::agent::contract::js::{self, Obj};
use crate::agent::runtime::agent_history_read_result::agent_history_read_result;
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AgentRuntimeAdapter, agent_provider_session_unavailable_error,
};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::runtime::native_persistence_reporter::NativePersistenceReporter;
use crate::agent::tasks::CancelSignal;
use crate::agent::transports::jsonl_rpc_connection::{RequestOptions, Spawner};
use crate::clock;
use crate::text;
use regex::Regex;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};
use std::sync::LazyLock;

const PI_REASONING_LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high"];

static SESSION_UNAVAILABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)session.+(?:not found|unavailable|does not exist)").expect("pattern")
});
static CONFIRMED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(?:yes|true|confirm|continue)$").expect("pattern"));
static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));
static NAMESPACE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9-]{1,80}$").expect("pattern"));

/// `PI_CAPABILITIES`.
pub static PI_CAPABILITIES: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "streamingText": true,
        "structuredToolEvents": true,
        "commandOutputStreaming": true,
        "fileChangeEvents": true,
        "manualApprovals": false,
        "structuredQuestions": true,
        "resume": true,
        "fork": false,
        "steer": true,
        "queue": true,
        "attachments": true,
        "contextReferences": true,
        "modelSelection": true,
        "modeSelection": false,
        "slashCommands": true,
        "sessionHistory": true,
        "history": { "discovery": "unsupported", "exactOpen": "supported", "hydration": "snapshot" },
        "recovery": { "strategy": "snapshot-reload", "activeExecution": "outcome-unknown", "atomicHandoff": false },
        "usage": true,
        "accountState": true,
        "mcp": false,
        "skills": true,
        "compaction": true,
        "revision": "pi-rpc:1",
        "protocol": { "name": "pi-rpc", "version": 1 },
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
                "image": {
                    "accepted": true,
                    "mimeTypes": PI_NATIVE_IMAGE_MIME_TYPES,
                    "maxBytes": PI_NATIVE_IMAGE_MAX_BYTES,
                },
                "text": { "accepted": true },
                "audio": { "accepted": false },
                "video": { "accepted": false },
                // Non-media binaries are delivered only as authorized native
                // path mentions; PuppyOne never parses or embeds them.
                "binary": { "accepted": true },
            },
            "limits": {
                "maxCount": 32,
                // Path references are not materialized into the RPC frame.
                // Images keep their narrower limits inside pi-prompt-input.
                "maxBytesPerReference": 25 * 1024 * 1024,
                "maxTotalBytes": 25 * 1024 * 1024,
            },
            "steer": true,
            "attachmentOnly": false,
        },
    })
});

/// `projectInstructionLoader(workspaceRoot)`.
pub type PiInstructionLoader = Rc<dyn Fn(&str) -> AgentResult<Option<Value>>>;
/// `projectInstructionFormatter(value)`.
pub type PiInstructionFormatter = Rc<dyn Fn(&Value) -> Option<String>>;
/// `approvalRequestParser(message)`.
pub type ApprovalRequestParser = Rc<dyn Fn(&Value) -> Option<Value>>;

/// `new PiRpcRuntimeAdapter({ … })`.
#[derive(Clone)]
pub struct PiAdapterOptions {
    pub readiness: Value,
    pub workspace_root: String,
    pub on_event: Rc<dyn Fn(Value)>,
    pub on_exit: Rc<dyn Fn(Value)>,
    pub on_session_persisted: Option<Rc<dyn Fn(Value)>>,
    pub spawner: Option<Spawner>,
    pub client_factory: Option<PiClientFactory>,
    pub on_dispose: Option<Rc<dyn Fn()>>,
    pub runtime_descriptor: Value,
    /// `historySource.sourceScopeId`.
    pub source_scope_id: String,
    pub runtime_label: Option<String>,
    pub runtime_namespace: Option<String>,
    pub provider_source: Option<String>,
    pub account_type: Option<String>,
    pub capabilities: Option<Value>,
    pub runtime_setup_message: Option<String>,
    pub project_instruction_loader: Option<PiInstructionLoader>,
    pub project_instruction_formatter: Option<PiInstructionFormatter>,
    pub approval_request_parser: Option<ApprovalRequestParser>,
    pub sensitive_values: Vec<String>,
}

impl PiAdapterOptions {
    pub fn new(
        readiness: Value,
        workspace_root: &str,
        runtime_descriptor: Value,
        source_scope_id: String,
    ) -> Self {
        Self {
            readiness,
            workspace_root: workspace_root.into(),
            on_event: Rc::new(|_| {}),
            on_exit: Rc::new(|_| {}),
            on_session_persisted: None,
            spawner: None,
            client_factory: None,
            on_dispose: None,
            runtime_descriptor,
            source_scope_id,
            runtime_label: None,
            runtime_namespace: None,
            provider_source: None,
            account_type: None,
            capabilities: None,
            runtime_setup_message: None,
            project_instruction_loader: None,
            project_instruction_formatter: None,
            approval_request_parser: None,
            sensitive_values: Vec::new(),
        }
    }
}

struct PendingApproval {
    request_id: String,
    rpc_id: String,
    turn_id: String,
    scope_key: Option<String>,
    available_decisions: Vec<&'static str>,
}

struct PendingQuestion {
    request_id: String,
    rpc_id: String,
    method: String,
    turn_id: String,
    item_id: String,
}

type ActiveState = Rc<RefCell<PiEventState>>;

/// The adapter's state.
pub struct Inner {
    readiness: Value,
    workspace_root: String,
    on_event: Rc<dyn Fn(Value)>,
    on_exit: Rc<dyn Fn(Value)>,
    persistence_reporter: NativePersistenceReporter,
    spawner: Option<Spawner>,
    client_factory: PiClientFactory,
    on_dispose: Option<Rc<dyn Fn()>>,
    runtime_descriptor: Value,
    source_scope_id: String,
    runtime_label: String,
    runtime_namespace: String,
    provider_source: String,
    account_type: String,
    capabilities: Value,
    runtime_setup_message: String,
    project_instruction_loader: Option<PiInstructionLoader>,
    project_instruction_formatter: PiInstructionFormatter,
    approval_request_parser: Option<ApprovalRequestParser>,
    sensitive_values: Vec<String>,
    clients: RefCell<Vec<Rc<dyn PiClient>>>,
    client: RefCell<Option<Rc<dyn PiClient>>>,
    session_id: RefCell<Option<String>>,
    session_state: RefCell<Option<Value>>,
    active_state: RefCell<Option<ActiveState>>,
    pending_approvals: RefCell<Vec<PendingApproval>>,
    pending_questions: RefCell<Vec<PendingQuestion>>,
    session_approval_scopes: RefCell<HashSet<String>>,
    disposed: Cell<bool>,
    dispose_notified: Cell<bool>,
    last_protocol_error: RefCell<Option<String>>,
}

fn bounded(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|s| text::head16(s.trim(), limit).to_string())
        .unwrap_or_default()
}

fn bounded_str(value: &str, limit: usize) -> String {
    bounded(Some(&Value::from(value)), limit)
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn safe_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|v| SAFE_ID.is_match(v))
        .map(str::to_string)
}

fn error_text(error: &AgentError) -> String {
    redact_secret_text(&error.message)
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl Inner {
    fn emit(&self, event: Value) {
        (self.on_event)(event);
    }

    fn client(&self) -> Option<Rc<dyn PiClient>> {
        self.client.borrow().clone()
    }

    fn session(&self) -> Option<String> {
        self.session_id.borrow().clone()
    }

    fn assert_usable(&self) -> AgentResult<()> {
        if self.disposed.get() {
            return Err(AgentError::new(format!(
                "{} RPC adapter is closed.",
                self.runtime_label
            )));
        }
        Ok(())
    }

    fn assert_connected(&self) -> AgentResult<Rc<dyn PiClient>> {
        self.assert_usable()?;
        match self.client() {
            Some(client) if !client.closed() && self.session().is_some() => Ok(client),
            _ => Err(AgentError::new(format!(
                "{} RPC session is not connected.",
                self.runtime_label
            ))),
        }
    }

    fn active(&self) -> Option<ActiveState> {
        self.active_state.borrow().clone()
    }

    fn is_active(&self, state: &ActiveState) -> bool {
        self.active()
            .is_some_and(|active| Rc::ptr_eq(&active, state))
    }

    fn active_turn_id(&self) -> Option<String> {
        self.active()
            .and_then(|state| state.borrow().turn_id.clone())
    }

    fn remember_session_state(&self, state: &Value) -> AgentResult<()> {
        let Some(id) = state
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            return Err(AgentError::new(format!(
                "{} RPC did not return a native session id.",
                self.runtime_label
            )));
        };
        *self.session_state.borrow_mut() = Some(state.clone());
        *self.session_id.borrow_mut() = Some(id.to_string());
        Ok(())
    }

    fn respond_ui(&self, message: Value) {
        if let Some(client) = self.client() {
            let _ = client.respond_extension_ui(message);
        }
    }

    /// `#acceptTurn(state, model, effort)`.
    fn accept_turn(&self, state: &ActiveState, model: Value, effort: Value) {
        if self.disposed.get() || state.borrow().start_accepted || !self.is_active(state) {
            return;
        }
        let (turn_id, client_user_message_id) = {
            let mut state = state.borrow_mut();
            state.start_accepted = true;
            (state.turn_id.clone(), state.client_user_message_id.clone())
        };
        self.emit(json!({
            "type": "turn.started",
            "providerSessionId": self.session(),
            "turnId": turn_id,
            "payload": {
                "status": "running",
                "model": model,
                "effort": effort,
                "clientUserMessageId": client_user_message_id,
            },
        }));
    }

    /// `#handleRpcEvent(message)`.
    fn handle_rpc_event(&self, message: &Value) {
        let kind = message.get("type").and_then(Value::as_str);
        if kind == Some("extension_ui_request") {
            self.handle_extension_ui(message);
            return;
        }
        let active = self.active();
        if active.is_none() && is_turn_scoped_pi_event(kind) {
            return;
        }
        let state = active.unwrap_or_else(|| {
            Rc::new(RefCell::new(PiEventState::new(
                None,
                self.session().as_deref(),
                &self.runtime_namespace,
                &self.runtime_label,
            )))
        });
        // A single prompt owns this stream; a native agent_start confirms
        // acceptance even when its command receipt is delayed. Preflight UI
        // alone does not.
        if kind == Some("agent_start") && self.is_active(&state) {
            self.accept_turn(&state, Value::Null, Value::Null);
        }
        let normalized = normalize_pi_rpc_event(message, &mut state.borrow_mut());
        let terminal = normalized.iter().any(|event| {
            matches!(
                event["type"].as_str(),
                Some("turn.completed" | "turn.failed" | "turn.interrupted")
            )
        });
        for event in normalized {
            self.emit(event);
        }
        if terminal {
            drop(self.persistence_reporter.confirm());
            if self.is_active(&state) {
                *self.active_state.borrow_mut() = None;
            }
        }
    }

    /// `#handleExtensionUi(message)`.
    fn handle_extension_ui(&self, message: &Value) {
        if let Some(approval) = self
            .approval_request_parser
            .as_ref()
            .and_then(|parse| parse(message))
        {
            self.handle_approval_request(message, &approval);
            return;
        }
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        if !dialog_method(method) {
            self.handle_extension_notice(message);
            return;
        }
        let rpc_id = js::to_js_string(message.get("id"));
        let Some(turn_id) = self.active_turn_id() else {
            self.respond_ui(
                json!({ "type": "extension_ui_response", "id": rpc_id, "cancelled": true }),
            );
            return;
        };
        let request_id = format!("{}:question:{}", self.runtime_namespace, uuid());
        let item_id = format!(
            "{}:extension-ui:{}",
            self.runtime_namespace,
            safe_id(message.get("id")).unwrap_or_else(uuid)
        );
        let question = pi_question(message, &self.runtime_label);
        self.pending_questions.borrow_mut().push(PendingQuestion {
            request_id: request_id.clone(),
            rpc_id,
            method: method.to_string(),
            turn_id: turn_id.clone(),
            item_id: item_id.clone(),
        });
        self.emit(json!({
            "type": "question.requested",
            "providerSessionId": self.session(),
            "turnId": turn_id,
            "itemId": item_id,
            "payload": { "requestId": request_id, "questions": [question] },
        }));
    }

    fn handle_approval_request(&self, message: &Value, approval: &Value) {
        let rpc_id = js::to_js_string(message.get("id"));
        let Some(turn_id) = self.active_turn_id() else {
            self.respond_ui(
                json!({ "type": "extension_ui_response", "id": rpc_id, "cancelled": true }),
            );
            return;
        };
        let scope_key = approval
            .get("scopeKey")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(scope) = scope_key.as_ref()
            && self.session_approval_scopes.borrow().contains(scope)
        {
            self.respond_ui(
                json!({ "type": "extension_ui_response", "id": rpc_id, "confirmed": true }),
            );
            return;
        }
        let request_id = format!("{}:approval:{}", self.runtime_namespace, uuid());
        let item_id = safe_id(approval.get("itemId")).unwrap_or_else(|| {
            format!(
                "{}:extension-ui:{}",
                self.runtime_namespace,
                safe_id(message.get("id")).unwrap_or_else(uuid)
            )
        });
        let available_decisions: Vec<&'static str> =
            if approval.get("allowSession") == Some(&Value::Bool(false)) {
                vec!["accept", "decline", "cancel"]
            } else {
                vec!["accept", "acceptForSession", "decline", "cancel"]
            };
        self.pending_approvals.borrow_mut().push(PendingApproval {
            request_id: request_id.clone(),
            rpc_id,
            turn_id: turn_id.clone(),
            scope_key,
            available_decisions: available_decisions.clone(),
        });
        let text = |key: &str, limit: usize| non_empty(bounded(approval.get(key), limit));
        let kind = approval
            .get("kind")
            .and_then(Value::as_str)
            .filter(|kind| matches!(*kind, "command" | "file-change"))
            .unwrap_or("tool");
        let payload = json!({
            "requestId": request_id,
            "title": text("title", 300).unwrap_or_else(|| "Approval required".into()),
            "description": text("description", 2_000),
            "reason": text("reason", 2_000),
            "kind": kind,
            "toolName": text("toolName", 160),
            "command": text("command", 8_192),
            "arguments": approval.get("arguments").filter(|a| a.is_object()).cloned().unwrap_or_else(|| json!({})),
            "availableDecisions": available_decisions,
        });
        self.emit(json!({
            "type": "approval.requested",
            "providerSessionId": self.session(),
            "turnId": turn_id,
            "itemId": item_id,
            "payload": bound_renderer_value(&redact_secrets(&payload)),
        }));
    }

    fn handle_extension_notice(&self, message: &Value) {
        let method = message.get("method").and_then(Value::as_str);
        if method == Some("setTitle")
            && let Some(title) = message.get("title").and_then(Value::as_str)
        {
            self.emit(json!({
                "type": "session.updated",
                "providerSessionId": self.session(),
                "payload": { "title": text::head16(title, 200) },
            }));
            return;
        }
        if method == Some("notify") {
            let fallback = format!("{} extension notification", self.runtime_label);
            let raw = message
                .get("message")
                .filter(|m| js::truthy(m))
                .map(|m| js::to_js_string(Some(m)))
                .unwrap_or_else(|| fallback.clone());
            let text = text::head16(raw.trim(), 4_000).to_string();
            let text = if text.is_empty() { fallback } else { text };
            let severity = message
                .get("notifyType")
                .and_then(Value::as_str)
                .filter(|severity| matches!(*severity, "warning" | "error"))
                .unwrap_or("info");
            self.emit(json!({
                "type": "provider.notification",
                "providerSessionId": self.session(),
                "turnId": self.active_turn_id(),
                "itemId": format!("{}:extension:{}", self.runtime_namespace, safe_id(message.get("id")).unwrap_or_else(uuid)),
                "payload": {
                    "message": redact_secret_text(&text),
                    "source": format!("{} extension", self.runtime_label),
                    "severity": severity,
                },
            }));
        }
    }
}

fn dialog_method(value: &str) -> bool {
    matches!(value, "select" | "confirm" | "input" | "editor")
}

fn is_turn_scoped_pi_event(value: Option<&str>) -> bool {
    matches!(
        value,
        Some(
            "agent_start"
                | "agent_end"
                | "agent_settled"
                | "turn_start"
                | "turn_end"
                | "message_start"
                | "message_update"
                | "message_end"
                | "tool_execution_start"
                | "tool_execution_update"
                | "tool_execution_end"
                | "auto_retry_start"
                | "auto_retry_end"
        )
    )
}

fn pi_question(message: &Value, runtime_label: &str) -> Value {
    let title_or_message = message
        .get("title")
        .filter(|t| js::truthy(t))
        .or_else(|| message.get("message"));
    let question = non_empty(bounded(title_or_message, 4_000))
        .unwrap_or_else(|| format!("{runtime_label} needs additional input."));
    let header = || {
        non_empty(bounded(message.get("title"), 80))
            .unwrap_or_else(|| format!("{runtime_label} extension"))
    };
    match message.get("method").and_then(Value::as_str) {
        Some("select") => {
            let options: Vec<Value> = message
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .take(20)
                        .map(|option| json!({ "label": bounded(Some(option), 120), "description": "" }))
                        .filter(|option| option["label"].as_str().is_some_and(|l| !l.is_empty()))
                        .collect()
                })
                .unwrap_or_default();
            json!({
                "header": format!("{runtime_label} extension"),
                "question": question,
                "multiple": false,
                "custom": false,
                "options": options,
            })
        }
        Some("confirm") => json!({
            "header": header(),
            "question": non_empty(bounded(message.get("message"), 4_000)).unwrap_or(question),
            "multiple": false,
            "custom": false,
            "options": [{ "label": "Yes", "description": "" }, { "label": "No", "description": "" }],
        }),
        _ => json!({
            "header": header(),
            "question": question,
            "multiple": false,
            "custom": true,
            "options": [],
        }),
    }
}

fn humanize(value: &str) -> String {
    bounded_str(value, 160)
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn qualified_model(value: Option<&Value>) -> Option<String> {
    let value = value?;
    let provider = bounded(value.get("provider"), 160);
    let model = bounded(value.get("id"), 300);
    (!provider.is_empty() && !model.is_empty()).then(|| format!("{provider}/{model}"))
}

fn is_reasoning_level(value: &str) -> bool {
    matches!(
        value,
        "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
    )
}

fn reasoning_levels(model: &Value, current_levels: &[Value]) -> Vec<String> {
    let mut advertised: Vec<String> = Vec::new();
    for level in current_levels
        .iter()
        .filter_map(Value::as_str)
        .filter(|l| is_reasoning_level(l))
    {
        if !advertised.iter().any(|existing| existing == level) {
            advertised.push(level.to_string());
        }
    }
    if !advertised.is_empty() {
        return advertised;
    }
    let mut levels: Vec<String> = PI_REASONING_LEVELS.iter().map(|l| l.to_string()).collect();
    let map = model.get("thinkingLevelMap").and_then(Value::as_object);
    if map.is_some_and(|m| m.contains_key("xhigh")) {
        levels.push("xhigh".into());
    }
    if map.is_some_and(|m| m.contains_key("max")) {
        levels.push("max".into());
    }
    levels
}

/// `normalizePiModels(value, state, currentLevels, runtimeLabel)`.
pub fn normalize_pi_models(
    value: Option<&Value>,
    state: &Value,
    current_levels: &[Value],
    runtime_label: &str,
) -> Vec<Value> {
    let current = qualified_model(state.get("model"));
    value
        .and_then(Value::as_array)
        .map(|models| models.iter().take(100).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|model| {
            let provider_id = bounded(model.get("provider"), 160);
            let model_id = bounded(model.get("id"), 300);
            if provider_id.is_empty() || model_id.is_empty() {
                return None;
            }
            let qualified = format!("{provider_id}/{model_id}");
            let is_current = Some(&qualified) == current.as_ref();
            let variants = if model.get("reasoning") == Some(&Value::Bool(true)) {
                reasoning_levels(model, if is_current { current_levels } else { &[] })
            } else {
                Vec::new()
            };
            let current_effort = is_current.then(|| bounded(state.get("thinkingLevel"), 40));
            let default_variant = match current_effort {
                Some(effort) if variants.contains(&effort) => Some(effort),
                _ if variants.iter().any(|v| v == "medium") => Some("medium".to_string()),
                _ => variants.first().cloned(),
            };
            let context = js::to_number(model.get("contextWindow"));
            let description = if context > 0.0 {
                format!("{provider_id} · {}K context", (context / 1_000.0).round() as i64)
            } else {
                format!("{provider_id} · {runtime_label} model")
            };
            Some(json!({
                "id": qualified,
                "model": qualified,
                "modelId": model_id,
                "providerId": provider_id,
                "displayName": non_empty(bounded(model.get("name"), 300)).unwrap_or_else(|| model_id.clone()),
                "description": description,
                "isDefault": is_current,
                "variants": variants,
                "defaultVariant": default_variant,
            }))
        })
        .collect()
}

fn normalize_pi_providers(models: &[Value], source: &str) -> Vec<Value> {
    let mut groups: Vec<(String, Vec<&Value>)> = Vec::new();
    for model in models {
        let id = model["providerId"].as_str().unwrap_or("").to_string();
        match groups.iter_mut().find(|(group, _)| *group == id) {
            Some((_, entries)) => entries.push(model),
            None => groups.push((id, vec![model])),
        }
    }
    groups
        .into_iter()
        .map(|(id, entries)| {
            let default_model = entries
                .iter()
                .find(|model| model["isDefault"] == true)
                .or(entries.first())
                .map(|model| model["model"].clone())
                .unwrap_or(Value::Null);
            json!({
                "id": id,
                "displayName": humanize(&id),
                "source": source,
                "defaultModel": default_model,
                "modelCount": entries.len(),
            })
        })
        .collect()
}

fn normalize_pi_commands(value: Option<&Value>, source: &str) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .map(|commands| {
            commands
                .iter()
                .take(500)
                .map(|command| {
                    json!({
                        "name": bounded(command.get("name"), 160),
                        "description": bounded(command.get("description"), 1_000),
                        "source": non_empty(bounded(command.get("source"), 80)).unwrap_or_else(|| source.to_string()),
                    })
                })
                .filter(|command| command["name"].as_str().is_some_and(|n| !n.is_empty()))
                .collect()
        })
        .unwrap_or_default()
}

fn pi_account_state(
    models: &[Value],
    providers: &[Value],
    account_type: &str,
    setup_message: &str,
) -> Value {
    if models.is_empty() {
        return json!({
            "account": null,
            "requiresOpenaiAuth": false,
            "requiresRuntimeSetup": true,
            "setupReason": "runtime-setup-required",
            "error": setup_message,
        });
    }
    let plan = providers
        .iter()
        .filter_map(|provider| provider["displayName"].as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let plan = text::head16(&plan, 300).to_string();
    json!({
        "account": {
            "type": account_type,
            "email": null,
            "planType": if plan.is_empty() { Value::Null } else { Value::from(plan) },
        },
        "requiresOpenaiAuth": false,
        "requiresRuntimeSetup": false,
    })
}

fn pi_capabilities_for_runtime(
    version: Option<&Value>,
    capabilities: &Value,
    namespace: &str,
) -> Value {
    let agent_version = non_empty(bounded(version, 80));
    let revision = format!(
        "{}:{namespace}:{}",
        js::to_js_string(capabilities.get("revision")),
        agent_version.as_deref().unwrap_or("unknown")
    );
    Obj::from(capabilities)
        .set("revision", revision)
        .set(
            "protocol",
            js::with(
                capabilities.get("protocol").unwrap_or(&json!({})),
                "agentVersion",
                agent_version,
            ),
        )
        .build()
}

fn provider_session(state: &Value, runtime_label: &str) -> Value {
    json!({
        "providerSessionId": state["sessionId"],
        "title": non_empty(bounded(state.get("sessionName"), 200)).unwrap_or_else(|| format!("{runtime_label} session")),
        "model": qualified_model(state.get("model")),
        "effort": non_empty(bounded(state.get("thinkingLevel"), 40)),
        "updatedAt": clock::now_iso(),
    })
}

fn parse_model(value: &str, runtime_label: &str) -> AgentResult<(String, String)> {
    let input = bounded_str(value, 512);
    match input.find('/') {
        Some(separator) if separator > 0 && separator < input.len() - 1 => Ok((
            input[..separator].to_string(),
            input[separator + 1..].to_string(),
        )),
        _ => Err(AgentError::new(format!(
            "{runtime_label} model selection is invalid."
        ))),
    }
}

/// `PiRpcRuntimeAdapter`.
#[derive(Clone)]
pub struct PiRpcRuntimeAdapter(Rc<Inner>);

impl PiRpcRuntimeAdapter {
    pub fn new(options: PiAdapterOptions) -> AgentResult<Self> {
        if !js::truthy_opt(options.runtime_descriptor.get("id")) {
            return Err(
                AgentError::new("A Pi RPC runtime descriptor is required.").with_name("TypeError")
            );
        }
        if options.source_scope_id.is_empty() {
            return Err(
                AgentError::new("A Pi RPC history source is required.").with_name("TypeError")
            );
        }
        let descriptor_text = |key: &str| {
            options
                .runtime_descriptor
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let runtime_label = non_empty(bounded_str(
            &options
                .runtime_label
                .clone()
                .or_else(|| descriptor_text("displayName"))
                .unwrap_or_else(|| "Pi".into()),
            80,
        ))
        .unwrap_or_else(|| "Pi".into());
        let namespace_input = options
            .runtime_namespace
            .clone()
            .or_else(|| descriptor_text("id"))
            .unwrap_or_else(|| "pi".into());
        let runtime_namespace = if NAMESPACE.is_match(&namespace_input) {
            namespace_input
        } else {
            "pi".into()
        };
        let provider_source = non_empty(bounded_str(
            &options
                .provider_source
                .clone()
                .or_else(|| descriptor_text("id"))
                .unwrap_or_else(|| "pi".into()),
            80,
        ))
        .unwrap_or_else(|| runtime_namespace.clone());
        let account_type = non_empty(bounded_str(
            &options
                .account_type
                .clone()
                .or_else(|| descriptor_text("id"))
                .unwrap_or_else(|| "pi".into()),
            80,
        ))
        .unwrap_or_else(|| runtime_namespace.clone());
        let setup_message = bounded_str(
            &options.runtime_setup_message.clone().unwrap_or_else(|| {
                format!("{runtime_label} has no authenticated model providers. Configure one, then refresh.")
            }),
            2_000,
        );
        let report = options
            .on_session_persisted
            .clone()
            .unwrap_or_else(|| Rc::new(|_| {}));
        Ok(Self(Rc::new_cyclic(|weak: &Weak<Inner>| {
            let verifier = weak.clone();
            let closed = weak.clone();
            let reporter = NativePersistenceReporter::new(
                Rc::new(move || {
                    let weak = verifier.clone();
                    Box::pin(async move {
                        let Some(inner) = weak.upgrade() else {
                            return Ok(None);
                        };
                        let (Some(id), Some(client)) = (inner.session(), inner.client()) else {
                            return Ok(None);
                        };
                        let state = client
                            .request("get_state", json!({}), RequestOptions::default())
                            .await?;
                        let file = state.get("sessionFile").and_then(Value::as_str);
                        let Some(file) = file.filter(|_| state["sessionId"] == id.as_str()) else {
                            return Ok(None);
                        };
                        if !crate::platform::paths::is_absolute(file) {
                            return Ok(None);
                        }
                        // Stat only the exact artifact returned by the native
                        // RPC, never scan or parse its store.
                        let artifact = std::fs::metadata(file)?;
                        let current = inner.session().as_deref() == Some(id.as_str());
                        Ok((artifact.is_file() && artifact.len() > 0 && current)
                            .then(|| json!({ "providerSessionId": id, "sourceScopeId": inner.source_scope_id })))
                    })
                }),
                report,
                Rc::new(move || closed.upgrade().is_none_or(|inner| inner.disposed.get())),
            );
            Inner {
                readiness: options.readiness.clone(),
                workspace_root: options.workspace_root.clone(),
                on_event: options.on_event.clone(),
                on_exit: options.on_exit.clone(),
                persistence_reporter: reporter,
                spawner: options.spawner.clone(),
                client_factory: options
                    .client_factory
                    .clone()
                    .unwrap_or_else(pi_rpc_client_factory),
                on_dispose: options.on_dispose.clone(),
                runtime_descriptor: options.runtime_descriptor.clone(),
                source_scope_id: options.source_scope_id.clone(),
                runtime_label,
                runtime_namespace,
                provider_source,
                account_type,
                capabilities: options
                    .capabilities
                    .clone()
                    .unwrap_or_else(|| PI_CAPABILITIES.clone()),
                runtime_setup_message: setup_message,
                project_instruction_loader: options.project_instruction_loader.clone(),
                project_instruction_formatter: options
                    .project_instruction_formatter
                    .clone()
                    .unwrap_or_else(|| {
                        Rc::new(|value: &Value| {
                            value
                                .get("text")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                    }),
                approval_request_parser: options.approval_request_parser.clone(),
                sensitive_values: options.sensitive_values.clone(),
                clients: RefCell::default(),
                client: RefCell::default(),
                session_id: RefCell::default(),
                session_state: RefCell::default(),
                active_state: RefCell::default(),
                pending_approvals: RefCell::default(),
                pending_questions: RefCell::default(),
                session_approval_scopes: RefCell::default(),
                disposed: Cell::new(false),
                dispose_notified: Cell::new(false),
                last_protocol_error: RefCell::default(),
            }
        })))
    }

    /// `adapter.sessionId`.
    pub fn session_id(&self) -> Option<String> {
        self.0.session()
    }

    /// `adapter.hasActiveProcess()`.
    pub fn has_active_process(&self) -> bool {
        !self.0.clients.borrow().is_empty()
    }

    /// `adapter.forceTerminate(reason)`.
    pub fn force_terminate(&self, reason: Option<&str>) {
        let reason = reason
            .map(str::to_string)
            .unwrap_or_else(|| format!("{} RPC runtime stopped.", self.0.runtime_label));
        let clients = self.0.clients.borrow().clone();
        for client in clients {
            client.dispose(&reason, false);
        }
    }

    /// `adapter.referenceMentionDelivery(reference)`.
    pub fn mention_delivery(reference: &Value) -> &'static str {
        if reference
            .get("mime")
            .and_then(Value::as_str)
            .is_some_and(|mime| PI_NATIVE_IMAGE_MIME_TYPES.contains(&mime))
        {
            "resource"
        } else {
            "path"
        }
    }

    fn create_client(&self, args: Vec<String>) -> AgentResult<Rc<dyn PiClient>> {
        let inner = &self.0;
        let Some(executable_path) = inner
            .readiness
            .get("executablePath")
            .and_then(Value::as_str)
            .filter(|p| !p.is_empty())
        else {
            return Err(AgentError::new(format!(
                "{} executable is unavailable.",
                inner.runtime_label
            )));
        };
        let env = inner
            .readiness
            .get("environment")
            .and_then(Value::as_object)
            .map(|map| {
                map.iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect()
            });
        let client = (inner.client_factory)(PiClientOptions {
            executable_path: executable_path.to_string(),
            args_prefix: inner.readiness["argsPrefix"]
                .as_array()
                .map(|args| {
                    args.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            args,
            cwd: inner.workspace_root.clone(),
            env,
            spawner: inner.spawner.clone(),
            sensitive_values: inner.sensitive_values.clone(),
            ..Default::default()
        })?;
        inner.clients.borrow_mut().push(client.clone());
        Ok(client)
    }

    async fn release_client(
        &self,
        client: &Rc<dyn PiClient>,
        reason: &str,
        expected: bool,
    ) -> AgentResult<()> {
        client.dispose(reason, expected);
        client.wait_for_exit().await?;
        self.0
            .clients
            .borrow_mut()
            .retain(|entry| !Rc::ptr_eq(entry, client));
        Ok(())
    }

    /// `adapter.inspect()`.
    pub async fn inspect_now(&self) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_usable()?;
        let client = self.create_client(vec!["--no-session".into()])?;
        {
            let target = Rc::downgrade(&client);
            client.on(Rc::new(move |event| {
                let PiClientEvent::Event(message) = event else {
                    return;
                };
                // Inspection never answers a dialog.
                if message.get("type").and_then(Value::as_str) == Some("extension_ui_request")
                    && dialog_method(message.get("method").and_then(Value::as_str).unwrap_or(""))
                    && let Some(client) = target.upgrade()
                {
                    let _ = client.respond_extension_ui(json!({
                        "type": "extension_ui_response",
                        "id": js::to_js_string(message.get("id")),
                        "cancelled": true,
                    }));
                }
            }));
        }
        let request = |kind: &str| client.request(kind, json!({}), RequestOptions::default());
        let (state, models, commands, thinking) = futures_util::join!(
            request("get_state"),
            request("get_available_models"),
            request("get_commands"),
            request("get_available_thinking_levels"),
        );
        let result = (|| {
            let state = state?;
            let models = models?;
            let mut warnings: Vec<String> = Vec::new();
            if let Err(error) = &commands {
                warnings.push(error_text(error));
            }
            if let Err(error) = &thinking {
                warnings.push(error_text(error));
            }
            let levels: Vec<Value> = thinking
                .as_ref()
                .ok()
                .and_then(|value| value.get("levels"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let models = normalize_pi_models(models.get("models"), &state, &levels, &inner.runtime_label);
            let providers = normalize_pi_providers(&models, &inner.provider_source);
            let readiness = &inner.readiness;
            Ok(json!({
                "account": pi_account_state(&models, &providers, &inner.account_type, &inner.runtime_setup_message),
                "providers": providers,
                "models": models,
                "modes": [],
                "commands": normalize_pi_commands(
                    commands.as_ref().ok().and_then(|value| value.get("commands")),
                    &inner.provider_source,
                ),
                "capabilities": pi_capabilities_for_runtime(readiness.get("version"), &inner.capabilities, &inner.runtime_namespace),
                "runtime": Obj::from(&inner.runtime_descriptor)
                    .set("version", readiness.get("version").cloned().unwrap_or(Value::Null))
                    .set("source", readiness.get("source").filter(|s| !s.is_null()).cloned().unwrap_or_else(|| Value::from("user-installed")))
                    .set("compatibility", readiness.get("compatibility").filter(|s| !s.is_null()).cloned().unwrap_or_else(|| Value::from("pi-rpc-v1")))
                    .build(),
                "warnings": warnings.into_iter().filter(|w| !w.is_empty()).collect::<Vec<_>>(),
            }))
        })()
        .map_err(|error: AgentError| {
            let first = non_empty(error_text(&error))
                .unwrap_or_else(|| format!("{} RPC inspection failed.", inner.runtime_label));
            let message = [first, client.diagnostics()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            AgentError::new(redact_secret_text(&message))
        });
        self.release_client(
            &client,
            &format!("{} RPC inspection complete.", inner.runtime_label),
            true,
        )
        .await?;
        result
    }

    async fn connect(&self, extra_args: Vec<String>) -> AgentResult<()> {
        let inner = &self.0;
        inner.assert_usable()?;
        if inner.client().is_some() {
            return Ok(());
        }
        let client = self.create_client(extra_args)?;
        *inner.client.borrow_mut() = Some(client.clone());
        let weak = Rc::downgrade(inner);
        client.on(Rc::new(move |event| {
            let Some(inner) = weak.upgrade() else { return };
            match event {
                PiClientEvent::Event(message) => inner.handle_rpc_event(&message),
                PiClientEvent::ProtocolError(error) => {
                    *inner.last_protocol_error.borrow_mut() = Some(error_text(&error));
                }
                PiClientEvent::Exit(info) => (inner.on_exit)(info),
            }
        }));
        match client
            .request("get_state", json!({}), RequestOptions::default())
            .await
        {
            Ok(state) => inner.remember_session_state(&state),
            Err(error) => {
                let diagnostic = client.diagnostics();
                *inner.client.borrow_mut() = None;
                self.release_client(
                    &client,
                    &format!("{} RPC startup failed.", inner.runtime_label),
                    false,
                )
                .await?;
                let message = [error_text(&error), diagnostic]
                    .into_iter()
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                Err(AgentError::new(redact_secret_text(&message)))
            }
        }
    }

    async fn apply_selection(&self, model: Option<&str>, effort: Option<&str>) -> AgentResult<()> {
        let inner = &self.0;
        let client = inner.client().ok_or_else(|| {
            AgentError::new(format!(
                "{} RPC session is not connected.",
                inner.runtime_label
            ))
        })?;
        let state = inner
            .session_state
            .borrow()
            .clone()
            .unwrap_or_else(|| json!({}));
        if let Some(model) = model.filter(|m| !m.is_empty()) {
            let (provider, model_id) = parse_model(model, &inner.runtime_label)?;
            if qualified_model(state.get("model")).as_deref() != Some(model) {
                client
                    .request(
                        "set_model",
                        json!({ "provider": provider, "modelId": model_id }),
                        RequestOptions::default(),
                    )
                    .await?;
            }
        }
        if let Some(effort) = effort.filter(|e| !e.is_empty())
            && state.get("thinkingLevel").and_then(Value::as_str) != Some(effort)
        {
            client
                .request(
                    "set_thinking_level",
                    json!({ "level": effort }),
                    RequestOptions::default(),
                )
                .await?;
        }
        let state = client
            .request("get_state", json!({}), RequestOptions::default())
            .await?;
        inner.remember_session_state(&state)
    }

    async fn create_session_inner(&self, selection: Value) -> AgentResult<Value> {
        self.connect(Vec::new()).await?;
        self.apply_selection(selection["model"].as_str(), selection["effort"].as_str())
            .await?;
        let client = self
            .0
            .client()
            .ok_or_else(|| AgentError::new("Pi RPC is not connected."))?;
        let state = client
            .request("get_state", json!({}), RequestOptions::default())
            .await?;
        self.0.remember_session_state(&state)?;
        Ok(provider_session(&state, &self.0.runtime_label))
    }

    async fn resume_session_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let label = inner.runtime_label.clone();
        let Some(thread_id) = request
            .get("threadId")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
        else {
            return Err(agent_provider_session_unavailable_error(Some(&format!(
                "{label} session id is unavailable."
            ))));
        };
        let unavailable = || {
            agent_provider_session_unavailable_error(Some(&format!(
                "The saved {label} session is no longer available."
            )))
        };
        let result = async {
            self.connect(vec!["--session".into(), thread_id.into()])
                .await?;
            let client = inner
                .client()
                .ok_or_else(|| AgentError::new("Pi RPC is not connected."))?;
            let state = client
                .request("get_state", json!({}), RequestOptions::default())
                .await?;
            if state.get("sessionId").and_then(Value::as_str) != Some(thread_id) {
                return Err(agent_provider_session_unavailable_error(Some(&format!(
                    "{label} did not resume the requested native session."
                ))));
            }
            inner.remember_session_state(&state)?;
            self.apply_selection(request["model"].as_str(), request["effort"].as_str())
                .await?;
            let state = inner.session_state.borrow().clone().unwrap_or_default();
            Ok(provider_session(&state, &label))
        }
        .await;
        result.map_err(|error| {
            if error.is("AGENT_PROVIDER_SESSION_UNAVAILABLE")
                || SESSION_UNAVAILABLE.is_match(&error_text(&error))
            {
                unavailable()
            } else {
                error
            }
        })
    }

    /// `adapter.readHistoryResult()`.
    pub async fn read_history_result(&self) -> AgentResult<Value> {
        let inner = &self.0;
        let client = inner.assert_connected()?;
        let result = client
            .request("get_messages", json!({}), RequestOptions::default())
            .await?;
        let Some(messages) = result.get("messages").and_then(Value::as_array) else {
            return Err(AgentError::new(format!(
                "{} returned an invalid history snapshot.",
                inner.runtime_label
            ))
            .with_name("TypeError"));
        };
        let session = inner.session();
        agent_history_read_result(&json!({
            "providerSessionId": session,
            "events": normalize_pi_history(messages, session.as_deref(), Some(&inner.runtime_namespace), Some(&inner.runtime_label)),
            "coverage": "complete",
        }))
    }

    /// `adapter.readHistory()`.
    pub async fn read_history(&self) -> AgentResult<Vec<Value>> {
        Ok(self.read_history_result().await?["events"]
            .as_array()
            .cloned()
            .unwrap_or_default())
    }

    async fn start_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let client = inner.assert_connected()?;
        if inner.active().is_some() {
            return Err(AgentError::new(format!(
                "A {} turn is already running.",
                inner.runtime_label
            )));
        }
        let model = request
            .get("model")
            .filter(|m| !m.is_null())
            .cloned()
            .unwrap_or(Value::Null);
        let effort = request
            .get("effort")
            .filter(|e| !e.is_null())
            .cloned()
            .unwrap_or(Value::Null);
        if let Err(error) = self.apply_selection(model.as_str(), effort.as_str()).await {
            // A preflight request may be uncertain, but this prompt was never sent.
            return Err(AgentError::new(error_text(&error)));
        }
        let list = |key: &str| {
            request
                .get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        let all_references = list("references");
        let references = if all_references.is_empty() {
            [list("contextReferences"), list("attachments")].concat()
        } else {
            all_references
        };
        let instructions = match inner.project_instruction_loader.as_ref() {
            Some(loader) => loader(&inner.workspace_root)?,
            None => None,
        };
        let instruction_text = instructions
            .as_ref()
            .and_then(|instructions| (inner.project_instruction_formatter)(instructions))
            .filter(|text| !text.is_empty());
        let prompt = js::str_or_empty(request.get("prompt"));
        let effective_prompt = match instruction_text {
            Some(text) => format!("{text}\n\n{prompt}"),
            None => prompt.to_string(),
        };
        let input = build_pi_turn_input(
            &effective_prompt,
            &references,
            Some(&inner.workspace_root),
            Some(&inner.runtime_label),
        )?;
        let turn_id = uuid();
        let mut event_state = PiEventState::new(
            Some(&turn_id),
            inner.session().as_deref(),
            &inner.runtime_namespace,
            &inner.runtime_label,
        );
        event_state.client_user_message_id = Some(match request.get("clientUserMessageId") {
            None => uuid(),
            Some(id) => js::to_js_string(Some(id)),
        });
        let state: ActiveState = Rc::new(RefCell::new(event_state));
        *inner.active_state.borrow_mut() = Some(state.clone());
        let late = {
            let weak = Rc::downgrade(inner);
            let (state, model, effort) = (state.clone(), model.clone(), effort.clone());
            Rc::new(move |result: AgentResult<Value>| {
                if result.is_ok()
                    && let Some(inner) = weak.upgrade()
                {
                    inner.accept_turn(&state, model.clone(), effort.clone());
                }
            })
        };
        let payload = Obj::new()
            .set("message", input.message.as_str())
            .opt(
                "images",
                (!input.images.is_empty()).then(|| input.images.clone()),
            )
            .build();
        match client
            .request(
                "prompt",
                payload,
                RequestOptions {
                    on_late_response: Some(late),
                    ..Default::default()
                },
            )
            .await
        {
            Ok(_) => {
                inner.accept_turn(&state, model, effort);
                Ok(json!({ "turnId": turn_id }))
            }
            Err(error) if error.delivery_outcome.as_deref() == Some("unknown") => {
                if state.borrow().start_accepted {
                    Ok(json!({ "turnId": turn_id }))
                } else {
                    Err(error)
                }
            }
            Err(error) => {
                if inner.is_active(&state) {
                    *inner.active_state.borrow_mut() = None;
                }
                inner.emit(json!({
                    "type": "turn.failed",
                    "providerSessionId": inner.session(),
                    "turnId": turn_id,
                    "payload": { "status": "failed", "message": error_text(&error) },
                }));
                Err(error)
            }
        }
    }

    fn require_active_turn(&self, turn_id: Option<&str>) -> AgentResult<ActiveState> {
        let inner = &self.0;
        inner
            .active()
            .filter(|state| state.borrow().turn_id.as_deref() == turn_id)
            .ok_or_else(|| {
                AgentError::new(format!(
                    "That {} turn is no longer running.",
                    inner.runtime_label
                ))
            })
    }

    async fn steer_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let client = inner.assert_connected()?;
        self.require_active_turn(request.get("turnId").and_then(Value::as_str))?;
        let references = request
            .get("references")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let input = build_pi_turn_input(
            js::str_or_empty(request.get("message")),
            &references,
            Some(&inner.workspace_root),
            Some(&inner.runtime_label),
        )?;
        client
            .request(
                "steer",
                Obj::new()
                    .set("message", input.message.as_str())
                    .opt("images", (!input.images.is_empty()).then_some(input.images))
                    .build(),
                RequestOptions::default(),
            )
            .await?;
        Ok(Value::Null)
    }

    async fn interrupt_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let client = self.0.assert_connected()?;
        let state = self.require_active_turn(request.get("turnId").and_then(Value::as_str))?;
        state.borrow_mut().interrupt_requested = true;
        client
            .request("abort", json!({}), RequestOptions::default())
            .await?;
        Ok(Value::Null)
    }

    async fn compact_session_inner(&self) -> AgentResult<Value> {
        let inner = &self.0;
        let client = inner.assert_connected()?;
        if inner.active().is_some() {
            return Err(AgentError::new(format!(
                "Stop the active {} turn before compacting the session.",
                inner.runtime_label
            )));
        }
        client
            .request(
                "compact",
                json!({}),
                RequestOptions {
                    timeout_ms: Some(120_000),
                    ..Default::default()
                },
            )
            .await?;
        Ok(Value::Null)
    }

    /// `adapter.resolveQuestion({ requestId, answers, rejected })`.
    pub fn resolve_question_now(&self, request: &Value) -> AgentResult<()> {
        let inner = &self.0;
        let request_id = js::str_or_empty(request.get("requestId"));
        let index = inner
            .pending_questions
            .borrow()
            .iter()
            .position(|p| p.request_id == request_id);
        let Some(index) = index else {
            return Err(AgentError::new(format!(
                "This {} extension question is stale or already resolved.",
                inner.runtime_label
            )));
        };
        let pending = inner.pending_questions.borrow_mut().remove(index);
        let first = request
            .get("answers")
            .and_then(|a| a.get(0))
            .and_then(Value::as_array)
            .and_then(|answers| answers.first())
            .filter(|answer| js::truthy(answer))
            .map(|answer| js::to_js_string(Some(answer)));
        let rejected = js::truthy_opt(request.get("rejected"));
        let client = inner
            .client()
            .ok_or_else(|| AgentError::new("Pi RPC is not connected."))?;
        let response = match first {
            Some(first) if !rejected => {
                if pending.method == "confirm" {
                    json!({ "type": "extension_ui_response", "id": pending.rpc_id, "confirmed": CONFIRMED.is_match(&first) })
                } else {
                    json!({ "type": "extension_ui_response", "id": pending.rpc_id, "value": first })
                }
            }
            _ => {
                json!({ "type": "extension_ui_response", "id": pending.rpc_id, "cancelled": true })
            }
        };
        client.respond_extension_ui(response)?;
        inner.emit(json!({
            "type": "question.resolved",
            "providerSessionId": inner.session(),
            "turnId": pending.turn_id,
            "itemId": pending.item_id,
            "payload": { "requestId": request_id, "resolution": if rejected { "rejected" } else { "answered" } },
        }));
        Ok(())
    }

    /// `adapter.resolveApproval({ requestId, decision, turnId })`.
    pub fn resolve_approval_now(&self, request: &Value) -> AgentResult<()> {
        let inner = &self.0;
        let request_id = js::str_or_empty(request.get("requestId"));
        let turn_id = request.get("turnId").and_then(Value::as_str);
        let index = inner
            .pending_approvals
            .borrow()
            .iter()
            .position(|p| p.request_id == request_id && Some(p.turn_id.as_str()) == turn_id);
        let Some(index) = index.filter(|_| inner.active_turn_id().as_deref() == turn_id) else {
            return Err(AgentError::new(format!(
                "Approval correlation did not match the active {} turn.",
                inner.runtime_label
            )));
        };
        let decision = js::str_or_empty(request.get("decision"));
        if !inner.pending_approvals.borrow()[index]
            .available_decisions
            .contains(&decision)
        {
            return Err(AgentError::new(format!(
                "{} did not offer that approval decision.",
                inner.runtime_label
            )));
        }
        let pending = inner.pending_approvals.borrow_mut().remove(index);
        let accepted = matches!(decision, "accept" | "acceptForSession");
        if decision == "acceptForSession"
            && let Some(scope) = pending.scope_key
        {
            inner.session_approval_scopes.borrow_mut().insert(scope);
        }
        let client = inner
            .client()
            .ok_or_else(|| AgentError::new("Pi RPC is not connected."))?;
        client.respond_extension_ui(json!({
            "type": "extension_ui_response",
            "id": pending.rpc_id,
            "confirmed": accepted,
        }))
    }

    /// `adapter.dispose(reason)`.
    pub async fn dispose_with(&self, reason: Option<&str>) -> AgentResult<()> {
        let inner = &self.0;
        let reason = reason
            .map(str::to_string)
            .unwrap_or_else(|| format!("{} RPC adapter closed.", inner.runtime_label));
        inner.disposed.set(true);
        let pending: Vec<String> = inner
            .pending_approvals
            .borrow()
            .iter()
            .map(|p| p.rpc_id.clone())
            .chain(
                inner
                    .pending_questions
                    .borrow()
                    .iter()
                    .map(|p| p.rpc_id.clone()),
            )
            .collect();
        for rpc_id in pending {
            // A closing Pi RPC process cannot remain blocked on extension UI.
            inner.respond_ui(
                json!({ "type": "extension_ui_response", "id": rpc_id, "cancelled": true }),
            );
        }
        inner.pending_approvals.borrow_mut().clear();
        inner.pending_questions.borrow_mut().clear();
        inner.session_approval_scopes.borrow_mut().clear();
        *inner.client.borrow_mut() = None;
        *inner.active_state.borrow_mut() = None;
        let clients = inner.clients.borrow().clone();
        let results = futures_util::future::join_all(
            clients
                .iter()
                .map(|client| self.release_client(client, &reason, true)),
        )
        .await;
        if results.iter().any(Result::is_err) {
            return Err(AgentError::new(format!(
                "{} processes have not all exited.",
                inner.runtime_label
            )));
        }
        if !inner.dispose_notified.replace(true)
            && let Some(on_dispose) = inner.on_dispose.as_ref()
        {
            on_dispose();
        }
        Ok(())
    }
}

impl AgentRuntimeAdapter for PiRpcRuntimeAdapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        Box::pin(self.inspect_now())
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
        Box::pin(self.dispose_with(None))
    }
    fn implements(&self, name: &str) -> bool {
        matches!(
            name,
            "steerTurn"
                | "resolveApproval"
                | "resolveQuestion"
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
    fn compact_session(&self) -> AdapterFuture<'_, Value> {
        Box::pin(self.compact_session_inner())
    }
    fn reference_mention_delivery(&self, reference: &Value) -> Option<&'static str> {
        Some(Self::mention_delivery(reference))
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(PiHistoryPort(self.clone())))
    }
}

/// `adapter.getSessionHistoryPort()`: hydration only.
struct PiHistoryPort(PiRpcRuntimeAdapter);

impl SessionHistoryPort for PiHistoryPort {
    fn source_scope_id(&self) -> Option<String> {
        Some(self.0.0.source_scope_id.clone())
    }
    fn implements(&self, method: &str) -> bool {
        method == "hydrate"
    }
    fn hydrate(&self, _signal: CancelSignal) -> AdapterFuture<'_, Value> {
        Box::pin(self.0.read_history_result())
    }
}

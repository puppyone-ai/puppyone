//! `protocols/acp/acp-runtime-adapter.mjs`: a provider-neutral,
//! workspace-bound adapter for a local ACP Agent harness.
use super::acp_client::{AcpClient, AcpDelegate};
use super::acp_event_normalizer::{AcpEventNormalizer, normalize_acp_prompt_usage};
use super::acp_history_discovery::discover_acp_history;
use super::acp_history_replay::AcpHistoryReplay;
use super::acp_interactions::{
    PendingApproval, PendingQuestion, acp_handle_extension_request, acp_request_permission,
    acp_resolve_approval, acp_resolve_pending, acp_resolve_question,
};
use super::acp_limits::ACP_INLINE_IMAGE_MAX_BYTES;
use super::acp_native_values::{
    SessionConfig, array, event, is_unavailable_acp_session_error, public_models, public_modes,
    public_providers, record, text,
};
use super::acp_prompt_input::{
    ACP_NATIVE_IMAGE_MIME_TYPES, AcpReferenceProfile, build_acp_prompt_blocks,
    materialize_acp_references,
};
use super::acp_session_config::{
    resolve_acp_efforts, resolve_acp_models, resolve_acp_modes, resolve_requested_acp_effort,
    resolve_requested_acp_mode,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::native_session_id::native_session_id;
use crate::agent::runtime::agent_history_read_result::agent_history_read_result;
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AgentRuntimeAdapter, agent_provider_session_unavailable_error,
};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::runtime::native_persistence_reporter::NativePersistenceReporter;
use crate::agent::security::acp_workspace_files::AcpWorkspaceFileSystem;
use crate::agent::security::authorized_project_instructions::{
    format_authorized_project_instructions, load_authorized_project_instructions,
};
use crate::agent::tasks::CancelSignal;
use crate::agent::transports::jsonl_rpc_connection::{ConnectionEvent, ConnectionOptions};
use crate::agent::transports::rpc_connection::{
    ConnectionFactory, RpcConnection, jsonl_rpc_connection_factory,
};
use crate::clock;
use crate::platform::paths;
use futures_util::future::LocalBoxFuture;
use serde_json::{Map, Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::sync::LazyLock;
use std::time::Duration;
use tokio::task::spawn_local;

const METADATA_SETTLE_MS: u64 = 75;

const ACP_EMBEDDED_TEXT_MIME_TYPES: &[&str] = &[
    "text/*",
    "application/json",
    "application/javascript",
    "application/xml",
    "application/yaml",
    "application/toml",
    "image/svg+xml",
];
const ACP_EMBEDDED_TEXT_EXTENSIONS: &[&str] = &[
    ".bash", ".c", ".cc", ".cfg", ".conf", ".cpp", ".cs", ".css", ".csv", ".env", ".gql", ".go",
    ".graphql", ".h", ".hpp", ".htm", ".html", ".ini", ".java", ".js", ".json", ".jsonl", ".jsx",
    ".kt", ".md", ".mdx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".sh", ".sql", ".svg", ".swift",
    ".toml", ".ts", ".tsv", ".tsx", ".txt", ".xml", ".yaml", ".yml", ".zsh",
];

/// `BASE_ACP_CAPABILITIES`.
pub static BASE_ACP_CAPABILITIES: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "streamingText": true,
        "structuredToolEvents": true,
        "commandOutputStreaming": true,
        "fileChangeEvents": true,
        "manualApprovals": true,
        "structuredQuestions": false,
        "resume": true,
        "fork": false,
        "steer": false,
        "queue": false,
        "attachments": false,
        "contextReferences": true,
        "modelSelection": true,
        "modeSelection": true,
        "slashCommands": true,
        "sessionHistory": false,
        "history": { "discovery": "unsupported", "exactOpen": "unsupported", "hydration": "unsupported" },
        "recovery": { "strategy": "unsupported", "activeExecution": "outcome-unknown", "atomicHandoff": false },
        "usage": true,
        "accountState": true,
        "mcp": true,
        "skills": true,
        "compaction": false,
        "referenceInputs": {
            "schemaVersion": 1,
            "workspace": { "files": true, "directories": true, "crossRoots": true },
            "attachments": {
                "image": {
                    "accepted": false,
                    "mimeTypes": ACP_NATIVE_IMAGE_MIME_TYPES,
                    "maxBytes": ACP_INLINE_IMAGE_MAX_BYTES,
                },
                // ACP requires every Agent to accept resource links. Embedded
                // text is an optional optimization negotiated separately at
                // runtime.
                "text": {
                    "accepted": true,
                    "mimeTypes": ACP_EMBEDDED_TEXT_MIME_TYPES,
                    "extensions": ACP_EMBEDDED_TEXT_EXTENSIONS,
                },
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

/// A runtime-specific completion classifier (`completionInspectorFactory`).
pub trait CompletionInspector {
    /// `inspector.observe(notification)`.
    fn observe(&self, notification: &Value) -> AgentResult<()>;
    /// `inspector.complete({ response })`: payload fields for `turn.completed`.
    fn complete(&self, response: &Value) -> AgentResult<Option<Value>>;
}

/// `completionInspectorFactory({ turnId, runtimeVersion })`.
pub type CompletionInspectorFactory =
    Rc<dyn Fn(&str, Option<String>) -> Option<Rc<dyn CompletionInspector>>>;

/// `processArgs({ mode, workspaceRoot, managed })`.
pub type ProcessArgs = Rc<dyn Fn(&str, &str, bool) -> Vec<String>>;

/// `environmentOverlay({ environment, mode, workspaceRoot, managed })`.
pub type EnvironmentOverlay = Rc<dyn Fn(&Map<String, Value>, &str, &str, bool) -> Value>;

/// `isAlreadyAuthenticated({ client, authenticationMethodId })`.
pub type AlreadyAuthenticated =
    Rc<dyn Fn(AcpClient, String) -> LocalBoxFuture<'static, AgentResult<bool>>>;

/// `logger.warn(message)`.
pub type Logger = Rc<dyn Fn(&str)>;

/// `authenticationMethodSelector(authMethods)`.
pub type AuthenticationMethodSelector = Rc<dyn Fn(&[Value]) -> Option<String>>;

/// `projectInstructionLoader(workspaceRoot)`.
pub type ProjectInstructionLoader = Rc<dyn Fn(&str) -> AgentResult<Option<Value>>>;

/// `new AcpRuntimeAdapter({ … })`.
#[derive(Clone)]
pub struct AcpAdapterOptions {
    pub readiness: Value,
    pub source_scope_id: Option<String>,
    pub workspace_root: String,
    pub runtime_descriptor: Value,
    pub managed: bool,
    pub app_version: String,
    pub on_event: Rc<dyn Fn(Value)>,
    pub on_exit: Rc<dyn Fn(Value)>,
    pub on_session_persisted: Option<Rc<dyn Fn(Value)>>,
    /// `logger.warn(message)`.
    pub logger: Option<Logger>,
    pub connection_factory: Option<ConnectionFactory>,
    pub project_instruction_loader: Option<ProjectInstructionLoader>,
    pub process_args: Option<ProcessArgs>,
    pub environment_overlay: Option<EnvironmentOverlay>,
    pub account_type: Option<String>,
    pub created_title: Option<String>,
    pub resumed_title: Option<String>,
    pub authentication_method_id: Option<String>,
    pub authentication_method_selector: Option<AuthenticationMethodSelector>,
    pub is_already_authenticated: Option<AlreadyAuthenticated>,
    pub capability_overrides: Value,
    /// `referenceInputProfile.embeddedText`.
    pub embedded_text: bool,
    pub question_methods: Vec<String>,
    pub completion_inspector_factory: Option<CompletionInspectorFactory>,
    pub event_source: Option<String>,
    pub on_dispose: Option<Rc<dyn Fn()>>,
}

impl AcpAdapterOptions {
    /// The required options; the rest take the product defaults.
    pub fn new(readiness: Value, workspace_root: &str, runtime_descriptor: Value) -> Self {
        Self {
            readiness,
            source_scope_id: None,
            workspace_root: workspace_root.into(),
            runtime_descriptor,
            managed: false,
            app_version: "0.0.0".into(),
            on_event: Rc::new(|_| {}),
            on_exit: Rc::new(|_| {}),
            on_session_persisted: None,
            logger: None,
            connection_factory: None,
            project_instruction_loader: None,
            process_args: None,
            environment_overlay: None,
            account_type: None,
            created_title: None,
            resumed_title: None,
            authentication_method_id: None,
            authentication_method_selector: None,
            is_already_authenticated: None,
            capability_overrides: json!({}),
            embedded_text: false,
            question_methods: Vec::new(),
            completion_inspector_factory: None,
            event_source: None,
            on_dispose: None,
        }
    }
}

/// The running turn (`adapter.activeTurn`).
pub struct ActiveTurn {
    pub turn_id: String,
    normalizer: RefCell<AcpEventNormalizer>,
    completion_inspector: Option<Rc<dyn CompletionInspector>>,
    interrupted: Cell<bool>,
    references: Vec<Value>,
}

/// The adapter's state, shared with its interaction handlers.
pub struct Inner {
    readiness: Value,
    source_scope_id: String,
    workspace_root: String,
    runtime_descriptor: Value,
    managed: bool,
    app_version: String,
    on_event: Rc<dyn Fn(Value)>,
    on_exit: Rc<dyn Fn(Value)>,
    persistence_reporter: NativePersistenceReporter,
    logger: Option<Logger>,
    connection_factory: ConnectionFactory,
    project_instruction_loader: ProjectInstructionLoader,
    process_args: ProcessArgs,
    environment_overlay: Option<EnvironmentOverlay>,
    account_type: Value,
    created_title: String,
    resumed_title: String,
    authentication_method_id: Option<String>,
    authentication_method_selector: Option<AuthenticationMethodSelector>,
    is_already_authenticated: Option<AlreadyAuthenticated>,
    authenticated_method_id: RefCell<Option<String>>,
    capability_overrides: Value,
    embedded_text: bool,
    pub(super) question_methods: HashSet<String>,
    completion_inspector_factory: Option<CompletionInspectorFactory>,
    event_source: String,
    on_dispose: Option<Rc<dyn Fn()>>,
    connection: RefCell<Option<Rc<dyn RpcConnection>>>,
    closing_connections: RefCell<Vec<Rc<dyn RpcConnection>>>,
    client: RefCell<Option<AcpClient>>,
    connection_mode: RefCell<Option<String>>,
    pub(super) session_id: RefCell<Option<String>>,
    session_config: RefCell<SessionConfig>,
    commands: RefCell<Vec<Value>>,
    pub(super) active_turn: RefCell<Option<Rc<ActiveTurn>>>,
    pub(super) pending_approvals: RefCell<Vec<PendingApproval>>,
    pub(super) pending_questions: RefCell<Vec<PendingQuestion>>,
    exit_expected: Cell<bool>,
    disposed: Cell<bool>,
    historical_events: RefCell<Vec<Value>>,
    history_replay: RefCell<Option<AcpHistoryReplay>>,
    history_coverage: RefCell<Option<String>>,
}

impl Inner {
    pub(super) fn display_name(&self) -> String {
        js::str_or_empty(self.runtime_descriptor.get("displayName")).to_string()
    }

    pub(super) fn runtime_id(&self) -> String {
        js::str_or_empty(self.runtime_descriptor.get("id")).to_string()
    }

    /// `this.onEvent(event)`.
    pub(super) fn emit(&self, event: Value) {
        (self.on_event)(event);
    }

    /// `this.logger.warn?.(message)`.
    pub(super) fn warn(&self, message: &str) {
        if let Some(logger) = self.logger.as_ref() {
            logger(message);
        }
    }

    fn client(&self) -> Option<AcpClient> {
        self.client.borrow().clone()
    }

    fn session(&self) -> Option<String> {
        self.session_id.borrow().clone()
    }

    fn assert_usable(&self) -> AgentResult<()> {
        let name = self.display_name();
        if self.disposed.get() {
            return Err(AgentError::new(format!("{name} ACP adapter is closed.")));
        }
        if !js::truthy_opt(self.readiness.get("executablePath")) {
            return Err(AgentError::new(format!(
                "{name} ACP executable is unavailable."
            )));
        }
        Ok(())
    }

    fn assert_idle(&self) -> AgentResult<()> {
        self.assert_usable()?;
        if self.active_turn.borrow().is_some() {
            return Err(AgentError::new(format!(
                "Stop the active {} turn first.",
                self.display_name()
            )));
        }
        Ok(())
    }

    fn sync_session(&self, response: &Value) {
        let config_options: Vec<Value> = array(response.get("configOptions")).to_vec();
        *self.session_config.borrow_mut() = SessionConfig {
            models: resolve_acp_models(&config_options, response.get("models")),
            modes: resolve_acp_modes(&config_options, response.get("modes")),
            efforts: resolve_acp_efforts(&config_options),
            config_options,
        };
    }

    fn sync_config_options(&self, value: Option<&Value>) {
        let Some(options) = value.and_then(Value::as_array) else {
            return;
        };
        let mut config = self.session_config.borrow_mut();
        config.config_options = options.clone();
        config.models = resolve_acp_models(options, None);
        config.modes = resolve_acp_modes(options, None);
        config.efforts = resolve_acp_efforts(options);
    }

    /// `#handleSessionUpdate(notification)`.
    fn handle_session_update(&self, notification: &Value) -> AgentResult<()> {
        if notification.is_null() {
            return Ok(());
        }
        let notified = notification.get("sessionId").and_then(Value::as_str);
        if self.session_id.borrow().is_none()
            && native_session_id(notification.get("sessionId")).is_some()
        {
            *self.session_id.borrow_mut() = notified.map(str::to_string);
        }
        if notified != self.session_id.borrow().as_deref() {
            return Ok(());
        }
        let update = notification.get("update");
        if let Some(replay) = self.history_replay.borrow_mut().as_mut() {
            replay.accept(notification);
        }
        match update
            .and_then(|u| u.get("sessionUpdate"))
            .and_then(Value::as_str)
        {
            Some("available_commands_update") => {
                let commands = array(update.and_then(|u| u.get("availableCommands")))
                    .iter()
                    .take(500)
                    .map(|command| {
                        json!({
                            "name": text(command.get("name"), 160).trim_start_matches('/').to_string(),
                            "description": text(command.get("description"), 1_000),
                            "argumentHint": text(command.get("input").and_then(|i| i.get("hint")), 500),
                            "source": self.event_source,
                        })
                    })
                    .filter(|command| command["name"].as_str().is_some_and(|n| !n.is_empty()))
                    .collect();
                *self.commands.borrow_mut() = commands;
                return Ok(());
            }
            Some("config_option_update") => {
                self.sync_config_options(update.and_then(|u| u.get("configOptions")));
                return Ok(());
            }
            Some("current_mode_update") => {
                let mode = text(update.and_then(|u| u.get("currentModeId")), 160);
                self.session_config.borrow_mut().modes.current_id =
                    (!mode.is_empty()).then_some(mode);
                return Ok(());
            }
            _ => {}
        }
        let Some(active) = self.active_turn.borrow().clone() else {
            return Ok(());
        };
        if let Some(inspector) = active.completion_inspector.as_ref()
            && inspector.observe(notification).is_err()
        {
            self.warn("ACP completion inspection ignored an invalid native update.");
        }
        let events = active.normalizer.borrow_mut().normalize(notification);
        for normalized in events {
            self.emit(normalized);
        }
        Ok(())
    }

    /// `#withSession(request, operation)`.
    fn with_session(
        &self,
        request: &Value,
        operation: impl FnOnce() -> AgentResult<Value>,
    ) -> AgentResult<Value> {
        let name = self.display_name();
        let session = self.session();
        if session.is_none()
            || request.get("sessionId").and_then(Value::as_str) != session.as_deref()
        {
            return Err(AgentError::new(format!(
                "ACP file request does not belong to the active {name} session."
            )));
        }
        if self.history_replay.borrow().is_some() {
            return Err(AgentError::new(format!(
                "ACP file requests are unavailable while {name} history is loading."
            )));
        }
        operation()
    }

    /// `#environment(mode)`.
    fn environment(&self, mode: &str) -> Vec<(String, String)> {
        let mut environment: Map<String, Value> =
            clean_environment(self.readiness.get("environment"));
        environment.insert(
            "PUPPYONE_AGENT_BACKEND".into(),
            Value::from(self.runtime_id()),
        );
        if let Some(overlay) = self.environment_overlay.as_ref() {
            let overlay = overlay(&environment, mode, &self.workspace_root, self.managed);
            for (key, value) in clean_environment(Some(&overlay)) {
                environment.insert(key, value);
            }
        }
        environment
            .into_iter()
            .filter_map(|(key, value)| value.as_str().map(|value| (key, value.to_string())))
            .collect()
    }

    /// `#nativeReferenceProfile()`.
    fn native_reference_profile(&self) -> AcpReferenceProfile {
        let capabilities = self
            .client()
            .and_then(|c| c.agent_capabilities())
            .unwrap_or_else(|| json!({}));
        let prompt = capabilities.get("promptCapabilities");
        AcpReferenceProfile {
            image: prompt.and_then(|p| p.get("image")) == Some(&Value::Bool(true)),
            embedded_text: self.embedded_text
                && prompt.and_then(|p| p.get("embeddedContext")) == Some(&Value::Bool(true)),
        }
    }

    /// `#capabilities()`.
    fn capabilities(&self) -> Value {
        let client = self.client();
        let native = client
            .as_ref()
            .and_then(AcpClient::agent_capabilities)
            .unwrap_or_else(|| json!({}));
        let session_capabilities = native.get("sessionCapabilities");
        let session_capability =
            |key: &str| js::truthy_opt(session_capabilities.and_then(|c| c.get(key)));
        let can_discover_history = session_capability("list");
        let can_open_history =
            native.get("loadSession") == Some(&Value::Bool(true)) || session_capability("resume");
        let prompt = native.get("promptCapabilities");
        let accepts_images = js::truthy_opt(prompt.and_then(|p| p.get("image")));
        let accepts_embedded_text =
            self.embedded_text && js::truthy_opt(prompt.and_then(|p| p.get("embeddedContext")));
        let mcp = native.get("mcpCapabilities");
        let protocol_version = client
            .as_ref()
            .and_then(AcpClient::protocol_version)
            .unwrap_or(1);
        let agent_version = client
            .as_ref()
            .and_then(AcpClient::agent_info)
            .and_then(|info| info.get("version").filter(|v| !v.is_null()).cloned())
            .or_else(|| {
                self.readiness
                    .get("version")
                    .filter(|v| !v.is_null())
                    .cloned()
            })
            .unwrap_or(Value::Null);
        let overrides = &self.capability_overrides;
        let override_inputs = overrides.get("referenceInputs");
        let section = |base: &Value, key: &str| -> Map<String, Value> {
            let mut merged = record(base.get(key)).clone();
            for (k, v) in record(override_inputs.and_then(|o| o.get(key))) {
                merged.insert(k.clone(), v.clone());
            }
            merged
        };
        let base_inputs = &BASE_ACP_CAPABILITIES["referenceInputs"];
        let base_attachments = &base_inputs["attachments"];
        let override_attachments = override_inputs.and_then(|o| o.get("attachments"));
        let attachment = |key: &str, accepted: bool| -> Value {
            let mut merged = record(base_attachments.get(key)).clone();
            for (k, v) in record(override_attachments.and_then(|o| o.get(key))) {
                merged.insert(k.clone(), v.clone());
            }
            merged.insert("accepted".into(), Value::Bool(accepted));
            Value::Object(merged)
        };
        let mut attachments = record(Some(base_attachments)).clone();
        for (k, v) in record(override_attachments) {
            attachments.insert(k.clone(), v.clone());
        }
        attachments.insert("image".into(), attachment("image", accepts_images));
        attachments.insert("text".into(), attachment("text", true));
        let mut reference_inputs = record(Some(base_inputs)).clone();
        for (k, v) in record(override_inputs) {
            reference_inputs.insert(k.clone(), v.clone());
        }
        reference_inputs.insert(
            "workspace".into(),
            Value::Object(section(base_inputs, "workspace")),
        );
        reference_inputs.insert("attachments".into(), Value::Object(attachments));
        reference_inputs.insert(
            "limits".into(),
            Value::Object(section(base_inputs, "limits")),
        );
        let mut extensions = Map::new();
        for (namespace, entries) in record(native.get("_meta")).iter().take(16) {
            for (name, version) in record(Some(entries)).iter().take(16) {
                if let Some(version) = js::finite_number(version) {
                    extensions.insert(format!("{namespace}.{name}"), js::number(version));
                }
            }
        }
        Obj::from(&BASE_ACP_CAPABILITIES)
            .set("resume", can_open_history)
            .set("fork", session_capability("fork"))
            .set("sessionHistory", can_discover_history || can_open_history)
            .set("structuredQuestions", !self.question_methods.is_empty())
            .set(
                "mcp",
                js::truthy_opt(mcp.and_then(|m| m.get("http"))) || js::truthy_opt(mcp.and_then(|m| m.get("sse"))),
            )
            .set("attachments", accepts_images || accepts_embedded_text)
            .set(
                "revision",
                format!(
                    "{}-acp:{protocol_version}:image{}:embedded{}",
                    self.runtime_id(),
                    u8::from(accepts_images),
                    u8::from(accepts_embedded_text)
                ),
            )
            .set(
                "protocol",
                json!({
                    "name": "acp",
                    "version": protocol_version,
                    "agentVersion": agent_version,
                    "extensions": extensions,
                }),
            )
            .spread(overrides)
            .set(
                "history",
                json!({
                    "discovery": if can_discover_history { "paged" } else { "unsupported" },
                    "exactOpen": if can_open_history { "supported" } else { "unsupported" },
                    "hydration": if native.get("loadSession") == Some(&Value::Bool(true)) { "push-replay" } else { "unsupported" },
                }),
            )
            .set(
                "recovery",
                json!({
                    "strategy": if can_open_history { "snapshot-reload" } else { "unsupported" },
                    "activeExecution": "outcome-unknown",
                    "atomicHandoff": false,
                }),
            )
            .set("referenceInputs", Value::Object(reference_inputs))
            .build()
    }

    /// `#inspection()`.
    fn inspection(&self) -> Value {
        let name = self.display_name();
        let config = self.session_config.borrow().clone();
        let models = public_models(&config, &self.runtime_id());
        let account_ready = !models.is_empty() || self.authenticated_method_id.borrow().is_some();
        let account = Obj::new()
            .set(
                "account",
                if account_ready {
                    json!({ "type": self.account_type, "email": null, "planType": null })
                } else {
                    Value::Null
                },
            )
            .set("requiresOpenaiAuth", false)
            .set("requiresRuntimeSetup", !account_ready)
            .opt(
                "setupReason",
                (!account_ready).then_some("runtime-setup-required"),
            )
            .opt(
                "error",
                (!account_ready).then(|| format!("{name} has no authenticated model available.")),
            )
            .build();
        let version = self
            .readiness
            .get("version")
            .filter(|v| !v.is_null())
            .cloned()
            .or_else(|| {
                self.client()
                    .and_then(|c| c.agent_info())
                    .and_then(|info| info.get("version").filter(|v| !v.is_null()).cloned())
            })
            .unwrap_or(Value::Null);
        let source = self
            .readiness
            .get("source")
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or_else(|| {
                Value::from(if self.managed {
                    "bundled"
                } else {
                    "user-installed"
                })
            });
        json!({
            "account": account,
            "providers": public_providers(&models),
            "models": models,
            "modes": public_modes(&config),
            "commands": *self.commands.borrow(),
            "capabilities": self.capabilities(),
            "runtime": Obj::from(&self.runtime_descriptor)
                .set("version", version)
                .set("source", source)
                .set("compatibility", "acp-v1")
                .build(),
            "warnings": [],
        })
    }

    /// `#providerSession({ title, model, effort, mode })`.
    fn provider_session(&self, title: &str, model: &Value, effort: &Value, mode: &Value) -> Value {
        let now = clock::now_iso();
        let config = self.session_config.borrow();
        let pick = |current: &Option<String>, fallback: &Value| {
            current
                .clone()
                .map_or_else(|| fallback.clone(), Value::from)
        };
        json!({
            "providerSessionId": self.session(),
            "title": title,
            "model": pick(&config.models.current_id, model),
            "effort": pick(&config.efforts.current_id, effort),
            "mode": pick(&config.modes.current_id, mode),
            "createdAt": now,
            "updatedAt": now,
        })
    }
}

fn clean_environment(value: Option<&Value>) -> Map<String, Value> {
    record(value)
        .iter()
        .filter(|(_, entry)| entry.is_string())
        .map(|(key, entry)| (key.clone(), entry.clone()))
        .collect()
}

fn required_id(value: Option<&Value>, label: &str) -> AgentResult<String> {
    native_session_id(value).ok_or_else(|| AgentError::new(format!("{label} is invalid.")))
}

/// `value ?? fallback` for an optional field.
fn present<'a>(value: Option<&'a Value>, fallback: Option<&'a Value>) -> Option<&'a Value> {
    value.filter(|v| !v.is_null()).or(fallback)
}

/// `AcpRuntimeAdapter`.
#[derive(Clone)]
pub struct AcpRuntimeAdapter(Rc<Inner>);

impl AcpRuntimeAdapter {
    pub fn new(options: AcpAdapterOptions) -> AgentResult<Self> {
        if !js::truthy_opt(options.runtime_descriptor.get("id")) {
            return Err(
                AgentError::new("ACP runtime adapter requires a runtime descriptor.")
                    .with_name("TypeError"),
            );
        }
        let display_name =
            js::str_or_empty(options.runtime_descriptor.get("displayName")).to_string();
        let workspace_root = paths::absolute(&options.workspace_root)
            .to_string_lossy()
            .into_owned();
        let report = options
            .on_session_persisted
            .clone()
            .unwrap_or_else(|| Rc::new(|_| {}));
        let created_title = options
            .created_title
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| format!("New {display_name} session"));
        let resumed_title = options
            .resumed_title
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| format!("{display_name} session"));
        let runtime_id = js::str_or_empty(options.runtime_descriptor.get("id")).to_string();
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
                        let (Some(client), id) = (inner.client(), inner.session()) else {
                            return Ok(None);
                        };
                        let page = discover_acp_history(
                            &client,
                            &inner.workspace_root,
                            &inner.created_title,
                            None,
                            None,
                        )
                        .await?;
                        let found = page["supported"] == true
                            && page["sessions"].as_array().is_some_and(|sessions| {
                                sessions.iter().any(|entry| {
                                    entry["providerSessionId"].as_str() == id.as_deref()
                                })
                            });
                        Ok(found.then(|| json!({ "providerSessionId": id, "sourceScopeId": inner.source_scope_id })))
                    })
                }),
                report,
                Rc::new(move || closed.upgrade().is_none_or(|inner| inner.disposed.get())),
            );
            Inner {
                readiness: if options.readiness.is_object() {
                    options.readiness.clone()
                } else {
                    json!({})
                },
                source_scope_id: options
                    .source_scope_id
                    .clone()
                    .unwrap_or_else(|| "default".into()),
                workspace_root,
                runtime_descriptor: options.runtime_descriptor.clone(),
                managed: options.managed,
                app_version: options.app_version.clone(),
                on_event: options.on_event.clone(),
                on_exit: options.on_exit.clone(),
                persistence_reporter: reporter,
                logger: options.logger.clone(),
                connection_factory: options
                    .connection_factory
                    .clone()
                    .unwrap_or_else(jsonl_rpc_connection_factory),
                project_instruction_loader: options
                    .project_instruction_loader
                    .clone()
                    .unwrap_or_else(|| {
                        Rc::new(|root| load_authorized_project_instructions(root, None))
                    }),
                process_args: options.process_args.clone().unwrap_or_else(|| {
                    Rc::new(|_mode, root, _managed| vec!["acp".into(), format!("--cwd={root}")])
                }),
                environment_overlay: options.environment_overlay.clone(),
                account_type: options
                    .account_type
                    .clone()
                    .map_or_else(|| Value::from(runtime_id.as_str()), Value::from),
                created_title,
                resumed_title,
                authentication_method_id: options
                    .authentication_method_id
                    .as_ref()
                    .map(|id| text(Some(&Value::from(id.as_str())), 160))
                    .filter(|id| !id.is_empty()),
                authentication_method_selector: options.authentication_method_selector.clone(),
                is_already_authenticated: options.is_already_authenticated.clone(),
                authenticated_method_id: RefCell::default(),
                capability_overrides: if options.capability_overrides.is_object() {
                    options.capability_overrides.clone()
                } else {
                    json!({})
                },
                embedded_text: options.embedded_text,
                question_methods: options
                    .question_methods
                    .iter()
                    .map(|method| text(Some(&Value::from(method.as_str())), 160))
                    .filter(|method| !method.is_empty())
                    .collect(),
                completion_inspector_factory: options.completion_inspector_factory.clone(),
                event_source: options.event_source.clone().unwrap_or_else(|| {
                    format!(
                        "{}-acp",
                        if runtime_id.is_empty() {
                            "agent"
                        } else {
                            &runtime_id
                        }
                    )
                }),
                on_dispose: options.on_dispose.clone(),
                connection: RefCell::default(),
                closing_connections: RefCell::default(),
                client: RefCell::default(),
                connection_mode: RefCell::default(),
                session_id: RefCell::default(),
                session_config: RefCell::default(),
                commands: RefCell::default(),
                active_turn: RefCell::default(),
                pending_approvals: RefCell::default(),
                pending_questions: RefCell::default(),
                exit_expected: Cell::new(false),
                disposed: Cell::new(false),
                historical_events: RefCell::default(),
                history_replay: RefCell::default(),
                history_coverage: RefCell::default(),
            }
        })))
    }

    /// `adapter.sessionId`.
    pub fn session_id(&self) -> Option<String> {
        self.0.session()
    }

    /// `adapter.activeTurn?.turnId`.
    pub fn active_turn_id(&self) -> Option<String> {
        self.0
            .active_turn
            .borrow()
            .as_ref()
            .map(|turn| turn.turn_id.clone())
    }

    /// `adapter.client`.
    pub fn client(&self) -> Option<AcpClient> {
        self.0.client()
    }

    /// `adapter.hasActiveProcess()`.
    pub fn has_active_process(&self) -> bool {
        self.0
            .connection
            .borrow()
            .as_ref()
            .is_some_and(|c| !c.closed())
    }

    /// `adapter.inspect()`.
    pub async fn inspect_now(&self) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_usable()?;
        self.connect("metadata").await?;
        let result = async {
            let client = inner
                .client()
                .ok_or_else(|| AgentError::new("ACP client is closed."))?;
            let response = client
                .new_session(json!({ "cwd": inner.workspace_root, "mcpServers": [] }))
                .await?;
            let current = inner.session().map(Value::from);
            let id = required_id(
                present(response.get("sessionId"), current.as_ref()),
                &format!("{} ACP session id", inner.display_name()),
            )?;
            *inner.session_id.borrow_mut() = Some(id);
            inner.sync_session(&response);
            // ACP publishes optional commands/config updates as notifications
            // after newSession. A short bounded settle window captures them
            // without turning provider discovery into a full runtime boot.
            tokio::time::sleep(Duration::from_millis(METADATA_SETTLE_MS)).await;
            Ok(inner.inspection())
        }
        .await;
        self.disconnect(
            &format!(
                "{} ACP metadata inspection completed.",
                inner.display_name()
            ),
            true,
        )
        .await?;
        result
    }

    /// `adapter.bootstrapSession({ kind, threadId, model, effort, mode })`:
    /// protocol, authentication and the requested native session on one
    /// connection.
    pub async fn bootstrap(&self, request: &Value) -> AgentResult<Value> {
        let inner = &self.0;
        let name = inner.display_name();
        inner.assert_idle()?;
        self.connect("session").await?;
        let kind = request
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("create");
        let null = Value::Null;
        let field = |key: &str| request.get(key).filter(|v| !v.is_null()).unwrap_or(&null);
        let (model, effort, mode, thread_id) = (
            field("model"),
            field("effort"),
            field("mode"),
            field("threadId"),
        );
        let client = inner
            .client()
            .ok_or_else(|| AgentError::new("ACP client is closed."))?;
        match kind {
            "resume" => {
                *inner.history_replay.borrow_mut() = Some(AcpHistoryReplay::new());
                let mut response: Option<Value> = None;
                let outcome = async {
                    let session_id = required_id(Some(thread_id), &format!("{name} ACP session id"))?;
                    let native = client.agent_capabilities().unwrap_or_else(|| json!({}));
                    let parameters = json!({ "cwd": inner.workspace_root, "mcpServers": [], "sessionId": session_id });
                    let loaded = if native.get("loadSession") == Some(&Value::Bool(true)) {
                        client.load_session(parameters).await
                    } else if !js::nullish(native.get("sessionCapabilities").and_then(|c| c.get("resume"))) {
                        client.resume_session(parameters).await
                    } else {
                        Err(AgentError::coded(
                            "AGENT_SESSION_RESUME_UNSUPPORTED",
                            format!("{name} does not support session load or resume."),
                        ))
                    };
                    let loaded = loaded.map_err(|error| {
                        if is_unavailable_acp_session_error(&error) {
                            agent_provider_session_unavailable_error(Some(&format!(
                                "The saved {name} session is no longer available."
                            )))
                        } else {
                            error
                        }
                    })?;
                    response = Some(loaded.clone());
                    let id = required_id(present(loaded.get("sessionId"), Some(thread_id)), &format!("{name} ACP session id"))?;
                    *inner.session_id.borrow_mut() = Some(id);
                    inner.sync_session(&loaded);
                    tokio::time::sleep(Duration::from_millis(METADATA_SETTLE_MS)).await;
                    Ok::<(), AgentError>(())
                }
                .await;
                let replay = inner.history_replay.borrow_mut().take();
                let provider = response
                    .as_ref()
                    .and_then(|r| native_session_id(r.get("sessionId")))
                    .or_else(|| native_session_id(Some(thread_id)));
                let (events, truncated) = match replay {
                    Some(mut replay) => {
                        let events = replay.events(provider.as_deref());
                        (events, replay.truncated)
                    }
                    None => (Vec::new(), false),
                };
                *inner.historical_events.borrow_mut() = events;
                *inner.history_coverage.borrow_mut() =
                    Some(if truncated { "partial" } else { "unknown" }.into());
                outcome?;
            }
            "create" => {
                let response = client
                    .new_session(json!({ "cwd": inner.workspace_root, "mcpServers": [] }))
                    .await?;
                let id = required_id(response.get("sessionId"), &format!("{name} ACP session id"))?;
                *inner.session_id.borrow_mut() = Some(id);
                inner.sync_session(&response);
                tokio::time::sleep(Duration::from_millis(METADATA_SETTLE_MS)).await;
            }
            _ => {
                return Err(AgentError::new("ACP session bootstrap kind is invalid.")
                    .with_name("TypeError"));
            }
        }
        let inspection = inner.inspection();
        self.apply_selection(model, effort, mode).await?;
        let title = if kind == "resume" {
            inner.resumed_title.clone()
        } else {
            inner.created_title.clone()
        };
        Ok(json!({
            "inspection": inspection,
            "providerSession": inner.provider_session(&title, model, effort, mode),
        }))
    }

    /// `adapter.discoverSessions({ cursor, signal })`.
    pub async fn discover_sessions(
        &self,
        cursor: Option<String>,
        signal: Option<CancelSignal>,
    ) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_usable()?;
        if let Some(signal) = signal.as_ref() {
            signal.check()?;
        }
        self.connect("history").await?;
        let result = async {
            let client = inner
                .client()
                .ok_or_else(|| AgentError::new("ACP client is closed."))?;
            discover_acp_history(
                &client,
                &inner.workspace_root,
                &inner.resumed_title,
                cursor.as_deref(),
                signal.as_ref(),
            )
            .await
        }
        .await;
        self.disconnect(
            &format!("{} ACP history discovery completed.", inner.display_name()),
            true,
        )
        .await?;
        result
    }

    /// `adapter.readHistory()`: this replay is never persisted and never a
    /// second transcript authority; it is only the initial projection for
    /// this process.
    pub fn read_history(&self) -> Vec<Value> {
        self.0.historical_events.borrow().clone()
    }

    /// `adapter.readHistoryResult()`.
    pub fn read_history_result(&self) -> AgentResult<Value> {
        let inner = &self.0;
        let coverage = inner
            .history_coverage
            .borrow()
            .clone()
            .unwrap_or_else(|| "unknown".into());
        let loads = inner
            .client()
            .and_then(|c| c.agent_capabilities())
            .is_some_and(|c| c.get("loadSession") == Some(&Value::Bool(true)));
        let reason = if coverage == "partial" {
            "read-limit"
        } else if loads {
            "replay-unverified"
        } else {
            "unsupported"
        };
        agent_history_read_result(&json!({
            "providerSessionId": inner.session(),
            "events": self.read_history(),
            "coverage": coverage,
            "reason": reason,
        }))
    }

    async fn fork_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_idle()?;
        let name = inner.display_name();
        let (Some(client), Some(session_id)) = (inner.client(), inner.session()) else {
            return Err(AgentError::new(format!("No {name} ACP session is active.")));
        };
        let response = client
            .fork_session(
                Obj::new()
                    .set("sessionId", session_id)
                    .opt(
                        "messageId",
                        request.get("messageId").filter(|m| js::truthy(m)).cloned(),
                    )
                    .build(),
            )
            .await?;
        let id = required_id(
            present(response.get("sessionId"), response.get("forkedSessionId")),
            &format!("{name} forked ACP session id"),
        )?;
        Ok(json!({ "providerSessionId": id }))
    }

    async fn delete_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_idle()?;
        if inner.client().is_none() {
            self.connect("session").await?;
        }
        let client = inner
            .client()
            .ok_or_else(|| AgentError::new("ACP client is closed."))?;
        let session_id = required_id(
            request.get("threadId"),
            &format!("{} ACP session id", inner.display_name()),
        )?;
        client
            .delete_session(json!({ "sessionId": session_id }))
            .await?;
        Ok(Value::Null)
    }

    async fn start_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let name = inner.display_name();
        inner.assert_usable()?;
        if inner.client().is_none() || inner.session().is_none() {
            return Err(AgentError::new(format!(
                "{name} ACP session is not connected."
            )));
        }
        if inner.active_turn.borrow().is_some() {
            return Err(AgentError::new(format!(
                "A {name} turn is already running."
            )));
        }
        let null = Value::Null;
        let field = |key: &str| request.get(key).filter(|v| !v.is_null()).unwrap_or(&null);
        self.apply_selection(field("model"), field("effort"), field("mode"))
            .await?;
        let turn_id = format!("{}:{}", inner.runtime_id(), uuid::Uuid::new_v4());
        let instructions = (inner.project_instruction_loader)(&inner.workspace_root)?;
        let profile = inner.native_reference_profile();
        let list = |key: &str| array(request.get(key)).to_vec();
        let all_references = list("references");
        let references = if all_references.is_empty() {
            [list("contextReferences"), list("attachments")].concat()
        } else {
            all_references.clone()
        };
        let blocks = build_acp_prompt_blocks(
            js::str_or_empty(request.get("prompt")),
            format_authorized_project_instructions(instructions.as_ref()).as_deref(),
            &materialize_acp_references(&references, profile)?,
            &inner.workspace_root,
            profile,
        )?;
        let runtime_version = inner
            .client()
            .and_then(|c| c.agent_info())
            .and_then(|info| {
                info.get("version")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| {
                inner
                    .readiness
                    .get("version")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        let completion_inspector = inner
            .completion_inspector_factory
            .as_ref()
            .and_then(|factory| factory(&turn_id, runtime_version));
        let active = Rc::new(ActiveTurn {
            turn_id: turn_id.clone(),
            normalizer: RefCell::new(AcpEventNormalizer::new(Some(&turn_id))),
            completion_inspector,
            interrupted: Cell::new(false),
            references: all_references,
        });
        *inner.active_turn.borrow_mut() = Some(active.clone());
        self.run_prompt(active, blocks);
        Ok(json!({ "turnId": turn_id }))
    }

    async fn interrupt_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let active = inner.active_turn.borrow().clone();
        let session_id = inner.session();
        let Some((active, session_id)) = active
            .filter(|active| {
                request.get("turnId").and_then(Value::as_str) == Some(active.turn_id.as_str())
            })
            .zip(session_id)
        else {
            return Err(AgentError::new(format!(
                "That {} turn is no longer running.",
                inner.display_name()
            )));
        };
        active.interrupted.set(true);
        if let Some(client) = inner.client() {
            client.cancel(json!({ "sessionId": session_id }));
        }
        Ok(Value::Null)
    }

    /// `adapter.forceTerminate(reason)`.
    pub async fn force_terminate(&self, reason: Option<&str>) -> AgentResult<()> {
        let reason = reason
            .map(str::to_string)
            .unwrap_or_else(|| format!("{} ACP runtime stopped.", self.0.display_name()));
        self.disconnect(&reason, false).await
    }

    /// `adapter.dispose(reason)`.
    pub async fn dispose_with(&self, reason: Option<&str>) -> AgentResult<()> {
        let inner = &self.0;
        if inner.disposed.get() {
            let closing = std::mem::take(&mut *inner.closing_connections.borrow_mut());
            for connection in closing {
                connection.wait_for_exit().await?;
            }
            return Ok(());
        }
        inner.disposed.set(true);
        let reason = reason
            .map(str::to_string)
            .unwrap_or_else(|| format!("{} ACP adapter closed.", inner.display_name()));
        acp_resolve_pending(inner, &reason);
        self.disconnect(&reason, true).await?;
        if let Some(on_dispose) = inner.on_dispose.as_ref() {
            on_dispose();
        }
        Ok(())
    }

    /// `#runPrompt(active, blocks)`.
    fn run_prompt(&self, active: Rc<ActiveTurn>, blocks: Vec<Value>) {
        let inner = self.0.clone();
        let client = inner.client();
        let session_id = inner.session();
        spawn_local(async move {
            let result = match client {
                Some(client) => {
                    client
                        .prompt(json!({ "sessionId": session_id, "prompt": blocks }))
                        .await
                }
                None => Err(AgentError::new("ACP client is closed.")),
            };
            let current = || {
                inner
                    .active_turn
                    .borrow()
                    .as_ref()
                    .is_some_and(|turn| Rc::ptr_eq(turn, &active))
            };
            if current() && !inner.disposed.get() {
                let session = inner.session();
                let interrupted = active.interrupted.get();
                match result {
                    Ok(response) => {
                        let completions = active
                            .normalizer
                            .borrow()
                            .complete_assistant(session.as_deref());
                        for completion in completions {
                            inner.emit(completion);
                        }
                        drop(inner.persistence_reporter.confirm());
                        if let Some(usage) = normalize_acp_prompt_usage(response.get("usage")) {
                            inner.emit(event(
                                "usage.updated",
                                session.as_deref(),
                                Some(&active.turn_id),
                                None,
                                usage,
                            ));
                        }
                        let completion = if interrupted {
                            None
                        } else {
                            active.completion_inspector.as_ref().and_then(|inspector| {
                                match inspector.complete(&json!({ "response": response })) {
                                    Ok(completion) => completion.filter(Value::is_object),
                                    Err(_) => {
                                        inner.warn("ACP completion inspection could not classify the completed turn.");
                                        None
                                    }
                                }
                            })
                        };
                        let stop_reason = text(response.get("stopReason"), 160);
                        let payload = Obj::new()
                            .set(
                                "status",
                                if interrupted {
                                    "interrupted"
                                } else {
                                    "completed"
                                },
                            )
                            .set(
                                "stopReason",
                                if stop_reason.is_empty() {
                                    Value::Null
                                } else {
                                    Value::from(stop_reason)
                                },
                            )
                            .spread(&completion.unwrap_or(Value::Null))
                            .build();
                        let kind = if interrupted {
                            "turn.interrupted"
                        } else {
                            "turn.completed"
                        };
                        inner.emit(event(
                            kind,
                            session.as_deref(),
                            Some(&active.turn_id),
                            None,
                            payload,
                        ));
                    }
                    Err(error) if error.delivery_outcome.as_deref() == Some("unknown") => {
                        (inner.on_exit)(json!({
                            "expected": false,
                            "error": redact_secret_text(&error.message),
                        }));
                    }
                    Err(error) => {
                        if !interrupted {
                            inner.emit(event(
                                "provider.error",
                                session.as_deref(),
                                Some(&active.turn_id),
                                None,
                                json!({ "message": redact_secret_text(&error.message), "recoverable": true }),
                            ));
                        }
                        let (kind, status) = if interrupted {
                            ("turn.interrupted", "interrupted")
                        } else {
                            ("turn.failed", "failed")
                        };
                        inner.emit(event(
                            kind,
                            session.as_deref(),
                            Some(&active.turn_id),
                            None,
                            json!({ "status": status }),
                        ));
                    }
                }
            }
            if current() {
                acp_resolve_pending(
                    &inner,
                    &format!(
                        "{} turn ended before a client request was resolved.",
                        inner.display_name()
                    ),
                );
                *inner.active_turn.borrow_mut() = None;
            }
        });
    }

    /// `#connect(mode)`.
    async fn connect(&self, mode: &str) -> AgentResult<()> {
        let inner = &self.0;
        let name = inner.display_name();
        let open = inner
            .connection
            .borrow()
            .as_ref()
            .is_some_and(|c| !c.closed());
        if open && inner.connection_mode.borrow().as_deref() == Some(mode) {
            return Ok(());
        }
        if inner.connection.borrow().is_some() {
            self.disconnect(&format!("{name} ACP connection mode changed."), true)
                .await?;
        }
        let environment = inner.environment(mode);
        inner.exit_expected.set(false);
        let connection = (inner.connection_factory)(ConnectionOptions {
            executable_path: PathBuf::from(js::str_or_empty(inner.readiness.get("executablePath"))),
            args: (inner.process_args)(mode, &inner.workspace_root, inner.managed),
            cwd: PathBuf::from(&inner.workspace_root),
            env: Some(environment),
            ..Default::default()
        })?;
        *inner.connection.borrow_mut() = Some(connection.clone());
        *inner.connection_mode.borrow_mut() = Some(mode.to_string());
        {
            let weak = Rc::downgrade(inner);
            let owned = Rc::downgrade(&connection);
            let fired = Cell::new(false);
            connection.on(Rc::new(move |event| {
                let ConnectionEvent::Exit(info) = event else {
                    return;
                };
                if fired.replace(true) {
                    return;
                }
                let Some(inner) = weak.upgrade() else { return };
                let current =
                    inner.connection.borrow().as_ref().is_some_and(|c| {
                        owned.upgrade().is_some_and(|owned| Rc::ptr_eq(c, &owned))
                    });
                if !current {
                    return;
                }
                *inner.connection.borrow_mut() = None;
                *inner.client.borrow_mut() = None;
                *inner.connection_mode.borrow_mut() = None;
                if !inner.exit_expected.get() && !inner.disposed.get() {
                    let name = inner.display_name();
                    acp_resolve_pending(&inner, &format!("{name} ACP process exited."));
                    let error = info
                        .get("error")
                        .filter(|e| js::truthy(e))
                        .map(|e| js::to_js_string(Some(e)))
                        .unwrap_or_else(|| format!("{name} ACP process exited unexpectedly."));
                    let diagnostics = info
                        .get("diagnostics")
                        .filter(|d| js::truthy(d))
                        .map(|d| js::to_js_string(Some(d)))
                        .unwrap_or_default();
                    (inner.on_exit)(json!({
                        "code": info.get("code").cloned().unwrap_or(Value::Null),
                        "signal": info.get("signal").cloned().unwrap_or(Value::Null),
                        "error": redact_secret_text(&error),
                        "diagnostics": redact_secret_text(&diagnostics),
                        "expected": false,
                    }));
                }
            }));
        }
        let file_system = {
            let weak = Rc::downgrade(inner);
            Rc::new(AcpWorkspaceFileSystem::new(
                &inner.workspace_root,
                Some(Rc::new(move || {
                    weak.upgrade()
                        .and_then(|inner| {
                            inner
                                .active_turn
                                .borrow()
                                .as_ref()
                                .map(|turn| turn.references.clone())
                        })
                        .unwrap_or_default()
                })),
            ))
        };
        let delegate = {
            let file_handler = |write: bool| {
                let weak = Rc::downgrade(inner);
                let file_system = file_system.clone();
                Rc::new(
                    move |request: Value| -> LocalBoxFuture<'static, AgentResult<Value>> {
                        let result = match weak.upgrade() {
                            Some(inner) => inner.with_session(&request, || {
                                if write {
                                    file_system.write_text_file(&request)
                                } else {
                                    file_system.read_text_file(&request)
                                }
                            }),
                            None => Err(AgentError::new("ACP adapter is closed.")),
                        };
                        Box::pin(async move { result })
                    },
                )
                    as Rc<dyn Fn(Value) -> LocalBoxFuture<'static, AgentResult<Value>>>
            };
            let permission = Rc::downgrade(inner);
            let updates = Rc::downgrade(inner);
            let questions = Rc::downgrade(inner);
            let extensions = Rc::downgrade(inner);
            AcpDelegate {
                read_text_file: Some(file_handler(false)),
                write_text_file: Some(file_handler(true)),
                request_permission: Some(Rc::new(move |request: Value| {
                    match permission.upgrade() {
                        Some(inner) => acp_request_permission(&inner, &request),
                        None => {
                            Box::pin(async { Ok(json!({ "outcome": { "outcome": "cancelled" } })) })
                        }
                    }
                })),
                on_session_update: Some(Rc::new(move |notification: Value| {
                    match updates.upgrade() {
                        Some(inner) => inner.handle_session_update(&notification),
                        None => Ok(()),
                    }
                })),
                handle_notification: None,
                can_handle_request: Some(Rc::new(move |method: &str| {
                    questions
                        .upgrade()
                        .is_some_and(|inner| inner.question_methods.contains(method))
                })),
                handle_request: Some(Rc::new(
                    move |method: String, request: Value| match extensions
                        .upgrade()
                        .and_then(|inner| acp_handle_extension_request(&inner, &method, &request))
                    {
                        Some(response) => response,
                        None => Box::pin(async { Ok(Value::Null) }),
                    },
                )),
            }
        };
        let client = AcpClient::new(
            connection,
            Some(
                json!({ "name": "puppyone-desktop", "title": "PuppyOne Desktop", "version": inner.app_version }),
            ),
            delegate,
            Default::default(),
        );
        *inner.client.borrow_mut() = Some(client.clone());
        client.initialize(None, None).await?;
        let selected = inner
            .authentication_method_selector
            .as_ref()
            .and_then(|selector| selector(&client.auth_methods()))
            .map(|id| text(Some(&Value::from(id)), 160))
            .filter(|id| !id.is_empty());
        if let Some(method_id) = inner.authentication_method_id.clone().or(selected) {
            let advertised = client
                .auth_methods()
                .iter()
                .any(|method| method.get("id").and_then(Value::as_str) == Some(method_id.as_str()));
            if !advertised {
                return Err(AgentError::new(format!(
                    "{name} did not advertise the required authentication method."
                )));
            }
            let already = match inner.is_already_authenticated.as_ref() {
                Some(check) => check(client.clone(), method_id.clone()).await?,
                None => false,
            };
            if !already {
                client
                    .authenticate(json!({ "methodId": method_id }))
                    .await?;
            }
            *inner.authenticated_method_id.borrow_mut() = Some(method_id);
        }
        Ok(())
    }

    /// `#disconnect(reason, { expected })`.
    async fn disconnect(&self, reason: &str, expected: bool) -> AgentResult<()> {
        let inner = &self.0;
        inner.exit_expected.set(expected);
        let client = inner.client.borrow_mut().take();
        let connection = inner.connection.borrow_mut().take();
        *inner.connection_mode.borrow_mut() = None;
        *inner.authenticated_method_id.borrow_mut() = None;
        if let Some(client) = client {
            client.dispose();
        }
        let Some(connection) = connection else {
            return Ok(());
        };
        inner
            .closing_connections
            .borrow_mut()
            .push(connection.clone());
        connection.dispose(reason, expected);
        connection.wait_for_exit().await?;
        inner
            .closing_connections
            .borrow_mut()
            .retain(|closing| !Rc::ptr_eq(closing, &connection));
        Ok(())
    }

    /// `#applySelection({ model, effort, mode })`.
    async fn apply_selection(
        &self,
        model: &Value,
        effort: &Value,
        mode: &Value,
    ) -> AgentResult<()> {
        let inner = &self.0;
        let (Some(client), Some(session_id)) = (inner.client(), inner.session()) else {
            return Ok(());
        };
        let name = inner.display_name();
        let requested_model = text(Some(model), 512);
        let (current_model, model_available, model_config) = {
            let config = inner.session_config.borrow();
            (
                config.models.current_id.clone(),
                config
                    .models
                    .available
                    .iter()
                    .any(|entry| entry.id == requested_model),
                config.models.config_id.clone(),
            )
        };
        if !requested_model.is_empty() && Some(&requested_model) != current_model.as_ref() {
            if !model_available {
                return Err(AgentError::new(format!(
                    "The selected {name} model is no longer available."
                )));
            }
            match model_config {
                Some(config_id) => {
                    let response = client
                        .set_config_option(json!({
                            "configId": config_id,
                            "sessionId": session_id,
                            "type": "select",
                            "value": requested_model,
                        }))
                        .await?;
                    inner.sync_config_options(response.get("configOptions"));
                }
                None => {
                    client
                        .set_model(json!({ "sessionId": session_id, "modelId": requested_model }))
                        .await?;
                    inner.session_config.borrow_mut().models.current_id = Some(requested_model);
                }
            }
        }
        let efforts = inner.session_config.borrow().efforts.clone();
        let requested_effort = resolve_requested_acp_effort(Some(effort), &efforts);
        if js::truthy(effort) && requested_effort.is_none() {
            return Err(AgentError::new(format!(
                "The selected {name} reasoning effort is no longer available."
            )));
        }
        if let Some(requested_effort) =
            requested_effort.filter(|e| Some(e) != efforts.current_id.as_ref())
        {
            let Some(config_id) = efforts.config_id.clone() else {
                return Err(AgentError::new(format!(
                    "This {name} ACP runtime does not support changing reasoning effort."
                )));
            };
            let response = client
                .set_config_option(json!({
                    "configId": config_id,
                    "sessionId": session_id,
                    "type": "select",
                    "value": requested_effort,
                }))
                .await?;
            inner.sync_config_options(response.get("configOptions"));
        }
        let modes = inner.session_config.borrow().modes.clone();
        if let Some(requested_mode) = resolve_requested_acp_mode(Some(mode), &modes)
            .filter(|m| Some(m) != modes.current_id.as_ref())
        {
            match modes.config_id.clone() {
                Some(config_id) => {
                    let response = client
                        .set_config_option(json!({
                            "configId": config_id,
                            "sessionId": session_id,
                            "type": "select",
                            "value": requested_mode,
                        }))
                        .await?;
                    inner.sync_config_options(response.get("configOptions"));
                }
                None => {
                    client
                        .set_mode(json!({ "sessionId": session_id, "modeId": requested_mode }))
                        .await?;
                    inner.session_config.borrow_mut().modes.current_id = Some(requested_mode);
                }
            }
        }
        Ok(())
    }

    /// `adapter.resolveApproval(request)`.
    pub fn resolve_approval_now(&self, request: &Value) -> AgentResult<()> {
        acp_resolve_approval(&self.0, request)
    }

    /// `adapter.resolveQuestion(request)`.
    pub fn resolve_question_now(&self, request: &Value) -> AgentResult<()> {
        acp_resolve_question(&self.0, request)
    }
}

impl AgentRuntimeAdapter for AcpRuntimeAdapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        Box::pin(self.inspect_now())
    }
    fn create_session(&self, selection: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move {
            let request = Obj::from(&selection).set("kind", "create").build();
            Ok(self.bootstrap(&request).await?["providerSession"].clone())
        })
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move {
            let request = Obj::from(&request).set("kind", "resume").build();
            Ok(self.bootstrap(&request).await?["providerSession"].clone())
        })
    }
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.start_turn_inner(request))
    }
    fn interrupt_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.interrupt_inner(request))
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        Box::pin(self.dispose_with(None))
    }
    fn implements(&self, name: &str) -> bool {
        matches!(
            name,
            "bootstrapSession"
                | "resolveApproval"
                | "resolveQuestion"
                | "forkSession"
                | "deleteNativeSession"
                | "referenceMentionDelivery"
                | "getSessionHistoryPort"
        )
    }
    fn bootstrap_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move { self.bootstrap(&request).await })
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
        Box::pin(self.fork_inner(request))
    }
    fn delete_native_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.delete_inner(request))
    }
    fn reference_mention_delivery(&self, _reference: &Value) -> Option<&'static str> {
        Some("resource")
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(AcpHistoryPort(self.clone())))
    }
}

/// `adapter.getSessionHistoryPort()`.
struct AcpHistoryPort(AcpRuntimeAdapter);

impl SessionHistoryPort for AcpHistoryPort {
    fn source_scope_id(&self) -> Option<String> {
        Some(self.0.0.source_scope_id.clone())
    }
    fn implements(&self, method: &str) -> bool {
        matches!(method, "discover" | "hydrate")
    }
    fn discover(
        &self,
        cursor: Option<String>,
        _limit: usize,
        signal: CancelSignal,
    ) -> AdapterFuture<'_, Value> {
        Box::pin(self.0.discover_sessions(cursor, Some(signal)))
    }
    fn hydrate(&self, _signal: CancelSignal) -> AdapterFuture<'_, Value> {
        let result = self.0.read_history_result();
        Box::pin(async move { result })
    }
}

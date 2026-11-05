//! `runtimes/claude/claude-agent-sdk-adapter.mjs`: Claude Code through the
//! official Agent SDK. One persistent native query serves every turn of a
//! session while its configuration is unchanged; the SDK's history helpers
//! read the same Claude Code profile the query runs in.
use super::claude_agent_sdk::{
    CanUseTool, ClaudeQuery, ClaudeSdk, ForkSessionOptions, PermissionOptions, PromptSource,
    QueryOptions, SpawnClaudeCodeProcess, SystemPrompt,
};
use super::claude_discovery::{SdkLoader, default_sdk_loader};
use super::claude_events::{ClaudeEventState, normalize_claude_message};
use super::claude_history_discovery::discover_claude_history;
use super::claude_history_reader::read_claude_history;
use super::claude_history_source::claude_history_source;
use super::claude_identity::CLAUDE_RUNTIME_DESCRIPTOR;
use super::claude_interactions::{
    ClaudeInteractionHost, ClaudePendingInteractions, claude_request_permission,
    claude_resolve_approval, claude_resolve_pending, claude_resolve_question,
};
use super::claude_message_channel::{ClaudeMessageChannel, create_claude_user_message};
use super::claude_native_values::{
    bounded, clean_environment, compatible_claude_effort, normalize_account, normalize_commands,
    normalize_date, normalize_models,
};
use super::claude_prompt_input::{
    CLAUDE_NATIVE_IMAGE_MAX_BYTES, CLAUDE_NATIVE_IMAGE_MIME_TYPES,
    build_claude_user_message_content,
};
use super::claude_spawn::{ClaudeSpawnOptions, create_claude_spawn};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::event_loop::{AbortController, AbortSignal, SharedTask, shared, spawn};
use crate::agent::node_path;
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AgentRuntimeAdapter, agent_provider_session_unavailable_error,
};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::runtime::native_persistence_reporter::NativePersistenceReporter;
use crate::agent::security::authorized_project_instructions::{
    format_authorized_project_instructions, load_authorized_project_instructions,
};
use crate::agent::security::authorized_workspace_reference_prompt::format_authorized_workspace_reference_prompt;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::sync::LazyLock;
use std::time::Duration;

const INSPECTION_TIMEOUT_MS: u64 = 30_000;
const CLAUDE_PROJECT_INSTRUCTION_NAMES: &[&str] = &["CLAUDE.md", "AGENTS.md", "CONTEXT.md"];

/// `CLAUDE_CAPABILITIES`.
pub static CLAUDE_CAPABILITIES: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "streamingText": true,
        "structuredToolEvents": true,
        "commandOutputStreaming": true,
        "fileChangeEvents": true,
        "manualApprovals": true,
        "structuredQuestions": true,
        "resume": true,
        "fork": true,
        "steer": false,
        "queue": false,
        "attachments": true,
        "contextReferences": true,
        "modelSelection": true,
        "modeSelection": true,
        "slashCommands": true,
        "sessionHistory": true,
        "history": { "discovery": "paged", "exactOpen": "supported", "hydration": "snapshot" },
        "recovery": { "strategy": "snapshot-reload", "activeExecution": "outcome-unknown", "atomicHandoff": false },
        "usage": true,
        "accountState": true,
        "mcp": true,
        "skills": true,
        "compaction": false,
        "revision": "claude-agent-sdk:0.3.159",
        "protocol": { "name": "claude-agent-sdk", "version": "0.3.159" },
        "constraints": {
            "modelSwitch": "turn-boundary",
            "modeSwitch": "turn-boundary",
            "forkRequiresIdle": true,
            "compactionRequiresIdle": true,
        },
        "referenceInputs": {
            "schemaVersion": 1,
            "workspace": { "files": true, "directories": true, "crossRoots": true },
            "attachments": {
                "image": {
                    "accepted": true,
                    "mimeTypes": CLAUDE_NATIVE_IMAGE_MIME_TYPES,
                    "maxBytes": CLAUDE_NATIVE_IMAGE_MAX_BYTES,
                },
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

/// `projectInstructionLoader(workspaceRoot)`.
pub type ProjectInstructionLoader = Rc<dyn Fn(&str) -> AgentResult<Option<Value>>>;
/// `logger.warn(message)`.
pub type Logger = Rc<dyn Fn(&str)>;
/// The host environment the SDK's history helpers read (`process.env`).
pub type HostEnvironment = Rc<dyn Fn(&str) -> Option<String>>;

/// `new ClaudeAgentSdkAdapter({ … })`.
#[derive(Clone)]
pub struct ClaudeAdapterOptions {
    pub readiness: Value,
    pub workspace_root: String,
    pub app_version: String,
    pub sdk_loader: Option<SdkLoader>,
    pub on_event: Rc<dyn Fn(Value)>,
    pub on_exit: Rc<dyn Fn(Value)>,
    pub on_session_persisted: Option<Rc<dyn Fn(Value)>>,
    pub project_instruction_loader: Option<ProjectInstructionLoader>,
    pub spawn_claude_code_process: Option<Rc<dyn SpawnClaudeCodeProcess>>,
    pub logger: Option<Logger>,
    pub host_environment: Option<HostEnvironment>,
}

impl ClaudeAdapterOptions {
    pub fn new(readiness: Value, workspace_root: &str) -> Self {
        Self {
            readiness,
            workspace_root: workspace_root.into(),
            app_version: "0.0.0".into(),
            sdk_loader: None,
            on_event: Rc::new(|_| {}),
            on_exit: Rc::new(|_| {}),
            on_session_persisted: None,
            project_instruction_loader: None,
            spawn_claude_code_process: None,
            logger: None,
            host_environment: None,
        }
    }
}

type ActiveState = Rc<RefCell<ClaudeEventState>>;

/// The adapter's state.
pub struct Inner {
    readiness: Value,
    workspace_root: String,
    app_version: String,
    sdk_loader: SdkLoader,
    on_event: Rc<dyn Fn(Value)>,
    on_exit: Rc<dyn Fn(Value)>,
    persistence_reporter: NativePersistenceReporter,
    project_instruction_loader: ProjectInstructionLoader,
    spawn: Rc<dyn SpawnClaudeCodeProcess>,
    logger: Option<Logger>,
    source_scope_id: String,
    history_root: PathBuf,
    sdk: RefCell<Option<Rc<dyn ClaudeSdk>>>,
    session_id: RefCell<Option<String>>,
    resuming: Cell<bool>,
    active_turn_id: RefCell<Option<String>>,
    active_query: RefCell<Option<Rc<dyn ClaudeQuery>>>,
    active_controller: RefCell<Option<AbortController>>,
    active_state: RefCell<Option<ActiveState>>,
    message_channel: RefCell<Option<ClaudeMessageChannel>>,
    query_configuration_key: RefCell<Option<String>>,
    query_consumer: RefCell<Option<SharedTask<()>>>,
    interrupt_requested: Cell<bool>,
    pending: Rc<ClaudePendingInteractions>,
    model_profiles: RefCell<HashMap<String, Value>>,
    disposed: Cell<bool>,
}

/// `ClaudeAgentSdkAdapter`.
#[derive(Clone)]
pub struct ClaudeAgentSdkAdapter(Rc<Inner>);

/// `idleInput(signal)`: a prompt that ends only when inspection aborts.
struct IdleInput(AbortSignal);

impl PromptSource for IdleInput {
    fn next(&self) -> LocalBoxFuture<'static, Option<Value>> {
        let signal = self.0.clone();
        Box::pin(async move {
            signal.aborted_reason().await;
            None
        })
    }
}

fn same_query(a: &Rc<dyn ClaudeQuery>, b: &Rc<dyn ClaudeQuery>) -> bool {
    std::ptr::addr_eq(Rc::as_ptr(a), Rc::as_ptr(b))
}

/// `projectInstructionIdentity(value)`.
fn project_instruction_identity(value: Option<&Value>) -> Option<String> {
    let value = value.filter(|v| v.is_object() || v.is_array())?;
    let mut hash = Sha256::new();
    hash.update(js::string_or_empty(value.get("source")).as_bytes());
    hash.update(b"\0");
    hash.update(js::string_or_empty(value.get("text")).as_bytes());
    Some(
        hash.finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

/// `claudeCapabilitiesForRuntime(version)`.
fn claude_capabilities_for_runtime(version: Option<&Value>) -> Value {
    let agent_version = Some(bounded(version, 80)).filter(|v| !v.is_empty());
    let revision = format!(
        "{}:claude-code:{}",
        CLAUDE_CAPABILITIES["revision"].as_str().unwrap_or(""),
        agent_version.as_deref().unwrap_or("unknown")
    );
    let protocol = js::with(
        &CLAUDE_CAPABILITIES["protocol"],
        "agentVersion",
        agent_version,
    );
    Obj::from(&CLAUDE_CAPABILITIES)
        .set("revision", revision)
        .set("protocol", protocol)
        .build()
}

/// `formatClaudePrompt(prompt, references, workspaceRoot)`.
pub fn format_claude_prompt(prompt: &str, references: &[Value], workspace_root: &str) -> String {
    format_authorized_workspace_reference_prompt(prompt, references, Some(workspace_root))
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

impl ClaudeInteractionHost for Inner {
    fn disposed(&self) -> bool {
        self.disposed.get()
    }
    fn active_turn_id(&self) -> Option<String> {
        self.active_turn_id.borrow().clone()
    }
    fn session_id(&self) -> Option<String> {
        self.session_id.borrow().clone()
    }
    fn emit(&self, event: Value) {
        (self.on_event)(event);
    }
    fn pending(&self) -> Rc<ClaudePendingInteractions> {
        self.pending.clone()
    }
}

impl Inner {
    fn warn(&self, message: &str) {
        if let Some(logger) = self.logger.as_ref() {
            logger(message);
        }
    }

    fn assert_usable(&self) -> AgentResult<()> {
        if self.disposed.get() {
            return Err(AgentError::new("Claude Code adapter is closed."));
        }
        Ok(())
    }

    fn assert_idle(&self) -> AgentResult<()> {
        self.assert_usable()?;
        if self.active_turn_id.borrow().is_some() {
            return Err(AgentError::new("Stop the active Claude Code turn first."));
        }
        Ok(())
    }

    fn clear_active(&self) {
        *self.active_turn_id.borrow_mut() = None;
        *self.active_state.borrow_mut() = None;
        self.interrupt_requested.set(false);
    }

    fn load_sdk(&self) -> AgentResult<Rc<dyn ClaudeSdk>> {
        if let Some(sdk) = self.sdk.borrow().clone() {
            return Ok(sdk);
        }
        let sdk = (self.sdk_loader)()
            .map_err(|_| AgentError::new("Claude Agent SDK could not be loaded."))?;
        *self.sdk.borrow_mut() = Some(sdk.clone());
        Ok(sdk)
    }

    fn is_active_query(&self, query: &Rc<dyn ClaudeQuery>) -> bool {
        self.active_query
            .borrow()
            .as_ref()
            .is_some_and(|active| same_query(active, query))
    }
}

/// `withTimeout(promise, timeoutMs, message)`.
async fn with_timeout<T>(
    future: impl std::future::Future<Output = AgentResult<T>>,
    timeout_ms: u64,
    message: &str,
) -> AgentResult<T> {
    tokio::time::timeout(Duration::from_millis(timeout_ms), future)
        .await
        .unwrap_or_else(|_| Err(AgentError::new(message)))
}

struct QuerySelection {
    model: Option<String>,
    effort: Option<String>,
    mode: Option<String>,
    resume: Option<String>,
    session_id: Option<String>,
    project_instructions: Option<Value>,
}

impl ClaudeAgentSdkAdapter {
    pub fn new(options: ClaudeAdapterOptions) -> Self {
        Self(Rc::new_cyclic(|weak: &Weak<Inner>| {
            // SDK history helpers use the parent process profile. Launch the
            // SDK query in that same profile.
            let host = options
                .host_environment
                .clone()
                .unwrap_or_else(|| Rc::new(|key: &str| std::env::var(key).ok()));
            let (source_scope_id, history_root) = claude_history_source(&*host);
            let verify = {
                let weak = weak.clone();
                let scope = source_scope_id.clone();
                Rc::new(move || {
                    let (weak, scope) = (weak.clone(), scope.clone());
                    Box::pin(async move {
                        let Some(inner) = weak.upgrade() else {
                            return Ok(None);
                        };
                        let Some(id) = inner.session_id.borrow().clone() else {
                            return Ok(None);
                        };
                        let sdk = inner.load_sdk()?;
                        let root = inner.workspace_root.clone();
                        drop(inner);
                        let info = sdk.get_session_info(&id, Some(&root)).await?;
                        let Some(inner) = weak.upgrade() else {
                            return Ok(None);
                        };
                        let same = info
                            .as_ref()
                            .and_then(|info| info.get("sessionId"))
                            .and_then(Value::as_str)
                            == Some(id.as_str())
                            && inner.session_id.borrow().as_deref() == Some(id.as_str());
                        Ok(
                            same.then(
                                || json!({ "providerSessionId": id, "sourceScopeId": scope }),
                            ),
                        )
                    }) as LocalBoxFuture<'static, AgentResult<Option<Value>>>
                })
            };
            let is_closed = {
                let weak = weak.clone();
                Rc::new(move || weak.upgrade().is_none_or(|inner| inner.disposed.get()))
            };
            let logger = options.logger.clone();
            let spawn_hook = options
                .spawn_claude_code_process
                .clone()
                .unwrap_or_else(|| {
                    let logger = logger.clone();
                    Rc::new(create_claude_spawn(ClaudeSpawnOptions {
                        on_stderr: Some(Rc::new(move |data: &str| {
                            let diagnostic = redact_secret_text(data);
                            let diagnostic = js::trim(&diagnostic);
                            let start = js::len16(diagnostic).saturating_sub(4_000);
                            let diagnostic = js::tail16(diagnostic, start);
                            if !diagnostic.is_empty()
                                && let Some(logger) = logger.as_ref()
                            {
                                logger(&format!("Claude Code runtime: {diagnostic}"));
                            }
                        })),
                        ..Default::default()
                    })) as Rc<dyn SpawnClaudeCodeProcess>
                });
            Inner {
                readiness: if options.readiness.is_object() {
                    options.readiness.clone()
                } else {
                    json!({})
                },
                workspace_root: node_path::resolve_one(&options.workspace_root)
                    .to_string_lossy()
                    .into_owned(),
                app_version: options.app_version.clone(),
                sdk_loader: options
                    .sdk_loader
                    .clone()
                    .unwrap_or_else(default_sdk_loader),
                on_event: options.on_event.clone(),
                on_exit: options.on_exit.clone(),
                persistence_reporter: NativePersistenceReporter::new(
                    verify,
                    options
                        .on_session_persisted
                        .clone()
                        .unwrap_or_else(|| Rc::new(|_| {})),
                    is_closed,
                ),
                project_instruction_loader: options
                    .project_instruction_loader
                    .clone()
                    .unwrap_or_else(|| {
                        Rc::new(|root: &str| {
                            load_authorized_project_instructions(
                                root,
                                Some(CLAUDE_PROJECT_INSTRUCTION_NAMES),
                            )
                        })
                    }),
                spawn: spawn_hook,
                logger,
                source_scope_id,
                history_root,
                sdk: RefCell::default(),
                session_id: RefCell::default(),
                resuming: Cell::new(false),
                active_turn_id: RefCell::default(),
                active_query: RefCell::default(),
                active_controller: RefCell::default(),
                active_state: RefCell::default(),
                message_channel: RefCell::default(),
                query_configuration_key: RefCell::default(),
                query_consumer: RefCell::default(),
                interrupt_requested: Cell::new(false),
                pending: Rc::default(),
                model_profiles: RefCell::default(),
                disposed: Cell::new(false),
            }
        }))
    }

    /// `adapter.sessionId`.
    pub fn session_id(&self) -> Option<String> {
        self.0.session_id.borrow().clone()
    }

    /// `adapter.activeTurnId`.
    pub fn active_turn_id(&self) -> Option<String> {
        self.0.active_turn_id.borrow().clone()
    }

    /// `adapter.historySource.sourceScopeId`.
    pub fn source_scope_id(&self) -> &str {
        &self.0.source_scope_id
    }

    /// `adapter.canUseTool` as the SDK receives it.
    fn can_use_tool(&self) -> CanUseTool {
        let weak = Rc::downgrade(&self.0);
        Rc::new(
            move |tool_name: String, input: Value, options: PermissionOptions| match weak.upgrade()
            {
                Some(inner) => claude_request_permission(&*inner, tool_name, input, options),
                None => Box::pin(async {
                    Ok(json!({
                        "behavior": "deny",
                        "message": "No active Claude Code session owns this request.",
                    }))
                }),
            },
        )
    }

    /// `#queryOptions({ … })`.
    fn query_options(
        &self,
        controller: &AbortController,
        selection: QuerySelection,
    ) -> QueryOptions {
        let inner = &self.0;
        let append =
            format_authorized_project_instructions(selection.project_instructions.as_ref());
        let environment = Obj::new()
            .spread(&inner.readiness["environment"])
            .set(
                "CLAUDE_CONFIG_DIR",
                inner.history_root.to_string_lossy().into_owned(),
            )
            .set(
                "CLAUDE_AGENT_SDK_CLIENT_APP",
                format!("puppyone-desktop/{}", inner.app_version),
            )
            .set("PUPPYONE_AGENT_BACKEND", "claude")
            .build();
        let logger = inner.logger.clone();
        let non_empty = |value: Option<String>| value.filter(|v| !v.is_empty());
        let resume = non_empty(selection.resume);
        QueryOptions {
            abort_controller: Some(controller.clone()),
            cwd: Some(inner.workspace_root.clone()),
            env: Some(clean_environment(&environment)),
            path_to_claude_code_executable: text_field(&inner.readiness, "executablePath"),
            model: non_empty(selection.model),
            effort: non_empty(selection.effort),
            session_id: if resume.is_some() {
                None
            } else {
                non_empty(selection.session_id)
            },
            resume,
            permission_mode: Some(
                if selection.mode.as_deref() == Some("plan") {
                    "plan"
                } else {
                    "default"
                }
                .into(),
            ),
            can_use_tool: Some(self.can_use_tool()),
            spawn_claude_code_process: Some(inner.spawn.clone()),
            stderr: Some(Rc::new(move |data: &str| {
                let diagnostic = redact_secret_text(data);
                let diagnostic = js::trim(&diagnostic);
                let start = js::len16(diagnostic).saturating_sub(4_000);
                let diagnostic = js::tail16(diagnostic, start);
                if !diagnostic.is_empty()
                    && let Some(logger) = logger.as_ref()
                {
                    logger(&format!("Claude Code runtime: {diagnostic}"));
                }
            })),
            include_partial_messages: true,
            setting_sources: Some(vec!["user".into()]),
            system_prompt: Some(SystemPrompt::Preset {
                preset: "claude_code".into(),
                append,
            }),
        }
    }

    /// `adapter.inspect()`.
    pub async fn inspect_now(&self) -> AgentResult<Value> {
        let inner = &self.0;
        let sdk = inner.load_sdk()?;
        let controller = AbortController::new();
        let query = sdk.query(
            Rc::new(IdleInput(controller.signal())),
            self.query_options(
                &controller,
                QuerySelection {
                    model: None,
                    effort: None,
                    mode: Some("agent".into()),
                    resume: None,
                    session_id: None,
                    project_instructions: None,
                },
            ),
        )?;
        let result = async {
            let initialized = with_timeout(
                query.initialization_result(),
                INSPECTION_TIMEOUT_MS,
                "Claude Code inspection timed out.",
            )
            .await?;
            let models = normalize_models(initialized.get("models"));
            *inner.model_profiles.borrow_mut() = models
                .iter()
                .map(|model| (js::string_or_empty(model.get("model")), model.clone()))
                .collect();
            let environment = clean_environment(&inner.readiness["environment"]);
            let account = normalize_account(initialized.get("account"), &models, &environment);
            let runtime = Obj::from(&CLAUDE_RUNTIME_DESCRIPTOR)
                .set(
                    "version",
                    inner.readiness.get("version").cloned().unwrap_or(Value::Null),
                )
                .set(
                    "source",
                    inner
                        .readiness
                        .get("source")
                        .filter(|v| !v.is_null())
                        .cloned()
                        .unwrap_or_else(|| Value::from("user-installed")),
                )
                .set(
                    "compatibility",
                    inner
                        .readiness
                        .get("compatibility")
                        .filter(|v| !v.is_null())
                        .cloned()
                        .unwrap_or_else(|| Value::from("native-sdk")),
                )
                .build();
            Ok(json!({
                "account": account,
                "providers": [],
                "models": models,
                "modes": [
                    { "id": "agent", "displayName": "Agent", "description": "Claude Code's standard permission flow.", "isDefault": true },
                    { "id": "plan", "displayName": "Plan", "description": "Read-only planning with Claude Code's native plan mode.", "isDefault": false },
                ],
                "commands": normalize_commands(initialized.get("commands")),
                "capabilities": claude_capabilities_for_runtime(inner.readiness.get("version")),
                "runtime": runtime,
                "warnings": [],
            }))
        }
        .await;
        controller.abort(AgentError::new("This operation was aborted").with_name("AbortError"));
        query.close();
        inner.spawn.wait_for_exit(Some(controller.signal())).await?;
        result
    }

    /// `adapter.discoverSessions({ cursor, limit, signal })`.
    pub async fn discover_sessions(
        &self,
        cursor: Option<&str>,
        limit: Option<&Value>,
        signal: Option<&AbortSignal>,
    ) -> AgentResult<Value> {
        self.0.assert_usable()?;
        if let Some(signal) = signal {
            signal.throw_if_aborted()?;
        }
        let sdk = self.0.load_sdk()?;
        discover_claude_history(&*sdk, &self.0.workspace_root, cursor, limit, signal).await
    }

    fn selection(request: &Value, key: &str, fallback: Value) -> Value {
        request.get(key).cloned().unwrap_or(fallback)
    }

    async fn create_session_inner(&self, selection: Value) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_idle()?;
        self.close_persistent_query(Some("Starting a new Claude Code session."))
            .await?;
        let id = uuid::Uuid::new_v4().to_string();
        *inner.session_id.borrow_mut() = Some(id.clone());
        inner.resuming.set(false);
        let now = js::now_iso();
        Ok(json!({
            "providerSessionId": id,
            "title": "New Claude Code session",
            "model": Self::selection(&selection, "model", Value::Null),
            "effort": Self::selection(&selection, "effort", Value::Null),
            "mode": Self::selection(&selection, "mode", Value::from("agent")),
            "createdAt": now,
            "updatedAt": now,
        }))
    }

    async fn resume_session_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_idle()?;
        self.close_persistent_query(Some("Resuming a Claude Code session."))
            .await?;
        let sdk = inner.load_sdk()?;
        let thread_id = js::string_or_empty(request.get("threadId"));
        let info = sdk
            .get_session_info(&thread_id, Some(&inner.workspace_root))
            .await?;
        let Some((info, session_id)) = info.and_then(|info| {
            let id = text_field(&info, "sessionId")?;
            Some((info, id))
        }) else {
            return Err(agent_provider_session_unavailable_error(Some(
                "The saved Claude Code session is no longer available.",
            )));
        };
        *inner.session_id.borrow_mut() = Some(session_id.clone());
        inner.resuming.set(true);
        let title = ["customTitle", "summary"]
            .iter()
            .find_map(|key| info.get(*key).filter(|v| js::truthy(v)).cloned())
            .unwrap_or_else(|| Value::from("Claude Code session"));
        Ok(json!({
            "providerSessionId": session_id,
            "title": title,
            "model": Self::selection(&request, "model", Value::Null),
            "effort": Self::selection(&request, "effort", Value::Null),
            "mode": Self::selection(&request, "mode", Value::from("agent")),
            "createdAt": normalize_date(info.get("createdAt")),
            "updatedAt": normalize_date(info.get("lastModified")),
        }))
    }

    /// `adapter.readHistoryResult()`.
    pub async fn read_history_result(&self) -> AgentResult<Value> {
        let sdk = self.0.load_sdk()?;
        let session = self.session_id();
        read_claude_history(&*sdk, &self.0.workspace_root, session.as_deref()).await
    }

    /// `adapter.readHistory()`.
    pub async fn read_history(&self) -> AgentResult<Vec<Value>> {
        let result = self.read_history_result().await?;
        Ok(result["events"].as_array().cloned().unwrap_or_default())
    }

    async fn start_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        inner.assert_usable()?;
        if inner.active_turn_id.borrow().is_some() {
            return Err(AgentError::new("A Claude Code turn is already running."));
        }
        let sdk = inner.load_sdk()?;
        let project_instructions = (inner.project_instruction_loader)(&inner.workspace_root)?;
        let list = |key: &str| {
            request
                .get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        let all = list("references");
        let references = if all.is_empty() {
            [list("contextReferences"), list("attachments")].concat()
        } else {
            all
        };
        let content = build_claude_user_message_content(
            &js::string_or_empty(request.get("prompt")),
            &references,
            &inner.workspace_root,
        )?;
        let turn_id = format!("claude:{}", uuid::Uuid::new_v4());
        let controller = AbortController::new();
        let state = Rc::new(RefCell::new(ClaudeEventState::new(
            Some(&turn_id),
            inner.resuming.get(),
        )));
        let model = text_field(&request, "model");
        let profile = model
            .as_ref()
            .and_then(|model| inner.model_profiles.borrow().get(model).cloned());
        let effort = compatible_claude_effort(
            profile.as_ref(),
            request.get("effort").and_then(Value::as_str),
        )?;
        let mode = match request.get("mode") {
            None => Some("agent".to_string()),
            Some(mode) => mode.as_str().map(str::to_string),
        };
        self.ensure_persistent_query(
            &*sdk,
            &controller,
            model,
            effort,
            mode,
            project_instructions,
        )
        .await?;
        *inner.active_turn_id.borrow_mut() = Some(turn_id.clone());
        *inner.active_state.borrow_mut() = Some(state);
        inner.interrupt_requested.set(false);
        let session = inner.session_id.borrow().clone().unwrap_or_default();
        let channel = inner.message_channel.borrow().clone();
        if let Some(channel) = channel {
            channel.set_session_id(&session);
            channel.enqueue(create_claude_user_message(&content, &session)?)?;
        }
        Ok(json!({ "turnId": turn_id }))
    }

    async fn interrupt_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let turn_id = request.get("turnId").and_then(Value::as_str);
        if inner
            .active_turn_id
            .borrow()
            .as_deref()
            .is_none_or(|active| Some(active) != turn_id)
        {
            return Err(AgentError::new(
                "That Claude Code turn is no longer running.",
            ));
        }
        inner.interrupt_requested.set(true);
        let query = inner.active_query.borrow().clone();
        if let Some(query) = query {
            // Keep the long-lived query connected. `interrupt()` stops only
            // the active native turn; AgentService force-terminates the
            // process if it never confirms the interruption.
            let _ = tokio::time::timeout(Duration::from_millis(1_000), query.interrupt()).await;
        }
        Ok(Value::Null)
    }

    async fn fork_session_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let Some(session_id) = self.session_id() else {
            return Err(AgentError::new("No Claude Code session is active."));
        };
        let sdk = inner.load_sdk()?;
        let forked = sdk
            .fork_session(
                &session_id,
                ForkSessionOptions {
                    dir: Some(inner.workspace_root.clone()),
                    up_to_message_id: text_field(&request, "messageId"),
                    title: None,
                },
            )
            .await?;
        self.close_persistent_query(Some("Forking the Claude Code session."))
            .await?;
        Ok(json!({ "providerSessionId": forked.get("sessionId").cloned().unwrap_or(Value::Null) }))
    }

    /// `adapter.dispose(reason)`.
    pub async fn dispose_with(&self, reason: Option<&str>) -> AgentResult<()> {
        let inner = &self.0;
        if inner.disposed.replace(true) {
            return Ok(());
        }
        let reason = reason.unwrap_or("Claude Code adapter closed.");
        inner.interrupt_requested.set(true);
        claude_resolve_pending(&inner.pending, reason);
        self.close_persistent_query(Some(reason)).await?;
        inner.clear_active();
        Ok(())
    }

    /// `#consumePersistent(query, channel)`.
    async fn consume_persistent(self, query: Rc<dyn ClaudeQuery>, channel: ClaudeMessageChannel) {
        let inner = &self.0;
        let mut exit_reported = false;
        loop {
            let message = match query.next().await {
                None => break,
                Some(Ok(message)) => message,
                Some(Err(error)) => {
                    exit_reported |= self.report_stream_failure(&query, &error);
                    break;
                }
            };
            if inner.disposed.get() || !inner.is_active_query(&query) {
                // `return` from `for await` closes the native query.
                query.close();
                break;
            }
            if let Some(id) = message
                .get("session_id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            {
                let current = inner.session_id.borrow().clone();
                if current.as_deref().is_some_and(|current| current != id) {
                    let error = AgentError::new(
                        "Claude Code returned a different native session identity.",
                    );
                    exit_reported |= self.report_stream_failure(&query, &error);
                    query.close();
                    break;
                }
                *inner.session_id.borrow_mut() = Some(id.to_string());
                inner.resuming.set(true);
            }
            channel.set_session_id(&inner.session_id.borrow().clone().unwrap_or_default());
            let Some(state) = inner.active_state.borrow().clone() else {
                continue;
            };
            let normalized = normalize_claude_message(&message, &mut state.borrow_mut());
            let interrupted = inner.interrupt_requested.get();
            for event in normalized {
                let output = if interrupted
                    && matches!(
                        event["type"].as_str(),
                        Some("turn.completed" | "turn.failed")
                    ) {
                    let payload = js::with(&event["payload"], "status", "interrupted");
                    js::with(
                        &js::with(&event, "type", "turn.interrupted"),
                        "payload",
                        payload,
                    )
                } else {
                    event
                };
                (inner.on_event)(output);
            }
            let still_active = inner
                .active_state
                .borrow()
                .as_ref()
                .is_some_and(|active| Rc::ptr_eq(active, &state));
            if state.borrow().terminal && still_active {
                drop(inner.persistence_reporter.confirm());
                channel.on_turn_complete();
                inner.clear_active();
            }
        }
        if inner.is_active_query(&query) {
            let state = inner.active_state.borrow().clone();
            if !inner.disposed.get()
                && state.is_some_and(|state| !state.borrow().terminal)
                && !exit_reported
            {
                (inner.on_exit)(json!({
                    "expected": false,
                    "error": "Claude Code stream ended without a native result.",
                }));
            }
            claude_resolve_pending(
                &inner.pending,
                "Claude Code query closed before the request was resolved.",
            );
            channel.close();
            *inner.active_query.borrow_mut() = None;
            *inner.active_controller.borrow_mut() = None;
            *inner.message_channel.borrow_mut() = None;
            *inner.query_configuration_key.borrow_mut() = None;
            *inner.query_consumer.borrow_mut() = None;
            inner.clear_active();
        }
    }

    /// The consumer's `catch`: a stream failure is a lost observation, not a
    /// native terminal result.
    fn report_stream_failure(&self, query: &Rc<dyn ClaudeQuery>, error: &AgentError) -> bool {
        let inner = &self.0;
        let state = inner.active_state.borrow().clone();
        let Some(state) = state else {
            return false;
        };
        if inner.disposed.get() || !inner.is_active_query(query) || state.borrow().terminal {
            return false;
        }
        let turn_id = state.borrow().turn_id.clone();
        (inner.on_event)(json!({
            "type": "provider.error",
            "providerSessionId": inner.session_id.borrow().clone(),
            "turnId": turn_id,
            "itemId": null,
            "payload": { "message": redact_secret_text(&error.message), "recoverable": true },
        }));
        (inner.on_exit)(json!({
            "expected": false,
            "error": "Claude Code stream ended without a native result.",
        }));
        true
    }

    /// `#ensurePersistentQuery({ … })`.
    async fn ensure_persistent_query(
        &self,
        sdk: &dyn ClaudeSdk,
        controller: &AbortController,
        model: Option<String>,
        effort: Option<String>,
        mode: Option<String>,
        project_instructions: Option<Value>,
    ) -> AgentResult<()> {
        let inner = &self.0;
        let configuration_key = js::stringify(
            &Obj::new()
                .set("model", model.clone())
                .set("effort", effort.clone())
                .opt("mode", mode.clone())
                .set(
                    "instructions",
                    project_instruction_identity(project_instructions.as_ref()),
                )
                .build(),
        );
        let active = inner.active_query.borrow().clone();
        if let Some(active) = active
            && inner.query_configuration_key.borrow().as_deref() == Some(configuration_key.as_str())
        {
            active.set_model(model.filter(|m| !m.is_empty())).await?;
            active
                .set_permission_mode(
                    if mode.as_deref() == Some("plan") {
                        "plan"
                    } else {
                        "default"
                    }
                    .into(),
                )
                .await?;
            return Ok(());
        }
        self.close_persistent_query(Some("Claude Code query configuration changed."))
            .await?;
        let channel = ClaudeMessageChannel::new({
            let logger = inner.logger.clone();
            Rc::new(move |message: &str| {
                if let Some(logger) = logger.as_ref() {
                    logger(message);
                }
            })
        });
        let session = inner.session_id.borrow().clone();
        channel.set_session_id(session.as_deref().unwrap_or(""));
        let resuming = inner.resuming.get();
        let query = sdk.query(
            Rc::new(channel.clone()),
            self.query_options(
                controller,
                QuerySelection {
                    model,
                    effort,
                    mode,
                    resume: if resuming { session.clone() } else { None },
                    session_id: if resuming { None } else { session },
                    project_instructions,
                },
            ),
        )?;
        *inner.active_controller.borrow_mut() = Some(controller.clone());
        *inner.active_query.borrow_mut() = Some(query.clone());
        *inner.message_channel.borrow_mut() = Some(channel.clone());
        *inner.query_configuration_key.borrow_mut() = Some(configuration_key);
        let consumer = shared(self.clone().consume_persistent(query.clone(), channel));
        *inner.query_consumer.borrow_mut() = Some(consumer.clone());
        spawn(consumer);
        let initialized = with_timeout(
            query.initialization_result(),
            INSPECTION_TIMEOUT_MS,
            "Claude Code startup timed out.",
        )
        .await
        .and_then(|_| {
            if !inner.is_active_query(&query) || inner.disposed.get() {
                Err(AgentError::new(
                    "Claude Code query closed during initialization.",
                ))
            } else {
                Ok(())
            }
        });
        if let Err(error) = initialized {
            self.close_persistent_query(Some("Claude Code startup failed."))
                .await?;
            return Err(error);
        }
        Ok(())
    }

    /// `#closePersistentQuery(reason)`.
    async fn close_persistent_query(&self, reason: Option<&str>) -> AgentResult<()> {
        let inner = &self.0;
        let query = inner.active_query.borrow_mut().take();
        let controller = inner.active_controller.borrow_mut().take();
        *inner.query_configuration_key.borrow_mut() = None;
        let channel = inner.message_channel.borrow_mut().take();
        if let Some(channel) = channel {
            channel.close();
        }
        if let Some(controller) = controller.as_ref() {
            controller.abort(AgentError::new("This operation was aborted").with_name("AbortError"));
        }
        if let Some(query) = query {
            query.close();
        }
        let consumer = inner.query_consumer.borrow().clone();
        if let Some(consumer) = consumer {
            let _ = tokio::time::timeout(Duration::from_millis(1_000), consumer).await;
        }
        *inner.query_consumer.borrow_mut() = None;
        if let Some(controller) = controller {
            inner.spawn.wait_for_exit(Some(controller.signal())).await?;
        }
        if let Some(reason) = reason
            && !inner.pending.is_empty()
        {
            claude_resolve_pending(&inner.pending, reason);
        }
        Ok(())
    }
}

impl AgentRuntimeAdapter for ClaudeAgentSdkAdapter {
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
            "resolveApproval"
                | "resolveQuestion"
                | "forkSession"
                | "referenceMentionDelivery"
                | "getSessionHistoryPort"
        )
    }
    fn resolve_approval(&self, request: Value) -> AdapterFuture<'_, Value> {
        let result = claude_resolve_approval(&*self.0, &request).map(|()| Value::Null);
        Box::pin(async move { result })
    }
    fn resolve_question(&self, request: Value) -> AdapterFuture<'_, Value> {
        let result = claude_resolve_question(&*self.0, &request).map(|()| Value::Null);
        Box::pin(async move { result })
    }
    fn fork_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.fork_session_inner(request))
    }
    fn reference_mention_delivery(&self, _reference: &Value) -> Option<&'static str> {
        Some("path")
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(ClaudeHistoryPort(self.clone())))
    }
}

/// `adapter.getSessionHistoryPort()`.
struct ClaudeHistoryPort(ClaudeAgentSdkAdapter);

impl SessionHistoryPort for ClaudeHistoryPort {
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
        Box::pin(async move {
            self.0
                .discover_sessions(cursor.as_deref(), Some(&Value::from(limit)), Some(&signal))
                .await
        })
    }
    fn hydrate(&self, _signal: AbortSignal) -> AdapterFuture<'_, Value> {
        Box::pin(self.0.read_history_result())
    }
}

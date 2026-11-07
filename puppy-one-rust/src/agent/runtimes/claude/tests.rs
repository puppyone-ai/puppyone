//! `tests/unit/agent/runtimes/claude/electron.claude-adapter.test.mjs`,
//! `electron.claude-events.test.mjs`, `electron.claude-spawn.test.mjs` and
//! `tests/integration/agent/runtimes/claude/electron.claude-prompt-input.test.mjs`.
use super::claude_agent_sdk::{
    ClaudeQuery, ClaudeSdk, ForkSessionOptions, ListSessionsOptions, PermissionOptions,
    PromptSource, QueryOptions, SessionMessagesOptions, SpawnClaudeCodeProcess, SpawnOptions,
    SystemPrompt,
};
use super::claude_agent_sdk_adapter::{
    ClaudeAdapterOptions, ClaudeAgentSdkAdapter, format_claude_prompt,
};
use super::claude_events::{ClaudeEventState, normalize_claude_history, normalize_claude_message};
use super::claude_message_channel::create_claude_user_message;
use super::claude_prompt_input::{
    CLAUDE_NATIVE_IMAGE_MAX_BYTES, build_claude_user_message_content,
};
use super::claude_spawn::{ClaudeSpawn, ClaudeSpawnOptions};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::tests_support::run_local;
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::runtime::agent_runtime_port::{
    AgentRuntimeAdapter, is_agent_provider_session_unavailable_error,
};
use crate::agent::tasks::{CancelSignal, Canceller};
use crate::agent::transports::jsonl_rpc_connection::{ConnectionOptions, ProcessIo, Spawner};
use base64::Engine;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use tokio::sync::oneshot;

type Events = Rc<RefCell<Vec<Value>>>;

/// `vi.waitFor(callback)`.
async fn wait_for(mut condition: impl FnMut() -> bool) {
    for _ in 0..2_000 {
        if condition() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    }
    panic!("condition was not met");
}

// ---------------------------------------------------------------------------
// Fake Agent SDK.

type QueryFactory = Box<dyn FnMut(Rc<dyn PromptSource>, &QueryOptions) -> Rc<dyn ClaudeQuery>>;

struct FakeSdk {
    query: RefCell<Option<QueryFactory>>,
    calls: RefCell<Vec<QueryOptions>>,
    sessions: Option<Vec<Value>>,
    list_calls: RefCell<Vec<ListSessionsOptions>>,
    session_info: Option<Value>,
}

impl FakeSdk {
    fn new(query: Option<QueryFactory>) -> Rc<Self> {
        Rc::new(Self {
            query: RefCell::new(query),
            calls: RefCell::default(),
            sessions: None,
            list_calls: RefCell::default(),
            session_info: None,
        })
    }

    fn options(&self, index: usize) -> QueryOptions {
        self.calls.borrow()[index].clone()
    }
}

impl ClaudeSdk for FakeSdk {
    fn query(
        &self,
        prompt: Rc<dyn PromptSource>,
        options: QueryOptions,
    ) -> AgentResult<Rc<dyn ClaudeQuery>> {
        self.calls.borrow_mut().push(options.clone());
        let mut factory = self.query.borrow_mut();
        let factory = factory.as_mut().expect("query is not expected");
        Ok(factory(prompt, &options))
    }
    fn implements(&self, name: &str) -> bool {
        name != "listSessions" || self.sessions.is_some()
    }
    fn list_sessions(
        &self,
        options: ListSessionsOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>> {
        self.list_calls.borrow_mut().push(options);
        let sessions = self.sessions.clone().unwrap_or_default();
        Box::pin(async move { Ok(sessions) })
    }
    fn get_session_info(
        &self,
        _session_id: &str,
        _dir: Option<&str>,
    ) -> LocalBoxFuture<'static, AgentResult<Option<Value>>> {
        let info = self.session_info.clone();
        Box::pin(async move { Ok(info) })
    }
    fn get_session_messages(
        &self,
        _session_id: &str,
        _options: SessionMessagesOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn fork_session(
        &self,
        _session_id: &str,
        _options: ForkSessionOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async { Err(AgentError::new("fork is not expected")) })
    }
}

/// `inspectionQuery(account)`.
#[derive(Default)]
struct InspectionQuery {
    account: Value,
    closed: Cell<usize>,
}

impl ClaudeQuery for InspectionQuery {
    fn next(&self) -> LocalBoxFuture<'static, Option<AgentResult<Value>>> {
        Box::pin(async { None })
    }
    fn initialization_result(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let account = self.account.clone();
        Box::pin(async move {
            Ok(json!({
                "account": account,
                "models": [{ "value": "claude-sonnet", "displayName": "Sonnet", "description": "Fast", "supportedEffortLevels": ["low", "high"] }],
                "commands": [{ "name": "review", "description": "Review changes", "argumentHint": "" }],
            }))
        })
    }
    fn set_model(&self, _model: Option<String>) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
    fn set_permission_mode(&self, _mode: String) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
    fn interrupt(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
    fn close(&self) {
        self.closed.set(self.closed.get() + 1);
    }
}

fn api_key_account() -> Value {
    json!({
        "email": "user@example.test",
        "subscriptionType": "api",
        "apiProvider": "firstParty",
        "apiKeySource": "environment",
    })
}

fn inspection_query(account: Value) -> Rc<InspectionQuery> {
    Rc::new(InspectionQuery {
        account,
        closed: Cell::new(0),
    })
}

type Gate = oneshot::Sender<Result<String, AgentError>>;

/// `persistentQueryController()`: an async generator that yields `init`,
/// then three messages per user message once the test finishes the turn.
#[derive(Default)]
struct PersistentState {
    input: RefCell<Option<Rc<dyn PromptSource>>>,
    native_id: RefCell<Option<String>>,
    messages: RefCell<Vec<Value>>,
    gate: RefCell<Option<Gate>>,
    buffer: RefCell<std::collections::VecDeque<Value>>,
    started: Cell<bool>,
    done: Cell<bool>,
    initialization_calls: Cell<usize>,
    set_model_calls: RefCell<Vec<Option<String>>>,
    closes: Cell<usize>,
}

#[derive(Clone, Default)]
struct PersistentQuery(Rc<PersistentState>);

impl PersistentQuery {
    fn connect(&self, prompt: Rc<dyn PromptSource>, options: &QueryOptions) -> Rc<dyn ClaudeQuery> {
        *self.0.input.borrow_mut() = Some(prompt);
        *self.0.native_id.borrow_mut() = options.resume.clone().or(options.session_id.clone());
        Rc::new(self.clone())
    }

    fn messages(&self) -> Vec<Value> {
        self.0.messages.borrow().clone()
    }

    fn finish(&self, text: &str) {
        let gate = self
            .0
            .gate
            .borrow_mut()
            .take()
            .expect("No Claude turn is waiting for completion.");
        let _ = gate.send(Ok(text.to_string()));
    }

    fn fail(&self, message: &str) {
        let gate = self.0.gate.borrow_mut().take().expect("a turn is waiting");
        let _ = gate.send(Err(AgentError::new(message)));
    }
}

impl ClaudeQuery for PersistentQuery {
    fn next(&self) -> LocalBoxFuture<'static, Option<AgentResult<Value>>> {
        let state = self.0.clone();
        Box::pin(async move {
            if state.done.get() {
                return None;
            }
            let session = state.native_id.borrow().clone();
            if !state.started.replace(true) {
                return Some(Ok(json!({
                    "type": "system", "subtype": "init", "session_id": session,
                    "model": "claude-sonnet", "permissionMode": "default",
                })));
            }
            if let Some(message) = state.buffer.borrow_mut().pop_front() {
                return Some(Ok(message));
            }
            let input = state.input.borrow().clone()?;
            let Some(message) = input.next().await else {
                state.done.set(true);
                return None;
            };
            state.messages.borrow_mut().push(message);
            let (sender, receiver) = oneshot::channel();
            *state.gate.borrow_mut() = Some(sender);
            let text = match receiver.await {
                Ok(Ok(text)) => text,
                Ok(Err(error)) => {
                    state.done.set(true);
                    return Some(Err(error));
                }
                Err(_) => {
                    state.done.set(true);
                    return None;
                }
            };
            let id = format!("assistant-{}", state.messages.borrow().len());
            let mut buffer = state.buffer.borrow_mut();
            buffer.push_back(json!({
                "type": "assistant", "session_id": session, "uuid": id,
                "message": { "content": [{ "type": "text", "text": text }] },
            }));
            buffer.push_back(json!({
                "type": "result", "subtype": "success", "session_id": session,
                "usage": {}, "num_turns": 1,
            }));
            Some(Ok(json!({
                "type": "stream_event", "session_id": session, "uuid": id,
                "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": text } },
            })))
        })
    }
    fn initialization_result(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        self.0
            .initialization_calls
            .set(self.0.initialization_calls.get() + 1);
        Box::pin(async { Ok(json!({ "models": [], "commands": [], "account": {} })) })
    }
    fn set_model(&self, model: Option<String>) -> LocalBoxFuture<'static, AgentResult<()>> {
        self.0.set_model_calls.borrow_mut().push(model);
        Box::pin(async { Ok(()) })
    }
    fn set_permission_mode(&self, _mode: String) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
    fn interrupt(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
    fn close(&self) {
        self.0.closes.set(self.0.closes.get() + 1);
    }
}

struct Fixture {
    adapter: ClaudeAgentSdkAdapter,
    events: Events,
    exits: Events,
}

impl Fixture {
    fn of(&self, kind: &str) -> Vec<Value> {
        self.events
            .borrow()
            .iter()
            .filter(|e| e["type"] == kind)
            .cloned()
            .collect()
    }
}

fn create_adapter(
    sdk: Rc<FakeSdk>,
    environment: Value,
    instructions: Option<Rc<RefCell<Option<Value>>>>,
) -> Fixture {
    let (events, exits): (Events, Events) = (Rc::default(), Rc::default());
    let mut options = ClaudeAdapterOptions::new(
        json!({
            "status": "ready",
            "source": "user-installed",
            "version": "2.1.0",
            "executablePath": "/tools/claude",
            "environment": environment,
        }),
        "/workspace",
    );
    options.app_version = "1.2.3".into();
    options.sdk_loader = Some(Rc::new(move || Ok(sdk.clone() as Rc<dyn ClaudeSdk>)));
    let (sink, exit_sink) = (events.clone(), exits.clone());
    options.on_event = Rc::new(move |event| sink.borrow_mut().push(event));
    options.on_exit = Rc::new(move |info| exit_sink.borrow_mut().push(info));
    let instructions = instructions.unwrap_or_else(|| Rc::new(RefCell::new(Some(json!([])))));
    options.project_instruction_loader = Some(Rc::new(move |_root: &str| {
        Ok(instructions.borrow().clone())
    }));
    options.spawn_claude_code_process = Some(Rc::new(NoSpawn));
    Fixture {
        adapter: ClaudeAgentSdkAdapter::new(options),
        events,
        exits,
    }
}

fn default_environment() -> Value {
    json!({ "PATH": "/usr/bin", "HOME": "/home/test", "ANTHROPIC_API_KEY": "test-key" })
}

/// `spawnClaudeCodeProcess: vi.fn()`.
struct NoSpawn;

impl SpawnClaudeCodeProcess for NoSpawn {
    fn launch(&self, _options: SpawnOptions) -> AgentResult<ProcessIo> {
        Err(AgentError::new("spawn is not expected"))
    }
}

fn persistent_sdk(controllers: Vec<PersistentQuery>) -> Rc<FakeSdk> {
    let index = Rc::new(Cell::new(0));
    FakeSdk::new(Some(Box::new(move |prompt, options| {
        let controller = controllers[index.get()].clone();
        index.set(index.get() + 1);
        controller.connect(prompt, options)
    })))
}

#[test]
fn keeps_an_unexpected_sdk_stream_failure_distinct_from_a_native_terminal_result() {
    run_local(async {
        let controller = PersistentQuery::default();
        let sdk = persistent_sdk(vec![controller.clone()]);
        let fixture = create_adapter(sdk.clone(), default_environment(), None);
        let created = fixture.adapter.create_session(json!({})).await.unwrap();
        let id = created["providerSessionId"].as_str().unwrap().to_string();
        assert!(regex::Regex::new(r"^[a-f0-9-]{36}$").unwrap().is_match(&id));
        fixture
            .adapter
            .start_turn(json!({ "prompt": "Hello" }))
            .await
            .unwrap();
        assert_eq!(sdk.options(0).session_id.as_deref(), Some(id.as_str()));
        wait_for(|| controller.messages().len() == 1).await;
        controller.fail("Stream disconnected");
        wait_for(|| {
            fixture
                .exits
                .borrow()
                .iter()
                .any(|exit| exit["expected"] == false)
        })
        .await;
        assert!(!fixture.events.borrow().iter().any(|event| matches!(
            event["type"].as_str(),
            Some("turn.failed" | "turn.interrupted" | "turn.completed")
        )));
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn discovers_workspace_sessions_through_the_native_sdk_metadata_api() {
    run_local(async {
        let sdk = Rc::new(FakeSdk {
            query: RefCell::new(None),
            calls: RefCell::default(),
            sessions: Some(vec![json!({
                "sessionId": "claude-native",
                "summary": "Review auth",
                "customTitle": "Auth review",
                "createdAt": 1_788_000_000_000i64,
                "lastModified": 1_788_000_100_000i64,
                "cwd": "/workspace",
            })]),
            list_calls: RefCell::default(),
            session_info: None,
        });
        let fixture = create_adapter(sdk.clone(), default_environment(), None);
        let page = fixture
            .adapter
            .discover_sessions(Some("20"), Some(&json!(20)), None)
            .await
            .unwrap();
        assert_eq!(page["supported"], true);
        assert_eq!(
            page["coverage"],
            json!({ "scopeComplete": false, "snapshotId": null })
        );
        assert_eq!(page["nextCursor"], Value::Null);
        let sessions = page["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["providerSessionId"], "claude-native");
        assert_eq!(sessions[0]["title"], "Auth review");
        assert_eq!(
            sdk.list_calls.borrow()[0],
            ListSessionsOptions {
                dir: Some("/workspace".into()),
                limit: Some(20),
                offset: Some(20),
                include_worktrees: None,
            }
        );
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn maps_only_authorized_live_workspace_references_into_the_native_prompt() {
    assert_eq!(
        format_claude_prompt(
            "Review",
            &[
                json!({ "kind": "workspace-entry", "path": "/workspace/src/app.ts" }),
                json!({ "kind": "workspace-entry", "path": "/workspace/src" }),
                json!({ "kind": "staged-attachment", "path": "/private/staging/image.snapshot" }),
                json!({ "kind": "workspace-entry", "path": "/outside/secret.txt" }),
            ],
            "/workspace",
        ),
        [
            "Review",
            "",
            "Authorized context files for this turn:",
            "- /workspace/src/app.ts",
            "- /workspace/src",
        ]
        .join("\n")
    );
}

fn inspection_sdk(query: Rc<InspectionQuery>) -> Rc<FakeSdk> {
    FakeSdk::new(Some(Box::new(move |_prompt, _options| {
        query.clone() as Rc<dyn ClaudeQuery>
    })))
}

#[test]
fn inspects_the_native_account_model_catalog_with_user_only_settings_and_the_claude_code_prompt() {
    run_local(async {
        let query = inspection_query(api_key_account());
        let sdk = inspection_sdk(query.clone());
        let fixture = create_adapter(sdk.clone(), default_environment(), None);
        let inspection = fixture.adapter.inspect().await.unwrap();
        assert_eq!(
            inspection["account"]["account"],
            json!({ "type": "firstParty", "email": "user@example.test", "planType": "api" })
        );
        assert_eq!(inspection["account"]["requiresRuntimeSetup"], false);
        assert_eq!(inspection["models"][0]["model"], "claude-sonnet");
        assert_eq!(inspection["models"][0]["variants"], json!(["low", "high"]));
        let capabilities = &inspection["capabilities"];
        assert_eq!(capabilities["manualApprovals"], true);
        assert_eq!(capabilities["structuredQuestions"], true);
        assert_eq!(capabilities["fork"], true);
        assert_eq!(
            capabilities["revision"],
            "claude-agent-sdk:0.3.159:claude-code:2.1.0"
        );
        assert_eq!(
            capabilities["protocol"],
            json!({ "name": "claude-agent-sdk", "version": "0.3.159", "agentVersion": "2.1.0" })
        );
        let options = sdk.options(0);
        assert_eq!(options.setting_sources, Some(vec!["user".to_string()]));
        assert_eq!(
            options.system_prompt,
            Some(SystemPrompt::Preset {
                preset: "claude_code".into(),
                append: None,
            })
        );
        assert_eq!(options.permission_mode.as_deref(), Some("default"));
        assert!(query.closed.get() > 0);
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn does_not_route_third_party_product_traffic_through_claude_subscription_oauth() {
    run_local(async {
        let query = inspection_query(json!({
            "email": "subscriber@example.test",
            "subscriptionType": "pro",
            "apiProvider": "firstParty",
            "tokenSource": "oauth",
        }));
        let fixture = create_adapter(
            inspection_sdk(query),
            json!({ "PATH": "/usr/bin", "HOME": "/home/test" }),
            None,
        );
        let inspection = fixture.adapter.inspect().await.unwrap();
        assert_eq!(inspection["account"]["account"], Value::Null);
        assert_eq!(inspection["account"]["requiresRuntimeSetup"], true);
        assert!(
            inspection["account"]["error"]
                .as_str()
                .unwrap()
                .contains("subscription OAuth cannot be used")
        );
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn classifies_a_missing_native_conversation_as_an_unavailable_saved_session() {
    run_local(async {
        let fixture = create_adapter(FakeSdk::new(None), default_environment(), None);
        let error = fixture
            .adapter
            .resume_session(json!({ "threadId": "claude-stale" }))
            .await
            .unwrap_err();
        assert!(is_agent_provider_session_unavailable_error(&error));
        fixture.adapter.dispose().await.unwrap();
    });
}

fn completed(fixture: &Fixture, turn_id: &Value) -> bool {
    fixture
        .of("turn.completed")
        .iter()
        .any(|event| event["turnId"] == *turn_id)
}

#[test]
fn keeps_one_native_sdk_query_alive_across_follow_up_turns() {
    run_local(async {
        let controller = PersistentQuery::default();
        let inspection = inspection_query(api_key_account());
        let calls = Rc::new(Cell::new(0));
        let sdk = FakeSdk::new(Some(Box::new({
            let (controller, calls) = (controller.clone(), calls.clone());
            move |prompt, options| {
                calls.set(calls.get() + 1);
                if calls.get() == 1 {
                    inspection.clone() as Rc<dyn ClaudeQuery>
                } else {
                    controller.connect(prompt, options)
                }
            }
        })));
        let fixture = create_adapter(sdk.clone(), default_environment(), None);
        fixture.adapter.inspect().await.unwrap();
        fixture
            .adapter
            .create_session(json!({ "model": "claude-sonnet", "effort": "high", "mode": "agent" }))
            .await
            .unwrap();
        let unsafe_reference = fixture
            .adapter
            .start_turn(json!({
                "prompt": "Unsafe",
                "contextReferences": [{ "kind": "workspace-entry", "path": "/outside/secret.txt" }],
            }))
            .await
            .unwrap_err();
        let unsupported = regex::Regex::new(r"(?i)unsupported|unauthorized").unwrap();
        assert!(unsupported.is_match(&unsafe_reference.message));
        let staged = fixture
            .adapter
            .start_turn(json!({
                "prompt": "Unsupported",
                "attachments": [{ "kind": "staged-attachment", "path": "/private/staging/image.snapshot" }],
            }))
            .await
            .unwrap_err();
        assert!(unsupported.is_match(&staged.message));

        let first = fixture
            .adapter
            .start_turn(json!({
                "prompt": "First",
                "model": "claude-sonnet",
                "effort": "high",
                "mode": "agent",
                "contextReferences": [{ "path": "/workspace/src/app.ts" }],
            }))
            .await
            .unwrap();
        wait_for(|| controller.messages().len() == 1).await;
        controller.finish("First answer");
        wait_for(|| completed(&fixture, &first["turnId"])).await;

        let second = fixture
            .adapter
            .start_turn(json!({ "prompt": "Second", "model": "claude-sonnet", "effort": "high", "mode": "agent" }))
            .await
            .unwrap();
        wait_for(|| controller.messages().len() == 2).await;
        controller.finish("Second answer");
        wait_for(|| completed(&fixture, &second["turnId"])).await;

        assert_eq!(sdk.calls.borrow().len(), 2);
        assert_eq!(sdk.options(1).effort.as_deref(), Some("high"));
        assert_eq!(controller.0.initialization_calls.get(), 1);
        assert!(
            controller
                .0
                .set_model_calls
                .borrow()
                .contains(&Some("claude-sonnet".to_string()))
        );
        let messages = controller.messages();
        assert!(
            messages[0]["message"]["content"]
                .as_str()
                .unwrap()
                .contains("/workspace/src/app.ts")
        );
        assert_eq!(messages[1]["message"]["content"], "Second");
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn restarts_the_native_query_when_authorized_project_instructions_change_without_changing_size() {
    run_local(async {
        let controllers = vec![PersistentQuery::default(), PersistentQuery::default()];
        let sdk = persistent_sdk(controllers.clone());
        let instructions = Rc::new(RefCell::new(Some(
            json!({ "source": "AGENTS.md", "text": "alpha", "bytes": 5 }),
        )));
        let fixture = create_adapter(
            sdk.clone(),
            default_environment(),
            Some(instructions.clone()),
        );
        fixture
            .adapter
            .create_session(json!({ "model": "claude-sonnet", "mode": "agent" }))
            .await
            .unwrap();
        let first = fixture
            .adapter
            .start_turn(json!({ "prompt": "First", "model": "claude-sonnet", "mode": "agent" }))
            .await
            .unwrap();
        wait_for(|| controllers[0].messages().len() == 1).await;
        controllers[0].finish("First answer");
        wait_for(|| completed(&fixture, &first["turnId"])).await;

        *instructions.borrow_mut() =
            Some(json!({ "source": "AGENTS.md", "text": "bravo", "bytes": 5 }));
        let second = fixture
            .adapter
            .start_turn(json!({ "prompt": "Second", "model": "claude-sonnet", "mode": "agent" }))
            .await
            .unwrap();
        wait_for(|| controllers[1].messages().len() == 1).await;
        assert_eq!(sdk.calls.borrow().len(), 2);
        let append = |index: usize| match sdk.options(index).system_prompt {
            Some(SystemPrompt::Preset { append, .. }) => append.unwrap_or_default(),
            _ => String::new(),
        };
        assert!(append(0).contains("alpha"));
        assert!(append(1).contains("bravo"));
        controllers[1].finish("Second answer");
        wait_for(|| completed(&fixture, &second["turnId"])).await;
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn correlates_native_approvals_and_structured_questions_without_persisting_permission_changes() {
    run_local(async {
        let controller = PersistentQuery::default();
        let sdk = persistent_sdk(vec![controller.clone()]);
        let fixture = create_adapter(sdk.clone(), default_environment(), None);
        fixture
            .adapter
            .create_session(json!({ "model": "claude-sonnet", "mode": "agent" }))
            .await
            .unwrap();
        let turn = fixture
            .adapter
            .start_turn(json!({ "prompt": "Fix it", "model": "claude-sonnet", "mode": "agent" }))
            .await
            .unwrap();
        let turn_id = turn["turnId"].clone();
        wait_for(|| controller.messages().len() == 1).await;

        let can_use_tool = sdk.options(0).can_use_tool.unwrap();
        let approval = can_use_tool(
            "Bash".into(),
            json!({ "command": "npm test" }),
            PermissionOptions::from_json(
                &json!({
                    "toolUseID": "tool-1",
                    "title": "Allow command",
                    "suggestions": [
                        { "type": "addRules", "destination": "session", "rules": [], "behavior": "allow" },
                        { "type": "addRules", "destination": "localSettings", "rules": [], "behavior": "allow" },
                    ],
                }),
                None,
            ),
        );
        let requested = fixture.of("approval.requested");
        assert_eq!(requested.len(), 1);
        fixture
            .adapter
            .resolve_approval(json!({
                "requestId": requested[0]["payload"]["requestId"],
                "decision": "acceptForSession",
                "turnId": turn_id,
            }))
            .await
            .unwrap();
        let approval = approval.await.unwrap();
        assert_eq!(approval["behavior"], "allow");
        let updated = approval["updatedPermissions"].as_array().unwrap();
        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0]["destination"], "session");

        let question = can_use_tool(
            "AskUserQuestion".into(),
            json!({
                "questions": [{ "header": "Choice", "question": "Continue?", "multiSelect": false, "options": [{ "label": "Yes" }] }],
            }),
            PermissionOptions::from_json(&json!({ "toolUseID": "question-1" }), None),
        );
        let asked = fixture.of("question.requested");
        assert_eq!(asked.len(), 1);
        fixture
            .adapter
            .resolve_question(json!({
                "requestId": asked[0]["payload"]["requestId"],
                "answers": [["Yes"]],
                "rejected": false,
                "turnId": turn_id,
            }))
            .await
            .unwrap();
        let question = question.await.unwrap();
        assert_eq!(question["behavior"], "allow");
        assert_eq!(
            question["updatedInput"]["answers"],
            json!({ "Continue?": "Yes" })
        );
        assert_eq!(question.as_object().unwrap().len(), 2);

        controller.finish("Done");
        wait_for(|| completed(&fixture, &turn_id)).await;
        fixture.adapter.dispose().await.unwrap();
    });
}

// ---------------------------------------------------------------------------
// Claude Code event normalization.

fn types(events: &[Value]) -> Vec<&str> {
    events.iter().map(|e| e["type"].as_str().unwrap()).collect()
}

#[test]
fn normalizes_lifecycle_streaming_text_tools_usage_and_terminal_state() {
    let mut state = ClaudeEventState::new(Some("claude:turn-1"), false);
    let events: Vec<Value> = [
        json!({ "type": "system", "subtype": "init", "session_id": "session-1", "model": "sonnet", "permissionMode": "default", "claude_code_version": "2.0.0" }),
        json!({ "type": "stream_event", "uuid": "assistant-1", "session_id": "session-1", "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Hello" } } }),
        json!({ "type": "assistant", "uuid": "assistant-1", "session_id": "session-1", "message": { "content": [
            { "type": "text", "text": "Hello world" },
            { "type": "tool_use", "id": "tool-1", "name": "Bash", "input": { "command": "npm test", "description": "Run tests" } },
        ] } }),
        json!({ "type": "user", "uuid": "user-tool-1", "session_id": "session-1", "message": { "content": [
            { "type": "tool_result", "tool_use_id": "tool-1", "content": "passed" },
        ] } }),
        json!({ "type": "result", "subtype": "success", "session_id": "session-1", "usage": { "input_tokens": 10, "output_tokens": 5 }, "total_cost_usd": 0.01, "duration_ms": 100, "num_turns": 1 }),
    ]
    .iter()
    .flat_map(|message| normalize_claude_message(message, &mut state))
    .collect();
    assert_eq!(
        types(&events),
        [
            "session.started",
            "assistant.delta",
            "assistant.completed",
            "tool.started",
            "tool.completed",
            "usage.updated",
            "turn.completed",
        ]
    );
    let started = events.iter().find(|e| e["type"] == "tool.started").unwrap();
    let payload = &started["payload"];
    assert_eq!(payload["kind"], "command");
    assert_eq!(payload["tool"], "bash");
    assert_eq!(payload["label"], "Run tests");
    assert_eq!(payload["command"], "npm test");
    assert_eq!(
        payload["input"],
        json!({ "command": "npm test", "description": "Run tests" })
    );
    let completed = events
        .iter()
        .find(|e| e["type"] == "turn.completed")
        .unwrap();
    assert_eq!(completed["payload"]["durationMs"], 100);
}

#[test]
fn preserves_native_read_write_edit_grep_and_glob_identity_across_tool_results() {
    let mut state = ClaudeEventState::new(Some("claude:turn-tools"), false);
    let tools = [
        json!({ "id": "read-1", "name": "Read", "input": { "file_path": "src/read.ts" } }),
        json!({ "id": "write-1", "name": "Write", "input": { "file_path": "src/write.ts", "content": "hello" } }),
        json!({ "id": "edit-1", "name": "Edit", "input": { "file_path": "src/edit.ts", "old_string": "old", "new_string": "new" } }),
        json!({ "id": "grep-1", "name": "Grep", "input": { "pattern": "needle", "path": "src" } }),
        json!({ "id": "glob-1", "name": "Glob", "input": { "pattern": "**/*.ts", "path": "src" } }),
    ];
    let started = normalize_claude_message(
        &json!({
            "type": "assistant", "uuid": "assistant-tools", "session_id": "session-1",
            "message": { "content": tools.iter().map(|tool| crate::agent::contract::js::with(tool, "type", "tool_use")).collect::<Vec<_>>() },
        }),
        &mut state,
    );
    let completed = normalize_claude_message(
        &json!({
            "type": "user", "uuid": "tool-results", "session_id": "session-1",
            "message": { "content": tools.iter().map(|tool| json!({
                "type": "tool_result", "tool_use_id": tool["id"], "content": format!("{} result", tool["name"].as_str().unwrap()),
            })).collect::<Vec<_>>() },
        }),
        &mut state,
    );
    let field = |events: &[Value], key: &str| -> Vec<String> {
        events
            .iter()
            .map(|e| e["payload"][key].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        field(&started, "tool"),
        ["read", "write", "edit", "grep", "glob"]
    );
    assert_eq!(
        field(&started, "kind"),
        ["read", "file-change", "file-change", "search", "search"]
    );
    assert_eq!(started[2]["payload"]["path"], "src/edit.ts");
    assert_eq!(started[2]["payload"]["input"]["old_string"], "old");
    assert_eq!(started[2]["payload"]["input"]["new_string"], "new");
    assert_eq!(
        field(&completed, "tool"),
        ["read", "write", "edit", "grep", "glob"]
    );
    assert_eq!(completed[3]["payload"]["kind"], "search");
    assert_eq!(
        completed[3]["payload"]["input"],
        json!({ "pattern": "needle", "path": "src" })
    );
}

#[test]
fn reconstructs_bounded_historical_turns_from_native_session_messages() {
    let events = normalize_claude_history(
        &[
            json!({ "type": "user", "uuid": "user-1", "message": { "content": [{ "type": "text", "text": "Fix it" }] } }),
            json!({ "type": "assistant", "uuid": "assistant-1", "message": { "content": [{ "type": "text", "text": "Done" }] } }),
        ],
        "session-1",
    );
    assert_eq!(types(&events), ["turn.started", "assistant.completed"]);
    assert_eq!(events[0]["payload"]["prompt"], "Fix it");
    assert_eq!(events[1]["payload"]["text"], "Done");
}

#[test]
fn shows_a_working_state_boundary_without_republishing_hidden_chain_of_thought() {
    let mut state = ClaudeEventState::new(Some("claude:turn-1"), false);
    let thinking = |text: &str| {
        json!({
            "type": "stream_event", "uuid": "assistant-1", "session_id": "session-1",
            "event": { "type": "content_block_delta", "delta": { "type": "thinking_delta", "thinking": text } },
        })
    };
    let first = normalize_claude_message(&thinking("private reasoning"), &mut state);
    let second = normalize_claude_message(&thinking("more private reasoning"), &mut state);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0]["type"], "reasoning.summary.delta");
    assert_eq!(
        first[0]["payload"],
        json!({ "delta": "", "boundary": true })
    );
    assert!(second.is_empty());
    assert!(
        !serde_json::to_string(&first)
            .unwrap()
            .contains("private reasoning")
    );
}

#[test]
fn normalizes_api_retries_as_replaceable_connection_state_instead_of_transcript_warnings() {
    let mut state = ClaudeEventState::new(Some("claude:turn-retry"), false);
    let retry = normalize_claude_message(
        &json!({
            "type": "system", "subtype": "api_retry", "session_id": "session-1",
            "error": "Connection timed out", "attempt": 3, "max_retries": 5, "retry_delay_ms": 250,
        }),
        &mut state,
    );
    assert_eq!(retry[0]["type"], "provider.connection.updated");
    assert_eq!(retry[0]["turnId"], "claude:turn-retry");
    assert_eq!(
        retry[0]["payload"],
        json!({
            "state": "reconnecting",
            "message": "Connection timed out",
            "attempt": 3,
            "maxAttempts": 5,
            "retryDelayMs": 250,
        })
    );
}

// ---------------------------------------------------------------------------
// Claude Code spawn hook.

#[derive(Clone, Default)]
struct FakeChildren {
    launched: Rc<RefCell<Vec<ConnectionOptions>>>,
    kills: Rc<RefCell<Vec<Vec<bool>>>>,
    exits: Rc<RefCell<Vec<Option<oneshot::Sender<()>>>>>,
}

impl FakeChildren {
    fn spawner(&self) -> Spawner {
        let children = self.clone();
        Rc::new(move |options: &ConnectionOptions| {
            children.launched.borrow_mut().push(options.clone());
            let index = children.kills.borrow().len();
            children.kills.borrow_mut().push(Vec::new());
            let (sender, receiver) = oneshot::channel();
            children.exits.borrow_mut().push(Some(sender));
            let kills = children.kills.clone();
            let (stdin, _stdin_peer) = tokio::io::duplex(1024);
            let (_stdout_peer, stdout) = tokio::io::duplex(1024);
            Ok(ProcessIo {
                stdin: Box::new(stdin),
                stdout: Box::new(stdout),
                stderr: Box::new(tokio::io::empty()),
                exit: Box::pin(async move {
                    let _ = receiver.await;
                    (Some(0), None, None)
                }),
                kill: Rc::new(move |force| {
                    kills.borrow_mut()[index].push(force);
                    true
                }),
                pid: None,
            })
        })
    }

    /// `child.emit("close", 0, null)`.
    async fn close(&self, index: usize) {
        if let Some(sender) = self.exits.borrow_mut()[index].take() {
            let _ = sender.send(());
        }
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }
}

fn spawn_options(
    command: &str,
    args: &[&str],
    env: &[(&str, &str)],
    signal: CancelSignal,
) -> SpawnOptions {
    SpawnOptions {
        command: command.into(),
        args: args.iter().map(|a| a.to_string()).collect(),
        cwd: Some("/workspace".into()),
        env: env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<EnvMap>(),
        signal,
    }
}

#[test]
fn routes_node_backed_cli_entrypoints_through_an_absolute_node_executable() {
    run_local(async {
        let children = FakeChildren::default();
        let launch = ClaudeSpawn::new(ClaudeSpawnOptions {
            spawn: Some(children.spawner()),
            is_executable: Some(Rc::new(|path: &Path| {
                path == Path::new("/runtime/bin/node")
            })),
            ..Default::default()
        });
        launch
            .launch(spawn_options(
                "/tools/claude/cli.js",
                &["--output-format", "stream-json"],
                &[("PATH", "/runtime/bin")],
                CancelSignal::default(),
            ))
            .unwrap();
        let launched = children.launched.borrow()[0].clone();
        assert_eq!(launched.executable_path, PathBuf::from("/runtime/bin/node"));
        assert_eq!(
            launched.args,
            ["/tools/claude/cli.js", "--output-format", "stream-json"]
        );
        assert_eq!(launched.cwd, PathBuf::from("/workspace"));
    });
}

#[test]
fn closes_every_owned_process_and_waits_for_exit_before_releasing_the_sdk_adapter() {
    run_local(async {
        let children = FakeChildren::default();
        let launch = ClaudeSpawn::new(ClaudeSpawnOptions {
            spawn: Some(children.spawner()),
            ..Default::default()
        });
        let controller = Canceller::new();
        launch
            .launch(spawn_options(
                "/tools/claude",
                &[],
                &[],
                controller.signal(),
            ))
            .unwrap();
        launch
            .launch(spawn_options(
                "/tools/claude",
                &[],
                &[],
                CancelSignal::default(),
            ))
            .unwrap();
        controller.cancel(AgentError::new("aborted"));
        assert_eq!(children.kills.borrow()[0], [false]);
        let closed = Rc::new(Cell::new(false));
        let disposing = {
            let (launch, closed) = (launch.clone(), closed.clone());
            tokio::task::spawn_local(async move {
                launch.dispose().await.unwrap();
                closed.set(true);
            })
        };
        tokio::task::yield_now().await;
        children.close(0).await;
        assert!(!closed.get());
        assert_eq!(children.kills.borrow()[1], [false]);
        children.close(1).await;
        disposing.await.unwrap();
        assert!(closed.get());
        let error = launch
            .launch(spawn_options(
                "/tools/claude",
                &[],
                &[],
                CancelSignal::default(),
            ))
            .err()
            .unwrap();
        assert!(error.message.contains("owner has closed"));
        launch.dispose().await.unwrap();
    });
}

#[test]
fn rejects_relative_commands_and_control_characters_before_spawning() {
    run_local(async {
        let children = FakeChildren::default();
        let launch = ClaudeSpawn::new(ClaudeSpawnOptions {
            spawn: Some(children.spawner()),
            is_executable: Some(Rc::new(|_: &Path| false)),
            ..Default::default()
        });
        let relative = launch
            .launch(spawn_options(
                "claude",
                &[],
                &[("PATH", "/usr/bin")],
                CancelSignal::default(),
            ))
            .err()
            .unwrap();
        assert!(relative.message.contains("absolute validated path"));
        let unsafe_argument = launch
            .launch(spawn_options(
                "/tools/claude",
                &["--model\nunsafe"],
                &[],
                CancelSignal::default(),
            ))
            .err()
            .unwrap();
        assert!(unsafe_argument.message.contains("arguments are invalid"));
        assert!(children.launched.borrow().is_empty());
    });
}

// ---------------------------------------------------------------------------
// Claude Agent SDK native reference mapping.

fn temporary_root() -> tempfile::TempDir {
    let root = tempfile::Builder::new()
        .prefix("puppyone-claude-input-")
        .tempdir()
        .unwrap();
    for directory in ["workspace/src", "workspace-a", "workspace-b"] {
        std::fs::create_dir_all(root.path().join(directory)).unwrap();
    }
    root
}

fn path(root: &tempfile::TempDir, relative: &str) -> String {
    root.path().join(relative).to_string_lossy().into_owned()
}

#[test]
fn combines_workspace_path_context_with_a_native_structured_image_block() {
    let root = temporary_root();
    let source = path(&root, "outside.png");
    let png = [137u8, 80, 78, 71, 13, 10, 26, 10];
    std::fs::write(&source, png).unwrap();
    let content = build_claude_user_message_content(
        "Review both",
        &[
            json!({ "kind": "workspace-entry", "path": path(&root, "workspace/src/app.ts"), "mime": "text/typescript" }),
            json!({ "kind": "staged-attachment", "path": source, "name": "outside.png", "mime": "image/png" }),
        ],
        &path(&root, "workspace"),
    )
    .unwrap();
    let blocks = content.as_array().unwrap();
    assert_eq!(blocks[0]["type"], "text");
    assert!(
        blocks[0]["text"]
            .as_str()
            .unwrap()
            .contains(&path(&root, "workspace/src/app.ts"))
    );
    assert_eq!(
        blocks[1],
        json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": base64::engine::general_purpose::STANDARD.encode(png),
            },
        })
    );
    let message = create_claude_user_message(&content, "claude-session").unwrap();
    assert_eq!(message["type"], "user");
    assert_eq!(message["session_id"], "claude-session");
    assert_eq!(
        message["message"],
        json!({ "role": "user", "content": content })
    );
}

#[test]
fn accepts_an_authorized_external_file_path_mention_and_rejects_cross_workspace_paths() {
    let root = temporary_root();
    let markdown = path(&root, "notes.md");
    std::fs::write(&markdown, "notes").unwrap();
    let prompt = format!("Review `{markdown}`");
    let content = build_claude_user_message_content(
        &prompt,
        &[json!({
            "authorized": true, "kind": "staged-attachment", "path": markdown, "name": "notes.md",
            "mime": "text/markdown", "inlineMentioned": true, "mentionDelivery": "path",
        })],
        &path(&root, "workspace-a"),
    )
    .unwrap();
    assert_eq!(content, Value::from(prompt));
    let error = build_claude_user_message_content(
        "Review",
        &[json!({ "kind": "workspace-entry", "path": path(&root, "workspace-b/secret.png"), "mime": "image/png" })],
        &path(&root, "workspace-a"),
    )
    .unwrap_err();
    assert_eq!(error.code.as_deref(), Some("REFERENCE_UNAUTHORIZED"));
}

#[test]
fn enforces_claudes_native_per_image_bound_before_base64_expansion() {
    let root = temporary_root();
    let oversized = path(&root, "oversized.png");
    let file = std::fs::File::create(&oversized).unwrap();
    file.set_len(CLAUDE_NATIVE_IMAGE_MAX_BYTES + 1).unwrap();
    let error = build_claude_user_message_content(
        "Review",
        &[json!({ "kind": "staged-attachment", "path": oversized, "name": "oversized.png", "mime": "image/png" })],
        &path(&root, "workspace"),
    )
    .unwrap_err();
    assert_eq!(
        error.code.as_deref(),
        Some("REFERENCE_MATERIALIZATION_FAILED")
    );
}

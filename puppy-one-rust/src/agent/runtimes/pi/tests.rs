//! `tests/integration/agent/runtimes/pi/electron.pi-adapter.test.mjs` and
//! `tests/unit/agent/runtimes/pi/electron.pi-discovery.test.mjs`.
use super::pi_discovery::{PiDiscoveryOptions, discover_pi_executable};
use super::pi_identity::PI_RUNTIME_DESCRIPTOR;
use super::pi_rpc_adapter::pi_rpc_adapter;
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests_support::run_local;
use crate::agent::domain::agent_session_actor::{ActorOptions, AgentSessionActor, EventInput};
use crate::agent::protocols::pi_rpc::pi_rpc_client::fake::FakePiClient;
use crate::agent::protocols::pi_rpc::pi_rpc_client::{PiClient, PiClientFactory};
use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::{
    PiAdapterOptions, PiRpcRuntimeAdapter,
};
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::platform::common::command_environment::{EnvMap, EnvironmentSnapshot};
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::os::unix::fs::PermissionsExt;
use std::rc::Rc;

type Events = Rc<RefCell<Vec<Value>>>;
type Clients = Rc<RefCell<Vec<Rc<FakePiClient>>>>;

struct Fixture {
    adapter: PiRpcRuntimeAdapter,
    clients: Clients,
    events: Events,
    exits: Events,
    reports: Events,
    disposed: Rc<Cell<usize>>,
}

fn fixture() -> Fixture {
    fixture_with_exit_gate(None)
}

fn fixture_with_exit_gate(gate: Option<Rc<tokio::sync::Notify>>) -> Fixture {
    let clients: Clients = Rc::default();
    let (events, exits, reports): (Events, Events, Events) =
        (Rc::default(), Rc::default(), Rc::default());
    let disposed = Rc::new(Cell::new(0));
    let mut options = PiAdapterOptions::new(
        json!({
            "executablePath": "/usr/local/bin/pi",
            "environment": {},
            "version": "0.84.3",
            "source": "user-installed",
            "compatibility": "pi-rpc-v1",
        }),
        "/workspace",
        PI_RUNTIME_DESCRIPTOR.clone(),
        String::new(),
    );
    let (sink, exit_sink, report_sink, count) = (
        events.clone(),
        exits.clone(),
        reports.clone(),
        disposed.clone(),
    );
    options.on_event = Rc::new(move |event| sink.borrow_mut().push(event));
    options.on_exit = Rc::new(move |info| exit_sink.borrow_mut().push(info));
    options.on_session_persisted = Some(Rc::new(move |identity| {
        report_sink.borrow_mut().push(identity)
    }));
    options.on_dispose = Some(Rc::new(move || count.set(count.get() + 1)));
    let recorded = clients.clone();
    let factory: PiClientFactory = Rc::new(move |options| {
        let client = FakePiClient::new(options);
        *client.exit_gate.borrow_mut() = gate.clone();
        recorded.borrow_mut().push(client.clone());
        Ok(client as Rc<dyn PiClient>)
    });
    options.client_factory = Some(factory);
    Fixture {
        adapter: pi_rpc_adapter(options).unwrap(),
        clients,
        events,
        exits,
        reports,
        disposed,
    }
}

impl Fixture {
    fn client(&self, index: usize) -> Rc<FakePiClient> {
        self.clients.borrow()[index].clone()
    }

    fn of(&self, kind: &str) -> Vec<Value> {
        self.events
            .borrow()
            .iter()
            .filter(|e| e["type"] == kind)
            .cloned()
            .collect()
    }

    fn terminal(&self) -> Vec<Value> {
        self.events
            .borrow()
            .iter()
            .filter(|e| {
                matches!(
                    e["type"].as_str(),
                    Some("turn.completed" | "turn.failed" | "turn.interrupted")
                )
            })
            .cloned()
            .collect()
    }
}

#[test]
fn keeps_extension_notices_out_of_tools_and_execution_state() {
    run_local(async {
        for severity in ["info", "warning", "error"] {
            let fixture = fixture();
            let mut actor = AgentSessionActor::new(ActorOptions::default()).unwrap();
            fixture.adapter.create_session(json!({})).await.unwrap();
            fixture
                .adapter
                .start_turn(json!({ "prompt": "Hello" }))
                .await
                .unwrap();
            let client = fixture.client(0);
            client.emit(json!({ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "Hello " } }));
            client.emit(json!({ "type": "extension_ui_request", "method": "notify", "id": "notice-1", "notifyType": severity, "message": "Extension message" }));
            client.emit(json!({ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "again." } }));
            for event in fixture.events.borrow().iter() {
                actor
                    .append_event(EventInput {
                        session_id: "test-session".into(),
                        runtime_id: "pi".into(),
                        provider_session_id: Some("pi-session".into()),
                        event: event.clone(),
                    })
                    .unwrap();
            }
            let display = actor.display();
            let assistant: Vec<Value> = display
                .messages
                .iter()
                .filter(|m| m["role"] == "assistant")
                .map(|m| m["text"].clone())
                .collect();
            assert_eq!(assistant, [json!("Hello again.")]);
            assert_eq!(display.activities.len(), 1);
            assert_eq!(display.activities[0]["kind"], "notification");
            assert_eq!(display.activities[0]["label"], "Extension message");
            assert_eq!(display.activities[0]["detail"]["severity"], severity);
            assert!(!display.rows.iter().any(|row| row["kind"] == "tool"));
            assert_eq!(actor.control()["execution"]["status"], "active");
            assert_eq!(fixture.of("provider.notification").len(), 1);
            fixture.adapter.dispose().await.unwrap();
        }
    });
}

#[test]
fn completes_a_turn_after_native_model_retries_recover_instead_of_retaining_an_earlier_fetch_failure()
 {
    run_local(async {
        let fixture = fixture();
        fixture.adapter.create_session(json!({})).await.unwrap();
        let turn = fixture
            .adapter
            .start_turn(json!({ "prompt": "Hello" }))
            .await
            .unwrap();
        let failed = json!({ "role": "assistant", "content": [], "stopReason": "error", "errorMessage": "fetch failed" });
        let answer = json!({ "role": "assistant", "content": [{ "type": "text", "text": "Hello!" }], "stopReason": "stop" });
        let client = fixture.client(0);
        for attempt in [1, 2] {
            client.emit(json!({ "type": "message_end", "message": failed }));
            client.emit(json!({ "type": "agent_end", "messages": [failed], "willRetry": true }));
            client.emit(json!({ "type": "auto_retry_start", "attempt": attempt, "maxAttempts": 3, "errorMessage": "fetch failed" }));
        }
        client.emit(json!({ "type": "message_end", "message": answer }));
        client.emit(json!({ "type": "auto_retry_end", "success": true, "attempt": 2 }));
        client.emit(json!({ "type": "agent_end", "messages": [answer], "willRetry": false }));
        assert!(fixture.terminal().is_empty());
        client.emit(json!({ "type": "agent_settled" }));
        let terminal = fixture.terminal();
        assert_eq!(terminal.len(), 1);
        assert_eq!(terminal[0]["type"], "turn.completed");
        assert_eq!(terminal[0]["turnId"], turn["turnId"]);
        assert!(fixture.of("provider.error").is_empty());
        assert!(
            fixture
                .adapter
                .start_turn(json!({ "prompt": "Next" }))
                .await
                .unwrap()["turnId"]
                .is_string()
        );
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn does_not_invent_a_failed_turn_when_native_prompt_delivery_is_unknown() {
    run_local(async {
        let fixture = fixture();
        fixture.adapter.create_session(json!({})).await.unwrap();
        *fixture.client(0).intercept.borrow_mut() = Some(Rc::new(|kind, _| {
            (kind == "prompt").then(|| {
                let mut lost = AgentError::new("Pipe lost");
                lost.delivery_outcome = Some("unknown".into());
                Box::pin(async move { Err(lost) })
                    as futures_util::future::LocalBoxFuture<'static, _>
            })
        }));
        let error = fixture
            .adapter
            .start_turn(json!({ "prompt": "Hello" }))
            .await
            .unwrap_err();
        assert_eq!(error.delivery_outcome.as_deref(), Some("unknown"));
        assert!(fixture.terminal().is_empty());
        assert!(fixture.exits.borrow().is_empty());
        assert!(fixture.of("turn.started").is_empty());
        assert!(
            fixture
                .adapter
                .start_turn(json!({ "prompt": "must not duplicate" }))
                .await
                .unwrap_err()
                .message
                .contains("already running")
        );
        let client = fixture.client(0);
        client.emit(json!({ "type": "agent_start" }));
        assert!(fixture.of("turn.started")[0]["payload"]["clientUserMessageId"].is_string());
        client.emit(json!({ "type": "message_end", "message": { "role": "assistant", "content": [], "stopReason": "stop" } }));
        client.emit(json!({ "type": "agent_settled" }));
        assert_eq!(fixture.of("turn.completed").len(), 1);
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn does_not_mark_an_unsent_prompt_uncertain_when_the_preflight_state_read_times_out() {
    run_local(async {
        let fixture = fixture();
        fixture.adapter.create_session(json!({})).await.unwrap();
        let first = Rc::new(Cell::new(true));
        *fixture.client(0).intercept.borrow_mut() = Some(Rc::new(move |_, _| {
            first.replace(false).then(|| {
                let mut timeout = AgentError::new("State read timed out");
                timeout.delivery_outcome = Some("unknown".into());
                Box::pin(async move { Err(timeout) })
                    as futures_util::future::LocalBoxFuture<'static, _>
            })
        }));
        let error = fixture
            .adapter
            .start_turn(json!({ "prompt": "Not yet sent" }))
            .await
            .unwrap_err();
        assert_eq!(error.delivery_outcome, None);
        assert!(fixture.of("turn.started").is_empty());
        assert!(
            !fixture
                .client(0)
                .calls
                .borrow()
                .iter()
                .any(|(kind, _)| kind == "prompt")
        );
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn owns_inspection_processes_until_os_exit_including_shutdown_during_inspection() {
    run_local(async {
        let gate = Rc::new(tokio::sync::Notify::new());
        let fixture = fixture_with_exit_gate(Some(gate.clone()));
        let inspection = {
            let adapter = fixture.adapter.clone();
            tokio::task::spawn_local(async move { adapter.inspect().await })
        };
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        assert!(fixture.client(0).closed.get());
        let disposed = Rc::new(Cell::new(false));
        let closing = {
            let (adapter, disposed) = (fixture.adapter.clone(), disposed.clone());
            tokio::task::spawn_local(async move {
                adapter.dispose().await.unwrap();
                disposed.set(true);
            })
        };
        tokio::task::yield_now().await;
        assert!(!disposed.get());
        assert!(fixture.adapter.has_active_process());
        // The inspection and the shutdown each wait for the one process exit.
        gate.notify_waiters();
        inspection.await.unwrap().unwrap();
        closing.await.unwrap();
        assert!(!fixture.adapter.has_active_process());
    });
}

#[test]
fn reports_persistence_only_from_the_exact_native_session_artifact_and_includes_its_source() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let fixture = fixture();
        fixture.adapter.create_session(json!({})).await.unwrap();
        let file = directory.path().join("session.jsonl");
        std::fs::write(&file, "native fixture\n").unwrap();
        fixture.client(0).state.borrow_mut()["sessionFile"] = json!(file.to_string_lossy());
        fixture
            .adapter
            .start_turn(json!({ "prompt": "Hello" }))
            .await
            .unwrap();
        fixture.client(0).emit(json!({ "type": "agent_settled" }));
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
        let source = fixture
            .adapter
            .session_history_port()
            .unwrap()
            .source_scope_id()
            .unwrap();
        assert_eq!(
            *fixture.reports.borrow(),
            [json!({ "providerSessionId": "pi-session", "sourceScopeId": source })]
        );
        fixture.adapter.dispose().await.unwrap();
    });
}

#[test]
fn discovers_pi_owned_providers_models_reasoning_levels_and_commands() {
    run_local(async {
        let fixture = fixture();
        let inspection = fixture.adapter.inspect().await.unwrap();
        assert_eq!(fixture.client(0).options.args, ["--no-session"]);
        assert_eq!(inspection["runtime"]["id"], "pi");
        assert_eq!(
            inspection["runtime"]["protocol"],
            json!({ "kind": "rpc", "transport": "stdio-jsonl" })
        );
        assert_eq!(inspection["providers"].as_array().unwrap().len(), 1);
        assert_eq!(inspection["providers"][0]["id"], "openai-codex");
        assert_eq!(inspection["providers"][0]["modelCount"], 1);
        assert_eq!(
            inspection["providers"][0]["defaultModel"],
            "openai-codex/gpt-5.6-sol"
        );
        let model = &inspection["models"][0];
        assert_eq!(model["model"], "openai-codex/gpt-5.6-sol");
        assert_eq!(model["isDefault"], true);
        assert_eq!(
            model["variants"],
            json!(["off", "low", "medium", "high", "xhigh"])
        );
        assert_eq!(model["defaultVariant"], "high");
        assert_eq!(inspection["commands"][0]["name"], "review");
        assert_eq!(inspection["commands"][0]["source"], "extension");
        let capabilities = &inspection["capabilities"];
        assert_eq!(capabilities["streamingText"], true);
        assert_eq!(capabilities["modelSelection"], true);
        assert_eq!(capabilities["structuredQuestions"], true);
        assert_eq!(
            capabilities["protocol"],
            json!({ "name": "pi-rpc", "version": 1, "agentVersion": "0.84.3" })
        );
        assert_eq!(
            capabilities["referenceInputs"]["attachments"]["image"]["accepted"],
            true
        );
        assert_eq!(
            capabilities["referenceInputs"]["attachments"]["binary"]["accepted"],
            true
        );
        crate::agent::runtime::agent_runtime_port::assert_agent_runtime_inspection(
            &fixture.adapter,
            &inspection,
            "pi",
        )
        .unwrap();
        assert_eq!(
            PiRpcRuntimeAdapter::mention_delivery(&json!({ "mime": "image/png" })),
            "resource"
        );
        assert_eq!(
            PiRpcRuntimeAdapter::mention_delivery(&json!({ "mime": "application/pdf" })),
            "path"
        );
        assert!(fixture.client(0).closed.get());
    });
}

#[test]
fn maps_one_native_pi_session_and_its_authoritative_settled_boundary_into_shared_events() {
    run_local(async {
        let fixture = fixture();
        let session = fixture
            .adapter
            .create_session(json!({ "model": "openai-codex/gpt-5.6-sol", "effort": "high" }))
            .await
            .unwrap();
        assert_eq!(session["providerSessionId"], "pi-session");
        assert_eq!(session["model"], "openai-codex/gpt-5.6-sol");
        assert_eq!(session["effort"], "high");
        let client = fixture.client(0);
        let turn = fixture
            .adapter
            .start_turn(json!({ "prompt": "Inspect it" }))
            .await
            .unwrap();
        client.emit(json!({ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "contentIndex": 0, "delta": "Done" } }));
        client.emit(json!({ "type": "tool_execution_start", "toolCallId": "tool-1", "toolName": "bash", "args": { "command": "pwd" } }));
        client.emit(json!({
            "type": "tool_execution_end", "toolCallId": "tool-1", "toolName": "bash",
            "result": { "content": [{ "type": "text", "text": "/workspace" }] }, "isError": false,
        }));
        client.emit(json!({ "type": "message_end", "message": { "role": "assistant", "content": [{ "type": "text", "text": "Done" }] } }));
        assert!(fixture.of("turn.completed").is_empty());
        client.emit(json!({ "type": "agent_settled" }));
        assert_eq!(fixture.of("turn.started")[0]["turnId"], turn["turnId"]);
        assert_eq!(
            fixture.of("assistant.delta")[0]["payload"],
            json!({ "delta": "Done" })
        );
        assert_eq!(fixture.of("tool.started")[0]["itemId"], "tool-1");
        assert_eq!(fixture.of("tool.completed")[0]["itemId"], "tool-1");
        assert_eq!(
            fixture.of("assistant.completed")[0]["payload"],
            json!({ "text": "Done" })
        );
        assert_eq!(
            fixture.of("turn.completed")[0]["payload"],
            json!({ "status": "completed" })
        );
        let prompt = client
            .calls
            .borrow()
            .iter()
            .find(|(kind, _)| kind == "prompt")
            .cloned()
            .unwrap();
        assert_eq!(prompt.1, json!({ "message": "Inspect it" }));
        fixture.adapter.dispose().await.unwrap();
        assert_eq!(fixture.disposed.get(), 1);
    });
}

#[test]
fn routes_pi_extension_dialogs_through_the_shared_structured_question_contract() {
    run_local(async {
        let fixture = fixture();
        fixture.adapter.create_session(json!({})).await.unwrap();
        let turn = fixture
            .adapter
            .start_turn(json!({ "prompt": "Ask me" }))
            .await
            .unwrap();
        let client = fixture.client(0);
        client.emit(json!({
            "type": "extension_ui_request", "id": "dialog-1", "method": "select",
            "title": "Pick a branch", "options": ["main", "release"],
        }));
        let question = fixture.of("question.requested")[0].clone();
        assert_eq!(question["turnId"], turn["turnId"]);
        assert_eq!(
            question["payload"]["questions"][0]["question"],
            "Pick a branch"
        );
        assert_eq!(
            question["payload"]["questions"][0]["options"],
            json!([{ "label": "main", "description": "" }, { "label": "release", "description": "" }])
        );
        fixture
            .adapter
            .resolve_question_now(
                &json!({ "requestId": question["payload"]["requestId"], "answers": [["release"]] }),
            )
            .unwrap();
        assert!(client.extension_responses.borrow().contains(
            &json!({ "type": "extension_ui_response", "id": "dialog-1", "value": "release" })
        ));
        fixture.adapter.dispose().await.unwrap();
    });
}

// ------------------------------------------------------------------ discovery

fn pi_executable(directory: &std::path::Path, help: &str) -> String {
    let path = directory.join("pi");
    std::fs::write(
        &path,
        format!("#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.84.3; else printf '%s\\n' '{help}'; fi\n"),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::canonicalize(&path)
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

fn discovery_options(configured: Option<String>) -> PiDiscoveryOptions {
    PiDiscoveryOptions {
        env: Some(EnvMap::from([("PATH".to_string(), String::new())])),
        platform: Some("darwin".into()),
        homedir: Some(std::path::PathBuf::from("/Users/test-nonexistent")),
        read_environment: Some(Rc::new(|env, _, _, _| {
            Box::pin(async move {
                Ok(EnvironmentSnapshot {
                    environment: env,
                    complete: true,
                    source: "provided".into(),
                    reason_code: None,
                })
            })
        })),
        configured_executable: configured,
        ..Default::default()
    }
}

#[test]
fn requires_the_installed_executable_to_expose_the_official_rpc_mode() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let executable = pi_executable(
            directory.path(),
            "Pi - AI coding assistant\n--mode <mode>  Output mode: text, json, or rpc",
        );
        let readiness = discover_pi_executable(discovery_options(Some(executable.clone())), None)
            .await
            .unwrap();
        for (key, value) in [
            ("runtimeId", json!("pi")),
            ("status", json!("ready")),
            ("code", json!("READY")),
            ("version", json!("0.84.3")),
            ("executablePath", json!(executable)),
            ("compatibility", json!("pi-rpc-v1")),
        ] {
            assert_eq!(readiness[key], value, "{key}");
        }
    });
}

#[test]
fn distinguishes_a_missing_runtime_from_an_installed_runtime_without_rpc_support() {
    run_local(async {
        let missing = discover_pi_executable(discovery_options(None), None)
            .await
            .unwrap();
        assert_eq!(missing["status"], "not-installed");
        assert_eq!(missing["code"], "RUNTIME_NOT_INSTALLED");
        let directory = tempfile::tempdir().unwrap();
        let executable = pi_executable(directory.path(), "Pi help");
        let unsupported = discover_pi_executable(discovery_options(Some(executable)), None)
            .await
            .unwrap();
        assert_eq!(unsupported["status"], "protocol-unavailable");
        assert_eq!(unsupported["code"], "PROTOCOL_UNAVAILABLE");
        assert_eq!(unsupported["compatibility"], "unavailable");
    });
}

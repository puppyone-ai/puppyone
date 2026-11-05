//! `tests/integration/agent/runtimes/puppyone-agent/electron.puppyone-pi-kernel.test.mjs`
//! (Main-side cases; the bundled worker itself is not ported) and the
//! model-connection binding surface.
use super::model_connection_binding::{
    ModelConnectionBinding, ModelConnectionPort, connection_models,
};
use super::puppyone_agent_adapter::PuppyOneAgentAdapter;
use super::puppyone_agent_approval::parse_puppyone_agent_approval_request;
use super::puppyone_agent_discovery::{
    PUPPYONE_AGENT_WORKER_PATH, PuppyOneDiscoveryOptions, discover_puppyone_agent_worker,
    parse_puppyone_worker_probe,
};
use super::puppyone_agent_environment::{
    build_puppyone_agent_environment, strip_puppyone_provider_credentials,
};
use super::puppyone_agent_identity::PUPPYONE_AGENT_RUNTIME_DESCRIPTOR;
use super::puppyone_agent_kernel::PUPPYONE_AGENT_APPROVAL_PROTOCOL;
use crate::agent::agent_error::AgentResult;
use crate::agent::application::tests_support::run_local;
use crate::agent::protocols::pi_rpc::pi_rpc_client::PiClient;
use crate::agent::protocols::pi_rpc::pi_rpc_client::fake::FakePiClient;
use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::PiAdapterOptions;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::transports::bounded_process_probe::ProbeResult;
use crate::platform::common::command_environment::EnvMap;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;

type Events = Rc<RefCell<Vec<Value>>>;

#[test]
fn discovers_only_the_bundled_exact_version_sdk_worker() {
    run_local(async {
        let app = tempfile::tempdir().unwrap();
        let user_data = tempfile::tempdir().unwrap();
        let worker = app.path().join(PUPPYONE_AGENT_WORKER_PATH);
        std::fs::create_dir_all(worker.parent().unwrap()).unwrap();
        std::fs::write(&worker, "// worker").unwrap();
        let probed: Rc<RefCell<Vec<Vec<String>>>> = Rc::default();
        let readiness = discover_puppyone_agent_worker(
            PuppyOneDiscoveryOptions {
                app_path: Some(app.path().to_string_lossy().into_owned()),
                user_data_path: Some(user_data.path().to_string_lossy().into_owned()),
                executable_path: Some("/application/puppyone".into()),
                probe: Some({
                    let probed = probed.clone();
                    Rc::new(move |run| {
                        probed.borrow_mut().push(run.args.clone());
                        Box::pin(async {
                            Ok(ProbeResult {
                                stdout: format!(
                                    "{}\n",
                                    json!({
                                        "schema": "puppyone-pi-worker-probe/v1",
                                        "product": "puppyone-agent",
                                        "version": "0.85.1",
                                        "protocol": "puppyone-pi-rpc-v1",
                                        "ready": true,
                                    })
                                ),
                                stderr: String::new(),
                                code: Some(0),
                                signal: None,
                            })
                        })
                    })
                }),
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(readiness["runtimeId"], "puppyone-agent");
        assert_eq!(readiness["source"], "bundled");
        assert_eq!(readiness["status"], "ready");
        assert_eq!(readiness["version"], "0.85.1");
        assert_eq!(readiness["compatibility"], "puppyone-pi-rpc-v1");
        let args = readiness["argsPrefix"].as_array().unwrap();
        assert_eq!(args.len(), 1);
        assert!(
            args[0]
                .as_str()
                .unwrap()
                .ends_with("puppyone-agent/worker/main.mjs")
        );
        assert_eq!(
            readiness["profilePath"],
            user_data
                .path()
                .join("agent-runtime/puppyone-agent")
                .to_string_lossy()
                .as_ref()
        );
        assert_eq!(probed.borrow()[0][1], "--probe");
    });
}

#[test]
fn reports_a_missing_or_mismatched_worker_as_an_unavailable_managed_kernel() {
    run_local(async {
        let user_data = tempfile::tempdir().unwrap();
        let missing = discover_puppyone_agent_worker(
            PuppyOneDiscoveryOptions {
                app_path: Some("/nonexistent/application".into()),
                user_data_path: Some(user_data.path().to_string_lossy().into_owned()),
                executable_path: Some("/application/puppyone".into()),
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(missing["status"], "error");
        assert_eq!(missing["code"], "RUNTIME_DISCOVERY_FAILED");
        assert!(parse_puppyone_worker_probe("{}\n{}").is_err());
        assert!(parse_puppyone_worker_probe(r#"{"schema":"other"}"#).is_err());
    });
}

#[test]
fn keeps_provider_credentials_but_strips_user_pi_and_puppyone_launch_overrides() {
    let environment = build_puppyone_agent_environment(
        &EnvMap::from([
            ("PATH".into(), "/usr/bin".into()),
            ("HOME".into(), "/Users/test".into()),
            ("OPENAI_API_KEY".into(), "provider-key".into()),
            ("INTERNAL_API_KEY".into(), "unrelated-key".into()),
            ("RELEASE_AUTH_TOKEN".into(), "unrelated-token".into()),
            (
                "DATABASE_CREDENTIALS".into(),
                "unrelated-credentials".into(),
            ),
            ("PI_CODING_AGENT_DIR".into(), "/untrusted/pi".into()),
            ("PUPPYONE_OPENCODE_BIN".into(), "/untrusted/opencode".into()),
            ("DEBUG".into(), "secret-debug".into()),
        ]),
        "/managed/puppyone",
        "darwin",
    )
    .unwrap();
    assert_eq!(environment["OPENAI_API_KEY"], "provider-key");
    assert_eq!(environment["PI_CODING_AGENT_DIR"], "/managed/puppyone/pi");
    assert_eq!(
        environment["PI_CODING_AGENT_SESSION_DIR"],
        "/managed/puppyone/sessions"
    );
    for key in [
        "PUPPYONE_OPENCODE_BIN",
        "INTERNAL_API_KEY",
        "RELEASE_AUTH_TOKEN",
        "DATABASE_CREDENTIALS",
        "DEBUG",
    ] {
        assert!(!environment.contains_key(key), "{key}");
    }
    assert_eq!(environment["ELECTRON_RUN_AS_NODE"], "1");
}

#[test]
fn removes_provider_credentials_from_model_callable_shell_subprocesses() {
    assert_eq!(
        strip_puppyone_provider_credentials(&EnvMap::from([
            ("PATH".into(), "/usr/bin".into()),
            ("OPENAI_API_KEY".into(), "provider-key".into()),
            ("AWS_SECRET_ACCESS_KEY".into(), "aws-secret".into()),
            ("PI_SESSION_ID".into(), "session-1".into()),
        ])),
        EnvMap::from([
            ("PATH".into(), "/usr/bin".into()),
            ("PI_SESSION_ID".into(), "session-1".into()),
        ])
    );
}

fn adapter_with(
    port: Option<Rc<dyn ModelConnectionPort>>,
) -> (
    PuppyOneAgentAdapter,
    Rc<RefCell<Vec<Rc<FakePiClient>>>>,
    Events,
) {
    let clients: Rc<RefCell<Vec<Rc<FakePiClient>>>> = Rc::default();
    let events: Events = Rc::default();
    let mut options = PiAdapterOptions::new(
        json!({
            "executablePath": "/application/puppyone",
            "argsPrefix": ["/application/worker.mjs"],
            "profilePath": "/profile/puppyone-agent",
            "environment": {},
            "source": "bundled",
            "version": "0.85.1",
            "compatibility": "puppyone-pi-rpc-v1",
        }),
        "/workspace",
        PUPPYONE_AGENT_RUNTIME_DESCRIPTOR.clone(),
        String::new(),
    );
    let sink = events.clone();
    options.on_event = Rc::new(move |event| sink.borrow_mut().push(event));
    options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
    let recorded = clients.clone();
    options.client_factory = Some(Rc::new(move |options| {
        let client = FakePiClient::new(options);
        *client.state.borrow_mut() = json!({
            "sessionId": "native-session-1",
            "sessionName": "PuppyOne session",
            "model": null,
            "thinkingLevel": "off",
        });
        recorded.borrow_mut().push(client.clone());
        Ok(client as Rc<dyn PiClient>)
    }));
    (
        PuppyOneAgentAdapter::new(options, port).unwrap(),
        clients,
        events,
    )
}

#[test]
fn maps_only_the_private_worker_confirm_into_a_correlated_shared_approval() {
    run_local(async {
        let (adapter, clients, events) = adapter_with(None);
        adapter.create_session(json!({})).await.unwrap();
        let turn = adapter
            .start_turn(json!({ "prompt": "Change it" }))
            .await
            .unwrap();
        let turn_id = turn["turnId"].clone();
        let client = clients.borrow().last().unwrap().clone();
        client.emit(json!({
            "type": "extension_ui_request",
            "id": "approval-rpc-1",
            "method": "confirm",
            "title": PUPPYONE_AGENT_APPROVAL_PROTOCOL,
            "message": json!({
                "schema": PUPPYONE_AGENT_APPROVAL_PROTOCOL,
                "toolCallId": "tool-1",
                "toolName": "bash",
                "kind": "command",
                "title": "Run command",
                "command": "npm test",
                "arguments": { "command": "npm test" },
                "scopeKey": "bash:test",
            })
            .to_string(),
        }));
        let approval = events
            .borrow()
            .iter()
            .find(|event| event["type"] == "approval.requested")
            .cloned()
            .unwrap();
        assert_eq!(approval["turnId"], turn_id);
        assert_eq!(approval["itemId"], "tool-1");
        assert_eq!(approval["payload"]["kind"], "command");
        assert_eq!(approval["payload"]["command"], "npm test");
        adapter
            .resolve_approval(json!({
                "requestId": approval["payload"]["requestId"],
                "decision": "acceptForSession",
                "turnId": turn_id,
            }))
            .await
            .unwrap();
        assert!(client.extension_responses.borrow().contains(&json!({
            "type": "extension_ui_response",
            "id": "approval-rpc-1",
            "confirmed": true,
        })));
        let repeated = adapter
            .resolve_approval(json!({
                "requestId": approval["payload"]["requestId"],
                "decision": "accept",
                "turnId": turn_id,
            }))
            .await
            .unwrap_err();
        assert!(repeated.message.contains("correlation"));
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn decodes_only_the_versioned_private_approval_envelope() {
    let request = |title: &str, message: Value| json!({ "method": "confirm", "title": title, "message": message.to_string() });
    assert!(parse_puppyone_agent_approval_request(&request("Other", json!({}))).is_none());
    assert!(
        parse_puppyone_agent_approval_request(&request(
            PUPPYONE_AGENT_APPROVAL_PROTOCOL,
            json!({ "schema": "other", "toolName": "bash" })
        ))
        .is_none()
    );
    let parsed = parse_puppyone_agent_approval_request(&request(
        PUPPYONE_AGENT_APPROVAL_PROTOCOL,
        json!({ "schema": PUPPYONE_AGENT_APPROVAL_PROTOCOL, "toolName": "write", "kind": "unknown", "allowSession": false }),
    ))
    .unwrap();
    assert_eq!(parsed["title"], "Allow write");
    assert_eq!(parsed["kind"], "tool");
    assert_eq!(parsed["allowSession"], false);
}

/// A spawner whose child answers every Pi RPC request successfully and
/// records each launch.
fn scripted_worker() -> (
    crate::agent::transports::jsonl_rpc_connection::Spawner,
    Rc<RefCell<Vec<crate::agent::transports::jsonl_rpc_connection::ConnectionOptions>>>,
    crate::agent::transports::test_support::FakeChild,
) {
    let (spawner, child) = crate::agent::transports::test_support::fake_spawner(true);
    let launched: Rc<RefCell<Vec<_>>> = Rc::default();
    let recorded = launched.clone();
    let responder = child.clone();
    let wrapped: crate::agent::transports::jsonl_rpc_connection::Spawner =
        Rc::new(move |options| {
            recorded.borrow_mut().push(options.clone());
            let io = spawner(options)?;
            let child = responder.clone();
            crate::agent::event_loop::spawn(async move {
                let mut answered = 0;
                loop {
                    let messages = child.messages();
                    for message in messages.iter().skip(answered) {
                        let data = match message["type"].as_str() {
                            Some("get_state") => json!({
                                "sessionId": "native-session-1",
                                "sessionName": "PuppyOne session",
                                "model": null,
                                "thinkingLevel": "off",
                            }),
                            Some("get_available_models") => json!({ "models": [] }),
                            Some("get_commands") => json!({ "commands": [] }),
                            Some("get_available_thinking_levels") => json!({ "levels": [] }),
                            _ => json!({}),
                        };
                        let response = json!({
                            "id": message["id"],
                            "type": "response",
                            "command": message["type"],
                            "success": true,
                            "data": data,
                        });
                        child.stdout(&format!("{response}\n")).await;
                    }
                    answered = messages.len();
                    tokio::task::yield_now().await;
                    if answered > 64 {
                        break;
                    }
                }
            });
            Ok(io)
        });
    (wrapped, launched, child)
}

fn adapter_with_spawner(
    port: Option<Rc<dyn ModelConnectionPort>>,
    spawner: crate::agent::transports::jsonl_rpc_connection::Spawner,
) -> (
    PuppyOneAgentAdapter,
    Rc<RefCell<Vec<Rc<FakePiClient>>>>,
    Events,
) {
    let events: Events = Rc::default();
    let mut options = PiAdapterOptions::new(
        json!({
            "executablePath": "/application/puppyone",
            "argsPrefix": ["/application/worker.mjs"],
            "profilePath": "/profile/puppyone-agent",
            "environment": { "PATH": "/usr/bin", "OPENAI_API_KEY": "provider-key" },
            "source": "bundled",
            "version": "0.85.1",
            "compatibility": "puppyone-pi-rpc-v1",
        }),
        "/workspace",
        PUPPYONE_AGENT_RUNTIME_DESCRIPTOR.clone(),
        String::new(),
    );
    let sink = events.clone();
    options.on_event = Rc::new(move |event| sink.borrow_mut().push(event));
    options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
    options.spawner = Some(spawner);
    (
        PuppyOneAgentAdapter::new(options, port).unwrap(),
        Rc::default(),
        events,
    )
}

const CONNECTION: &str = "mc_00000000-0000-4000-8000-000000000001";

struct FakePort {
    leases: RefCell<Vec<String>>,
    released: RefCell<Vec<String>>,
}

impl ModelConnectionPort for Rc<FakePort> {
    fn read(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async {
            Ok(json!({
                "schemaVersion": 1,
                "revision": 7,
                "connections": [{
                    "id": CONNECTION, "name": "Local Ollama", "driver": "ollama",
                    "configGeneration": 2, "defaultModelId": "qwen3",
                }],
                "catalogs": [{
                    "connectionId": CONNECTION, "status": "ready", "configGeneration": 2,
                    "models": [
                        { "id": "qwen3", "name": "Qwen 3", "available": true, "contextWindow": 32768,
                          "capabilities": { "text": "supported", "tools": "supported", "images": "unsupported" } },
                        { "id": "embed", "name": "Embed", "available": true, "contextWindow": 8192,
                          "capabilities": { "text": "supported", "tools": "unsupported" } },
                    ],
                }],
            }))
        })
    }
    fn acquire(&self, route: Option<String>) -> LocalBoxFuture<'static, AgentResult<Value>> {
        self.leases.borrow_mut().push(route.unwrap_or_default());
        Box::pin(async {
            Ok(json!({
                "leaseId": "lease-1",
                "configuration": {
                    "connectionId": CONNECTION,
                    "securityGeneration": 3,
                    "models": [{ "id": "qwen3", "capabilities": { "images": "unsupported" } }],
                },
            }))
        })
    }
    fn validate(
        &self,
        _lease_id: String,
        _route: Option<String>,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
    fn release(&self, lease_id: String) -> LocalBoxFuture<'static, AgentResult<()>> {
        self.released.borrow_mut().push(lease_id);
        Box::pin(async { Ok(()) })
    }
}

fn fake_port() -> Rc<FakePort> {
    Rc::new(FakePort {
        leases: RefCell::default(),
        released: RefCell::default(),
    })
}

#[test]
fn lists_only_current_text_and_tool_models_from_model_connections() {
    run_local(async {
        let port = fake_port();
        let snapshot = port.read().await.unwrap();
        let models = connection_models(&snapshot).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["model"], format!("{CONNECTION}/qwen3"));
        assert_eq!(models[0]["isDefault"], true);
        let (adapter, _, _) = adapter_with(Some(Rc::new(port.clone())));
        let inspection = adapter.inspect().await.unwrap();
        assert_eq!(inspection["account"]["requiresRuntimeSetup"], false);
        assert_eq!(inspection["providers"][0]["modelCount"], 1);
        assert_eq!(
            inspection["capabilities"]["revision"],
            "puppyone-model-connections:7"
        );
        assert_eq!(inspection["capabilities"]["modelConnections"], true);
        assert_eq!(
            inspection["capabilities"]["referenceInputs"]["attachments"]["image"]["accepted"],
            false
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn binds_one_connection_per_session_and_rejects_a_different_connection_or_image_model() {
    run_local(async {
        let port = fake_port();
        let binding = ModelConnectionBinding::new(Rc::new(port.clone()));
        let route = format!("{CONNECTION}/qwen3");
        binding.acquire(Some(&route)).await.unwrap();
        binding.acquire(Some(&route)).await.unwrap();
        assert_eq!(port.leases.borrow().len(), 1);
        let other = binding
            .validate(Some("mc_00000000-0000-4000-8000-000000000002/qwen3"))
            .await
            .unwrap_err();
        assert!(other.is("NEW_SESSION_REQUIRED"));
        let missing = binding
            .validate(Some(&format!("{CONNECTION}/missing")))
            .await
            .unwrap_err();
        assert!(missing.is("MODEL_UNAVAILABLE"));
        assert!(
            binding
                .enable_read_only()
                .unwrap_err()
                .is("AUTHORITY_REQUIRED")
        );
        binding.dispose().await.unwrap();
        assert_eq!(*port.released.borrow(), ["lease-1"]);
        assert!(
            binding
                .acquire(Some(&route))
                .await
                .unwrap_err()
                .is("LEASE_REVOKED")
        );

        let (spawner, launched, child) = scripted_worker();
        let (adapter, _, events) = adapter_with_spawner(Some(Rc::new(fake_port())), spawner);
        let created = adapter
            .create_session(json!({ "model": route }))
            .await
            .unwrap();
        assert_eq!(created["modelBindingRevision"], format!("{CONNECTION}:3"));
        assert_eq!(created["effort"], Value::Null);
        // The worker receives the lease configuration on its private pipe,
        // never through its environment.
        let launch = launched.borrow()[0].clone();
        let bootstrap: Value =
            serde_json::from_slice(launch.bootstrap.as_deref().unwrap()).unwrap();
        assert_eq!(bootstrap["connectionId"], CONNECTION);
        let env: EnvMap = launch.env.unwrap().into_iter().collect();
        assert_eq!(env["PUPPYONE_MODEL_CONNECTION_BOOTSTRAP"], "1");
        assert_eq!(env["PI_OFFLINE"], "1");
        assert!(!env.contains_key("OPENAI_API_KEY"));
        let image = adapter
            .start_turn(json!({
                "prompt": "Look",
                "model": route,
                "references": [{ "kind": "staged-attachment", "path": "/tmp/a.png", "mime": "image/png" }],
            }))
            .await
            .unwrap_err();
        assert!(image.is("MODEL_IMAGE_UNSUPPORTED"));
        assert!(
            events
                .borrow()
                .iter()
                .all(|event| event["type"] != "turn.started")
        );
        drop(child);
        adapter.dispose().await.unwrap();
    });
}

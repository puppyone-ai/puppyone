//! `tests/unit/agent/runtimes/acp/electron.hermes-acp-adapter.test.mjs`.
use super::hermes_acp_adapter::{hermes_acp_adapter, hermes_authentication_method};
use super::hermes_discovery::{
    HermesDiscoveryOptions, MINIMUM_HERMES_ACP_VERSION, build_hermes_environment,
    discover_hermes_executable, parse_hermes_version,
};
use super::hermes_history_source::hermes_history_source;
use super::hermes_identity::HERMES_RUNTIME_DESCRIPTOR;
use crate::agent::application::tests_support::run_local;
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::protocols::acp::acp_runtime_adapter::AcpAdapterOptions;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::transports::bounded_process_probe::ProbeResult;
use crate::agent::transports::jsonl_rpc_connection::ConnectionOptions;
use crate::agent::transports::rpc_connection::RpcConnection;
use crate::agent::transports::rpc_connection::fake::FakeConnection;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;

#[test]
fn selects_configured_agent_managed_credentials_without_invoking_terminal_setup() {
    assert_eq!(
        hermes_authentication_method(&[
            json!({ "id": "openrouter", "name": "OpenRouter runtime credentials" }),
            json!({ "id": "hermes-setup", "type": "terminal", "args": ["--setup"] }),
        ])
        .as_deref(),
        Some("openrouter")
    );
    assert_eq!(
        hermes_authentication_method(&[
            json!({ "id": "hermes-setup", "type": "terminal", "args": ["--setup"] })
        ]),
        None
    );
}

#[test]
fn scopes_native_history_to_hermes_home_without_exposing_its_path() {
    let environment = |pairs: Vec<(&'static str, &'static str)>| {
        move |key: &str| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        }
    };
    let standard = hermes_history_source(&environment(vec![("HOME", "/Users/test")]));
    let custom = hermes_history_source(&environment(vec![
        ("HOME", "/Users/test"),
        ("HERMES_HOME", "~/profiles/work"),
    ]));
    let scoped = regex::Regex::new(r"^local:[a-f0-9]{64}$").unwrap();
    assert!(scoped.is_match(&standard));
    assert!(scoped.is_match(&custom));
    assert_ne!(custom, standard);
    assert!(!custom.contains("profiles/work"));
}

fn hermes_connection() -> Rc<FakeConnection> {
    let connection = FakeConnection::new();
    connection.result(
        "initialize",
        json!({
            "protocolVersion": 1,
            "agentInfo": { "name": "Hermes Agent", "version": "0.16.0" },
            "agentCapabilities": {
                "loadSession": true,
                "sessionCapabilities": { "list": {}, "resume": {}, "fork": {} },
                "promptCapabilities": { "image": true },
            },
            "authMethods": [
                { "id": "openrouter", "name": "OpenRouter runtime credentials" },
                { "id": "hermes-setup", "name": "Configure Hermes provider", "type": "terminal", "args": ["--setup"] },
            ],
        }),
    );
    connection.result("authenticate", json!({}));
    connection.result(
        "session/new",
        json!({
            "sessionId": "hermes-session",
            "models": {
                "currentModelId": "openrouter:z-ai/glm-5.1",
                "availableModels": [
                    { "id": "openrouter:z-ai/glm-5.1", "name": "GLM 5.1" },
                    { "id": "custom:lab:qwen-2.5", "name": "Lab Qwen" },
                ],
            },
            "modes": {
                "currentModeId": "default",
                "availableModes": [
                    { "id": "default", "name": "Default" },
                    { "id": "accept_edits", "name": "Accept Edits" },
                    { "id": "dont_ask", "name": "Don't Ask" },
                ],
            },
        }),
    );
    connection.result("session/set_model", json!({}));
    connection.result("session/set_mode", json!({}));
    connection
}

/// `expect(actual).toMatchObject(expected)`.
fn assert_match(actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Object(actual_map), Value::Object(expected_map)) => {
            for (key, value) in expected_map {
                assert_match(actual_map.get(key).unwrap_or(&Value::Null), value);
            }
        }
        (Value::Array(actual_items), Value::Array(expected_items)) => {
            assert_eq!(
                actual_items.len(),
                expected_items.len(),
                "{actual} vs {expected}"
            );
            for (actual, expected) in actual_items.iter().zip(expected_items) {
                assert_match(actual, expected);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}

#[test]
fn uses_the_first_party_acp_server_and_native_model_and_mode_selection() {
    run_local(async {
        let connection = hermes_connection();
        let launches: Rc<RefCell<Vec<ConnectionOptions>>> = Rc::default();
        let mut options = AcpAdapterOptions::new(
            json!({
                "executablePath": "/tools/hermes",
                "argsPrefix": ["launcher"],
                "environment": { "HOME": "/Users/test", "PATH": "/usr/bin" },
                "version": "0.16.0",
                "source": "user-installed",
            }),
            "/workspace",
            HERMES_RUNTIME_DESCRIPTOR.clone(),
        );
        options.app_version = "0.3.22".into();
        let (fake, recorded) = (connection.clone(), launches.clone());
        options.connection_factory = Some(Rc::new(move |launch| {
            recorded.borrow_mut().push(launch);
            Ok(fake.clone() as Rc<dyn RpcConnection>)
        }));
        options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
        let adapter = hermes_acp_adapter(options).unwrap();
        let result = adapter
            .bootstrap(&json!({ "kind": "create", "model": "custom:lab:qwen-2.5", "mode": "accept_edits" }))
            .await
            .unwrap();
        let launch = launches.borrow()[0].clone();
        assert_eq!(launch.executable_path.to_string_lossy(), "/tools/hermes");
        assert_eq!(launch.args, ["launcher", "acp"]);
        assert_eq!(launch.cwd.to_string_lossy(), "/workspace");
        assert!(
            launch
                .env
                .unwrap()
                .contains(&("PUPPYONE_AGENT_BACKEND".to_string(), "hermes".to_string()))
        );
        let methods: Vec<String> = connection
            .requests
            .borrow()
            .iter()
            .map(|r| r["method"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            methods,
            [
                "initialize",
                "authenticate",
                "session/new",
                "session/set_model",
                "session/set_mode"
            ]
        );
        let params = |method: &str| connection.requests_of(method)[0].clone();
        assert_eq!(params("authenticate"), json!({ "methodId": "openrouter" }));
        assert_eq!(
            params("session/set_model"),
            json!({ "sessionId": "hermes-session", "modelId": "custom:lab:qwen-2.5" })
        );
        assert_match(
            &result,
            &json!({
                "inspection": {
                    "runtime": { "id": "hermes", "version": "0.16.0", "compatibility": "acp-v1" },
                    "account": { "account": { "type": "hermes" }, "requiresRuntimeSetup": false },
                    "providers": [
                        { "id": "openrouter", "defaultModel": "openrouter:z-ai/glm-5.1", "modelCount": 1 },
                        { "id": "custom:lab", "modelCount": 1 },
                    ],
                    "models": [
                        { "id": "openrouter:z-ai/glm-5.1", "providerId": "openrouter", "modelId": "z-ai/glm-5.1" },
                        { "id": "custom:lab:qwen-2.5", "providerId": "custom:lab", "modelId": "qwen-2.5" },
                    ],
                    "capabilities": {
                        "resume": true,
                        "fork": true,
                        "sessionHistory": true,
                        "attachments": true,
                        "referenceInputs": { "attachments": { "image": { "accepted": true }, "text": { "accepted": true } } },
                    },
                },
                "providerSession": {
                    "providerSessionId": "hermes-session",
                    "model": "custom:lab:qwen-2.5",
                    "mode": "accept_edits",
                },
            }),
        );
        crate::agent::runtime::agent_runtime_port::assert_agent_runtime_inspection(
            &adapter,
            &result["inspection"],
            "hermes",
        )
        .unwrap();
        adapter.dispose().await.unwrap();
    });
}

fn ready(executable_path: &str, args_prefix: Value) -> Value {
    json!({
        "status": "ready",
        "code": "READY",
        "version": "0.16.0",
        "minimumVersion": MINIMUM_HERMES_ACP_VERSION,
        "executablePath": executable_path,
        "argsPrefix": args_prefix,
        "environment": { "PATH": "/tools" },
        "message": "Hermes Agent is ready.",
    })
}

#[test]
fn requires_the_tested_official_acp_baseline_and_verifies_the_acp_endpoint() {
    run_local(async {
        let options = HermesDiscoveryOptions {
            discover: Some(Rc::new(|options| {
                assert_eq!(options.installation_id.as_deref(), Some("hermes"));
                assert_eq!(options.minimum_version.as_deref(), Some("0.16.0"));
                assert_eq!(
                    (options.parse_version)("Hermes Agent v0.16.0 (2026.6.5)").as_deref(),
                    Some("0.16.0")
                );
                let environment = (options.build_environment.as_ref().unwrap())(
                    &EnvMap::from([("PATH".to_string(), "/tools".to_string())]),
                    &EnvMap::new(),
                    std::path::Path::new("/Users/test"),
                    "darwin",
                );
                assert_eq!(environment["PATH"], "/tools");
                assert_eq!(environment["PUPPYONE_AGENT"], "1");
                assert_eq!(environment["PUPPYONE_AGENT_BACKEND"], "hermes");
                Box::pin(async { Ok(ready("/tools/python", json!(["/tools/hermes.py"]))) })
            })),
            probe: Some(Rc::new(|run| {
                assert_eq!(run.file, "/tools/python");
                assert_eq!(run.args, ["/tools/hermes.py", "acp", "--check"]);
                assert_eq!((run.timeout_ms, run.max_bytes), (8_000, 64 * 1024));
                Box::pin(async {
                    Ok(ProbeResult {
                        code: Some(0),
                        stdout: "Hermes ACP check OK\n".into(),
                        ..Default::default()
                    })
                })
            })),
            ..Default::default()
        };
        let readiness = discover_hermes_executable(options, None).await.unwrap();
        assert_match(
            &readiness,
            &json!({
                "runtimeId": "hermes",
                "status": "ready",
                "compatibility": "acp-v1",
                "selectable": true,
                "argsPrefix": ["/tools/hermes.py"],
            }),
        );
        assert_eq!(
            parse_hermes_version("Hermes Agent v0.16.0 (2026.6.5) · upstream bd740f20").as_deref(),
            Some("0.16.0")
        );
        assert!(
            !build_hermes_environment(
                &EnvMap::from([("PATH".to_string(), "/tools".to_string())]),
                &EnvMap::new(),
                "darwin"
            )
            .contains_key("HERMES_ACP_SKIP_CONFIGURED_MCP")
        );
    });
}

#[test]
fn fails_closed_when_the_official_acp_dependency_check_fails() {
    run_local(async {
        let options = HermesDiscoveryOptions {
            discover: Some(Rc::new(|_| {
                Box::pin(async { Ok(ready("/tools/hermes", json!([]))) })
            })),
            probe: Some(Rc::new(|_| {
                Box::pin(async {
                    Ok(ProbeResult {
                        code: Some(1),
                        stderr: "Install hermes-agent[acp]".into(),
                        ..Default::default()
                    })
                })
            })),
            ..Default::default()
        };
        let readiness = discover_hermes_executable(options, None).await.unwrap();
        assert_match(
            &readiness,
            &json!({
                "status": "protocol-unavailable",
                "code": "PROTOCOL_UNAVAILABLE",
                "compatibility": "unavailable",
                "selectable": false,
            }),
        );
    });
}

//! `tests/unit/agent/runtimes/acp/electron.workbuddy-acp-adapter.test.mjs`.
use super::workbuddy_acp_adapter::work_buddy_acp_adapter;
use super::workbuddy_channels::{
    WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL, WorkBuddyChannel,
};
use super::workbuddy_config_directory::work_buddy_config_directory;
use super::workbuddy_discovery::{
    WorkBuddyDiscoveryOptions, discover_work_buddy_executable, parse_work_buddy_version,
};
use super::workbuddy_history_source::{
    legacy_work_buddy_runtime_id_for_source_scope, work_buddy_history_source,
};
use super::workbuddy_identity::{
    WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR, WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR,
};
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
use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::Rc;

fn environment(pairs: &[(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> + use<> {
    let pairs = pairs.to_vec();
    move |key: &str| {
        pairs
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.to_string())
    }
}

#[test]
fn keeps_china_and_international_native_history_identities_separate_and_migratable() {
    let home = Path::new("/Users/test");
    let current = environment(&[("HOME", "/Users/test")]);
    let international = work_buddy_history_source(&WORKBUDDY_INTERNATIONAL_CHANNEL, &current, home);
    let china = work_buddy_history_source(&WORKBUDDY_CHINA_CHANNEL, &current, home);
    assert_ne!(international, china);
    assert_ne!(
        work_buddy_history_source(
            &WORKBUDDY_CHINA_CHANNEL,
            &environment(&[
                ("HOME", "/Users/test"),
                ("WORKBUDDY_CHINA_CONFIG_DIR", "~/custom-codebuddy")
            ]),
            home,
        ),
        china
    );
    assert_eq!(
        legacy_work_buddy_runtime_id_for_source_scope(Some(&china), &current, home),
        Some("workbuddy-china")
    );
    assert_eq!(
        legacy_work_buddy_runtime_id_for_source_scope(Some(&international), &current, home),
        Some("workbuddy-international")
    );
}

#[test]
fn resolves_separate_default_profiles_and_honors_channel_specific_overrides() {
    let home = Path::new("/elsewhere");
    let current = environment(&[("HOME", "/Users/test")]);
    assert_eq!(
        work_buddy_config_directory(&WORKBUDDY_CHINA_CHANNEL, &current, home),
        Path::new("/Users/test/.workbuddy")
    );
    assert_eq!(
        work_buddy_config_directory(&WORKBUDDY_INTERNATIONAL_CHANNEL, &current, home),
        Path::new("/Users/test/.workbuddy-ai")
    );
    assert_eq!(
        work_buddy_config_directory(
            &WORKBUDDY_INTERNATIONAL_CHANNEL,
            &environment(&[
                ("HOME", "/Users/test"),
                ("WORKBUDDY_CONFIG_DIR", "/profiles/shared"),
                (
                    "WORKBUDDY_INTERNATIONAL_CONFIG_DIR",
                    "~/profiles/international"
                ),
            ]),
            home,
        ),
        Path::new("/Users/test/profiles/international")
    );
}

fn work_buddy_connection(authenticated: bool) -> Rc<FakeConnection> {
    let connection = FakeConnection::new();
    connection.result(
        "initialize",
        json!({
            "protocolVersion": 1,
            "agentInfo": { "name": "CodeBuddy Code", "version": "2.115.0" },
            "agentCapabilities": {
                "loadSession": true,
                "promptCapabilities": { "image": true, "embeddedContext": true },
                "mcpCapabilities": { "http": true, "sse": true },
            },
            "authMethods": [
                { "id": "external", "name": "Login with Google/GitHub" },
                { "id": "internal", "name": "Login with WeChat" },
            ],
        }),
    );
    connection.result(
        "_codebuddy.ai/getUserInfo",
        if authenticated {
            json!({ "userInfo": { "userId": "workbuddy-user", "userName": "WorkBuddy User" } })
        } else {
            json!({})
        },
    );
    connection.result("authenticate", json!({}));
    connection.result("session/new", json!({ "sessionId": "workbuddy-session" }));
    connection
}

async fn bootstrap(
    channel: WorkBuddyChannel,
    descriptor: &Value,
    readiness: Value,
    authenticated: bool,
) -> (Rc<FakeConnection>, ConnectionOptions, Value) {
    let connection = work_buddy_connection(authenticated);
    let launches: Rc<RefCell<Vec<ConnectionOptions>>> = Rc::default();
    let mut options = AcpAdapterOptions::new(readiness, "/workspace", descriptor.clone());
    options.app_version = "0.3.22".into();
    let (fake, recorded) = (connection.clone(), launches.clone());
    options.connection_factory = Some(Rc::new(move |launch| {
        recorded.borrow_mut().push(launch);
        Ok(fake.clone() as Rc<dyn RpcConnection>)
    }));
    options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
    let adapter = work_buddy_acp_adapter(channel, options).unwrap();
    let result = adapter
        .bootstrap(&json!({ "kind": "create" }))
        .await
        .unwrap();
    adapter.dispose().await.unwrap();
    let launch = launches.borrow()[0].clone();
    (connection, launch, result)
}

fn methods(connection: &FakeConnection) -> Vec<String> {
    connection
        .requests
        .borrow()
        .iter()
        .map(|r| r["method"].as_str().unwrap().to_string())
        .collect()
}

fn env_of(launch: &ConnectionOptions) -> EnvMap {
    launch.env.clone().unwrap().into_iter().collect()
}

#[test]
fn authenticates_each_channel_and_creates_a_session_on_its_own_acp_connection() {
    run_local(async {
        for (channel, descriptor, app, authentication, route) in [
            (
                WORKBUDDY_CHINA_CHANNEL,
                &*WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR,
                "WorkBuddy.app",
                "internal",
                "internal",
            ),
            (
                WORKBUDDY_INTERNATIONAL_CHANNEL,
                &*WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR,
                "WorkBuddy AI.app",
                "external",
                "public",
            ),
        ] {
            let profile = format!("/profiles/{}", channel.id);
            let mut environment = json!({ "HOME": "/Users/test", "PATH": "/usr/bin" });
            environment[channel.config_directory_environment_variable] = json!(profile);
            let readiness = json!({
                "executablePath": format!("/Applications/{app}/Contents/Resources/cli/bin/codebuddy"),
                "environment": environment,
                "version": "2.115.0",
            });
            let (connection, launch, result) =
                bootstrap(channel, descriptor, readiness, false).await;
            assert!(launch.executable_path.to_string_lossy().contains(app));
            assert_eq!(launch.args, ["--acp"]);
            assert_eq!(launch.cwd, Path::new("/workspace"));
            let env = env_of(&launch);
            for (key, value) in [
                ("WORKBUDDY_CONFIG_DIR", profile.as_str()),
                ("CODEBUDDY_CONFIG_DIR", profile.as_str()),
                ("CODEBUDDY_INTERNET_ENVIRONMENT", route),
                ("DISABLE_AUTOUPDATER", "1"),
                ("DISABLE_ERROR_REPORTING", "1"),
                ("DISABLE_TELEMETRY", "1"),
            ] {
                assert_eq!(env.get(key).map(String::as_str), Some(value), "{key}");
            }
            assert_eq!(
                methods(&connection),
                [
                    "initialize",
                    "_codebuddy.ai/getUserInfo",
                    "authenticate",
                    "session/new"
                ]
            );
            assert_eq!(
                connection.requests_of("authenticate")[0],
                json!({ "methodId": authentication })
            );
            assert_eq!(result["inspection"]["runtime"]["id"], channel.id);
            assert_eq!(result["inspection"]["capabilities"]["resume"], true);
            let attachments =
                &result["inspection"]["capabilities"]["referenceInputs"]["attachments"];
            assert_eq!(attachments["image"]["accepted"], true);
            assert_eq!(attachments["text"]["accepted"], true);
            assert_eq!(
                result["providerSession"]["providerSessionId"],
                "workbuddy-session"
            );
        }
    });
}

#[test]
fn reuses_an_existing_native_login_without_forcing_browser_authentication() {
    run_local(async {
        let (connection, launch, _) = bootstrap(
            WORKBUDDY_CHINA_CHANNEL,
            &WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR,
            json!({
                "executablePath": "/Applications/WorkBuddy.app/Contents/Resources/cli/bin/codebuddy",
                "environment": { "HOME": "/Users/test", "PATH": "/usr/bin" },
                "version": "2.115.0",
            }),
            true,
        )
        .await;
        let env = env_of(&launch);
        assert_eq!(env["WORKBUDDY_CONFIG_DIR"], "/Users/test/.workbuddy");
        assert_eq!(env["CODEBUDDY_CONFIG_DIR"], "/Users/test/.workbuddy");
        assert_eq!(
            methods(&connection),
            ["initialize", "_codebuddy.ai/getUserInfo", "session/new"]
        );
    });
}

fn ready(executable_path: &str, args_prefix: Value, environment: Value) -> Value {
    json!({
        "status": "ready",
        "code": "READY",
        "version": "2.115.0",
        "minimumVersion": null,
        "executablePath": executable_path,
        "argsPrefix": args_prefix,
        "environment": environment,
        "message": "WorkBuddy is ready.",
    })
}

#[test]
fn uses_a_side_effect_limited_version_and_acp_help_probe() {
    run_local(async {
        let (discovered, probed) = (Rc::new(Cell::new(0)), Rc::new(Cell::new(0)));
        let (discover_count, probe_count) = (discovered.clone(), probed.clone());
        let options = WorkBuddyDiscoveryOptions {
            discover: Some(Rc::new(move |options| {
                discover_count.set(discover_count.get() + 1);
                assert_eq!(
                    options.installation_id.as_deref(),
                    Some("workbuddy-international")
                );
                assert_eq!(
                    (options.parse_version)("2.115.0\n").as_deref(),
                    Some("2.115.0")
                );
                let environment = (options.build_environment.as_ref().unwrap())(
                    &EnvMap::from([("PATH".to_string(), "/tools".to_string())]),
                    &EnvMap::new(),
                    Path::new("/Users/test"),
                    "darwin",
                );
                for (key, value) in [
                    ("PATH", "/tools"),
                    ("DISABLE_AUTOUPDATER", "1"),
                    ("DISABLE_ERROR_REPORTING", "1"),
                    ("DISABLE_TELEMETRY", "1"),
                    ("CODEBUDDY_INTERNET_ENVIRONMENT", "public"),
                    ("PUPPYONE_AGENT_BACKEND", "workbuddy-international"),
                ] {
                    assert_eq!(environment[key], value, "{key}");
                }
                assert!(environment["WORKBUDDY_CONFIG_DIR"].contains(".workbuddy-ai"));
                assert!(environment["CODEBUDDY_CONFIG_DIR"].contains(".workbuddy-ai"));
                Box::pin(async {
                    Ok(ready(
                        "/tools/codebuddy",
                        Value::Null,
                        json!({ "PATH": "/tools", "DISABLE_TELEMETRY": "1" }),
                    ))
                })
            })),
            probe: Some(Rc::new(move |run| {
                probe_count.set(probe_count.get() + 1);
                assert_eq!(run.file, "/tools/codebuddy");
                assert_eq!(run.args, ["--help"]);
                assert_eq!(run.env["CODEBUDDY_DISABLE_COMPILE_CACHE"], "1");
                Box::pin(async {
                    Ok(ProbeResult {
                        code: Some(0),
                        stdout: "  --acp  Start in ACP mode\n".into(),
                        ..Default::default()
                    })
                })
            })),
            ..Default::default()
        };
        let readiness =
            discover_work_buddy_executable(WORKBUDDY_INTERNATIONAL_CHANNEL, options, None)
                .await
                .unwrap();
        for (key, value) in [
            ("runtimeId", json!("workbuddy-international")),
            ("status", json!("ready")),
            ("code", json!("READY")),
            ("version", json!("2.115.0")),
            ("compatibility", json!("acp-v1")),
            ("selectable", json!(true)),
        ] {
            assert_eq!(readiness[key], value, "{key}");
        }
        assert_eq!((discovered.get(), probed.get()), (1, 1));
        assert_eq!(
            parse_work_buddy_version("CodeBuddy Code 2.115.0").as_deref(),
            Some("2.115.0")
        );
    });
}

#[test]
fn does_not_advertise_an_installation_whose_help_lacks_the_acp_entrypoint() {
    run_local(async {
        let options = WorkBuddyDiscoveryOptions {
            discover: Some(Rc::new(|_| {
                Box::pin(async { Ok(ready("/tools/codebuddy", Value::Null, json!({}))) })
            })),
            probe: Some(Rc::new(|_| {
                Box::pin(async {
                    Ok(ProbeResult {
                        code: Some(0),
                        stdout: "Usage: codebuddy\n".into(),
                        ..Default::default()
                    })
                })
            })),
            ..Default::default()
        };
        let readiness = discover_work_buddy_executable(WORKBUDDY_CHINA_CHANNEL, options, None)
            .await
            .unwrap();
        assert_eq!(readiness["status"], "protocol-unavailable");
        assert_eq!(readiness["code"], "PROTOCOL_UNAVAILABLE");
        assert_eq!(readiness["selectable"], false);
    });
}

#[test]
fn probes_a_windows_desktop_bundle_through_its_electron_host_and_cli_entrypoint() {
    run_local(async {
        let cli = "D:\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy";
        let probed = Rc::new(Cell::new(0));
        let count = probed.clone();
        let options = WorkBuddyDiscoveryOptions {
            platform: Some("win32".into()),
            discover: Some(Rc::new(move |_| {
                Box::pin(async move {
                    Ok(ready(
                        "D:\\WorkBuddy\\WorkBuddy.exe",
                        json!([cli]),
                        json!({ "ELECTRON_RUN_AS_NODE": "1" }),
                    ))
                })
            })),
            probe: Some(Rc::new(move |run| {
                count.set(count.get() + 1);
                assert_eq!(run.file, "D:\\WorkBuddy\\WorkBuddy.exe");
                assert_eq!(run.args, [cli, "--help"]);
                assert_eq!(run.env["ELECTRON_RUN_AS_NODE"], "1");
                assert_eq!(run.env["CODEBUDDY_DISABLE_COMPILE_CACHE"], "1");
                Box::pin(async {
                    Ok(ProbeResult {
                        code: Some(0),
                        stdout: "  --acp  Start in ACP mode\n".into(),
                        ..Default::default()
                    })
                })
            })),
            ..Default::default()
        };
        let readiness = discover_work_buddy_executable(WORKBUDDY_CHINA_CHANNEL, options, None)
            .await
            .unwrap();
        assert_eq!(readiness["status"], "ready");
        assert_eq!(readiness["executablePath"], "D:\\WorkBuddy\\WorkBuddy.exe");
        assert_eq!(readiness["argsPrefix"], json!([cli]));
        assert_eq!(readiness["selectable"], true);
        assert_eq!(probed.get(), 1);
    });
}

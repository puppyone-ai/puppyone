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
            json!({
                "userInfo": {
                    "userId": "workbuddy-user",
                    "userName": "WorkBuddy User",
                    "accessToken": "workbuddy-access-token",
                }
            })
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

#[test]
fn detects_lite_wb_only_desktop_bundles_and_launches_via_serve_stdio_acp() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let cli_bin = directory.path().join("cli").join("bin");
        let cli_dist = directory.path().join("cli").join("dist");
        std::fs::create_dir_all(&cli_bin).unwrap();
        std::fs::create_dir_all(&cli_dist).unwrap();
        let cli = cli_bin.join("codebuddy");
        std::fs::write(&cli, "#!/usr/bin/env node\n").unwrap();
        std::fs::write(cli_dist.join("codebuddy-lite-wb.mjs"), "export {};\n").unwrap();
        let host = directory.path().join("WorkBuddy.exe");
        std::fs::write(&host, "").unwrap();
        let cli_str = cli.to_string_lossy().into_owned();
        let host_str = host.to_string_lossy().into_owned();
        let options = WorkBuddyDiscoveryOptions {
            discover: Some(Rc::new({
                let cli_str = cli_str.clone();
                let host_str = host_str.clone();
                move |_| {
                    let cli_str = cli_str.clone();
                    let host_str = host_str.clone();
                    Box::pin(async move {
                        Ok(ready(
                            &host_str,
                            json!([cli_str]),
                            json!({
                                "ELECTRON_RUN_AS_NODE": "1",
                                "CODEBUDDY_GATEWAY_AUTH": "none",
                            }),
                        ))
                    })
                }
            })),
            probe: Some(Rc::new(move |run| {
                assert_eq!(run.env["CODEBUDDY_FORCE_LITE_WB_BUNDLE"], "1");
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
        assert_eq!(readiness["acpLaunchMode"], "serve-stdio");
        assert_eq!(
            readiness["environment"]["CODEBUDDY_FORCE_LITE_WB_BUNDLE"],
            "1"
        );
        let (_connection, launch, _result) = bootstrap(
            WORKBUDDY_CHINA_CHANNEL,
            &WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR,
            readiness,
            true,
        )
        .await;
        assert_eq!(
            launch.args,
            [
                cli_str.as_str(),
                "--serve",
                "--host",
                "127.0.0.1",
                "--port",
                "0",
                "--auth",
                "password",
                "--acp"
            ]
        );
        assert_eq!(launch.max_leading_non_json_lines, Some(32));
        let env = env_of(&launch);
        assert_eq!(
            env.get("CODEBUDDY_FORCE_LITE_WB_BUNDLE")
                .map(String::as_str),
            Some("1")
        );
        // The CLI lets this variable outrank `--auth`; an inherited `none`
        // must not reach the loopback HTTP server.
        assert_eq!(
            env.get("CODEBUDDY_GATEWAY_AUTH").map(String::as_str),
            Some("password")
        );
        // Desktop 5.11.3+ encrypts `workbuddy-desktop.info` with a Desktop-held
        // key; PuppyOne isolates its own auth slot and disables Desktop's shared
        // product cache so standalone ACP never collides with Desktop.
        assert_eq!(
            env.get("CODEBUDDY_DISABLE_PRODUCT_CACHE")
                .map(String::as_str),
            Some("1")
        );
        assert_eq!(
            env.get("ACC_PRODUCT_CONFIG_V3")
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok()),
            Some(json!({ "authentication": { "id": "puppyone-workbuddy-china" } }))
        );
    });
}

#[test]
fn treats_user_info_without_usable_access_token_as_unauthenticated() {
    run_local(async {
        let connection = work_buddy_connection(false);
        connection.result(
            "_codebuddy.ai/getUserInfo",
            json!({
                "userInfo": {
                    "userId": "b923088d-e0c3-45ed-9780-4a1fb8aa4e6c",
                    "userName": "",
                    "userNickname": "",
                    "authType": "local",
                }
            }),
        );
        let mut options = AcpAdapterOptions::new(
            json!({
                "executablePath": "/Applications/WorkBuddy.app/Contents/Resources/cli/bin/codebuddy",
                "environment": { "HOME": "/Users/test", "PATH": "/usr/bin" },
                "version": "2.176.0",
            }),
            "/workspace",
            WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR.clone(),
        );
        let fake = connection.clone();
        options.connection_factory =
            Some(Rc::new(move |_| Ok(fake.clone() as Rc<dyn RpcConnection>)));
        options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
        let adapter = work_buddy_acp_adapter(WORKBUDDY_CHINA_CHANNEL, options).unwrap();
        adapter
            .bootstrap(&json!({ "kind": "create" }))
            .await
            .unwrap();
        assert_eq!(
            methods(&connection),
            [
                "initialize",
                "_codebuddy.ai/getUserInfo",
                "authenticate",
                "session/new",
            ]
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn preserves_explicit_auth_overrides_on_lite_wb_bundles() {
    run_local(async {
        let readiness = json!({
            "executablePath": "D:\\WorkBuddy\\WorkBuddy.exe",
            "argsPrefix": ["D:\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy"],
            "acpLaunchMode": "serve-stdio",
            "environment": {
                "ELECTRON_RUN_AS_NODE": "1",
                "CODEBUDDY_AUTH_TOKEN": "custom-bearer-token",
            },
            "version": "2.176.0",
        });
        let (_connection, launch, _result) = bootstrap(
            WORKBUDDY_CHINA_CHANNEL,
            &WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR,
            readiness,
            true,
        )
        .await;
        let env = env_of(&launch);
        assert_eq!(
            env.get("CODEBUDDY_AUTH_TOKEN").map(String::as_str),
            Some("custom-bearer-token")
        );
        assert!(!env.contains_key("ACC_PRODUCT_CONFIG_V3"));
        assert!(!env.contains_key("CODEBUDDY_DISABLE_PRODUCT_CACHE"));
    });
}

#[test]
fn surfaces_workbuddy_refusal_metadata_as_provider_error_and_turn_failed() {
    run_local(async {
        let connection = work_buddy_connection(true);
        connection.result(
            "session/prompt",
            json!({
                "stopReason": "refusal",
                "_meta": {
                    "codebuddy.ai/errorMessage": "{\"code\":-32000,\"message\":\"Authentication required. Please use /login command to sign in to your account\",\"data\":{\"category\":\"auth\",\"statusCode\":401}}"
                }
            }),
        );
        let events: Rc<RefCell<Vec<Value>>> = Rc::default();
        let recorded_events = events.clone();
        let mut options = AcpAdapterOptions::new(
            json!({
                "executablePath": "/Applications/WorkBuddy.app/Contents/Resources/cli/bin/codebuddy",
                "environment": { "HOME": "/Users/test", "PATH": "/usr/bin" },
                "version": "2.176.0",
            }),
            "/workspace",
            WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR.clone(),
        );
        options.on_event = Rc::new(move |event| recorded_events.borrow_mut().push(event));
        let fake = connection.clone();
        options.connection_factory =
            Some(Rc::new(move |_| Ok(fake.clone() as Rc<dyn RpcConnection>)));
        options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
        let adapter = work_buddy_acp_adapter(WORKBUDDY_CHINA_CHANNEL, options).unwrap();
        adapter
            .bootstrap(&json!({ "kind": "create" }))
            .await
            .unwrap();
        adapter
            .start_turn(json!({ "prompt": "hello" }))
            .await
            .unwrap();
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        let emitted = events.borrow().clone();
        let error_event = emitted
            .iter()
            .find(|e| e["type"] == "provider.error")
            .expect("provider.error must be emitted on refusal");
        assert_eq!(error_event["payload"]["code"], "AUTHENTICATION_REQUIRED");
        assert!(
            error_event["payload"]["message"]
                .as_str()
                .unwrap()
                .contains("Authentication required")
        );
        assert_eq!(error_event["payload"]["recoverable"], true);
        assert!(
            error_event["payload"]["diagnostic"]
                .as_str()
                .unwrap()
                .contains("category=auth")
        );
        let failed_event = emitted
            .iter()
            .find(|e| e["type"] == "turn.failed")
            .expect("turn.failed must be emitted on refusal");
        assert_eq!(failed_event["payload"]["status"], "failed");
        assert!(
            failed_event["payload"]["message"]
                .as_str()
                .unwrap()
                .contains("Authentication required")
        );
        assert!(!emitted.iter().any(|e| e["type"] == "turn.completed"));
        adapter.dispose().await.unwrap();
    });
}

#[test]
#[ignore = "launches the developer's local WorkBuddy installation"]
fn live_workbuddy_china_discovery_and_acp_inspection() {
    run_local(async {
        let readiness = discover_work_buddy_executable(
            WORKBUDDY_CHINA_CHANNEL,
            WorkBuddyDiscoveryOptions::default(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(readiness["status"], "ready", "{readiness}");
        let mut options = AcpAdapterOptions::new(
            readiness,
            &std::env::temp_dir().to_string_lossy(),
            WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR.clone(),
        );
        options.app_version = "test".into();
        let adapter = work_buddy_acp_adapter(WORKBUDDY_CHINA_CHANNEL, options).unwrap();
        let inspection = adapter.inspect().await.unwrap();
        crate::agent::runtime::agent_runtime_port::assert_agent_runtime_inspection(
            &adapter,
            &inspection,
            "workbuddy-china",
        )
        .unwrap();
        eprintln!(
            "workbuddy-china account={:?} models={}",
            inspection["account"]["status"],
            inspection["models"].as_array().map_or(0, Vec::len)
        );
        adapter.dispose().await.unwrap();
    });
}

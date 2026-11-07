//! `tests/integration/agent/runtimes/discovery/electron.agent-local-inventory.test.mjs`
//! (the executable-candidate and process-budget cases live with
//! `platform/local_agent_installation`) and
//! `tests/unit/agent/runtimes/discovery/localAgentConnectionPolicy.test.mjs`.
use super::local_agent_connection_policy::derive_local_connection;
use super::local_agent_inventory::{
    LocalAgentInventoryOptions, ResolveCandidate, create_local_agent_inventory,
};
use super::probes::bounded_probe_command::{create_probe_environment, run_bounded_probe_command};
use super::probes::codex_local_probe::{
    CodexProbeOptions, InspectProtocol, InspectRequest, inspect_codex_protocol,
    parse_codex_local_version, probe_codex_local,
};
use super::probes::cursor_local_probe::{
    parse_cursor_authentication, parse_cursor_local_version, probe_cursor_local,
};
use super::probes::versioned_local_agent_probe::{
    parse_versioned_local_agent_version, probe_versioned_local_agent,
};
use super::tools::claude_tool::claude_local_tool;
use super::tools::local_agent_tool_registry::{
    LocalAgentToolDescriptor, LocalToolProbe, local_agent_tool_registry_defaults,
};
use super::tools::opencode_tool::opencode_local_tool;
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests_support::{run_local, run_paused_local};
use crate::agent::discovery::command_environment::{EnvMap, EnvironmentSnapshot};
use crate::agent::discovery::executable_discovery_port::ReadEnvironment;
use crate::agent::installation::executable_resolver::{
    ObservationRequest, ResolvedCandidate, resolve_first_executable,
};
use crate::agent::tasks::Canceller;
use crate::agent::transports::bounded_process_probe::{ProbeResult, ProbeRunner};
use crate::agent::transports::rpc_connection::ConnectionFactory;
use crate::agent::transports::rpc_connection::fake::FakeConnection;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::rc::Rc;

fn fixed_candidate(executable_path: &str, invoked_as: &str) -> ResolvedCandidate {
    ResolvedCandidate {
        executable_path: executable_path.into(),
        canonical_identity: executable_path.into(),
        invoked_as: invoked_as.into(),
        source: "user-installation".into(),
        ..Default::default()
    }
}

fn provided_environment() -> ReadEnvironment {
    Rc::new(|env, _homedir, _platform, _signal| {
        Box::pin(async move {
            Ok(EnvironmentSnapshot {
                environment: env,
                complete: true,
                source: "provided".into(),
                reason_code: None,
            })
        })
    })
}

fn executable(path: &Path, contents: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, contents).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn runner(answer: impl Fn(&[String]) -> ProbeResult + 'static) -> ProbeRunner {
    Rc::new(move |_file, args, _options| {
        let result = answer(&args);
        Box::pin(async move { Ok(result) })
    })
}

fn output(code: i32, stdout: &str, stderr: &str) -> ProbeResult {
    ProbeResult {
        stdout: stdout.into(),
        stderr: stderr.into(),
        code: Some(code),
        signal: None,
    }
}

fn ready_codex() -> Value {
    json!({
        "id": "codex",
        "displayName": "Codex",
        "installation": "detected",
        "version": "0.144.1",
        "authentication": "signed-in",
        "protocolCompatible": true,
        "hasModels": true,
        "source": "user-installation",
    })
}

fn probe_returning(result: Value) -> LocalToolProbe {
    Rc::new(move |_request| {
        let result = result.clone();
        Box::pin(async move { Ok(result) })
    })
}

fn resolve_fixed(path: &'static str) -> ResolveCandidate {
    Rc::new(move |tool, _context| {
        let candidate = fixed_candidate(
            if path.is_empty() {
                format!("/tools/{}", tool.id)
            } else {
                path.to_string()
            }
            .as_str(),
            &tool.executable_names[0],
        );
        Box::pin(async move { Ok(Some(candidate)) })
    })
}

fn codex_descriptor(probe: LocalToolProbe) -> LocalAgentToolDescriptor {
    LocalAgentToolDescriptor {
        id: "codex".into(),
        installation_id: None,
        display_name: "Codex".into(),
        executable_names: Some(vec!["codex".into()]),
        probe: Some(probe),
        unavailable_message: "Codex unavailable.".into(),
    }
}

#[test]
fn uses_a_minimal_probe_environment_and_never_forwards_credential_shaped_variables() {
    let environment = create_probe_environment(&EnvMap::from([
        ("HOME".into(), "/Users/example".into()),
        ("PATH".into(), "/usr/bin".into()),
        ("TMPDIR".into(), "/tmp".into()),
        ("LANG".into(), "en_US.UTF-8".into()),
        ("OPENAI_API_KEY".into(), "secret".into()),
        ("CURSOR_API_KEY".into(), "secret".into()),
        ("AWS_SECRET_ACCESS_KEY".into(), "secret".into()),
    ]));
    for (key, value) in [
        ("HOME", "/Users/example"),
        ("PATH", "/usr/bin"),
        ("TMPDIR", "/tmp"),
        ("LANG", "en_US.UTF-8"),
        ("TERM", "dumb"),
        ("PUPPYONE_AGENT_PROBE", "1"),
    ] {
        assert_eq!(environment[key], value);
    }
    assert!(!environment.values().any(|value| value.contains("secret")));
    assert!(!environment.contains_key("OPENAI_API_KEY"));
    assert!(!environment.contains_key("CURSOR_API_KEY"));
}

#[test]
fn normalizes_codex_and_cursor_versions_plus_negative_first_cursor_authentication() {
    assert_eq!(
        parse_codex_local_version("codex-cli 0.144.1").as_deref(),
        Some("0.144.1")
    );
    assert_eq!(
        parse_cursor_local_version("2026.07.09-a3815c0").as_deref(),
        Some("2026.07.09-a3815c0")
    );
    assert_eq!(
        parse_cursor_authentication("Not authenticated. Run cursor-agent login."),
        "signed-out"
    );
    assert_eq!(
        parse_cursor_authentication("Not authenticated: credentials expired."),
        "expired"
    );
    assert_eq!(
        parse_cursor_authentication("Authenticated as local@example.test"),
        "signed-in"
    );
    assert_eq!(
        parse_cursor_authentication("ERROR: SecItemCopyMatching failed -50"),
        "error"
    );
    assert_eq!(
        parse_cursor_authentication("new additive status format"),
        "unknown"
    );
}

#[test]
fn registers_every_terminal_launched_agent_and_verifies_generic_local_versions() {
    run_local(async {
        let ids: Vec<String> = local_agent_tool_registry_defaults()
            .into_iter()
            .map(|tool| tool.id)
            .collect();
        assert_eq!(ids, ["codex", "claude", "cursor-agent", "opencode"]);
        assert_eq!(
            parse_versioned_local_agent_version("claude 2.1.159").as_deref(),
            Some("2.1.159")
        );
        let home = tempfile::tempdir().unwrap();
        let claude = home.path().join("claude");
        executable(&claude, "#!/bin/sh\necho '2.1.159 (Claude Code)'\n");
        let candidate = resolve_first_executable(ObservationRequest {
            names: vec!["claude".into()],
            configured_paths: vec![claude.to_string_lossy().into_owned()],
            platform: crate::agent::discovery::bounded_process_probe::node_platform().into(),
            ..Default::default()
        })
        .await
        .unwrap()
        .unwrap();
        let result = probe_versioned_local_agent(
            Some(&candidate),
            "claude",
            "Claude Code",
            &std::env::vars().collect(),
            None,
        )
        .await;
        assert_eq!(result["id"], "claude");
        assert_eq!(result["installation"], "detected");
        assert_eq!(result["version"], "2.1.159");
        assert_eq!(result["protocolCompatible"], false);
    });
}

#[test]
fn finds_the_active_nvm_claude_through_path_and_opencode_through_its_product_fallback() {
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let claude = home.path().join(".nvm/versions/node/v22.17.0/bin/claude");
        let opencode = home.path().join(".opencode/bin/opencode");
        executable(&claude, "#!/bin/sh\necho '2.1.159 (Claude Code)'\n");
        executable(&opencode, "#!/bin/sh\necho 'opencode 1.2.3'\n");
        let inventory = create_local_agent_inventory(LocalAgentInventoryOptions {
            read_environment: Some(provided_environment()),
            env: Some(EnvMap::from([(
                "PATH".into(),
                claude.parent().unwrap().to_string_lossy().into_owned(),
            )])),
            homedir: Some(home.path().to_path_buf()),
            tool_descriptors: Some(vec![claude_local_tool(), opencode_local_tool()]),
            ..Default::default()
        })
        .unwrap();
        let snapshot = inventory.discover(true, None).await.unwrap();
        let connections = snapshot["connections"].as_array().unwrap();
        assert_eq!(connections[0]["id"], "claude");
        assert_eq!(connections[0]["installation"], "detected");
        assert_eq!(connections[0]["version"], "2.1.159");
        assert_eq!(connections[1]["id"], "opencode");
        assert_eq!(connections[1]["installation"], "detected");
        assert_eq!(connections[1]["version"], "1.2.3");
        inventory.dispose();
    });
}

fn signed_in_protocol() -> InspectProtocol {
    Rc::new(|_request| {
        Box::pin(async {
            Ok(
                json!({ "authentication": "signed-in", "protocolCompatible": true, "hasModels": true }),
            )
        })
    })
}

fn cursor_status(version: ProbeResult, status: ProbeResult) -> ProbeRunner {
    let (version, status) = (Rc::new(version), Rc::new(status));
    runner(move |args| {
        if args.first().map(String::as_str) == Some("--version") {
            (*version).clone()
        } else {
            (*status).clone()
        }
    })
}

#[test]
fn probes_codex_protocol_account_and_cursor_status_without_exposing_raw_output() {
    run_local(async {
        let codex = probe_codex_local(CodexProbeOptions {
            candidate: Some(fixed_candidate("/tools/codex", "codex")),
            run_command: Some(runner(|_| output(0, "codex-cli 0.144.1", ""))),
            inspect_protocol: Some(signed_in_protocol()),
            ..Default::default()
        })
        .await;
        assert_eq!(codex["installation"], "detected");
        assert_eq!(codex["version"], "0.144.1");
        assert_eq!(codex["authentication"], "signed-in");
        assert_eq!(codex["protocolCompatible"], true);
        assert_eq!(codex["hasModels"], true);

        let cursor = probe_cursor_local(
            Some(&fixed_candidate("/tools/cursor-agent", "cursor-agent")),
            Some(cursor_status(
                output(0, "2026.07.09-a3815c0", ""),
                output(0, "Authenticated as private@example.test", ""),
            )),
            &EnvMap::new(),
            None,
        )
        .await;
        assert_eq!(cursor["installation"], "detected");
        assert_eq!(cursor["version"], "2026.07.09-a3815c0");
        assert_eq!(cursor["authentication"], "signed-in");
        assert!(!cursor.to_string().contains("private@example.test"));
    });
}

#[test]
fn retains_a_cursor_status_crash_as_probe_evidence_instead_of_treating_it_as_sign_out() {
    run_local(async {
        let cursor = probe_cursor_local(
            Some(&fixed_candidate("/tools/cursor-agent", "cursor-agent")),
            Some(cursor_status(
                output(0, "2026.07.09-a3815c0", ""),
                output(139, "", "ERROR: SecItemCopyMatching failed -50"),
            )),
            &EnvMap::new(),
            None,
        )
        .await;
        assert_eq!(cursor["installation"], "detected");
        assert_eq!(cursor["authentication"], "error");
        assert_eq!(cursor["authenticationFailure"], "crashed");
        assert_eq!(cursor["authenticationExitCode"], 139);
        let diagnostic =
            regex::Regex::new(r"(?i)exit code 139.*SecItemCopyMatching failed -50").unwrap();
        assert!(diagnostic.is_match(cursor["authenticationDiagnostic"].as_str().unwrap()));
        let connection = derive_local_connection(Some(&cursor), None);
        assert_eq!(connection["authentication"], "error");
        assert_eq!(connection["integration"], "blocked");
        assert_eq!(connection["selectable"], false);
    });
}

#[test]
fn still_kills_an_unresponsive_cursor_status_process_and_blocks_selection() {
    run_paused_local(async {
        let hanging: ProbeRunner = Rc::new(|file, args, options| {
            Box::pin(async move {
                if args.first().map(String::as_str) == Some("--version") {
                    return Ok(output(0, "2026.10.01-e373342", ""));
                }
                let _ = file;
                run_bounded_probe_command("/bin/sleep", &["60".into()], options).await
            })
        });
        let cursor = probe_cursor_local(
            Some(&fixed_candidate("/tools/cursor-agent", "cursor-agent")),
            Some(hanging),
            &std::env::vars().collect(),
            None,
        )
        .await;
        assert_eq!(cursor["installation"], "detected");
        assert_eq!(cursor["authentication"], "error");
        assert_eq!(cursor["authenticationFailure"], "timed-out");
        assert_eq!(
            cursor["authenticationDiagnostic"],
            "Cursor status probe timed out."
        );
        assert_eq!(
            derive_local_connection(Some(&cursor), None)["selectable"],
            false
        );
    });
}

#[test]
fn disposes_an_in_flight_codex_protocol_probe_when_application_inventory_is_cancelled() {
    run_local(async {
        let controller = Canceller::new();
        let connection = FakeConnection::new();
        {
            let target = Rc::downgrade(&connection);
            connection.answer("initialize", move |_| {
                let target = target.clone();
                Box::pin(async move {
                    // The product's connection rejects pending requests on dispose.
                    loop {
                        if target.upgrade().is_none_or(|c| c.closed.get()) {
                            return Err(AgentError::new("connection closed"));
                        }
                        tokio::task::yield_now().await;
                    }
                })
            });
        }
        let factory: ConnectionFactory = connection.factory();
        let pending = {
            let request = InspectRequest {
                candidate: fixed_candidate("/tools/codex", "codex"),
                app_version: "0.1.2".into(),
                workspace_root: Some("/workspace".into()),
                env: EnvMap::new(),
                signal: Some(controller.signal()),
                connection_factory: Some(factory),
            };
            tokio::task::spawn_local(async move {
                let error = inspect_codex_protocol(request).await.unwrap_err();
                assert!(error.message.contains("connection closed"));
            })
        };
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        let requests = connection.requests.borrow().clone();
        assert_eq!(requests[0]["method"], "initialize");
        assert_eq!(requests[0]["timeoutMs"], 1_500);
        controller.cancel(AgentError::new("cancelled"));
        pending.await.unwrap();
        assert_eq!(
            connection.disposals.borrow()[0].0,
            "Codex inventory probe cancelled."
        );
    });
}

#[test]
fn keeps_unsupported_codex_and_signed_out_cursor_visible_without_running_an_integration_route() {
    run_local(async {
        let inspected = Rc::new(Cell::new(0));
        let counter = inspected.clone();
        let inspect: InspectProtocol = Rc::new(move |_request| {
            counter.set(counter.get() + 1);
            Box::pin(async { Ok(json!({})) })
        });
        let codex = probe_codex_local(CodexProbeOptions {
            candidate: Some(fixed_candidate("/tools/codex", "codex")),
            run_command: Some(runner(|_| output(0, "codex-cli 0.100.0", ""))),
            inspect_protocol: Some(inspect),
            ..Default::default()
        })
        .await;
        assert_eq!(codex["installation"], "unsupported");
        assert_eq!(codex["version"], "0.100.0");
        assert_eq!(codex["authentication"], "unknown");
        assert_eq!(inspected.get(), 0);

        let cursor = probe_cursor_local(
            Some(&fixed_candidate("/tools/cursor-agent", "cursor-agent")),
            Some(cursor_status(
                output(0, "2026.07.09-a3815c0", ""),
                output(1, "", "Not authenticated. Run cursor-agent login."),
            )),
            &EnvMap::new(),
            None,
        )
        .await;
        assert_eq!(cursor["installation"], "detected");
        assert_eq!(cursor["authentication"], "signed-out");
        let connection = derive_local_connection(Some(&cursor), None);
        assert_eq!(connection["integration"], "setup-required");
        assert_eq!(connection["selectable"], false);
    });
}

#[test]
fn derives_native_selectability_from_protocol_auth_model_and_workspace_gates() {
    let detected = ready_codex();
    let ready = derive_local_connection(Some(&detected), None);
    assert_eq!(ready["integration"], "ready");
    assert_eq!(ready["selectable"], true);
    let denied =
        derive_local_connection(Some(&detected), Some(&json!({ "workspaceAllowed": false })));
    assert_eq!(denied["integration"], "setup-required");
    assert_eq!(denied["selectable"], false);
}

#[test]
fn deduplicates_concurrent_scans_caches_for_five_minutes_and_isolates_per_tool_failure() {
    run_local(async {
        let times = Rc::new(RefCell::new(vec![1_000i64, 1_000, 1_001, 301_001]));
        let now = {
            let times = times.clone();
            Rc::new(move || {
                let mut times = times.borrow_mut();
                if times.len() > 1 {
                    times.remove(0)
                } else {
                    times[0]
                }
            }) as Rc<dyn Fn() -> i64>
        };
        let calls = Rc::new(Cell::new(0));
        let release: Rc<RefCell<Option<tokio::sync::oneshot::Sender<()>>>> = Rc::default();
        let codex_probe: LocalToolProbe = {
            let (calls, release) = (calls.clone(), release.clone());
            Rc::new(move |_request| {
                calls.set(calls.get() + 1);
                let gate = (calls.get() == 1).then(|| {
                    let (sender, receiver) = tokio::sync::oneshot::channel();
                    *release.borrow_mut() = Some(sender);
                    receiver
                });
                Box::pin(async move {
                    if let Some(gate) = gate {
                        let _ = gate.await;
                    }
                    Ok(ready_codex())
                })
            })
        };
        let cursor_probe: LocalToolProbe = Rc::new(|_request| {
            Box::pin(async { Err(AgentError::new("private cursor output /Users/example")) })
        });
        let inventory = create_local_agent_inventory(LocalAgentInventoryOptions {
            read_environment: Some(provided_environment()),
            now: Some(now),
            resolve_candidate: Some(resolve_fixed("")),
            probes: HashMap::from([
                ("codex".to_string(), codex_probe),
                ("cursor-agent".to_string(), cursor_probe),
            ]),
            ..Default::default()
        })
        .unwrap();
        let first = inventory.discover(false, None);
        let concurrent = inventory.discover(false, None);
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
        assert_eq!(calls.get(), 1);
        let _ = release.borrow_mut().take().unwrap().send(());
        let (snapshot, same) = futures_util::join!(first, concurrent);
        let (snapshot, same) = (snapshot.unwrap(), same.unwrap());
        assert_eq!(snapshot, same);
        let connections = snapshot["connections"].as_array().unwrap();
        let by_id = |id: &str| connections.iter().find(|c| c["id"] == id).unwrap().clone();
        assert_eq!(by_id("codex")["selectable"], true);
        assert_eq!(by_id("cursor-agent")["installation"], "broken");
        assert_eq!(by_id("cursor-agent")["selectable"], false);
        let text = snapshot.to_string();
        assert!(
            !regex::Regex::new(r"/Users/example|/tools/|private cursor output")
                .unwrap()
                .is_match(&text)
        );

        inventory.discover(false, None).await.unwrap();
        assert_eq!(calls.get(), 1);
        inventory.discover(true, None).await.unwrap();
        assert_eq!(calls.get(), 2);
    });
}

#[test]
fn lets_explicit_refresh_supersede_an_in_flight_scan_without_caching_aborted_failures() {
    run_local(async {
        let calls = Rc::new(Cell::new(0));
        let probe: LocalToolProbe = {
            let calls = calls.clone();
            Rc::new(move |request| {
                calls.set(calls.get() + 1);
                let first = calls.get() == 1;
                Box::pin(async move {
                    if first {
                        request.signal.cancelled().await;
                        return Err(AgentError::new("cancelled").with_name("AbortError"));
                    }
                    Ok(ready_codex())
                })
            })
        };
        let inventory = create_local_agent_inventory(LocalAgentInventoryOptions {
            read_environment: Some(provided_environment()),
            tool_descriptors: Some(vec![codex_descriptor(probe)]),
            resolve_candidate: Some(resolve_fixed("/tools/codex")),
            ..Default::default()
        })
        .unwrap();
        let first = inventory.discover(false, None);
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
        assert_eq!(calls.get(), 1);
        let refreshed = inventory.discover(true, None);
        let error = first.await.unwrap_err();
        assert_eq!(error.name.as_deref(), Some("AbortError"));
        let snapshot = refreshed.await.unwrap();
        assert_eq!(snapshot["connections"][0]["id"], "codex");
        assert_eq!(snapshot["connections"][0]["selectable"], true);
        assert_eq!(calls.get(), 2);
        inventory.dispose();
    });
}

#[test]
fn reuses_a_sanitized_persisted_inventory_snapshot_across_application_restarts() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let cache_file_path = directory.path().join("agent-runtime-inventory.json");
        let first_calls = Rc::new(Cell::new(0));
        let first_probe: LocalToolProbe = {
            let calls = first_calls.clone();
            Rc::new(move |_request| {
                calls.set(calls.get() + 1);
                Box::pin(async { Ok(ready_codex()) })
            })
        };
        let first = create_local_agent_inventory(LocalAgentInventoryOptions {
            read_environment: Some(provided_environment()),
            now: Some(Rc::new(|| 1_000)),
            cache_file_path: Some(cache_file_path.clone()),
            tool_descriptors: Some(vec![codex_descriptor(first_probe)]),
            resolve_candidate: Some(resolve_fixed("/tools/codex")),
            ..Default::default()
        })
        .unwrap();
        let scanned = first.discover(false, None).await.unwrap();
        assert_eq!(first_calls.get(), 1);
        let persisted = std::fs::read_to_string(&cache_file_path).unwrap();
        assert!(
            !regex::Regex::new(r"(?i)/tools/codex|executablePath|environment|credential")
                .unwrap()
                .is_match(&persisted)
        );
        assert_eq!(
            std::fs::metadata(&cache_file_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        first.dispose();

        let restarted_calls = Rc::new(Cell::new(0));
        let restarted_probe: LocalToolProbe = {
            let calls = restarted_calls.clone();
            Rc::new(move |_request| {
                calls.set(calls.get() + 1);
                Box::pin(async { Err(AgentError::new("must not rescan")) })
            })
        };
        let restarted = create_local_agent_inventory(LocalAgentInventoryOptions {
            read_environment: Some(provided_environment()),
            now: Some(Rc::new(|| 2_000)),
            cache_file_path: Some(cache_file_path.clone()),
            tool_descriptors: Some(vec![codex_descriptor(restarted_probe)]),
            resolve_candidate: Some(resolve_fixed("/changed/codex")),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(restarted.discover(false, None).await.unwrap(), scanned);
        assert_eq!(restarted_calls.get(), 0);
        restarted.discover(true, None).await.unwrap();
        assert_eq!(restarted_calls.get(), 1);
        restarted.dispose();
    });
}

#[test]
fn adds_a_new_inventory_tool_through_one_validated_descriptor_without_changing_inventory_orchestration()
 {
    run_local(async {
        let inventory = create_local_agent_inventory(LocalAgentInventoryOptions {
            read_environment: Some(provided_environment()),
            tool_descriptors: Some(vec![LocalAgentToolDescriptor {
                id: "claude-code".into(),
                installation_id: None,
                display_name: "Claude Code".into(),
                executable_names: Some(vec!["claude".into()]),
                probe: Some(probe_returning(json!({
                    "id": "claude-code",
                    "displayName": "Claude Code",
                    "installation": "detected",
                    "version": "2.1.0",
                    "authentication": "signed-in",
                    "protocolCompatible": true,
                    "hasModels": true,
                    "source": "user-installation",
                }))),
                unavailable_message: "Claude Code native SDK is unavailable.".into(),
            }]),
            resolve_candidate: Some(resolve_fixed("/tools/claude")),
            ..Default::default()
        })
        .unwrap();
        let snapshot = inventory.discover(true, None).await.unwrap();
        let connections = snapshot["connections"].as_array().unwrap();
        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0]["id"], "claude-code");
        assert_eq!(connections[0]["displayName"], "Claude Code");
        assert_eq!(connections[0]["integration"], "ready");
        assert_eq!(connections[0]["selectable"], true);
        assert!(
            connections[0]["statusMessage"]
                .as_str()
                .unwrap()
                .contains("ready for native Agent sessions")
        );
        inventory.dispose();
    });
}

// ---------------------------------------------------------------------------
// Local connection characterization (the product's snapshots, regenerated
// from `local-agent-connection-policy.mjs`).

#[test]
fn preserves_the_local_connection_characterization() {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../fixtures/agent/connections/local-connection-policy.json"
    ))
    .unwrap();
    assert_eq!(cases.len(), 26);
    for case in cases {
        let probe = Some(&case["probe"]).filter(|p| !p.is_null());
        let gates = Some(&case["gates"]).filter(|g| !g.is_null());
        assert_eq!(
            derive_local_connection(probe, gates),
            case["expected"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn does_not_read_admission_gates_before_the_probe_is_ready() {
    let probe = crate::agent::contract::js::with(&ready_codex(), "installation", "not-found");
    assert_eq!(
        derive_local_connection(Some(&probe), Some(&Value::Null))["integration"],
        "inventory-only"
    );
}

#[test]
fn does_not_read_the_workspace_gate_after_backend_denial() {
    let gates = json!({ "backendRegistered": false });
    assert_eq!(
        derive_local_connection(Some(&ready_codex()), Some(&gates))["integration"],
        "setup-required"
    );
}

#[test]
fn accepts_a_real_cursor_shaped_cli_whose_version_and_status_each_exceed_the_generic_probe_budget()
{
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("cursor-agent");
        executable(
            &script,
            "#!/bin/sh\nsleep 1.8\nif [ \"$1\" = \"--version\" ]; then printf '2026.10.01-e373342'; else printf 'Authenticated as private@example.test'; fi\n",
        );
        let candidate = resolve_first_executable(ObservationRequest {
            names: vec!["cursor-agent".into()],
            configured_paths: vec![script.to_string_lossy().into_owned()],
            platform: crate::agent::discovery::bounded_process_probe::node_platform().into(),
            ..Default::default()
        })
        .await
        .unwrap()
        .unwrap();
        let cursor = crate::agent::runtimes::cursor::cursor_discovery::discover_cursor_backend(
            crate::agent::runtimes::cursor::cursor_discovery::CursorDiscoveryOptions {
                resolve_candidate: Some(Rc::new(move || {
                    let candidate = candidate.clone();
                    Box::pin(async move { Ok(Some(candidate)) })
                })),
                env: Some(EnvMap::from([("PATH".into(), "/usr/bin:/bin".into())])),
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(cursor["status"], "ready");
        assert_eq!(cursor["code"], "READY");
        assert_eq!(cursor["selectable"], true);
        assert!(!cursor.to_string().contains("private@example.test"));
    });
}

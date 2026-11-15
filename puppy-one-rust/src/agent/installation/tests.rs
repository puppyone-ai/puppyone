//! The resolver half of
//! `tests/integration/agent/runtimes/discovery/electron.agent-local-inventory.test.mjs`,
//! plus the installation-registry and probe boundaries, on a real file
//! system.
use super::executable_resolver::{
    LocalAgentExecutableResolver, Observation, ObservationRequest, ResolvedCandidate,
    assert_executable_identity, resolve_first_executable,
};
use super::installation_definition::NameSpec;
use crate::agent::application::tests_support::run_local;
use crate::agent::discovery::bounded_process_probe::{
    ProbeOptions, ProbeResult, run_bounded_process_probe,
};
use crate::agent::discovery::command_environment::{
    EnvMap, EnvironmentSnapshot, ReadEnvironmentOptions, read_user_command_environment,
};
use crate::agent::discovery::executable_discovery_port::{
    DiscoveryPortOptions, ExecutableDiscoveryPort, ReadEnvironment,
};
use crate::agent::tasks::Canceller;
use core::prelude::v1::test;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;

fn temporary_directory() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::Builder::new()
        .prefix("puppyone-inventory-")
        .tempdir()
        .unwrap();
    let path = directory.path().to_path_buf();
    (directory, path)
}

fn executable(path: &Path, body: &str) -> String {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path.to_string_lossy().into_owned()
}

fn names(values: &[&str]) -> Vec<NameSpec> {
    values.iter().map(|value| NameSpec::from(*value)).collect()
}

fn env(pairs: &[(&str, &str)]) -> EnvMap {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn platform() -> String {
    crate::agent::discovery::bounded_process_probe::node_platform().into()
}

#[test]
fn finds_the_first_named_executable_in_the_supplied_path() {
    run_local(async {
        let (_guard, home) = temporary_directory();
        let bin = home.join(".local").join("bin");
        let cursor_agent = executable(&bin.join("cursor-agent"), "echo cursor");
        std::os::unix::fs::symlink(&cursor_agent, bin.join("agent")).unwrap();
        let candidate = resolve_first_executable(ObservationRequest {
            names: names(&["cursor-agent", "agent"]),
            env: env(&[("PATH", &bin.to_string_lossy())]),
            platform: platform(),
            ..Default::default()
        })
        .await
        .unwrap()
        .unwrap();
        let canonical = std::fs::canonicalize(&cursor_agent)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(candidate.invoked_as, "cursor-agent");
        assert_eq!(candidate.executable_path, cursor_agent);
        assert_eq!(candidate.canonical_identity, canonical);
        assert_eq!(candidate.source, "path-installation");
        assert_eq!(
            assert_executable_identity(&candidate).await.unwrap(),
            cursor_agent
        );
    });
}

#[test]
fn rejects_a_candidate_whose_canonical_identity_changes_before_launch() {
    run_local(async {
        let (_guard, home) = temporary_directory();
        let first = executable(&home.join("first"), "true");
        let second = executable(&home.join("second"), "true");
        let error = assert_executable_identity(&ResolvedCandidate {
            executable_path: first,
            canonical_identity: second,
            ..Default::default()
        })
        .await
        .unwrap_err();
        assert!(error.message.to_lowercase().contains("changed identity"));
    });
}

#[test]
fn accepts_configured_paths_with_spaces_and_skips_broken_or_non_executable_candidates() {
    run_local(async {
        let (_guard, home) = temporary_directory();
        let configured = executable(&home.join("CLI tools").join("codex"), "true");
        let resolved = resolve_first_executable(ObservationRequest {
            names: names(&["codex"]),
            configured_paths: vec![configured],
            env: env(&[("PATH", "")]),
            platform: platform(),
            ..Default::default()
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(resolved.invoked_as, "codex");
        assert_eq!(resolved.source, "configured");
        let bin = home.join(".local").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("plain"), "not executable").unwrap();
        std::os::unix::fs::symlink(home.join("missing"), bin.join("broken")).unwrap();
        let request = |path: &str| ObservationRequest {
            names: names(&["broken", "plain"]),
            env: env(&[("PATH", path)]),
            platform: platform(),
            ..Default::default()
        };
        assert_eq!(resolve_first_executable(request("")).await.unwrap(), None);
        // On PATH, the broken link is skipped and the plain file is evidence.
        assert_eq!(
            crate::agent::installation::executable_resolver::resolve_executable_observation(
                request(&bin.to_string_lossy())
            )
            .await
            .unwrap(),
            Observation::Failed {
                reason_code: "permission-denied".into()
            }
        );
    });
}

fn provided_environment(complete: bool) -> ReadEnvironment {
    Rc::new(move |env, _, _, _| {
        Box::pin(async move {
            Ok(EnvironmentSnapshot {
                environment: env,
                complete,
                source: "provided".into(),
                reason_code: (!complete).then(|| "environment-unavailable".into()),
            })
        })
    })
}

fn resolver(home: &Path, path: &str, complete: bool) -> LocalAgentExecutableResolver {
    LocalAgentExecutableResolver::new(
        None,
        ExecutableDiscoveryPort::new(DiscoveryPortOptions {
            node_platform: Some(platform()),
            env: Some(env(&[("PATH", path), ("HOME", &home.to_string_lossy())])),
            homedir: Some(home.to_path_buf()),
            read_environment: Some(provided_environment(complete)),
            find_registered_applications: None,
        }),
    )
}

#[test]
fn resolves_product_fallbacks_and_reports_an_incomplete_environment() {
    run_local(async {
        let (_guard, home) = temporary_directory();
        let codex = executable(
            &home.join(".local").join("bin").join("codex"),
            "echo codex-cli 0.144.1",
        );
        let observation = resolver(&home, "", true)
            .resolve("codex", None, Vec::new())
            .await
            .unwrap();
        let Observation::Found {
            candidate,
            reason_code,
        } = observation
        else {
            panic!("codex was not found");
        };
        assert_eq!(candidate.executable_path, codex);
        assert_eq!(candidate.source, "product-fallback");
        assert_eq!(candidate.environment_source.as_deref(), Some("provided"));
        assert_eq!(reason_code, None);
        let Observation::Found { reason_code, .. } = resolver(&home, "", false)
            .resolve("codex", None, Vec::new())
            .await
            .unwrap()
        else {
            panic!("codex was not found");
        };
        assert_eq!(reason_code.as_deref(), Some("environment-unavailable"));
        assert_eq!(
            resolver(&home, "", false)
                .resolve("hermes", None, Vec::new())
                .await
                .unwrap(),
            Observation::Failed {
                reason_code: "environment-unavailable".into()
            }
        );
        assert_eq!(
            resolver(&home, "", true)
                .resolve("unknown", None, Vec::new())
                .await
                .unwrap(),
            Observation::Failed {
                reason_code: "unknown-agent".into()
            }
        );
    });
}

#[test]
fn verifies_ambiguous_invocations_and_never_searches_path_for_workbuddy() {
    run_local(async {
        let (_guard, home) = temporary_directory();
        let bin = home.join("bin");
        executable(&bin.join("agent"), "echo some other agent");
        let path = bin.to_string_lossy().into_owned();
        assert_eq!(
            resolver(&home, &path, true)
                .resolve("cursor", None, Vec::new())
                .await
                .unwrap(),
            Observation::Failed {
                reason_code: "identity-mismatch".into()
            }
        );
        executable(&bin.join("agent"), "# CURSOR_INVOKED_AS=agent");
        let Observation::Found { candidate, .. } = resolver(&home, &path, true)
            .resolve("cursor", None, Vec::new())
            .await
            .unwrap()
        else {
            panic!("cursor was not found");
        };
        assert_eq!(candidate.invoked_as, "agent");
        executable(&bin.join("codebuddy"), "# codebuddy code");
        // Only the desktop app's own CLI (or a routed override) can be chosen,
        // even when this machine has WorkBuddy installed.
        let observation = resolver(&home, &path, true)
            .resolve("workbuddy-china", None, Vec::new())
            .await
            .unwrap();
        match observation {
            Observation::NotFound { .. } => {}
            Observation::Found { candidate, .. } => {
                assert_eq!(candidate.source, "product-fallback");
                assert!(candidate.executable_path.contains("/WorkBuddy.app/"));
            }
            other => panic!("unexpected {other:?}"),
        }
    });
}

#[test]
fn kills_a_probe_that_exceeds_its_timeout_or_combined_output_budget() {
    run_local(async {
        let timeout = run_bounded_process_probe(
            "/bin/sleep",
            &["5".into()],
            ProbeOptions {
                timeout_ms: 50,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(timeout.message.contains("timed out"));
        let overflow = run_bounded_process_probe(
            "/bin/sh",
            &["-c".into(), "printf '%040d' 0".into()],
            ProbeOptions {
                max_output_bytes: 32,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(overflow.message.contains("safety limit"));
        let controller = Canceller::new();
        controller.cancel(crate::agent::agent_error::AgentError::new("stop"));
        let cancelled = run_bounded_process_probe(
            "/bin/sleep",
            &["5".into()],
            ProbeOptions {
                signal: Some(controller.signal()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(cancelled.message.contains("was cancelled"));
        assert!(
            run_bounded_process_probe("relative", &[], ProbeOptions::default())
                .await
                .is_err()
        );
        assert_eq!(
            run_bounded_process_probe(
                "/bin/sh",
                &["-c".into(), "echo out; echo err >&2; exit 3".into()],
                ProbeOptions::default()
            )
            .await
            .unwrap(),
            ProbeResult {
                stdout: "out\n".into(),
                stderr: "err\n".into(),
                code: Some(3),
                signal: None,
            }
        );
    });
}

#[test]
fn reads_the_login_shell_environment_between_private_markers() {
    run_local(async {
        let (_guard, home) = temporary_directory();
        let base = env(&[
            ("SHELL", "/bin/zsh"),
            ("PATH", "/usr/bin"),
            ("DISABLE_AUTO_UPDATE", "keep"),
        ]);
        let framed: crate::agent::discovery::bounded_process_probe::ProbeRunner = Rc::new(
            |file, args, options| {
                Box::pin(async move {
                    assert_eq!(file, "/bin/zsh");
                    assert_eq!(args[0], "-ilc");
                    assert!(options.isolated_process_group);
                    let marker = args[1]
                        .split('\'')
                        .nth(1)
                        .unwrap()
                        .trim_start_matches("\\0")
                        .trim_end_matches("\\0")
                        .to_string();
                    let end = marker.replace("-begin", "-end");
                    Ok(ProbeResult {
                        stdout: format!(
                            "motd\0{marker}\0PATH=/opt/bin:/usr/bin\0BAD KEY=x\0PUPPYONE_RESOLVING_ENVIRONMENT=1\0DISABLE_AUTO_UPDATE=true\0\0{end}\0"
                        ),
                        stderr: String::new(),
                        code: Some(0),
                        signal: None,
                    })
                })
            },
        );
        let snapshot = read_user_command_environment(ReadEnvironmentOptions {
            env: base.clone(),
            platform: "darwin".into(),
            homedir: home.clone(),
            signal: None,
            run_probe: Some(framed),
            timeout_ms: None,
        })
        .await
        .unwrap();
        assert!(snapshot.complete);
        assert_eq!(snapshot.source, "shell-environment");
        assert_eq!(
            snapshot.environment,
            env(&[
                ("PATH", "/opt/bin:/usr/bin"),
                ("DISABLE_AUTO_UPDATE", "keep")
            ])
        );
        let failing: crate::agent::discovery::bounded_process_probe::ProbeRunner =
            Rc::new(|_, _, _| {
                Box::pin(async {
                    Ok(ProbeResult {
                        code: Some(1),
                        ..Default::default()
                    })
                })
            });
        let snapshot = read_user_command_environment(ReadEnvironmentOptions {
            env: base.clone(),
            platform: "darwin".into(),
            homedir: home,
            signal: None,
            run_probe: Some(failing),
            timeout_ms: None,
        })
        .await
        .unwrap();
        assert!(!snapshot.complete);
        assert_eq!(snapshot.source, "inherited-environment");
        assert_eq!(
            snapshot.reason_code.as_deref(),
            Some("environment-unavailable")
        );
        assert_eq!(snapshot.environment, base);
    });
}

#[test]
fn timed_out_and_combined_output_overflow_probes_reap_the_actual_child() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        for (name, body, budget, expected) in [
            (
                "timeout",
                "printf '%s' \"$$\" > \"$1\"; exec /bin/sleep 60",
                16 * 1024,
                "timed out",
            ),
            (
                "overflow",
                "printf '%s' \"$$\" > \"$1\"; printf 01234567890123456789; printf 01234567890123456789 >&2; exec /bin/sleep 60",
                32,
                "safety limit",
            ),
        ] {
            let pid_file = directory.path().join(name);
            let error = run_bounded_process_probe(
                "/bin/sh",
                &[
                    "-c".into(),
                    body.into(),
                    "probe".into(),
                    pid_file.to_string_lossy().into_owned(),
                ],
                ProbeOptions {
                    timeout_ms: 500,
                    max_output_bytes: budget,
                    ..Default::default()
                },
            )
            .await
            .unwrap_err();
            assert!(error.message.contains(expected), "{}", error.message);
            let pid: i32 = std::fs::read_to_string(&pid_file).unwrap().parse().unwrap();
            // Signal zero checks existence without signalling or changing the child.
            assert_eq!(
                unsafe { libc::kill(pid, 0) },
                -1,
                "probe child {pid} survived {name}"
            );
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH)
            );
        }
    });
}

#[test]
fn cancellation_reaps_a_probe_after_its_output_pipes_close() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let pid_file = directory.path().join("pid");
        let controller = Canceller::new();
        let options = ProbeOptions {
            signal: Some(controller.signal()),
            timeout_ms: 2_000,
            ..Default::default()
        };
        let path = pid_file.to_string_lossy().into_owned();
        let running = tokio::task::spawn_local(async move {
            run_bounded_process_probe(
                "/bin/sh",
                &[
                    "-c".into(),
                    "exec 1>&- 2>&-; printf '%s' \"$$\" > \"$1\"; exec /bin/sleep 60".into(),
                    "probe".into(),
                    path,
                ],
                options,
            )
            .await
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        let pid: i32 = loop {
            if let Ok(text) = std::fs::read_to_string(&pid_file)
                && let Ok(pid) = text.parse()
            {
                break pid;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "child did not close its output pipes"
            );
            tokio::task::yield_now().await;
        };
        controller.cancel(crate::agent::agent_error::AgentError::new(
            "inventory cancelled",
        ));
        let error = running.await.unwrap().unwrap_err();
        assert!(error.message.contains("was cancelled"), "{}", error.message);
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            -1,
            "cancelled child survived"
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    });
}

#[test]
fn an_already_cancelled_probe_never_spawns_the_native_executable() {
    run_local(async {
        let (_guard, home) = temporary_directory();
        let marker = home.join("started");
        let cli = executable(&home.join("probe"), "touch \"$1\"");
        let controller = Canceller::new();
        controller.cancel(crate::agent::agent_error::AgentError::new(
            "cancel before start",
        ));
        let error = run_bounded_process_probe(
            &cli,
            &[marker.to_string_lossy().into()],
            ProbeOptions {
                signal: Some(controller.signal()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(error.message.contains("was cancelled"));
        assert!(
            !marker.exists(),
            "pre-cancelled discovery spawned the executable"
        );
    });
}

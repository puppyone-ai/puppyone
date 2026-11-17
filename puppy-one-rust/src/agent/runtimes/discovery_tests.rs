//! Native backend discovery acceptance, including real temporary CLI probes.
use super::claude::claude_discovery::{
    CLAUDE_CODE_TESTED_BASELINE, ClaudeDiscoveryOptions, discover_claude_runtime,
    parse_claude_version,
};
use super::cursor::cursor_discovery::{CursorDiscoveryOptions, discover_cursor_backend};
use super::opencode_native::opencode_native_discovery::build_user_open_code_environment;
use crate::agent::application::tests_support::{installed_shell_fixture, run_local};
use crate::agent::discovery::bounded_process_probe::{ProbeRunner, default_probe_runner};
use crate::agent::discovery::command_environment::{EnvMap, EnvironmentSnapshot};
use crate::agent::installation::executable_resolver::ResolvedCandidate;
use crate::agent::runtime::agent_runtime_registry::{
    RuntimeCatalogEntry, public_runtime_readiness,
};
use core::prelude::v1::test;
use serde_json::json;
use std::cell::RefCell;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::rc::Rc;

#[test]
fn claude_versions_require_an_explicit_version_line() {
    assert_eq!(
        parse_claude_version("1.0.73 (Claude Code)\n").as_deref(),
        Some("1.0.73")
    );
    assert_eq!(
        parse_claude_version("Claude Code 2.1.159\n").as_deref(),
        Some("2.1.159")
    );
    assert_eq!(
        parse_claude_version("Error: denied\nNode.js v22.17.0\n"),
        None
    );
}

#[test]
fn native_opencode_keeps_the_users_profile_separate_from_the_managed_agent() {
    let environment = build_user_open_code_environment(
        &EnvMap::from([
            ("HOME".into(), "/home/user".into()),
            ("PATH".into(), "/usr/bin".into()),
            (
                "OPENCODE_CONFIG_DIR".into(),
                "/home/user/.config/opencode-custom".into(),
            ),
            (
                "OPENCODE_TEST_HOME".into(),
                "/home/user/.opencode-test-home".into(),
            ),
            ("XDG_CONFIG_HOME".into(), "/home/user/.config".into()),
        ]),
        &EnvMap::from([("OPENCODE_API_KEY".into(), "fixture-key".into())]),
        "darwin",
    );
    for (key, value) in [
        ("OPENCODE_CONFIG_DIR", "/home/user/.config/opencode-custom"),
        ("OPENCODE_TEST_HOME", "/home/user/.opencode-test-home"),
        ("XDG_CONFIG_HOME", "/home/user/.config"),
        ("OPENCODE_API_KEY", "fixture-key"),
        ("PUPPYONE_AGENT_BACKEND", "opencode-native"),
        ("OPENCODE_DISABLE_PROJECT_CONFIG", "1"),
    ] {
        assert_eq!(environment[key], value);
    }
    assert!(!environment.contains_key("OPENCODE_PURE"));
}

#[test]
fn authenticated_cursor_is_selectable_through_its_acp_entrypoint() {
    run_local(async {
        let readiness = discover_cursor_backend(CursorDiscoveryOptions {
            resolve_candidate: Some(Rc::new(|| Box::pin(async { Ok(Some(ResolvedCandidate { executable_path: "/usr/local/bin/cursor-agent".into(), source: "user-installation".into(), ..Default::default() })) }))),
            probe: Some(Rc::new(|_, _| Box::pin(async { json!({ "installation": "detected", "version": "2026.07.09", "authentication": "signed-in", "source": "user-installation" }) }))),
            env: Some(EnvMap::new()), ..Default::default()
        }, None).await.unwrap();
        assert_eq!(readiness["runtimeId"], "cursor");
        assert_eq!(readiness["status"], "ready");
        assert_eq!(readiness["compatibility"], "acp-v1");
        let public = public_runtime_readiness(&RuntimeCatalogEntry {
            descriptor: json!({ "id": "cursor" }),
            readiness,
        })
        .unwrap();
        assert_eq!(public["status"], "ready");
        assert_eq!(public["selectable"], true);
    });
}

#[test]
fn bundled_sdk_never_substitutes_for_a_missing_claude_cli() {
    run_local(async {
        let readiness = discover_claude_runtime(ClaudeDiscoveryOptions {
            discover: Some(Rc::new(|_| Box::pin(async { Ok(json!({ "status": "not-installed", "code": "RUNTIME_NOT_INSTALLED", "executablePath": null, "environment": {}, "message": "not installed" })) }))),
            env: Some(EnvMap::new()), ..Default::default()
        }, None).await.unwrap();
        assert_eq!(readiness["status"], "not-installed");
        assert_eq!(readiness["source"], "missing");
        assert!(readiness["executablePath"].is_null());
        assert_eq!(
            readiness["minimumVersion"],
            json!(CLAUDE_CODE_TESTED_BASELINE)
        );
    });
}

#[test]
fn claude_version_and_capability_probes_use_private_disposable_profiles() {
    run_local(async {
        for (version, help, compatible) in [
            (
                "2.1.159",
                "--input-format --output-format --setting-sources --permission-mode",
                true,
            ),
            (
                "1.0.73",
                "--input-format --output-format --permission-mode",
                false,
            ),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let bin = directory.path().join("bin");
            let tmp = directory.path().join("probes");
            let profile = directory.path().join("profile");
            for path in [&bin, &tmp, &profile] {
                std::fs::create_dir(path).unwrap();
            }
            let sentinel = profile.join("settings.json");
            std::fs::write(&sentinel, b"keep user profile\n").unwrap();
            let cli = bin.join("claude");
            installed_shell_fixture(
                &cli,
                &format!(
                    "#!/bin/sh\nif [ \"$1\" = --version ]; then echo '{version} (Claude Code)'; else echo '{help}'; fi\n"
                ),
            );
            let probes = Rc::new(RefCell::new(Vec::new()));
            let captured = probes.clone();
            let real = default_probe_runner();
            let run_probe: ProbeRunner = Rc::new(move |file, args, options| {
                let env = options.env.as_ref().unwrap();
                let path = Path::new(&env["CLAUDE_CONFIG_DIR"]);
                assert!(path.is_dir());
                assert_eq!(path.metadata().unwrap().permissions().mode() & 0o777, 0o700);
                captured
                    .borrow_mut()
                    .push((args.clone(), path.to_path_buf()));
                real(file, args, options)
            });
            let readiness = discover_claude_runtime(
                ClaudeDiscoveryOptions {
                    env: Some(EnvMap::from([
                        ("PATH".into(), bin.to_string_lossy().into_owned()),
                        (
                            "HOME".into(),
                            directory.path().to_string_lossy().into_owned(),
                        ),
                        (
                            "CLAUDE_CONFIG_DIR".into(),
                            profile.to_string_lossy().into_owned(),
                        ),
                    ])),
                    homedir: Some(directory.path().to_path_buf()),
                    platform: Some("darwin".into()),
                    tmpdir: Some(tmp.clone()),
                    run_probe: Some(run_probe),
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
                    ..Default::default()
                },
                None,
            )
            .await
            .unwrap();
            assert_eq!(
                readiness["version"],
                version,
                "status={} code={} diagnostic={} message={}",
                readiness["status"],
                readiness["code"],
                readiness["diagnostic"],
                readiness["message"]
            );
            assert_eq!(
                readiness["minimumVersion"],
                json!(CLAUDE_CODE_TESTED_BASELINE)
            );
            assert_eq!(
                readiness["environment"]["CLAUDE_CONFIG_DIR"],
                profile.to_string_lossy().as_ref()
            );
            assert_eq!(readiness["source"], "user-installed");
            assert_eq!(
                readiness["status"],
                if compatible {
                    "ready"
                } else {
                    "protocol-unavailable"
                }
            );
            if !compatible {
                assert_eq!(readiness["compatibility"], "unavailable");
                assert!(
                    readiness["message"]
                        .as_str()
                        .unwrap()
                        .contains("secure streaming controls")
                );
            }
            let probes = probes.borrow();
            assert_eq!(probes.len(), 2);
            assert_eq!(probes[0].0, ["--version"]);
            assert_eq!(probes[1].0, ["--help"]);
            assert_ne!(probes[0].1, probes[1].1);
            for (_, path) in probes.iter() {
                assert!(path.starts_with(&tmp));
                assert_ne!(path, &profile);
                assert!(!path.exists(), "probe profile leaked");
            }
            assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 0);
            assert_eq!(std::fs::read(&sentinel).unwrap(), b"keep user profile\n");
        }
    });
}

//! Real filesystem acceptance from electron.local-executable-resolver.test.mjs.
use super::executable_resolver::{
    LocalAgentExecutableResolver, Observation, ResolvedCandidate, assert_executable_identity,
};
use super::installation_definition::CandidateContext;
use super::installation_registry::{
    InstallationRegistry, create_local_agent_installation_registry,
    default_installation_definitions,
};
use crate::agent::application::tests_support::run_local;
use crate::agent::discovery::command_environment::{EnvMap, EnvironmentSnapshot};
use crate::agent::discovery::executable_discovery_port::{
    DiscoveryPortOptions, ExecutableDiscoveryPort, ReadEnvironment,
};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;
use std::rc::Rc;

mod environment;

fn executable(path: &Path, body: &str) -> String {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path.to_string_lossy().into_owned()
}
const SCRIPT: &str = "#!/bin/sh\n# pi-coding-agent cursor-agent\n";
fn provided(complete: bool) -> ReadEnvironment {
    Rc::new(move |environment, _, _, _| {
        Box::pin(async move {
            Ok(EnvironmentSnapshot {
                environment,
                complete,
                source: "provided".into(),
                reason_code: (!complete).then(|| "environment-unavailable".into()),
            })
        })
    })
}
fn registry(ids: &[&str]) -> InstallationRegistry {
    create_local_agent_installation_registry(
        default_installation_definitions()
            .into_iter()
            .filter(|d| ids.contains(&d.id.as_str()))
            .collect(),
    )
    .unwrap()
}
fn resolver(
    home: &Path,
    env: EnvMap,
    platform: &str,
    read: ReadEnvironment,
    registry: Option<InstallationRegistry>,
) -> Rc<LocalAgentExecutableResolver> {
    Rc::new(LocalAgentExecutableResolver::new(
        registry,
        ExecutableDiscoveryPort::new(DiscoveryPortOptions {
            env: Some(env),
            homedir: Some(home.into()),
            node_platform: Some(platform.into()),
            read_environment: Some(read),
            find_registered_applications: Some(Rc::new(|_, _| Box::pin(async { Ok(vec![]) }))),
        }),
    ))
}
async fn found(resolver: &LocalAgentExecutableResolver, id: &str) -> ResolvedCandidate {
    let result = resolver.resolve(id, None, vec![]).await.unwrap();
    let Observation::Found { candidate, .. } = result else {
        panic!("{id}: {result:?}")
    };
    *candidate
}
fn path_env(path: &Path) -> EnvMap {
    EnvMap::from([("PATH".into(), path.to_string_lossy().into_owned())])
}

#[test]
fn every_path_discoverable_product_accepts_an_arbitrary_spaced_directory() {
    run_local(async {
        for id in ["codex", "claude", "pi", "cursor", "opencode", "hermes"] {
            let home = tempfile::tempdir().unwrap();
            let bin = home.path().join("entirely custom/tools");
            let file = executable(
                &bin.join(if id == "cursor" { "cursor-agent" } else { id }),
                SCRIPT,
            );
            let resolver = resolver(home.path(), path_env(&bin), "linux", provided(true), None);
            let candidate = found(&resolver, id).await;
            assert_eq!(candidate.executable_path, file, "{id}");
            assert_eq!(
                candidate.canonical_identity,
                std::fs::canonicalize(&file).unwrap().to_string_lossy()
            );
            assert_eq!(candidate.source, "path-installation");
        }
    });
}

#[test]
fn selected_path_wins_over_newer_shims_and_fallbacks_and_inactive_nvm_is_not_searched() {
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let first = executable(&home.path().join("selected-version/codex"), SCRIPT);
        executable(&home.path().join("newer-but-not-selected/codex"), SCRIPT);
        executable(&home.path().join(".local/bin/codex"), SCRIPT);
        let path = format!(
            "{}:{}",
            home.path().join("selected-version").display(),
            home.path().join("newer-but-not-selected").display()
        );
        let r = resolver(
            home.path(),
            EnvMap::from([("PATH".into(), path)]),
            "linux",
            provided(true),
            None,
        );
        assert_eq!(found(&r, "codex").await.executable_path, first);
        let inactive = tempfile::tempdir().unwrap();
        executable(
            &inactive
                .path()
                .join(".nvm/versions/node/v999.0.0/bin/codex"),
            SCRIPT,
        );
        let r = resolver(
            inactive.path(),
            EnvMap::from([("PATH".into(), String::new())]),
            "linux",
            provided(true),
            None,
        );
        assert!(matches!(
            r.resolve("codex", None, vec![]).await.unwrap(),
            Observation::NotFound { .. }
        ));
    });
}

#[test]
fn invalid_explicit_overrides_fail_but_installer_directory_hints_do_not_override_path() {
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join("bin");
        executable(&bin.join("codex"), SCRIPT);
        executable(&bin.join("pi"), SCRIPT);
        let mut env = path_env(&bin);
        env.insert(
            "CODEX_PATH".into(),
            home.path().join("missing-codex").to_string_lossy().into(),
        );
        let r = resolver(home.path(), env, "linux", provided(true), None);
        assert_eq!(
            r.resolve("codex", None, vec![]).await.unwrap(),
            Observation::Failed {
                reason_code: "configured-path-not-found".into()
            }
        );
        for key in [
            "CODEX_INSTALL_DIR",
            "PI_CODING_AGENT_DIR",
            "PI_MANAGED_INSTALL_ROOT",
        ] {
            let mut env = path_env(&bin);
            env.insert(
                key.into(),
                home.path()
                    .join("installer-directory")
                    .to_string_lossy()
                    .into(),
            );
            let r = resolver(home.path(), env, "linux", provided(true), None);
            let id = if key == "CODEX_INSTALL_DIR" {
                "codex"
            } else {
                "pi"
            };
            assert_eq!(
                found(&r, id).await.executable_path,
                bin.join(id).to_string_lossy()
            );
        }
    });
}

#[test]
fn documented_product_fallbacks_remain_available_without_path() {
    run_local(async {
        for (id, path) in [
            ("codex", ".local/bin/codex"),
            ("claude", ".local/bin/claude"),
            ("claude", ".claude/local/claude"),
            ("pi", ".pi/agent/bin/pi"),
            ("pi", ".local/bin/pi"),
        ] {
            let home = tempfile::tempdir().unwrap();
            let file = executable(&home.path().join(path), SCRIPT);
            let r = resolver(
                home.path(),
                EnvMap::from([("PATH".into(), String::new())]),
                "linux",
                provided(true),
                None,
            );
            let candidate = found(&r, id).await;
            assert_eq!(candidate.executable_path, file);
            assert_eq!(candidate.source, "product-fallback");
        }
    });
}

#[test]
fn pi_package_identities_preserve_symlink_entrypoints_and_reject_retargeted_links() {
    run_local(async {
        for scope in ["@earendil-works", "@mariozechner"] {
            let home = tempfile::tempdir().unwrap();
            let package = home
                .path()
                .join("node_modules")
                .join(scope)
                .join("pi-coding-agent");
            let target = executable(&package.join("dist/cli.js"), "#!/usr/bin/env node\n");
            std::fs::write(
                package.join("package.json"),
                serde_json::json!({"name":format!("{scope}/pi-coding-agent")}).to_string(),
            )
            .unwrap();
            let bin = home.path().join("bin");
            std::fs::create_dir(&bin).unwrap();
            let entry = bin.join("pi");
            symlink(&target, &entry).unwrap();
            let r = resolver(home.path(), path_env(&bin), "linux", provided(true), None);
            let candidate = found(&r, "pi").await;
            assert_eq!(candidate.executable_path, entry.to_string_lossy());
            assert_eq!(
                candidate.canonical_identity,
                std::fs::canonicalize(target).unwrap().to_string_lossy()
            );
            assert_eq!(
                assert_executable_identity(&candidate).await.unwrap(),
                entry.to_string_lossy()
            );
            std::fs::remove_file(&entry).unwrap();
            symlink(executable(&home.path().join("replacement"), SCRIPT), &entry).unwrap();
            assert!(
                assert_executable_identity(&candidate)
                    .await
                    .unwrap_err()
                    .message
                    .contains("changed identity")
            );
        }
    });
}

#[test]
fn ambiguous_unrelated_commands_are_rejected_and_workbuddy_channels_stay_separate() {
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join("bin");
        for name in ["pi", "agent", "codebuddy"] {
            executable(&bin.join(name), "#!/bin/sh\n# unrelated application\n");
        }
        let r = resolver(home.path(), path_env(&bin), "linux", provided(true), None);
        for id in ["pi", "cursor"] {
            assert_eq!(
                r.resolve(id, None, vec![]).await.unwrap(),
                Observation::Failed {
                    reason_code: "identity-mismatch".into()
                }
            );
        }
        for id in ["workbuddy-china", "workbuddy-international"] {
            assert!(matches!(
                r.resolve(id, None, vec![]).await.unwrap(),
                Observation::NotFound { .. }
            ));
        }
        let mut env = path_env(&bin);
        let china = executable(&home.path().join("china/codebuddy"), SCRIPT);
        env.insert("WORKBUDDY_CHINA_CODE_PATH".into(), china.clone());
        let r = resolver(home.path(), env, "linux", provided(true), None);
        assert_eq!(found(&r, "workbuddy-china").await.executable_path, china);
        assert!(matches!(
            r.resolve("workbuddy-international", None, vec![])
                .await
                .unwrap(),
            Observation::NotFound { .. }
        ));
    });
}

#[test]
fn workbuddy_definitions_keep_channel_overrides_and_exact_desktop_app_entrypoints() {
    use super::definitions::workbuddy::*;
    for (definition, overrides, expected, excluded) in [
        (
            work_buddy_china_installation_definition(),
            vec![
                ("WORKBUDDY_CHINA_CODE_PATH", "/opt/china/codebuddy"),
                ("CODEBUDDY_CODE_PATH", "/opt/routed/codebuddy"),
                ("CODEBUDDY_INTERNET_ENVIRONMENT", "internal"),
            ],
            vec![
                "/opt/china/codebuddy",
                "/opt/routed/codebuddy",
                "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
            ],
            "WorkBuddy AI.app",
        ),
        (
            work_buddy_international_installation_definition(),
            vec![(
                "WORKBUDDY_INTERNATIONAL_CODE_PATH",
                "/opt/international/codebuddy",
            )],
            vec![
                "/opt/international/codebuddy",
                "/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
            ],
            "WorkBuddy.app",
        ),
    ] {
        let env = overrides
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .collect();
        let context = CandidateContext {
            env: &env,
            homedir: Path::new("/Users/fixture"),
            platform: "darwin",
            registered_applications: &[],
        };
        let candidates = (definition.candidate_paths.unwrap())(&context).unwrap();
        for path in expected {
            assert!(
                candidates.iter().any(|c| c.path == path
                    && c.source
                        == if path.starts_with("/Applications/") {
                            "product-fallback"
                        } else {
                            "environment-override"
                        }),
                "{path}"
            );
        }
        assert!(!candidates.iter().any(|c| c.path.contains(excluded)));
    }
}

#[test]
fn search_budget_failure_is_explicit_and_windows_extensions_follow_pathext_order() {
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let path = (0..=super::executable_resolver::limits::MAX_PATH_DIRECTORIES)
            .map(|i| format!("/tools/{i}"))
            .collect::<Vec<_>>()
            .join(":");
        let r = resolver(
            home.path(),
            EnvMap::from([("PATH".into(), path)]),
            "linux",
            provided(true),
            None,
        );
        assert!(
            r.create_context(None)
                .await
                .err()
                .expect("path budget must reject")
                .message
                .contains("budget")
        );
        for id in ["codex", "claude", "pi"] {
            let bin = home.path().join(id).join("npm commands");
            let cmd = executable(&bin.join(format!("{id}.cmd")), SCRIPT);
            executable(&bin.join(format!("{id}.exe")), SCRIPT);
            let mut env = path_env(&bin);
            env.insert("PATHEXT".into(), ".CMD;.EXE".into());
            let r = resolver(home.path(), env, "win32", provided(true), None);
            assert_eq!(found(&r, id).await.executable_path, cmd);
        }
    });
}

#[test]
fn windows_codex_standalone_fallback_does_not_require_path() {
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let local = home.path().join("Local App Data");
        let file = executable(&local.join("Programs/OpenAI/Codex/bin/codex.exe"), SCRIPT);
        let env = EnvMap::from([
            ("PATH".into(), String::new()),
            ("LOCALAPPDATA".into(), local.to_string_lossy().into_owned()),
        ]);
        let r = resolver(home.path(), env, "win32", provided(true), None);
        assert_eq!(found(&r, "codex").await.executable_path, file);
    });
}

use crate::agent::{
    connections::probes::codex_local_probe::{
        CodexProbeOptions, InspectProtocol, probe_codex_local,
    },
    discovery::{
        bounded_process_probe::node_platform,
        command_environment::{
            EnvMap, EnvironmentSnapshot, ReadEnvironmentOptions, read_user_command_environment,
        },
        executable_discovery_port::{DiscoveryPortOptions, ExecutableDiscoveryPort},
    },
    installation::codex_repair::{candidates, remember},
    installation::{
        executable_resolver::{LocalAgentExecutableResolver, Observation},
        installation_definition::CandidateSpec,
    },
};
use std::{path::PathBuf, rc::Rc};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepairResult {
    Refresh,
    NotFound,
    Unverified,
    Outdated,
    Error,
}

/// Called off the UI thread. Version and identity checks use the same resolver as chat.
pub fn repair_codex(selected: Option<PathBuf>, workspace: PathBuf) -> RepairResult {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return RepairResult::Error;
    };
    let platform = node_platform();
    let inherited: EnvMap = std::env::vars().collect();
    let home = crate::platform::paths::home_dir();
    tokio::task::LocalSet::new().block_on(&runtime, async {
        let Ok(snapshot) = read_user_command_environment(ReadEnvironmentOptions {
            env: inherited.clone(),
            homedir: home.clone(),
            platform: platform.into(),
            signal: None,
            run_probe: None,
            timeout_ms: None,
        })
        .await
        else {
            return RepairResult::Error;
        };
        repair_from_snapshot(
            home, platform, inherited, snapshot, selected, workspace, None,
        )
        .await
    })
}

async fn repair_from_snapshot(
    home: PathBuf,
    platform: &str,
    inherited: EnvMap,
    snapshot: EnvironmentSnapshot,
    selected: Option<PathBuf>,
    workspace: PathBuf,
    inspect_protocol: Option<InspectProtocol>,
) -> RepairResult {
    let resolver = LocalAgentExecutableResolver::new(
        None,
        ExecutableDiscoveryPort::new(DiscoveryPortOptions {
            node_platform: Some(platform.into()),
            homedir: Some(home.clone()),
            env: Some(snapshot.environment.clone()),
            read_environment: Some(Rc::new(move |_, _, _, _| {
                let snapshot = snapshot.clone();
                Box::pin(async move { Ok(snapshot) })
            })),
            ..Default::default()
        }),
    );
    let Ok(context) = resolver.create_context(None).await else {
        return RepairResult::Error;
    };
    if selected.is_none() || context.environment.contains_key("CODEX_PATH") {
        match resolver
            .resolve("codex", Some(context.clone()), vec![])
            .await
        {
            Ok(Observation::NotFound { .. }) => {}
            Ok(Observation::Found { .. }) => return RepairResult::Refresh,
            _ => return RepairResult::Error,
        }
    }
    let manual = selected.is_some();
    let mut attempted = false;
    let mut outdated = false;
    for file in candidates(&home, platform, &inherited, selected, &workspace) {
        attempted = true;
        let spec = CandidateSpec::new(file.to_string_lossy(), "explicit-configuration")
            .with_launcher_directory_on_path();
        let Ok(Observation::Found { candidate, .. }) = resolver
            .resolve("codex", Some(context.clone()), vec![spec])
            .await
        else {
            continue;
        };
        if std::path::Path::new(&candidate.executable_path) != file {
            continue;
        }
        let env = candidate.environment.clone();
        let probe = probe_codex_local(CodexProbeOptions {
            candidate: Some(*candidate),
            env,
            inspect_protocol: inspect_protocol.clone(),
            workspace_root: Some(home.display().to_string()),
            ..Default::default()
        })
        .await;
        outdated |= probe["installation"] == "unsupported";
        if probe["protocolCompatible"] == true {
            return if remember(&home, &file, platform).is_ok() {
                RepairResult::Refresh
            } else {
                RepairResult::Error
            };
        }
    }
    if outdated {
        RepairResult::Outdated
    } else if attempted || manual {
        RepairResult::Unverified
    } else {
        RepairResult::NotFound
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::installation::codex_repair::saved;
    use std::fs;
    use std::path::Path;

    fn cli(dir: &Path, version: &str) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let (name, script) = if cfg!(windows) {
            (
                "codex.cmd",
                format!("@echo off\r\necho codex-cli {version}\r\n"),
            )
        } else {
            ("codex", format!("#!/bin/sh\necho codex-cli {version}\n"))
        };
        let file = dir.join(name);
        fs::write(&file, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o700)).unwrap();
        }
        file
    }

    #[test]
    fn rediscovery_keeps_sibling_interpreter_on_a_long_path() {
        let temp = tempfile::tempdir().unwrap();
        let bin = temp.path().join("wrapper");
        let executable = cli(&bin, "0.170.0");
        let platform = node_platform();
        remember(temp.path(), &executable, platform).unwrap();
        let dirs: Vec<_> = (0..150)
            .map(|i| temp.path().join(format!("existing-directory-{i}")))
            .collect();
        let original = std::env::join_paths(&dirs).unwrap().into_string().unwrap();
        assert!(original.encode_utf16().count() > 4096);
        let snapshot = EnvironmentSnapshot {
            environment: EnvMap::from([("PATH".into(), original)]),
            complete: true,
            source: "test".into(),
            reason_code: None,
        };
        let resolver = LocalAgentExecutableResolver::new(
            None,
            ExecutableDiscoveryPort::new(DiscoveryPortOptions {
                node_platform: Some(platform.into()),
                homedir: Some(temp.path().into()),
                read_environment: Some(Rc::new(move |_, _, _, _| {
                    let snapshot = snapshot.clone();
                    Box::pin(async move { Ok(snapshot) })
                })),
                ..Default::default()
            }),
        );
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        tokio::task::LocalSet::new().block_on(&rt, async {
            let Observation::Found { candidate, .. } =
                resolver.resolve("codex", None, vec![]).await.unwrap()
            else {
                panic!("saved CLI was not resolved");
            };
            let launch_env = candidate.environment.unwrap();
            let entries: Vec<_> = std::env::split_paths(&launch_env["PATH"]).collect();
            assert_eq!(entries, [dirs, vec![bin]].concat());
        });
    }

    #[test]
    fn repair_detects_remembers_and_reconnects_without_touching_path() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("profile");
        let work = temp.path().join("project");
        fs::create_dir_all(&work).unwrap();
        fs::create_dir_all(&home).unwrap();
        let bin = temp.path().join("shell only");
        let executable = cli(&bin, "0.170.0");
        let platform = node_platform();
        let mut env = EnvMap::new();
        for key in ["SystemRoot", "ComSpec", "TEMP", "TMP"] {
            if let Ok(value) = std::env::var(key) {
                env.insert(key.into(), value);
            }
        }
        env.insert(
            "PATH".into(),
            temp.path().join("saved path").display().to_string(),
        );
        let snap = EnvironmentSnapshot {
            environment: env.clone(),
            complete: true,
            source: "test".into(),
            reason_code: None,
        };
        let run = |dir: &Path,
                   selected: Option<PathBuf>,
                   override_path: Option<&str>,
                   compatible: bool| {
            let mut snap = snap.clone();
            if let Some(path) = override_path {
                snap.environment.insert("CODEX_PATH".into(), path.into());
            }
            let mut inherited = env.clone();
            inherited.insert("PATH".into(), dir.display().to_string());
            let future = repair_from_snapshot(
                home.clone(),
                platform,
                inherited,
                snap.clone(),
                selected,
                work.clone(),
                Some(Rc::new(move |_| {
                    Box::pin(
                        async move { Ok(serde_json::json!({"protocolCompatible": compatible})) },
                    )
                })),
            );
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            tokio::task::LocalSet::new().block_on(&rt, future)
        };
        let check = |dir: &Path, selected: Option<PathBuf>| run(dir, selected, None, true);
        assert_eq!(
            run(&bin, Some(executable.clone()), None, false),
            RepairResult::Unverified
        );
        assert_eq!(saved(&home, platform), None);
        let stale = bin.join("removed-codex");
        assert_eq!(run(&bin, None, stale.to_str(), true), RepairResult::Error);
        if cfg!(windows) {
            assert_eq!(check(&work, None), RepairResult::NotFound);
            cli(&work, "0.170.0");
            assert_eq!(check(&work, None), RepairResult::NotFound);
        }
        assert_eq!(
            check(&bin, Some(work.join("not-codex.txt"))),
            RepairResult::Unverified
        );
        assert_eq!(
            check(&bin, Some(cli(&work, "0.100.0"))),
            RepairResult::Outdated
        );
        assert_eq!(saved(&home, platform), None);
        if matches!(platform, "darwin" | "win32") {
            assert_eq!(check(&bin, None), RepairResult::Refresh);
            assert_eq!(saved(&home, platform).as_ref(), Some(&executable));
        }
        assert_eq!(check(&bin, Some(executable.clone())), RepairResult::Refresh);
        assert_eq!(saved(&home, platform), Some(executable));
        // A fresh discovery can now launch without the inherited bin directory.
        assert_eq!(check(&work, None), RepairResult::Refresh);
    }
}

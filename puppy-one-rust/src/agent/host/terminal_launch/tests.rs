use super::*;
use crate::agent::application::tests_support::run_local;
use crate::agent::installation::executable_resolver::{ResolutionContext, SearchContext};
use core::prelude::v1::test;
use std::cell::{Cell, RefCell};
fn context(signal: CancelSignal) -> ResolutionContext {
    ResolutionContext {
        environment: [("PATH".into(), "/version-two:/usr/bin:/bin".into())].into(),
        environment_source: "fixture".into(),
        environment_complete: true,
        environment_reason_code: None,
        executable_search: SearchContext::default(),
        signal: Some(signal),
    }
}
fn candidate(id: &str) -> ResolvedCandidate {
    ResolvedCandidate {
        executable_path: format!("/tools/{id}"),
        args_prefix: if id == "cursor" {
            vec!["agent".into()]
        } else {
            vec![]
        },
        launch_path_entry: "/tools".into(),
        ..Default::default()
    }
}
fn resolver(resolve: Resolve, verify: Verify) -> TerminalLaunchResolver {
    TerminalLaunchResolver::new(
        DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
        Rc::new(|signal| Box::pin(async move { Ok(context(signal)) })),
        resolve,
        verify,
    )
}
fn trusted() -> Resolve {
    Rc::new(|definition, _| {
        Box::pin(async move {
            Ok(Observation::Found {
                candidate: Box::new(candidate(&definition.id)),
                reason_code: None,
            })
        })
    })
}
fn accept() -> Verify {
    Rc::new(|candidate| Box::pin(async move { Ok(candidate.executable_path) }))
}
#[test]
fn trusted_ids_are_resolved_fresh_and_preserve_prefix_display_name_and_environment_order() {
    run_local(async {
        let calls = Rc::new(RefCell::new(vec![]));
        let received = calls.clone();
        let verifies = Rc::new(Cell::new(0));
        let verified = verifies.clone();
        let resolver = resolver(
            Rc::new(move |definition, _| {
                received.borrow_mut().push(definition.id.clone());
                Box::pin(async move {
                    Ok(Observation::Found {
                        candidate: Box::new(candidate(&definition.id)),
                        reason_code: None,
                    })
                })
            }),
            Rc::new(move |candidate| {
                verified.set(verified.get() + 1);
                Box::pin(async move { Ok(candidate.executable_path) })
            }),
        );
        for (id, display) in [
            ("cursor", "Cursor Agent"),
            ("pi", "Pi Agent"),
            ("hermes", "Hermes Agent"),
            ("cursor", "Cursor Agent"),
        ] {
            let launch = resolver.resolve(id, CancelSignal::default()).await.unwrap();
            assert_eq!(launch.executable_path, format!("/tools/{id}"));
            assert_eq!(launch.display_name, display);
            assert_eq!(
                launch.args,
                if id == "cursor" {
                    vec!["agent"]
                } else {
                    vec![]
                }
            );
            assert_eq!(
                launch.environment["PATH"], "/version-two:/usr/bin:/bin",
                "an absolute entrypoint must not reorder the discovery PATH"
            );
        }
        assert_eq!(
            calls.borrow().as_slice(),
            ["cursor", "pi", "hermes", "cursor"]
        );
        assert_eq!(verifies.get(), 4);
        let error = resolver
            .resolve("anything; rm -rf /", CancelSignal::default())
            .await
            .unwrap_err();
        assert_eq!(error.message, "TERMINAL_AGENT_UNAVAILABLE");
        assert_eq!(verifies.get(), 4);
    });
}
#[test]
fn candidate_environment_is_authoritative_and_unsafe_candidates_never_reach_identity_verification()
{
    run_local(async {
        let verifies = Rc::new(Cell::new(0));
        for change in 0..7 {
            let count = verifies.clone();
            let resolver = resolver(
                Rc::new(move |_, _| {
                    Box::pin(async move {
                        let mut value = candidate("codex");
                        match change {
                            0 => value.executable_path = "relative".into(),
                            1 => value.args_prefix = vec!["a".into(); 5],
                            2 => value.args_prefix = vec!["a".repeat(161)],
                            3 => value.args_prefix = vec!["line\nbreak".into()],
                            4 => value.launch_path_entry = "relative".into(),
                            5 => value.executable_path = "/tools/bad\0path".into(),
                            _ => value.args_prefix = vec!["😀".repeat(81)],
                        }
                        Ok(Observation::Found {
                            candidate: Box::new(value),
                            reason_code: None,
                        })
                    })
                }),
                Rc::new(move |_| {
                    count.set(count.get() + 1);
                    Box::pin(async { Ok("/should-not-run".into()) })
                }),
            );
            assert_eq!(
                resolver
                    .resolve("codex", CancelSignal::default())
                    .await
                    .unwrap_err()
                    .message,
                "TERMINAL_AGENT_UNAVAILABLE"
            );
        }
        assert_eq!(verifies.get(), 0);
        let resolver = resolver(
            Rc::new(|_, _| {
                Box::pin(async {
                    let mut value = candidate("codex");
                    value.environment = Some(
                        [
                            ("PATH".into(), "/override:/bin".into()),
                            ("VENDOR".into(), "active".into()),
                        ]
                        .into(),
                    );
                    Ok(Observation::Found {
                        candidate: Box::new(value),
                        reason_code: None,
                    })
                })
            }),
            accept(),
        );
        let launch = resolver
            .resolve("codex", CancelSignal::default())
            .await
            .unwrap();
        assert_eq!(launch.environment["PATH"], "/override:/bin");
        assert_eq!(launch.environment["VENDOR"], "active");
    });
}
#[test]
fn missing_failed_or_replaced_installations_cannot_be_launched_from_cached_visibility() {
    run_local(async {
        for status in ["missing", "failed", "error"] {
            let resolver = resolver(
                Rc::new(move |_, _| {
                    Box::pin(async move {
                        match status {
                            "missing" => Ok(Observation::NotFound {
                                reason_code: "not-found".into(),
                            }),
                            "failed" => Ok(Observation::Failed {
                                reason_code: "permission-denied".into(),
                            }),
                            _ => Err(AgentError::new("private filesystem error")),
                        }
                    })
                }),
                Rc::new(|_| panic!("unavailable candidates cannot reach verification")),
            );
            assert_eq!(
                resolver
                    .resolve("codex", CancelSignal::default())
                    .await
                    .unwrap_err()
                    .message,
                "TERMINAL_AGENT_UNAVAILABLE"
            );
        }
        let resolver = resolver(
            trusted(),
            Rc::new(|_| Box::pin(async { Err(AgentError::new("identity changed")) })),
        );
        assert_eq!(
            resolver
                .resolve("codex", CancelSignal::default())
                .await
                .unwrap_err()
                .message,
            "TERMINAL_AGENT_UNAVAILABLE"
        );
    });
}

#[test]
#[cfg(unix)]
fn launch_rereads_environment_and_real_files_then_rejects_deletion_or_identity_replacement() {
    run_local(async {
        use crate::agent::discovery::command_environment::EnvironmentSnapshot;
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old codex");
        let new = dir.path().join("new codex");
        for path in [&old, &new] {
            std::fs::write(path, "#!/bin/sh\nprintf fixture\n").unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let environment = Rc::new(RefCell::new(EnvMap::from([
            ("HOME".into(), dir.path().to_string_lossy().into()),
            ("CODEX_PATH".into(), old.to_string_lossy().into()),
            ("PATH".into(), "/old/interpreter:/usr/bin:/bin".into()),
        ])));
        let current = environment.clone();
        let captures = Rc::new(Cell::new(0));
        let calls = captures.clone();
        let local = Rc::new(LocalAgentExecutableResolver::new(
            None,
            ExecutableDiscoveryPort::new(DiscoveryPortOptions {
                env: Some(environment.borrow().clone()),
                homedir: Some(dir.path().into()),
                read_environment: Some(Rc::new(move |_, _, _, _| {
                    calls.set(calls.get() + 1);
                    let environment = current.borrow().clone();
                    Box::pin(async move {
                        Ok(EnvironmentSnapshot {
                            environment,
                            complete: true,
                            source: "test".into(),
                            reason_code: None,
                        })
                    })
                })),
                ..Default::default()
            }),
        ));
        let context = local.clone();
        let mut resolver = TerminalLaunchResolver::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(move |signal| {
                let local = context.clone();
                Box::pin(async move { local.create_context(Some(signal)).await })
            }),
            Rc::new(move |definition, context| {
                let local = local.clone();
                Box::pin(async move {
                    local
                        .resolve(&definition.id, Some((*context).clone()), vec![])
                        .await
                })
            }),
            Rc::new(|candidate| {
                Box::pin(async move { assert_executable_identity(&candidate).await })
            }),
        );
        let first = resolver
            .resolve("codex", CancelSignal::default())
            .await
            .unwrap();
        assert_eq!(first.executable_path, old.to_string_lossy());
        environment
            .borrow_mut()
            .insert("CODEX_PATH".into(), new.to_string_lossy().into());
        environment
            .borrow_mut()
            .insert("PATH".into(), "/new/interpreter:/usr/bin:/bin".into());
        let second = resolver
            .resolve("codex", CancelSignal::default())
            .await
            .unwrap();
        assert_eq!(second.executable_path, new.to_string_lossy());
        assert_eq!(second.environment["PATH"], "/new/interpreter:/usr/bin:/bin");
        assert_eq!(captures.get(), 2);
        std::fs::remove_file(&new).unwrap();
        assert_eq!(
            resolver
                .resolve("codex", CancelSignal::default())
                .await
                .unwrap_err()
                .message,
            "TERMINAL_AGENT_UNAVAILABLE"
        );
        environment
            .borrow_mut()
            .insert("CODEX_PATH".into(), old.to_string_lossy().into());
        resolver.verify = Rc::new(|candidate| {
            Box::pin(async move {
                std::fs::write(
                    &candidate.executable_path,
                    "#!/bin/sh\nprintf replaced-and-longer\n",
                )
                .unwrap();
                assert_executable_identity(&candidate).await
            })
        });
        assert_eq!(
            resolver
                .resolve("codex", CancelSignal::default())
                .await
                .unwrap_err()
                .message,
            "TERMINAL_AGENT_UNAVAILABLE"
        );
    });
}

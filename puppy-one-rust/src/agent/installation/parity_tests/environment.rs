use super::*;
use crate::agent::installation::installation_service::{
    CreateContext, InstallationService, Resolve, Source, Status,
};

fn ports(resolver: Rc<LocalAgentExecutableResolver>) -> (CreateContext, Resolve) {
    let context = resolver.clone();
    (
        Rc::new(move |signal| {
            let resolver = context.clone();
            Box::pin(async move { resolver.create_context(Some(signal)).await })
        }),
        Rc::new(move |definition, context| {
            let resolver = resolver.clone();
            Box::pin(async move {
                resolver
                    .resolve(&definition.id, Some((*context).clone()), vec![])
                    .await
            })
        }),
    )
}

#[test]
fn incomplete_environment_is_failed_evidence_until_explicit_refresh_discovers_the_new_file() {
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let definitions = registry(&["codex"]);
        let r = resolver(
            home.path(),
            EnvMap::from([("PATH".into(), String::new())]),
            "linux",
            provided(false),
            Some(definitions.clone()),
        );
        let (context, resolve) = ports(r);
        let service = InstallationService::new(definitions, context, resolve, Rc::new(|| 0), None);
        let first = service.discover(false, None).await.unwrap();
        assert_eq!(first.results()[0].status(), Status::Failed);
        assert_eq!(
            first.results()[0].reason_code(),
            Some("environment-unavailable")
        );
        executable(&home.path().join(".local/bin/codex"), SCRIPT);
        let cached = service.discover(false, None).await.unwrap();
        assert_eq!(cached.source(), Source::MemoryCache);
        assert!(cached.available_agent_ids().is_empty());
        let refreshed = service.discover(true, None).await.unwrap();
        assert_eq!(refreshed.source(), Source::Scan);
        assert_eq!(refreshed.available_agent_ids(), ["codex"]);
        service.dispose();
    });
}

#[cfg(target_os = "macos")]
fn shell_environment(home: &Path) -> EnvMap {
    EnvMap::from([
        ("HOME".into(), home.to_string_lossy().into_owned()),
        ("ZDOTDIR".into(), home.to_string_lossy().into_owned()),
        ("SHELL".into(), "/bin/zsh".into()),
        ("PATH".into(), "/usr/bin:/bin".into()),
    ])
}

#[cfg(target_os = "macos")]
#[test]
fn a_real_blocking_shell_profile_is_bounded_and_a_fixed_profile_is_read_again() {
    use crate::agent::discovery::command_environment::{
        ReadEnvironmentOptions, read_user_command_environment,
    };
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let env = shell_environment(home.path());
        std::fs::write(home.path().join(".zshrc"), "/bin/sleep 30\n").unwrap();
        let read = |timeout| ReadEnvironmentOptions {
            env: env.clone(),
            platform: "darwin".into(),
            homedir: home.path().into(),
            signal: None,
            run_probe: None,
            timeout_ms: timeout,
        };
        let failed = read_user_command_environment(read(Some(100)))
            .await
            .unwrap();
        assert!(!failed.complete);
        assert_eq!(
            failed.reason_code.as_deref(),
            Some("environment-unavailable")
        );
        assert_eq!(failed.environment, env);
        std::fs::write(
            home.path().join(".zshrc"),
            "export PATH='/new/custom/bin:/usr/bin:/bin'\n",
        )
        .unwrap();
        let fixed = read_user_command_environment(read(None)).await.unwrap();
        assert!(fixed.complete);
        assert_eq!(fixed.environment["PATH"], "/new/custom/bin:/usr/bin:/bin");
    });
}

#[cfg(target_os = "macos")]
#[test]
fn refreshed_shell_discovery_terminal_launch_and_runtime_readiness_use_the_same_fresh_environment()
{
    use crate::agent::discovery::bounded_process_probe::{ProbeOptions, run_bounded_process_probe};
    use crate::agent::discovery::executable_discovery_port::default_read_environment;
    use crate::agent::host::TerminalLaunchResolver;
    use crate::agent::runtimes::codex::codex_discovery::{
        CodexDiscoveryOptions, discover_codex_executable,
    };
    use crate::agent::tasks::CancelSignal;
    use crate::platform::terminal::shell::ShellHost;
    use std::cell::Cell;
    run_local(async {
        let home = tempfile::tempdir().unwrap();
        let old_bin = home.path().join("previous tools");
        let new_bin = home.path().join("new tools");
        executable(&old_bin.join("claude"), SCRIPT);
        let env = shell_environment(home.path());
        let configure = |bin: &Path| {
            // TempDir's generated path is trusted fixture input, never a user path.
            assert!(!bin.to_string_lossy().contains('\''));
            std::fs::write(home.path().join(".zshrc"),format!("printf 'startup noise=not environment\\n'\nexport PATH='{}:/usr/bin:/bin'\nexport CLI_FIXTURE='selected environment'\n",bin.display())).unwrap();
        };
        configure(&old_bin);
        let captures = Rc::new(Cell::new(0));
        let seen = captures.clone();
        let read = default_read_environment();
        let capture: ReadEnvironment = Rc::new(move |env, home, platform, signal| {
            seen.set(seen.get() + 1);
            read(env, home, platform, signal)
        });
        let definitions = registry(&["codex", "claude"]);
        let r = resolver(
            home.path(),
            env.clone(),
            "darwin",
            capture,
            Some(definitions.clone()),
        );
        let (context, resolve) = ports(r);
        let service = InstallationService::new(
            definitions.clone(),
            context.clone(),
            resolve.clone(),
            Rc::new(|| 0),
            None,
        );
        let first = service.discover(false, None).await.unwrap();
        assert_eq!(first.available_agent_ids(), ["claude"]);
        let codex = executable(
            &new_bin.join("codex"),
            "#!/usr/bin/env fixture-interpreter\nif [ \"$1\" = '--version' ]; then printf 'codex-cli 0.144.1\\n'; else printf '%s\\n' \"$CLI_FIXTURE\"; fi\n",
        );
        symlink("/bin/sh", new_bin.join("fixture-interpreter")).unwrap();
        configure(&new_bin);
        let cached = service.discover(false, None).await.unwrap();
        assert_eq!(cached.source(), Source::MemoryCache);
        assert_eq!(cached.available_agent_ids(), ["claude"]);
        let refreshed = service.discover(true, None).await.unwrap();
        assert!(
            refreshed
                .available_agent_ids()
                .iter()
                .any(|id| id == "codex")
        );
        assert_eq!(captures.get(), 2);
        assert!(
            !refreshed
                .to_value()
                .to_string()
                .contains(home.path().to_str().unwrap())
        );
        let launcher = TerminalLaunchResolver::new(
            definitions,
            context,
            resolve,
            Rc::new(|candidate| {
                Box::pin(async move { assert_executable_identity(&candidate).await })
            }),
        );
        let launch = launcher
            .resolve("codex", CancelSignal::default())
            .await
            .unwrap();
        assert_eq!(launch.executable_path, codex);
        let host =
            ShellHost::build(Some(&launch.clone().into_shell_agent()), &env, "darwin").unwrap();
        assert!(!host.login_shell);
        let command_env: EnvMap = host.command.environment.into_iter().collect();
        assert_eq!(
            command_env["PATH"],
            format!("{}:/usr/bin:/bin", new_bin.display())
        );
        let executed = run_bounded_process_probe(
            &launch.executable_path,
            &[],
            ProbeOptions {
                env: Some(command_env.clone()),
                timeout_ms: 5_000,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(executed.code, Some(0));
        assert_eq!(executed.stdout.trim(), "selected environment");
        let ready = discover_codex_executable(
            CodexDiscoveryOptions {
                env: Some(env),
                homedir: Some(home.path().into()),
                platform: Some("darwin".into()),
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(ready["status"], "ready", "{ready:#}");
        assert_eq!(ready["executablePath"], codex);
        assert_eq!(ready["version"], "0.144.1");
        assert_eq!(ready["environment"]["PATH"], command_env["PATH"]);
        std::fs::remove_file(&codex).unwrap();
        assert_eq!(
            launcher
                .resolve("codex", CancelSignal::default())
                .await
                .unwrap_err()
                .message,
            "TERMINAL_AGENT_UNAVAILABLE"
        );
        service.dispose();
    });
}

use super::*;
use crate::agent::application::tests_support::run_local;
use crate::agent::discovery::bounded_process_probe::ProbeResult;
use crate::agent::tasks::Canceller;
use core::prelude::v1::test;
use std::cell::Cell;
use std::rc::Rc;

fn env(values: &[(&str, &str)]) -> EnvMap {
    values
        .iter()
        .map(|(k, v)| ((*k).into(), (*v).into()))
        .collect()
}
fn options(environment: EnvMap, run: ProbeRunner) -> ReadEnvironmentOptions {
    ReadEnvironmentOptions {
        env: environment,
        platform: "linux".into(),
        homedir: "/fixture/home".into(),
        signal: None,
        run_probe: Some(run),
        timeout_ms: None,
    }
}
fn framed(args: &[String], entries: &str) -> ProbeResult {
    let pattern = Regex::new(r"puppyone-env-[a-f0-9-]+-begin").unwrap();
    let start = pattern.find(args.last().unwrap()).unwrap().as_str();
    let end = start.replace("-begin", "-end");
    ProbeResult {
        code: Some(0),
        stdout: format!("PATH=/wrong\n\0{start}\0{entries}\0\0{end}\0exit noise"),
        ..Default::default()
    }
}

#[test]
fn login_shells_use_one_bounded_neutral_probe_and_only_private_framed_data() {
    run_local(async {
        for shell in ["bash", "zsh", "fish"] {
            let calls = Rc::new(Cell::new(0));
            let seen = calls.clone();
            let runner: ProbeRunner = Rc::new(move |file, args, options| {
                seen.set(seen.get() + 1);
                assert_eq!(file, format!("/bin/{shell}"));
                assert_eq!(options.cwd.as_deref(), Some(Path::new("/fixture/home")));
                assert_eq!(options.timeout_ms, 4_000);
                assert_eq!(options.max_output_bytes, 262_144);
                assert!(options.isolated_process_group);
                assert_eq!(args[0], if shell == "fish" { "--login" } else { "-ilc" });
                let probe_env = options.env.unwrap();
                assert_eq!(probe_env["PUPPYONE_RESOLVING_ENVIRONMENT"], "1");
                assert_eq!(probe_env["DISABLE_AUTO_UPDATE"], "true");
                let result = framed(
                    &args,
                    "PATH=/custom/node:/usr/bin\0PROFILE_VALUE=first\nsecond=third\0INVALID-KEY=no\0PUPPYONE_RESOLVING_ENVIRONMENT=1\0DISABLE_AUTO_UPDATE=true",
                );
                Box::pin(async move { Ok(result) })
            });
            let snapshot = read_user_command_environment(options(
                env(&[("SHELL", &format!("/bin/{shell}")), ("PATH", "/old")]),
                runner,
            ))
            .await
            .unwrap();
            assert!(snapshot.complete);
            assert_eq!(snapshot.source, "shell-environment");
            assert_eq!(
                snapshot.environment,
                env(&[
                    ("PATH", "/custom/node:/usr/bin"),
                    ("PROFILE_VALUE", "first\nsecond=third")
                ])
            );
            assert_eq!(calls.get(), 1);
        }
    });
}

#[test]
fn failed_environment_reads_remain_incomplete_and_the_next_read_retries() {
    run_local(async {
        for failure in ["timeout", "missing-marker", "nonzero-exit"] {
            let calls = Rc::new(Cell::new(0));
            let seen = calls.clone();
            let runner: ProbeRunner = Rc::new(move |_, args, _| {
                let first = seen.replace(seen.get() + 1) == 0;
                Box::pin(async move {
                    if !first {
                        return Ok(framed(&args, "PATH=/new"));
                    }
                    match failure {
                        "timeout" => Err(AgentError::new("timed out with private details")),
                        "missing-marker" => Ok(ProbeResult {
                            code: Some(0),
                            stdout: "PATH=/misleading".into(),
                            ..Default::default()
                        }),
                        _ => Ok(ProbeResult {
                            code: Some(1),
                            ..framed(&args, "PATH=/misleading")
                        }),
                    }
                })
            });
            let base = env(&[("SHELL", "/bin/zsh"), ("PATH", "/old")]);
            let first = read_user_command_environment(options(base.clone(), runner.clone()))
                .await
                .unwrap();
            assert_eq!(
                first,
                EnvironmentSnapshot {
                    environment: base.clone(),
                    complete: false,
                    source: "inherited-environment".into(),
                    reason_code: Some("environment-unavailable".into())
                }
            );
            let second = read_user_command_environment(options(base, runner))
                .await
                .unwrap();
            assert!(second.complete);
            assert_eq!(second.environment["PATH"], "/new");
            assert_eq!(calls.get(), 2);
        }
    });
}

#[test]
fn cancellation_during_environment_read_never_becomes_success_or_fallback() {
    run_local(async {
        for succeed in [true, false] {
            let controller = Canceller::new();
            let signal = controller.signal();
            let reason = AgentError::new("cancelled environment read").with_name("AbortError");
            let expected = reason.clone();
            let runner: ProbeRunner = Rc::new(move |_, args, _| {
                controller.cancel(reason.clone());
                Box::pin(async move {
                    if succeed {
                        Ok(framed(&args, "PATH=/new"))
                    } else {
                        Err(AgentError::new("private probe error"))
                    }
                })
            });
            let mut request = options(env(&[("SHELL", "/bin/zsh")]), runner);
            request.signal = Some(signal);
            assert_eq!(
                read_user_command_environment(request).await.unwrap_err(),
                expected
            );
        }
    });
}

#[test]
fn missing_shell_uses_the_linux_policy() {
    run_local(async {
        let runner: ProbeRunner = Rc::new(|file, args, _| {
            assert_eq!(file, "/bin/bash");
            Box::pin(async move { Ok(framed(&args, "PATH=/usr/bin")) })
        });
        assert!(
            read_user_command_environment(options(EnvMap::new(), runner))
                .await
                .unwrap()
                .complete
        );
    });
}

#[test]
fn windows_persistent_path_is_refreshed_without_competing_case_variants() {
    run_local(async {
        let calls = Rc::new(Cell::new(0));
        let seen = calls.clone();
        let runner: ProbeRunner = Rc::new(move |file, args, _| {
            assert_eq!(
                file,
                r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
            );
            assert!(args.iter().any(|a| a == "-NoProfile"));
            assert!(
                args.last()
                    .unwrap()
                    .contains("GetEnvironmentVariables('User')")
            );
            let first = seen.replace(seen.get() + 1) == 0;
            Box::pin(async move {
                Ok(ProbeResult {
                    code: Some(0),
                    stdout: if first {
                        r#"{"PATH":"C:\\first","PATHEXT":".CMD;.EXE"}"#
                    } else {
                        r#"{"PATH":"C:\\new;C:\\first","PATHEXT":".EXE;.CMD"}"#
                    }
                    .into(),
                    ..Default::default()
                })
            })
        });
        let read = || {
            let mut request = options(
                env(&[
                    ("SystemRoot", r"C:\Windows"),
                    ("Path", r"C:\old"),
                    ("CUSTOM_SETTING", "preserved"),
                ]),
                runner.clone(),
            );
            request.platform = "win32".into();
            request
        };
        let first = read_user_command_environment(read()).await.unwrap();
        assert_eq!(first.environment["PATH"], r"C:\first");
        let next = read_user_command_environment(read()).await.unwrap();
        assert!(next.complete);
        assert_eq!(next.source, "windows-environment");
        assert_eq!(next.environment["PATH"], r"C:\new;C:\first");
        assert_eq!(next.environment["PATHEXT"], ".EXE;.CMD");
        assert_eq!(next.environment["CUSTOM_SETTING"], "preserved");
        assert!(!next.environment.contains_key("Path"));
        assert_eq!(calls.get(), 2);
    });
}

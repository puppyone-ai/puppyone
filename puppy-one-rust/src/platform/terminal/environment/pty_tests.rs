use super::*;
use crate::{
    platform::terminal::{Event, PTY_TEST_LOCK, Terminal, shell::ShellHost},
    wake::Wake,
};
use core::prelude::v1::test;
use std::{
    os::unix::fs::PermissionsExt,
    time::{Duration, Instant},
};

#[test]
fn the_real_shell_receives_only_its_normalized_environment_and_current_host_identity() {
    let _exclusive = PTY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let directory = tempfile::tempdir().unwrap();
    // Observe the exec environment before machine-wide /etc/profile can
    // intentionally rewrite PATH. Then exec a real, isolated interactive bash.
    let shell = directory.path().join("bash");
    std::fs::write(&shell, r#"#!/bin/sh
printf 'NORMALIZED:%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$PATH" "$npm_config_prefix" "$npm_execpath" "$CONDA_PREFIX" "$CONDA_SHLVL" "$TERM_PROGRAM" "$PUPPYONE_TERMINAL" "$COLORFGBG" "$NO_COLOR" "$http_proxy"
printf 'HOST:%s|%s\n' "$PUPPYONE_CLI_ENDPOINT" "$PUPPYONE_APP_PATH"
printf 'HOME:%s\n' "$HOME"
printf 'CWD:%s\n' "$(/bin/pwd -P)"
exec /bin/bash --noprofile --norc -i
"#).unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let source: Environment = [
        (
            "HOME".into(),
            directory.path().to_string_lossy().into_owned(),
        ),
        ("SHELL".into(), shell.to_string_lossy().into_owned()),
        ("PATH".into(), "/usr/bin:/opt/fixture-conda/bin".into()),
        ("npm_config_prefix".into(), "/old-npm-prefix".into()),
        ("npm_execpath".into(), "/old-npm-entrypoint".into()),
        ("CONDA_PREFIX".into(), "/opt/fixture-conda".into()),
        ("CONDA_SHLVL".into(), "1".into()),
        (
            "PUPPYONE_CLI_ENDPOINT".into(),
            "/old-fixture-host/control.sock".into(),
        ),
        ("PUPPYONE_APP_PATH".into(), "/old-fixture-host.app".into()),
        ("NO_COLOR".into(), "1".into()),
        ("http_proxy".into(), "http://127.0.0.1:7897".into()),
    ]
    .into();
    let host = ShellHost::build(None, &source, "darwin")
        .unwrap()
        .with_colors(DefaultColors {
            foreground: [209, 206, 198],
            background: [22, 20, 19],
        });
    let owner = format!("terminal-env-{}", uuid::Uuid::new_v4());
    let terminal = Terminal::spawn_shell_prepared(
        directory.path().into(),
        "shell",
        Wake::default(),
        owner.clone(),
        move || Ok(host),
    );
    let mut output = String::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    let expected = "NORMALIZED:/usr/bin|||||PuppyOne|1|15;0||http://127.0.0.1:7897";
    let home = format!("HOME:{}", directory.path().display());
    while !output.contains(&home) {
        read(&terminal, deadline, &mut output);
    }
    let cwd = format!(
        "CWD:{}",
        std::fs::canonicalize(directory.path()).unwrap().display()
    );
    while !output.contains(&cwd) {
        read(&terminal, deadline, &mut output);
    }
    assert!(output.contains(expected), "{output}");
    assert!(!output.contains("/old-fixture-host"), "{output}");
    terminal.resize(30, 90);
    terminal
        .input(b"printf 'SIZE:'; /bin/stty size\r".to_vec())
        .unwrap();
    while !output.contains("SIZE:30 90") {
        read(&terminal, deadline, &mut output);
    }
    terminal.input(b"exit\r".to_vec()).unwrap();
    loop {
        match terminal
            .events
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap()
        {
            Event::Data(_) => (),
            Event::Exit(code) => {
                assert_eq!(code, 0);
                break;
            }
            Event::Error(error) => panic!("{error}"),
        }
    }
    drop(terminal);
    while crate::platform::host_budget::Budget::global()
        .snapshot()
        .iter()
        .any(|r| r.owner == owner)
    {
        assert!(
            Instant::now() < deadline,
            "environment PTY lease survived exit"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn read(terminal: &Terminal, deadline: Instant, output: &mut String) {
    match terminal
        .events
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .unwrap_or_else(|e| panic!("{e:?}: {output}"))
    {
        Event::Data(bytes) => output.push_str(&String::from_utf8_lossy(&bytes)),
        Event::Exit(code) => panic!("early shell exit {code}: {output}"),
        Event::Error(error) => panic!("{error}"),
    }
}

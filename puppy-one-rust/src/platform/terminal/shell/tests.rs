use super::*;
use core::prelude::v1::test;
fn agent(file: &str, args: &[&str]) -> AgentCommand {
    AgentCommand {
        executable_path: file.into(),
        args: args.iter().map(|s| (*s).into()).collect(),
        display_name: None,
        path_entries: vec![],
        environment: None,
    }
}
#[test]
fn posix_powershell_and_cmd_preserve_literal_words_and_batch_refuses_expansion() {
    assert_eq!(
        serialize(
            &agent(
                "/Applications/O'Code/opencode",
                &["--profile", "work space"]
            ),
            "darwin",
            "/bin/zsh"
        )
        .unwrap(),
        "'/Applications/O'\"'\"'Code/opencode' '--profile' 'work space'\r"
    );
    let native = agent(
        "C:\\Program Files\\OpenCode\\opencode.exe",
        &["--profile", "work space"],
    );
    assert_eq!(
        serialize(
            &native,
            "win32",
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
        )
        .unwrap(),
        "& 'C:\\Program Files\\OpenCode\\opencode.exe' '--profile' 'work space'\r"
    );
    assert_eq!(
        serialize(&native, "win32", "C:\\Windows\\System32\\cmd.exe").unwrap(),
        "\"C:\\Program Files\\OpenCode\\opencode.exe\" \"--profile\" \"work space\"\r"
    );
    assert_eq!(
        serialize(&agent("C:\\CLI tools\\codex.cmd", &[]), "win32", "cmd.exe").unwrap(),
        "\"C:\\CLI tools\\codex.cmd\"\r"
    );
    assert!(
        serialize(&agent("C:\\%custom%\\codex.cmd", &[]), "win32", "cmd.exe")
            .unwrap_err()
            .contains("cannot preserve")
    );
    for value in ["a%HOME%", "line\nbreak", "a\0b", "a\"b"] {
        assert!(serialize(&agent("C:\\tool.cmd", &[value]), "win32", "powershell.exe").is_err());
    }
    assert_eq!(quote_windows("trailing\\"), "\"trailing\\\\\"");
    assert_eq!(quote_windows("a\\\"b"), "\"a\\\\\\\"b\"");
}
#[test]
fn initialized_environments_skip_startup_before_the_agent_and_keep_a_shell_after_exit() {
    for (shell, flags) in [
        ("/bin/bash", vec!["--noprofile", "--norc"]),
        ("/bin/zsh", vec!["-f"]),
    ] {
        let env: Environment = [
            ("SHELL".into(), shell.into()),
            ("PATH".into(), "/chosen:/bin".into()),
        ]
        .into();
        let mut agent = agent("/verified/cursor", &["agent"]);
        agent.environment = Some(env.clone());
        agent.display_name = Some("Cursor Agent".into());
        let host = ShellHost::build(Some(&agent), &Environment::new(), "darwin").unwrap();
        assert!(!host.login_shell);
        assert!(host.bootstrap_input.is_none());
        assert_eq!(host.display_shell, "Cursor Agent");
        assert_eq!(&host.command.arguments[..flags.len()], flags);
        assert_eq!(
            &host.command.arguments[flags.len()..],
            [
                "-i",
                "-c",
                &format!("if '/verified/cursor' 'agent'; then :; fi; exec '{shell}' -l")
            ]
        );
        let env: Environment = host.command.environment.into_iter().collect();
        assert_eq!(env["PATH"], "/chosen:/bin");
    }
    let mut command = agent("/verified/codex", &[]);
    let env = [("SHELL".into(), "/bin/fish".into())].into();
    let fallback = ShellHost::build(Some(&command), &env, "darwin").unwrap();
    assert_eq!(
        fallback.bootstrap_input.as_deref(),
        Some("'/verified/codex'\r")
    );
    command.environment = Some(env);
    let captured = ShellHost::build(Some(&command), &Environment::new(), "darwin").unwrap();
    assert!(captured.bootstrap_input.is_none());
    assert_eq!(
        captured.command.arguments,
        [
            "--no-config",
            "--interactive",
            "--command",
            "'/verified/codex'; exec '/bin/fish' --login"
        ]
    );
}
#[test]
fn uncaptured_zsh_uses_login_initialization_and_argv_instead_of_stdin_bootstrap() {
    let mut command = agent("/verified/cursor", &["agent"]);
    command.display_name = Some("Cursor Agent".into());
    let host = ShellHost::build(
        Some(&command),
        &[("SHELL".into(), "/bin/zsh".into())].into(),
        "darwin",
    )
    .unwrap();
    assert_eq!(host.command.executable.to_str(), Some("/bin/zsh"));
    assert_eq!(
        host.command.arguments,
        [
            "-l",
            "-i",
            "-c",
            "if '/verified/cursor' 'agent'; then :; fi; exec '/bin/zsh' -l"
        ]
    );
    assert!(host.login_shell);
    assert!(host.bootstrap_input.is_none());
    assert!(
        host.command
            .environment
            .contains(&("DISABLE_AUTO_UPDATE".into(), "true".into()))
    );
}

#[test]
fn trusted_path_additions_reach_shell_preparation_without_stdin_bootstrap_or_reordering_existing_entries()
 {
    let mut command = agent("/verified/cursor", &["agent"]);
    command.display_name = Some("Cursor Agent".into());
    command.path_entries = vec![
        "/verified".into(),
        "relative".into(),
        "/unsafe\nentry".into(),
        "/verified".into(),
    ];
    let inherited = [
        ("SHELL".into(), "/bin/zsh".into()),
        ("PATH".into(), "/usr/bin:/verified:/bin::".into()),
    ]
    .into();
    let mut host = ShellHost::build(Some(&command), &inherited, "darwin").unwrap();
    host.prepare_environment("test", &Environment::new(), "darwin");
    assert_eq!(host.command.executable.to_str(), Some("/bin/zsh"));
    assert_eq!(
        host.command.arguments,
        [
            "-l",
            "-i",
            "-c",
            "if '/verified/cursor' 'agent'; then :; fi; exec '/bin/zsh' -l"
        ]
    );
    assert!(host.bootstrap_input.is_none());
    assert_eq!(host.display_shell, "Cursor Agent");
    let environment: Environment = host.command.environment.into_iter().collect();
    assert_eq!(environment["PATH"], "/verified:/usr/bin:/bin");
    assert_eq!(environment["DISABLE_AUTO_UPDATE"], "true");
    command.path_entries.clear();
    command.environment = Some(inherited);
    let mut host = ShellHost::build(Some(&command), &Environment::new(), "darwin").unwrap();
    host.prepare_environment("test", &Environment::new(), "darwin");
    let environment: Environment = host.command.environment.into_iter().collect();
    assert_eq!(
        environment["PATH"], "/usr/bin:/verified:/bin::",
        "empty trusted additions must preserve the discovery snapshot verbatim"
    );
}

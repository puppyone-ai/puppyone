//! Real PTYs, isolated HOME and startup scripts; no installed Agent or user rc.
use super::*;
use crate::{
    platform::terminal::{Event, Terminal},
    wake::Wake,
};
use core::prelude::v1::test;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    time::{Duration, Instant},
};

struct Session {
    terminal: Option<Terminal>,
    directory: tempfile::TempDir,
    owner: String,
    output: String,
}
impl Session {
    fn start(shell: &str, initialized: bool, exit_code: u32) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let rc = if shell.ends_with("zsh") {
            ".zshrc"
        } else {
            ".bash_profile"
        };
        let startup = if initialized {
            "export CLI_SELECTION=changed-by-startup\nprintf 'PROMPT_CONFIG_LOADED\\n'\nPS1='SHELL_READY> '\n".into()
        } else {
            format!(
                "if [[ -z $PUPPYONE_TEST_INITIALIZED ]]; then\n  export PUPPYONE_TEST_INITIALIZED=1\n  printf 'STARTUP_WAITING\\n'\n  read -r {} 1 answer\n  printf 'STARTUP_ANSWER:%s\\n' \"$answer\"\nfi\nPS1='SHELL_READY> '\nRPROMPT=''\n",
                if shell.ends_with("zsh") { "-k" } else { "-n" }
            )
        };
        fs::write(directory.path().join(rc), startup).unwrap();
        let executable = directory.path().join("agent's script");
        fs::write(&executable, format!("#!/bin/sh\nprintf 'AGENT_ENV:%s\\n' \"$CLI_SELECTION\"\nprintf 'AGENT_ARG:<%s>\\n' \"$@\"\nexit {exit_code}\n")).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let environment: Environment = [
            (
                "HOME".into(),
                directory.path().to_string_lossy().into_owned(),
            ),
            (
                "ZDOTDIR".into(),
                directory.path().to_string_lossy().into_owned(),
            ),
            ("SHELL".into(), shell.into()),
            ("PATH".into(), "/usr/bin:/bin".into()),
            ("CLI_SELECTION".into(), "resolved".into()),
        ]
        .into();
        let agent = AgentCommand {
            executable_path: executable.to_string_lossy().into_owned(),
            args: ["work space", "a'b", "$(touch INJECTED)", "semi;colon"]
                .into_iter()
                .map(Into::into)
                .collect(),
            display_name: Some("Fixture Agent".into()),
            environment: initialized.then(|| environment.clone()),
        };
        let host = ShellHost::build(Some(&agent), &environment, "darwin").unwrap();
        // No launch text can be consumed by rc's blocking read.
        assert!(host.bootstrap_input.is_none());
        let owner = format!("shell-startup-{}", uuid::Uuid::new_v4());
        let terminal = Terminal::spawn_shell_prepared(
            directory.path().into(),
            "shell",
            Wake::default(),
            owner.clone(),
            move || Ok(host),
        );
        Self {
            terminal: Some(terminal),
            directory,
            owner,
            output: String::new(),
        }
    }
    fn until(&mut self, marker: &str) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !self.output.contains(marker) {
            let event = self
                .terminal
                .as_ref()
                .unwrap()
                .events
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap_or_else(|e| panic!("Waiting for {marker}: {e:?}; output: {}", self.output));
            match event {
                Event::Data(bytes) => self.output.push_str(&String::from_utf8_lossy(&bytes)),
                Event::Error(error) => panic!("{error}; output: {}", self.output),
                Event::Exit(code) => panic!("Shell exited early: {code}; output: {}", self.output),
            }
        }
    }
    fn input(&self, text: &str) {
        self.terminal
            .as_ref()
            .unwrap()
            .input(text.as_bytes().to_vec())
            .unwrap();
    }
    fn assert_waiting_for_user(&mut self) {
        let deadline = Instant::now() + Duration::from_millis(100);
        while let Ok(event) = self
            .terminal
            .as_ref()
            .unwrap()
            .events
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            match event {
                Event::Data(bytes) => self.output.push_str(&String::from_utf8_lossy(&bytes)),
                _ => panic!(
                    "Shell stopped while waiting for startup input: {}",
                    self.output
                ),
            }
        }
        assert!(!self.output.contains("STARTUP_ANSWER:"), "{}", self.output);
        assert!(!self.output.contains("AGENT_ARG:"), "{}", self.output);
    }
    fn finish(&mut self) {
        self.input("printf 'SHELL_%s\\n' USABLE\r");
        self.until("SHELL_USABLE");
        assert!(!self.directory.path().join("INJECTED").exists());
        assert!(!self.output.contains("quote>"), "{}", self.output);
        self.input("exit\r");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self
                .terminal
                .as_ref()
                .unwrap()
                .events
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("Shell never exited")
            {
                Event::Data(bytes) => self.output.push_str(&String::from_utf8_lossy(&bytes)),
                Event::Error(error) => panic!("{error}"),
                Event::Exit(code) => {
                    assert_eq!(code, 0);
                    break;
                }
            }
        }
        self.close();
    }
    fn close(&mut self) {
        self.terminal.take();
        let deadline = Instant::now() + Duration::from_secs(5);
        while crate::platform::host_budget::Budget::global()
            .snapshot()
            .iter()
            .any(|row| row.owner == self.owner)
        {
            if Instant::now() >= deadline {
                assert!(
                    std::thread::panicking(),
                    "Shell process lease survived close"
                );
                break;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}
fn resolved(shell: &str) {
    let _exclusive = crate::platform::terminal::PTY_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut session = Session::start(shell, true, 0);
    session.until("SHELL_READY>");
    assert!(
        session.output.contains("AGENT_ENV:resolved"),
        "{}",
        session.output
    );
    assert!(
        session.output.find("AGENT_ENV:resolved").unwrap()
            < session.output.find("PROMPT_CONFIG_LOADED").unwrap(),
        "{}",
        session.output
    );
    session.finish();
}
fn interactive(shell: &str, exit: u32) {
    let _exclusive = crate::platform::terminal::PTY_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut session = Session::start(shell, false, exit);
    session.until("STARTUP_WAITING");
    session.assert_waiting_for_user();
    session.input("n");
    session.until("SHELL_READY>");
    for expected in [
        "STARTUP_ANSWER:n",
        "AGENT_ARG:<work space>",
        "AGENT_ARG:<a'b>",
        "AGENT_ARG:<$(touch INJECTED)>",
        "AGENT_ARG:<semi;colon>",
    ] {
        assert!(
            session.output.contains(expected),
            "Missing {expected}: {}",
            session.output
        );
    }
    session.finish();
}
#[test]
fn bash_uses_resolved_environment_before_loading_prompt_configuration() {
    resolved("/bin/bash");
}
#[test]
fn zsh_uses_resolved_environment_before_loading_prompt_configuration() {
    resolved("/bin/zsh");
}
#[test]
fn bash_startup_read_preserves_arguments_and_shell_after_successful_agent_exit() {
    interactive("/bin/bash", 0);
}
#[test]
fn bash_startup_read_preserves_arguments_and_shell_after_failed_agent_exit() {
    interactive("/bin/bash", 1);
}
#[test]
fn zsh_startup_read_preserves_arguments_and_shell_after_successful_agent_exit() {
    interactive("/bin/zsh", 0);
}
#[test]
fn zsh_startup_read_preserves_arguments_and_shell_after_failed_agent_exit() {
    interactive("/bin/zsh", 1);
}

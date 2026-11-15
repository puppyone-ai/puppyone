pub mod colors;
pub mod environment;
pub mod shell;
// Real PTY cases share the application-wide concurrent-start budget.
#[cfg(test)]
static PTY_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
use crate::wake::Wake;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI32, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    time::Duration,
};
/// A process recipe passed directly to the PTY. An Agent session builds an
/// interactive shell recipe from its verified executable and fixed arguments.
#[derive(Clone, Debug, Default)]
pub struct LaunchCommand {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
}
struct PreparedLaunch {
    command: Option<LaunchCommand>,
    bootstrap: Option<String>,
    replace_environment: bool,
}
pub enum Event {
    Started { input_shell: String },
    Data(Vec<u8>),
    Error(String),
    Exit(u32),
}
/// What a session is asked: keystrokes, and a new size (rows, columns).
pub enum Request {
    Input(Vec<u8>),
    Resize(u16, u16),
}
struct ChildGuard(Box<dyn portable_pty::Child + Send + Sync>);
impl std::ops::Deref for ChildGuard {
    type Target = Box<dyn portable_pty::Child + Send + Sync>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for ChildGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}
pub struct Terminal {
    tx: SyncSender<Request>,
    pub events: Receiver<Event>,
    stop: Arc<AtomicBool>,
    pid: Arc<AtomicI32>,
    foreground: Arc<AtomicI32>,
}
impl Terminal {
    /// A session with no PTY behind it (tests and lab fixtures).
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    pub fn disconnected_for_test() -> Self {
        let (tx, _) = mpsc::sync_channel(1);
        let (_, events) = mpsc::sync_channel(1);
        Self {
            tx,
            events,
            stop: Arc::new(AtomicBool::new(false)),
            pid: Arc::new(AtomicI32::new(0)),
            foreground: Arc::new(AtomicI32::new(0)),
        }
    }
    /// A session whose process runs elsewhere (another computer's folder):
    /// what it is asked arrives on the [`Bridge`], and what it says goes
    /// back through it. Dropping the session stops the bridge.
    pub fn bridged(wake: Wake) -> (Self, Bridge) {
        let (tx, requests) = mpsc::sync_channel(64);
        let (events, receiver) = mpsc::sync_channel(128);
        let stop = Arc::new(AtomicBool::new(false));
        let bridge = Bridge {
            requests,
            outlet: Outlet {
                events,
                wake,
                stop: stop.clone(),
            },
        };
        let terminal = Self {
            tx,
            events: receiver,
            stop,
            pid: Arc::new(AtomicI32::new(0)),
            foreground: Arc::new(AtomicI32::new(0)),
        };
        (terminal, bridge)
    }
    /// Starts a PTY host under the process budget of `owner` (its window).
    /// A refused reservation reports capacity instead of starting a shell.
    /// `launcher` is the terminal's launcher (`shell` or a local Agent id):
    /// with that Agent's Hook enabled the session reports file activity.
    pub fn spawn(
        root: PathBuf,
        executable: Option<PathBuf>,
        launcher: &'static str,
        wake: Wake,
        owner: String,
    ) -> Self {
        Self::spawn_command(
            root,
            executable.map(|executable| LaunchCommand {
                executable,
                ..Default::default()
            }),
            launcher,
            wake,
            owner,
        )
    }
    /// Launch a CLI recipe without dropping its prefix arguments or captured environment.
    pub fn spawn_command(
        root: PathBuf,
        launch: Option<LaunchCommand>,
        launcher: &'static str,
        wake: Wake,
        owner: String,
    ) -> Self {
        Self::spawn_prepared(root, launcher, wake, owner, move || Ok(launch))
    }
    /// Preparation is authoritative and completes before allocating a PTY or
    /// starting a process. Closing the view while it runs prevents late launch.
    pub fn spawn_prepared(
        root: PathBuf,
        launcher: &'static str,
        wake: Wake,
        owner: String,
        prepare: impl FnOnce() -> Result<Option<LaunchCommand>, String> + Send + 'static,
    ) -> Self {
        Self::spawn_with_bootstrap(root, launcher, wake, owner, move || {
            Ok(PreparedLaunch {
                command: prepare()?,
                bootstrap: None,
                replace_environment: false,
            })
        })
    }
    /// Starts an interactive shell whose first foreground command is the Agent.
    /// The preparation boundary still runs before PTY allocation and can fail closed.
    pub fn spawn_shell_prepared(
        root: PathBuf,
        launcher: &'static str,
        wake: Wake,
        owner: String,
        prepare: impl FnOnce() -> Result<shell::ShellHost, String> + Send + 'static,
    ) -> Self {
        Self::spawn_with_bootstrap(root, launcher, wake, owner, move || {
            let mut host = prepare()?;
            let mut host_environment = shell::Environment::new();
            if let Some(endpoint) = super::cli_control::serving() {
                host_environment.insert(
                    "PUPPYONE_CLI_ENDPOINT".into(),
                    endpoint.to_string_lossy().into_owned(),
                );
            }
            if let Some(bundle) = super::cli_control::bundle_path() {
                host_environment.insert(
                    "PUPPYONE_APP_PATH".into(),
                    bundle.to_string_lossy().into_owned(),
                );
            }
            host.prepare_environment(
                env!("CARGO_PKG_VERSION"),
                &host_environment,
                shell::current_platform(),
            );
            Ok(PreparedLaunch {
                command: Some(host.command),
                bootstrap: host.bootstrap_input,
                replace_environment: true,
            })
        })
    }
    fn spawn_with_bootstrap(
        root: PathBuf,
        launcher: &'static str,
        wake: Wake,
        owner: String,
        prepare: impl FnOnce() -> Result<PreparedLaunch, String> + Send + 'static,
    ) -> Self {
        Self::spawn_with_bootstrap_writer(root, launcher, wake, owner, prepare, write_bootstrap)
    }
    fn spawn_with_bootstrap_writer(
        root: PathBuf,
        launcher: &'static str,
        wake: Wake,
        owner: String,
        prepare: impl FnOnce() -> Result<PreparedLaunch, String> + Send + 'static,
        bootstrap_writer: impl FnOnce(&mut dyn Write, &str) -> Result<(), String> + Send + 'static,
    ) -> Self {
        let (tx, rx) = mpsc::sync_channel(64);
        let (out, events) = mpsc::sync_channel(128);
        let stop = Arc::new(AtomicBool::new(false));
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let key = format!("terminal:{}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
        let project = root.to_string_lossy().into_owned();
        let activity_owner = owner.clone();
        let lease =
            match super::host_budget::Budget::global().reserve(key, owner, project, "terminal") {
                Ok(lease) => lease,
                Err(refusal) => {
                    let _ = out.send(Event::Error(refusal.to_string()));
                    wake.notify();
                    return Self {
                        tx,
                        events,
                        stop,
                        pid: Arc::new(AtomicI32::new(0)),
                        foreground: Arc::new(AtomicI32::new(0)),
                    };
                }
            };
        let stopping = stop.clone();
        let pid = Arc::new(AtomicI32::new(0));
        let child_pid = pid.clone();
        let foreground = Arc::new(AtomicI32::new(0));
        let foreground_pid = foreground.clone();
        std::thread::spawn(move || {
            // `prepareTerminalSession`, off the UI thread (it reads the
            // Agents' Hook configuration).
            let activity_session = uuid::Uuid::new_v4().to_string();
            let mut activity = Vec::new();
            let result = (|| -> anyhow::Result<()> {
                if stopping.load(Ordering::Acquire) {
                    return Ok(());
                }
                let prepared = prepare().map_err(anyhow::Error::msg)?;
                let launch = prepared.command;
                if stopping.load(Ordering::Acquire) {
                    return Ok(());
                }
                activity = super::agent_activity::host::Host::global().prepare_terminal_session(
                    &activity_session,
                    launcher,
                    &root,
                    &activity_owner,
                );
                let pair = native_pty_system().openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })?;
                let shell = launch.is_none();
                let executable = launch
                    .as_ref()
                    .map(|c| c.executable.clone())
                    .unwrap_or_else(|| {
                        std::env::var_os("SHELL")
                            .map(PathBuf::from)
                            .filter(|p| p.is_absolute())
                            .unwrap_or_else(|| PathBuf::from("/bin/zsh"))
                    });
                let input_shell = executable.to_string_lossy().into_owned();
                let mut command = CommandBuilder::new(executable);
                if prepared.replace_environment {
                    command.env_clear();
                }
                if shell {
                    command.arg("-l");
                }
                command.cwd(root);
                if !prepared.replace_environment {
                    command.env("PATH", super::environment::search_path());
                }
                if let Some(launch) = &launch {
                    command.args(&launch.arguments);
                    for (key, value) in &launch.environment {
                        command.env(key, value);
                    }
                }
                // Discovery can capture TERM=dumb; the actual PTY owns these capabilities.
                command.env("TERM", "xterm-256color");
                command.env("COLORTERM", "truecolor");
                // Which app hosts the terminal, so `puppyone open` reaches
                // this one.
                if let Some(endpoint) = super::cli_control::serving() {
                    command.env("PUPPYONE_CLI_ENDPOINT", endpoint);
                }
                if let Some(bundle) = super::cli_control::bundle_path() {
                    command.env("PUPPYONE_APP_PATH", bundle);
                }
                for (key, value) in &activity {
                    command.env(key, value);
                }
                let mut child = ChildGuard(pair.slave.spawn_command(command)?);
                child_pid.store(child.process_id().unwrap_or(0) as i32, Ordering::Release);
                if let Some(pid) = child.process_id() {
                    // Over its sustained budget the host stops like a close;
                    // the reason reaches the tab before the exit.
                    let (exceeded_stop, exceeded_out, exceeded_wake) =
                        (stopping.clone(), out.clone(), wake.clone());
                    lease.bind_process(pid, super::host_budget::Role::Utility, move |code| {
                        let _ = exceeded_out.try_send(Event::Error(code.message().into()));
                        exceeded_stop.store(true, Ordering::Relaxed);
                        exceeded_wake.notify();
                    });
                }
                lease.ready();
                drop(pair.slave);
                let mut reader = pair.master.try_clone_reader()?;
                let mut writer = pair.master.take_writer()?;
                let _ = out.send(Event::Started { input_shell });
                wake.notify();
                let output = out.clone();
                let notifier = wake.clone();
                std::thread::spawn(move || {
                    let mut buffer = [0; 8192];
                    while let Ok(n) = reader.read(&mut buffer) {
                        if n == 0 {
                            break;
                        }
                        if output.send(Event::Data(buffer[..n].to_vec())).is_err() {
                            break;
                        }
                        notifier.notify();
                    }
                });
                if let Some(bootstrap) = prepared.bootstrap {
                    bootstrap_writer(&mut writer, &bootstrap).map_err(anyhow::Error::msg)?;
                }
                loop {
                    #[cfg(unix)]
                    foreground_pid.store(
                        pair.master.process_group_leader().unwrap_or(0),
                        Ordering::Release,
                    );
                    if stopping.load(Ordering::Relaxed) {
                        #[cfg(unix)]
                        unsafe {
                            if let Some(pid) = pair.master.process_group_leader()
                                && pid > 0
                            {
                                libc::kill(-pid, libc::SIGHUP);
                            }
                            if let Some(pid) = child.process_id() {
                                libc::kill(-(pid as i32), libc::SIGHUP);
                            }
                        }
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    if let Some(status) = child.try_wait()? {
                        let _ = out.send(Event::Exit(status.exit_code()));
                        wake.notify();
                        break;
                    }
                    match rx.recv_timeout(Duration::from_millis(25)) {
                        Ok(Request::Input(bytes)) => {
                            writer.write_all(&bytes)?;
                            writer.flush()?;
                        }
                        Ok(Request::Resize(rows, cols)) => pair.master.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        })?,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        _ => {}
                    }
                }
                child_pid.store(0, Ordering::Release);
                foreground_pid.store(0, Ordering::Release);
                Ok(())
            })();
            // The child was waited for (or never started): release the slot
            // and end the session's file activity (`onExit`).
            child_pid.store(0, Ordering::Release);
            foreground_pid.store(0, Ordering::Release);
            drop(lease);
            if !activity.is_empty() {
                super::agent_activity::host::Host::global()
                    .close_terminal_session(&activity_session);
            }
            if let Err(e) = result {
                let _ = out.send(Event::Error(e.to_string()));
                wake.notify();
            }
        });
        Self {
            tx,
            events,
            stop,
            pid,
            foreground,
        }
    }
    pub fn input(&self, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.len() > 1024 * 1024 {
            return Err(crate::localization::t("native.terminal.pasteTooLarge").into());
        }
        self.tx
            .try_send(Request::Input(bytes))
            .map_err(|e| e.to_string())
    }
    pub fn resize(&self, rows: u16, cols: u16) {
        let _ = self.tx.try_send(Request::Resize(rows, cols));
    }
}
fn write_bootstrap(writer: &mut dyn Write, input: &str) -> Result<(), String> {
    writer
        .write_all(input.as_bytes())
        .and_then(|()| writer.flush())
        .map_err(|_| "TERMINAL_AGENT_START_FAILED".to_owned())
}
/// The far side of a [`Terminal::bridged`] session: what it is asked, and
/// where its output goes.
pub struct Bridge {
    pub requests: Receiver<Request>,
    pub outlet: Outlet,
}
pub struct Outlet {
    events: SyncSender<Event>,
    wake: Wake,
    stop: Arc<AtomicBool>,
}
impl Outlet {
    /// Hands `event` to the session; `false` once it is gone.
    pub fn send(&self, event: Event) -> bool {
        let sent = self.events.send(event).is_ok();
        self.wake.notify();
        sent && !self.stopped()
    }
    /// The view draws again (its state changed without output).
    pub fn notify(&self) {
        self.wake.notify();
    }
    /// The session was closed here.
    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
}
impl Drop for Terminal {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        #[cfg(unix)]
        for pid in [
            self.foreground.load(Ordering::Acquire),
            self.pid.load(Ordering::Acquire),
        ] {
            if pid > 0 {
                unsafe {
                    libc::kill(-pid, libc::SIGHUP);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closing_a_terminal_during_preparation_releases_its_lease_without_starting_the_late_command()
    {
        let _exclusive = PTY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("must-not-start");
        let command_marker = marker.clone();
        let owner = format!("prepare-close-{}", uuid::Uuid::new_v4());
        let (entered, started) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let terminal = Terminal::spawn_prepared(
            dir.path().into(),
            "shell",
            Wake::default(),
            owner.clone(),
            move || {
                entered.send(()).unwrap();
                gate.recv().unwrap();
                Ok(Some(LaunchCommand {
                    executable: "/bin/sh".into(),
                    arguments: vec![
                        "-c".into(),
                        ": > \"$1\"".into(),
                        "fixture".into(),
                        command_marker.to_string_lossy().into(),
                    ],
                    environment: vec![],
                }))
            },
        );
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(
            super::super::host_budget::Budget::global()
                .snapshot()
                .iter()
                .any(|r| r.owner == owner)
        );
        drop(terminal);
        release.send(()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while super::super::host_budget::Budget::global()
            .snapshot()
            .iter()
            .any(|r| r.owner == owner)
        {
            assert!(
                std::time::Instant::now() < deadline,
                "preparation retained the process lease"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(
            !marker.exists(),
            "a late resolution started a command after its terminal closed"
        );
    }
    #[test]
    fn verified_cli_arguments_and_environment_reach_the_real_pty_without_shell_interpolation() {
        let _exclusive = PTY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let terminal = Terminal::spawn_command(
            dir.path().into(),
            Some(LaunchCommand {
                executable: "/bin/sh".into(),
                arguments: vec![
                    "-c".into(),
                    "printf 'ARG=<%s> ENV=<%s> TERM=<%s>\\n' \"$1\" \"$PUPPYONE_RECIPE_TEST\" \"$TERM\"".into(),
                    "fixture".into(),
                    "literal $(touch must-not-exist)".into(),
                ],
                environment: vec![("PUPPYONE_RECIPE_TEST".into(), "private value".into()), ("TERM".into(), "dumb".into())],
            }),
            "shell",
            Wake::default(),
            format!("recipe-test-{}", uuid::Uuid::new_v4()),
        );
        let mut output = String::new();
        let mut exited = false;
        let expected =
            "ARG=<literal $(touch must-not-exist)> ENV=<private value> TERM=<xterm-256color>";
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while !exited || !output.contains("ARG=<") {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            match terminal
                .events
                .recv_timeout(remaining)
                .expect("PTY recipe did not finish")
            {
                Event::Started { .. } => (),
                Event::Data(bytes) => output.push_str(&String::from_utf8_lossy(&bytes)),
                Event::Error(error) => panic!("{error}"),
                Event::Exit(code) => {
                    assert_eq!(code, 0);
                    exited = true;
                }
            }
        }
        assert!(output.contains(expected), "{output}");
        assert!(!dir.path().join("must-not-exist").exists());
    }
    #[test]
    #[ignore = "real PTY integration; run explicitly on a desktop host"]
    fn real_pty_input_resize_and_cleanup() {
        let _exclusive = PTY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let terminal = Terminal::spawn(
            dir.path().into(),
            Some(PathBuf::from("/bin/sh")),
            "shell",
            Wake::default(),
            "test".into(),
        );
        terminal.resize(33, 91);
        terminal
            .input(b"printf 'GPUI_PTY_OK\\n'; stty size\n".to_vec())
            .unwrap();
        let start = std::time::Instant::now();
        let mut output = String::new();
        while !output.contains("33 91") {
            match terminal
                .events
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
            {
                Event::Started { .. } => (),
                Event::Data(bytes) => output.push_str(&String::from_utf8_lossy(&bytes)),
                Event::Error(e) => panic!("{e}"),
                Event::Exit(code) => panic!("early exit {code}"),
            }
            assert!(start.elapsed() < Duration::from_secs(10));
        }
        assert!(output.contains("GPUI_PTY_OK"));
        let pid = terminal.pid.load(Ordering::Acquire);
        assert!(pid > 0);
        drop(terminal);
        let start = std::time::Instant::now();
        while unsafe { libc::kill(pid, 0) } == 0 {
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "PTY process survived close"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

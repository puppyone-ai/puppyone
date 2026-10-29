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
pub enum Event {
    Data(Vec<u8>),
    Error(String),
    Exit(u32),
}
enum Command {
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
    tx: SyncSender<Command>,
    pub events: Receiver<Event>,
    stop: Arc<AtomicBool>,
    pid: Arc<AtomicI32>,
    foreground: Arc<AtomicI32>,
}
impl Terminal {
    /// A session with no PTY behind it (tests and lab fixtures).
    #[cfg(any(test, feature = "dev-capture"))]
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
    /// Starts a PTY host under the process budget of `owner` (its window).
    /// A refused reservation reports capacity instead of starting a shell.
    pub fn spawn(root: PathBuf, executable: Option<PathBuf>, wake: Wake, owner: String) -> Self {
        let (tx, rx) = mpsc::sync_channel(64);
        let (out, events) = mpsc::sync_channel(128);
        let stop = Arc::new(AtomicBool::new(false));
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let key = format!("terminal:{}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
        let project = root.to_string_lossy().into_owned();
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
            let result = (|| -> anyhow::Result<()> {
                let pair = native_pty_system().openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })?;
                let shell = executable.is_none();
                let executable = executable.unwrap_or_else(|| {
                    std::env::var_os("SHELL")
                        .map(PathBuf::from)
                        .filter(|p| p.is_absolute())
                        .unwrap_or_else(|| PathBuf::from("/bin/zsh"))
                });
                let mut command = CommandBuilder::new(executable);
                if shell {
                    command.arg("-l");
                }
                command.cwd(root);
                command.env("TERM", "xterm-256color");
                command.env("COLORTERM", "truecolor");
                command.env("PATH", super::environment::search_path());
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
                        Ok(Command::Input(bytes)) => {
                            writer.write_all(&bytes)?;
                            writer.flush()?;
                        }
                        Ok(Command::Resize(rows, cols)) => pair.master.resize(PtySize {
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
            // The child was waited for (or never started): release the slot.
            drop(lease);
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
            .try_send(Command::Input(bytes))
            .map_err(|e| e.to_string())
    }
    pub fn resize(&self, rows: u16, cols: u16) {
        let _ = self.tx.try_send(Command::Resize(rows, cols));
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
    #[ignore = "real PTY integration; run explicitly on a desktop host"]
    fn real_pty_input_resize_and_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let terminal = Terminal::spawn(
            dir.path().into(),
            Some(PathBuf::from("/bin/sh")),
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

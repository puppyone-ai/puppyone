//! Native installation discovery and an isolated JSONL transport per conversation.
//! The CLI owns credentials; this host never reads or stores authentication files.
use crate::platform::{
    environment::search_path,
    process::{isolate, terminate},
};
use crate::wake::Wake;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread,
    time::Duration,
};

#[derive(Debug)]
pub enum Event {
    Message(Value),
    Error(String),
    Exited,
}
pub struct Connection {
    tx: SyncSender<Value>,
    events: Receiver<(Event, usize)>,
    queued: Arc<AtomicUsize>,
    wake: Wake,
    stop: Arc<AtomicBool>,
    pid: Arc<AtomicI32>,
}
impl Connection {
    #[cfg(test)]
    pub fn harness() -> (Self, Receiver<Value>, SyncSender<(Event, usize)>) {
        let (tx, requests) = mpsc::sync_channel(64);
        let (events_tx, events) = mpsc::sync_channel(256);
        (
            Self {
                tx,
                events,
                queued: Arc::new(AtomicUsize::new(0)),
                wake: Wake::default(),
                stop: Arc::new(AtomicBool::new(false)),
                pid: Arc::new(AtomicI32::new(0)),
            },
            requests,
            events_tx,
        )
    }
    pub fn spawn(executable: PathBuf, args: Vec<String>, root: PathBuf, wake: Wake) -> Self {
        Self::spawn_with_env(executable, args, root, wake, vec![])
    }
    pub fn spawn_with_env(
        executable: PathBuf,
        args: Vec<String>,
        root: PathBuf,
        wake: Wake,
        environment: Vec<(String, String)>,
    ) -> Self {
        let (tx, requests) = mpsc::sync_channel::<Value>(64);
        let (events_tx, events) = mpsc::sync_channel(256);
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let pid = Arc::new(AtomicI32::new(0));
        let child_pid = pid.clone();
        let queued = Arc::new(AtomicUsize::new(0));
        let queued_reader = queued.clone();
        let connection_wake = wake.clone();
        thread::spawn(move || {
            let mut command = Command::new(executable);
            command
                .args(args)
                .current_dir(root)
                .env("PATH", search_path())
                .envs(environment)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            isolate(&mut command);
            let mut child = match command.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = events_tx.send((Event::Error(e.to_string()), 0));
                    wake.notify();
                    return;
                }
            };
            child_pid.store(child.id() as i32, Ordering::Release);
            let stdout = child.stdout.take().unwrap();
            let stderr = child.stderr.take().unwrap();
            let mut stdin = child.stdin.take().unwrap();
            let sender = events_tx.clone();
            let notifier = wake.clone();
            let reader_stop = stopped.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    let mut line = Vec::new();
                    // take() bounds allocations even for a broken provider that omits a newline.
                    use std::io::Read;
                    match reader
                        .by_ref()
                        .take(16 * 1024 * 1024 + 1)
                        .read_until(b'\n', &mut line)
                    {
                        Ok(0) => break,
                        Ok(n) if n <= 16 * 1024 * 1024 => match serde_json::from_slice(&line) {
                            Ok(value) => {
                                while queued_reader.load(Ordering::Acquire) + n > 16 * 1024 * 1024 {
                                    if reader_stop.load(Ordering::Relaxed) {
                                        return;
                                    }
                                    thread::sleep(Duration::from_millis(5));
                                }
                                queued_reader.fetch_add(n, Ordering::AcqRel);
                                if sender.send((Event::Message(value), n)).is_err() {
                                    queued_reader.fetch_sub(n, Ordering::AcqRel);
                                    break;
                                }
                                notifier.notify();
                            }
                            Err(e) => {
                                reader_stop.store(true, Ordering::Relaxed);
                                let _ = sender.send((
                                    Event::Error(format!("Invalid Agent protocol message: {e}")),
                                    0,
                                ));
                                notifier.notify();
                                break;
                            }
                        },
                        _ => {
                            reader_stop.store(true, Ordering::Relaxed);
                            let _ = sender.send((
                                Event::Error("Agent protocol output exceeded its limit".into()),
                                0,
                            ));
                            notifier.notify();
                            break;
                        }
                    }
                }
            });
            let diagnostics = Arc::new(Mutex::new(Vec::<u8>::new()));
            let diagnostic_reader = diagnostics.clone();
            // Retain only a bounded diagnostic tail; redact before it reaches the application.
            thread::spawn(move || {
                let mut reader = stderr;
                let mut buf = [0; 8192];
                use std::io::Read;
                while let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let mut tail = diagnostic_reader.lock().unwrap();
                    tail.extend_from_slice(&buf[..n]);
                    let trim = tail.len().saturating_sub(8192);
                    tail.drain(..trim);
                }
            });
            loop {
                if stopped.load(Ordering::Relaxed) {
                    terminate(&mut child);
                    break;
                }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if !status.success() {
                            let tail =
                                String::from_utf8_lossy(&diagnostics.lock().unwrap()).into_owned();
                            let _ = events_tx.try_send((
                                Event::Error(format!(
                                    "Agent exited ({status}). {}",
                                    redact_diagnostics(&tail)
                                )),
                                0,
                            ));
                        }
                        break;
                    }
                    Err(e) => {
                        let _ = events_tx.try_send((Event::Error(e.to_string()), 0));
                        terminate(&mut child);
                        break;
                    }
                    _ => {}
                }
                match requests.recv_timeout(Duration::from_millis(25)) {
                    Ok(value) => {
                        if serde_json::to_writer(&mut stdin, &value).is_err()
                            || stdin.write_all(b"\n").is_err()
                            || stdin.flush().is_err()
                        {
                            let _ = events_tx
                                .try_send((Event::Error("Agent connection closed".into()), 0));
                            terminate(&mut child);
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        terminate(&mut child);
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
            }
            child_pid.store(0, Ordering::Release);
            let _ = events_tx.send((Event::Exited, 0));
            wake.notify();
        });
        Self {
            tx,
            events,
            queued,
            wake: connection_wake,
            stop,
            pid,
        }
    }
    pub fn drain(&self, limit: usize) -> Vec<Event> {
        let mut result = Vec::new();
        while result.len() < limit {
            match self.events.try_recv() {
                Ok((event, bytes)) => {
                    self.queued.fetch_sub(bytes, Ordering::AcqRel);
                    result.push(event);
                }
                Err(_) => break,
            }
        }
        if result.len() == limit {
            self.wake.notify();
        }
        result
    }
    pub fn send(&self, message: Value) -> Result<(), String> {
        if message.to_string().len() > 32 * 1024 * 1024 {
            return Err("Agent input exceeds 32 MiB".into());
        }
        self.tx
            .try_send(message)
            .map_err(|e| format!("Cannot send to Agent: {e}"))
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        // Signal synchronously so application exit cannot outrun the worker's cleanup.
        #[cfg(unix)]
        {
            let pid = self.pid.load(Ordering::Acquire);
            if pid > 0 {
                unsafe {
                    libc::kill(-pid, libc::SIGTERM);
                }
            }
        }
    }
}

fn redact_diagnostics(text: &str) -> String {
    text.lines()
        .map(|line| {
            let lower = line.to_lowercase();
            if [
                "token",
                "authorization",
                "api_key",
                "api-key",
                "api key",
                "password",
                "secret",
                "sk-",
            ]
            .iter()
            .any(|s| lower.contains(s))
            {
                "[sensitive diagnostic redacted]".into()
            } else {
                line.chars()
                    .filter(|c| !c.is_control() || *c == '\t')
                    .collect::<String>()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_redact_sensitive_lines_and_controls() {
        let text = redact_diagnostics(
            "normal failure\nAuthorization: Bearer secret-value\napi_key=credential\nnext\u{1b}[31m",
        );
        assert!(text.contains("normal failure"));
        assert!(!text.contains("secret-value"));
        assert!(!text.contains("credential"));
        assert!(!text.contains('\u{1b}'));
    }
    #[test]
    fn draining_receipts_releases_the_byte_budget() {
        let (c, _, tx) = Connection::harness();
        c.queued.store(100, Ordering::Release);
        tx.send((Event::Message(serde_json::json!({"id":1})), 40))
            .unwrap();
        tx.send((Event::Message(serde_json::json!({"id":2})), 60))
            .unwrap();
        assert_eq!(c.drain(1).len(), 1);
        assert_eq!(c.queued.load(Ordering::Acquire), 60);
        assert_eq!(c.drain(64).len(), 1);
        assert_eq!(c.queued.load(Ordering::Acquire), 0);
    }
}

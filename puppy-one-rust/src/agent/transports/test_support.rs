//! A scripted native process for transport and adapter tests (the
//! product's `createChild()` fakes).
use super::jsonl_rpc_connection::{ConnectionOptions, ProcessIo, Spawner};
use crate::agent::agent_error::AgentError;
use std::cell::RefCell;
use std::rc::Rc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tokio::sync::oneshot;

type ExitSignal = (Option<i32>, Option<String>, Option<AgentError>);

/// The test side of a fake child.
#[derive(Clone)]
pub struct FakeChild {
    /// Every line written to the child's stdin.
    pub writes: Rc<RefCell<Vec<String>>>,
    /// Each kill signal (`true` = forced).
    pub kills: Rc<RefCell<Vec<bool>>>,
    stdout: Rc<RefCell<Option<DuplexStream>>>,
    exit: Rc<RefCell<Option<oneshot::Sender<ExitSignal>>>>,
    /// A graceful kill makes the child exit (`child.emit("close")`).
    exits_on_kill: bool,
}

impl FakeChild {
    /// `child.stdout.write(text)`.
    pub async fn stdout(&self, text: &str) {
        let mut stdout = self.stdout.borrow_mut().take().expect("stdout open");
        stdout
            .write_all(text.as_bytes())
            .await
            .expect("stdout write");
        stdout.flush().await.expect("stdout flush");
        *self.stdout.borrow_mut() = Some(stdout);
        // Let the reader frame and dispatch what was written.
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    /// The JSON values written to stdin.
    pub fn messages(&self) -> Vec<serde_json::Value> {
        self.writes
            .borrow()
            .iter()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    /// `child.stdout.end()`: the reader sees EOF.
    pub fn end_stdout(&self) {
        self.stdout.borrow_mut().take();
    }

    /// The process exits.
    pub fn exit(&self, code: Option<i32>, signal: Option<&str>) {
        if let Some(exit) = self.exit.borrow_mut().take() {
            let _ = exit.send((code, signal.map(str::to_string), None));
        }
    }
}

/// A spawner whose child is driven by the returned [`FakeChild`].
pub fn fake_spawner(exits_on_kill: bool) -> (Spawner, FakeChild) {
    let child = FakeChild {
        writes: Rc::default(),
        kills: Rc::default(),
        stdout: Rc::default(),
        exit: Rc::default(),
        exits_on_kill,
    };
    let handle = child.clone();
    let spawner: Spawner = Rc::new(move |_options: &ConnectionOptions| {
        let (stdin, stdin_peer) = tokio::io::duplex(1 << 20);
        let (stdout_peer, stdout) = tokio::io::duplex(1 << 20);
        let (_stderr_peer, stderr) = tokio::io::duplex(1 << 16);
        *handle.stdout.borrow_mut() = Some(stdout_peer);
        let (exit_tx, exit_rx) = oneshot::channel();
        *handle.exit.borrow_mut() = Some(exit_tx);
        let writes = handle.writes.clone();
        tokio::task::spawn_local(async move {
            let mut lines = BufReader::new(stdin_peer).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                writes.borrow_mut().push(line.trim().to_string());
            }
        });
        let kills = handle.kills.clone();
        let exit = handle.exit.clone();
        let exits_on_kill = handle.exits_on_kill;
        Ok(ProcessIo {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
            stderr: Box::new(stderr),
            exit: Box::pin(async move {
                exit_rx
                    .await
                    .unwrap_or((None, Some("SIGTERM".into()), None))
            }),
            kill: Rc::new(move |force| {
                kills.borrow_mut().push(force);
                if exits_on_kill && let Some(exit) = exit.borrow_mut().take() {
                    let _ = exit.send((
                        None,
                        Some(if force { "SIGKILL" } else { "SIGTERM" }.into()),
                        None,
                    ));
                }
                true
            }),
        })
    });
    (spawner, child)
}

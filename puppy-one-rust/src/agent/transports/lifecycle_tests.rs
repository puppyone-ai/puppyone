//! Both native pipe protocols obey the same cancellation and process lifetime contract.
use super::jsonl_rpc_connection::{ConnectionOptions, JsonlRpcConnection, RequestOptions, Spawner};
use super::test_support::fake_spawner;
use crate::agent::agent_error::AgentResult;
use crate::agent::application::tests_support::run_local;
use crate::agent::protocols::pi_rpc::pi_rpc_client::{PiClientOptions, PiRpcClient};
use crate::agent::tasks::Canceller;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::Cell;
use std::io;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::AsyncWrite;

#[derive(Clone)]
enum Client {
    Jsonl(JsonlRpcConnection),
    Pi(PiRpcClient),
}
impl Client {
    fn new(pi: bool, spawner: Spawner, max_line_bytes: Option<usize>) -> Self {
        if pi {
            Self::Pi(
                PiRpcClient::spawn(PiClientOptions {
                    executable_path: "/usr/bin/fake".into(),
                    cwd: "/workspace".into(),
                    env: Some(Vec::new()),
                    spawner: Some(spawner),
                    max_line_bytes,
                    ..Default::default()
                })
                .unwrap(),
            )
        } else {
            Self::Jsonl(
                JsonlRpcConnection::spawn(ConnectionOptions {
                    executable_path: "/usr/bin/fake".into(),
                    cwd: "/workspace".into(),
                    env: Some(Vec::new()),
                    spawner: Some(spawner),
                    max_line_bytes,
                    ..Default::default()
                })
                .unwrap(),
            )
        }
    }
    async fn request(&self, options: RequestOptions) -> AgentResult<Value> {
        match self {
            Self::Jsonl(c) => c.request("prompt", json!({}), options).await,
            Self::Pi(c) => c.request_now("prompt", json!({}), options).await,
        }
    }
    fn closed(&self) -> bool {
        match self {
            Self::Jsonl(c) => c.closed(),
            Self::Pi(c) => c.closed(),
        }
    }
    fn dispose(&self) {
        match self {
            Self::Jsonl(c) => c.dispose("test complete", true),
            Self::Pi(c) => c.dispose_with("test complete", true),
        }
    }
    async fn exit(&self) -> AgentResult<Value> {
        match self {
            Self::Jsonl(c) => c.wait_for_exit(Some(2_000)).await,
            Self::Pi(c) => c.wait_for_exit_now(Some(2_000)).await,
        }
    }
}
async fn wait_until(ready: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !ready() {
        assert!(Instant::now() < deadline, "native transport did not settle");
        tokio::task::yield_now().await;
    }
}

#[test]
fn cancellation_before_dispatch_writes_nothing_and_after_dispatch_keeps_delivery_unknown() {
    run_local(async {
        for pi in [false, true] {
            let (spawner, child) = fake_spawner(true);
            let connection = Client::new(pi, spawner, None);
            let before = Canceller::new();
            before.cancel(crate::agent::agent_error::AgentError::new("Cancelled"));
            let error = connection
                .request(RequestOptions {
                    signal: Some(before.signal()),
                    ..Default::default()
                })
                .await
                .unwrap_err();
            assert!(error.message.contains("Cancelled"));
            assert!(child.writes.borrow().is_empty());
            let after = Canceller::new();
            let signal = after.signal();
            let pending = {
                let connection = connection.clone();
                tokio::task::spawn_local(async move {
                    connection
                        .request(RequestOptions {
                            signal: Some(signal),
                            ..Default::default()
                        })
                        .await
                })
            };
            wait_until(|| !child.writes.borrow().is_empty()).await;
            after.cancel(crate::agent::agent_error::AgentError::new("Cancelled"));
            assert_eq!(
                pending
                    .await
                    .unwrap()
                    .unwrap_err()
                    .delivery_outcome
                    .as_deref(),
                Some("unknown")
            );
            assert!(!connection.closed());
            assert!(child.kills.borrow().is_empty());
            connection.dispose();
            connection.exit().await.unwrap();
            assert!(!child.kills.borrow().is_empty());
        }
    });
}

struct BrokenPipe {
    yielded: bool,
}
impl AsyncWrite for BrokenPipe {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        _: &[u8],
    ) -> Poll<io::Result<usize>> {
        if !self.yielded {
            self.yielded = true;
            cx.waker().wake_by_ref();
            Poll::Pending
        } else {
            Poll::Ready(Err(io::Error::new(io::ErrorKind::BrokenPipe, "EPIPE")))
        }
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

#[test]
fn asynchronous_broken_pipes_settle_pending_requests_and_process_exit() {
    run_local(async {
        for pi in [false, true] {
            let (spawn, child) = fake_spawner(true);
            let spawner: Spawner = Rc::new(move |options| {
                let mut io = spawn(options)?;
                io.stdin = Box::new(BrokenPipe { yielded: false });
                Ok(io)
            });
            let connection = Client::new(pi, spawner, None);
            let error = connection
                .request(RequestOptions::default())
                .await
                .unwrap_err();
            assert_eq!(error.delivery_outcome.as_deref(), Some("unknown"));
            connection.exit().await.unwrap();
            assert!(connection.closed());
            assert!(!child.kills.borrow().is_empty());
            assert!(connection.request(RequestOptions::default()).await.is_err());
        }
    });
}

#[test]
fn unfinished_oversized_tails_are_rejected_after_a_valid_message() {
    run_local(async {
        for pi in [false, true] {
            let (spawner, child) = fake_spawner(true);
            let connection = Client::new(pi, spawner, Some(80));
            let valid = if pi {
                json!({ "type": "agent_start" })
            } else {
                json!({ "method": "notice" })
            };
            child.stdout(&format!("{valid}\n{}", "x".repeat(81))).await;
            wait_until(|| connection.closed()).await;
            connection.exit().await.unwrap();
        }
    });
}

#[test]
fn disposal_waits_for_the_operating_system_exit_notification() {
    run_local(async {
        for pi in [false, true] {
            let (spawner, child) = fake_spawner(false);
            let connection = Client::new(pi, spawner, None);
            connection.dispose();
            let observing = Rc::new(Cell::new(false));
            let started = observing.clone();
            let wait = tokio::task::spawn_local(async move {
                started.set(true);
                connection.exit().await
            });
            wait_until(|| observing.get()).await;
            assert!(!wait.is_finished());
            child.exit(Some(0), None);
            wait.await.unwrap().unwrap();
        }
    });
}

#[test]
fn malformed_jsonrpc_success_is_uncertain_delivery_and_retires_the_process() {
    run_local(async {
        let (spawner, child) = fake_spawner(true);
        let connection = Client::new(false, spawner, None);
        let pending = {
            let connection = connection.clone();
            tokio::task::spawn_local(
                async move { connection.request(RequestOptions::default()).await },
            )
        };
        wait_until(|| !child.writes.borrow().is_empty()).await;
        child.stdout("{\"id\":1}\n").await;
        assert_eq!(
            pending
                .await
                .unwrap()
                .unwrap_err()
                .delivery_outcome
                .as_deref(),
            Some("unknown")
        );
        connection.exit().await.unwrap();
        assert!(connection.closed());
    });
}

async fn reply(child: &super::test_support::FakeChild, pi: bool, index: usize, data: Value) {
    let message = child.messages()[index].clone();
    let response = if pi {
        json!({"type":"response", "id":message["id"], "command":message["type"], "success":true, "data":data})
    } else {
        json!({"id":message["id"], "result":data})
    };
    child.stdout(&format!("{response}\n")).await;
}

#[test]
fn a_slow_request_timeout_keeps_siblings_streams_and_late_receipts_alive() {
    crate::agent::application::tests_support::run_paused_local(async {
        for pi in [false, true] {
            let (spawner, child) = fake_spawner(true);
            let connection = Client::new(pi, spawner, None);
            let receipts = Rc::new(std::cell::RefCell::new(Vec::new()));
            let recorded = receipts.clone();
            let slow = {
                let c = connection.clone();
                tokio::task::spawn_local(async move {
                    c.request(RequestOptions {
                        timeout_ms: Some(20),
                        on_late_response: Some(Rc::new(move |r| recorded.borrow_mut().push(r))),
                        ..Default::default()
                    })
                    .await
                })
            };
            wait_until(|| child.messages().len() == 1).await;
            let sibling = {
                let c = connection.clone();
                tokio::task::spawn_local(async move {
                    c.request(RequestOptions {
                        timeout_ms: Some(100),
                        ..Default::default()
                    })
                    .await
                })
            };
            wait_until(|| child.messages().len() == 2).await;
            tokio::time::advance(Duration::from_millis(25)).await;
            assert_eq!(
                slow.await.unwrap().unwrap_err().delivery_outcome.as_deref(),
                Some("unknown")
            );
            reply(&child, pi, 1, json!({"running":true})).await;
            assert_eq!(sibling.await.unwrap().unwrap(), json!({"running":true}));
            reply(&child, pi, 0, json!({"accepted":true})).await;
            assert_eq!(receipts.borrow().len(), 1);
            assert_eq!(
                receipts.borrow()[0].as_ref().unwrap(),
                &json!({"accepted":true})
            );
            assert_eq!(child.messages().len(), 2, "a mutation was resent");
            assert!(!connection.closed());
            assert!(child.kills.borrow().is_empty());
            connection.dispose();
            connection.exit().await.unwrap();
        }
    });
}

#[test]
fn cancelled_waits_ignore_late_replies_beyond_the_retained_receipt_window() {
    run_local(async {
        for pi in [false, true] {
            let (spawner, child) = fake_spawner(true);
            let connection = Client::new(pi, spawner, None);
            for index in 0..520 {
                let controller = Canceller::new();
                let signal = controller.signal();
                let pending = {
                    let c = connection.clone();
                    tokio::task::spawn_local(async move {
                        c.request(RequestOptions {
                            signal: Some(signal),
                            ..Default::default()
                        })
                        .await
                    })
                };
                wait_until(|| child.messages().len() == index + 1).await;
                controller.cancel(crate::agent::agent_error::AgentError::new("cancelled"));
                assert_eq!(
                    pending
                        .await
                        .unwrap()
                        .unwrap_err()
                        .delivery_outcome
                        .as_deref(),
                    Some("unknown")
                );
            }
            for index in [0, 519] {
                reply(&child, pi, index, json!({"ignored":true})).await;
            }
            assert!(!connection.closed());
            assert!(child.kills.borrow().is_empty());
            let next = {
                let c = connection.clone();
                tokio::task::spawn_local(async move { c.request(RequestOptions::default()).await })
            };
            wait_until(|| child.messages().len() == 521).await;
            reply(&child, pi, 520, json!({"usable":true})).await;
            assert_eq!(next.await.unwrap().unwrap(), json!({"usable":true}));
            connection.dispose();
            connection.exit().await.unwrap();
        }
    });
}

#[test]
fn actual_process_exit_rejects_all_pending_waits_as_unknown_delivery() {
    run_local(async {
        for pi in [false, true] {
            let (spawner, child) = fake_spawner(false);
            let connection = Client::new(pi, spawner, None);
            let mut requests = Vec::new();
            for _ in 0..3 {
                let c = connection.clone();
                requests.push(tokio::task::spawn_local(async move {
                    c.request(RequestOptions::default()).await
                }));
            }
            wait_until(|| child.messages().len() == 3).await;
            child.exit(Some(1), None);
            for request in requests {
                assert_eq!(
                    request
                        .await
                        .unwrap()
                        .unwrap_err()
                        .delivery_outcome
                        .as_deref(),
                    Some("unknown")
                );
            }
            assert!(connection.closed());
            connection.exit().await.unwrap();
        }
    });
}

#[test]
fn real_native_process_survives_a_deadline_accepts_a_late_receipt_and_stays_usable() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("delayed-rpc.sh");
        // Fixture wire messages are deliberately small and contain no escaped IDs.
        std::fs::write(&script,r#"while IFS= read -r line; do
  id=$(printf '%s' "$line" | /usr/bin/sed -nE 's/.*"id":("[^"]+"|[0-9]+).*/\1/p')
  case "$line" in *'"prompt"'*) command=prompt;; *) command=state;; esac
  case "$line" in
    *'"jsonrpc"'*) response="{\"id\":$id,\"result\":{\"pid\":$$}}";;
    *) response="{\"type\":\"response\",\"id\":$id,\"command\":\"$command\",\"success\":true,\"data\":{\"pid\":$$}}";;
  esac
  if [ "$command" = prompt ]; then (sleep 0.2; printf '%s\n' "$response") &
  else printf '%s\n' "$response"; fi
done
"#).unwrap();
        for pi in [false, true] {
            let connection = if pi {
                Client::Pi(
                    PiRpcClient::spawn(PiClientOptions {
                        executable_path: "/bin/sh".into(),
                        args_prefix: vec![script.to_string_lossy().into()],
                        cwd: directory.path().to_string_lossy().into(),
                        env: Some(vec![("PATH".into(), "/usr/bin:/bin".into())]),
                        force_kill_timeout_ms: Some(1000),
                        ..Default::default()
                    })
                    .unwrap(),
                )
            } else {
                Client::Jsonl(
                    JsonlRpcConnection::spawn(ConnectionOptions {
                        executable_path: "/bin/sh".into(),
                        args: vec![script.to_string_lossy().into()],
                        cwd: directory.path().into(),
                        env: Some(vec![("PATH".into(), "/usr/bin:/bin".into())]),
                        force_kill_timeout_ms: Some(1000),
                        ..Default::default()
                    })
                    .unwrap(),
                )
            };
            struct Cleanup(Client);
            impl Drop for Cleanup {
                fn drop(&mut self) {
                    self.0.dispose();
                }
            }
            let _cleanup = Cleanup(connection.clone());
            let state = |c: Client| async move {
                let options = RequestOptions {
                    timeout_ms: Some(5000),
                    ..Default::default()
                };
                match c {
                    Client::Jsonl(c) => c.request("state", json!({}), options).await,
                    Client::Pi(c) => c.request_now("state", json!({}), options).await,
                }
            };
            let initial = state(connection.clone()).await.unwrap();
            assert!(initial["pid"].as_u64().is_some());
            let receipt = Rc::new(std::cell::RefCell::new(None));
            let recorded = receipt.clone();
            let error = connection
                .request(RequestOptions {
                    timeout_ms: Some(20),
                    on_late_response: Some(Rc::new(move |r| {
                        assert!(
                            recorded.borrow_mut().replace(r).is_none(),
                            "duplicate late receipt"
                        )
                    })),
                    ..Default::default()
                })
                .await
                .unwrap_err();
            assert_eq!(error.delivery_outcome.as_deref(), Some("unknown"));
            assert!(!connection.closed());
            assert_eq!(state(connection.clone()).await.unwrap(), initial);
            wait_until(|| receipt.borrow().is_some()).await;
            assert_eq!(receipt.borrow_mut().take().unwrap().unwrap(), initial);
            assert_eq!(state(connection.clone()).await.unwrap(), initial);
            connection.dispose();
            connection.exit().await.unwrap();
            assert!(connection.closed());
            assert_eq!(
                unsafe { libc::kill(initial["pid"].as_i64().unwrap() as i32, 0) },
                -1
            );
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH)
            );
        }
    });
}

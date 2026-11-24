//! `tests/unit/agent/events/electron.agent-jsonrpc.test.mjs`.
use super::jsonl_rpc_connection::{
    ConnectionEvent, ConnectionOptions, JsonlRpcConnection, RequestOptions, rpc_error_code,
};
use super::test_support::fake_spawner;
use crate::agent::application::tests_support::run_paused_local;
use core::prelude::v1::test;
use serde_json::json;
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

fn options(spawner: super::jsonl_rpc_connection::Spawner) -> ConnectionOptions {
    ConnectionOptions {
        executable_path: PathBuf::from("/usr/local/bin/codex"),
        args: vec!["app-server".into(), "--listen".into(), "stdio://".into()],
        cwd: PathBuf::from("/workspace"),
        env: Some(Vec::new()),
        spawner: Some(spawner),
        ..Default::default()
    }
}

fn run<F: std::future::Future>(future: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    tokio::task::LocalSet::new().block_on(&runtime, future)
}

#[test]
fn rejects_non_canonical_process_launch_inputs_before_spawning() {
    run(async {
        let (spawn, child) = fake_spawner(true);
        let starts = Rc::new(std::cell::Cell::new(0));
        let recorded = starts.clone();
        let spawner: super::jsonl_rpc_connection::Spawner = Rc::new(move |options| {
            recorded.set(recorded.get() + 1);
            spawn(options)
        });
        let mut relative = options(spawner.clone());
        relative.executable_path = PathBuf::from("codex");
        assert!(
            JsonlRpcConnection::spawn(relative)
                .err()
                .unwrap()
                .message
                .contains("absolute JSONL-RPC executable")
        );
        let mut multiline = options(spawner);
        multiline.args = vec!["app-server\n--unsafe".into()];
        assert!(
            JsonlRpcConnection::spawn(multiline)
                .err()
                .unwrap()
                .message
                .contains("arguments are invalid")
        );
        assert!(child.writes.borrow().is_empty());
        assert_eq!(starts.get(), 0, "invalid launch reached the native spawner");
    });
}

#[test]
fn correlates_responses_while_tolerating_additive_unknown_fields() {
    run(async {
        let (spawner, child) = fake_spawner(true);
        let connection = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let request = {
            let connection = connection.clone();
            tokio::task::spawn_local(async move {
                connection
                    .request(
                        "account/read",
                        json!({"refreshToken": false}),
                        RequestOptions::default(),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
        let sent = child.messages();
        assert_eq!(
            (
                sent[0]["jsonrpc"].clone(),
                sent[0]["id"].clone(),
                sent[0]["method"].clone()
            ),
            (json!("2.0"), json!(1), json!("account/read"))
        );
        child
            .stdout(&format!(
                "{}\n",
                json!({"id": 1, "result": {"account": null}, "future": "ignored"})
            ))
            .await;
        assert_eq!(request.await.unwrap().unwrap(), json!({"account": null}));
        connection.dispose("done", true);
    });
}

#[test]
fn preserves_json_rpc_error_codes_for_protocol_fallback_decisions() {
    run(async {
        let (spawner, child) = fake_spawner(true);
        let connection = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let request = {
            let connection = connection.clone();
            tokio::task::spawn_local(async move {
                connection
                    .request("session/new", json!({}), RequestOptions::default())
                    .await
            })
        };
        tokio::task::yield_now().await;
        child.stdout(&format!("{}\n", json!({"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "Method not found"}}))).await;
        let error = request.await.unwrap().unwrap_err();
        assert_eq!(rpc_error_code(&error), Some(-32601));
        assert_eq!(error.extra.as_ref().unwrap()["method"], "session/new");
        connection.dispose("done", true);
    });
}

#[test]
fn separates_notifications_and_server_requests() {
    run(async {
        let (spawner, child) = fake_spawner(true);
        let connection = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let seen: Rc<RefCell<Vec<&'static str>>> = Rc::default();
        let record = seen.clone();
        connection.on(move |event| {
            record.borrow_mut().push(match event {
                ConnectionEvent::Notification(_) => "notification",
                ConnectionEvent::Request(_) => "request",
                ConnectionEvent::ProtocolError(_) => "protocolError",
                ConnectionEvent::Exit(_) => "exit",
            })
        });
        child
            .stdout(&format!(
                "{}\n",
                json!({"method": "turn/started", "params": {"extra": true}})
            ))
            .await;
        child.stdout(&format!("{}\n", json!({"method": "item/fileChange/requestApproval", "id": "approval-1", "params": {}}))).await;
        assert_eq!(*seen.borrow(), ["notification", "request"]);
        connection.dispose("done", true);
    });
}

#[test]
fn terminates_on_malformed_framing_oversized_lines_and_duplicate_response_ids() {
    run(async {
        let (spawner, malformed_child) = fake_spawner(true);
        let malformed = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let errors: Rc<RefCell<usize>> = Rc::default();
        let count = errors.clone();
        malformed.on(move |event| {
            if matches!(event, ConnectionEvent::ProtocolError(_)) {
                *count.borrow_mut() += 1;
            }
        });
        malformed_child.stdout("not-json\n").await;
        assert_eq!(*errors.borrow(), 1);
        assert_eq!(malformed_child.kills.borrow().len(), 1);

        let (spawner, oversized_child) = fake_spawner(true);
        let mut small = options(spawner);
        small.max_line_bytes = Some(32);
        let _oversized = JsonlRpcConnection::spawn(small).unwrap();
        oversized_child.stdout(&"x".repeat(40)).await;
        assert_eq!(oversized_child.kills.borrow().len(), 1);

        let (spawner, duplicate_child) = fake_spawner(true);
        let duplicate = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let pending = {
            let duplicate = duplicate.clone();
            tokio::task::spawn_local(async move {
                duplicate
                    .request("model/list", json!({}), RequestOptions::default())
                    .await
            })
        };
        tokio::task::yield_now().await;
        duplicate_child
            .stdout(&format!("{}\n", json!({"id": 1, "result": {"data": []}})))
            .await;
        pending.await.unwrap().unwrap();
        duplicate_child
            .stdout(&format!("{}\n", json!({"id": 1, "result": {"data": []}})))
            .await;
        assert_eq!(duplicate_child.kills.borrow().len(), 1);
    });
}

#[test]
fn opt_in_leading_preamble_skips_startup_banner_without_relaxing_post_handshake_framing() {
    run(async {
        let (spawner, child) = fake_spawner(true);
        let mut opts = options(spawner);
        opts.max_leading_non_json_lines = Some(3);
        let connection = JsonlRpcConnection::spawn(opts).unwrap();
        let reply = tokio::task::spawn_local({
            let connection = connection.clone();
            async move {
                connection
                    .request("initialize", json!({}), RequestOptions::default())
                    .await
            }
        });
        tokio::task::yield_now().await;
        child
            .stdout("  CodeBuddy Code HTTP Server\n  Endpoint http://127.0.0.1:0\n")
            .await;
        assert!(!connection.closed());
        child
            .stdout("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n")
            .await;
        assert_eq!(reply.await.unwrap().unwrap(), json!({ "ok": true }));
        // Once the first valid JSON-RPC message has arrived, non-JSON lines are rejected.
        child.stdout("stray banner after handshake\n").await;
        assert!(connection.closed());

        // Malformed JSON starting with `{` is never skipped, even before the first message.
        let (spawner, child) = fake_spawner(true);
        let mut opts = options(spawner);
        opts.max_leading_non_json_lines = Some(5);
        let broken_json = JsonlRpcConnection::spawn(opts).unwrap();
        child.stdout("{not-valid-json\n").await;
        assert!(broken_json.closed());

        // Exceeding the leading banner limit still fails fast.
        let (spawner, child) = fake_spawner(true);
        let mut opts = options(spawner);
        opts.max_leading_non_json_lines = Some(2);
        let too_noisy = JsonlRpcConnection::spawn(opts).unwrap();
        child.stdout("line 1\nline 2\nline 3\n").await;
        assert!(too_noisy.closed());
    });
}

#[test]
fn keeps_an_ambiguous_request_scoped_to_its_wait() {
    run_paused_local(async {
        let (spawner, child) = fake_spawner(true);
        let connection = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let exits: Rc<RefCell<usize>> = Rc::default();
        let count = exits.clone();
        connection.on(move |event| {
            if matches!(event, ConnectionEvent::Exit(_)) {
                *count.borrow_mut() += 1;
            }
        });
        let error = connection
            .request(
                "turn/start",
                json!({}),
                RequestOptions {
                    timeout_ms: Some(20),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.code.as_deref(), Some("JSONL_RPC_TIMEOUT"));
        assert_eq!(error.extra.as_ref().unwrap()["method"], "turn/start");
        assert!(child.kills.borrow().is_empty());
        assert_eq!(*exits.borrow(), 0);
        assert!(!connection.closed());
        child
            .stdout(&format!(
                "{}\n",
                json!({"id": 1, "result": {"turn": {"id": "late"}}})
            ))
            .await;
        assert!(child.kills.borrow().is_empty());
        connection.dispose("done", true);
    });
}

#[test]
fn escalates_to_a_forced_kill_when_the_provider_ignores_graceful_disposal() {
    run_paused_local(async {
        let (spawner, child) = fake_spawner(false);
        let mut forced = options(spawner);
        forced.force_kill_timeout_ms = Some(50);
        let connection = JsonlRpcConnection::spawn(forced).unwrap();
        connection.dispose("done", true);
        assert_eq!(*child.kills.borrow(), [false]);
        tokio::time::sleep(std::time::Duration::from_millis(55)).await;
        assert_eq!(*child.kills.borrow(), [false, true]);
    });
}

#[test]
fn can_report_a_timeout_without_closing_when_native_evidence_settled_the_mutation() {
    run_paused_local(async {
        let (spawner, child) = fake_spawner(true);
        let connection = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let error = connection
            .request(
                "turn/start",
                json!({}),
                RequestOptions {
                    timeout_ms: Some(20),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.code.as_deref(), Some("JSONL_RPC_TIMEOUT"));
        assert!(child.kills.borrow().is_empty());
        assert!(!connection.closed());
        child
            .stdout(&format!(
                "{}\n",
                json!({"id": 1, "result": {"turn": {"id": "late"}}})
            ))
            .await;
        assert!(child.kills.borrow().is_empty());
        connection.dispose("done", true);
    });
}

#[test]
fn an_unexpected_exit_rejects_pending_requests_and_reports_the_exit() {
    run(async {
        let (spawner, child) = fake_spawner(true);
        let connection = JsonlRpcConnection::spawn(options(spawner)).unwrap();
        let exits: Rc<RefCell<Vec<serde_json::Value>>> = Rc::default();
        let seen = exits.clone();
        connection.on(move |event| {
            if let ConnectionEvent::Exit(info) = event {
                seen.borrow_mut().push(info);
            }
        });
        let pending = {
            let connection = connection.clone();
            tokio::task::spawn_local(async move {
                connection
                    .request("thread/start", json!({}), RequestOptions::default())
                    .await
            })
        };
        tokio::task::yield_now().await;
        child.exit(Some(1), None);
        let error = pending.await.unwrap().unwrap_err();
        assert!(connection.closed());
        assert_eq!(exits.borrow().len(), 1);
        assert!(!error.message.is_empty());
    });
}

#[cfg(unix)]
#[test]
fn delivers_a_private_bootstrap_envelope_on_fd_3_only() {
    crate::agent::application::tests_support::run_local(async {
        use tokio::io::AsyncReadExt;
        let mut io = super::jsonl_rpc_connection::spawn_managed_process(&ConnectionOptions {
            executable_path: "/bin/sh".into(),
            args: vec!["-c".into(), "cat <&3; printf '|%s' \"$BOOTSTRAP\"".into()],
            cwd: std::env::temp_dir(),
            env: Some(vec![("PATH".into(), "/usr/bin:/bin".into())]),
            bootstrap: Some(br#"{"connectionId":"private"}"#.to_vec()),
            ..Default::default()
        })
        .unwrap();
        let mut output = String::new();
        io.stdout.read_to_string(&mut output).await.unwrap();
        let (code, _, _) = io.exit.await;
        assert_eq!(code, Some(0));
        assert_eq!(output, r#"{"connectionId":"private"}|"#);
    });
}

#[cfg(windows)]
mod windows_real_process_tests {
    use super::*;
    use std::path::Path;
    use tokio::io::AsyncReadExt;

    fn cmd_exe() -> PathBuf {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        Path::new(&root).join("System32").join("cmd.exe")
    }

    fn powershell_exe() -> PathBuf {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        Path::new(&root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    #[test]
    fn spawn_managed_process_keeps_native_windows_child_alive_for_stdio_roundtrip() {
        crate::agent::application::tests_support::run_local(async {
            use tokio::io::AsyncWriteExt;
            let mut io =
                super::super::jsonl_rpc_connection::spawn_managed_process(&ConnectionOptions {
                    executable_path: cmd_exe(),
                    args: vec![
                        "/d".into(),
                        "/c".into(),
                        "set /p line= & call echo %line%".into(),
                    ],
                    cwd: std::env::temp_dir(),
                    ..Default::default()
                })
                .unwrap();
            io.stdin.write_all(b"alive-on-windows\r\n").await.unwrap();
            io.stdin.flush().await.unwrap();
            let mut output = String::new();
            io.stdout.read_to_string(&mut output).await.unwrap();
            let (code, _, error) = io.exit.await;
            assert!(error.is_none(), "{error:?}");
            assert_eq!(code, Some(0));
            assert_eq!(output.trim(), "alive-on-windows");
        });
    }

    #[test]
    fn jsonl_rpc_connection_completes_real_handshake_and_disposes_on_windows() {
        crate::agent::application::tests_support::run_local(async {
            let directory = tempfile::tempdir().unwrap();
            let script = directory.path().join("mock codex.cmd");
            std::fs::write(
                &script,
                "@echo off\r\nset /p req=\r\necho {\"id\":1,\"result\":{\"server\":\"win-test\"}}\r\nset /p hold=\r\n",
            )
            .unwrap();
            let connection = JsonlRpcConnection::spawn(ConnectionOptions {
                executable_path: script,
                args: vec!["app-server".into(), "--listen".into(), "stdio://".into()],
                cwd: directory.path().to_path_buf(),
                ..Default::default()
            })
            .unwrap();
            let response = connection
                .request(
                    "initialize",
                    json!({ "clientInfo": { "name": "test" } }),
                    RequestOptions {
                        timeout_ms: Some(5_000),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
            assert_eq!(response["server"], "win-test");
            connection.dispose("test complete", true);
            let exit = connection.wait_for_exit(Some(5_000)).await.unwrap();
            assert!(exit["error"].is_null(), "{exit}");
        });
    }

    #[test]
    fn delivers_a_private_bootstrap_envelope_via_windows_handle() {
        crate::agent::application::tests_support::run_local(async {
            let mut io = super::super::jsonl_rpc_connection::spawn_managed_process(
                &ConnectionOptions {
                    executable_path: powershell_exe(),
                    args: vec![
                        "-NoProfile".into(),
                        "-Command".into(),
                        "$h = [Microsoft.Win32.SafeHandles.SafeFileHandle]::new([IntPtr][Int64]$env:PUPPYONE_BOOTSTRAP_HANDLE, $true); \
                         $fs = [System.IO.FileStream]::new($h, [System.IO.FileAccess]::Read); \
                         $sr = [System.IO.StreamReader]::new($fs); \
                         [Console]::Out.Write($sr.ReadToEnd()); \
                         $sr.Dispose()".into(),
                    ],
                    cwd: std::env::temp_dir(),
                    bootstrap: Some(br#"{"connectionId":"private"}"#.to_vec()),
                    ..Default::default()
                },
            )
            .unwrap();
            let mut output = String::new();
            io.stdout.read_to_string(&mut output).await.unwrap();
            let (code, _, error) = io.exit.await;
            assert!(error.is_none(), "{error:?}");
            assert_eq!(code, Some(0));
            assert_eq!(output, r#"{"connectionId":"private"}"#);
        });
    }
}

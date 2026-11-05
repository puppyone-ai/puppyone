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
        let (spawner, child) = fake_spawner(true);
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

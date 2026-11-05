//! `tests/unit/agent/runtimes/pi/electron.pi-rpc-client.test.mjs`,
//! `electron.pi-event-normalizer.test.mjs` and
//! `tests/integration/agent/runtimes/pi/electron.pi-prompt-input.test.mjs`.
use super::pi_event_normalizer::{PiEventState, normalize_pi_rpc_event};
use super::pi_prompt_input::build_pi_turn_input;
use super::pi_rpc_client::{PiClientEvent, PiClientOptions, PiRpcClient};
use crate::agent::application::tests_support::{run_local, run_paused_local};
use crate::agent::transports::jsonl_rpc_connection::RequestOptions;
use crate::agent::transports::test_support::fake_spawner;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;

fn options(spawner: crate::agent::transports::jsonl_rpc_connection::Spawner) -> PiClientOptions {
    PiClientOptions {
        executable_path: "/usr/local/bin/pi".into(),
        args: vec!["--no-session".into()],
        cwd: "/workspace".into(),
        env: Some(Vec::new()),
        spawner: Some(spawner),
        force_kill_timeout_ms: Some(0),
        ..Default::default()
    }
}

#[test]
fn launches_the_official_jsonl_mode_and_correlates_command_responses_without_json_rpc_fields() {
    run_local(async {
        let launched: Rc<RefCell<Vec<Vec<String>>>> = Rc::default();
        let (spawner, child) = fake_spawner(true);
        let recorded = launched.clone();
        let spawning: crate::agent::transports::jsonl_rpc_connection::Spawner =
            Rc::new(move |options| {
                recorded.borrow_mut().push(options.args.clone());
                spawner(options)
            });
        let client = PiRpcClient::spawn(options(spawning)).unwrap();
        assert_eq!(
            launched.borrow()[0],
            ["--mode", "rpc", "--no-approve", "--no-session"]
        );
        let pending = {
            let client = client.clone();
            tokio::task::spawn_local(async move {
                client
                    .request_now("get_state", json!({}), RequestOptions::default())
                    .await
            })
        };
        child.stdout("").await;
        let command = child.messages()[0].clone();
        assert_eq!(command, json!({ "id": "puppyone-1", "type": "get_state" }));
        assert!(command.get("jsonrpc").is_none());
        child
            .stdout(&format!(
                "{}\n",
                json!({ "type": "response", "id": "puppyone-1", "command": "get_state", "success": true, "data": { "sessionId": "pi-session" } })
            ))
            .await;
        assert_eq!(
            pending.await.unwrap().unwrap(),
            json!({ "sessionId": "pi-session" })
        );
        client.dispose_with("done", true);
    });
}

#[test]
fn keeps_asynchronous_pi_events_separate_from_command_responses() {
    run_local(async {
        let (spawner, child) = fake_spawner(true);
        let client = PiRpcClient::spawn(options(spawner)).unwrap();
        let events: Rc<RefCell<Vec<Value>>> = Rc::default();
        let sink = events.clone();
        crate::agent::protocols::pi_rpc::pi_rpc_client::PiClient::on(
            &client,
            Rc::new(move |event| {
                if let PiClientEvent::Event(message) = event {
                    sink.borrow_mut().push(message);
                }
            }),
        );
        child
            .stdout(&format!(
                "{}\n",
                json!({ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "Hi" } })
            ))
            .await;
        assert_eq!(events.borrow()[0]["type"], "message_update");
        client.dispose_with("done", true);
    });
}

#[test]
fn preserves_native_failures_and_retires_malformed_oversized_and_mismatched_streams() {
    run_local(async {
        let (spawner, child) = fake_spawner(true);
        let client = PiRpcClient::spawn(options(spawner)).unwrap();
        let rejected = {
            let client = client.clone();
            tokio::task::spawn_local(async move {
                client
                    .request_now(
                        "set_model",
                        json!({ "provider": "openai", "modelId": "missing" }),
                        RequestOptions::default(),
                    )
                    .await
            })
        };
        child.stdout("").await;
        child
            .stdout(&format!(
                "{}\n",
                json!({ "type": "response", "id": "puppyone-1", "command": "set_model", "success": false, "error": "model unavailable" })
            ))
            .await;
        let error = rejected.await.unwrap().unwrap_err();
        assert_eq!(error.name.as_deref(), Some("PiRpcErrorResponse"));
        assert_eq!(error.extra.as_ref().unwrap()["command"], "set_model");
        client.dispose_with("done", true);

        let (spawner, malformed) = fake_spawner(true);
        let _malformed_client = PiRpcClient::spawn(options(spawner)).unwrap();
        malformed.stdout("not-json\n").await;
        assert_eq!(*malformed.kills.borrow(), [false]);

        let (spawner, oversized) = fake_spawner(true);
        let mut small = options(spawner);
        small.max_line_bytes = Some(32);
        let _oversized_client = PiRpcClient::spawn(small).unwrap();
        oversized.stdout(&"x".repeat(40)).await;
        assert_eq!(*oversized.kills.borrow(), [false]);

        let (spawner, mismatch) = fake_spawner(true);
        let mismatch_client = PiRpcClient::spawn(options(spawner)).unwrap();
        let pending = {
            let client = mismatch_client.clone();
            tokio::task::spawn_local(async move {
                client
                    .request_now("get_state", json!({}), RequestOptions::default())
                    .await
            })
        };
        mismatch.stdout("").await;
        mismatch
            .stdout(&format!(
                "{}\n",
                json!({ "type": "response", "id": "puppyone-1", "command": "get_messages", "success": true, "data": {} })
            ))
            .await;
        assert!(
            pending
                .await
                .unwrap()
                .unwrap_err()
                .message
                .to_lowercase()
                .contains("did not match")
        );
        assert_eq!(*mismatch.kills.borrow(), [false]);
    });
}

#[test]
fn keeps_the_process_alive_after_an_ambiguous_request_timeout() {
    run_paused_local(async {
        let (spawner, child) = fake_spawner(true);
        let client = PiRpcClient::spawn(options(spawner)).unwrap();
        let error = client
            .request_now(
                "prompt",
                json!({ "message": "hello" }),
                RequestOptions {
                    timeout_ms: Some(20),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.code.as_deref(), Some("PI_RPC_TIMEOUT"));
        assert_eq!(error.extra.as_ref().unwrap()["command"], "prompt");
        assert!(child.kills.borrow().is_empty());
        client.dispose_with("done", true);
    });
}

// ----------------------------------------------------------- event normalizer

fn failed(message: &str) -> Value {
    json!({ "role": "assistant", "content": [], "stopReason": "error", "errorMessage": message })
}

fn answer() -> Value {
    json!({ "role": "assistant", "content": [{ "type": "text", "text": "Recovered" }], "stopReason": "stop" })
}

fn settle(messages: Vec<Value>, interrupt_requested: bool) -> Vec<Value> {
    let mut state = PiEventState::new(Some("turn"), Some("session"), "pi", "Pi");
    state.interrupt_requested = interrupt_requested;
    let events: Vec<Value> = messages
        .iter()
        .flat_map(|m| normalize_pi_rpc_event(m, &mut state))
        .collect();
    assert!(!events.iter().any(|e| matches!(
        e["type"].as_str(),
        Some("turn.completed" | "turn.failed" | "turn.interrupted")
    )));
    let terminal = normalize_pi_rpc_event(&json!({ "type": "agent_settled" }), &mut state);
    assert!(normalize_pi_rpc_event(&json!({ "type": "agent_settled" }), &mut state).is_empty());
    terminal
}

fn has_failure(events: &[Value], message: Option<&str>) -> bool {
    events.iter().any(|e| {
        e["type"] == "turn.failed"
            && message.is_none_or(|m| e["payload"] == json!({ "status": "failed", "message": m }))
    })
}

#[test]
fn uses_the_final_agent_end_outcome_when_a_failed_attempt_later_succeeds() {
    let terminal = settle(
        vec![
            json!({ "type": "agent_end", "messages": [failed("fetch failed")], "willRetry": true }),
            json!({ "type": "auto_retry_start", "attempt": 1, "maxAttempts": 3 }),
            json!({ "type": "auto_retry_end", "success": true }),
            json!({ "type": "agent_end", "messages": [answer()], "willRetry": false }),
        ],
        false,
    );
    assert_eq!(terminal.len(), 1);
    assert_eq!(terminal[0]["type"], "turn.completed");
}

#[test]
fn reports_exhausted_retries_and_their_final_error() {
    let terminal = settle(
        vec![
            json!({ "type": "message_end", "message": failed("fetch failed") }),
            json!({ "type": "auto_retry_end", "success": false, "finalError": "Retries exhausted" }),
        ],
        false,
    );
    assert!(has_failure(&terminal, Some("Retries exhausted")));
}

#[test]
fn retains_a_later_failure_after_an_earlier_model_request_recovered() {
    let terminal = settle(
        vec![
            json!({ "type": "message_end", "message": failed("fetch failed") }),
            json!({ "type": "message_end", "message": answer() }),
            json!({ "type": "auto_retry_end", "success": true }),
            json!({ "type": "tool_execution_start", "toolCallId": "tool", "toolName": "read", "args": { "path": "README.md" } }),
            json!({ "type": "tool_execution_end", "toolCallId": "tool", "isError": false }),
            json!({ "type": "message_end", "message": failed("Final request failed") }),
            json!({ "type": "agent_end", "messages": [answer(), failed("Final request failed")] }),
        ],
        false,
    );
    assert!(has_failure(&terminal, Some("Final request failed")));
}

#[test]
fn does_not_treat_retry_success_as_proof_that_an_aborted_assistant_succeeded() {
    let terminal = settle(
        vec![
            json!({ "type": "message_end", "message": { "role": "assistant", "content": [], "stopReason": "aborted" } }),
            json!({ "type": "auto_retry_end", "success": true }),
        ],
        false,
    );
    assert!(has_failure(&terminal, None));
}

#[test]
fn does_not_erase_a_separate_compaction_failure_when_the_model_retry_succeeds() {
    let terminal = settle(
        vec![
            json!({ "type": "compaction_end", "errorMessage": "Compaction failed" }),
            json!({ "type": "message_end", "message": answer() }),
            json!({ "type": "auto_retry_end", "success": true }),
            json!({ "type": "agent_end", "messages": [answer()] }),
        ],
        false,
    );
    assert!(has_failure(&terminal, Some("Compaction failed")));
}

#[test]
fn keeps_an_explicit_interrupt_authoritative_while_retry_is_cancelled() {
    let terminal = settle(
        vec![
            json!({ "type": "auto_retry_end", "success": false, "finalError": "Retry cancelled" }),
        ],
        true,
    );
    assert_eq!(terminal.len(), 1);
    assert_eq!(terminal[0]["type"], "turn.interrupted");
}

// --------------------------------------------------------------- prompt input

fn temporary(prefix: &str) -> (tempfile::TempDir, String) {
    let directory = tempfile::Builder::new().prefix(prefix).tempdir().unwrap();
    let path = std::fs::canonicalize(directory.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();
    (directory, path)
}

#[test]
fn keeps_non_image_files_as_authorized_native_path_mentions_and_sends_images_on_pis_media_channel()
{
    let (_workspace_guard, workspace) = temporary("pi-workspace-");
    let (_staged_guard, staged) = temporary("pi-staged-");
    std::fs::create_dir(format!("{workspace}/notes")).unwrap();
    std::fs::write(format!("{workspace}/notes/brief.md"), "brief").unwrap();
    let image = format!("{staged}/screen.png");
    std::fs::write(&image, [0x89u8, 0x50, 0x4e, 0x47]).unwrap();
    let input = build_pi_turn_input(
        "Review both",
        &[
            json!({ "kind": "workspace-entry", "path": "notes/brief.md", "displayName": "brief.md" }),
            json!({ "kind": "staged-attachment", "path": image, "mime": "image/png", "displayName": "screen.png" }),
        ],
        Some(&workspace),
        None,
    )
    .unwrap();
    assert!(input.message.contains("Review both"));
    assert!(
        input
            .message
            .contains(&format!("{workspace}/notes/brief.md"))
    );
    assert_eq!(
        input.images,
        [json!({ "type": "image", "data": "iVBORw==", "mimeType": "image/png" })]
    );
}

#[test]
fn accepts_an_authorized_external_file_only_when_it_is_an_inline_native_path_mention() {
    let (_workspace_guard, workspace) = temporary("pi-workspace-");
    let (_external_guard, external) = temporary("pi-external-");
    let filename = format!("{external}/outside.txt");
    std::fs::write(&filename, "outside").unwrap();
    let input = build_pi_turn_input(
        &format!("Read {filename}"),
        &[json!({ "kind": "staged-attachment", "path": filename, "mime": "text/plain", "inlineMentioned": true, "mentionDelivery": "path" })],
        Some(&workspace),
        None,
    )
    .unwrap();
    assert!(input.message.contains(&filename));
    let error = build_pi_turn_input(
        "Read it",
        &[json!({ "kind": "staged-attachment", "path": filename, "mime": "text/plain" })],
        Some(&workspace),
        None,
    )
    .unwrap_err();
    assert_eq!(error.code.as_deref(), Some("REFERENCE_KIND_UNSUPPORTED"));
}

#[test]
fn rejects_a_forged_workspace_relative_traversal_before_it_reaches_pi() {
    let (_workspace_guard, workspace) = temporary("pi-workspace-");
    let error = build_pi_turn_input(
        "Read it",
        &[json!({ "kind": "workspace-entry", "path": "../secret.txt", "mime": "text/plain" })],
        Some(&workspace),
        None,
    )
    .unwrap_err();
    assert_eq!(error.code.as_deref(), Some("REFERENCE_UNAUTHORIZED"));
}

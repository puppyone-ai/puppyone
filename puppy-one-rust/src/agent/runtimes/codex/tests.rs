//! `tests/unit/agent/runtimes/codex/electron.codex-agent-adapter.test.mjs`
//! and `electron.codex-history-reader.test.mjs`.
use super::codex_app_server_adapter::{
    CODEX_CAPABILITIES, CodexAdapterOptions, CodexAppServerAdapter,
};
use super::codex_events::normalize_codex_notification;
use super::codex_history_reader::{
    CodexRequest, limits, read_codex_history, read_codex_paginated_history,
    request_codex_metadata_only_thread,
};
use super::codex_reference_input::build_codex_turn_input;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::tests_support::run_local;
use crate::agent::runtime::agent_runtime_port::{
    AgentRuntimeAdapter, is_agent_provider_session_unavailable_error,
};
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionEvent, jsonl_rpc_request_timeout_error,
};
use crate::agent::transports::rpc_connection::fake::FakeConnection;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;

fn adapter(connection: &Rc<FakeConnection>) -> CodexAppServerAdapter {
    adapter_with_events(connection, Rc::new(|_| {}))
}

fn adapter_with_events(
    connection: &Rc<FakeConnection>,
    on_event: Rc<dyn Fn(Value)>,
) -> CodexAppServerAdapter {
    CodexAppServerAdapter::new(CodexAdapterOptions {
        executable_path: "/usr/local/bin/codex".into(),
        environment: Some(json!({})),
        workspace_root: "/workspace".into(),
        app_version: "test".into(),
        spawner: None,
        connection_factory: Some(connection.factory()),
        on_event,
        on_exit: Rc::new(|_| {}),
        on_session_persisted: None,
    })
}

type Events = Rc<RefCell<Vec<Value>>>;

fn recorder() -> (Events, Rc<dyn Fn(Value)>) {
    let events: Events = Rc::default();
    let sink = events.clone();
    (events, Rc::new(move |event| sink.borrow_mut().push(event)))
}

fn notification(message: Value) -> ConnectionEvent {
    ConnectionEvent::Notification(message)
}

fn request(message: Value) -> ConnectionEvent {
    ConnectionEvent::Request(message)
}

#[test]
fn discovers_workspace_threads_from_the_native_state_index_without_scanning_rollout_transcripts() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result(
            "thread/list",
            json!({
                "data": [{
                    "id": "thread-native",
                    "cwd": "/workspace",
                    "name": "Fix history",
                    "preview": "Fix history",
                    "createdAt": 1_788_000_000,
                    "updatedAt": 1_788_000_100,
                    "modelProvider": "openai",
                    "ephemeral": false,
                }],
                "nextCursor": "next-page",
            }),
        );
        let adapter = adapter(&connection);
        let page = adapter
            .discover_sessions(Some("page-1".into()), Some(json!(25)), None)
            .await
            .unwrap();
        assert_eq!(page["supported"], true);
        assert_eq!(
            page["coverage"],
            json!({ "scopeComplete": false, "snapshotId": null })
        );
        assert_eq!(page["nextCursor"], "next-page");
        assert_eq!(page["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(page["sessions"][0]["providerSessionId"], "thread-native");
        assert_eq!(page["sessions"][0]["title"], "Fix history");
        let params = &connection.requests_of("thread/list")[0];
        for (key, value) in [
            ("cwd", json!("/workspace")),
            ("cursor", json!("page-1")),
            ("limit", json!(25)),
            ("sortKey", json!("updated_at")),
            ("sortDirection", json!("desc")),
            ("useStateDbOnly", json!(true)),
        ] {
            assert_eq!(params[key], value, "{key}");
        }
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn renders_ordinary_workspace_references_as_text_and_sends_only_native_images_as_media_input() {
    let input = build_codex_turn_input(
        "Inspect",
        &[
            json!({ "id": "workspace-a", "kind": "workspace-entry", "entryType": "file", "path": "/workspace/a.md", "displayName": "a.md" }),
            json!({ "id": "workspace-image", "kind": "workspace-entry", "entryType": "file", "path": "/workspace/diagram.png", "displayName": "diagram.png", "mime": "image/png" }),
            json!({ "id": "image-b", "kind": "staged-attachment", "path": "/private/staging/b.snapshot", "displayName": "b.png", "mime": "image/png" }),
            json!({ "id": "workspace-pdf", "kind": "workspace-entry", "entryType": "file", "path": "/workspace/report.pdf", "displayName": "report.pdf", "mime": "application/pdf" }),
            json!({ "id": "workspace-a-duplicate", "kind": "workspace-entry", "entryType": "file", "path": "/workspace/a.md", "displayName": "a.md" }),
        ],
        Some("/workspace"),
    )
    .unwrap();
    assert_eq!(
        input,
        vec![
            json!({
                "type": "text",
                "text": "Inspect\n\nAuthorized context files for this turn:\n- /workspace/a.md\n- /workspace/report.pdf",
                "text_elements": [],
            }),
            json!({ "type": "localImage", "path": "/workspace/diagram.png" }),
            json!({ "type": "localImage", "path": "/private/staging/b.snapshot" }),
        ]
    );
    assert!(
        !serde_json::to_string(&input)
            .unwrap()
            .contains(r#""type":"mention""#)
    );
    assert_eq!(
        build_codex_turn_input(
            "Review `/private/staging/report.pdf`",
            &[json!({
                "authorized": true,
                "kind": "staged-attachment",
                "path": "/private/staging/report.pdf",
                "displayName": "report.pdf",
                "mime": "application/pdf",
                "inlineMentioned": true,
                "mentionDelivery": "path",
            })],
            Some("/workspace"),
        )
        .unwrap(),
        vec![
            json!({ "type": "text", "text": "Review `/private/staging/report.pdf`", "text_elements": [] })
        ]
    );
    assert_eq!(
        build_codex_turn_input(
            "Review `/workspace/a.md`",
            &[json!({
                "authorized": true,
                "kind": "workspace-entry",
                "entryType": "file",
                "path": "/workspace/a.md",
                "displayName": "a.md",
                "mime": "text/markdown",
                "inlineMentioned": true,
                "mentionDelivery": "path",
            })],
            Some("/workspace"),
        )
        .unwrap(),
        vec![json!({ "type": "text", "text": "Review `/workspace/a.md`", "text_elements": [] })]
    );
    let failure = |references: Value, root: Option<&str>| {
        build_codex_turn_input("Inspect", references.as_array().unwrap(), root)
            .unwrap_err()
            .message
            .to_lowercase()
    };
    assert!(
        failure(
            json!([{ "kind": "staged-attachment", "path": "/private/staging/report.pdf", "mime": "application/pdf" }]),
            Some("/workspace")
        )
        .contains("does not support")
    );
    assert!(
        failure(
            json!([{ "kind": "workspace-entry", "path": "/workspace/a.md" }]),
            None
        )
        .contains("workspace root")
    );
    let outside = failure(
        json!([{ "kind": "workspace-entry", "path": "/outside/a.md", "mime": "image/png" }]),
        Some("/workspace"),
    );
    assert!(outside.contains("outside") && outside.contains("workspace root"));
    assert!(failure(json!([{ "kind": "workspace-entry" }]), None).contains("invalid reference"));
}

#[test]
fn delivers_the_minimal_reference_contract_in_the_native_turn_start_request() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result(
            "thread/start",
            json!({ "thread": { "id": "thread-1", "preview": "Session", "createdAt": 1, "updatedAt": 1 } }),
        );
        connection.result("turn/start", json!({ "turn": { "id": "turn-1" } }));
        let adapter = adapter(&connection);
        adapter.create_session(json!({})).await.unwrap();
        adapter
            .start_turn(json!({
                "prompt": "Review these",
                "references": [
                    { "kind": "workspace-entry", "entryType": "file", "path": "/workspace/notes.md", "mime": "text/markdown" },
                    { "kind": "workspace-entry", "entryType": "directory", "path": "/workspace/src" },
                    { "kind": "staged-attachment", "path": "/private/staging/screenshot.webp", "mime": "image/webp" },
                ],
            }))
            .await
            .unwrap();
        assert_eq!(
            connection.requests_of("turn/start")[0]["input"],
            json!([
                {
                    "type": "text",
                    "text": "Review these\n\nAuthorized context files for this turn:\n- /workspace/notes.md\n- /workspace/src",
                    "text_elements": [],
                },
                { "type": "localImage", "path": "/private/staging/screenshot.webp" },
            ])
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn keeps_the_tested_codex_0_144_1_generated_schema_fixture_compatible() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../fixtures/agent/runtimes/codex/v0.144.1-notifications.json"
    ))
    .unwrap();
    assert_eq!(fixture["codexVersion"], "0.144.1");
    for notification in fixture["notifications"].as_array().unwrap() {
        let types: Vec<Value> = normalize_codex_notification(notification)
            .iter()
            .map(|event| event["type"].clone())
            .collect();
        assert!(
            types.contains(&notification["expectedType"]),
            "{notification}"
        );
    }
}

/// `expect(actual).toMatchObject(expected)`.
fn assert_match(actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Object(actual_map), Value::Object(expected_map)) => {
            for (key, value) in expected_map {
                assert_match(actual_map.get(key).unwrap_or(&Value::Null), value);
            }
        }
        (Value::Array(actual_items), Value::Array(expected_items)) => {
            assert_eq!(
                actual_items.len(),
                expected_items.len(),
                "{actual} vs {expected}"
            );
            for (actual, expected) in actual_items.iter().zip(expected_items) {
                assert_match(actual, expected);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}

#[test]
fn maps_current_generated_schema_notifications_to_provider_neutral_events() {
    let first = |message: Value| normalize_codex_notification(&message)[0].clone();
    assert_match(
        &first(json!({
            "method": "thread/started",
            "params": { "thread": { "id": "thread-1", "preview": "Fix tests", "createdAt": 1, "updatedAt": 2 } },
        })),
        &json!({ "type": "session.started", "providerSessionId": "thread-1", "payload": { "title": "Fix tests" } }),
    );
    let delta = normalize_codex_notification(&json!({
        "method": "item/agentMessage/delta",
        "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1", "delta": "hello" },
    }));
    assert_eq!(delta.len(), 1);
    assert_match(
        &delta[0],
        &json!({
            "type": "assistant.delta",
            "providerSessionId": "thread-1",
            "turnId": "turn-1",
            "itemId": "item-1",
            "payload": { "delta": "hello" },
        }),
    );
    assert_eq!(delta[0]["payload"], json!({ "delta": "hello" }));
    let user = normalize_codex_notification(&json!({
        "method": "item/completed",
        "params": {
            "threadId": "thread-1",
            "turnId": "turn-1",
            "item": { "id": "user-1", "type": "userMessage", "content": [{ "type": "text", "text": "follow up" }] },
        },
    }));
    assert_eq!(user.len(), 1);
    assert_eq!(user[0]["type"], "user.message");
    assert_eq!(user[0]["itemId"], "user-1");
    assert_eq!(user[0]["payload"], json!({ "text": "follow up" }));
    let boundary = normalize_codex_notification(&json!({
        "method": "item/reasoning/summaryPartAdded",
        "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "reasoning-1", "summaryIndex": 1 },
    }));
    assert_eq!(
        boundary[0]["payload"],
        json!({ "delta": "", "summaryIndex": 1, "boundary": true })
    );
    assert_match(
        &first(json!({
            "method": "turn/completed",
            "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "interrupted" } },
        })),
        &json!({ "type": "turn.interrupted", "payload": { "status": "interrupted" } }),
    );
    assert!(
        normalize_codex_notification(&json!({
            "method": "thread/status/changed",
            "params": { "threadId": "thread-1", "status": { "type": "systemError" } },
        }))
        .is_empty()
    );
    let failed = normalize_codex_notification(&json!({
        "method": "turn/completed",
        "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "failed", "error": { "message": "Actionable failure" } } },
    }));
    assert_eq!(failed.len(), 2);
    assert_eq!(failed[0]["type"], "turn.failed");
    assert_eq!(failed[0]["payload"]["message"], "Actionable failure");
    assert_eq!(failed[1]["type"], "provider.error");
    assert_eq!(
        failed[1]["payload"],
        json!({ "message": "Actionable failure", "recoverable": true })
    );
    assert_match(
        &first(json!({
            "method": "item/fileChange/patchUpdated",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "file-1",
                "changes": [{ "path": "src/App.tsx", "kind": "update", "diff": "+one\n-two\n" }],
            },
        })),
        &json!({
            "type": "file.change.updated",
            "payload": { "changes": [{ "path": "src/App.tsx", "kind": "update", "additions": 1, "deletions": 1 }] },
        }),
    );
    assert_match(
        &first(json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": { "id": "command-1", "type": "commandExecution", "command": "rg -n needle src", "cwd": "/workspace", "status": "inProgress" },
            },
        })),
        &json!({
            "type": "tool.started",
            "payload": { "kind": "command", "tool": "bash", "input": { "command": "rg -n needle src", "cwd": "/workspace" } },
        }),
    );
    assert_match(
        &first(json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": { "id": "change-1", "type": "fileChange", "changes": [{ "path": "src/App.tsx", "kind": "update", "diff": "+one\n-two" }], "status": "inProgress" },
            },
        })),
        &json!({ "type": "tool.started", "payload": { "kind": "file-change", "tool": "edit", "path": "src/App.tsx" } }),
    );
    assert_match(
        &first(json!({
            "method": "configWarning",
            "params": { "summary": "Invalid config", "details": "Unknown key", "path": "/workspace/.codex/config.toml" },
        })),
        &json!({
            "type": "provider.warning",
            "payload": { "message": "Invalid config Unknown key (/workspace/.codex/config.toml)" },
        }),
    );
    assert_match(
        &first(json!({
            "method": "error",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "error": { "message": "Reconnecting… 2/5" },
                "willRetry": true,
                "attempt": 2,
                "maxAttempts": 5,
            },
        })),
        &json!({
            "type": "provider.connection.updated",
            "payload": { "state": "reconnecting", "message": "Reconnecting… 2/5", "attempt": 2, "maxAttempts": 5 },
        }),
    );
    assert_match(
        &first(json!({
            "method": "warning",
            "params": { "threadId": "thread-1", "turnId": "turn-1", "message": "Falling back to HTTPS transport." },
        })),
        &json!({
            "type": "provider.connection.updated",
            "payload": { "state": "fallback", "message": "Falling back to HTTPS transport." },
        }),
    );
    assert!(
        normalize_codex_notification(&json!({
            "method": "deprecationNotice",
            "params": { "message": "Full-history hydration is deprecated for paginated threads." },
        }))
        .is_empty()
    );
    let nested = json!({
        "type": "error",
        "error": { "message": "Invalid value: 'max'. Use 'xhigh'.", "param": "reasoning.effort" },
        "status": 400,
    });
    assert_match(
        &first(json!({
            "method": "error",
            "params": { "error": { "message": nested.to_string() }, "willRetry": false },
        })),
        &json!({ "type": "provider.error", "payload": { "message": "Invalid value: 'max'. Use 'xhigh'." } }),
    );
}

#[test]
fn normalizes_legacy_reasoning_effort_and_reuses_one_thread_across_follow_up_turns() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result(
            "account/read",
            json!({ "account": { "type": "chatgpt" }, "requiresOpenaiAuth": false }),
        );
        let efforts: Vec<Value> = ["low", "max", "unsupported", "xhigh"]
            .iter()
            .map(|effort| json!({ "reasoningEffort": effort, "description": effort }))
            .collect();
        connection.result(
            "model/list",
            json!({
                "data": [{
                    "id": "gpt-5.5",
                    "model": "gpt-5.5",
                    "displayName": "GPT-5.5",
                    "defaultReasoningEffort": "max",
                    "supportedReasoningEfforts": efforts,
                }],
            }),
        );
        connection.result(
            "thread/start",
            json!({ "thread": { "id": "thread-1", "preview": "Session", "createdAt": 1, "updatedAt": 1 } }),
        );
        connection.result("turn/start", json!({ "turn": { "id": "turn-1" } }));
        let adapter = adapter(&connection);
        let inspection = adapter.inspect().await.unwrap();
        assert_match(
            &inspection["runtime"],
            &json!({ "id": "codex", "displayName": "Codex", "iconKey": "codex" }),
        );
        assert_match(
            &inspection["models"][0],
            &json!({ "model": "gpt-5.5", "variants": ["low", "xhigh"], "defaultVariant": "xhigh" }),
        );
        adapter
            .create_session(json!({ "model": "gpt-5.5" }))
            .await
            .unwrap();
        adapter
            .start_turn(json!({ "prompt": "hello", "model": "gpt-5.5", "effort": "low" }))
            .await
            .unwrap();
        adapter
            .start_turn(json!({ "prompt": "follow up", "model": "gpt-5.5", "effort": "xhigh" }))
            .await
            .unwrap();
        let starts = connection.requests_of("turn/start");
        assert_match(
            &json!([starts[0], starts[1]]),
            &json!([
                { "threadId": "thread-1", "model": "gpt-5.5", "effort": "low" },
                { "threadId": "thread-1", "model": "gpt-5.5", "effort": "xhigh" },
            ]),
        );
        assert_eq!(connection.requests_of("initialize").len(), 1);
        assert_eq!(connection.requests_of("thread/start").len(), 1);
        assert_eq!(connection.requests_of("thread/resume").len(), 0);
        assert_eq!(connection.requests_of("turn/start").len(), 2);
        assert!(
            !json!(*connection.requests.borrow())
                .to_string()
                .contains(r#""effort":"max""#)
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn preserves_native_user_identity_when_turn_delivery_is_ambiguous() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("thread/start", json!({ "thread": { "id": "thread-1" } }));
        connection.failure("turn/start", jsonl_rpc_request_timeout_error("turn/start"));
        let adapter = adapter(&connection);
        adapter
            .create_session(json!({ "model": "gpt-5" }))
            .await
            .unwrap();
        let failure = adapter
            .start_turn(json!({ "prompt": "hello", "model": "gpt-5" }))
            .await
            .unwrap_err();
        assert_eq!(failure.code.as_deref(), Some("JSONL_RPC_TIMEOUT"));
        assert_eq!(failure.delivery_outcome.as_deref(), Some("unknown"));
        let id = failure.client_user_message_id.clone().unwrap();
        assert!(id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
        assert!(!connection.closed.get());
        assert!(
            adapter
                .start_turn(json!({ "prompt": "do not resend" }))
                .await
                .unwrap_err()
                .message
                .contains("already starting")
        );
        connection.emit(notification(json!({
            "method": "turn/started",
            "params": { "threadId": "thread-1", "turn": { "id": "late-turn", "status": "inProgress" } },
        })));
        assert_eq!(adapter.active_turn_id().as_deref(), Some("late-turn"));
        assert!(!adapter.has_pending_turn_start());
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn accepts_a_correlated_native_start_before_a_delayed_turn_start_rpc_receipt() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("thread/start", json!({ "thread": { "id": "thread-1" } }));
        connection.pending("turn/start");
        let adapter = adapter(&connection);
        adapter
            .create_session(json!({ "model": "gpt-5" }))
            .await
            .unwrap();
        let start = {
            let adapter = adapter.clone();
            tokio::task::spawn_local(async move {
                adapter
                    .start_turn(json!({ "prompt": "hello", "clientUserMessageId": "message-1", "model": "gpt-5" }))
                    .await
            })
        };
        tokio::task::yield_now().await;
        connection.emit(notification(json!({
            "method": "turn/started",
            "params": { "threadId": "thread-1", "turn": { "id": "turn-native", "status": "inProgress" } },
        })));
        assert_eq!(
            start.await.unwrap().unwrap(),
            json!({ "turnId": "turn-native", "clientUserMessageId": "message-1" })
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn classifies_a_missing_native_rollout_as_an_unavailable_saved_session() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.failure(
            "thread/resume",
            AgentError::new("thread/resume: no rollout found for thread id thread-stale"),
        );
        let adapter = adapter(&connection);
        let error = adapter
            .resume_session(json!({ "threadId": "thread-stale", "model": "gpt-5" }))
            .await
            .unwrap_err();
        assert!(is_agent_provider_session_unavailable_error(&error));
        adapter.dispose().await.unwrap();
    });
}

fn by_cursor(
    first: Value,
    rest: Value,
) -> impl Fn(&Value) -> LocalBoxFuture<'static, AgentResult<Value>> {
    move |params: &Value| {
        let page = if params["cursor"].is_null() {
            first.clone()
        } else {
            rest.clone()
        };
        Box::pin(async move { Ok(page) })
    }
}

#[test]
fn resumes_metadata_only_and_restores_paginated_turns_and_items_in_transcript_order() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result(
            "thread/resume",
            json!({ "thread": { "id": "thread-history", "preview": "Saved session", "createdAt": 1, "updatedAt": 4 } }),
        );
        connection.answer(
            "thread/turns/list",
            by_cursor(
                json!({
                    "data": [{ "id": "turn-new", "items": [], "itemsView": "summary", "status": "completed" }],
                    "nextCursor": "older-turns",
                }),
                json!({
                    "data": [{
                        "id": "turn-old",
                        "itemsView": "full",
                        "status": "completed",
                        "items": [
                            { "id": "old-user", "type": "userMessage", "content": [{ "type": "text", "text": "old prompt" }] },
                            { "id": "old-answer", "type": "agentMessage", "text": "old answer" },
                        ],
                    }],
                    "nextCursor": null,
                }),
            ),
        );
        connection.answer(
            "thread/items/list",
            by_cursor(
                json!({
                    "data": [{ "turnId": "turn-new", "item": { "id": "new-answer", "type": "agentMessage", "text": "new answer" } }],
                    "nextCursor": "older-items",
                }),
                json!({
                    "data": [{
                        "turnId": "turn-new",
                        "item": { "id": "new-user", "type": "userMessage", "content": [{ "type": "text", "text": "new prompt" }] },
                    }],
                    "nextCursor": null,
                }),
            ),
        );
        let adapter = adapter(&connection);
        adapter
            .resume_session(json!({ "threadId": "thread-history", "model": "gpt-5" }))
            .await
            .unwrap();
        let events = adapter.read_history().await.unwrap();
        let resume = &connection.requests_of("thread/resume")[0];
        assert_eq!(resume["threadId"], "thread-history");
        assert_eq!(resume["excludeTurns"], true);
        assert_eq!(connection.requests_of("thread/turns/list").len(), 2);
        assert_eq!(connection.requests_of("thread/items/list").len(), 2);
        assert!(connection.requests_of("thread/read").is_empty());
        let of =
            |kind: &str| -> Vec<&Value> { events.iter().filter(|e| e["type"] == kind).collect() };
        assert_eq!(
            of("turn.started")
                .iter()
                .map(|e| e["payload"]["prompt"].clone())
                .collect::<Vec<_>>(),
            [json!("old prompt"), json!("new prompt")]
        );
        assert_eq!(
            of("user.message")
                .iter()
                .map(|e| json!([e["itemId"], e["payload"]["text"]]))
                .collect::<Vec<_>>(),
            [
                json!(["old-user", "old prompt"]),
                json!(["new-user", "new prompt"])
            ]
        );
        assert!(of("provider.warning").is_empty());
        assert_eq!(
            of("assistant.completed")
                .iter()
                .map(|e| e["payload"]["text"].clone())
                .collect::<Vec<_>>(),
            [json!("old answer"), json!("new answer")]
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn offers_only_explicit_durable_decisions_and_maps_native_structured_questions() {
    run_local(async {
        let connection = FakeConnection::new();
        let (events, sink) = recorder();
        let adapter = adapter_with_events(&connection, sink);
        adapter.connect().await.unwrap();
        adapter.set_thread_id(Some("thread-1"));
        let last = || events.borrow().last().cloned().unwrap();
        connection.emit(request(json!({
            "method": "item/commandExecution/requestApproval",
            "id": 7,
            "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1", "command": "npm test", "startedAtMs": 1 },
        })));
        let approval = events
            .borrow()
            .iter()
            .find(|e| e["type"] == "approval.requested")
            .cloned()
            .unwrap();
        assert_eq!(
            approval["payload"]["availableDecisions"],
            json!(["accept", "decline", "cancel"])
        );
        adapter
            .resolve_approval_now(&json!({ "requestId": "codex:7", "decision": "accept", "threadId": "thread-1", "turnId": "turn-1" }))
            .unwrap();
        assert_eq!(
            connection.responses.borrow().last().unwrap(),
            &json!({ "id": 7, "result": { "decision": "accept" } })
        );
        connection.emit(request(json!({
            "method": "item/commandExecution/requestApproval",
            "id": 8,
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-network",
                "networkApprovalContext": { "host": "registry.npmjs.org:443", "protocol": "https" },
                "reason": "Download package metadata",
                "startedAtMs": 1,
            },
        })));
        assert_match(
            &last(),
            &json!({
                "type": "approval.requested",
                "payload": {
                    "title": "Allow network access",
                    "networkApprovalContext": { "host": "registry.npmjs.org:443", "protocol": "https" },
                },
            }),
        );
        connection.emit(notification(json!({
            "method": "serverRequest/resolved",
            "params": { "threadId": "thread-1", "requestId": 8 },
        })));
        assert_match(
            &last(),
            &json!({
                "type": "approval.resolved",
                "payload": { "requestId": "codex:8", "decision": "cancel", "reason": "provider-resolved" },
            }),
        );
        assert!(
            adapter
                .resolve_approval_now(&json!({ "requestId": "codex:8", "decision": "accept", "threadId": "thread-1", "turnId": "turn-1" }))
                .unwrap_err()
                .message
                .to_lowercase()
                .contains("no longer pending")
        );
        connection.emit(request(json!({
            "method": "item/fileChange/requestApproval",
            "id": 9,
            "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "item-file", "grantRoot": "/workspace/generated", "startedAtMs": 1 },
        })));
        assert_match(
            &last(),
            &json!({ "type": "approval.requested", "payload": { "grantRoot": "/workspace/generated" } }),
        );
        adapter
            .resolve_approval_now(&json!({ "requestId": "codex:9", "decision": "decline", "threadId": "thread-1", "turnId": "turn-1" }))
            .unwrap();
        connection.emit(request(json!({
            "method": "item/tool/requestUserInput",
            "id": 10,
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-2",
                "questions": [{ "id": "scope", "header": "Scope", "question": "Which scope?", "options": [{ "label": "Focused" }] }],
            },
        })));
        let question = last();
        assert_match(
            &question,
            &json!({
                "type": "question.requested",
                "payload": { "questions": [{ "header": "Scope", "question": "Which scope?" }] },
            }),
        );
        adapter
            .resolve_question_now(&json!({
                "requestId": question["payload"]["requestId"],
                "answers": [["Focused"]],
                "rejected": false,
                "turnId": "turn-1",
            }))
            .unwrap();
        assert_eq!(
            connection.responses.borrow().last().unwrap(),
            &json!({ "id": 10, "result": { "answers": { "scope": { "answers": ["Focused"] } } } })
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn implements_the_advertised_current_app_server_fork_steer_and_compaction_operations() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("turn/steer", json!({}));
        connection.result("thread/fork", json!({ "thread": { "id": "thread-fork" } }));
        connection.result("thread/compact/start", json!({}));
        let adapter = adapter(&connection);
        adapter.connect().await.unwrap();
        adapter.set_thread_id(Some("thread-1"));
        adapter.set_active_turn_id(Some("turn-1"));
        adapter
            .steer_turn(
                json!({ "turnId": "turn-1", "message": "Focus on tests", "references": [] }),
            )
            .await
            .unwrap();
        adapter.set_active_turn_id(None);
        assert_eq!(
            adapter
                .fork_session(json!({ "messageId": "message-1" }))
                .await
                .unwrap(),
            json!({ "providerSessionId": "thread-fork" })
        );
        adapter.compact_session().await.unwrap();
        let steer = &connection.requests_of("turn/steer")[0];
        assert_eq!(steer["threadId"], "thread-1");
        assert_eq!(steer["expectedTurnId"], "turn-1");
        assert_eq!(
            connection.requests_of("thread/fork")[0],
            json!({ "threadId": "thread-1", "messageId": "message-1", "excludeTurns": true })
        );
        assert_eq!(
            connection.requests_of("thread/compact/start")[0],
            json!({ "threadId": "thread-1" })
        );
        assert_match(
            &json!({
                "structuredQuestions": CODEX_CAPABILITIES["structuredQuestions"],
                "fork": CODEX_CAPABILITIES["fork"],
                "steer": CODEX_CAPABILITIES["steer"],
                "compaction": CODEX_CAPABILITIES["compaction"],
                "protocol": { "name": CODEX_CAPABILITIES["protocol"]["name"] },
            }),
            &json!({
                "structuredQuestions": true,
                "fork": true,
                "steer": true,
                "compaction": true,
                "protocol": { "name": "codex-app-server" },
            }),
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn keeps_the_current_turn_steerable_after_an_older_terminal_notification_arrives_late() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("turn/steer", json!({}));
        let adapter = adapter(&connection);
        adapter.connect().await.unwrap();
        adapter.set_thread_id(Some("thread-1"));
        for (method, id, status) in [
            ("turn/started", "A", "inProgress"),
            ("turn/completed", "A", "interrupted"),
            ("turn/started", "B", "inProgress"),
            ("turn/completed", "A", "completed"),
        ] {
            connection.emit(notification(json!({
                "method": method,
                "params": { "threadId": "thread-1", "turn": { "id": id, "status": status } },
            })));
        }
        assert_eq!(
            adapter
                .steer_turn(json!({ "turnId": "B", "message": "continue", "references": [] }))
                .await
                .unwrap(),
            Value::Null
        );
        assert_eq!(
            connection.requests_of("turn/steer").last().unwrap()["expectedTurnId"],
            "B"
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn cancels_pending_approvals_only_after_codex_accepts_an_interrupt() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("turn/interrupt", json!({}));
        let adapter = adapter(&connection);
        adapter.connect().await.unwrap();
        adapter.set_thread_id(Some("thread-1"));
        connection.emit(request(json!({
            "method": "item/fileChange/requestApproval",
            "id": 9,
            "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1", "startedAtMs": 1 },
        })));
        adapter
            .interrupt_turn(json!({ "turnId": "turn-1" }))
            .await
            .unwrap();
        assert!(
            connection
                .responses
                .borrow()
                .contains(&json!({ "id": 9, "result": { "decision": "cancel" } }))
        );
        connection.emit(request(json!({
            "method": "item/fileChange/requestApproval",
            "id": 10,
            "params": { "threadId": "thread-1", "turnId": "turn-2", "itemId": "item-2", "startedAtMs": 1 },
        })));
        connection.failure(
            "turn/interrupt",
            AgentError::new("interrupt transport failed"),
        );
        assert!(
            adapter
                .interrupt_turn(json!({ "turnId": "turn-2" }))
                .await
                .unwrap_err()
                .message
                .contains("transport failed")
        );
        adapter
            .resolve_approval_now(&json!({ "requestId": "codex:10", "decision": "decline", "threadId": "thread-1", "turnId": "turn-2" }))
            .unwrap();
        assert!(
            connection
                .responses
                .borrow()
                .contains(&json!({ "id": 10, "result": { "decision": "decline" } }))
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn distinguishes_an_account_read_failure_from_an_unauthenticated_account() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.failure(
            "account/read",
            AgentError::new("account service unavailable"),
        );
        connection.result(
            "model/list",
            json!({ "data": [{ "id": "gpt-5", "model": "gpt-5" }] }),
        );
        let adapter = adapter(&connection);
        let inspection = adapter.inspect().await.unwrap();
        assert_match(
            &inspection["account"],
            &json!({ "account": null, "requiresOpenaiAuth": false }),
        );
        assert!(
            inspection["warnings"][0]
                .as_str()
                .unwrap()
                .to_lowercase()
                .contains("account service unavailable")
        );
        adapter.dispose().await.unwrap();
    });
}

// ------------------------------------------------- paginated history reader

type Calls = Rc<RefCell<Vec<(String, Value)>>>;

fn scripted(
    answer: impl Fn(&str, &Value, usize) -> AgentResult<Value> + 'static,
) -> (Rc<CodexRequest>, Calls) {
    let calls: Calls = Rc::default();
    let log = calls.clone();
    let request: Rc<CodexRequest> = Rc::new(move |method: &str, params: Value| {
        log.borrow_mut().push((method.to_string(), params.clone()));
        let result = answer(method, &params, log.borrow().len());
        Box::pin(async move { result })
    });
    (request, calls)
}

#[test]
fn falls_back_to_legacy_thread_read_only_when_the_paginated_method_is_unavailable() {
    run_local(async {
        let (request, calls) = scripted(|method, _, _| match method {
            "thread/turns/list" => Err(AgentError::new(
                "thread/turns/list: Method not found (-32601)",
            )),
            "thread/read" => Ok(
                json!({ "thread": { "id": "legacy", "turns": [{ "id": "turn-1", "items": [] }] } }),
            ),
            _ => Ok(json!({})),
        });
        let history = read_codex_history(&*request, "legacy").await.unwrap();
        assert_match(
            &history,
            &json!({ "id": "legacy", "turns": [{ "id": "turn-1", "items": [] }] }),
        );
        assert_eq!(
            calls.borrow().last().unwrap(),
            &(
                "thread/read".to_string(),
                json!({ "threadId": "legacy", "includeTurns": true })
            )
        );
    });
}

#[test]
fn does_not_downgrade_an_arbitrary_pagination_failure_to_deprecated_hydration() {
    run_local(async {
        let (request, calls) =
            scripted(|_, _, _| Err(AgentError::new("thread/turns/list transport closed")));
        assert!(
            read_codex_history(&*request, "thread-1")
                .await
                .unwrap_err()
                .message
                .contains("transport closed")
        );
        assert_eq!(calls.borrow().len(), 1);
    });
}

#[test]
fn rejects_repeated_cursors_instead_of_looping_forever() {
    run_local(async {
        let (request, calls) = scripted(|_, _, count| {
            Ok(json!({
                "data": [{ "id": format!("turn-{count}"), "items": [], "itemsView": "full", "status": "completed" }],
                "nextCursor": "same-cursor",
            }))
        });
        assert!(
            read_codex_paginated_history(&*request, Some("thread-1"))
                .await
                .unwrap_err()
                .message
                .contains("repeated pagination cursor")
        );
        assert_eq!(calls.borrow().len(), 2);
    });
}

#[test]
fn retries_resume_without_exclude_turns_only_for_an_older_server_rejecting_that_field() {
    run_local(async {
        let (request, calls) = scripted(|_, _, count| {
            if count == 1 {
                Err(AgentError::new(
                    "Invalid params: unknown field `excludeTurns`",
                ))
            } else {
                Ok(json!({ "thread": { "id": "thread-1" } }))
            }
        });
        assert_eq!(
            request_codex_metadata_only_thread(
                &*request,
                "thread/resume",
                json!({ "threadId": "thread-1" })
            )
            .await
            .unwrap(),
            json!({ "thread": { "id": "thread-1" } })
        );
        assert_eq!(
            *calls.borrow(),
            [
                (
                    "thread/resume".to_string(),
                    json!({ "threadId": "thread-1", "excludeTurns": true })
                ),
                (
                    "thread/resume".to_string(),
                    json!({ "threadId": "thread-1" })
                ),
            ]
        );
    });
}

#[test]
fn marks_an_oversized_final_native_page_as_partial_even_without_a_cursor() {
    run_local(async {
        let (request, _) = scripted(|_, _, _| {
            let data: Vec<Value> = (0..=limits::MAX_TURNS)
                .map(|i| json!({ "id": format!("turn-{i}"), "items": [], "itemsView": "full" }))
                .collect();
            Ok(json!({ "data": data, "nextCursor": null }))
        });
        let result = read_codex_paginated_history(&*request, Some("thread-1"))
            .await
            .unwrap();
        assert_eq!(result["coverage"], "partial");
        assert_eq!(result["turns"].as_array().unwrap().len(), limits::MAX_TURNS);
    });
}

#[test]
fn rejects_item_pages_belonging_to_another_turn() {
    run_local(async {
        let (request, _) = scripted(|method, _, _| {
            Ok(if method == "thread/turns/list" {
                json!({ "data": [{ "id": "turn-1", "itemsView": "summary", "items": [] }], "nextCursor": null })
            } else {
                json!({
                    "data": [{ "turnId": "wrong-turn", "item": { "id": "message", "type": "agentMessage", "text": "Wrong" } }],
                    "nextCursor": null,
                })
            })
        });
        assert!(
            read_codex_paginated_history(&*request, Some("thread-1"))
                .await
                .unwrap_err()
                .message
                .contains("item identity")
        );
    });
}

#[test]
fn keeps_the_native_paging_window_below_the_renderer_replay_event_budget() {
    const { assert!(limits::MAX_PROJECTED_EVENTS < 1_000) };
    const { assert!(limits::TURN_PAGE_SIZE <= 50) };
    const { assert!(limits::ITEM_PAGE_SIZE <= 100) };
    const { assert!(limits::MAX_TURNS >= 100) };
}

#[test]
fn preserves_the_summary_prompt_when_a_very_large_turn_page_contains_only_recent_items() {
    run_local(async {
        let summary_prompt = json!({
            "id": "prompt-1",
            "type": "userMessage",
            "content": [{ "type": "text", "text": "original prompt" }],
        });
        let prompt = summary_prompt.clone();
        let (request, _) = scripted(move |method, _, _| {
            Ok(if method == "thread/turns/list" {
                json!({
                    "data": [{ "id": "large-turn", "status": "completed", "itemsView": "summary", "items": [prompt] }],
                    "nextCursor": null,
                })
            } else {
                let data: Vec<Value> = (0..limits::MAX_ITEMS_PER_TURN)
                    .map(|index| {
                        json!({
                            "turnId": "large-turn",
                            "item": { "id": format!("answer-{index}"), "type": "agentMessage", "text": format!("answer {index}") },
                        })
                    })
                    .collect();
                json!({ "data": data, "nextCursor": null })
            })
        });
        let history = read_codex_paginated_history(&*request, Some("thread-1"))
            .await
            .unwrap();
        let items = history["turns"][0]["items"].as_array().unwrap();
        assert_eq!(items.len(), limits::MAX_ITEMS_PER_TURN);
        assert_eq!(items[0], summary_prompt);
    });
}

#[test]
fn keeps_the_newest_whole_turns_when_a_long_thread_exceeds_the_event_budget() {
    run_local(async {
        let all_turns: Vec<Value> = (0..200)
            .map(|index| {
                let items: Vec<Value> = (0..5)
                    .map(|item| json!({ "id": format!("change-{index}-{item}"), "type": "fileChange", "changes": [] }))
                    .collect();
                json!({ "id": format!("turn-{}", 199 - index), "status": "completed", "itemsView": "full", "items": items })
            })
            .collect();
        let (request, _) = scripted(move |_, params, _| {
            let offset: usize = params["cursor"].as_str().map_or(0, |c| c.parse().unwrap());
            let limit = params["limit"].as_u64().unwrap() as usize;
            let data: Vec<Value> = all_turns.iter().skip(offset).take(limit).cloned().collect();
            let next = offset + data.len();
            Ok(json!({
                "data": data,
                "nextCursor": if next < all_turns.len() { Value::from(next.to_string()) } else { Value::Null },
            }))
        });
        let history = read_codex_paginated_history(&*request, Some("long-thread"))
            .await
            .unwrap();
        let turns = history["turns"].as_array().unwrap();
        assert!(!turns.is_empty() && turns.len() < 200);
        assert_eq!(turns.last().unwrap()["id"], "turn-199");
        assert_eq!(turns[0]["id"], format!("turn-{}", 200 - turns.len()));
        let projected: usize = turns
            .iter()
            .map(|turn| 2 + turn["items"].as_array().unwrap().len() * 2)
            .sum();
        assert!(projected <= limits::MAX_PROJECTED_EVENTS);
    });
}

// ------------------------------------------------------------- discovery
// `tests/unit/agent/runtimes/discovery/electron.agent-discovery.test.mjs`,
// with real executables in a temporary directory.

mod discovery {
    use super::super::codex_discovery::{
        CodexDiscoveryOptions, MIN_SUPPORTED_CODEX_VERSION, compare_versions,
        discover_codex_executable, parse_codex_version,
    };
    use crate::agent::application::tests_support::run_local;
    use crate::platform::common::bounded_process_probe::{ProbeRunner, default_probe_runner};
    use crate::platform::common::command_environment::{EnvMap, EnvironmentSnapshot};
    use core::prelude::v1::test;
    use std::cell::RefCell;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::rc::Rc;

    fn codex(directory: &Path, version: &str) -> String {
        std::fs::create_dir_all(directory).unwrap();
        let path = directory.join("codex");
        std::fs::write(&path, format!("#!/bin/sh\necho 'codex-cli {version}'\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn options(
        path: &str,
        home: &Path,
        probes: Rc<RefCell<Vec<Vec<String>>>>,
    ) -> CodexDiscoveryOptions {
        let real = default_probe_runner();
        let recording: ProbeRunner = Rc::new(move |file, args, options| {
            probes.borrow_mut().push(args.clone());
            real(file, args, options)
        });
        CodexDiscoveryOptions {
            env: Some(EnvMap::from([
                ("SHELL".to_string(), "/bin/zsh".to_string()),
                ("PATH".to_string(), path.to_string()),
            ])),
            platform: Some("darwin".into()),
            homedir: Some(home.to_path_buf()),
            read_environment: Some(Rc::new(|env, _, _, _| {
                Box::pin(async move {
                    Ok(EnvironmentSnapshot {
                        environment: env,
                        complete: true,
                        source: "provided".into(),
                        reason_code: None,
                    })
                })
            })),
            run_probe: Some(recording),
        }
    }

    #[test]
    fn parses_and_classifies_semantic_versions() {
        assert_eq!(
            parse_codex_version("codex-cli 0.144.1").as_deref(),
            Some("0.144.1")
        );
        assert_eq!(parse_codex_version("unexpected"), None);
        assert_eq!(compare_versions("0.144.1", "0.100.0"), 1);
        assert_eq!(compare_versions("0.99.0", "0.100.0"), -1);
        assert_eq!(compare_versions("0.100.0", "0.100.0"), 0);
        assert_eq!(MIN_SUPPORTED_CODEX_VERSION, "0.144.1");
    }

    #[test]
    fn uses_the_supplied_environment_for_both_selection_and_the_version_probe() {
        run_local(async {
            let directory = tempfile::tempdir().unwrap();
            let bin = directory.path().join("bin");
            let executable = codex(&bin, "0.144.1");
            let path = format!("{}:/usr/bin", bin.to_string_lossy());
            let probes: Rc<RefCell<Vec<Vec<String>>>> = Rc::default();
            let readiness = discover_codex_executable(
                options(&path, &directory.path().join("home"), probes.clone()),
                None,
            )
            .await
            .unwrap();
            assert_eq!(readiness["status"], "ready");
            assert_eq!(readiness["version"], "0.144.1");
            assert_eq!(readiness["executablePath"], executable.as_str());
            assert_eq!(readiness["provider"], "codex");
            assert_eq!(*probes.borrow(), [vec!["--version".to_string()]]);
            assert_eq!(readiness["environment"]["PATH"], path.as_str());
            assert_eq!(readiness["environment"]["TERM"], "dumb");
        });
    }

    #[test]
    fn classifies_missing_and_older_installations() {
        run_local(async {
            let directory = tempfile::tempdir().unwrap();
            let home = directory.path().join("home");
            let missing =
                discover_codex_executable(options("/nonexistent", &home, Rc::default()), None)
                    .await
                    .unwrap();
            assert_eq!(missing["status"], "not-installed");
            assert_eq!(missing["code"], "RUNTIME_NOT_INSTALLED");
            let bin = directory.path().join("bin");
            codex(&bin, "0.90.0");
            let older = discover_codex_executable(
                options(&bin.to_string_lossy(), &home, Rc::default()),
                None,
            )
            .await
            .unwrap();
            assert_eq!(older["status"], "unsupported-version");
            assert_eq!(older["version"], "0.90.0");
            assert_eq!(older["code"], "RUNTIME_VERSION_UNSUPPORTED");
        });
    }
}

/// The real login shell and installation on this machine.
#[test]
#[ignore = "reads the developer's login shell and Codex installation"]
fn live_codex_discovery_reads_the_login_shell() {
    use super::codex_discovery::{CodexDiscoveryOptions, discover_codex_executable};
    run_local(async {
        let readiness = discover_codex_executable(CodexDiscoveryOptions::default(), None)
            .await
            .unwrap();
        let mut shown = readiness.clone();
        crate::agent::contract::js::delete(&mut shown, "environment");
        eprintln!("{shown:#}");
        assert!(readiness["status"].is_string());
    });
}

/// Discovery, launch and inspection of the real app-server (no turn).
#[test]
#[ignore = "launches the developer's Codex app-server"]
fn live_codex_app_server_inspection() {
    use super::codex_discovery::{CodexDiscoveryOptions, discover_codex_executable};
    run_local(async {
        let readiness = discover_codex_executable(CodexDiscoveryOptions::default(), None)
            .await
            .unwrap();
        assert_eq!(readiness["status"], "ready", "{readiness}");
        let exits: Events = Rc::default();
        let sink = exits.clone();
        let adapter = CodexAppServerAdapter::new(CodexAdapterOptions {
            executable_path: readiness["executablePath"].as_str().unwrap().into(),
            environment: Some(readiness["environment"].clone()),
            workspace_root: std::env::temp_dir().to_string_lossy().into_owned(),
            app_version: "test".into(),
            spawner: None,
            connection_factory: None,
            on_event: Rc::new(|_| {}),
            on_exit: Rc::new(move |info| sink.borrow_mut().push(info)),
            on_session_persisted: None,
        });
        let inspection = adapter.inspect().await.unwrap();
        crate::agent::runtime::agent_runtime_port::assert_agent_runtime_inspection(
            &adapter,
            &inspection,
            "codex",
        )
        .unwrap();
        eprintln!(
            "account type={} models={}",
            inspection["account"]["account"]["type"],
            inspection["models"].as_array().map_or(0, Vec::len)
        );
        adapter.dispose().await.unwrap();
        assert_eq!(exits.borrow().len(), 1);
        assert_eq!(exits.borrow()[0]["expected"], true);
    });
}

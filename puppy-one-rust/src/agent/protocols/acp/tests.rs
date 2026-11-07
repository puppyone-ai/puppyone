//! `tests/unit/agent/runtimes/acp/electron.acp-client.test.mjs`,
//! `electron.acp-history-replay.test.mjs` and
//! `tests/integration/agent/runtimes/acp/electron.acp-prompt-input.test.mjs`.
use super::acp_client::{AcpClient, AcpDelegate, RequestHandler};
use super::acp_event_normalizer::AcpEventNormalizer;
use super::acp_history_replay::AcpHistoryReplay;
use super::acp_interactions::select_permission_option;
use super::acp_prompt_input::{
    AcpReferenceProfile, build_acp_prompt_blocks, materialize_acp_references, path_to_file_url,
};
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests_support::run_local;
use crate::agent::contract::js;
use crate::agent::domain::transcript::display_projection::ProjectionOptions;
use crate::agent::domain::transcript::transcript_reducer::{
    apply_agent_events, create_agent_projection,
};
use crate::agent::transports::jsonl_rpc_connection::{ConnectionEvent, jsonl_rpc_error_response};
use crate::agent::transports::rpc_connection::RpcConnection;
use crate::agent::transports::rpc_connection::fake::FakeConnection;
use crate::clock;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::rc::Rc;

fn client(connection: &Rc<FakeConnection>, delegate: AcpDelegate) -> AcpClient {
    AcpClient::new(
        connection.clone() as Rc<dyn RpcConnection>,
        None,
        delegate,
        Default::default(),
    )
}

fn methods(connection: &FakeConnection) -> Vec<String> {
    connection
        .requests
        .borrow()
        .iter()
        .map(|r| r["method"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn negotiates_capabilities_and_caches_legacy_method_name_fallback() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result(
            "initialize",
            json!({
                "agentInfo": { "name": "fixture", "version": "1.0.0" },
                "agentCapabilities": { "loadSession": true },
                "authMethods": [{ "id": "token" }],
            }),
        );
        connection.result("newSession", json!({ "sessionId": "session-1" }));
        connection.failure(
            "session/new",
            jsonl_rpc_error_response("session/new", -32601, "not found", None),
        );
        let client = client(&connection, AcpDelegate::default());
        let initialized = client.initialize(None, None).await.unwrap();
        assert_eq!(initialized["agentInfo"]["name"], "fixture");
        for _ in 0..2 {
            assert_eq!(
                client
                    .new_session(json!({ "cwd": "/workspace" }))
                    .await
                    .unwrap(),
                json!({ "sessionId": "session-1" })
            );
        }
        assert_eq!(
            methods(&connection),
            ["initialize", "session/new", "newSession", "newSession"]
        );
        assert_eq!(
            client.agent_capabilities(),
            Some(json!({ "loadSession": true }))
        );
        assert_eq!(client.auth_methods(), [json!({ "id": "token" })]);
    });
}

#[test]
fn uses_an_unbounded_prompt_request_and_fans_out_cancel_before_negotiation() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("session/prompt", json!({ "stopReason": "end_turn" }));
        let client = client(&connection, AcpDelegate::default());
        client
            .prompt(json!({ "sessionId": "session-1", "prompt": [{ "type": "text", "text": "hello" }] }))
            .await
            .unwrap();
        client.cancel(json!({ "sessionId": "session-1" }));
        let prompt = connection.requests.borrow()[0].clone();
        assert_eq!(prompt["method"], "session/prompt");
        assert_eq!(prompt["timeoutMs"], 0);
        let notified: Vec<Value> = connection
            .notifications
            .borrow()
            .iter()
            .map(|n| n["method"].clone())
            .collect();
        assert_eq!(notified, [json!("session/cancel"), json!("cancel")]);
    });
}

#[test]
fn uses_the_standard_acp_model_selection_method() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("session/set_model", json!({}));
        let client = client(&connection, AcpDelegate::default());
        assert_eq!(
            client
                .set_model(json!({ "sessionId": "session-1", "modelId": "provider:model" }))
                .await
                .unwrap(),
            json!({})
        );
        assert_eq!(
            connection.requests.borrow()[0],
            json!({
                "method": "session/set_model",
                "params": { "sessionId": "session-1", "modelId": "provider:model" },
                "timeoutMs": 30_000,
            })
        );
    });
}

#[test]
fn sends_an_explicitly_registered_provider_extension_without_method_fallback() {
    run_local(async {
        let connection = FakeConnection::new();
        connection.result("_fixture/status", json!({ "ready": true }));
        let client = client(&connection, AcpDelegate::default());
        assert_eq!(
            client
                .request_extension("_fixture/status", json!({}), Some(1_250))
                .await
                .unwrap(),
            json!({ "ready": true })
        );
        assert_eq!(connection.requests.borrow()[0]["timeoutMs"], 1_250);
        assert_eq!(
            client
                .request_extension(" ", json!({}), None)
                .await
                .unwrap_err()
                .message,
            "ACP extension method is required."
        );
    });
}

fn answering(value: Value) -> RequestHandler {
    Rc::new(move |_| {
        let value = value.clone();
        Box::pin(async move { Ok(value) })
    })
}

#[test]
fn correlates_permission_and_workspace_file_callbacks_without_exposing_unknown_methods() {
    run_local(async {
        let connection = FakeConnection::new();
        let client = client(
            &connection,
            AcpDelegate {
                request_permission: Some(answering(
                    json!({ "outcome": { "outcome": "selected", "optionId": "allow" } }),
                )),
                read_text_file: Some(answering(json!({ "content": "hello" }))),
                write_text_file: Some(answering(json!({}))),
                ..Default::default()
            },
        );
        for (id, method, params) in [
            (
                1,
                "session/request_permission",
                json!({ "sessionId": "session-1" }),
            ),
            (2, "fs/read_text_file", json!({ "path": "README.md" })),
            (
                3,
                "fs/writeTextFile",
                json!({ "path": "README.md", "content": "x" }),
            ),
            (4, "terminal/create", json!({})),
        ] {
            connection.emit(ConnectionEvent::Request(
                json!({ "id": id, "method": method, "params": params }),
            ));
        }
        for _ in 0..4 {
            tokio::task::yield_now().await;
        }
        let responses = connection.responses.borrow().clone();
        assert_eq!(responses.len(), 3);
        assert!(responses.contains(&json!({ "id": 1, "result": { "outcome": { "outcome": "selected", "optionId": "allow" } } })));
        assert!(responses.contains(&json!({ "id": 2, "result": { "content": "hello" } })));
        assert!(responses.contains(&json!({ "id": 3, "result": {} })));
        assert_eq!(
            *connection.errors.borrow(),
            [json!({ "id": 4, "code": -32601, "message": "ACP client method is not supported." })]
        );
        client.dispose();
    });
}

#[test]
fn preserves_an_advertised_session_scoped_permission_option() {
    let options = [
        json!({ "optionId": "allow_always", "kind": "allow_always" }),
        json!({ "optionId": "allow_session", "kind": "allow_always" }),
    ];
    assert_eq!(
        select_permission_option(&options, Some("acceptForSession")).unwrap()["optionId"],
        "allow_session"
    );
    assert_eq!(
        select_permission_option(&options, Some("accept")).unwrap()["optionId"],
        "allow_always"
    );
    assert!(select_permission_option(&options, Some("cancel")).is_none());
}

#[test]
fn retires_the_connection_when_a_session_callback_fails() {
    run_local(async {
        let connection = FakeConnection::new();
        let client = client(
            &connection,
            AcpDelegate {
                on_session_update: Some(Rc::new(|_| {
                    Err(AgentError::new("callback failed with sk-1234567890123456"))
                })),
                ..Default::default()
            },
        );
        connection.emit(ConnectionEvent::Notification(json!({
            "method": "session/update",
            "params": { "sessionId": "session-1", "update": { "sessionUpdate": "plan" } },
        })));
        let disposals = connection.disposals.borrow().clone();
        assert_eq!(disposals.len(), 1);
        assert!(disposals[0].0.contains("ACP client callback failed"));
        assert!(!disposals[0].0.contains("sk-1234567890123456"));
        assert!(!disposals[0].1);
        client.dispose();
    });
}

// ------------------------------------------------------------ history replay

fn update(session_id: &str, value: Value) -> Value {
    json!({ "sessionId": session_id, "update": value })
}

fn fixture_notifications() -> Vec<Value> {
    vec![
        update(
            "session-1",
            json!({ "sessionUpdate": "user_message_chunk", "messageId": "user-1", "content": { "type": "text", "text": "Inspect the file" } }),
        ),
        update(
            "session-1",
            json!({ "sessionUpdate": "agent_message_chunk", "messageId": "assistant-1", "content": { "type": "text", "text": "Checking." } }),
        ),
        update(
            "session-1",
            json!({ "sessionUpdate": "tool_call", "toolCallId": "search-1", "kind": "search", "title": "Search workspace", "status": "pending", "rawInput": { "query": "needle" } }),
        ),
        update(
            "session-1",
            json!({ "sessionUpdate": "tool_call_update", "toolCallId": "search-1", "status": "completed", "rawOutput": "1 match" }),
        ),
        update(
            "session-1",
            json!({
                "sessionUpdate": "tool_call", "toolCallId": "edit-1", "kind": "edit", "title": "Edit file", "status": "pending",
                "rawInput": { "path": "src/example.ts", "oldString": "old", "newString": "new" },
                "content": [{ "type": "diff", "path": "src/example.ts", "oldText": "old", "newText": "new" }],
            }),
        ),
        update(
            "session-1",
            json!({ "sessionUpdate": "tool_call_update", "toolCallId": "edit-1", "status": "completed" }),
        ),
    ]
}

#[test]
fn uses_the_live_normalizer_for_messages_tool_patches_output_and_file_changes() {
    let notifications = fixture_notifications();
    let mut replay = AcpHistoryReplay::new();
    for notification in &notifications {
        replay.accept(notification);
    }
    let mut live = AcpEventNormalizer::new(Some("history-user-1"));
    let mut live_events: Vec<Value> = notifications[1..]
        .iter()
        .flat_map(|n| live.normalize(n))
        .collect();
    live_events.extend(live.complete_assistant(Some("session-1")));
    let history = replay.events(Some("session-1"));
    assert_eq!(
        history[0],
        json!({
            "type": "turn.started",
            "providerSessionId": "session-1",
            "turnId": "history-user-1",
            "itemId": null,
            "payload": { "prompt": "Inspect the file", "restored": true, "userMessageId": "user-1" },
        })
    );
    assert_eq!(history[1..], live_events[..]);
    let find = |kind: &str, item: &str| {
        history
            .iter()
            .find(|e| e["type"] == kind && e["itemId"] == item)
            .cloned()
    };
    assert!(find("tool.started", "search-1").is_some());
    let completed = find("tool.completed", "search-1").unwrap();
    assert_eq!(completed["payload"]["kind"], "search");
    assert_eq!(completed["payload"]["input"], json!({ "query": "needle" }));
    assert_eq!(completed["payload"]["outputPreview"], "1 match");
    assert!(find("file.change.updated", "edit-1").is_some());
    assert!(find("assistant.completed", "assistant-1").is_some());
    let envelopes: Vec<Value> = history
        .iter()
        .enumerate()
        .map(|(index, event)| {
            js::with(
                &js::with(event, "sequence", index as i64 + 1),
                "emittedAt",
                clock::iso_string(index as i64 * 1_000),
            )
        })
        .collect();
    let projection = apply_agent_events(
        &create_agent_projection(),
        &envelopes,
        ProjectionOptions::default(),
    );
    assert!(
        projection
            .messages
            .iter()
            .any(|m| m["role"] == "user" && m["text"] == "Inspect the file")
    );
    assert!(
        projection.messages.iter().any(|m| m["role"] == "assistant"
            && m["text"] == "Checking."
            && m["streaming"] == false)
    );
    assert!(
        projection
            .activities
            .iter()
            .any(|a| a["itemId"] == "search-1"
                && a["status"] == "completed"
                && a["detail"]["input"] == json!({ "query": "needle" })
                && a["detail"]["outputPreview"] == "1 match")
    );
    assert!(projection.activities.iter().any(|a| a["itemId"] == "edit-1"
        && a["kind"] == "file-change"
        && a["status"] == "completed"));
}

#[test]
fn creates_stable_turn_boundaries_without_inventing_terminal_turn_events() {
    let mut replay = AcpHistoryReplay::new();
    for notification in [
        update(
            "session-1",
            json!({ "sessionUpdate": "user_message_chunk", "messageId": "user-1", "content": { "type": "text", "text": "First" } }),
        ),
        update(
            "session-1",
            json!({ "sessionUpdate": "agent_message_chunk", "messageId": "assistant-1", "content": { "type": "text", "text": "One" } }),
        ),
        update(
            "session-1",
            json!({ "sessionUpdate": "user_message_chunk", "messageId": "user-2", "content": { "type": "text", "text": "Second" } }),
        ),
        update(
            "session-1",
            json!({ "sessionUpdate": "agent_message_chunk", "messageId": "assistant-2", "content": { "type": "text", "text": "Two" } }),
        ),
    ] {
        replay.accept(&notification);
    }
    let events = replay.events(Some("session-1"));
    let turns: Vec<Value> = events
        .iter()
        .filter(|e| e["type"] == "turn.started")
        .map(|e| json!({ "turnId": e["turnId"], "prompt": e["payload"]["prompt"] }))
        .collect();
    assert_eq!(
        turns,
        [
            json!({ "turnId": "history-user-1", "prompt": "First" }),
            json!({ "turnId": "history-user-2", "prompt": "Second" }),
        ]
    );
    assert!(!events.iter().any(|e| matches!(
        e["type"].as_str(),
        Some("turn.completed" | "turn.failed" | "turn.interrupted")
    )));
}

// -------------------------------------------------------------- prompt input

fn temporary_root() -> (tempfile::TempDir, String) {
    let directory = tempfile::Builder::new()
        .prefix("puppyone-acp-input-")
        .tempdir()
        .unwrap();
    let root = std::fs::canonicalize(directory.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();
    (directory, root)
}

const EMBEDDED: AcpReferenceProfile = AcpReferenceProfile {
    image: false,
    embedded_text: true,
};

#[test]
fn embeds_bounded_utf8_text_only_after_embedded_context_negotiation() {
    let (_guard, root) = temporary_root();
    let filename = format!("{root}/notes.md");
    std::fs::write(&filename, "# Notes\n\nKeep this exact.").unwrap();
    let materialized = materialize_acp_references(
        &[json!({ "id": "ref-text", "kind": "staged-attachment", "path": filename, "name": "notes.md", "mime": "text/markdown" })],
        EMBEDDED,
    )
    .unwrap();
    let blocks =
        build_acp_prompt_blocks("Review this", None, &materialized, &root, EMBEDDED).unwrap();
    assert_eq!(
        blocks,
        [
            json!({ "type": "text", "text": "Review this" }),
            json!({
                "type": "resource",
                "resource": {
                    "uri": "puppyone-attachment://local/ref-text/notes.md",
                    "mimeType": "text/markdown",
                    "text": "# Notes\n\nKeep this exact.",
                },
            }),
        ]
    );
    assert!(!json!(blocks).to_string().contains(&filename));
}

#[test]
fn falls_back_to_the_required_acp_resource_link_when_embedded_context_is_unavailable() {
    let (_guard, root) = temporary_root();
    let filename = format!("{root}/notes.md");
    std::fs::write(&filename, "notes").unwrap();
    let materialized = materialize_acp_references(
        &[json!({ "kind": "staged-attachment", "path": filename, "name": "notes.md", "mime": "text/markdown", "size": 5 })],
        AcpReferenceProfile::default(),
    )
    .unwrap();
    assert_eq!(
        build_acp_prompt_blocks(
            "Review @notes.md",
            None,
            &materialized,
            &root,
            AcpReferenceProfile::default()
        )
        .unwrap(),
        [
            json!({ "type": "text", "text": "Review @notes.md" }),
            json!({
                "type": "resource_link",
                "uri": path_to_file_url(&filename),
                "name": "notes.md",
                "title": "notes.md",
                "mimeType": "text/markdown",
                "size": 5,
            }),
        ]
    );
}

#[test]
fn keeps_invalid_utf8_and_binary_files_as_path_resources_without_reading_them_into_the_prompt() {
    let (_guard, root) = temporary_root();
    let invalid = format!("{root}/invalid.txt");
    let pdf = format!("{root}/paper.pdf");
    std::fs::write(&invalid, [0xffu8, 0xfe, 0xfd]).unwrap();
    std::fs::write(&pdf, "%PDF-1.7").unwrap();
    let references = materialize_acp_references(
        &[
            json!({ "kind": "staged-attachment", "path": invalid, "name": "invalid.txt", "mime": "text/plain" }),
            json!({ "kind": "staged-attachment", "path": pdf, "name": "paper.pdf", "mime": "application/pdf" }),
        ],
        EMBEDDED,
    )
    .unwrap();
    assert_eq!(
        build_acp_prompt_blocks("Inspect", None, &references, &root, EMBEDDED).unwrap(),
        [
            json!({ "type": "text", "text": "Inspect" }),
            json!({ "type": "resource_link", "uri": path_to_file_url(&invalid), "name": "invalid.txt", "title": "invalid.txt", "mimeType": "text/plain" }),
            json!({ "type": "resource_link", "uri": path_to_file_url(&pdf), "name": "paper.pdf", "title": "paper.pdf", "mimeType": "application/pdf" }),
        ]
    );
}

#[test]
fn keeps_workspace_resource_links_inside_the_assigned_workspace() {
    let error = build_acp_prompt_blocks(
        "Inspect",
        None,
        &[json!({ "kind": "workspace-entry", "path": "/workspace-b/secret.txt" })],
        "/workspace-a",
        AcpReferenceProfile::default(),
    )
    .unwrap_err();
    assert!(
        error
            .message
            .to_lowercase()
            .contains("invalid workspace reference")
    );
}

#[test]
fn keeps_an_inline_display_mention_while_delivering_workspace_data_as_an_acp_resource_link() {
    let (_guard, root) = temporary_root();
    let filename = format!("{root}/notes.md");
    std::fs::write(&filename, "notes").unwrap();
    assert_eq!(
        build_acp_prompt_blocks(
            "Review @notes.md",
            None,
            &[json!({ "kind": "workspace-entry", "path": filename, "name": "notes.md", "inlineMentioned": true })],
            &root,
            AcpReferenceProfile::default(),
        )
        .unwrap(),
        [
            json!({ "type": "text", "text": "Review @notes.md" }),
            json!({ "type": "resource_link", "uri": path_to_file_url(&filename), "name": "notes.md", "title": "notes.md" }),
        ]
    );
}

//! `tests/unit/agent/runtimes/acp/electron.cursor-acp-adapter.test.mjs`.
use super::cursor_acp_adapter::cursor_acp_adapter;
use super::cursor_discovery::{CursorDiscoveryOptions, discover_cursor_backend};
use super::cursor_identity::CURSOR_RUNTIME_DESCRIPTOR;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::tests_support::run_local;
use crate::agent::installation::executable_resolver::ResolvedCandidate;
use crate::agent::protocols::acp::acp_prompt_input::path_to_file_url;
use crate::agent::protocols::acp::acp_runtime_adapter::{AcpAdapterOptions, AcpRuntimeAdapter};
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::transports::jsonl_rpc_connection::{ConnectionEvent, ConnectionOptions};
use crate::agent::transports::rpc_connection::RpcConnection;
use crate::agent::transports::rpc_connection::fake::FakeConnection;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::{Rc, Weak};
use tokio::sync::oneshot;

type Events = Rc<RefCell<Vec<Value>>>;
type PromptReply = Rc<RefCell<Option<oneshot::Sender<AgentResult<Value>>>>>;

#[derive(Clone, Copy, Default)]
struct Script {
    list: bool,
    replay_history: bool,
    no_load_session: bool,
    invalid_load: bool,
}

/// The product test's `FakeCursorConnection`.
struct CursorConnection {
    connection: Rc<FakeConnection>,
    prompt: PromptReply,
}

fn send_update(connection: &FakeConnection, update: Value, session_id: &str) {
    connection.emit(ConnectionEvent::Notification(json!({
        "method": "session/update",
        "params": { "sessionId": session_id, "update": update },
    })));
}

fn send_request(connection: &FakeConnection, id: i64, method: &str, params: Value) {
    connection.emit(ConnectionEvent::Request(
        json!({ "id": id, "method": method, "params": params }),
    ));
}

fn replay(connection: &FakeConnection) {
    let update = |value: Value| send_update(connection, value, "cursor-history");
    update(
        json!({ "sessionUpdate": "user_message_chunk", "messageId": "user-1", "content": { "type": "text", "text": "Fix " } }),
    );
    update(
        json!({ "sessionUpdate": "user_message_chunk", "messageId": "user-1", "content": { "type": "text", "text": "tabs" } }),
    );
    update(
        json!({ "sessionUpdate": "agent_message_chunk", "messageId": "assistant-1", "content": { "type": "text", "text": "Done" } }),
    );
    update(json!({
        "sessionUpdate": "tool_call", "toolCallId": "search-history", "kind": "search",
        "title": "Search workspace", "status": "pending", "rawInput": { "query": "tabs" },
    }));
    update(
        json!({ "sessionUpdate": "tool_call_update", "toolCallId": "search-history", "status": "completed", "rawOutput": "2 matches" }),
    );
    send_request(
        connection,
        91,
        "session/request_permission",
        json!({
            "sessionId": "cursor-history",
            "toolCall": { "toolCallId": "historical-write", "title": "Historical write", "kind": "edit" },
            "options": [{ "optionId": "allow", "kind": "allow_once" }],
        }),
    );
    send_request(
        connection,
        92,
        "fs/write_text_file",
        json!({
            "sessionId": "cursor-history", "path": "README.md", "content": "must not be written",
        }),
    );
}

impl CursorConnection {
    fn new(script: Script) -> Self {
        let connection = FakeConnection::new();
        let mut capabilities = json!({
            "sessionCapabilities": { "resume": {} },
            "promptCapabilities": { "image": true },
            "_meta": { "cursor": { "askQuestion": 1 } },
        });
        if !script.no_load_session {
            capabilities["loadSession"] = json!(true);
        }
        if script.list {
            capabilities["sessionCapabilities"]["list"] = json!({});
        }
        connection.result(
            "initialize",
            json!({
                "protocolVersion": 1,
                "agentInfo": { "name": "Cursor", "version": "2026.08.1" },
                "agentCapabilities": capabilities,
                "authMethods": [{ "id": "cursor_login" }],
            }),
        );
        connection.result("authenticate", json!({}));
        connection.result(
            "session/list",
            json!({ "sessions": [{ "sessionId": "cursor-history", "cwd": "/workspace", "title": "Fix tabs", "updatedAt": "2026-08-30T00:00:00.000Z" }] }),
        );
        let modes = json!({ "currentModeId": "agent", "availableModes": [{ "id": "agent", "name": "Agent" }, { "id": "plan", "name": "Plan" }] });
        connection.result(
            "session/new",
            json!({ "sessionId": "cursor-session", "modes": modes }),
        );
        connection.result(
            "session/resume",
            json!({ "sessionId": "cursor-history", "modes": modes }),
        );
        let weak: Weak<FakeConnection> = Rc::downgrade(&connection);
        let loaded = json!({ "sessionId": "cursor-history", "modes": modes });
        connection.answer("session/load", move |_| {
            let (weak, loaded) = (weak.clone(), loaded.clone());
            Box::pin(async move {
                if script.invalid_load {
                    return Err(AgentError::coded("-32602", "session/load: Invalid params"));
                }
                if script.replay_history
                    && let Some(connection) = weak.upgrade()
                {
                    replay(&connection);
                }
                Ok(loaded)
            })
        });
        connection.result("session/set_mode", json!({}));
        let prompt: PromptReply = Rc::default();
        let pending = prompt.clone();
        connection.answer("session/prompt", move |_| {
            let (reply, receipt) = oneshot::channel();
            *pending.borrow_mut() = Some(reply);
            Box::pin(async move {
                receipt
                    .await
                    .unwrap_or_else(|_| Err(AgentError::new("prompt dropped")))
            })
        });
        Self { connection, prompt }
    }

    fn finish_prompt(&self, result: AgentResult<Value>) {
        if let Some(reply) = self.prompt.borrow_mut().take() {
            let _ = reply.send(result);
        }
    }

    fn methods(&self) -> Vec<String> {
        self.connection
            .requests
            .borrow()
            .iter()
            .map(|r| r["method"].as_str().unwrap().to_string())
            .collect()
    }
}

fn adapter(
    connection: &CursorConnection,
    readiness: Value,
    events: Option<Events>,
    exits: Option<Events>,
) -> AcpRuntimeAdapter {
    let mut options =
        AcpAdapterOptions::new(readiness, "/workspace", CURSOR_RUNTIME_DESCRIPTOR.clone());
    options.app_version = "0.3.11".into();
    options.connection_factory = Some(connection.connection.factory());
    options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
    if let Some(events) = events {
        options.on_event = Rc::new(move |event| events.borrow_mut().push(event));
    }
    if let Some(exits) = exits {
        options.on_exit = Rc::new(move |info| exits.borrow_mut().push(info));
    }
    cursor_acp_adapter(options).unwrap()
}

fn readiness() -> Value {
    json!({ "executablePath": "/tools/agent", "environment": {}, "version": "2026.08.1", "source": "path-installation" })
}

async fn settle() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}

fn find(events: &Events, kind: &str) -> Option<Value> {
    events.borrow().iter().find(|e| e["type"] == kind).cloned()
}

#[test]
fn does_not_turn_a_lost_acp_response_into_a_native_failed_turn() {
    run_local(async {
        let connection = CursorConnection::new(Script::default());
        let (events, exits): (Events, Events) = (Rc::default(), Rc::default());
        let adapter = adapter(
            &connection,
            json!({ "executablePath": "/tools/agent", "environment": {} }),
            Some(events.clone()),
            Some(exits.clone()),
        );
        adapter.create_session(json!({})).await.unwrap();
        adapter
            .start_turn(json!({ "prompt": "Hello" }))
            .await
            .unwrap();
        settle().await;
        let mut lost = AgentError::new("Pipe lost");
        lost.delivery_outcome = Some("unknown".into());
        connection.finish_prompt(Err(lost));
        settle().await;
        assert_eq!(exits.borrow()[0]["expected"], false);
        assert!(!events.borrow().iter().any(|e| matches!(
            e["type"].as_str(),
            Some("turn.failed" | "turn.interrupted" | "turn.completed")
        )));
        adapter.dispose().await.unwrap();
    });
}

async fn completion_payload(updates: Vec<Value>) -> Value {
    let connection = CursorConnection::new(Script::default());
    let events: Events = Rc::default();
    let adapter = adapter(&connection, readiness(), Some(events.clone()), None);
    adapter.create_session(json!({})).await.unwrap();
    let turn = adapter
        .start_turn(json!({ "prompt": "Finish the work" }))
        .await
        .unwrap();
    settle().await;
    for update in updates {
        send_update(&connection.connection, update, "cursor-session");
    }
    connection.finish_prompt(Ok(json!({ "stopReason": "end_turn" })));
    settle().await;
    let completed = find(&events, "turn.completed").unwrap();
    assert_eq!(completed["turnId"], turn["turnId"]);
    assert!(find(&events, "turn.failed").is_none());
    adapter.dispose().await.unwrap();
    completed["payload"].clone()
}

#[test]
fn preserves_native_completion_while_classifying_cursors_terminal_http2_cancellation_as_degraded() {
    run_local(async {
        let payload = completion_payload(vec![json!({
            "sessionUpdate": "agent_message_chunk",
            "messageId": "terminal-error",
            "content": { "type": "text", "text": "Error: RetriableError: [canceled] http/2 stream closed with error code CANCEL (0x8)" },
        })])
        .await;
        for (key, value) in [
            ("status", json!("completed")),
            ("completionQuality", json!("degraded")),
            ("failureScope", json!("upstream-request")),
            ("failureCode", json!("CURSOR_HTTP2_STREAM_CANCEL")),
            ("retryable", json!(true)),
            ("transportHealth", json!("healthy")),
            ("sideEffects", json!("none")),
        ] {
            assert_eq!(payload[key], value, "{key}");
        }
    });
}

#[test]
fn classifies_the_structured_cursor_child_task_error_without_treating_similar_prose_as_a_failure() {
    run_local(async {
        let payload = completion_payload(vec![
            json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "child-task",
                "kind": "task",
                "title": "Agent task",
                "status": "completed",
                "rawOutput": { "providerOptions": { "cursor": { "highLevelToolCallResult": { "output": {
                    "error": { "error": "[canceled] http/2 stream closed with error code CANCEL (0x8)" },
                } } } } },
            }),
            json!({
                "sessionUpdate": "agent_message_chunk",
                "messageId": "summary",
                "content": { "type": "text", "text": "The log mentions Error: RetriableError, but this sentence is not the terminal signature." },
            }),
        ])
        .await;
        assert_eq!(payload["completionQuality"], "degraded");
        assert_eq!(payload["failureScope"], "child-task");
        assert_eq!(payload["sideEffects"], "possible");
    });
}

#[test]
fn does_not_classify_explanatory_text_that_merely_mentions_a_cursor_retry_error() {
    run_local(async {
        let payload = completion_payload(vec![json!({
            "sessionUpdate": "agent_message_chunk",
            "messageId": "answer",
            "content": { "type": "text", "text": "I handled Error: RetriableError: [canceled] http/2 stream closed with error code CANCEL (0x8) and finished." },
        })])
        .await;
        assert!(payload.get("completionQuality").is_none());
    });
}

fn discovery(probe: Value) -> CursorDiscoveryOptions {
    CursorDiscoveryOptions {
        resolve_candidate: Some(Rc::new(|| {
            Box::pin(async {
                Ok(Some(ResolvedCandidate {
                    executable_path: "/tools/agent".into(),
                    source: "path-installation".into(),
                    ..Default::default()
                }))
            })
        })),
        probe: Some(Rc::new(move |_, _| {
            let probe = probe.clone();
            Box::pin(async move { probe })
        })),
        ..Default::default()
    }
}

#[test]
fn classifies_a_detected_signed_in_cursor_cli_as_an_acp_ready_agent() {
    run_local(async {
        let readiness = discover_cursor_backend(
            discovery(json!({ "installation": "detected", "version": "2026.08.1", "authentication": "signed-in", "source": "path-installation" })),
            None,
        )
        .await
        .unwrap();
        for (key, value) in [
            ("status", json!("ready")),
            ("code", json!("READY")),
            ("executablePath", json!("/tools/agent")),
            ("compatibility", json!("acp-v1")),
            ("selectable", json!(true)),
        ] {
            assert_eq!(readiness[key], value, "{key}");
        }
    });
}

#[test]
fn keeps_cursor_authentication_states_distinct() {
    run_local(async {
        for (authentication, status, code) in [
            (
                "signed-out",
                "installed-not-authenticated",
                "AUTHENTICATION_REQUIRED",
            ),
            (
                "expired",
                "installed-not-authenticated",
                "AUTHENTICATION_EXPIRED",
            ),
            ("error", "error", "AUTHENTICATION_PROBE_FAILED"),
            ("unknown", "error", "AUTHENTICATION_STATUS_UNKNOWN"),
        ] {
            let mut probe = json!({ "installation": "detected", "version": "2026.08.1", "authentication": authentication, "source": "path-installation" });
            if authentication == "error" {
                probe["authenticationDiagnostic"] =
                    json!("Cursor status probe ended with exit code 139.");
            }
            let readiness = discover_cursor_backend(discovery(probe), None)
                .await
                .unwrap();
            assert_eq!(readiness["status"], status);
            assert_eq!(readiness["code"], code);
            assert_eq!(readiness["selectable"], false);
            if matches!(authentication, "error" | "unknown") {
                assert_eq!(readiness["inspectionFallback"], "runtime-handshake");
            } else {
                assert!(readiness.get("inspectionFallback").is_none());
            }
        }
        for (failure, code) in [
            ("crashed", "AUTHENTICATION_PROBE_CRASHED"),
            ("timed-out", "AUTHENTICATION_PROBE_TIMED_OUT"),
        ] {
            let readiness = discover_cursor_backend(
                discovery(json!({
                    "installation": "detected", "version": "2026.08.1", "authentication": "error",
                    "authenticationFailure": failure, "authenticationDiagnostic": "bounded probe diagnostic",
                    "source": "path-installation",
                })),
                None,
            )
            .await
            .unwrap();
            assert_eq!(readiness["status"], "error");
            assert_eq!(readiness["code"], code);
            assert_eq!(readiness["inspectionFallback"], "runtime-handshake");
        }
    });
}

#[test]
fn uses_agent_acp_with_cursor_login_permissions_questions_and_streaming() {
    run_local(async {
        let connection = CursorConnection::new(Script::default());
        let launches: Rc<RefCell<Vec<ConnectionOptions>>> = Rc::default();
        let events: Events = Rc::default();
        let mut options =
            AcpAdapterOptions::new(readiness(), "/workspace", CURSOR_RUNTIME_DESCRIPTOR.clone());
        options.app_version = "0.3.11".into();
        let (fake, recorded) = (connection.connection.clone(), launches.clone());
        options.connection_factory = Some(Rc::new(move |launch| {
            recorded.borrow_mut().push(launch);
            Ok(fake.clone() as Rc<dyn RpcConnection>)
        }));
        options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
        let sink = events.clone();
        options.on_event = Rc::new(move |event| sink.borrow_mut().push(event));
        let adapter = cursor_acp_adapter(options).unwrap();
        let inspection = adapter.inspect().await.unwrap();
        assert_eq!(launches.borrow()[0].args, ["acp"]);
        assert!(
            connection
                .connection
                .requests
                .borrow()
                .iter()
                .any(|r| r["method"] == "authenticate"
                    && r["params"] == json!({ "methodId": "cursor_login" }))
        );
        let capabilities = &inspection["capabilities"];
        assert_eq!(capabilities["protocol"]["name"], "acp");
        assert_eq!(capabilities["protocol"]["version"], 1);
        assert_eq!(capabilities["manualApprovals"], true);
        assert_eq!(capabilities["structuredQuestions"], true);
        assert_eq!(capabilities["resume"], true);
        for (kind, accepted) in [("image", true), ("text", true), ("binary", true)] {
            assert_eq!(
                capabilities["referenceInputs"]["attachments"][kind]["accepted"],
                accepted
            );
        }
        assert_eq!(capabilities["revision"], "cursor-acp:1:image1:embedded0");
        crate::agent::runtime::agent_runtime_port::assert_agent_runtime_inspection(
            &adapter,
            &inspection,
            "cursor",
        )
        .unwrap();

        adapter
            .create_session(json!({ "mode": "agent" }))
            .await
            .unwrap();
        let staged = tempfile::NamedTempFile::new().unwrap();
        let staged_path = staged.path().to_string_lossy().into_owned();
        let turn = adapter
            .start_turn(json!({
                "prompt": "Fix @cursor-notes.txt",
                "references": [{
                    "kind": "staged-attachment",
                    "path": staged_path,
                    "displayName": "cursor-notes.txt",
                    "mime": "text/plain",
                    "inlineMentioned": true,
                    "mentionDelivery": "resource",
                }],
            }))
            .await
            .unwrap();
        settle().await;
        let prompt = connection
            .connection
            .requests
            .borrow()
            .iter()
            .find(|r| r["method"] == "session/prompt")
            .cloned()
            .unwrap();
        assert_eq!(prompt["timeoutMs"], 0);
        assert_eq!(
            prompt["params"]["prompt"][0],
            json!({ "type": "text", "text": "Fix @cursor-notes.txt" })
        );
        assert_eq!(prompt["params"]["prompt"][1]["type"], "resource_link");
        assert_eq!(
            prompt["params"]["prompt"][1]["uri"],
            path_to_file_url(&staged_path).as_str()
        );
        assert_eq!(prompt["params"]["prompt"][1]["name"], "cursor-notes.txt");
        send_update(
            &connection.connection,
            json!({ "sessionUpdate": "agent_message_chunk", "messageId": "answer", "content": { "type": "text", "text": "Done" } }),
            "cursor-session",
        );
        send_request(
            &connection.connection,
            11,
            "cursor/ask_question",
            json!({
                "toolCallId": "question-tool",
                "title": "Choose mode",
                "questions": [{ "id": "mode", "prompt": "Mode?", "options": [{ "id": "agent", "label": "Agent" }] }],
            }),
        );
        settle().await;
        let question = find(&events, "question.requested").unwrap();
        assert_eq!(question["turnId"], turn["turnId"]);
        adapter
            .resolve_question_now(&json!({
                "requestId": question["payload"]["requestId"],
                "answers": [["agent"]],
                "rejected": false,
                "turnId": turn["turnId"],
            }))
            .unwrap();
        settle().await;
        assert!(
            connection
                .connection
                .responses
                .borrow()
                .iter()
                .any(|r| r["id"] == 11 && r["result"]["outcome"] == "answered")
        );
        connection.finish_prompt(Ok(json!({ "stopReason": "end_turn" })));
        settle().await;
        assert!(find(&events, "turn.completed").is_some());
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn bootstraps_authentication_inspection_and_the_live_session_on_one_acp_connection() {
    run_local(async {
        let connection = CursorConnection::new(Script::default());
        let created: Rc<RefCell<usize>> = Rc::default();
        let mut options =
            AcpAdapterOptions::new(readiness(), "/workspace", CURSOR_RUNTIME_DESCRIPTOR.clone());
        let (fake, count) = (connection.connection.clone(), created.clone());
        options.connection_factory = Some(Rc::new(move |_| {
            *count.borrow_mut() += 1;
            Ok(fake.clone() as Rc<dyn RpcConnection>)
        }));
        options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
        let adapter = cursor_acp_adapter(options).unwrap();
        let result = adapter
            .bootstrap(&json!({ "kind": "create", "mode": "agent" }))
            .await
            .unwrap();
        assert_eq!(*created.borrow(), 1);
        assert_eq!(
            result["inspection"]["account"]["requiresRuntimeSetup"],
            false
        );
        assert_eq!(
            result["providerSession"]["providerSessionId"],
            "cursor-session"
        );
        assert_eq!(result["providerSession"]["mode"], "agent");
        assert_eq!(
            connection.methods(),
            ["initialize", "authenticate", "session/new"]
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn discovers_and_hydrates_native_acp_sessions_only_when_the_runtime_advertises_the_capabilities() {
    run_local(async {
        let connection = CursorConnection::new(Script {
            list: true,
            replay_history: true,
            ..Default::default()
        });
        let events: Events = Rc::default();
        let adapter = adapter(&connection, readiness(), Some(events.clone()), None);
        let page = adapter
            .discover_sessions(Some("opaque".into()), None)
            .await
            .unwrap();
        assert_eq!(page["supported"], true);
        assert_eq!(
            page["coverage"],
            json!({ "scopeComplete": false, "snapshotId": null })
        );
        assert_eq!(page["nextCursor"], Value::Null);
        assert_eq!(page["sessions"][0]["providerSessionId"], "cursor-history");
        assert_eq!(page["sessions"][0]["title"], "Fix tabs");
        adapter
            .resume_session(json!({ "threadId": "cursor-history" }))
            .await
            .unwrap();
        settle().await;
        let history = adapter.read_history();
        assert!(history.iter().any(|e| e["type"] == "turn.started"
            && e["payload"]
                == json!({ "prompt": "Fix tabs", "restored": true, "userMessageId": "user-1" })));
        assert!(history.iter().any(
            |e| e["type"] == "assistant.completed" && e["payload"] == json!({ "text": "Done" })
        ));
        let search = history
            .iter()
            .find(|e| e["type"] == "tool.completed" && e["itemId"] == "search-history")
            .unwrap();
        assert_eq!(search["payload"]["kind"], "search");
        assert_eq!(search["payload"]["input"], json!({ "query": "tabs" }));
        assert_eq!(search["payload"]["outputPreview"], "2 matches");
        assert!(!connection.methods().contains(&"session/prompt".to_string()));
        assert!(find(&events, "approval.requested").is_none());
        assert!(
            connection.connection.responses.borrow().contains(
                &json!({ "id": 91, "result": { "outcome": { "outcome": "cancelled" } } })
            )
        );
        let errors = connection.connection.errors.borrow().clone();
        assert!(errors.iter().any(|e| {
            e["id"] == 92
                && e["code"] == -32603
                && e["message"]
                    .as_str()
                    .unwrap()
                    .contains("history is loading")
        }));
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn classifies_a_stale_cursor_acp_locator_as_unavailable() {
    run_local(async {
        let connection = CursorConnection::new(Script {
            invalid_load: true,
            ..Default::default()
        });
        let adapter = adapter(&connection, readiness(), None, None);
        let error = adapter
            .resume_session(json!({ "threadId": "cursor-stale" }))
            .await
            .unwrap_err();
        assert_eq!(
            error.code.as_deref(),
            Some("AGENT_PROVIDER_SESSION_UNAVAILABLE")
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn uses_acp_session_resume_when_an_agent_can_reconnect_but_cannot_replay_history() {
    run_local(async {
        let connection = CursorConnection::new(Script {
            no_load_session: true,
            ..Default::default()
        });
        let adapter = adapter(&connection, readiness(), None, None);
        adapter
            .resume_session(json!({ "threadId": "cursor-history" }))
            .await
            .unwrap();
        assert!(connection.methods().contains(&"session/resume".to_string()));
        assert!(!connection.methods().contains(&"session/load".to_string()));
        assert!(adapter.read_history().is_empty());
        adapter.dispose().await.unwrap();
    });
}

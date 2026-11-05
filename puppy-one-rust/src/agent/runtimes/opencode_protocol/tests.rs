//! `tests/unit/agent/runtimes/opencode/electron.opencode-adapter.test.mjs`
//! and `electron.opencode-events.test.mjs`.
use super::opencode_acp_adapter::{build_prompt_blocks, open_code_acp_adapter};
use crate::agent::agent_error::AgentResult;
use crate::agent::application::tests_support::run_local;
use crate::agent::protocols::acp::acp_event_normalizer::AcpEventNormalizer;
use crate::agent::protocols::acp::acp_prompt_input::AcpReferenceProfile;
use crate::agent::protocols::acp::acp_runtime_adapter::AcpAdapterOptions;
use crate::agent::protocols::acp::acp_session_config::{
    resolve_acp_efforts, resolve_acp_models, resolve_acp_modes, resolve_requested_acp_effort,
    resolve_requested_acp_mode,
};
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::transports::jsonl_rpc_connection::{ConnectionEvent, ConnectionOptions};
use crate::agent::transports::rpc_connection::RpcConnection;
use crate::agent::transports::rpc_connection::fake::FakeConnection;
use base64::Engine;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::{Rc, Weak};
use tokio::sync::oneshot;

fn notification(update: Value) -> Value {
    json!({ "sessionId": "session-1", "update": update })
}

fn select(id: &str, category: &str, current: &str, options: Value) -> Value {
    json!({ "id": id, "category": category, "type": "select", "currentValue": current, "options": options })
}

#[test]
fn streams_assistant_text_working_state_tools_diffs_plans_and_usage() {
    let mut normalizer = AcpEventNormalizer::new(Some("opencode:turn-1"));
    let assistant = normalizer.normalize(&notification(json!({
        "sessionUpdate": "agent_message_chunk", "messageId": "message-1", "content": { "type": "text", "text": "Hello " },
    })));
    let thought = normalizer.normalize(&notification(json!({
        "sessionUpdate": "agent_thought_chunk", "messageId": "thought-1", "content": { "type": "text", "text": "Checking files" },
    })));
    let started = normalizer.normalize(&notification(json!({
        "sessionUpdate": "tool_call", "toolCallId": "tool-1", "kind": "execute", "title": "Run tests",
        "status": "in_progress", "rawInput": { "command": "npm test", "token": "secret" },
    })));
    let completed = normalizer.normalize(&notification(json!({
        "sessionUpdate": "tool_call_update", "toolCallId": "tool-1", "kind": "execute", "status": "completed",
        "content": [
            { "type": "content", "content": { "type": "text", "text": "passed" } },
            { "type": "diff", "path": "src/app.ts" },
        ],
    })));
    let plan = normalizer.normalize(&notification(json!({
        "sessionUpdate": "plan", "entries": [{ "content": "Run tests", "status": "completed", "priority": "high" }],
    })));
    let usage = normalizer.normalize(&notification(
        json!({ "sessionUpdate": "usage_update", "size": 128_000, "used": 4_096 }),
    ));
    normalizer.normalize(&notification(json!({
        "sessionUpdate": "agent_message_chunk", "messageId": "message-1", "content": { "type": "text", "text": "world" },
    })));
    assert_eq!(assistant.len(), 1);
    assert_eq!(assistant[0]["type"], "assistant.delta");
    assert_eq!(assistant[0]["payload"], json!({ "delta": "Hello " }));
    assert_eq!(thought.len(), 1);
    assert_eq!(
        thought[0]["payload"],
        json!({ "delta": "", "boundary": true, "status": "working" })
    );
    assert!(!json!(thought).to_string().contains("Checking files"));
    assert_eq!(started.len(), 1);
    assert_eq!(started[0]["type"], "tool.started");
    assert_eq!(started[0]["payload"]["kind"], "command");
    assert_eq!(started[0]["payload"]["command"], "npm test");
    assert!(!json!(started).to_string().contains("secret"));
    let kinds: Vec<&str> = completed
        .iter()
        .map(|e| e["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "command.output.delta",
            "file.change.updated",
            "tool.completed"
        ]
    );
    assert_eq!(plan[0]["type"], "plan.updated");
    assert_eq!(
        plan[0]["payload"]["steps"],
        json!([{ "step": "Run tests", "status": "completed", "priority": "high" }])
    );
    assert_eq!(usage[0]["type"], "usage.updated");
    assert_eq!(
        usage[0]["payload"]["contextWindow"],
        json!({ "size": 128_000, "used": 4_096 })
    );
    let completions = normalizer.complete_assistant(Some("session-1"));
    assert_eq!(completions.len(), 1);
    assert_eq!(completions[0]["payload"], json!({ "text": "Hello world" }));
}

#[test]
fn derives_stable_read_write_edit_grep_and_glob_semantics_from_acp_tool_metadata() {
    let mut normalizer = AcpEventNormalizer::new(Some("opencode:turn-tools"));
    let cases = [
        (
            "read",
            "read",
            "Read file",
            json!({ "filePath": "src/read.ts" }),
            "read",
        ),
        (
            "write",
            "edit",
            "Write file",
            json!({ "filePath": "src/write.ts", "content": "hello" }),
            "write",
        ),
        (
            "edit",
            "edit",
            "Edit file",
            json!({ "filePath": "src/edit.ts", "oldString": "old", "newString": "new" }),
            "edit",
        ),
        (
            "grep",
            "search",
            "Grep",
            json!({ "pattern": "needle", "path": "src" }),
            "grep",
        ),
        (
            "glob",
            "search",
            "Glob",
            json!({ "pattern": "**/*.ts", "path": "src" }),
            "glob",
        ),
    ];
    let events: Vec<Value> = cases
        .iter()
        .flat_map(|(id, kind, title, input, _)| {
            normalizer.normalize(&notification(json!({
                "sessionUpdate": "tool_call", "toolCallId": id, "status": "in_progress",
                "kind": kind, "title": title, "rawInput": input,
            })))
        })
        .collect();
    let tools: Vec<&str> = events
        .iter()
        .map(|e| e["payload"]["tool"].as_str().unwrap())
        .collect();
    assert_eq!(tools, cases.iter().map(|c| c.4).collect::<Vec<_>>());
    assert_eq!(events[0]["payload"]["path"], "src/read.ts");
    assert_eq!(
        events[0]["payload"]["input"],
        json!({ "filePath": "src/read.ts" })
    );
    assert_eq!(events[3]["payload"]["kind"], "search");
    assert_eq!(events[3]["payload"]["input"]["pattern"], "needle");
}

fn session_config() -> Vec<Value> {
    vec![
        select(
            "model",
            "model",
            "openai/gpt-5",
            json!([{ "value": "openai/gpt-5", "name": "GPT-5" }, { "value": "openai/gpt-4.1", "name": "GPT-4.1" }]),
        ),
        select(
            "mode",
            "mode",
            "build",
            json!([{ "value": "build", "name": "Build" }, { "value": "plan", "name": "Plan" }]),
        ),
        select(
            "thought",
            "thought_level",
            "high",
            json!([{ "value": "low" }, { "value": "high" }]),
        ),
    ]
}

#[test]
fn derives_model_mode_and_effort_selection_from_acp_config_options() {
    let config_options = vec![
        select(
            "model",
            "model",
            "openai/gpt-5",
            json!([{ "value": "openai/gpt-5", "name": "GPT-5" }, { "value": "anthropic/claude", "name": "Claude" }]),
        ),
        select(
            "mode",
            "mode",
            "build",
            json!([{ "value": "build", "name": "Build" }, { "value": "plan", "name": "Plan" }]),
        ),
        select(
            "thought",
            "thought_level",
            "high",
            json!([{ "value": "low" }, { "value": "high" }]),
        ),
    ];
    let models = resolve_acp_models(&config_options, None);
    assert_eq!(
        (models.config_id.as_deref(), models.current_id.as_deref()),
        (Some("model"), Some("openai/gpt-5"))
    );
    let modes = resolve_acp_modes(&config_options, None);
    assert_eq!(
        (modes.config_id.as_deref(), modes.current_id.as_deref()),
        (Some("mode"), Some("build"))
    );
    let efforts = resolve_acp_efforts(&config_options);
    assert_eq!(
        (efforts.config_id.as_deref(), efforts.current_id.as_deref()),
        (Some("thought"), Some("high"))
    );
    assert_eq!(
        resolve_requested_acp_mode(Some(&json!("plan")), &modes).as_deref(),
        Some("plan")
    );
    assert_eq!(
        resolve_requested_acp_effort(Some(&json!("low")), &efforts).as_deref(),
        Some("low")
    );
    assert_eq!(
        resolve_requested_acp_effort(Some(&json!("unsupported")), &efforts),
        None
    );
}

#[test]
fn maps_probed_image_snapshots_and_workspace_resources_to_exact_acp_prompt_blocks() {
    let image = base64::engine::general_purpose::STANDARD.encode("image-bytes");
    let profile = AcpReferenceProfile {
        image: true,
        embedded_text: false,
    };
    assert_eq!(
        build_prompt_blocks(
            "Inspect",
            Some(""),
            &[
                json!({ "kind": "workspace-entry", "path": "/workspace/src/app.ts", "name": "app.ts" }),
                json!({ "kind": "staged-attachment", "mime": "image/png", "snapshotUrl": format!("data:image/png;base64,{image}") }),
            ],
            "/workspace",
            profile,
        )
        .unwrap(),
        [
            json!({ "type": "text", "text": "Inspect" }),
            json!({ "type": "resource_link", "uri": "file:///workspace/src/app.ts", "name": "app.ts", "title": "app.ts" }),
            json!({ "type": "image", "data": image, "mimeType": "image/png" }),
        ]
    );
    let mismatch = build_prompt_blocks(
        "Inspect",
        Some(""),
        &[json!({ "kind": "staged-attachment", "mime": "image/png", "snapshotUrl": "data:image/jpeg;base64,aQ==" })],
        "/workspace",
        profile,
    )
    .unwrap_err();
    assert!(
        regex::Regex::new(r"(?i)materialize.*staged image")
            .unwrap()
            .is_match(&mismatch.message)
    );
    let outside = build_prompt_blocks(
        "Inspect",
        Some(""),
        &[json!({ "kind": "workspace-entry", "path": "/outside/secret.txt" })],
        "/workspace",
        AcpReferenceProfile::default(),
    )
    .unwrap_err();
    assert!(
        outside
            .message
            .to_lowercase()
            .contains("invalid workspace reference")
    );
}

type PromptReply = Rc<RefCell<Option<oneshot::Sender<AgentResult<Value>>>>>;

struct Launch {
    options: ConnectionOptions,
    connection: Rc<FakeConnection>,
    prompt: PromptReply,
}

fn update_config(config_id: &str, value: &Value) -> Vec<Value> {
    session_config()
        .into_iter()
        .map(|mut entry| {
            if entry["id"] == config_id {
                entry["currentValue"] = value.clone();
            }
            entry
        })
        .collect()
}

fn open_code_connection(options: ConnectionOptions) -> Launch {
    let connection = FakeConnection::new();
    connection.result(
        "initialize",
        json!({
            "agentInfo": { "name": "OpenCode", "version": "1.17.18" },
            "agentCapabilities": { "loadSession": true, "promptCapabilities": { "image": true, "embeddedContext": true } },
        }),
    );
    let weak: Weak<FakeConnection> = Rc::downgrade(&connection);
    for method in ["session/new", "session/load"] {
        let weak = weak.clone();
        connection.answer(method, move |_| {
            let weak = weak.clone();
            Box::pin(async move {
                if let Some(connection) = weak.upgrade() {
                    connection.emit(ConnectionEvent::Notification(json!({
                        "method": "session/update",
                        "params": { "sessionId": "session-1", "update": {
                            "sessionUpdate": "available_commands_update",
                            "availableCommands": [{ "name": "/review", "description": "Review changes", "input": { "hint": "[path]" } }],
                        } },
                    })));
                }
                Ok(json!({ "sessionId": "session-1", "configOptions": session_config() }))
            })
        });
    }
    connection.answer("session/set_config_option", |params| {
        let configured = update_config(params["configId"].as_str().unwrap_or(""), &params["value"]);
        Box::pin(async move { Ok(json!({ "configOptions": configured })) })
    });
    connection.result("session/set_mode", json!({}));
    let prompt: PromptReply = Rc::default();
    let pending = prompt.clone();
    connection.answer("session/prompt", move |_| {
        let (reply, receipt) = oneshot::channel();
        *pending.borrow_mut() = Some(reply);
        Box::pin(async move { receipt.await.unwrap_or_else(|_| Ok(json!({}))) })
    });
    Launch {
        options,
        connection,
        prompt,
    }
}

async fn settle() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}

#[test]
fn uses_one_native_acp_session_for_model_selection_streaming_approvals_and_follow_up_turns() {
    run_local(async {
        let launches: Rc<RefCell<Vec<Launch>>> = Rc::default();
        let events: Rc<RefCell<Vec<Value>>> = Rc::default();
        let mut options = AcpAdapterOptions::new(
            json!({
                "status": "ready",
                "executablePath": "/tools/opencode",
                "environment": { "PATH": "/usr/bin", "HOME": "/home/test" },
                "version": "1.17.18",
                "source": "user-installed",
            }),
            "/workspace",
            json!({ "id": "opencode-native", "displayName": "OpenCode", "kind": "native-cli" }),
        );
        options.app_version = "1.2.3".into();
        let recorded = launches.clone();
        options.connection_factory = Some(Rc::new(move |launch| {
            let launch = open_code_connection(launch);
            let connection = launch.connection.clone();
            recorded.borrow_mut().push(launch);
            Ok(connection as Rc<dyn RpcConnection>)
        }));
        options.project_instruction_loader = Some(Rc::new(|_| {
            Ok(Some(
                json!({ "source": "AGENTS.md", "text": "Keep tests green.", "bytes": 17 }),
            ))
        }));
        let sink = events.clone();
        options.on_event = Rc::new(move |event| sink.borrow_mut().push(event));
        let adapter = open_code_acp_adapter(options).unwrap();

        let inspection = adapter.inspect().await.unwrap();
        assert_eq!(inspection["account"]["requiresRuntimeSetup"], false);
        assert_eq!(
            inspection["providers"],
            json!([{ "id": "openai", "displayName": "Openai", "source": "native", "defaultModel": "openai/gpt-5", "modelCount": 2 }])
        );
        assert!(
            inspection["modes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["id"] == "build" && m["isDefault"] == true)
        );
        let capabilities = &inspection["capabilities"];
        assert_eq!(capabilities["streamingText"], true);
        assert_eq!(capabilities["manualApprovals"], true);
        assert_eq!(capabilities["sessionHistory"], true);
        assert_eq!(
            capabilities["history"],
            json!({ "discovery": "unsupported", "exactOpen": "supported", "hydration": "push-replay" })
        );
        for kind in ["image", "text", "binary"] {
            assert_eq!(
                capabilities["referenceInputs"]["attachments"][kind]["accepted"],
                true
            );
        }
        assert_eq!(
            capabilities["revision"],
            "opencode-native-acp:1:image1:embedded1"
        );
        let models: Vec<&str> = inspection["models"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["model"].as_str().unwrap())
            .collect();
        assert_eq!(models, ["openai/gpt-5", "openai/gpt-4.1"]);
        assert_eq!(inspection["commands"][0]["name"], "review");
        {
            let launches = launches.borrow();
            let env = launches[0].options.env.clone().unwrap();
            assert!(env.contains(&("OPENCODE_DB".to_string(), ":memory:".to_string())));
            assert!(!launches[0].connection.disposals.borrow().is_empty());
        }

        let session = adapter
            .create_session(json!({ "model": "openai/gpt-5", "effort": "low", "mode": "build" }))
            .await
            .unwrap();
        for (key, value) in [
            ("providerSessionId", "session-1"),
            ("model", "openai/gpt-5"),
            ("effort", "low"),
            ("mode", "build"),
        ] {
            assert_eq!(session[key], value, "{key}");
        }
        let runtime = launches.borrow()[1].connection.clone();
        assert!(runtime.requests.borrow().contains(&json!({
            "method": "session/set_config_option",
            "params": { "configId": "thought", "sessionId": "session-1", "type": "select", "value": "low" },
            "timeoutMs": 30_000,
        })));
        let turn = adapter
            .start_turn(json!({
                "prompt": "Fix it",
                "model": "openai/gpt-5",
                "effort": "low",
                "mode": "build",
                "contextReferences": [{ "path": "/workspace/src/app.ts", "name": "app.ts" }],
            }))
            .await
            .unwrap();
        settle().await;
        let prompt = runtime.requests_of("session/prompt")[0].clone();
        assert_eq!(prompt["sessionId"], "session-1");
        assert!(
            prompt["prompt"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Keep tests green")
        );
        assert_eq!(prompt["prompt"][1]["type"], "resource_link");
        assert_eq!(prompt["prompt"][1]["name"], "app.ts");
        let send = |update: Value| {
            runtime.emit(ConnectionEvent::Notification(json!({
                "method": "session/update",
                "params": { "sessionId": "session-1", "update": update },
            })));
        };
        send(
            json!({ "sessionUpdate": "agent_thought_chunk", "messageId": "thought-1", "content": { "type": "text", "text": "Inspecting" } }),
        );
        send(
            json!({ "sessionUpdate": "agent_message_chunk", "messageId": "answer-1", "content": { "type": "text", "text": "Done" } }),
        );
        runtime.emit(ConnectionEvent::Request(json!({
            "id": 10,
            "method": "session/request_permission",
            "params": {
                "sessionId": "session-1",
                "toolCall": { "toolCallId": "tool-1", "kind": "execute", "title": "Run tests", "rawInput": { "command": "npm test" } },
                "options": [
                    { "optionId": "once", "kind": "allow_once", "name": "Allow once" },
                    { "optionId": "always", "kind": "allow_always", "name": "Allow for session" },
                    { "optionId": "reject", "kind": "reject_once", "name": "Reject" },
                ],
            },
        })));
        settle().await;
        let approval = events
            .borrow()
            .iter()
            .find(|e| e["type"] == "approval.requested")
            .cloned()
            .unwrap();
        assert_eq!(approval["turnId"], turn["turnId"]);
        assert_eq!(approval["payload"]["command"], "npm test");
        adapter
            .resolve_approval_now(&json!({
                "requestId": approval["payload"]["requestId"],
                "decision": "acceptForSession",
                "turnId": turn["turnId"],
            }))
            .unwrap();
        settle().await;
        assert!(runtime
            .responses
            .borrow()
            .contains(&json!({ "id": 10, "result": { "outcome": { "outcome": "selected", "optionId": "always" } } })));
        let finish = |value: Value| {
            let launches = launches.borrow();
            let reply = launches[1].prompt.borrow_mut().take().unwrap();
            let _ = reply.send(Ok(value));
        };
        finish(
            json!({ "stopReason": "end_turn", "usage": { "inputTokens": 10, "outputTokens": 4, "totalTokens": 14 } }),
        );
        settle().await;
        let kinds: Vec<String> = events
            .borrow()
            .iter()
            .map(|e| e["type"].as_str().unwrap().to_string())
            .collect();
        for kind in [
            "reasoning.summary.delta",
            "assistant.delta",
            "assistant.completed",
            "approval.requested",
            "usage.updated",
            "turn.completed",
        ] {
            assert!(kinds.contains(&kind.to_string()), "{kind}");
        }

        adapter
            .start_turn(json!({ "prompt": "Follow up", "model": "openai/gpt-5", "effort": "low", "mode": "build" }))
            .await
            .unwrap();
        settle().await;
        assert_eq!(launches.borrow().len(), 2);
        assert_eq!(runtime.requests_of("session/new").len(), 1);
        assert!(adapter.read_history().is_empty());
        finish(json!({ "stopReason": "end_turn" }));
        settle().await;
        adapter.dispose().await.unwrap();
    });
}

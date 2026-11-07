//! `tests/unit/agent/sessions/desktop-agent.controller.test.ts`.
//!
//! Not yet ported: "retries the owned conversation through Main without
//! allocating another host" drives the item-host process service
//! (`agent-process-service.mjs`), which lands with that layer.
use super::display_fixture::{DisplayFeed, display_snapshot};
use super::fake_client::FakeClient;
use super::session_feed::{advance, settle, wait_for};
use super::support::{Deferred, Deferreds, StateJson as _, assert_match, j, matches, typed};
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests::harness::{run, run_paused};
use crate::clock;
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, AgentFile, AgentFileSource,
};
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentSessionPreparation, StopRequestStatus,
};
use crate::features::desktop_agent::application::agent_reference_preview_store::object_url_bytes;
use crate::features::desktop_agent::application::agent_runtime_discovery_cache::AGENT_RUNTIME_DISCOVERY_CACHE_TTL_MS;
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::application::agent_session_lifecycle::CloseOutcome;
use crate::features::desktop_agent::application::ui_runtime::TokioUiRuntime;
use serde_json::{Value, json};
use std::cell::Cell;
use std::rc::Rc;

const ROOT: &str = "/workspace";

struct Fixture {
    bridge: Rc<FakeClient>,
    feed: Rc<DisplayFeed>,
}

impl Fixture {
    fn controller(&self) -> AgentSessionController {
        let port: Rc<dyn AgentClientPort> = self.bridge.clone();
        AgentSessionController::new(
            ROOT,
            Rc::new(move || Some(port.clone())),
            TokioUiRuntime::create(),
        )
    }

    fn emit(&self, event: Value) {
        self.feed.emit(event);
    }
}

fn state(controller: &AgentSessionController) -> Value {
    controller.get_snapshot().to_value()
}

fn message_texts(controller: &AgentSessionController) -> Vec<Value> {
    controller.store().read(|state| {
        state
            .projection
            .messages
            .iter()
            .map(|message| Value::from(message.text.as_str()))
            .collect()
    })
}

fn png(name: &str) -> AgentFile {
    AgentFile {
        name: name.into(),
        mime: "image/png".into(),
        size: 3.,
        source: AgentFileSource::Bytes(Rc::new(b"png".to_vec())),
    }
}

/// `bridgeFixture(onEvent, capabilityOverrides)`.
fn bridge_fixture(overrides: Value) -> Fixture {
    let bridge = FakeClient::new();
    let caps = capabilities(&overrides);
    bridge.resolve(
        "discoverAgentRuntimes",
        json!({
            "runtimes": [{ "descriptor": { "id": "opencode", "displayName": "OpenCode", "priority": 100 }, "readiness": readiness() }],
            "selectedRuntimeId": "opencode",
            "runtime": { "id": "opencode", "displayName": "OpenCode" },
            "readiness": readiness(),
            "account": { "account": { "type": "opencode", "email": null, "planType": null }, "requiresOpenaiAuth": false },
            "providers": [{ "id": "openai", "displayName": "OpenAI", "defaultModel": "openai/gpt-5", "modelCount": 1 }],
            "models": [gpt5()],
            "modes": [{ "id": "build", "displayName": "Build", "description": "", "isDefault": true }],
            "commands": [],
            "capabilities": caps,
            "warnings": [],
        }),
    );
    bridge.resolve(
        "discoverLocalAgentConnections",
        json!({ "connections": [], "scannedAt": "2026-07-12T00:00:00.000Z", "warnings": [] }),
    );
    let resumed = snapshot(
        "session-1",
        vec![event(
            1,
            "session.resumed",
            json!({ "title": "Session" }),
            None,
            None,
            "session-1",
        )],
        &overrides,
    );
    bridge.resolve("resumeAgentSession", resumed.clone());
    bridge.resolve(
        "openAgentSession",
        json!({ "status": "opened", "snapshot": resumed }),
    );
    bridge.resolve(
        "createAgentSession",
        snapshot(
            "session-2",
            vec![event(
                1,
                "session.started",
                json!({ "title": "New" }),
                None,
                None,
                "session-2",
            )],
            &overrides,
        ),
    );
    bridge.resolve(
        "startAgentTurn",
        json!({ "sessionId": "session-1", "turnId": "turn-next" }),
    );
    bridge.resolve(
        "replayAgentSession",
        snapshot(
            "session-1",
            vec![event(
                4,
                "assistant.completed",
                json!({ "text": "Working" }),
                Some("turn-1"),
                Some("message-1"),
                "session-1",
            )],
            &overrides,
        ),
    );
    bridge.resolve(
        "closeAgentSession",
        json!({ "sessionId": "session-1", "closed": true }),
    );
    bridge.resolve(
        "stageAgentAttachments",
        json!([{ "id": "stage-reference", "kind": "staged-attachment", "token": "stage-token", "displayName": "capture.png", "mime": "image/png", "size": 3, "status": "ready" }]),
    );
    bridge.handle("revokeAgentAttachments", |request| {
        let revoked = request["tokens"].as_array().map_or(0, Vec::len);
        Box::pin(async move { Ok(json!({ "revoked": revoked })) })
    });
    bridge.handle("resolveAgentWorkspaceReferences", |request| {
        let references: Vec<Value> = request["paths"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .enumerate()
            .map(|(index, path)| {
                let path = path.as_str().unwrap_or_default();
                let slug: String = path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
                json!({
                    "id": format!("workspace-{index}-{slug}"),
                    "kind": "workspace-entry",
                    "entryType": if path == "src" { "directory" } else { "file" },
                    "relativePath": path,
                    "displayName": path.split('/').next_back().filter(|n| !n.is_empty()).unwrap_or(path),
                    "mime": "text/markdown",
                    "size": 4,
                    "status": "ready",
                })
            })
            .collect();
        Box::pin(async move { Ok(Value::Array(references)) })
    });
    bridge.resolve("pickAgentWorkspaceReferences", json!([]));
    bridge.resolve(
        "steerAgentTurn",
        json!({ "sessionId": "session-1", "turnId": "turn-running", "steered": true }),
    );
    bridge.resolve(
        "listAgentSessions",
        json!({
            "sessions": [],
            "discovery": { "runtimeId": null, "status": "not-requested", "nextCursor": null, "scanId": null, "indexed": 0, "warnings": [] },
            "warnings": [],
        }),
    );
    let feed = DisplayFeed::install(&bridge);
    Fixture { bridge, feed }
}

fn gpt5() -> Value {
    json!({ "id": "openai/gpt-5", "model": "openai/gpt-5", "providerId": "openai", "displayName": "GPT-5", "description": "OpenAI · GPT-5", "isDefault": true })
}

fn snapshot(session_id: &str, events: Vec<Value>, overrides: &Value) -> Value {
    let last = events.last().map_or(json!(0), |e| e["sequence"].clone());
    let first = events.first().map_or(json!(1), |e| e["sequence"].clone());
    display_snapshot(&json!({
        "session": {
            "id": session_id,
            "runtimeId": "opencode",
            "runtime": { "id": "opencode", "displayName": "OpenCode" },
            "provider": "opencode",
            "providerSessionId": format!("native-{session_id}"),
            "workspaceRoot": ROOT,
            "title": "Session",
            "createdAt": "2026-07-11T00:00:00.000Z",
            "updatedAt": "2026-07-11T00:00:00.000Z",
            "terminalState": "idle",
            "selectedModel": "openai/gpt-5",
            "selectedMode": "build",
            "activeTurnId": null,
            "lastSequence": last,
        },
        "account": { "account": { "type": "opencode", "email": null, "planType": null }, "requiresOpenaiAuth": false },
        "providers": [{ "id": "openai", "displayName": "OpenAI", "defaultModel": "openai/gpt-5", "modelCount": 1 }],
        "models": [gpt5()],
        "modes": [{ "id": "build", "displayName": "Build", "description": "", "isDefault": true }],
        "commands": [],
        "capabilities": capabilities(overrides),
        "events": events,
        "partial": false,
        "firstAvailableSequence": first,
        "lastSequence": last,
    }))
}

fn readiness() -> Value {
    json!({ "runtimeId": "opencode", "provider": "opencode", "status": "ready", "code": "READY", "version": "1.17.18", "minimumVersion": "1.17.18", "message": "ready" })
}

fn readiness_for(runtime_id: &str) -> Value {
    json!({ "runtimeId": runtime_id, "provider": runtime_id, "status": "ready", "code": "READY", "version": "1.0.0", "minimumVersion": null, "message": "ready", "selectable": true })
}

fn runtime_inspection(runtimes: &Value, runtime_id: &str, model: &Value) -> Value {
    let runtime = runtimes
        .as_array()
        .and_then(|r| {
            r.iter()
                .find(|entry| entry["descriptor"]["id"] == runtime_id)
        })
        .map(|entry| entry["descriptor"].clone())
        .unwrap_or(Value::Null);
    json!({
        "runtimes": runtimes, "selectedRuntimeId": runtime_id, "runtime": runtime, "readiness": readiness_for(runtime_id),
        "account": null, "providers": [], "models": [model], "modes": [], "commands": [], "capabilities": capabilities(&json!({})),
        "warnings": [],
    })
}

fn runtime_snapshot(
    session_id: &str,
    runtime_id: &str,
    display_name: &str,
    model: &Value,
) -> Value {
    let mut base = snapshot(session_id, Vec::new(), &json!({}));
    let runtime = json!({ "id": runtime_id, "displayName": display_name });
    base["session"]["runtimeId"] = json!(runtime_id);
    base["session"]["runtime"] = runtime.clone();
    base["session"]["provider"] = json!(runtime_id);
    base["session"]["selectedModel"] = model["model"].clone();
    base["runtime"] = runtime;
    base["account"] = Value::Null;
    base["providers"] = json!([]);
    base["models"] = json!([model]);
    base["modes"] = json!([]);
    base
}

fn capabilities(overrides: &Value) -> Value {
    let mut capabilities = json!({
        "streamingText": true, "structuredToolEvents": true, "commandOutputStreaming": true, "fileChangeEvents": true,
        "manualApprovals": true, "structuredQuestions": true, "resume": true, "fork": true, "steer": false, "queue": false,
        "attachments": true, "contextReferences": true, "modelSelection": true, "modeSelection": true, "slashCommands": true,
        "sessionHistory": true, "usage": true, "accountState": true, "mcp": true, "skills": true, "compaction": true,
        "referenceInputs": reference_capabilities(),
    });
    if let Some(overrides) = overrides.as_object() {
        for (key, value) in overrides {
            capabilities[key] = value.clone();
        }
    }
    capabilities
}

fn reference_capabilities() -> Value {
    json!({
        "schemaVersion": 1,
        "workspace": { "files": true, "directories": true },
        "attachments": {
            "image": { "accepted": true, "mimeTypes": ["image/png"] },
            "text": { "accepted": false }, "audio": { "accepted": false }, "video": { "accepted": false }, "binary": { "accepted": false },
        },
        "limits": { "maxCount": 32, "maxBytesPerReference": 26_214_400, "maxTotalBytes": 26_214_400 },
        "steer": false,
        "attachmentOnly": false,
    })
}

fn reference_capabilities_with(overrides: Value) -> Value {
    let mut capabilities = reference_capabilities();
    for (key, value) in overrides.as_object().cloned().unwrap_or_default() {
        capabilities[key] = value;
    }
    capabilities
}

fn event(
    sequence: i64,
    kind: &str,
    payload: Value,
    turn_id: Option<&str>,
    item_id: Option<&str>,
    session_id: &str,
) -> Value {
    json!({
        "schemaVersion": 1, "sequence": sequence, "sessionId": session_id, "runtimeId": "opencode", "provider": "opencode",
        "providerSessionId": "native-1", "turnId": turn_id, "itemId": item_id, "emittedAt": clock::iso_string(sequence * 1_000),
        "type": kind, "payload": payload,
    })
}

fn turn_started(sequence: i64, prompt: &str, turn_id: &str) -> Value {
    event(
        sequence,
        "turn.started",
        json!({ "prompt": prompt }),
        Some(turn_id),
        None,
        "session-1",
    )
}

async fn submit(controller: &AgentSessionController, prompt: &str) -> bool {
    controller.submit(prompt).await.expect("submit")
}

#[test]
fn preparation_failure_releases_submission_state_and_allows_retry() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once("resumeAgentSession", Value::Null);
        f.bridge
            .reject_once("createAgentSession", AgentError::new("cannot create"));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller.set_draft("retry this message");
        assert!(!submit(&controller, "retry this message").await);
        assert_eq!(controller.get_snapshot().draft, "retry this message");
        assert!(!controller.get_snapshot().submitting);
        assert!(submit(&controller, "retry this message").await);
        controller.dispose(false);
    });
}

#[test]
fn reports_an_unavailable_owned_conversation_without_creating_another() {
    run(async {
        let f = bridge_fixture(json!({}));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.bridge.resolve_once("resumeAgentSession", Value::Null);
        controller.initialize(true).await.expect("initialize");
        let state = controller.get_snapshot();
        assert_eq!(state.session_preparation, AgentSessionPreparation::Failed);
        assert!(state.error.is_some());
        assert_eq!(f.bridge.count("createAgentSession"), 0);
        controller.dispose(false);
    });
}

#[test]
fn steer_receipt_must_preserve_a_newer_draft() {
    run(async {
        let f = bridge_fixture(json!({ "steer": true }));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Running", "turn-running"));
        assert_eq!(
            controller.get_snapshot().running_turn_id(),
            Some("turn-running")
        );
        let steer = Deferred::new();
        f.bridge.handle_once("steerAgentTurn", steer.handler());
        controller.set_draft("first instruction");
        let pending = controller.submit("first instruction");
        wait_for(|| f.bridge.count("steerAgentTurn") == 1).await;
        controller.set_draft("newer unsent draft");
        steer.resolve(json!({ "steered": true }));
        pending.await.expect("submit");
        assert_eq!(controller.get_snapshot().draft, "newer unsent draft");
        controller.dispose(false);
    });
}

#[test]
fn repeated_send_while_the_same_steer_is_pending_has_one_dispatch() {
    run(async {
        let f = bridge_fixture(json!({ "steer": true }));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Running", "turn-running"));
        let receipts = Deferreds::default();
        f.bridge.handle("steerAgentTurn", receipts.handler());
        controller.set_draft("single instruction");
        let first = controller.submit("single instruction");
        let second = controller.submit("single instruction");
        for receipt in receipts.all() {
            receipt
                .resolve(json!({ "sessionId": "session-1", "turnId": "turn-1", "steered": true }));
        }
        let _ = futures_util::future::join(first, second).await;
        assert_eq!(f.bridge.count("steerAgentTurn"), 1);
        controller.dispose(false);
    });
}

#[test]
fn recovers_the_bound_model_after_a_temporary_empty_catalog() {
    run(async {
        let f = bridge_fixture(json!({ "modelConnections": true }));
        let available = f.bridge.implementation("discoverAgentRuntimes")(json!({}))
            .await
            .expect("inspection");
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller.set_draft("Keep this draft through the wallet refresh");
        let session = controller.get_snapshot().session;
        f.bridge.clear("resumeAgentSession");
        let mut empty = available.clone();
        empty["models"] = json!([]);
        f.bridge.resolve_once("discoverAgentRuntimes", empty);
        controller.refresh_model_connections().await;
        let state = controller.get_snapshot();
        assert_eq!(
            state.inspection.as_ref().map(|i| j(&i.models)),
            Some(json!([]))
        );
        assert_eq!(state.selected_model.as_deref(), Some("openai/gpt-5"));
        let mut added = available["models"][0].clone();
        added["id"] = json!("openai/new-model");
        added["model"] = json!("openai/new-model");
        let mut extended = available.clone();
        extended["models"] = json!([available["models"][0], added]);
        f.bridge.resolve_once("discoverAgentRuntimes", extended);
        controller.refresh_model_connections().await;
        let state = controller.get_snapshot();
        assert_eq!(
            state.inspection.as_ref().map(|i| j(&i.models)),
            Some(available["models"].clone())
        );
        assert_eq!(state.session, session);
        assert_eq!(state.draft, "Keep this draft through the wallet refresh");
        assert_eq!(f.bridge.count("resumeAgentSession"), 0);
        assert!(submit(&controller, &state.draft).await);
        assert_eq!(f.bridge.count("startAgentTurn"), 1);
        controller.dispose(false);
    });
}

#[test]
fn updates_model_inspection_without_executable_discovery_or_a_new_session() {
    run(async {
        let f = bridge_fixture(json!({ "modelConnections": true }));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        let session = controller.get_snapshot().session;
        f.bridge.clear("resumeAgentSession");
        controller.refresh_model_connections().await;
        assert_eq!(
            f.bridge.last_call("discoverAgentRuntimes"),
            Some(
                json!({ "rootPath": ROOT, "runtimeId": controller.get_snapshot().selected_runtime_id, "refresh": false })
            )
        );
        assert_eq!(controller.get_snapshot().session, session);
        assert_eq!(f.bridge.count("resumeAgentSession"), 0);
        controller.dispose(false);
    });
}

#[test]
fn keeps_stop_feedback_independent_and_retries_the_same_command_identity() {
    run_paused(async {
        let f = bridge_fixture(json!({}));
        f.bridge.handle("interruptAgentTurn", |request| {
            Box::pin(async move {
                Ok(json!({ "sessionId": request["sessionId"], "turnId": request["turnId"], "interruptRequested": true }))
            })
        });
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Running", "turn-1"));
        f.bridge.handle_once("interruptAgentTurn", |_| {
            Box::pin(futures_util::future::pending())
        });
        let stopping = controller.stop();
        assert!(controller.get_snapshot().stopping);
        controller.stop().await.expect("stop");
        assert_eq!(f.bridge.count("interruptAgentTurn"), 1);
        advance(5000).await;
        stopping.await.expect("stop");
        let state = controller.get_snapshot();
        assert_eq!(
            state.stop_request.as_ref().map(|r| r.status),
            Some(StopRequestStatus::Unconfirmed)
        );
        assert!(!state.stopping);
        controller.stop().await.expect("stop");
        let calls = f.bridge.calls("interruptAgentTurn");
        assert_eq!(calls[1], calls[0]);
        controller.dispose(false);
    });
}

#[test]
fn requires_a_fresh_conversation_for_a_model_connection_change() {
    run(async {
        let f = bridge_fixture(json!({ "modelConnections": true }));
        let overrides = json!({ "modelConnections": true });
        let mut first = snapshot("session-1", Vec::new(), &overrides);
        let second_model = json!({ "id": "local/test", "model": "local/test", "connectionId": "local", "providerId": "local", "displayName": "Local test", "description": "", "isDefault": false });
        first["models"]
            .as_array_mut()
            .expect("models")
            .push(second_model.clone());
        f.bridge.resolve_once("resumeAgentSession", first.clone());
        let mut next = snapshot("session-2", Vec::new(), &overrides);
        next["session"]["selectedModel"] = second_model["model"].clone();
        next["models"] = first["models"].clone();
        f.bridge.resolve_once("createAgentSession", next);
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller.set_draft("private old draft");
        assert!(controller.requires_new_model_connection_session(Some("local/test")));
        controller.select_model(Some("local/test"));
        assert_eq!(
            controller.get_snapshot().selected_model.as_deref(),
            Some("openai/gpt-5")
        );
        controller.start_new_model_connection("local/test").await;
        assert!(
            f.bridge
                .calls("closeAgentSession")
                .iter()
                .any(|request| matches(
                    request,
                    &json!({ "sessionId": "session-1", "removePersistence": false })
                ))
        );
        assert!(
            f.bridge
                .calls("createAgentSession")
                .iter()
                .any(|request| matches(request, &json!({ "model": "local/test" })))
        );
        assert_match(
            &state(&controller),
            &json!({ "draft": "", "references": [], "selectedModel": "local/test", "submitting": false }),
        );
        assert_eq!(f.bridge.count("startAgentTurn"), 0);
        controller.dispose(false);
    });
}

#[test]
fn preserves_an_unavailable_model_route_instead_of_choosing_another() {
    run(async {
        let f = bridge_fixture(json!({ "modelConnections": true }));
        let mut saved = snapshot(
            "session-1",
            Vec::new(),
            &json!({ "modelConnections": true }),
        );
        saved["session"]["selectedModel"] = json!("deleted/model");
        f.bridge.resolve_once("resumeAgentSession", saved);
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_eq!(
            controller.get_snapshot().selected_model.as_deref(),
            Some("deleted/model")
        );
        controller.dispose(false);
    });
}

#[test]
fn keeps_newer_steer_drafts_references_and_mentions_on_receipt() {
    for accepted in [true, false] {
        run(async move {
            let f = bridge_fixture(json!({
                "steer": true, "referenceInputs": reference_capabilities_with(json!({ "steer": true })),
            }));
            let receipt = Deferred::new();
            f.bridge.handle_once("steerAgentTurn", receipt.handler());
            let controller = f.controller();
            controller.initialize(false).await.expect("initialize");
            f.emit(turn_started(2, "Running", "turn-running"));
            controller
                .add_workspace_paths(vec!["a.md".into()], Vec::new())
                .await
                .expect("add");
            let first_reference = controller.get_snapshot().references[0].clone();
            controller.set_draft_document(
                "@a.md",
                &[typed(
                    json!({ "referenceId": j(&first_reference)["id"], "start": 0, "end": 5 }),
                )],
            );
            let pending = controller.submit("@a.md");
            assert_match(
                &state(&controller),
                &json!({ "submitting": true, "draft": "", "references": [] }),
            );
            controller
                .add_workspace_paths(vec!["b.md".into()], Vec::new())
                .await
                .expect("add");
            let newer_reference = controller.get_snapshot().references[0].clone();
            controller.set_draft_document(
                "@b.md",
                &[typed(
                    json!({ "referenceId": j(&newer_reference)["id"], "start": 0, "end": 5 }),
                )],
            );
            if accepted {
                receipt.resolve(
                    json!({ "sessionId": "session-1", "turnId": "turn-running", "steered": true }),
                );
            } else {
                receipt.reject(AgentError::new("native rejected instruction"));
            }
            assert_eq!(pending.await.expect("submit"), accepted);
            let next = controller.get_snapshot();
            assert!(!next.submitting);
            assert_eq!(next.pending_intent, None);
            assert_eq!(
                next.draft,
                if accepted { "@b.md" } else { "@a.md\n\n@b.md" }
            );
            let ids: Vec<Value> = next.references.iter().map(|r| j(r)["id"].clone()).collect();
            assert_eq!(
                ids,
                if accepted {
                    vec![j(&newer_reference)["id"].clone()]
                } else {
                    vec![
                        j(&first_reference)["id"].clone(),
                        j(&newer_reference)["id"].clone(),
                    ]
                }
            );
            assert_eq!(
                next.draft_mentions.last().map(j),
                Some(json!({
                    "referenceId": j(&newer_reference)["id"],
                    "start": if accepted { 0 } else { 7 },
                    "end": if accepted { 5 } else { 12 },
                }))
            );
            if !accepted {
                assert!(submit(&controller, &next.draft).await);
            }
            controller.dispose(false);
        });
    }
}

#[test]
fn keeps_attachment_only_steer_submissions_busy_until_acknowledgement() {
    for accepted in [true, false] {
        run(async move {
            let f = bridge_fixture(json!({
                "steer": true,
                "referenceInputs": reference_capabilities_with(json!({ "steer": true, "attachmentOnly": true })),
            }));
            let receipt = Deferred::new();
            f.bridge.handle_once("steerAgentTurn", receipt.handler());
            let controller = f.controller();
            controller.initialize(false).await.expect("initialize");
            f.emit(turn_started(2, "Running", "turn-running"));
            controller
                .add_workspace_paths(vec!["a.md".into()], Vec::new())
                .await
                .expect("add");
            let pending = controller.submit("");
            assert!(controller.get_snapshot().submitting);
            assert!(!submit(&controller, "repeated Enter").await);
            controller.set_draft("new draft");
            if accepted {
                receipt.resolve(
                    json!({ "sessionId": "session-1", "turnId": "turn-running", "steered": true }),
                );
            } else {
                receipt.reject(AgentError::new("attachment rejected"));
            }
            assert_eq!(pending.await.expect("submit"), accepted);
            let state = controller.get_snapshot();
            assert_eq!(state.draft, "new draft");
            assert_eq!(state.references.len(), if accepted { 0 } else { 1 });
            assert!(!state.submitting);
            controller.dispose(false);
        });
    }
}

#[test]
fn does_not_restore_a_late_rejected_steer_into_a_replacement_conversation() {
    run(async {
        let f = bridge_fixture(json!({ "steer": true }));
        let receipt = Deferred::new();
        f.bridge.handle_once("steerAgentTurn", receipt.handler());
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Running", "turn-running"));
        let pending = controller.submit("old instruction");
        f.emit(event(
            3,
            "turn.completed",
            json!({}),
            Some("turn-running"),
            None,
            "session-1",
        ));
        controller.new_session().await;
        controller.set_draft("new conversation draft");
        receipt.reject(AgentError::new("late rejection"));
        assert!(!pending.await.expect("submit"));
        assert_match(
            &state(&controller),
            &json!({ "draft": "new conversation draft", "error": null, "submitting": false, "pendingIntent": null }),
        );
        controller.dispose(false);
    });
}

#[test]
fn ignores_receipts_and_new_submissions_after_disposal() {
    run(async {
        let f = bridge_fixture(json!({ "steer": true }));
        let receipt = Deferred::new();
        f.bridge.handle_once("steerAgentTurn", receipt.handler());
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Running", "turn-running"));
        let pending = controller.submit("old instruction");
        controller.dispose(false);
        let disposed_revision = controller.store().revision();
        receipt.reject(AgentError::new("late rejection"));
        assert!(!pending.await.expect("submit"));
        assert!(!submit(&controller, "after dispose").await);
        assert_eq!(controller.store().revision(), disposed_revision);
        assert_eq!(f.bridge.count("steerAgentTurn"), 1);
    });
}

#[test]
fn discovers_installed_agents_without_selecting_or_resuming_one() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": [
                    { "descriptor": { "id": "codex", "displayName": "Codex" }, "readiness": readiness_for("codex") },
                    { "descriptor": { "id": "claude", "displayName": "Claude Agent" }, "readiness": readiness_for("claude") },
                ],
                "selectedRuntimeId": null, "readiness": null, "account": null, "providers": [], "models": [], "modes": [],
                "commands": [], "capabilities": null, "warnings": [],
            }),
        );
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_eq!(
            f.bridge.calls("discoverAgentRuntimes"),
            vec![json!({ "rootPath": ROOT, "refresh": false })]
        );
        assert_match(
            &state(&controller),
            &json!({ "initialized": true, "phase": "ready", "selectedRuntimeId": null, "selectedModel": null, "session": null }),
        );
        assert_eq!(f.bridge.count("resumeAgentSession"), 0);
        assert_eq!(f.bridge.count("createAgentSession"), 0);
    });
}

#[test]
fn binds_a_creation_recipe_before_discovery_without_restoring_history() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": [{ "descriptor": { "id": "codex", "displayName": "Codex", "iconKey": "codex" }, "readiness": readiness_for("codex") }],
                "selectedRuntimeId": "codex", "runtime": { "id": "codex", "displayName": "Codex", "iconKey": "codex" },
                "readiness": readiness_for("codex"), "account": null, "providers": [], "models": [], "modes": [], "commands": [],
                "capabilities": capabilities(&json!({})), "warnings": [],
            }),
        );
        let controller = f.controller();
        assert!(
            controller
                .initialize_for_runtime("codex")
                .await
                .expect("initialize")
        );
        assert_eq!(
            f.bridge.calls("discoverAgentRuntimes"),
            vec![json!({ "rootPath": ROOT, "runtimeId": "codex", "refresh": false })]
        );
        assert_match(
            &state(&controller),
            &json!({ "initialized": true, "phase": "ready", "selectedRuntimeId": "codex", "session": null }),
        );
        assert_eq!(f.bridge.count("resumeAgentSession"), 0);
        assert_eq!(f.bridge.count("createAgentSession"), 0);
    });
}

#[test]
fn begins_direct_recipe_discovery_without_blocking_admission() {
    run(async {
        let f = bridge_fixture(json!({}));
        let inspection = f.bridge.implementation("discoverAgentRuntimes")(json!({}))
            .await
            .expect("inspection");
        let discovery = Deferred::new();
        f.bridge
            .handle_once("discoverAgentRuntimes", discovery.handler());
        let controller = f.controller();
        controller.begin_initialize_for_runtime("codex");
        assert_eq!(
            f.bridge.calls("discoverAgentRuntimes"),
            vec![json!({ "rootPath": ROOT, "runtimeId": "codex", "refresh": false })]
        );
        assert_match(
            &state(&controller),
            &json!({ "initialized": false, "phase": "discovering", "selectedRuntimeId": "codex", "session": null }),
        );
        let mut resolved = inspection;
        resolved["selectedRuntimeId"] = json!("codex");
        resolved["runtime"] = json!({ "id": "codex", "displayName": "Codex", "iconKey": "codex" });
        resolved["readiness"] = readiness_for("codex");
        discovery.resolve(resolved);
        wait_for(|| {
            matches(
                &state(&controller),
                &json!({ "initialized": true, "phase": "ready", "selectedRuntimeId": "codex" }),
            )
        })
        .await;
        assert_eq!(f.bridge.count("resumeAgentSession"), 0);
    });
}

#[test]
fn renders_main_display_revisions_and_preserves_the_old_locator_on_new_chat() {
    run(async {
        let f = bridge_fixture(json!({}));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_eq!(
            controller.get_snapshot().selected_runtime_id.as_deref(),
            Some("opencode")
        );
        assert_eq!(
            controller.get_snapshot().selected_provider_id.as_deref(),
            Some("openai")
        );
        assert!(!controller.select_runtime("codex").await);

        f.emit(turn_started(2, "Fix it", "turn-1"));
        f.emit(event(
            3,
            "assistant.delta",
            json!({ "delta": "Working" }),
            Some("turn-1"),
            Some("message-1"),
            "session-1",
        ));
        settle().await;
        assert_eq!(
            message_texts(&controller),
            vec![json!("Fix it"), json!("Working")]
        );

        f.emit(event(
            5,
            "turn.completed",
            json!({ "status": "completed" }),
            Some("turn-1"),
            None,
            "session-1",
        ));
        settle().await;
        assert_eq!(f.bridge.count("replayAgentSession"), 0);
        let projection = controller.get_snapshot().projection;
        assert_eq!(projection.last_sequence, 5);
        assert_eq!(projection.terminal_state.as_deref(), Some("completed"));

        controller.remember_viewport(
            320.,
            vec![("row:assistant:message-1".into(), 88.)],
            false,
            None,
        );
        let viewport = controller.read_viewport();
        assert_eq!(viewport.draft, "");
        assert!(viewport.draft_mentions.is_empty());
        assert_eq!(viewport.scroll_top, 320.);
        assert_eq!(
            viewport.measurements,
            vec![("row:assistant:message-1".to_string(), 88.)]
        );
        assert!(!viewport.pinned);
        assert_eq!(viewport.geometry, None);

        controller.new_session().await;
        assert!(f.bridge.calls("closeAgentSession").contains(
            &json!({ "rootPath": ROOT, "sessionId": "session-1", "removePersistence": false })
        ));
        assert_eq!(controller.get_snapshot().session_id(), Some("session-2"));
    });
}

#[test]
fn closes_a_tab_owned_native_session_without_affecting_another_controller() {
    run(async {
        let first_fixture = bridge_fixture(json!({}));
        let second_fixture = bridge_fixture(json!({}));
        let first = first_fixture.controller();
        let second = second_fixture.controller();
        first.initialize(false).await.expect("initialize");
        second.initialize(false).await.expect("initialize");
        assert_eq!(first.close_tab_session().await, CloseOutcome::Closed);
        assert!(first_fixture.bridge.calls("closeAgentSession").contains(
            &json!({ "rootPath": ROOT, "sessionId": "session-1", "removePersistence": false })
        ));
        assert_eq!(second_fixture.bridge.count("closeAgentSession"), 0);
        assert_eq!(second.get_snapshot().session_id(), Some("session-1"));
    });
}

#[test]
fn opens_an_explicitly_selected_saved_conversation() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once(
            "resumeAgentSession",
            snapshot("session-1", Vec::new(), &json!({})),
        );
        f.bridge.resolve_once(
            "openAgentSession",
            json!({ "status": "opened", "snapshot": snapshot("saved-session", vec![
                event(1, "turn.started", json!({ "prompt": "Past prompt" }), Some("past-turn"), None, "saved-session"),
                event(2, "assistant.completed", json!({ "text": "Past answer" }), Some("past-turn"), Some("past-answer"), "saved-session"),
            ], &json!({})) }),
        );
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller
            .open_saved_session("saved-session", "opencode")
            .await
            .expect("open");
        assert!(f.bridge.calls("openAgentSession").contains(
            &json!({ "rootPath": ROOT, "sessionId": "saved-session", "runtimeId": "opencode" })
        ));
        assert_eq!(
            controller.get_snapshot().session_id(),
            Some("saved-session")
        );
        assert_eq!(
            message_texts(&controller),
            vec![json!("Past prompt"), json!("Past answer")]
        );
    });
}

#[test]
fn closes_a_restored_native_session_when_workbench_preparation_rolls_back() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once(
            "openAgentSession",
            json!({ "status": "opened", "snapshot": snapshot("prepared-session", vec![
                event(1, "turn.started", json!({ "prompt": "Still running" }), Some("prepared-turn"), None, "prepared-session"),
            ], &json!({})) }),
        );
        let controller = f.controller();
        controller
            .open_saved_session("prepared-session", "opencode")
            .await
            .expect("open");
        assert_eq!(
            controller.get_snapshot().running_turn_id(),
            Some("prepared-turn")
        );
        controller.rollback_preparation().await.expect("rollback");
        assert!(
            f.bridge
                .calls("closeAgentSession")
                .contains(&json!({ "rootPath": ROOT, "sessionId": "prepared-session", "removePersistence": false }))
        );
    });
}

#[test]
fn preserves_an_exact_history_open_error() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once(
            "openAgentSession",
            json!({ "status": "failed", "error": {
                "code": "SESSION_NOT_FOUND", "message": "This saved Agent session is no longer available.", "retryable": false,
            } }),
        );
        let controller = f.controller();
        let error = controller
            .open_saved_session("stale-session", "opencode")
            .await
            .expect_err("open error");
        assert_eq!(error.code.as_deref(), Some("SESSION_NOT_FOUND"));
        assert_eq!(error.retryable, Some(false));
        assert_match(
            &state(&controller),
            &json!({ "phase": "failed", "sessionPreparation": "failed", "error": { "detail": "This saved Agent session is no longer available." } }),
        );
    });
}

#[test]
fn allows_confirmed_tab_closure_while_the_displayed_turn_runs() {
    run(async {
        let f = bridge_fixture(json!({}));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Keep going", "turn-1"));
        assert_eq!(controller.close_tab_session().await, CloseOutcome::Closed);
        assert_eq!(f.bridge.count("closeAgentSession"), 1);
        assert_ne!(controller.get_snapshot().error_code(), Some("active-turn"));
    });
}

#[test]
fn selects_the_first_catalog_model_and_derives_its_inference_route() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": [{ "descriptor": { "id": "opencode", "displayName": "OpenCode", "priority": 100 }, "readiness": readiness() }],
                "selectedRuntimeId": "opencode", "runtime": { "id": "opencode", "displayName": "OpenCode" }, "readiness": readiness(),
                "account": { "account": { "type": "opencode", "email": null, "planType": null }, "requiresOpenaiAuth": false },
                "providers": [
                    { "id": "anthropic", "displayName": "Anthropic", "defaultModel": "anthropic/claude-sonnet", "modelCount": 1 },
                    { "id": "openai", "displayName": "OpenAI", "defaultModel": "openai/gpt-5", "modelCount": 1 },
                ],
                "models": [
                    { "id": "anthropic/claude-sonnet", "model": "anthropic/claude-sonnet", "providerId": "anthropic", "displayName": "Claude Sonnet", "description": "Anthropic · Claude", "isDefault": false, "variants": ["low", "high"], "defaultVariant": "high" },
                    { "id": "openai/gpt-5", "model": "openai/gpt-5", "providerId": "openai", "displayName": "GPT-5", "description": "OpenAI · GPT-5", "isDefault": true, "variants": ["low", "medium"], "defaultVariant": "medium" },
                ],
                "modes": [], "commands": [], "capabilities": capabilities(&json!({})), "warnings": [],
            }),
        );
        f.bridge.resolve_once("resumeAgentSession", Value::Null);
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_match(
            &state(&controller),
            &json!({ "selectedProviderId": "anthropic", "selectedModel": "anthropic/claude-sonnet", "selectedEffort": "high" }),
        );
        let discovery_calls = f.bridge.count("discoverAgentRuntimes");
        let resume_calls = f.bridge.count("resumeAgentSession");
        controller.select_model(Some("openai/gpt-5"));
        assert_match(
            &state(&controller),
            &json!({ "selectedProviderId": "openai", "selectedModel": "openai/gpt-5", "selectedEffort": "medium" }),
        );
        controller.select_effort(Some("low"));
        assert_eq!(
            controller.get_snapshot().selected_effort.as_deref(),
            Some("low")
        );
        assert_eq!(f.bridge.count("discoverAgentRuntimes"), discovery_calls);
        assert_eq!(f.bridge.count("resumeAgentSession"), resume_calls);
        assert_eq!(f.bridge.count("createAgentSession"), 0);
    });
}

#[test]
fn switches_a_blank_composer_between_ready_native_agents() {
    run(async {
        let f = bridge_fixture(json!({}));
        let runtimes = json!([
            { "descriptor": { "id": "opencode", "displayName": "Built-in Agent", "iconKey": "built-in-agent" }, "readiness": readiness_for("opencode") },
            { "descriptor": { "id": "codex", "displayName": "Codex", "iconKey": "codex" }, "readiness": readiness_for("codex") },
        ]);
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": runtimes, "selectedRuntimeId": "opencode", "runtime": runtimes[0]["descriptor"],
                "readiness": readiness_for("opencode"), "account": null,
                "providers": [{ "id": "openai", "displayName": "OpenAI", "defaultModel": "openai/gpt-5", "modelCount": 1 }],
                "models": [gpt5()], "modes": [], "commands": [], "capabilities": capabilities(&json!({})), "warnings": [],
            }),
        );
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": runtimes, "selectedRuntimeId": "codex", "runtime": runtimes[1]["descriptor"],
                "readiness": readiness_for("codex"), "account": null, "providers": [],
                "models": [{ "id": "gpt-5-codex", "model": "gpt-5-codex", "displayName": "GPT-5 Codex", "description": "Native Codex model", "isDefault": true }],
                "modes": [], "commands": [], "capabilities": capabilities(&json!({})), "warnings": [],
            }),
        );
        f.bridge.resolve("resumeAgentSession", Value::Null);
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_match(
            &state(&controller),
            &json!({ "session": null, "selectedRuntimeId": "opencode" }),
        );
        assert!(controller.select_runtime("codex").await);
        assert_eq!(
            f.bridge.last_call("discoverAgentRuntimes"),
            Some(json!({ "rootPath": ROOT, "runtimeId": "codex", "refresh": false }))
        );
        assert_match(
            &state(&controller),
            &json!({ "selectedRuntimeId": "codex", "selectedProviderId": null, "selectedModel": "gpt-5-codex" }),
        );
    });
}

#[test]
fn switches_coding_agent_providers_into_a_new_chat_without_resuming_history() {
    run(async {
        let f = bridge_fixture(json!({}));
        let runtimes = json!([
            { "descriptor": { "id": "codex", "displayName": "Codex", "iconKey": "codex", "distribution": "user-installed" }, "readiness": readiness_for("codex") },
            { "descriptor": { "id": "claude", "displayName": "Claude Code", "iconKey": "claude", "distribution": "sdk-bundled" }, "readiness": readiness_for("claude") },
        ]);
        let codex_model = json!({ "id": "gpt-5-codex", "model": "gpt-5-codex", "displayName": "GPT-5 Codex", "description": "Native Codex model", "isDefault": true });
        let claude_model = json!({ "id": "claude-sonnet", "model": "claude-sonnet", "displayName": "Claude Sonnet", "description": "Native Claude model", "isDefault": true });
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            runtime_inspection(&runtimes, "codex", &codex_model),
        );
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            runtime_inspection(&runtimes, "claude", &claude_model),
        );
        f.bridge.resolve_once(
            "resumeAgentSession",
            runtime_snapshot("codex-session", "codex", "Codex", &codex_model),
        );
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_match(
            &state(&controller),
            &json!({ "selectedRuntimeId": "codex", "selectedModel": "gpt-5-codex" }),
        );
        controller
            .stage_external_files(vec![png("before-switch.png")])
            .await
            .expect("stage");
        let first_epoch = f
            .bridge
            .last_call("stageAgentAttachments")
            .map(|r| r["epoch"].clone());
        assert!(controller.select_runtime("claude").await);
        assert!(
            f.bridge
                .calls("revokeAgentAttachments")
                .contains(&json!({ "rootPath": ROOT, "tokens": ["stage-token"] }))
        );
        assert!(f.bridge.calls("closeAgentSession").contains(
            &json!({ "rootPath": ROOT, "sessionId": "codex-session", "removePersistence": false })
        ));
        assert_eq!(
            f.bridge.last_call("discoverAgentRuntimes"),
            Some(json!({ "rootPath": ROOT, "runtimeId": "claude", "refresh": false }))
        );
        assert_match(
            &state(&controller),
            &json!({ "selectedRuntimeId": "claude", "selectedProviderId": null, "selectedModel": "claude-sonnet", "session": null }),
        );
        assert_eq!(f.bridge.count("resumeAgentSession"), 1);
        assert!(controller.get_snapshot().references.is_empty());
        controller
            .stage_external_files(vec![png("after-switch.png")])
            .await
            .expect("stage");
        assert_ne!(
            f.bridge
                .last_call("stageAgentAttachments")
                .map(|r| r["epoch"].clone()),
            first_epoch
        );
    });
}

#[test]
fn selects_a_detected_runtime_while_keeping_execution_gated_by_readiness() {
    run(async {
        let f = bridge_fixture(json!({}));
        let ready = json!({ "descriptor": { "id": "codex", "displayName": "Codex", "iconKey": "codex" }, "readiness": readiness_for("codex") });
        let unavailable = json!({
            "descriptor": { "id": "cursor", "displayName": "Cursor Agent", "iconKey": "cursor" },
            "readiness": {
                "runtimeId": "cursor", "provider": "cursor", "status": "protocol-unavailable", "code": "PROTOCOL_UNAVAILABLE",
                "version": "1.0.0", "minimumVersion": null, "message": "Native protocol unavailable", "selectable": false,
            },
        });
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": [ready, unavailable], "selectedRuntimeId": "codex", "runtime": ready["descriptor"], "readiness": ready["readiness"],
                "account": null, "providers": [],
                "models": [{ "id": "gpt-5", "model": "gpt-5", "displayName": "GPT-5", "description": "", "isDefault": true }],
                "modes": [], "commands": [], "capabilities": capabilities(&json!({})), "warnings": [],
            }),
        );
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": [ready, unavailable], "selectedRuntimeId": "cursor", "runtime": unavailable["descriptor"],
                "readiness": unavailable["readiness"], "account": null, "providers": [], "models": [], "modes": [], "commands": [],
                "capabilities": capabilities(&json!({})), "warnings": [],
            }),
        );
        f.bridge.resolve("resumeAgentSession", Value::Null);
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert!(controller.select_runtime("cursor").await);
        assert_match(
            &state(&controller),
            &json!({ "selectedRuntimeId": "cursor", "phase": "ready", "inspection": { "readiness": { "status": "protocol-unavailable" } } }),
        );
        assert_eq!(f.bridge.count("resumeAgentSession"), 1);
    });
}

#[test]
fn displays_provider_diagnostics_without_rewriting_the_catalog() {
    run(async {
        let f = bridge_fixture(json!({}));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Hello", "turn-auth"));
        f.emit(event(
            3,
            "provider.error",
            json!({ "message": "API key not valid. Please pass a valid API key." }),
            Some("turn-auth"),
            Some("assistant-auth"),
            "session-1",
        ));
        settle().await;
        assert_match(
            &state(&controller),
            &json!({ "selectedProviderId": "openai", "selectedModel": "openai/gpt-5" }),
        );
        assert!(
            controller
                .get_snapshot()
                .projection
                .activities
                .iter()
                .any(|activity| activity.kind == "error")
        );
    });
}

#[test]
fn reuses_discovery_on_remounts_and_lets_refresh_bypass_the_cache() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve("resumeAgentSession", Value::Null);
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller.initialize(false).await.expect("initialize");
        assert_eq!(f.bridge.count("discoverAgentRuntimes"), 1);
        controller.initialize(true).await.expect("initialize");
        assert_eq!(f.bridge.count("discoverAgentRuntimes"), 2);
        assert_eq!(
            f.bridge.last_call("discoverAgentRuntimes"),
            Some(json!({ "rootPath": ROOT, "runtimeId": "opencode", "refresh": true }))
        );
        assert_eq!(AGENT_RUNTIME_DISCOVERY_CACHE_TTL_MS, 5 * 60_000);
    });
}

#[test]
fn discovers_local_tools_only_when_the_provider_surface_requests_them() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve(
            "discoverLocalAgentConnections",
            json!({
                "connections": [{
                    "id": "codex", "displayName": "Codex CLI", "installation": "detected", "version": "0.144.1",
                    "authentication": "signed-in", "integration": "bridge-required",
                    "capabilities": { "versionProbe": true, "authenticationProbe": true, "protocolProbe": true },
                    "selectable": false, "statusMessage": "Direct Codex sessions are not enabled.",
                    "actions": [{ "id": "refresh", "label": "Refresh" }], "source": "user-installation",
                }],
                "scannedAt": "2026-07-12T00:00:00.000Z",
                "warnings": [],
            }),
        );
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_eq!(f.bridge.count("discoverLocalAgentConnections"), 0);
        controller.discover_local_connections(false).await;
        assert_eq!(
            f.bridge.calls("discoverLocalAgentConnections"),
            vec![json!({ "rootPath": ROOT, "refresh": false })]
        );
        assert_match(
            &state(&controller),
            &json!({ "localConnectionsPhase": "ready", "localConnectionsScannedAt": "2026-07-12T00:00:00.000Z" }),
        );
        let connections = controller.get_snapshot().local_connections;
        assert_eq!(connections.len(), 1);
        assert_match(
            &j(&connections[0]),
            &json!({ "id": "codex", "selectable": false }),
        );
        controller.discover_local_connections(true).await;
        assert_eq!(
            f.bridge.last_call("discoverLocalAgentConnections"),
            Some(json!({ "rootPath": ROOT, "refresh": true }))
        );
    });
}

#[test]
fn delegates_queue_admission_to_the_main_command_transaction() {
    run(async {
        let f = bridge_fixture(json!({ "queue": true }));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Long task", "turn-queue"));
        settle().await;
        assert!(submit(&controller, "Follow-up").await);
        let calls = f.bridge.calls("startAgentTurn");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["prompt"], "Follow-up");
        assert!(
            calls[0]["commandId"]
                .as_str()
                .is_some_and(|id| id.starts_with("intent-"))
        );
    });
}

#[test]
fn hands_the_local_preview_to_mains_admitted_input_before_the_start_receipt() {
    run(async {
        let f = bridge_fixture(json!({}));
        let accept = Deferred::new();
        f.bridge.handle_once("startAgentTurn", accept.handler());
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller.set_draft("Explain the architecture");
        let submission = controller.submit("Explain the architecture");
        let snapshot = state(&controller);
        assert_match(
            &snapshot,
            &json!({ "draft": "", "pendingPrompt": null, "submitting": true }),
        );
        let messages = snapshot["projection"]["messages"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert_eq!(messages.len(), 1);
        assert_match(
            &messages[0],
            &json!({ "text": "Explain the architecture", "deliveryStatus": "dispatching" }),
        );
        f.emit(turn_started(2, "Explain the architecture", "turn-live"));
        assert_match(
            &state(&controller),
            &json!({ "pendingPrompt": null, "projection": { "runningTurnId": "turn-live" } }),
        );
        accept.resolve(json!({ "sessionId": "session-1", "turnId": "turn-live" }));
        assert!(submission.await.expect("submit"));
        assert!(!controller.get_snapshot().submitting);
    });
}

#[test]
fn captures_reference_mention_ranges_in_the_immutable_intent() {
    run(async {
        let f = bridge_fixture(json!({}));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller
            .add_workspace_paths(vec!["architecture.md".into()], Vec::new())
            .await
            .expect("add");
        let reference = controller.get_snapshot().references[0].clone();
        let prompt = "Explain @architecture.md";
        controller.set_draft_document(
            prompt,
            &[typed(
                json!({ "referenceId": j(&reference)["id"], "start": 8, "end": 24 }),
            )],
        );
        assert!(submit(&controller, prompt).await);
        let calls = f.bridge.calls("startAgentTurn");
        assert_match(
            &calls[0],
            &json!({
                "prompt": prompt,
                "promptMentions": [{ "referenceId": j(&reference)["id"], "start": 8, "end": 24 }],
                "references": [{ "id": j(&reference)["id"] }],
            }),
        );
        assert_match(
            &state(&controller),
            &json!({ "draft": "", "draftMentions": [] }),
        );
    });
}

#[test]
fn shares_one_background_preparation_with_the_first_submit() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once("resumeAgentSession", Value::Null);
        let create = Deferred::new();
        f.bridge.handle_once("createAgentSession", create.handler());
        let start = Deferred::new();
        f.bridge.handle_once("startAgentTurn", start.handler());
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        let preparation = controller.prepare_session();
        let duplicate = controller.prepare_session();
        let submission = controller.submit("Inspect the first-turn path");
        wait_for(|| {
            controller.get_snapshot().session_preparation == AgentSessionPreparation::Preparing
        })
        .await;
        settle().await;
        assert_eq!(f.bridge.count("createAgentSession"), 1);
        assert_match(
            &state(&controller),
            &json!({ "session": null, "sessionPreparation": "preparing", "pendingPrompt": "Inspect the first-turn path" }),
        );
        create.resolve(snapshot(
            "session-2",
            vec![event(
                1,
                "session.started",
                json!({ "title": "New" }),
                None,
                None,
                "session-2",
            )],
            &json!({}),
        ));
        let _ = futures_util::future::join(preparation, duplicate).await;
        settle().await;
        assert_eq!(f.bridge.count("startAgentTurn"), 1);
        let snapshot_value = state(&controller);
        assert_match(
            &snapshot_value,
            &json!({ "session": { "id": "session-2" }, "sessionPreparation": "ready", "pendingPrompt": null }),
        );
        let messages = snapshot_value["projection"]["messages"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert_eq!(messages.len(), 1);
        assert_match(
            &messages[0],
            &json!({ "text": "Inspect the first-turn path", "deliveryStatus": "dispatching" }),
        );
        f.emit(event(
            2,
            "turn.started",
            json!({ "prompt": "Inspect the first-turn path" }),
            Some("turn-first"),
            None,
            "session-2",
        ));
        assert_match(
            &state(&controller),
            &json!({ "pendingPrompt": null, "projection": { "runningTurnId": "turn-first" } }),
        );
        start.resolve(json!({ "sessionId": "session-1", "turnId": "turn-first" }));
        assert!(submission.await.expect("submit"));
    });
}

#[test]
fn closes_a_prepared_native_session_that_resolves_after_disposal() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once("resumeAgentSession", Value::Null);
        let create = Deferred::new();
        f.bridge.handle_once("createAgentSession", create.handler());
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        let preparation = controller.prepare_session();
        wait_for(|| {
            controller.get_snapshot().session_preparation == AgentSessionPreparation::Preparing
        })
        .await;
        controller.dispose(false);
        create.resolve(snapshot("session-stale", Vec::new(), &json!({})));
        assert!(!preparation.await);
        assert!(f.bridge.calls("closeAgentSession").contains(
            &json!({ "rootPath": ROOT, "sessionId": "session-stale", "removePersistence": true })
        ));
    });
}

#[test]
fn lets_capability_controls_supersede_an_in_flight_prewarm() {
    run(async {
        let f = bridge_fixture(json!({}));
        let models = json!([
            { "id": "openai/gpt-5", "model": "openai/gpt-5", "providerId": "openai", "displayName": "GPT-5", "description": "", "isDefault": true },
            { "id": "openai/gpt-5-mini", "model": "openai/gpt-5-mini", "providerId": "openai", "displayName": "GPT-5 Mini", "description": "", "isDefault": false },
        ]);
        let modes = json!([
            { "id": "build", "displayName": "Build", "description": "", "isDefault": true },
            { "id": "plan", "displayName": "Plan", "description": "", "isDefault": false },
        ]);
        f.bridge.resolve_once(
            "discoverAgentRuntimes",
            json!({
                "runtimes": [{ "descriptor": { "id": "opencode", "displayName": "OpenCode" }, "readiness": readiness() }],
                "selectedRuntimeId": "opencode", "runtime": { "id": "opencode", "displayName": "OpenCode" }, "readiness": readiness(),
                "account": null,
                "providers": [{ "id": "openai", "displayName": "OpenAI", "defaultModel": "openai/gpt-5", "modelCount": 2 }],
                "models": models, "modes": modes, "commands": [], "capabilities": capabilities(&json!({})), "warnings": [],
            }),
        );
        f.bridge.resolve_once("resumeAgentSession", Value::Null);
        let resolvers = Deferreds::default();
        f.bridge.handle("createAgentSession", resolvers.handler());
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        let first = controller.prepare_session();
        wait_for(|| {
            controller.get_snapshot().session_preparation == AgentSessionPreparation::Preparing
        })
        .await;
        controller.select_model(Some("openai/gpt-5-mini"));
        controller.select_mode(Some("plan"));
        assert_match(
            &state(&controller),
            &json!({ "selectedModel": "openai/gpt-5-mini", "selectedMode": "plan", "sessionPreparation": "idle" }),
        );
        wait_for(|| resolvers.len() == 1).await;
        resolvers
            .get(0)
            .resolve(snapshot("session-stale", Vec::new(), &json!({})));
        assert!(!first.await);
        wait_for(|| f.bridge.count("createAgentSession") == 2).await;
        assert!(f.bridge.calls("closeAgentSession").contains(
            &json!({ "rootPath": ROOT, "sessionId": "session-stale", "removePersistence": true })
        ));
        let mut latest = snapshot("session-latest", Vec::new(), &json!({}));
        latest["models"] = models;
        latest["modes"] = modes;
        latest["session"]["selectedModel"] = json!("openai/gpt-5-mini");
        latest["session"]["selectedMode"] = json!("plan");
        wait_for(|| resolvers.len() == 2).await;
        resolvers.get(1).resolve(latest);
        wait_for(|| {
            matches(
                &state(&controller),
                &json!({ "session": { "id": "session-latest" }, "selectedModel": "openai/gpt-5-mini", "selectedMode": "plan", "sessionPreparation": "ready" }),
            )
        })
        .await;
        assert_match(
            &f.bridge.calls("createAgentSession")[1],
            &json!({ "model": "openai/gpt-5-mini", "mode": "plan" }),
        );
    });
}

#[test]
fn does_not_publish_late_asynchronous_state_after_disposal() {
    run(async {
        let f = bridge_fixture(json!({}));
        let inspection = f.bridge.implementation("discoverAgentRuntimes")(json!({}))
            .await
            .expect("inspection");
        let discovery = Deferred::new();
        f.bridge
            .handle_once("discoverAgentRuntimes", discovery.handler());
        let controller = f.controller();
        let calls = Rc::new(Cell::new(0));
        let counted = calls.clone();
        let _unsubscribe = controller.subscribe(Rc::new(move || counted.set(counted.get() + 1)));
        let initialize = controller.initialize(false);
        assert_eq!(calls.get(), 1);
        controller.dispose(false);
        discovery.resolve(inspection);
        initialize.await.expect("initialize");
        assert_eq!(calls.get(), 1);
    });
}

#[test]
fn captures_references_inside_the_immutable_command_sent_to_main() {
    run(async {
        let f = bridge_fixture(json!({ "queue": true }));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Long task", "turn-running"));
        settle().await;
        controller
            .add_workspace_paths(vec!["a.md".into()], Vec::new())
            .await
            .expect("add");
        assert!(submit(&controller, "First queued").await);
        assert!(controller.get_snapshot().references.is_empty());
        assert_match(
            &f.bridge.calls("startAgentTurn")[0],
            &json!({ "prompt": "First queued", "references": [{ "relativePath": "a.md" }] }),
        );
    });
}

#[test]
fn restores_a_rejected_main_queue_command_without_stranding_its_draft() {
    run(async {
        let f = bridge_fixture(json!({ "queue": true }));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Long task", "turn-running"));
        settle().await;
        controller
            .add_workspace_paths(vec!["queued.md".into()], Vec::new())
            .await
            .expect("add");
        let start = Deferred::new();
        f.bridge.handle_once("startAgentTurn", start.handler());
        let submission = controller.submit("Queued request");
        wait_for(|| f.bridge.count("startAgentTurn") == 1).await;
        controller.set_draft("New draft");
        start.reject(AgentError::new("queued native start failed"));
        assert!(!submission.await.expect("submit"));
        wait_for(|| controller.get_snapshot().pending_intent.is_none()).await;
        assert_match(
            &state(&controller),
            &json!({ "draft": "Queued request\n\nNew draft", "references": [{ "relativePath": "queued.md" }] }),
        );
    });
}

#[test]
fn retains_references_steer_cannot_carry_and_restores_the_intent_after_preparation_failure() {
    run(async {
        let f = bridge_fixture(json!({
            "steer": true, "referenceInputs": reference_capabilities_with(json!({ "steer": false })),
        }));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        f.emit(turn_started(2, "Running", "turn-running"));
        settle().await;
        controller
            .add_workspace_paths(vec!["keep.md".into()], Vec::new())
            .await
            .expect("add");
        assert!(!submit(&controller, "Do not lose this").await);
        assert_eq!(f.bridge.count("steerAgentTurn"), 0);
        assert_match(
            &state(&controller)["references"],
            &json!([{ "relativePath": "keep.md" }]),
        );

        let failed_fixture = bridge_fixture(json!({}));
        failed_fixture
            .bridge
            .resolve_once("resumeAgentSession", Value::Null);
        failed_fixture
            .bridge
            .reject_once("createAgentSession", AgentError::new("cannot create"));
        let failed = failed_fixture.controller();
        failed.initialize(false).await.expect("initialize");
        failed
            .add_workspace_paths(vec!["restore.md".into()], Vec::new())
            .await
            .expect("add");
        let restore_reference = failed.get_snapshot().references[0].clone();
        let retry_prompt = "Retry with @restore.md";
        failed.set_draft_document(
            retry_prompt,
            &[typed(
                json!({ "referenceId": j(&restore_reference)["id"], "start": 11, "end": 22 }),
            )],
        );
        assert!(!submit(&failed, retry_prompt).await);
        assert_match(
            &state(&failed),
            &json!({
                "draft": retry_prompt,
                "draftMentions": [{ "referenceId": j(&restore_reference)["id"], "start": 11, "end": 22 }],
                "pendingIntent": null,
                "references": [{ "relativePath": "restore.md" }],
            }),
        );
        assert_eq!(failed_fixture.bridge.count("startAgentTurn"), 0);
    });
}

#[test]
fn merges_a_failed_intent_with_edits_and_references_added_while_preparing() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once("resumeAgentSession", Value::Null);
        let preparation = Deferred::new();
        f.bridge
            .handle_once("createAgentSession", preparation.handler());
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        controller
            .add_workspace_paths(vec!["original.md".into()], Vec::new())
            .await
            .expect("add");
        let submission = controller.submit("Original request");
        wait_for(|| controller.get_snapshot().pending_intent.is_some()).await;
        controller.set_draft("New edit while waiting");
        controller
            .add_workspace_paths(vec!["new.md".into()], Vec::new())
            .await
            .expect("add");
        wait_for(|| f.bridge.count("createAgentSession") == 1).await;
        preparation.reject(AgentError::new("cannot prepare"));
        assert!(!submission.await.expect("submit"));
        assert_match(
            &state(&controller),
            &json!({
                "draft": "Original request\n\nNew edit while waiting",
                "pendingIntent": null,
                "references": [{ "relativePath": "original.md" }, { "relativePath": "new.md" }],
            }),
        );
    });
}

#[test]
fn revokes_staged_grants_on_removal_and_keeps_external_paths_outside_state() {
    run(async {
        let f = bridge_fixture(json!({}));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        let file = png("capture.png");
        assert_eq!(
            controller
                .stage_external_files(vec![file.clone()])
                .await
                .expect("stage"),
            1
        );
        let reference = controller.get_snapshot().references[0].clone();
        assert_match(
            &j(&reference),
            &json!({ "kind": "staged-attachment", "displayName": "capture.png", "status": "ready" }),
        );
        assert!(j(&reference).get("path").is_none());
        assert_eq!(
            controller
                .stage_external_files(vec![file])
                .await
                .expect("stage"),
            0
        );
        assert_eq!(controller.get_snapshot().references.len(), 1);
        controller.remove_reference(j(&reference)["id"].as_str().unwrap_or_default());
        wait_for(|| {
            f.bridge
                .calls("revokeAgentAttachments")
                .contains(&json!({ "rootPath": ROOT, "tokens": ["stage-token"] }))
        })
        .await;
    });
}

#[test]
fn keeps_image_previews_renderer_local_and_revokes_their_object_urls_on_removal() {
    run(async {
        let f = bridge_fixture(json!({}));
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_eq!(
            controller
                .stage_external_files(vec![png("capture.png")])
                .await
                .expect("stage"),
            1
        );
        let reference = controller.get_snapshot().references[0].clone();
        let id = j(&reference)["id"].as_str().unwrap_or_default().to_string();
        let url = controller
            .get_reference_preview_url(&id)
            .expect("preview url");
        assert!(url.starts_with("blob:"));
        assert!(object_url_bytes(&url).is_some());
        assert!(j(&reference).get("previewUrl").is_none());
        controller.remove_reference(&id);
        assert_eq!(controller.get_reference_preview_url(&id), None);
        assert!(object_url_bytes(&url).is_none());
    });
}

#[test]
fn keeps_valid_entries_from_a_partial_external_file_batch() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.resolve_once(
            "stageAgentAttachments",
            json!([{ "id": "valid-image", "kind": "staged-attachment", "token": "valid-token", "displayName": "valid.png", "mime": "image/png", "size": 3, "status": "ready" }]),
        );
        f.bridge.reject_once(
            "stageAgentAttachments",
            AgentError::new("Only regular files can be attached."),
        );
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        let folder = AgentFile {
            name: "folder".into(),
            mime: "application/octet-stream".into(),
            size: 3.,
            source: AgentFileSource::Bytes(Rc::new(b"bad".to_vec())),
        };
        assert_eq!(
            controller
                .stage_external_files(vec![png("valid.png"), folder])
                .await
                .expect("stage"),
            1
        );
        assert_match(
            &state(&controller)["references"],
            &json!([
                { "id": "valid-image", "status": "ready" },
                { "displayName": "folder", "status": "error" },
            ]),
        );
    });
}

#[test]
fn removes_electron_ipc_transport_boilerplate_from_reference_diagnostics() {
    run(async {
        let f = bridge_fixture(json!({}));
        f.bridge.reject_once(
            "resolveAgentWorkspaceReferences",
            AgentError::new(
                "Error invoking remote method 'agent:reference-resolve-workspace': Error: An Agent file reference no longer exists.",
            ),
        );
        let controller = f.controller();
        controller.initialize(false).await.expect("initialize");
        assert_eq!(
            controller
                .add_workspace_paths(vec!["missing.md".into()], Vec::new())
                .await
                .expect("add"),
            0
        );
        let references = controller.get_snapshot().references;
        assert_eq!(references.len(), 1);
        assert_match(
            &j(&references[0]),
            &json!({
                "displayName": "missing.md",
                "status": "error",
                "error": { "code": "workspace-resolution-failed", "message": "An Agent file reference no longer exists." },
            }),
        );
        assert_eq!(
            j(&references[0])["error"].as_object().map(|e| e.len()),
            Some(2)
        );
    });
}

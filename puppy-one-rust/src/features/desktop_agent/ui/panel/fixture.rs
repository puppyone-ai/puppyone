//! Opt-in screenshot data for the Agent panel: a client port that serves one
//! recorded conversation through Main's own control and transcript
//! reducers. No provider startup, inference or credentials.
use super::AgentChatTabPanel;
use crate::agent::agent_error::AgentError;
use crate::agent::contract::js;
use crate::agent::domain::agent_control_view::project_agent_control_view;
use crate::agent::domain::agent_session_control::{
    create_agent_session_control, reduce_agent_session_control,
};
use crate::agent::domain::transcript::display_control::project_agent_display_control;
use crate::agent::domain::transcript::display_projection::ProjectionOptions;
use crate::agent::domain::transcript::transcript_reducer::{
    apply_agent_event, create_agent_projection,
};
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, Cleanup, ClientFuture,
};
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::infrastructure::host::window_runtime::WindowUiRuntime;
use gpui::{Context, Window};
use serde_json::{Value, json};
use std::rc::Rc;

fn event(
    sequence: i64,
    kind: &str,
    payload: Value,
    turn: Option<&str>,
    item: Option<&str>,
) -> Value {
    json!({
        "schemaVersion": 1, "sequence": sequence, "sessionId": "fixture-session", "runtimeId": "codex",
        "provider": "codex", "providerSessionId": "fixture-thread", "turnId": turn, "itemId": item,
        "emittedAt": js::iso_string(1_767_225_600_000 + sequence * 1_000), "type": kind, "payload": payload,
    })
}

fn conversation() -> Vec<Value> {
    let turn = Some("turn-1");
    vec![
        event(
            1,
            "session.resumed",
            json!({ "title": "Markdown editor review" }),
            None,
            None,
        ),
        event(
            2,
            "turn.started",
            json!({ "prompt": "Review the Markdown editor architecture." }),
            turn,
            None,
        ),
        event(
            3,
            "reasoning.summary.delta",
            json!({ "delta": "Looking for the session boundary and its persistence owner.", "completed": true }),
            turn,
            Some("reasoning-1"),
        ),
        event(
            4,
            "tool.completed",
            json!({ "kind": "command", "tool": "bash", "command": "rg -n \"DocumentSession\" src", "output": "src/editor/session.rs:12:pub struct DocumentSession\nsrc/editor/view.rs:40:session: DocumentSession,", "exitCode": 0 }),
            turn,
            Some("search-1"),
        ),
        event(
            5,
            "tool.completed",
            json!({ "tool": "read", "input": { "path": "src/editor/session.rs" }, "output": "pub struct DocumentSession { … }" }),
            turn,
            Some("read-1"),
        ),
        event(
            6,
            "tool.completed",
            json!({
                "kind": "file-change", "tool": "edit",
                "changes": [{ "path": "src/editor/session.rs", "additions": 4, "deletions": 1,
                    "blocks": [{ "removed": "fn apply(&self)", "added": "fn apply(&mut self, command: Command)" }] }],
            }),
            turn,
            Some("edit-1"),
        ),
        event(
            7,
            "assistant.completed",
            json!({ "text": "The editor uses a **shared document session**.\n\n- Input owns the selection.\n- The session owns persistence.\n- Views consume snapshots.\n\n```rust\nsession.apply(command);\n```" }),
            turn,
            Some("answer-1"),
        ),
        event(
            8,
            "turn.completed",
            json!({ "status": "completed" }),
            turn,
            None,
        ),
    ]
}

/// The recorded session snapshot (`displaySnapshot`).
fn snapshot(events: &[Value]) -> Value {
    let reduce = |control: &Value, input: Value| {
        reduce_agent_session_control(control, &input)
            .ok()
            .flatten()
            .unwrap_or_else(|| control.clone())
    };
    let mut control = reduce(
        &create_agent_session_control("fixture-stream", "fixture-epoch", "idle", 0),
        json!({ "type": "adapter.attached" }),
    );
    let mut display = create_agent_projection();
    for event in events {
        display = apply_agent_event(&display, event, ProjectionOptions::default());
        control = reduce(
            &control,
            json!({ "type": "event.accepted", "event": event }),
        );
    }
    let display = project_agent_display_control(&display, &control);
    json!({
        "session": {
            "id": "fixture-session", "runtimeId": "codex", "runtime": { "id": "codex", "displayName": "Codex", "iconKey": "codex" },
            "provider": "codex", "providerSessionId": "fixture-thread", "workspaceRoot": "/visual-reference-only",
            "title": (events.len() > 1).then_some("Markdown editor review"), "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
            "terminalState": display.get("presentation").map(|p| p["terminalState"].clone()).unwrap_or(Value::Null),
            "selectedModel": "gpt-5-codex", "selectedMode": "code", "activeTurnId": display.get("runningTurnId").cloned().unwrap_or(Value::Null),
            "lastSequence": events.len(),
        },
        "account": null,
        "providers": [],
        "models": models(),
        "modes": modes(),
        "commands": [],
        "capabilities": capabilities(),
        "events": [],
        "partial": false,
        "firstAvailableSequence": 1,
        "lastSequence": events.len(),
        "display": display.to_value(),
        "control": project_agent_control_view(&control),
        "cursor": { "streamId": control["streamId"], "revision": control["revision"] },
    })
}

fn models() -> Value {
    json!([{ "id": "gpt-5-codex", "model": "gpt-5-codex", "displayName": "GPT model with a long name", "description": "", "isDefault": true, "variants": ["low", "medium", "high"], "defaultVariant": "medium" }])
}

fn modes() -> Value {
    json!([
        { "id": "code", "displayName": "Code", "description": "", "isDefault": true },
        { "id": "plan", "displayName": "Plan", "description": "", "isDefault": false },
    ])
}

fn capabilities() -> Value {
    json!({
        "streamingText": true, "structuredToolEvents": true, "commandOutputStreaming": true, "fileChangeEvents": true,
        "manualApprovals": true, "structuredQuestions": true, "resume": true, "fork": false, "steer": false, "queue": false,
        "attachments": true, "contextReferences": true, "modelSelection": true, "modeSelection": true, "slashCommands": false,
        "sessionHistory": true, "usage": true, "accountState": false, "mcp": false, "skills": false, "compaction": false,
        "referenceInputs": {
            "schemaVersion": 1, "workspace": { "files": true, "directories": true },
            "attachments": { "image": { "accepted": true, "mimeTypes": ["image/png"] }, "text": { "accepted": false },
                "audio": { "accepted": false }, "video": { "accepted": false }, "binary": { "accepted": false } },
            "limits": { "maxCount": 32, "maxBytesPerReference": 26_214_400, "maxTotalBytes": 26_214_400 },
            "steer": false, "attachmentOnly": false,
        },
    })
}

fn inspection() -> Value {
    let readiness = json!({
        "runtimeId": "codex", "provider": "codex", "status": "ready", "code": "READY", "version": "0.144.1",
        "minimumVersion": "0.144.1", "message": "ready", "selectable": true,
    });
    let runtime = json!({ "id": "codex", "displayName": "Codex", "iconKey": "codex" });
    json!({
        "runtimes": [{ "descriptor": runtime, "readiness": readiness }],
        "selectedRuntimeId": "codex", "runtime": runtime, "readiness": readiness, "account": null,
        "providers": [], "models": models(), "modes": modes(), "commands": [], "capabilities": capabilities(), "warnings": [],
    })
}

/// The recorded conversation as a client port.
struct FixtureClient {
    snapshot: Option<Value>,
}

impl AgentClientPort for FixtureClient {
    fn implements(&self, method: &str) -> bool {
        matches!(
            method,
            "discoverAgentRuntimes"
                | "resumeAgentSession"
                | "createAgentSession"
                | "attachAgentSession"
                | "acknowledgeAgentSession"
                | "readAgentSessionWatermark"
                | "detachAgentSession"
                | "onAgentSessionFrame"
        )
    }

    fn call(&self, method: &str, request: Value) -> ClientFuture {
        let snapshot = self.snapshot.clone();
        // A fresh chat attaches to the session `createAgentSession` started.
        let current = snapshot
            .clone()
            .unwrap_or_else(|| self::snapshot(&conversation()[..1]));
        let result = match method {
            "discoverAgentRuntimes" => Ok(inspection()),
            "resumeAgentSession" => Ok(snapshot.unwrap_or(Value::Null)),
            "createAgentSession" => Ok(current),
            "attachAgentSession" => Ok(json!({ "subscriptionId": "fixture", "snapshot": current })),
            "acknowledgeAgentSession" => {
                let mut receipt = request;
                receipt["synchronized"] = Value::Bool(true);
                Ok(receipt)
            }
            "readAgentSessionWatermark" => Ok(json!({
                "subscriptionId": "fixture",
                "streamId": current["cursor"]["streamId"],
                "revision": current["cursor"]["revision"],
                "acknowledgedRevision": current["cursor"]["revision"],
                "resyncRequired": false,
            })),
            "detachAgentSession" => Ok(json!({ "subscriptionId": "fixture", "detached": true })),
            _ => Err(AgentError::new(
                "The visual fixture does not run Agent work.",
            )),
        };
        Box::pin(async move { result })
    }

    fn on_agent_session_frame(&self, _listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        Some(Box::new(|| {}))
    }
}

impl AgentChatTabPanel {
    /// A panel over the recorded conversation (`populated`) or a fresh chat.
    pub(crate) fn visual_fixture(
        populated: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let client: Rc<dyn AgentClientPort> = Rc::new(FixtureClient {
            snapshot: populated.then(|| snapshot(&conversation())),
        });
        let controller = AgentSessionController::new(
            "/visual-reference-only",
            Rc::new(move || Some(client.clone())),
            WindowUiRuntime::create(cx),
        );
        drop(controller.initialize(false));
        Self::new(controller, Vec::new(), window, cx)
    }
}

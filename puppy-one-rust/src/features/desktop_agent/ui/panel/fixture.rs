//! Opt-in screenshot data for the Agent panel: a client port that serves one
//! recorded conversation through Main's own control and transcript
//! reducers. No provider startup, inference or credentials.
use super::AgentChatTabPanel;
use crate::agent::agent_error::AgentError;
use crate::agent::contract::protocol::AgentOperation;
use crate::agent::domain::agent_control_view::project_agent_control_view;
use crate::agent::domain::agent_session_control::{
    create_agent_session_control, reduce_agent_session_control,
};
use crate::agent::domain::transcript::display_control::project_agent_display_control;
use crate::agent::domain::transcript::display_projection::ProjectionOptions;
use crate::agent::domain::transcript::transcript_reducer::{
    apply_agent_event, create_agent_projection,
};
use crate::features::desktop_agent::application::agent_client_port::{AgentClientPort, Cleanup};
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::fixtures::{JsonAgent, JsonAnswer, JsonPort};
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
    event_at(
        1_767_225_600_000 + sequence * 1_000,
        sequence,
        kind,
        payload,
        turn,
        item,
    )
}

fn event_at(
    at: i64,
    sequence: i64,
    kind: &str,
    payload: Value,
    turn: Option<&str>,
    item: Option<&str>,
) -> Value {
    json!({
        "schemaVersion": 1, "sequence": sequence, "sessionId": "fixture-session", "runtimeId": "codex",
        "provider": "codex", "providerSessionId": "fixture-thread", "turnId": turn, "itemId": item,
        "emittedAt": crate::clock::iso_string(at), "type": kind, "payload": payload,
    })
}

/// The reference entry's prompts and answers (`tools/reference-workbench-entry.tsx`).
const LAB_USER_1: &str = "Make the terminal colours follow the theme.";
const LAB_ANSWER_1: &str = "Two follow-ups:\n\n- Keep a soft divider beside the transcript.\n- Colours stay theme-owned.\n\n| Layer | Owner |\n| --- | --- |\n| Terminal | Theme pack |\n| Chat | Agent UI |";
const LAB_USER_2: &str = "Give the editor equal padding.";
const LAB_ANSWER_2: &str = "Changed `padding` to `24px` so both axes match.";

/// One reference chat scenario's events.
fn lab_conversation(scenario: &str) -> Vec<Value> {
    let empty = matches!(
        scenario,
        "chat-empty" | "chat-references" | "chat-picker" | "chat-activities"
    );
    let running = matches!(scenario, "chat-running" | "chat-approval" | "chat-question");
    let mut events = vec![event(
        0,
        "session.resumed",
        json!({ "title": "Codex" }),
        None,
        None,
    )];
    let push = |events: &mut Vec<Value>,
                at: i64,
                kind: &str,
                payload: Value,
                turn: Option<&str>,
                item: Option<&str>| {
        let sequence = events.len() as i64;
        events.push(event_at(at, sequence, kind, payload, turn, item));
    };
    let t0 = 1_767_225_600_000;
    if scenario == "chat-activities" {
        for (id, kind, label, status, category, source) in [
            (
                "a1",
                "provider.activity",
                "Signing in to Codex…",
                "running",
                Some("authentication"),
                None,
            ),
            (
                "a2",
                "provider.notification",
                "The lint-rules extension failed to load.",
                "failed",
                None,
                Some("Pi extension"),
            ),
            (
                "a3",
                "provider.notification",
                "Formatter installed.",
                "completed",
                None,
                Some("Pi extension"),
            ),
            (
                "a4",
                "provider.notification",
                "Workspace indexed: 128 files.",
                "completed",
                None,
                Some("Pi extension"),
            ),
        ] {
            push(
                &mut events,
                t0,
                kind,
                json!({
                    "label": label, "message": label, "status": status, "category": category, "source": source,
                }),
                None,
                Some(id),
            );
        }
    }
    if empty {
        return events;
    }
    let one = Some("turn-1");
    push(
        &mut events,
        t0,
        "turn.started",
        json!({ "prompt": LAB_USER_1 }),
        one,
        None,
    );
    push(
        &mut events,
        t0 + 2_000,
        "assistant.completed",
        json!({ "text": LAB_ANSWER_1 }),
        one,
        Some("assistant-1"),
    );
    push(
        &mut events,
        t0 + 2_400,
        "turn.completed",
        json!({ "status": "completed" }),
        one,
        None,
    );
    let t1 = if running {
        crate::clock::now_ms() - 12_000
    } else {
        t0 + 60_000
    };
    let two = Some("turn-2");
    let status = if running { "running" } else { "completed" };
    let settles = if running {
        "tool.started"
    } else {
        "tool.completed"
    };
    push(
        &mut events,
        t1,
        "turn.started",
        json!({ "prompt": LAB_USER_2 }),
        two,
        None,
    );
    push(
        &mut events,
        t1 + 1_000,
        "reasoning.summary.delta",
        json!({
            "delta": "Located the editor surface padding and compared both axes.", "completed": true,
        }),
        two,
        Some("reasoning-1"),
    );
    push(
        &mut events,
        t1 + 1_500,
        "tool.completed",
        json!({ "tool": "compaction", "status": "completed" }),
        two,
        Some("compaction-1"),
    );
    push(
        &mut events,
        t1 + 2_000,
        settles,
        json!({
            "kind": "search", "tool": "grep", "status": status, "input": { "pattern": "padding", "path": "src" },
            "output": "src/markdown-editor.css:42:padding: 12px 24px;\nsrc/editor-shell.css:18:padding-inline: 24px;",
        }),
        two,
        Some("tool-grep"),
    );
    push(
        &mut events,
        t1 + 3_000,
        "tool.completed",
        json!({
            "kind": "command", "tool": "bash", "command": "rg -n padding src/markdown-editor.css",
            "output": "42:  padding: 12px 24px;", "exitCode": 0,
        }),
        two,
        Some("tool-command"),
    );
    push(
        &mut events,
        t1 + 4_000,
        settles,
        json!({
            "kind": "read", "tool": "read", "status": status, "input": { "file_path": "src/markdown-editor.css" },
            "output": ".markdown-editor {\n  padding: 12px 24px;\n}",
        }),
        two,
        Some("tool-read"),
    );
    push(
        &mut events,
        t1 + 5_000,
        "tool.completed",
        json!({
            "kind": "file-change", "tool": "edit",
            "changes": [{ "path": "src/markdown-editor.css", "additions": 1, "deletions": 1,
                "diff": "@@ -42,1 +42,1 @@\n-  padding: 12px 24px;\n+  padding: 24px;" }],
        }),
        two,
        Some("tool-edit"),
    );
    if !running {
        push(
            &mut events,
            t1 + 30_000,
            "assistant.completed",
            json!({ "text": LAB_ANSWER_2 }),
            two,
            Some("assistant-2"),
        );
        push(
            &mut events,
            t1 + 31_000,
            "turn.completed",
            json!({ "status": "completed" }),
            two,
            None,
        );
    }
    if scenario == "chat-approval" {
        push(
            &mut events,
            t1 + 6_000,
            "approval.requested",
            json!({
                "requestId": "reference-approval", "title": "Run rg -n padding src", "kind": "command",
                "command": "rg -n padding src", "cwd": "/reference/project",
                "reason": "Search the project for padding declarations",
                "availableDecisions": ["accept", "acceptForSession", "decline", "cancel"],
            }),
            two,
            Some("approval-1"),
        );
    }
    if scenario == "chat-question" {
        push(
            &mut events,
            t1 + 6_000,
            "question.requested",
            json!({
                "requestId": "reference-question",
                "questions": [{
                    "id": "padding", "header": "Padding", "question": "Which padding should the editor use?",
                    "options": [
                        { "label": "24px on every side", "description": "Match the horizontal padding" },
                        { "label": "Keep 12px vertical", "description": "Only widen the sides" },
                    ],
                    "multiSelect": false, "isOther": true,
                }],
            }),
            two,
            Some("question-1"),
        );
    }
    events
}

/// `PICKER_MODELS`: eight models in the picker scenario, so it searches.
fn lab_models(scenario: &str) -> Value {
    let mut models = vec![("gpt-5.4", "GPT-5.4"), ("gpt-5.4-mini", "GPT-5.4 Mini")];
    if scenario == "chat-picker" {
        models.extend([
            ("gpt-5.3-codex", "GPT-5.3 Codex"),
            ("gpt-5.2", "GPT-5.2"),
            ("o4-mini", "o4-mini"),
            ("o3", "o3"),
            ("gpt-4.1", "GPT-4.1"),
            ("gpt-4.1-mini", "GPT-4.1 Mini"),
        ]);
    }
    Value::Array(
        models
            .into_iter()
            .enumerate()
            .map(|(index, (id, label))| {
                json!({
                    "id": id, "model": id, "displayName": label, "description": "", "isDefault": index == 0,
                    "variants": ["low", "medium", "high"], "defaultVariant": "medium",
                })
            })
            .collect(),
    )
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
fn snapshot(events: &[Value], models: &Value, title: Option<&str>) -> Value {
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
            "title": title, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
            "terminalState": display.get("presentation").map(|p| p["terminalState"].clone()).unwrap_or(Value::Null),
            "selectedModel": models[0]["model"], "selectedMode": "code", "activeTurnId": display.get("runningTurnId").cloned().unwrap_or(Value::Null),
            "lastSequence": events.len(),
        },
        "account": null,
        "providers": [],
        "models": models,
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

fn inspection(models: &Value) -> Value {
    let readiness = json!({
        "runtimeId": "codex", "provider": "codex", "status": "ready", "code": "READY", "version": "0.144.1",
        "minimumVersion": "0.144.1", "message": "ready", "selectable": true,
    });
    let runtime = json!({ "id": "codex", "displayName": "Codex", "iconKey": "codex" });
    json!({
        "runtimes": [{ "descriptor": runtime, "readiness": readiness }],
        "selectedRuntimeId": "codex", "runtime": runtime, "readiness": readiness, "account": null,
        "providers": [], "models": models, "modes": modes(), "commands": [], "capabilities": capabilities(), "warnings": [],
    })
}

/// The recorded conversation as a client port.
struct FixtureClient {
    snapshot: Option<Value>,
    /// The session a fresh chat starts.
    fresh: Value,
    models: Value,
}

impl JsonAgent for FixtureClient {
    fn supports(&self, operation: AgentOperation) -> bool {
        use AgentOperation as O;
        matches!(
            operation,
            O::DiscoverRuntimes
                | O::ResumeSession
                | O::CreateSession
                | O::AttachSession
                | O::AcknowledgeFeed
                | O::ReadFeedWatermark
                | O::DetachFeed
        )
    }

    fn delivers_frames(&self) -> bool {
        true
    }

    fn answer(&self, operation: AgentOperation, request: Value) -> JsonAnswer {
        use AgentOperation as O;
        let snapshot = self.snapshot.clone();
        // A fresh chat attaches to the session `createAgentSession` started.
        let current = snapshot.clone().unwrap_or_else(|| self.fresh.clone());
        let result = match operation {
            O::DiscoverRuntimes => Ok(inspection(&self.models)),
            O::ResumeSession => Ok(snapshot.unwrap_or(Value::Null)),
            O::CreateSession => Ok(current),
            O::AttachSession => Ok(json!({ "subscriptionId": "fixture", "snapshot": current })),
            O::AcknowledgeFeed => {
                let mut receipt = request;
                receipt["synchronized"] = Value::Bool(true);
                Ok(receipt)
            }
            O::ReadFeedWatermark => Ok(json!({
                "subscriptionId": "fixture",
                "streamId": current["cursor"]["streamId"],
                "revision": current["cursor"]["revision"],
                "acknowledgedRevision": current["cursor"]["revision"],
                "resyncRequired": false,
            })),
            O::DetachFeed => Ok(json!({ "subscriptionId": "fixture", "detached": true })),
            _ => Err(AgentError::new(
                "The visual fixture does not run Agent work.",
            )),
        };
        Box::pin(async move { result })
    }

    fn on_frame(&self, _listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        Some(Box::new(|| {}))
    }
}

/// The lab's UI state, applied once the conversation shows.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct LabState {
    picker: bool,
    expand_command: bool,
    references: bool,
}

impl AgentChatTabPanel {
    fn fixture(client: FixtureClient, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let client: Rc<dyn AgentClientPort> = Rc::new(JsonPort(client));
        let controller = AgentSessionController::new(
            "/visual-reference-only",
            Rc::new(move || Some(client.clone())),
            WindowUiRuntime::create(cx),
        );
        drop(controller.initialize(false));
        Self::new(controller, Vec::new(), window, cx)
    }

    /// A panel over the recorded conversation (`populated`) or a fresh chat.
    pub(crate) fn visual_fixture(
        populated: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let events = conversation();
        let models = models();
        Self::fixture(
            FixtureClient {
                snapshot: populated
                    .then(|| snapshot(&events, &models, Some("Markdown editor review"))),
                fresh: snapshot(&events[..1], &models, None),
                models,
            },
            window,
            cx,
        )
    }

    /// The pixel lab's chat `scenario` (`tools/workbench-scenarios.json`).
    pub(crate) fn lab_fixture(scenario: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let models = lab_models(scenario);
        let events = lab_conversation(scenario);
        let mut panel = Self::fixture(
            FixtureClient {
                snapshot: Some(snapshot(&events, &models, Some("Codex"))),
                fresh: snapshot(&events[..1], &models, None),
                models,
            },
            window,
            cx,
        );
        panel.lab = Some(LabState {
            picker: scenario == "chat-picker",
            expand_command: scenario == "chat-tool-expanded",
            references: scenario == "chat-references",
        });
        panel
    }

    /// Applies the lab's UI state once its conversation is attached.
    pub(super) fn apply_lab_state(&mut self, cx: &mut Context<Self>) {
        let Some(lab) = self.lab.clone() else {
            return;
        };
        let state = self.state();
        if state.session.is_none() {
            return;
        }
        if lab.picker {
            self.picker_open =
                Some(crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControlId::Model);
        }
        if lab.expand_command {
            let row = self
                .rows
                .iter()
                .find(|row| row.tool_group)
                .map(|row| row.row.id.clone());
            let Some(row) = row else {
                return;
            };
            let part = self
                .parts
                .keys()
                .find(|id| id.contains("tool-command"))
                .cloned();
            if let Some(part) = part {
                self.group_selected.insert(row.clone(), part);
                self.splice_row(&row);
            }
        }
        if lab.references {
            // The product fixture's draft: `@README.md ` with its mention,
            // and a screenshot attachment.
            let epoch = self.controller.export_display_draft().reference_epoch;
            drop(self.controller.restore_display_draft(
                crate::features::desktop_agent::application::agent_session_controller::DisplayDraft {
                    text: "@README.md ".into(),
                    mentions: serde_json::from_value(json!([{ "referenceId": "ref-file", "start": 0, "end": 10 }])).unwrap_or_default(),
                    references: serde_json::from_value(json!([
                        { "id": "ref-image", "kind": "staged-attachment", "token": "lab", "displayName": "screenshot.png", "mime": "image/png", "size": 256, "status": "ready" },
                        { "id": "ref-file", "kind": "workspace-entry", "entryType": "file", "relativePath": "README.md", "displayName": "README.md", "status": "ready" },
                    ])).unwrap_or_default(),
                    reference_epoch: epoch,
                },
            ));
        }
        self.lab = None;
        cx.notify();
    }
}

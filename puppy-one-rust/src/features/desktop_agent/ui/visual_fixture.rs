//! Opt-in screenshot data. No provider startup, inference, or credentials.
use super::*;
use crate::agent::{
    domain::agent_session_model::SessionSnapshot,
    runtime::{agent_runtime_registry::Runtime, session_lease::Unavailable},
};
impl AgentChat {
    pub(crate) fn visual_fixture(
        populated: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut snapshot = SessionSnapshot::new("Codex", false);
        snapshot.state = State::Idle;
        snapshot.title = "Codex".into();
        snapshot.models = vec![("fixture".into(), "GPT model with a long name".into())];
        snapshot.model = Some("fixture".into());
        snapshot.modes = vec![
            ("code".into(), "Code".into()),
            ("plan".into(), "Plan".into()),
        ];
        snapshot.mode = Some("code".into());
        snapshot.efforts = vec!["low".into(), "medium".into(), "high".into()];
        snapshot.effort = Some("medium".into());
        snapshot.capabilities.models = true;
        snapshot.capabilities.modes = true;
        snapshot.capabilities.history = true;
        if populated {
            snapshot.upsert(
                "user",
                "You",
                "Review the Markdown editor architecture.",
                "",
            );
            snapshot.upsert("answer", "Codex", "The editor uses a **shared document session**.\n\n- Input owns the selection.\n- The session owns persistence.\n- Views consume snapshots.\n\n```rust\nsession.apply(command);\n```", "");
        }
        let failed = std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("agent-failed");
        if failed {
            snapshot.state = State::Failed;
            snapshot.error = Some("codex app-server exited with status 1 (fixture)".into());
        }
        let mut view = Self::with_client_factory(
            Installation {
                runtime: Runtime::Codex,
                id: "codex",
                label: "Codex".into(),
                executable: PathBuf::new(),
                chat: true,
            },
            PathBuf::new(),
            false,
            window,
            cx,
            move |_, _, _, _| Box::new(Unavailable { snapshot }),
        );
        view.diagnostics_open = failed;
        view.refresh_transcript();
        view
    }
}

/// Right-sidebar lab content; mirrors `tools/reference-workbench-entry.tsx`.
pub(crate) const LAB_USER_1: &str = "Make the terminal colours follow the theme.";
pub(crate) const LAB_ANSWER_1: &str = "Two follow-ups:\n\n- Keep a soft divider beside the transcript.\n- Colours stay theme-owned.\n\n| Layer | Owner |\n| --- | --- |\n| Terminal | Theme pack |\n| Chat | Agent UI |";
pub(crate) const LAB_USER_2: &str = "Give the editor equal padding.";
/// `LAB_IMAGE_PNG` in the reference entry: an 80x80 four-quadrant PNG.
pub(crate) const LAB_IMAGE_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAAhklEQVR42u3RMQ3AIBRFUdowdcZKBXSrCqZqIMEKM+IqAxl/4FwDLyfv+PubIvrKCNk902YBAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA0eX23OHDM+rehgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYeIcW8P0FVRa1ROAAAAAASUVORK5CYII=";
pub(crate) const LAB_ANSWER_2: &str = "Changed `padding` to `24px` so both axes match.";

impl AgentChat {
    pub(crate) fn lab_fixture(
        scenario: &str,
        installation: Installation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let label = installation.label.clone();
        let mut snapshot = SessionSnapshot::new(&label, false);
        snapshot.state = State::Idle;
        snapshot.title = label.clone();
        snapshot.models = vec![
            ("gpt-5.4".into(), "GPT-5.4".into()),
            ("gpt-5.4-mini".into(), "GPT-5.4 Mini".into()),
        ];
        if scenario == "chat-picker" {
            // `PICKER_MODELS`: eight models, so the picker is searchable.
            snapshot.models.extend(
                [
                    ("gpt-5.3-codex", "GPT-5.3 Codex"),
                    ("gpt-5.2", "GPT-5.2"),
                    ("o4-mini", "o4-mini"),
                    ("o3", "o3"),
                    ("gpt-4.1", "GPT-4.1"),
                    ("gpt-4.1-mini", "GPT-4.1 Mini"),
                ]
                .map(|(id, label)| (id.to_owned(), label.to_owned())),
            );
        }
        snapshot.model = Some("gpt-5.4".into());
        snapshot.efforts = vec!["low".into(), "medium".into(), "high".into()];
        snapshot.effort = Some("medium".into());
        snapshot.modes = vec![
            ("code".into(), "Code".into()),
            ("plan".into(), "Plan".into()),
        ];
        snapshot.mode = Some("code".into());
        snapshot.capabilities.models = true;
        snapshot.capabilities.modes = true;
        let running = matches!(scenario, "chat-running" | "chat-approval" | "chat-question");
        let empty = matches!(scenario, "chat-empty" | "chat-references" | "chat-picker");
        if !empty {
            let status = if running { "running" } else { "completed" };
            snapshot.upsert("user:1", "You", LAB_USER_1, "");
            snapshot.upsert("assistant:1", &label, LAB_ANSWER_1, "completed");
            snapshot.upsert("user:2", "You", LAB_USER_2, "");
            snapshot.upsert(
                "reasoning:1",
                "Reasoning",
                "Located the editor surface padding and compared both axes.",
                "completed",
            );
            snapshot.tool_result("compaction:1", "compaction", "", "completed");
            snapshot.tool_call(
                "tool:grep",
                "grep",
                r#"{"pattern":"padding","path":"src"}"#,
                status,
            );
            snapshot.tool_result(
                "tool:grep",
                "grep",
                "src/markdown-editor.css:42:padding: 12px 24px;\nsrc/editor-shell.css:18:padding-inline: 24px;",
                status,
            );
            snapshot.tool_call(
                "tool:command",
                "Command",
                "rg -n padding src/markdown-editor.css",
                "completed",
            );
            snapshot.tool_result(
                "tool:command",
                "Command",
                "42:  padding: 12px 24px;",
                "completed",
            );
            snapshot.tool_call(
                "tool:read",
                "read",
                r#"{"file_path":"src/markdown-editor.css"}"#,
                status,
            );
            snapshot.tool_result(
                "tool:read",
                "read",
                ".markdown-editor {\n  padding: 12px 24px;\n}",
                status,
            );
            snapshot.tool_result(
                "tool:edit",
                "File changes",
                "src/markdown-editor.css\n@@ -42,1 +42,1 @@\n-  padding: 12px 24px;\n+  padding: 24px;",
                "completed",
            );
            if running {
                snapshot.state = State::Running;
                snapshot.turn = Some("turn-2".into());
            } else {
                snapshot.upsert("assistant:2", &label, LAB_ANSWER_2, "completed");
            }
            if scenario == "chat-approval" {
                snapshot
                    .interactions
                    .push(crate::agent::domain::agent_session_model::Interaction {
                    id: serde_json::Value::String("reference-approval".into()),
                    thread: String::new(),
                    turn: "turn-2".into(),
                    kind: crate::agent::domain::agent_session_model::InteractionKind::Approval {
                        command: true,
                        prompt: "rg -n padding src".into(),
                        decisions: vec![
                            crate::agent::domain::agent_session_model::Decision::Accept,
                            crate::agent::domain::agent_session_model::Decision::AcceptForSession,
                            crate::agent::domain::agent_session_model::Decision::Decline,
                            crate::agent::domain::agent_session_model::Decision::Cancel,
                        ],
                        title: "Run rg -n padding src".into(),
                        command_line: Some("rg -n padding src".into()),
                        cwd: Some("/reference/project".into()),
                        reason: Some("Search the project for padding declarations".into()),
                    },
                });
            }
            if scenario == "chat-question" {
                snapshot.interactions.push(
                    crate::agent::domain::agent_session_model::Interaction {
                        id: serde_json::Value::String("reference-question".into()),
                        thread: String::new(),
                        turn: "turn-2".into(),
                        kind: crate::agent::domain::agent_session_model::InteractionKind::Questions(
                            vec![crate::agent::domain::agent_session_model::Question {
                                id: "padding".into(),
                                text: "Which padding should the editor use?".into(),
                                options: vec![
                                    "24px on every side".into(),
                                    "Keep 12px vertical".into(),
                                ],
                                descriptions: vec![
                                    "Match the horizontal padding".into(),
                                    "Only widen the sides".into(),
                                ],
                                header: "Padding".into(),
                                multiple: false,
                                custom: true,
                            }],
                        ),
                    },
                );
            }
        }
        let mut view = Self::with_client_factory(
            installation,
            PathBuf::new(),
            false,
            window,
            cx,
            move |_, _, _, _| Box::new(Unavailable { snapshot }),
        );
        use crate::features::desktop_agent::application::agent_session_controller::{
            RunningTurn, TurnOutcome, TurnTiming, now_ms,
        };
        if !empty {
            let completed = |duration_ms| TurnTiming {
                duration_ms,
                outcome: TurnOutcome::Completed,
            };
            view.session
                .turn_timings
                .insert("user:1".into(), completed(2_400));
            if running {
                view.session.running = Some(RunningTurn {
                    started_ms: now_ms().saturating_sub(12_000),
                    user_wait_ms: 0,
                    user_wait_started_ms: None,
                });
            } else {
                view.session
                    .turn_timings
                    .insert("user:2".into(), completed(31_000));
            }
        }
        if scenario == "chat-picker" {
            view.picker_open = Some("model-picker");
        }
        if scenario == "chat-references" {
            use crate::agent::domain::reference_input::{Reference, ReferenceContent};
            view.session.references = vec![
                Reference {
                    id: "ref-image".into(),
                    name: "screenshot.png".into(),
                    source: "screenshot.png".into(),
                    content: ReferenceContent::Image {
                        mime: "image/png".into(),
                        data: LAB_IMAGE_PNG.into(),
                    },
                    bytes: 256,
                },
                Reference {
                    id: "ref-file".into(),
                    name: "README.md".into(),
                    source: "README.md".into(),
                    content: ReferenceContent::Text(String::new()),
                    bytes: 0,
                },
            ];
        }
        if scenario == "chat-tool-expanded" {
            view.rail_selected
                .insert("tool-group:row:tool:grep".into(), "tool:command".into());
        }
        view.refresh_transcript();
        view
    }
}

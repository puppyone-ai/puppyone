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
        if scenario != "chat-empty" {
            let running = matches!(scenario, "chat-running" | "chat-approval" | "chat-question");
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
            snapshot.upsert("tool:grep", "grep", "padding src\nsrc/markdown-editor.css:42:padding: 12px 24px;\nsrc/editor-shell.css:18:padding-inline: 24px;", status);
            snapshot.upsert(
                "tool:command",
                "Command",
                "rg -n padding src/markdown-editor.css\n42:  padding: 12px 24px;",
                "completed",
            );
            snapshot.upsert(
                "tool:read",
                "read",
                "src/markdown-editor.css\n.markdown-editor {\n  padding: 12px 24px;\n}",
                status,
            );
            snapshot.upsert("tool:edit", "File changes", "src/markdown-editor.css\n@@ -42,1 +42,1 @@\n-  padding: 12px 24px;\n+  padding: 24px;", "completed");
            if running {
                snapshot.state = State::Running;
                snapshot.turn = Some("turn-2".into());
            } else {
                snapshot.upsert("assistant:2", &label, LAB_ANSWER_2, "completed");
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
        view.refresh_transcript();
        view
    }
}

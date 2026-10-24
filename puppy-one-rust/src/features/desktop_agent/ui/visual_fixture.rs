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

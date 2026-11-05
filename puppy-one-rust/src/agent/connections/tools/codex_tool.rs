//! `connections/tools/codex-tool.mjs`.
use super::local_agent_tool_registry::LocalAgentToolDescriptor;
use crate::agent::connections::probes::codex_local_probe::{CodexProbeOptions, probe_codex_local};
use std::rc::Rc;

/// `CODEX_LOCAL_TOOL`.
pub fn codex_local_tool() -> LocalAgentToolDescriptor {
    LocalAgentToolDescriptor {
        id: "codex".into(),
        installation_id: Some("codex".into()),
        display_name: "Codex".into(),
        executable_names: None,
        probe: Some(Rc::new(|request| {
            Box::pin(async move {
                Ok(probe_codex_local(CodexProbeOptions {
                    candidate: request.candidate,
                    app_version: Some(request.app_version),
                    workspace_root: request.workspace_root,
                    env: Some(request.env),
                    signal: Some(request.signal),
                    ..Default::default()
                })
                .await)
            })
        })),
        unavailable_message: "Native Codex readiness is evaluated through its app-server protocol."
            .into(),
    }
}

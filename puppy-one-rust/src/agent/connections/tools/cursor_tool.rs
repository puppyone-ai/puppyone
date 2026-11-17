//! `connections/tools/cursor-tool.mjs`.
use super::local_agent_tool_registry::LocalAgentToolDescriptor;
use crate::agent::connections::probes::cursor_local_probe::probe_cursor_local;
use std::rc::Rc;

/// `CURSOR_LOCAL_TOOL`.
pub fn cursor_local_tool() -> LocalAgentToolDescriptor {
    LocalAgentToolDescriptor {
        id: "cursor-agent".into(),
        installation_id: Some("cursor".into()),
        display_name: "Cursor Agent".into(),
        executable_names: None,
        probe: Some(Rc::new(|request| {
            Box::pin(async move {
                Ok(probe_cursor_local(
                    request.candidate.as_ref(),
                    None,
                    &request.env,
                    Some(request.signal),
                )
                .await)
            })
        })),
        unavailable_message: "Install Cursor Agent and sign in to use its native ACP harness."
            .into(),
    }
}

//! `connections/tools/claude-tool.mjs`.
use super::local_agent_tool_registry::LocalAgentToolDescriptor;
use crate::agent::connections::probes::versioned_local_agent_probe::probe_versioned_local_agent;
use std::rc::Rc;

/// `CLAUDE_LOCAL_TOOL`.
pub fn claude_local_tool() -> LocalAgentToolDescriptor {
    LocalAgentToolDescriptor {
        id: "claude".into(),
        installation_id: Some("claude".into()),
        display_name: "Claude Code".into(),
        executable_names: None,
        probe: Some(Rc::new(|request| {
            Box::pin(async move {
                Ok(probe_versioned_local_agent(
                    request.candidate.as_ref(),
                    "claude",
                    "Claude Code",
                    &request.env,
                    Some(request.signal),
                )
                .await)
            })
        })),
        unavailable_message:
            "Claude Code terminal sessions are launched only from a verified local installation."
                .into(),
    }
}

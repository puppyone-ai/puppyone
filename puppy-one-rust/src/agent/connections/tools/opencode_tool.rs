//! `connections/tools/opencode-tool.mjs`.
use super::local_agent_tool_registry::LocalAgentToolDescriptor;
use crate::agent::connections::probes::versioned_local_agent_probe::probe_versioned_local_agent;
use std::rc::Rc;

/// `OPENCODE_LOCAL_TOOL`.
pub fn opencode_local_tool() -> LocalAgentToolDescriptor {
    LocalAgentToolDescriptor {
        id: "opencode".into(),
        installation_id: Some("opencode".into()),
        display_name: "OpenCode".into(),
        executable_names: None,
        probe: Some(Rc::new(|request| {
            Box::pin(async move {
                Ok(probe_versioned_local_agent(
                    request.candidate.as_ref(),
                    "opencode",
                    "OpenCode",
                    &request.env,
                    Some(request.signal),
                )
                .await)
            })
        })),
        unavailable_message:
            "OpenCode terminal sessions are launched only from a verified local installation."
                .into(),
    }
}

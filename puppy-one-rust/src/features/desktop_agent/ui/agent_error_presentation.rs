//! `ui/agentErrorPresentation.ts`.
use crate::features::desktop_agent::application::agent_error::ErrorDescriptor;
use crate::localization::{Arg, bidi_isolate, t, tf};

/// `AgentErrorPresentation`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentErrorPresentation {
    pub summary: String,
    pub detail: Option<String>,
}

/// `presentAgentError(error, t)`: an `AgentErrorDescriptor`.
pub fn present_agent_error(error: Option<&ErrorDescriptor>) -> Option<AgentErrorPresentation> {
    let error = error?;
    let code = if error.code.is_empty() {
        "unknown"
    } else {
        error.code.as_str()
    };
    let mut params: Vec<(String, Arg)> = error
        .params
        .iter()
        .map(|(key, value)| (key.clone(), Arg::Text(bidi_isolate(value))))
        .collect();
    if code == "runtime-exited" && !params.iter().any(|(key, _)| key == "runtime") {
        params.push(("runtime".into(), Arg::Text(bidi_isolate(t("agent.name")))));
    }
    let args: Vec<(&str, Arg)> = params
        .iter()
        .map(|(key, arg)| (key.as_str(), arg.clone()))
        .collect();
    Some(AgentErrorPresentation {
        summary: tf(&format!("agent.error.{code}"), &args),
        detail: error.detail.clone().filter(|d| !d.is_empty()),
    })
}

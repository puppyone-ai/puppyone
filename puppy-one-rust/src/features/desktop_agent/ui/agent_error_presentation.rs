//! `ui/agentErrorPresentation.ts`.
use crate::localization::{Arg, bidi_isolate, t, tf};
use serde_json::Value;

/// `AgentErrorPresentation`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentErrorPresentation {
    pub summary: String,
    pub detail: Option<String>,
}

/// `presentAgentError(error, t)`: an `AgentErrorDescriptor`.
pub fn present_agent_error(error: Option<&Value>) -> Option<AgentErrorPresentation> {
    let error = error.filter(|e| e.is_object())?;
    let code = error["code"].as_str().unwrap_or("unknown");
    let mut params: Vec<(String, Arg)> = error["params"]
        .as_object()
        .map(|params| {
            params
                .iter()
                .map(|(key, value)| {
                    let arg = match value {
                        Value::String(text) => Arg::Text(bidi_isolate(text)),
                        Value::Number(number) => number
                            .as_i64()
                            .map_or_else(|| Arg::Text(number.to_string()), Arg::Number),
                        other => Arg::Text(other.to_string()),
                    };
                    (key.clone(), arg)
                })
                .collect()
        })
        .unwrap_or_default();
    if code == "runtime-exited" && !params.iter().any(|(key, _)| key == "runtime") {
        params.push(("runtime".into(), Arg::Text(bidi_isolate(t("agent.name")))));
    }
    let args: Vec<(&str, Arg)> = params
        .iter()
        .map(|(key, arg)| (key.as_str(), arg.clone()))
        .collect();
    Some(AgentErrorPresentation {
        summary: tf(&format!("agent.error.{code}"), &args),
        detail: error["detail"]
            .as_str()
            .filter(|d| !d.is_empty())
            .map(str::to_string),
    })
}

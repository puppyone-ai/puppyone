//! `domain/agent-backend-routing.ts`: the Renderer-safe Agent backend
//! catalog derived only from the shared inspection DTO.
use serde_json::{Value, json};

/// `listAgentRuntimes(inspection)`.
pub fn list_agent_runtimes(inspection: Option<&Value>) -> Vec<Value> {
    let Some(inspection) = inspection else {
        return Vec::new();
    };
    if let Some(runtimes) = inspection["runtimes"].as_array().filter(|r| !r.is_empty()) {
        return runtimes.clone();
    }
    let (runtime, readiness) = (&inspection["runtime"], &inspection["readiness"]);
    if !runtime.is_object() || !readiness.is_object() {
        return Vec::new();
    }
    vec![json!({ "descriptor": runtime, "readiness": readiness })]
}

fn installed(entry: &Value) -> bool {
    entry["readiness"]["status"] != "not-installed"
}

/// `listEnabledAgentRuntimes(inspection, enabledRuntimeIds)`.
pub fn list_enabled_agent_runtimes(
    inspection: Option<&Value>,
    enabled_runtime_ids: Option<&[String]>,
) -> Vec<Value> {
    list_agent_runtimes(inspection)
        .into_iter()
        .filter(|entry| {
            installed(entry)
                && enabled_runtime_ids.is_none_or(|enabled| {
                    enabled
                        .iter()
                        .any(|id| entry["descriptor"]["id"] == id.as_str())
                })
        })
        .collect()
}

/// `listVisibleAgentRuntimes(inspection, hiddenRuntimeIds)`: the new-chat
/// catalog filtered by the user's Active Chat visibility settings.
pub fn list_visible_agent_runtimes(
    inspection: Option<&Value>,
    hidden_runtime_ids: &[String],
) -> Vec<Value> {
    list_agent_runtimes(inspection)
        .into_iter()
        .filter(|entry| {
            installed(entry)
                && !hidden_runtime_ids
                    .iter()
                    .any(|id| entry["descriptor"]["id"] == id.as_str())
        })
        .collect()
}

/// `isSelectableAgentBackend(entry)`.
pub fn is_selectable_agent_backend(entry: &Value) -> bool {
    entry["readiness"]["status"] == "ready" && entry["readiness"]["selectable"] != false
}

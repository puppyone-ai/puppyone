//! `domain/agent-backend-routing.ts`: the Renderer-safe Agent backend
//! catalog derived only from the shared inspection DTO.
use crate::agent::contract::dto::{RuntimeCatalogEntry, RuntimeInspection};

/// `listAgentRuntimes(inspection)`.
pub fn list_agent_runtimes(inspection: Option<&RuntimeInspection>) -> Vec<RuntimeCatalogEntry> {
    let Some(inspection) = inspection else {
        return Vec::new();
    };
    if let Some(runtimes) = inspection.runtimes.as_ref().filter(|r| !r.is_empty()) {
        return runtimes.clone();
    }
    let (Some(runtime), Some(readiness)) = (&inspection.runtime, &inspection.readiness) else {
        return Vec::new();
    };
    vec![RuntimeCatalogEntry {
        descriptor: runtime.clone(),
        readiness: readiness.clone(),
    }]
}

fn installed(entry: &RuntimeCatalogEntry) -> bool {
    entry.readiness.status != "not-installed"
}

/// `listEnabledAgentRuntimes(inspection, enabledRuntimeIds)`.
pub fn list_enabled_agent_runtimes(
    inspection: Option<&RuntimeInspection>,
    enabled_runtime_ids: Option<&[String]>,
) -> Vec<RuntimeCatalogEntry> {
    list_agent_runtimes(inspection)
        .into_iter()
        .filter(|entry| {
            installed(entry)
                && enabled_runtime_ids.is_none_or(|enabled| enabled.contains(&entry.descriptor.id))
        })
        .collect()
}

/// `listVisibleAgentRuntimes(inspection, hiddenRuntimeIds)`: the new-chat
/// catalog filtered by the user's Active Chat visibility settings.
pub fn list_visible_agent_runtimes(
    inspection: Option<&RuntimeInspection>,
    hidden_runtime_ids: &[String],
) -> Vec<RuntimeCatalogEntry> {
    list_agent_runtimes(inspection)
        .into_iter()
        .filter(|entry| installed(entry) && !hidden_runtime_ids.contains(&entry.descriptor.id))
        .collect()
}

/// `isSelectableAgentBackend(entry)`.
pub fn is_selectable_agent_backend(entry: &RuntimeCatalogEntry) -> bool {
    entry.readiness.is_ready() && entry.readiness.selectable != Some(false)
}

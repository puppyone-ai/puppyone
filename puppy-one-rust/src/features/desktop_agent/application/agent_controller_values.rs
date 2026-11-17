//! `application/agent-controller-values.ts`.
use crate::agent::contract::dto::{DraftReference, Model, RuntimeInspection};

/// `chooseAgentMode(inspection, current)`.
pub fn choose_agent_mode(
    inspection: Option<&RuntimeInspection>,
    current: Option<&str>,
) -> Option<String> {
    let modes = inspection.map(|i| i.mode_list()).unwrap_or_default();
    let id = |id: &str| (!id.is_empty()).then(|| id.to_string());
    if let Some(current) = current.filter(|c| !c.is_empty())
        && modes.iter().any(|mode| mode.id == current)
    {
        return Some(current.to_string());
    }
    modes
        .iter()
        .find(|mode| mode.is_default)
        .and_then(|mode| id(&mode.id))
        .or_else(|| modes.first().and_then(|mode| id(&mode.id)))
}

/// `chooseAgentEffort(model, current)`.
pub fn choose_agent_effort(model: Option<&Model>, current: Option<&str>) -> Option<String> {
    let efforts: &[String] = model
        .and_then(|m| m.variants.as_deref())
        .unwrap_or_default();
    if let Some(current) = current.filter(|c| !c.is_empty())
        && efforts.iter().any(|e| e == current)
    {
        return Some(current.to_string());
    }
    if let Some(default) = model
        .and_then(|m| m.default_variant.as_deref())
        .filter(|d| efforts.iter().any(|e| e == d))
    {
        return Some(default.to_string());
    }
    if efforts.iter().any(|e| e == "medium") {
        return Some("medium".into());
    }
    efforts.first().cloned()
}

/// `mergeAgentReferences(current, incoming)`: bounded error rows stay
/// visible instead of silently dropping an over-limit item.
pub fn merge_agent_references(
    current: &[DraftReference],
    incoming: &[DraftReference],
) -> Vec<DraftReference> {
    let mut merged: Vec<DraftReference> = Vec::new();
    let upsert = |merged: &mut Vec<DraftReference>, entry: &DraftReference| match merged
        .iter_mut()
        .find(|existing| existing.id == entry.id)
    {
        Some(slot) => *slot = entry.clone(),
        None => merged.push(entry.clone()),
    };
    for entry in current {
        upsert(&mut merged, entry);
    }
    for entry in incoming.iter().filter(|entry| !entry.id.is_empty()) {
        upsert(&mut merged, entry);
    }
    merged.truncate(64);
    merged
}

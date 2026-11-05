//! `application/agent-controller-values.ts`.
use serde_json::Value;

/// `chooseAgentMode(inspection, current)`.
pub fn choose_agent_mode(inspection: Option<&Value>, current: Option<&str>) -> Option<String> {
    let modes = inspection
        .and_then(|i| i.get("modes"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let id = |mode: &Value| {
        mode["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .map(str::to_string)
    };
    if let Some(current) = current.filter(|c| !c.is_empty())
        && modes.iter().any(|mode| mode["id"] == current)
    {
        return Some(current.to_string());
    }
    modes
        .iter()
        .find(|mode| mode["isDefault"] == true)
        .and_then(id)
        .or_else(|| modes.first().and_then(id))
}

/// `chooseAgentEffort(model, current)`.
pub fn choose_agent_effort(model: Option<&Value>, current: Option<&str>) -> Option<String> {
    let efforts: Vec<String> = model
        .and_then(|m| m.get("variants"))
        .and_then(Value::as_array)
        .map(|v| {
            v.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if let Some(current) = current.filter(|c| !c.is_empty())
        && efforts.iter().any(|e| e == current)
    {
        return Some(current.to_string());
    }
    if let Some(default) = model
        .and_then(|m| m.get("defaultVariant"))
        .and_then(Value::as_str)
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
pub fn merge_agent_references(current: &[Value], incoming: &[Value]) -> Vec<Value> {
    let mut merged: Vec<(Option<Value>, Value)> =
        current.iter().fold(Vec::new(), |mut merged, entry| {
            upsert(&mut merged, entry.get("id").cloned(), entry);
            merged
        });
    for entry in incoming {
        if let Some(id) = entry
            .get("id")
            .filter(|id| crate::agent::contract::js::truthy(id))
        {
            upsert(&mut merged, Some(id.clone()), entry);
        }
    }
    merged
        .into_iter()
        .take(64)
        .map(|(_, entry)| entry)
        .collect()
}

/// `map.set(key, entry)`: an existing key keeps its position.
fn upsert(merged: &mut Vec<(Option<Value>, Value)>, key: Option<Value>, entry: &Value) {
    match merged.iter_mut().find(|(existing, _)| *existing == key) {
        Some(slot) => slot.1 = entry.clone(),
        None => merged.push((key, entry.clone())),
    }
}

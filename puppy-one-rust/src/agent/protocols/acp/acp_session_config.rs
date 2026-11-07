//! `protocols/acp/acp-session-config.mjs`: models, modes and reasoning
//! efforts from ACP session config options (or their legacy fields).
use crate::text;
use serde_json::Value;

/// One selectable entry.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConfigEntry {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// `{ configId, currentId, available }`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConfigState {
    pub config_id: Option<String>,
    pub current_id: Option<String>,
    pub available: Vec<ConfigEntry>,
}

/// `text(value)`: trimmed, at most 2 000 UTF-16 units.
fn text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(|s| text::head16(s.trim(), 2_000).to_string())
        .unwrap_or_default()
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn select_config<'a>(value: &'a [Value], category: &str) -> Option<&'a Value> {
    let comparable = category.to_lowercase();
    let candidates: Vec<&Value> = value
        .iter()
        .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("select"))
        .collect();
    candidates
        .iter()
        .find(|entry| text(entry.get("category")).to_lowercase() == comparable)
        .or_else(|| {
            candidates
                .iter()
                .find(|entry| text(entry.get("id")).to_lowercase() == comparable)
        })
        .copied()
}

fn flatten_options(value: Option<&Value>) -> Vec<&Value> {
    array(value)
        .iter()
        .flat_map(
            |entry| match entry.get("options").and_then(Value::as_array) {
                Some(options) => options.iter().collect::<Vec<_>>(),
                None => vec![entry],
            },
        )
        .collect()
}

fn entry(id: Option<&Value>, name: Option<&Value>, description: Option<&Value>) -> ConfigEntry {
    let id = text(id);
    let name = non_empty(text(name)).unwrap_or_else(|| id.clone());
    ConfigEntry {
        id,
        name,
        description: text(description),
    }
}

fn option_entries(selected: &Value) -> Vec<ConfigEntry> {
    flatten_options(selected.get("options"))
        .into_iter()
        .map(|option| {
            entry(
                option.get("value"),
                option.get("name"),
                option.get("description"),
            )
        })
        .collect()
}

fn resolve(
    config_options: &[Value],
    category: &str,
    legacy: Option<&Value>,
    legacy_list: &str,
    legacy_current: &str,
    limit: usize,
) -> ConfigState {
    let selected = select_config(config_options, category);
    let available: Vec<ConfigEntry> = match selected {
        Some(selected) => option_entries(selected),
        None => array(legacy.and_then(|l| l.get(legacy_list)))
            .iter()
            .map(|item| entry(item.get("id"), item.get("name"), item.get("description")))
            .collect(),
    };
    ConfigState {
        config_id: selected
            .and_then(|s| s.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string),
        current_id: non_empty(text(selected.and_then(|s| s.get("currentValue"))))
            .or_else(|| non_empty(text(legacy.and_then(|l| l.get(legacy_current))))),
        available: available
            .into_iter()
            .filter(|e| !e.id.is_empty())
            .take(limit)
            .collect(),
    }
}

/// `resolveAcpModels({ configOptions, models })`.
pub fn resolve_acp_models(config_options: &[Value], models: Option<&Value>) -> ConfigState {
    resolve(
        config_options,
        "model",
        models,
        "availableModels",
        "currentModelId",
        500,
    )
}

/// `resolveAcpModes({ configOptions, modes })`.
pub fn resolve_acp_modes(config_options: &[Value], modes: Option<&Value>) -> ConfigState {
    resolve(
        config_options,
        "mode",
        modes,
        "availableModes",
        "currentModeId",
        100,
    )
}

/// `resolveAcpEfforts({ configOptions })`.
pub fn resolve_acp_efforts(config_options: &[Value]) -> ConfigState {
    let selected = select_config(config_options, "thought_level")
        .or_else(|| select_config(config_options, "effort"));
    ConfigState {
        config_id: selected
            .and_then(|s| s.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string),
        current_id: non_empty(text(selected.and_then(|s| s.get("currentValue")))),
        available: selected
            .map(option_entries)
            .unwrap_or_default()
            .into_iter()
            .filter(|e| !e.id.is_empty())
            .take(32)
            .collect(),
    }
}

fn fallback(state: &ConfigState) -> Option<String> {
    state
        .current_id
        .clone()
        .or_else(|| state.available.first().map(|e| e.id.clone()))
}

/// `resolveRequestedAcpMode(requested, state)`.
pub fn resolve_requested_acp_mode(
    requested: Option<&Value>,
    state: &ConfigState,
) -> Option<String> {
    let value = text(requested).to_lowercase();
    if value.is_empty() {
        return fallback(state);
    }
    if let Some(exact) = state
        .available
        .iter()
        .find(|e| e.id.to_lowercase() == value)
    {
        return Some(exact.id.clone());
    }
    let label = |e: &ConfigEntry| format!("{} {}", e.id, e.name).to_lowercase();
    let semantic = if value == "plan" {
        state.available.iter().find(|e| label(e).contains("plan"))
    } else {
        state.available.iter().find(|e| {
            ["puppyone", "build", "agent", "default"]
                .iter()
                .any(|k| label(e).contains(k))
        })
    };
    semantic.map(|e| e.id.clone()).or_else(|| fallback(state))
}

/// `resolveRequestedAcpEffort(requested, state)`.
pub fn resolve_requested_acp_effort(
    requested: Option<&Value>,
    state: &ConfigState,
) -> Option<String> {
    let value = text(requested).to_lowercase();
    if value.is_empty() {
        return fallback(state);
    }
    state
        .available
        .iter()
        .find(|e| e.id.to_lowercase() == value)
        .map(|e| e.id.clone())
}

//! `protocols/acp/acp-native-values.mjs`: ACP values in their public
//! shapes.
use super::acp_session_config::ConfigState;
use crate::agent::agent_error::AgentError;
use crate::agent::contract::js;
use crate::agent::contract::native_session_id::native_session_id;
use crate::clock;
use crate::text;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::sync::LazyLock;

static UNAVAILABLE_SESSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)invalid params|unknown session|session.{0,32}(?:not found|does not exist|unavailable)")
        .expect("unavailable session pattern")
});
static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("safe id pattern"));
static SEPARATORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[-_.]+").expect("separator pattern"));

/// `sessionConfig`: the options plus each resolved selection.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionConfig {
    pub config_options: Vec<Value>,
    pub models: ConfigState,
    pub modes: ConfigState,
    pub efforts: ConfigState,
}

/// `isUnavailableAcpSessionError(error)`.
pub fn is_unavailable_acp_session_error(error: &AgentError) -> bool {
    error.code.as_deref() == Some("-32602") || UNAVAILABLE_SESSION.is_match(&error.message)
}

/// `publicModels(config, fallbackProviderId)`.
pub fn public_models(config: &SessionConfig, fallback_provider_id: &str) -> Vec<Value> {
    let variants: Vec<String> = config
        .efforts
        .available
        .iter()
        .map(|e| e.id.clone())
        .collect();
    let default_variant = match config.efforts.current_id.as_ref() {
        Some(current) if variants.contains(current) => Some(current.clone()),
        _ => variants.first().cloned(),
    };
    config
        .models
        .available
        .iter()
        .enumerate()
        .map(|(index, model)| {
            let (provider_id, model_id) = split_model_identity(&model.id, fallback_provider_id);
            let is_default = Some(&model.id) == config.models.current_id.as_ref()
                || (config.models.current_id.is_none() && index == 0);
            json!({
                "id": model.id,
                "model": model.id,
                "providerId": provider_id,
                "modelId": model_id,
                "displayName": if model.name.is_empty() { &model.id } else { &model.name },
                "description": model.description,
                "isDefault": is_default,
                "variants": variants,
                "defaultVariant": default_variant,
            })
        })
        .collect()
}

fn split_model_identity(value: &str, fallback_provider_id: &str) -> (String, String) {
    let id = text(Some(&Value::from(value)), 2_000);
    let colon = id.find(':');
    let slash = id.find('/');
    if let Some(colon) = colon.filter(|c| *c > 0 && slash.is_none_or(|s| *c < s)) {
        if id.starts_with("custom:")
            && let Some(offset) = id[colon + 1..].find(':')
            && offset > 0
        {
            let endpoint = colon + 1 + offset;
            return (id[..endpoint].to_string(), id[endpoint + 1..].to_string());
        }
        return (id[..colon].to_string(), id[colon + 1..].to_string());
    }
    if let Some(slash) = slash.filter(|s| *s > 0) {
        return (id[..slash].to_string(), id[slash + 1..].to_string());
    }
    (fallback_provider_id.to_string(), id)
}

/// `publicProviders(models)`.
pub fn public_providers(models: &[Value]) -> Vec<Value> {
    let mut groups: Vec<Value> = Vec::new();
    for model in models {
        let id = model["providerId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .unwrap_or("opencode")
            .to_string();
        let index = match groups.iter().position(|group| group["id"] == id.as_str()) {
            Some(index) => index,
            None => {
                groups.push(json!({
                    "id": id,
                    "displayName": humanize(&id),
                    "source": "native",
                    "defaultModel": null,
                    "modelCount": 0,
                }));
                groups.len() - 1
            }
        };
        let group = &mut groups[index];
        group["modelCount"] = Value::from(group["modelCount"].as_i64().unwrap_or(0) + 1);
        if model["isDefault"] == true {
            group["defaultModel"] = model["model"].clone();
        }
    }
    groups
}

/// `publicModes(config)`.
pub fn public_modes(config: &SessionConfig) -> Vec<Value> {
    config
        .modes
        .available
        .iter()
        .enumerate()
        .map(|(index, mode)| {
            json!({
                "id": mode.id,
                "displayName": if mode.name.is_empty() { humanize(&mode.id) } else { mode.name.clone() },
                "description": mode.description,
                "isDefault": Some(&mode.id) == config.modes.current_id.as_ref()
                    || (config.modes.current_id.is_none() && index == 0),
            })
        })
        .collect()
}

/// `mergeJsonConfig(value, overlay)`: a malformed inherited inline config
/// is not forwarded into the managed runtime.
pub fn merge_json_config(value: Option<&str>, overlay: &Value) -> String {
    let base: Map<String, Value> = value
        .filter(|v| !v.is_empty())
        .and_then(|v| serde_json::from_str::<Value>(v).ok())
        .and_then(|parsed| parsed.as_object().cloned())
        .unwrap_or_default();
    let mut merged = base.clone();
    for (key, entry) in record(Some(overlay)) {
        merged.insert(key.clone(), entry.clone());
    }
    let mut agent = record(base.get("agent")).clone();
    for (key, entry) in record(overlay.get("agent")) {
        agent.insert(key.clone(), entry.clone());
    }
    merged.insert("agent".into(), Value::Object(agent));
    js::stringify(&Value::Object(merged))
}

/// `event(type, providerSessionId, turnId, itemId, payload)`.
pub fn event(
    kind: &str,
    provider_session_id: Option<&str>,
    turn_id: Option<&str>,
    item_id: Option<&str>,
    payload: Value,
) -> Value {
    json!({
        "type": kind,
        "providerSessionId": native_session_id(provider_session_id.map(Value::from).as_ref()),
        "turnId": turn_id.and_then(safe_id),
        "itemId": item_id.and_then(safe_id),
        "payload": payload,
    })
}

/// `safeId(value)`.
pub fn safe_id(value: &str) -> Option<String> {
    SAFE_ID.is_match(value).then(|| value.to_string())
}

/// `safeId(value)` of an optional JSON value.
pub fn safe_id_value(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).and_then(safe_id)
}

/// `text(value, limit)`: trimmed, at most `limit` UTF-16 units.
pub fn text(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|s| text::head16(text::trim(s), limit).to_string())
        .unwrap_or_default()
}

/// `normalizeDate(value)`.
pub fn normalize_date(value: Option<&Value>) -> Option<String> {
    clock::date_parse(value?.as_str()?).map(clock::iso_string)
}

static EMPTY: LazyLock<Map<String, Value>> = LazyLock::new(Map::new);

/// `record(value)`.
pub fn record(value: Option<&Value>) -> &Map<String, Value> {
    value.and_then(Value::as_object).unwrap_or(&EMPTY)
}

/// `array(value)`.
pub fn array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// `humanize(value)`.
pub fn humanize(value: &str) -> String {
    let spaced = SEPARATORS
        .replace_all(&text(Some(&Value::from(value)), 160), " ")
        .into_owned();
    let mut previous_word = false;
    spaced
        .chars()
        .map(|character| {
            let word = character.is_ascii_alphanumeric() || character == '_';
            let mapped = if word && !previous_word {
                character.to_ascii_uppercase()
            } else {
                character
            };
            previous_word = word;
            mapped
        })
        .collect()
}

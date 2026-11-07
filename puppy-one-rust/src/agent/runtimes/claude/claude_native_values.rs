//! `runtimes/claude/claude-native-values.mjs`: bounded projections of the
//! Agent SDK's native catalog values.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::discovery::command_environment::EnvMap;
use crate::clock;
use crate::text;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));
static SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[_-]+").expect("pattern"));
static WORD_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\b\w)").expect("pattern"));

const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

/// `bounded(value, limit)`.
pub fn bounded(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|text| text::head16(text::trim(text), limit).to_string())
        .unwrap_or_default()
}

/// `safeId(value)`.
pub fn safe_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| SAFE_ID.is_match(id))
        .map(str::to_string)
}

/// `asArray(value)`.
pub fn as_array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

/// `normalizeModels(value)`.
pub fn normalize_models(value: Option<&Value>) -> Vec<Value> {
    as_array(value)
        .iter()
        .take(100)
        .enumerate()
        .map(|(index, model)| {
            let variants: Vec<String> = as_array(model.get("supportedEffortLevels"))
                .iter()
                .filter_map(Value::as_str)
                .filter(|effort| EFFORTS.contains(effort))
                .map(str::to_string)
                .collect();
            let default_variant = if variants.iter().any(|v| v == "high") {
                Some("high".to_string())
            } else {
                variants.first().cloned()
            };
            let id = bounded(model.get("value"), 512);
            json!({
                "id": id,
                "model": id,
                "displayName": non_empty(bounded(model.get("displayName"), 300))
                    .unwrap_or_else(|| bounded(model.get("value"), 300)),
                "description": bounded(model.get("description"), 2_000),
                "isDefault": index == 0,
                "variants": variants,
                "defaultVariant": default_variant,
            })
        })
        .filter(|model| model["id"].as_str().is_some_and(|id| !id.is_empty()))
        .collect()
}

/// `compatibleClaudeEffort(model, requested)`.
pub fn compatible_claude_effort(
    model: Option<&Value>,
    requested: Option<&str>,
) -> AgentResult<Option<String>> {
    let Some(requested) = requested.filter(|r| !r.is_empty()) else {
        return Ok(model
            .and_then(|m| m.get("defaultVariant"))
            .and_then(Value::as_str)
            .map(str::to_string));
    };
    let supported = model
        .and_then(|m| m.get("variants"))
        .and_then(Value::as_array)
        .is_some_and(|variants| variants.iter().any(|v| v.as_str() == Some(requested)));
    if supported {
        return Ok(Some(requested.to_string()));
    }
    Err(AgentError::new(
        "The selected Claude Code reasoning effort is no longer available for this model.",
    ))
}

/// `normalizeCommands(value)`.
pub fn normalize_commands(value: Option<&Value>) -> Vec<Value> {
    as_array(value)
        .iter()
        .take(500)
        .map(|command| {
            json!({
                "name": bounded(command.get("name"), 160),
                "description": bounded(command.get("description"), 1_000),
                "argumentHint": bounded(command.get("argumentHint"), 500),
                "source": "claude-code",
            })
        })
        .filter(|command| command["name"].as_str().is_some_and(|n| !n.is_empty()))
        .collect()
}

/// `normalizeAccount(value, models, environment)`: Claude subscription
/// OAuth is never product credentials.
pub fn normalize_account(value: Option<&Value>, models: &[Value], environment: &EnvMap) -> Value {
    let empty = Value::Null;
    let account = value.filter(|v| v.is_object()).unwrap_or(&empty);
    let field = |key: &str| js::truthy_opt(account.get(key));
    let has_native_identity = field("email")
        || field("organization")
        || field("subscriptionType")
        || field("tokenSource")
        || field("apiKeySource")
        || field("apiProvider");
    let has_api_key = field("apiKeySource")
        || environment
            .get("ANTHROPIC_API_KEY")
            .is_some_and(|key| !key.is_empty());
    let supported_cloud = field("apiProvider")
        && account.get("apiProvider").and_then(Value::as_str) != Some("firstParty");
    let authenticated = has_api_key || supported_cloud;
    let mut result = Obj::new()
        .set(
            "account",
            if authenticated {
                json!({
                    "type": non_empty(bounded(account.get("apiProvider"), 80))
                        .unwrap_or_else(|| "claude-code".into()),
                    "email": non_empty(bounded(account.get("email"), 300)),
                    "planType": non_empty(bounded(account.get("subscriptionType"), 160)),
                })
            } else {
                Value::Null
            },
        )
        .set("requiresOpenaiAuth", false)
        .set("requiresRuntimeSetup", !authenticated);
    if !authenticated {
        let error = if has_native_identity {
            "Claude subscription OAuth cannot be used by a third-party product. Configure an Anthropic API key or a supported cloud provider, then refresh."
        } else if !models.is_empty() {
            "Configure an Anthropic API key or a supported cloud provider for Claude Code, then refresh."
        } else {
            "Claude Code authentication and model access are unavailable."
        };
        result = result
            .set("setupReason", "runtime-setup-required")
            .set("error", error);
    }
    result.build()
}

/// `cleanEnvironment(value)`: string entries only.
pub fn clean_environment(value: &Value) -> EnvMap {
    value
        .as_object()
        .map(|map| {
            map.iter()
                .filter_map(|(key, entry)| entry.as_str().map(|v| (key.clone(), v.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// `humanize(value)`.
pub fn humanize(value: &str) -> String {
    let normalized = SEPARATORS
        .replace_all(&bounded(Some(&Value::from(value)), 160), " ")
        .into_owned();
    if normalized.is_empty() {
        return "tool".into();
    }
    WORD_START
        .replace_all(&normalized, |captures: &regex::Captures| {
            captures[0].to_uppercase()
        })
        .into_owned()
}

/// `normalizeDate(value)`: an ISO timestamp, now when invalid.
pub fn normalize_date(value: Option<&Value>) -> String {
    let milliseconds = match value {
        Some(Value::Number(number)) => number.as_f64().filter(|n| n.is_finite()).map(|n| n as i64),
        Some(Value::String(text)) if !text.is_empty() => clock::date_parse(text),
        _ => Some(clock::now_ms()),
    };
    milliseconds.map_or_else(clock::now_iso, clock::iso_string)
}

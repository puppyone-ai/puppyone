//! `shared/model-connections/schema.mjs`: the model-connection error codes
//! and model routes the Agent runtime shares with Settings.
use crate::agent::agent_error::{AgentError, AgentResult};
use regex::Regex;
use std::sync::LazyLock;

static CONNECTION_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^mc_[a-f0-9-]{36}$").expect("pattern"));
static CONTROL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\x00-\x1f\x7f]").expect("pattern"));

/// `connectionError(code)`.
pub fn connection_error(code: &str) -> AgentError {
    AgentError::coded(code, format!("Model connection: {code}"))
}

/// `connectionId(value)`.
pub fn connection_id(value: &str) -> AgentResult<String> {
    if CONNECTION_ID.is_match(value) {
        Ok(value.to_string())
    } else {
        Err(connection_error("INVALID_CONNECTION"))
    }
}

/// `text(value, max)`.
fn text(value: &str, max: usize) -> AgentResult<String> {
    let trimmed = crate::agent::contract::js::trim(value);
    if trimmed.is_empty()
        || crate::agent::contract::js::len16(value) > max
        || CONTROL.is_match(value)
    {
        return Err(connection_error("INVALID_CONFIGURATION"));
    }
    Ok(trimmed.to_string())
}

/// `modelRoute(connection, modelId)`.
pub fn model_route(connection: &str, model_id: &str) -> AgentResult<String> {
    Ok(format!(
        "{}/{}",
        connection_id(connection)?,
        text(model_id, 300)?
    ))
}

/// `parseModelRoute(value)`: `{ connectionId, modelId }`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelRoute {
    pub connection_id: String,
    pub model_id: String,
}

/// `parseModelRoute(value)`.
pub fn parse_model_route(value: Option<&str>) -> AgentResult<ModelRoute> {
    let Some(value) = value else {
        return Err(connection_error("MODEL_REQUIRED"));
    };
    let (connection, model) = match value.find('/') {
        Some(slash) => (&value[..slash], &value[slash + 1..]),
        // `value.slice(0, -1)` and `value.slice(0)` without a separator.
        None => (
            crate::agent::contract::js::head16(
                value,
                crate::agent::contract::js::len16(value).saturating_sub(1),
            ),
            value,
        ),
    };
    Ok(ModelRoute {
        connection_id: connection_id(connection)?,
        model_id: text(model, 300)?,
    })
}

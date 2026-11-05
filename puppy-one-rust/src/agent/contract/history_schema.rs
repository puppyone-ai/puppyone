//! `shared/agent-contract/history-schema.mjs`: shared, opaque native History
//! values. Never trim or rewrite native cursors.
use super::js::{self, Obj};
pub use super::native_session_id::native_session_id as history_native_id;
use super::validation::{Contract, type_error};
use serde_json::Value;

/// `agentHistoryLimits`.
pub mod limits {
    pub const PAGE_SIZE: usize = 100;
    pub const NATIVE_PAGE: usize = 1000;
    pub const NATIVE_ID: usize = 512;
    pub const CURSOR: usize = 1024;
}

/// `historyCursor(value)`.
pub fn history_cursor(value: Option<&Value>) -> Contract<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::String(s)) if js::len16(s) <= limits::CURSOR => Ok(Some(s.clone())),
        Some(_) => Err(type_error(
            "Native history returned an invalid continuation cursor.",
        )),
    }
}

/// `historyPageSize(value)`.
pub fn history_page_size(value: Option<&Value>) -> usize {
    match value.and_then(js::safe_integer) {
        Some(n) if n > 0 => (n as usize).min(limits::PAGE_SIZE),
        _ => 50,
    }
}

/// `historyLocators(value, limit)`.
pub fn history_locators(value: Option<&Value>, limit: Option<usize>) -> Contract<Vec<Value>> {
    let maximum = limit.unwrap_or(limits::PAGE_SIZE).min(limits::NATIVE_PAGE);
    let Some(entries) = value
        .and_then(Value::as_array)
        .filter(|e| e.len() <= maximum)
    else {
        return Err(type_error(
            "Native history returned an invalid session page.",
        ));
    };
    entries
        .iter()
        .map(|entry| {
            let field = |key: &str| js::get(entry, key);
            let provider_session_id = history_native_id(field("providerSessionId"));
            let updated_at = history_date(field("updatedAt"));
            let (Some(provider_session_id), Some(updated_at)) = (provider_session_id, updated_at)
            else {
                return Err(type_error(
                    "Native history returned an invalid session locator.",
                ));
            };
            Ok(Obj::new()
                .set("providerSessionId", provider_session_id)
                .set(
                    "title",
                    bounded(field("title"), 500).unwrap_or_else(|| "Agent session".into()),
                )
                .set(
                    "createdAt",
                    history_date(field("createdAt")).unwrap_or_else(|| updated_at.clone()),
                )
                .set("updatedAt", updated_at)
                .opt(
                    "updatedAtKnown",
                    (field("updatedAtKnown") == Some(&Value::Bool(false))).then_some(false),
                )
                .opt(
                    "selectedProviderId",
                    history_native_id(field("selectedProviderId")),
                )
                .opt("selectedModel", bounded(field("selectedModel"), 512))
                .opt("selectedEffort", bounded(field("selectedEffort"), 160))
                .opt("selectedMode", bounded(field("selectedMode"), 160))
                .build())
        })
        .collect()
}

/// `historyDate(value)`: a normalized ISO timestamp.
pub fn history_date(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    if js::len16(text) > 64 {
        return None;
    }
    js::date_parse(text).map(js::iso_string)
}

fn bounded(value: Option<&Value>, limit: usize) -> Option<String> {
    let text = js::head16(js::trim(value?.as_str()?), limit);
    (!text.is_empty()).then(|| text.to_string())
}

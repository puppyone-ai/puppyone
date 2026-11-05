//! `runtime/history-source-scope.mjs`: runtime-specific callers supply only
//! storage/profile selectors, never credentials.
use crate::agent::agent_error::AgentError;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// `localHistorySourceScope(namespace, selectors, defaults)`.
pub fn local_history_source_scope(
    namespace: &str,
    selectors: &[(&str, Option<String>)],
    defaults: &[(&str, Option<String>)],
) -> String {
    let normalize = |values: &[(&str, Option<String>)]| {
        let mut pairs: Vec<(String, String)> = values
            .iter()
            .map(|(key, value)| (key.to_string(), value.clone().unwrap_or_default()))
            .collect();
        pairs.sort();
        pairs
    };
    let values = normalize(selectors);
    if values == normalize(defaults) {
        return "default".into();
    }
    let encoded = serde_json::to_string(&(namespace, &values)).unwrap_or_default();
    let digest = Sha256::digest(encoded.as_bytes());
    format!(
        "local:{}",
        digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

/// `historyStoragePath(value, fallback, home)`.
pub fn history_storage_path(value: Option<&str>, fallback: &str, home: &Path) -> PathBuf {
    let input = value.filter(|v| !v.is_empty()).unwrap_or(fallback);
    let path = match input.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(input),
    };
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    }
}

/// `assertHistorySourceScope(actual, expected)`.
pub fn assert_history_source_scope(actual: &str, expected: &str) -> Result<(), AgentError> {
    if actual != expected {
        return Err(AgentError::coded(
            "HISTORY_SOURCE_CHANGED",
            "The Agent history source changed. Restore the original profile or refresh History.",
        )
        .with_retryable(false));
    }
    Ok(())
}

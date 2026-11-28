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
    if let Some(rest) = input.strip_prefix("~/") {
        return crate::platform::paths::resolve(home, rest);
    }
    if crate::platform::paths::is_absolute(input) {
        crate::platform::paths::absolute(input)
    } else {
        let cwd = std::env::current_dir().unwrap_or_default();
        crate::platform::paths::resolve(cwd, input)
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn codex_claude_and_pi_namespaces_follow_storage_selectors_and_never_credentials() {
        use crate::agent::runtimes::{
            claude::claude_history_source::claude_history_source,
            codex::codex_history_source::codex_history_source,
            pi::pi_history_source::pi_history_source,
        };
        type Source = fn(&dyn Fn(&str) -> Option<String>) -> (String, PathBuf);
        for (source, key) in [
            (codex_history_source as Source, "CODEX_HOME"),
            (claude_history_source as Source, "CLAUDE_CONFIG_DIR"),
            (pi_history_source as Source, "PI_CODING_AGENT_DIR"),
        ] {
            let scope = |profile: &str, secret: &str| {
                source(&|name| match name {
                    "HOME" => Some("/test-home".into()),
                    "API_KEY" => Some(secret.into()),
                    name if name == key => Some(profile.into()),
                    _ => None,
                })
                .0
            };
            let first = scope("/profiles/a", "secret-one");
            let again = scope("/profiles/a", "secret-two");
            let other = scope("/profiles/b", "secret-one");
            assert_eq!(first, again, "{key}");
            assert_ne!(first, other, "{key}");
            assert!(!first.contains("profiles"));
            assert!(!first.contains("secret"));
            assert!(first.starts_with("local:"));
        }
    }
}

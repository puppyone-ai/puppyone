//! `runtimes/cursor/cursor-history-source.mjs`.
use crate::agent::runtime::history_source_scope::local_history_source_scope;
use crate::platform::paths;

/// `cursorHistorySource(env)`.
pub fn cursor_history_source(env: &dyn Fn(&str) -> Option<String>) -> String {
    let read = |key: &str| env(key).filter(|value| !value.is_empty());
    let homedir = paths::home_dir().to_string_lossy().into_owned();
    local_history_source_scope(
        "cursor",
        &[
            (
                "home",
                Some(read("HOME").unwrap_or_else(|| homedir.clone())),
            ),
            ("config", Some(read("XDG_CONFIG_HOME").unwrap_or_default())),
            ("data", Some(read("XDG_DATA_HOME").unwrap_or_default())),
        ],
        &[
            ("home", Some(homedir)),
            ("config", Some(String::new())),
            ("data", Some(String::new())),
        ],
    )
}

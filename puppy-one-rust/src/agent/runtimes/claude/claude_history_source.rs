//! `runtimes/claude/claude-history-source.mjs`.
use crate::agent::runtime::history_source_scope::{
    history_storage_path, local_history_source_scope,
};
use crate::platform::paths;
use std::path::PathBuf;

/// `claudeHistorySource(env)`: `(sourceScopeId, root)`.
pub fn claude_history_source(env: &dyn Fn(&str) -> Option<String>) -> (String, PathBuf) {
    let homedir = paths::home_dir();
    let home = env("HOME")
        .filter(|home| !home.is_empty())
        .map_or_else(|| homedir.clone(), PathBuf::from);
    let default_root = homedir.join(".claude");
    let root = history_storage_path(
        env("CLAUDE_CONFIG_DIR")
            .filter(|d| !d.is_empty())
            .as_deref(),
        &home.join(".claude").to_string_lossy(),
        &home,
    );
    let scope = local_history_source_scope(
        "claude",
        &[("root", Some(root.to_string_lossy().into_owned()))],
        &[("root", Some(default_root.to_string_lossy().into_owned()))],
    );
    (scope, root)
}

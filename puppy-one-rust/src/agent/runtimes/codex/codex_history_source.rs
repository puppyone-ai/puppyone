//! `runtimes/codex/codex-history-source.mjs`.
use crate::agent::node_path;
use crate::agent::runtime::history_source_scope::{
    history_storage_path, local_history_source_scope,
};
use std::path::PathBuf;

/// `codexHistorySource(env)`: `{ sourceScopeId, root }`.
pub fn codex_history_source(env: &dyn Fn(&str) -> Option<String>) -> (String, PathBuf) {
    let homedir = node_path::homedir();
    let home = env("HOME")
        .filter(|home| !home.is_empty())
        .map_or_else(|| homedir.clone(), PathBuf::from);
    let default_root = homedir.join(".codex");
    let root = history_storage_path(
        env("CODEX_HOME").as_deref(),
        &home.join(".codex").to_string_lossy(),
        &home,
    );
    let scope = local_history_source_scope(
        "codex",
        &[("root", Some(root.to_string_lossy().into_owned()))],
        &[("root", Some(default_root.to_string_lossy().into_owned()))],
    );
    (scope, root)
}

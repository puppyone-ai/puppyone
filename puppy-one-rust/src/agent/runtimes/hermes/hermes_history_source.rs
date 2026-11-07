//! `runtimes/hermes/hermes-history-source.mjs`: persisted ACP sessions are
//! scoped to the Hermes home that owns `state.db`.
use crate::agent::runtime::history_source_scope::{
    history_storage_path, local_history_source_scope,
};
use crate::platform::paths;
use std::path::PathBuf;

/// `hermesHistorySource(environment)`.
pub fn hermes_history_source(env: &dyn Fn(&str) -> Option<String>) -> String {
    let read = |key: &str| env(key).filter(|value| !value.is_empty());
    let homedir = paths::home_dir();
    let home = read("HOME")
        .or_else(|| read("USERPROFILE"))
        .map_or_else(|| homedir.clone(), PathBuf::from);
    let root = history_storage_path(
        read("HERMES_HOME").as_deref(),
        &home.join(".hermes").to_string_lossy(),
        &home,
    );
    local_history_source_scope(
        "hermes",
        &[("root", Some(root.to_string_lossy().into_owned()))],
        &[(
            "root",
            Some(homedir.join(".hermes").to_string_lossy().into_owned()),
        )],
    )
}

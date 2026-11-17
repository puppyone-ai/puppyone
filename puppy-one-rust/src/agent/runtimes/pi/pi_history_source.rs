//! `runtimes/pi/pi-history-source.mjs`.
use crate::agent::runtime::history_source_scope::{
    history_storage_path, local_history_source_scope,
};
use crate::platform::paths;
use std::path::PathBuf;

/// `piHistorySource(env)`: `(sourceScopeId, root)`.
pub fn pi_history_source(env: &dyn Fn(&str) -> Option<String>) -> (String, PathBuf) {
    let read = |key: &str| env(key).filter(|value| !value.is_empty());
    let homedir = paths::home_dir();
    let home = read("HOME").map_or_else(|| homedir.clone(), PathBuf::from);
    let default_root = homedir.join(".pi/agent");
    let root = history_storage_path(
        read("PI_CODING_AGENT_DIR").as_deref(),
        &home.join(".pi/agent").to_string_lossy(),
        &home,
    );
    let default_sessions = default_root.join("sessions");
    let sessions = history_storage_path(
        read("PI_CODING_AGENT_SESSION_DIR").as_deref(),
        &root.join("sessions").to_string_lossy(),
        &home,
    );
    let scope = local_history_source_scope(
        "pi",
        &[
            ("root", Some(root.to_string_lossy().into_owned())),
            ("sessions", Some(sessions.to_string_lossy().into_owned())),
        ],
        &[
            ("root", Some(default_root.to_string_lossy().into_owned())),
            (
                "sessions",
                Some(default_sessions.to_string_lossy().into_owned()),
            ),
        ],
    );
    (scope, root)
}

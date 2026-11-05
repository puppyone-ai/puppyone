//! `runtimes/opencode-protocol/opencode-history-source.mjs`.
use crate::agent::node_path;
use crate::agent::runtime::history_source_scope::{
    history_storage_path, local_history_source_scope,
};
use std::path::PathBuf;

/// `openCodeHistorySource(env)`.
pub fn open_code_history_source(env: &dyn Fn(&str) -> Option<String>) -> String {
    let read = |key: &str| env(key).filter(|value| !value.is_empty());
    let homedir = node_path::homedir();
    let home = read("HOME").map_or_else(|| homedir.clone(), PathBuf::from);
    let data = history_storage_path(
        read("XDG_DATA_HOME").as_deref(),
        &home.join(".local/share").to_string_lossy(),
        &home,
    );
    local_history_source_scope(
        "opencode",
        &[
            ("data", Some(data.to_string_lossy().into_owned())),
            ("database", Some(read("OPENCODE_DB").unwrap_or_default())),
            (
                "profile",
                Some(read("OPENCODE_CONFIG_DIR").unwrap_or_default()),
            ),
            (
                "testHome",
                Some(read("OPENCODE_TEST_HOME").unwrap_or_default()),
            ),
        ],
        &[
            (
                "data",
                Some(homedir.join(".local/share").to_string_lossy().into_owned()),
            ),
            ("database", Some(String::new())),
            ("profile", Some(String::new())),
            ("testHome", Some(String::new())),
        ],
    )
}

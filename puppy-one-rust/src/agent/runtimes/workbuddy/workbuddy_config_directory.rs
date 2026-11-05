//! `runtimes/workbuddy/workbuddy-config-directory.mjs`.
use super::workbuddy_channels::WorkBuddyChannel;
use crate::agent::runtime::history_source_scope::history_storage_path;
use std::path::{Path, PathBuf};

/// `workBuddyConfigDirectory({ channel, environment, homedir })`: the native
/// WorkBuddy profile shared by auth, settings and sessions.
pub fn work_buddy_config_directory(
    channel: &WorkBuddyChannel,
    environment: &dyn Fn(&str) -> Option<String>,
    homedir: &Path,
) -> PathBuf {
    let home = environment("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| homedir.to_path_buf());
    let configured = [
        channel.config_directory_environment_variable,
        "CODEBUDDY_CONFIG_DIR",
        "WORKBUDDY_CONFIG_DIR",
    ]
    .iter()
    .find_map(|key| environment(key).filter(|v| !v.is_empty()))
    .unwrap_or_default();
    let fallback = home.join(channel.config_directory_name);
    history_storage_path(Some(&configured), &fallback.to_string_lossy(), &home)
}

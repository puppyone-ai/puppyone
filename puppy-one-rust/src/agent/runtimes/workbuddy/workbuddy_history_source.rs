//! `runtimes/workbuddy/workbuddy-history-source.mjs`.
use super::workbuddy_channels::{WORKBUDDY_CHANNELS, WorkBuddyChannel};
use super::workbuddy_config_directory::work_buddy_config_directory;
use crate::agent::runtime::history_source_scope::local_history_source_scope;
use std::path::Path;

/// `workBuddyHistorySource({ channel, environment })`. Keeps the original
/// namespace/selectors so existing single-registration WorkBuddy sessions
/// retain their exact native history identity.
pub fn work_buddy_history_source(
    channel: &WorkBuddyChannel,
    environment: &dyn Fn(&str) -> Option<String>,
    homedir: &Path,
) -> String {
    let config_root = work_buddy_config_directory(channel, environment, homedir);
    local_history_source_scope(
        "workbuddy",
        &[
            ("channel", Some(channel.channel.to_string())),
            (
                "configRoot",
                Some(config_root.to_string_lossy().into_owned()),
            ),
        ],
        &[
            ("channel", Some("codebuddy-cli".into())),
            (
                "configRoot",
                Some(homedir.join(".codebuddy").to_string_lossy().into_owned()),
            ),
        ],
    )
}

/// `legacyWorkBuddyRuntimeIdForSourceScope(sourceScopeId, environment)`.
pub fn legacy_work_buddy_runtime_id_for_source_scope(
    source_scope_id: Option<&str>,
    environment: &dyn Fn(&str) -> Option<String>,
    homedir: &Path,
) -> Option<&'static str> {
    let source_scope_id = source_scope_id.filter(|s| !s.is_empty())?;
    WORKBUDDY_CHANNELS
        .iter()
        .find(|channel| work_buddy_history_source(channel, environment, homedir) == source_scope_id)
        .map(|channel| channel.id)
}

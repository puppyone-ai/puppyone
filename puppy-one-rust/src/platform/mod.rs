pub mod accessibility;
pub mod agent_activity;
pub mod database;
pub mod desktop;
pub mod editor_state_storage;
pub mod electron_import;
pub mod environment;
pub mod git;
pub mod git_diff;
pub mod git_history;
pub mod git_watch;
pub mod host_budget;
pub mod image_transcode;
pub mod local_agent_setup;
pub mod locale_format;
pub mod office;
pub mod pdf;
pub mod preference_storage;
pub mod process;
pub mod project_activity;
pub mod repository_import;
pub mod tasks;
pub mod terminal;
pub mod text_rendering;
pub mod ui_state_store;
pub mod watchdog;
pub mod webview;

/// The native product's data directory, separate from the Electron product's
/// (`PUPPYONE_RUST_DATA_DIR` isolates tests and captures).
pub fn data_dir() -> std::path::PathBuf {
    std::env::var_os("PUPPYONE_RUST_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Library/Application Support/PuppyOne GPUI")
        })
}

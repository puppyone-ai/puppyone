pub mod accessibility;
pub mod agent_activity;
pub mod app_folders;
pub mod app_icon;
pub mod app_link;
pub mod app_preview;
pub mod application_identity;
pub mod build_identity;
pub mod capabilities;
pub mod cli_control;
pub mod clipboard;
pub mod connectivity;
pub mod conventions;
pub mod credentials;
pub mod database;
pub mod desktop;
pub mod diagnostics;
pub mod docx_redline;
pub mod draft_journal;
pub mod drag_out;
pub mod editor_state_storage;
pub mod electron_import;
pub mod environment;
pub mod feedback;
pub mod file_pasteboard;
pub mod folder_availability;
pub mod fs;
pub mod git;
pub mod git_diff;
pub mod git_history;
pub mod git_watch;
pub mod host_budget;
pub mod html_page_store;
pub mod image_transcode;
pub mod key_repeat;
pub mod local_agent_setup;
pub mod local_computers;
pub mod local_ipc;
pub mod locale_format;
pub mod office;
pub mod os;
pub mod paths;
pub mod pdf;
pub mod power;
pub mod preference_storage;
pub mod process;
pub mod project_activity;
pub mod proxy;
pub mod repository_import;
#[cfg(unix)]
pub mod single_instance;
pub mod stdio_guard;
pub mod svg;
pub mod tasks;
pub mod telemetry;
pub mod templates;
pub mod terminal;
pub mod text_rendering;
pub mod themes;
pub mod ui_state_store;
pub mod unsupported;
pub mod updates;
pub mod url_scheme;
pub mod viewer_packs;
pub mod watchdog;
pub mod webview;
pub mod window;
pub mod window_capture;

/// The native product's data directory, separate from the Electron product's
/// (`PUPPYONE_RUST_DATA_DIR` isolates tests and captures).
pub fn data_dir() -> std::path::PathBuf {
    paths::data_dir()
}

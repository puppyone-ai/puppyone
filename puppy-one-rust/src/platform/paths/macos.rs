use super::{Channel, home_dir, pick_electron_dir};
use std::path::{Path, PathBuf};

/// Preserves exact macOS path `~/Library/Application Support/PuppyOne GPUI`
/// so existing macOS users keep all local state and preferences on upgrade.
pub(super) fn data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| home_dir().join("Library/Application Support"));
    base.join("PuppyOne GPUI")
}

pub(super) fn config_dir() -> PathBuf {
    data_dir()
}

pub(super) fn cache_dir() -> PathBuf {
    let base = dirs::cache_dir().unwrap_or_else(|| home_dir().join("Library/Caches"));
    base.join("PuppyOne GPUI")
}

pub(super) fn logs_dir() -> PathBuf {
    home_dir().join("Library/Logs/PuppyOne GPUI")
}

pub(super) fn electron_user_data_under(home: &Path, channel: Channel) -> PathBuf {
    pick_electron_dir(&home.join("Library/Application Support"), channel)
}

pub(super) fn electron_user_data(channel: Channel) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").filter(|h| !h.is_empty())?;
    Some(electron_user_data_under(Path::new(&home), channel))
}

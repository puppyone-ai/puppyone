use super::{Channel, home_dir, pick_electron_dir};
use std::path::{Path, PathBuf};

/// `%LOCALAPPDATA%\PuppyOne GPUI`
pub(super) fn data_dir() -> PathBuf {
    let base = dirs::data_local_dir()
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .unwrap_or_else(|| home_dir().join("AppData").join("Local"));
    base.join("PuppyOne GPUI")
}

/// `%APPDATA%\PuppyOne GPUI`
pub(super) fn config_dir() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
        .unwrap_or_else(|| home_dir().join("AppData").join("Roaming"));
    base.join("PuppyOne GPUI")
}

/// `%LOCALAPPDATA%\PuppyOne GPUI\Cache`
pub(super) fn cache_dir() -> PathBuf {
    data_dir().join("Cache")
}

/// `%LOCALAPPDATA%\PuppyOne GPUI\Logs`
pub(super) fn logs_dir() -> PathBuf {
    data_dir().join("Logs")
}

/// Electron stores Windows userData under `%APPDATA%\<channel>` (`AppData\Roaming`).
pub(super) fn electron_user_data_under(home: &Path, channel: Channel) -> PathBuf {
    pick_electron_dir(&home.join("AppData").join("Roaming"), channel)
}

pub(super) fn electron_user_data(channel: Channel) -> Option<PathBuf> {
    let roaming = dirs::config_dir()
        .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
        .or_else(|| {
            let h = home_dir();
            (!h.as_os_str().is_empty()).then(|| h.join("AppData").join("Roaming"))
        })?;
    Some(pick_electron_dir(&roaming, channel))
}

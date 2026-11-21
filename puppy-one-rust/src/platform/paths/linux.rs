use super::{Channel, home_dir, pick_electron_dir};
use std::path::{Path, PathBuf};

/// `$XDG_DATA_HOME/puppyone-gpui` (fallback `~/.local/share/puppyone-gpui`).
pub(super) fn data_dir() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(|| home_dir().join(".local/share"));
    base.join("puppyone-gpui")
}

/// `$XDG_CONFIG_HOME/puppyone-gpui` (fallback `~/.config/puppyone-gpui`).
pub(super) fn config_dir() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| home_dir().join(".config"));
    base.join("puppyone-gpui")
}

/// `$XDG_CACHE_HOME/puppyone-gpui` (fallback `~/.cache/puppyone-gpui`).
pub(super) fn cache_dir() -> PathBuf {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::cache_dir)
        .unwrap_or_else(|| home_dir().join(".cache"));
    base.join("puppyone-gpui")
}

/// `$XDG_STATE_HOME/puppyone-gpui/logs` (fallback `~/.local/state/puppyone-gpui/logs`).
pub(super) fn logs_dir() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::state_dir)
        .unwrap_or_else(|| home_dir().join(".local/state"));
    base.join("puppyone-gpui").join("logs")
}

/// Electron stores Linux userData under `$XDG_CONFIG_HOME/<channel>` (`~/.config/<channel>`).
pub(super) fn electron_user_data_under(home: &Path, channel: Channel) -> PathBuf {
    pick_electron_dir(&home.join(".config"), channel)
}

pub(super) fn electron_user_data(channel: Channel) -> Option<PathBuf> {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::config_dir)
        .or_else(|| {
            let h = home_dir();
            (!h.as_os_str().is_empty()).then(|| h.join(".config"))
        })?;
    Some(pick_electron_dir(&config, channel))
}

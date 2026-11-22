//! Compatibility facade delegating to [`crate::platform::clipboard`].
use std::path::PathBuf;

pub use super::clipboard::MAX_FILES;

pub fn begin_text(
    window: &impl raw_window_handle::HasWindowHandle,
    text: &str,
    icon_path: &str,
    ended: impl FnOnce() + 'static,
) -> bool {
    super::clipboard::begin_text_drag(window, text, icon_path, ended)
}

pub fn begin_files(
    window: &impl raw_window_handle::HasWindowHandle,
    files: &[PathBuf],
    ended: impl FnOnce() + 'static,
) -> bool {
    super::clipboard::begin_file_drag(window, files, ended)
}

pub fn own_files() -> Option<Vec<PathBuf>> {
    super::clipboard::own_drag_files()
}

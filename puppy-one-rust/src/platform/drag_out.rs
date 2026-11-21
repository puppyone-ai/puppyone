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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn only_absolute_bounded_file_lists_start() {
        struct NoWindow;
        impl raw_window_handle::HasWindowHandle for NoWindow {
            fn window_handle(
                &self,
            ) -> Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError>
            {
                Err(raw_window_handle::HandleError::Unavailable)
            }
        }
        assert!(!begin_files(&NoWindow, &[], || {}));
        assert!(!begin_files(&NoWindow, &[PathBuf::from("a.md")], || {}));
        let many = vec![PathBuf::from("/a"); MAX_FILES + 1];
        assert!(!begin_files(&NoWindow, &many, || {}));
        assert_eq!(own_files(), None);
    }
}

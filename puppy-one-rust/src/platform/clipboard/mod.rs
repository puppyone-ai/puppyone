//! Cross-platform system file clipboard and OS drag-out sessions (`capabilities.md`).
//!
//! Absorbs `platform::file_pasteboard` and `platform::drag_out` behind one
//! per-capability directory while keeping thin compatibility facades at the old paths.
use std::path::PathBuf;

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod imp;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod imp;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod imp;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use std::path::PathBuf;
    pub(super) fn write_files(_: &[PathBuf]) -> bool {
        false
    }
    pub(super) fn begin_text_drag(
        _: &impl raw_window_handle::HasWindowHandle,
        _: &str,
        _: &str,
        _: impl FnOnce() + 'static,
    ) -> bool {
        false
    }
    pub(super) fn begin_file_drag(
        _: &impl raw_window_handle::HasWindowHandle,
        _: &[PathBuf],
        _: impl FnOnce() + 'static,
    ) -> bool {
        false
    }
    pub(super) fn own_drag_files() -> Option<Vec<PathBuf>> {
        None
    }
}

/// The most entries one drag session carries (`resource-drag.mm`).
pub const MAX_FILES: usize = 32;

/// Replaces the OS file clipboard with `paths` (Finder URLs / Windows `CF_HDROP` /
/// Linux `text/uri-list`). Returns `false` when nothing was written.
pub fn write_files(paths: &[PathBuf]) -> bool {
    if paths.is_empty() {
        return false;
    }
    #[cfg(any(test, feature = "test-support"))]
    {
        WRITTEN.with(|w| *w.borrow_mut() = Some(paths.to_vec()));
        true
    }
    #[cfg(not(any(test, feature = "test-support")))]
    {
        imp::write_files(paths)
    }
}

/// Starts an OS drag-out session carrying plain text and an icon derived from `icon_path`.
pub fn begin_text_drag(
    window: &impl raw_window_handle::HasWindowHandle,
    text: &str,
    icon_path: &str,
    ended: impl FnOnce() + 'static,
) -> bool {
    imp::begin_text_drag(window, text, icon_path, ended)
}

/// Starts an OS drag-out session carrying up to [`MAX_FILES`] absolute file paths.
pub fn begin_file_drag(
    window: &impl raw_window_handle::HasWindowHandle,
    files: &[PathBuf],
    ended: impl FnOnce() + 'static,
) -> bool {
    if files.is_empty() || files.len() > MAX_FILES || files.iter().any(|f| !f.is_absolute()) {
        return false;
    }
    imp::begin_file_drag(window, files, ended)
}

/// The files belonging to this app's in-flight native drag session, if any.
pub fn own_drag_files() -> Option<Vec<PathBuf>> {
    imp::own_drag_files()
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static WRITTEN: std::cell::RefCell<Option<Vec<PathBuf>>> = const { std::cell::RefCell::new(None) };
}

/// What the last [`write_files`] on this thread recorded in test builds.
#[cfg(any(test, feature = "test-support"))]
pub fn take_written() -> Option<Vec<PathBuf>> {
    WRITTEN.with(|w| w.borrow_mut().take())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn write_files_rejects_empty_and_records_in_tests() {
        assert!(!write_files(&[]));
        let sample = vec![PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b.md")];
        assert!(write_files(&sample));
        assert_eq!(take_written(), Some(sample));
        assert_eq!(take_written(), None);
    }

    /// Restored from the former `platform::drag_out` tests: a drag-out never
    /// starts for an empty, relative or oversized file list.
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
        assert!(!begin_file_drag(&NoWindow, &[], || {}));
        assert!(!begin_file_drag(&NoWindow, &[PathBuf::from("a.md")], || {}));
        let many = vec![PathBuf::from("/a"); MAX_FILES + 1];
        assert!(!begin_file_drag(&NoWindow, &many, || {}));
        assert_eq!(own_drag_files(), None);
    }
}

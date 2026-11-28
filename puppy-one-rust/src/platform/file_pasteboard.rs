//! Compatibility facade delegating to [`crate::platform::clipboard`].
use std::path::PathBuf;

/// Replaces the system file clipboard with `paths`.
pub fn write(paths: &[PathBuf]) -> bool {
    super::clipboard::write_files(paths)
}

/// What the last [`write`] on this thread put on the (test) clipboard.
#[cfg(any(test, feature = "test-support"))]
pub fn take_written() -> Option<Vec<PathBuf>> {
    super::clipboard::take_written()
}

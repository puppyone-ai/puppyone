//! Native window platform hooks (`window-chrome-and-menus.md`, `code-layout.md`):
//! - Dynamic minimum window size (`set_content_min_size`)
//! - Discarding IME marked composition text (`discard_marked_text`)
//! - Read-only OS reduce-motion preference (`reduce_motion`)
//! - Process-local font smoothing parity (`match_product_font_smoothing`)
use raw_window_handle::HasWindowHandle;

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod imp;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod imp;
#[cfg(all(target_os = "windows", feature = "dev-capture"))]
pub use imp::probe_window;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod imp;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use raw_window_handle::HasWindowHandle;
    pub(super) fn set_content_min_size(_: &impl HasWindowHandle, _: f32, _: f32) {}
    pub(super) fn discard_marked_text() {}
    pub(super) fn reduce_motion() -> bool {
        false
    }
    pub(super) fn match_product_font_smoothing() {}
}

/// Sets the smallest content size the user can resize `window` to (logical pixels).
pub fn set_content_min_size(window: &impl HasWindowHandle, width: f32, height: f32) {
    imp::set_content_min_size(window, width, height);
}

/// Asks the OS input method to cancel/discard any active marked preedit state.
/// Must be called on the UI main thread outside an active input-handler callback.
pub fn discard_marked_text() {
    #[cfg(not(test))]
    imp::discard_marked_text();
}

/// Read-only OS reduced-motion preference.
pub fn reduce_motion() -> bool {
    imp::reduce_motion()
}

/// Matches the product's greyscale antialiased font rendering where supported.
pub fn match_product_font_smoothing() {
    imp::match_product_font_smoothing();
}

#[cfg(test)]
mod tests;

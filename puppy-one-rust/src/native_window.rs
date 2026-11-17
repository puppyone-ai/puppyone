//! Native window constraints GPUI only sets at creation
//! (`WindowOptions::window_min_size`), kept in step with the pane layout
//! like the product's `window-layout:set-minimum-width`.
use gpui::{Pixels, Size, Window};

/// The smallest content size the user can resize the window to.
#[cfg(target_os = "macos")]
pub fn set_content_min_size(window: &Window, min: Size<Pixels>) {
    use objc2_foundation::NSSize;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let Ok(handle) = HasWindowHandle::window_handle(window) else {
        return;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return;
    };
    // SAFETY: GPUI owns this live NSView; only accessed on AppKit's main thread.
    let view = unsafe { &*handle.ns_view.as_ptr().cast::<objc2_app_kit::NSView>() };
    if let Some(window) = view.window() {
        window.setContentMinSize(NSSize::new(
            f32::from(min.width).into(),
            f32::from(min.height).into(),
        ));
    }
}
#[cfg(not(target_os = "macos"))]
pub fn set_content_min_size(_: &Window, _: Size<Pixels>) {}

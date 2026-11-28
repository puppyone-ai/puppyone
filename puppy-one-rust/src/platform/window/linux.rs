use raw_window_handle::HasWindowHandle;

pub(super) fn set_content_min_size(_window: &impl HasWindowHandle, _width: f32, _height: f32) {
    // GPUI applies `WindowOptions::window_min_size` at window creation on X11/Wayland.
}

#[cfg_attr(test, allow(dead_code))]
pub(super) fn discard_marked_text() {
    // GPUI handles IME reset on Linux focus/input state transitions.
}

pub(super) fn reduce_motion() -> bool {
    // Respect GTK/GNOME desktop animation preference if gsettings is installed;
    // fail open to animations enabled if unavailable.
    if matches!(
        std::env::var("GTK_ENABLE_ANIMATIONS").ok().as_deref(),
        Some("0" | "false")
    ) {
        return true;
    }
    std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "enable-animations"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .is_some_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "false")
}

pub(super) fn match_product_font_smoothing() {}

pub(super) fn toggle_maximize(_window: &impl HasWindowHandle) -> bool {
    false
}

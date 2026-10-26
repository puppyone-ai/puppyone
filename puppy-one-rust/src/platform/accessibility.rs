//! Read-only OS motion preference. Refreshed at startup and when the window
//! becomes active; no system settings are written and no idle polling runs.
#[cfg(target_os = "macos")]
pub fn reduce_motion() -> bool {
    use objc2::{class, msg_send, runtime::AnyObject};
    // SAFETY: NSWorkspace's shared singleton and read-only BOOL property;
    // called on GPUI's main thread, retained by AppKit for the process.
    unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        msg_send![workspace, accessibilityDisplayShouldReduceMotion]
    }
}
#[cfg(not(target_os = "macos"))]
pub fn reduce_motion() -> bool {
    false
}

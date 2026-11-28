//! Read-only OS motion preference. Refreshed at startup and when the window
//! becomes active; no system settings are written and no idle polling runs.
//!
//! Delegates to [`crate::platform::window::reduce_motion`].
pub fn reduce_motion() -> bool {
    super::window::reduce_motion()
}

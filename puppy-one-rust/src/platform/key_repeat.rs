//! Whether the keystroke being handled is the system's auto-repeat of a
//! held key (`input.isAutoRepeat`). GPUI dispatches a held keystroke to its
//! key binding again on every repeat without saying so; AppKit's current
//! event does. Elsewhere there is no current event to ask, and every
//! keystroke counts as a press.

/// The keystroke being dispatched now repeats a held key.
pub fn repeating() -> bool {
    #[cfg(any(test, feature = "test-support"))]
    if test_support::SIMULATED.with(std::cell::Cell::get) {
        return true;
    }
    imp::repeating()
}

#[cfg(target_os = "macos")]
mod imp {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSEventType};

    pub(super) fn repeating() -> bool {
        // Key bindings run inside AppKit's key event, on the main thread.
        let Some(mtm) = MainThreadMarker::new() else {
            return false;
        };
        NSApplication::sharedApplication(mtm)
            .currentEvent()
            .is_some_and(|event| event.r#type() == NSEventType::KeyDown && event.isARepeat())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub(super) fn repeating() -> bool {
        false
    }
}

/// Tests: the keystrokes this thread dispatches are repeats until
/// [`simulate`](test_support::simulate) says otherwise.
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    thread_local! {
        pub(super) static SIMULATED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    pub fn simulate(repeating: bool) {
        SIMULATED.with(|s| s.set(repeating));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// Off the main thread there is no key event: a press, not a repeat.
    #[test]
    fn a_keystroke_outside_a_key_event_is_a_press() {
        assert!(!repeating());
        test_support::simulate(true);
        assert!(repeating());
        test_support::simulate(false);
        assert!(!repeating());
    }
}

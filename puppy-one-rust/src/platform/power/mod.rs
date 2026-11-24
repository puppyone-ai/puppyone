//! System sleep and wake for a process without windows (Electron's
//! `powerMonitor` `suspend`, `resume` and `unlock-screen`): macOS through
//! IOKit's system power notifications and the screen-unlock notification,
//! Linux through logind's `PrepareForSleep`, Windows through the
//! suspend/resume callback. Each event reaches the listener on a thread of
//! the watcher's own, for the rest of the process.

/// What the system is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// About to sleep.
    Suspend,
    /// Awake again, or the screen unlocked.
    Wake,
}

/// Where the listener is called.
pub type Listener = Box<dyn Fn(Event) + Send + Sync>;

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
    pub(super) fn watch(_: super::Listener) -> bool {
        false
    }
}

/// Calls `listener` each time the system is about to sleep or has woken.
/// `false` when this system tells nothing (then a sleeping connection is
/// only found dead by its own silence).
pub fn watch(listener: impl Fn(Event) + Send + Sync + 'static) -> bool {
    imp::watch(Box::new(listener))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use core::prelude::v1::test;

    /// This Mac answers the registration (IOKit's root power domain).
    #[test]
    fn this_mac_tells_its_sleep_and_wake() {
        assert!(super::watch(|_| {}));
    }
}

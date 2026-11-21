//! Cross-platform update installer abstraction (`release-and-ci.md`).
//!
//! Moves all OS-specific signature checks, staging, atomic swap, rollback, and
//! relaunch mechanics out of `src/features/updates.rs` into `po-platform`.
use super::Configuration;
use std::path::Path;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux as imp;
#[cfg(target_os = "macos")]
use macos as imp;
#[cfg(target_os = "windows")]
use windows as imp;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use super::Configuration;
    use std::path::Path;
    pub(super) struct Backend;
    pub(super) fn open(_: &Configuration, _: bool) -> (Option<Backend>, Option<String>) {
        (
            None,
            Some("Auto updates are unavailable on this operating system.".into()),
        )
    }
    impl Backend {
        pub(super) fn prepare(&mut self, _: &Path, _: &str) -> Result<(), String> {
            Err("Auto updates are unavailable on this operating system.".into())
        }
        pub(super) fn discard(&mut self) {}
        pub(super) fn install_on_exit(&mut self, _: bool) -> bool {
            false
        }
    }
}

/// Platform-owned in-place update installer.
pub struct UpdateInstaller(imp::Backend);

impl UpdateInstaller {
    /// Evaluates whether this running build can auto-update in place and opens
    /// the OS installer backend when available. Returns `(Some(installer), None)`
    /// or `(None, Some(disabled_reason))`.
    pub fn open(config: &Configuration, packaged: bool) -> (Option<Self>, Option<String>) {
        let (backend, reason) = imp::open(config, packaged);
        (backend.map(Self), reason)
    }

    /// Stages and verifies a downloaded update payload prior to exit swap.
    pub fn prepare(&mut self, archive: &Path, version: &str) -> Result<(), String> {
        self.0.prepare(archive, version)
    }

    /// Discards any previously staged update payload.
    pub fn discard(&mut self) {
        self.0.discard();
    }

    /// Applies the staged update on application quit, optionally relaunching.
    pub fn install_on_exit(&mut self, relaunch: bool) -> bool {
        self.0.install_on_exit(relaunch)
    }

    #[cfg(all(target_os = "macos", any(test, feature = "test-support")))]
    pub fn from_prepared(prepared: super::prepared::PreparedUpdate) -> Self {
        Self(imp::from_prepared(prepared))
    }
}

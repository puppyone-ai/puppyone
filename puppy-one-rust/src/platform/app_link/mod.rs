//! Unified application link, single-instance handoff, and CLI control facade
//! (`code-layout.md`, `capabilities.md`).
//!
//! Upper layers (`src/main.rs`) call this facade without `#[cfg(unix)]` or
//! `libc::getuid()`. Platform transports live in `windows.rs` (Named Pipes +
//! Mutex + HKCU URL scheme), `linux.rs` (XDG `.desktop` + `xdg-mime`), and
//! `platform::{single_instance, cli_control, url_scheme}` on Unix/macOS.
use super::cli_control;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "windows")]
mod windows;

/// Outcome of acquiring the single-instance lock for a data directory.
pub enum SingleInstance {
    /// This process owns the lock; later launches arrive on this channel.
    Primary(async_channel::Receiver<(Vec<OsString>, PathBuf)>),
    /// Another running process took ownership of this launch's arguments.
    Forwarded,
}

/// Acquires the per-data-dir single-instance lock or forwards `(args, cwd)` to
/// the running primary instance.
pub fn acquire_single_instance(
    data_dir: &Path,
    args: &[OsString],
    cwd: &Path,
) -> Option<SingleInstance> {
    #[cfg(unix)]
    {
        super::single_instance::acquire(data_dir, args, cwd).map(|inst| match inst {
            super::single_instance::Instance::Primary(rx) => SingleInstance::Primary(rx),
            super::single_instance::Instance::Forwarded => SingleInstance::Forwarded,
        })
    }
    #[cfg(target_os = "windows")]
    {
        windows::acquire_single_instance(data_dir, args, cwd)
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = (data_dir, args, cwd);
        let (_tx, rx) = async_channel::bounded(1);
        Some(SingleInstance::Primary(rx))
    }
}

/// Starts listening for `puppyone open` CLI control requests for this user.
pub fn serve_control(
    data_dir: &Path,
    info: cli_control::AppInfo,
) -> std::io::Result<async_channel::Receiver<cli_control::Incoming>> {
    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        let endpoint = cli_control::endpoint(data_dir, uid);
        cli_control::serve(&endpoint, info)
    }
    #[cfg(target_os = "windows")]
    {
        windows::serve_control(data_dir, info)
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let endpoint = cli_control::endpoint(data_dir, 0);
        cli_control::serve(&endpoint, info)
    }
}

/// Claims a custom return-to-app URL scheme (`puppyone://`, `puppyone-internal://`, ...).
pub fn register_scheme(scheme: &str) {
    #[cfg(target_os = "macos")]
    super::url_scheme::claim(scheme);
    #[cfg(target_os = "windows")]
    if let Err(err) = windows::register_scheme(scheme) {
        crate::diagnosticln!("Unable to register Windows URL scheme {scheme}: {err}");
    }
    #[cfg(target_os = "linux")]
    if let Err(err) = linux::register_scheme(scheme) {
        crate::diagnosticln!("Unable to register Linux URL scheme {scheme}: {err}");
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let _ = scheme;
}

/// Computes a stable short hex digest identifying `data_dir` for IPC pipe/mutex names.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn data_dir_token(data_dir: &Path) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(data_dir.as_os_str().as_encoded_bytes());
    digest.iter().take(12).map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn data_dir_token_is_stable_and_distinct() {
        let a = data_dir_token(Path::new("/tmp/a"));
        let b = data_dir_token(Path::new("/tmp/b"));
        assert_eq!(a.len(), 24);
        assert_ne!(a, b);
    }
}

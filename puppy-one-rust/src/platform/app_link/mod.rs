//! Unified application link, single-instance handoff, and CLI control facade
//! (`code-layout.md`, `capabilities.md`).
//!
//! Upper layers (`src/main.rs`) call this facade without `#[cfg(unix)]` or
//! `libc::getuid()`. Platform transports live under `platform::single_instance`,
//! `platform::cli_control`, and `platform::url_scheme` (with Windows Named Pipe
//! and HKCU registry support in Step 2, and Linux `.desktop` scheme registration
//! in Step 5).
use super::{cli_control, url_scheme};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

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
    #[cfg(not(unix))]
    {
        let _ = (data_dir, args, cwd);
        // Step 2 adds Windows Named Pipe + Mutex single-instance handoff; until
        // then, run as an independent primary with an idle receiver.
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
    #[cfg(not(unix))]
    {
        let endpoint = cli_control::endpoint(data_dir, 0);
        cli_control::serve(&endpoint, info)
    }
}

/// Claims a custom return-to-app URL scheme (`puppyone://`, `puppyone-internal://`, ...).
pub fn register_scheme(scheme: &str) {
    url_scheme::claim(scheme);
}

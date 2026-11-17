//! Publish a rename without replacing another directory entry. The platform
//! operation decides identity/case folding; spelling equality is not identity.
use super::{Dir, Error, ErrorKind, Path, Result, io};

pub(super) fn exclusive(from: &Dir, name: &Path, to: &Dir, next: &Path) -> Result<()> {
    // The raw dirfd operation must never accept path traversal or a parent
    // component. Callers have already opened the admitted parent capabilities.
    for path in [name, next] {
        super::validate(path, false)?;
        if path.components().count() != 1 {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "Expected a single filename",
            ));
        }
    }
    publish(from, name, to, next).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            Error::new(
                ErrorKind::AlreadyExists,
                crate::localization::t("native.workspace.nameExists"),
            )
        } else {
            io(error)
        }
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn publish(from: &Dir, name: &Path, to: &Dir, next: &Path) -> std::io::Result<()> {
    use std::{
        ffi::CString,
        os::{fd::AsRawFd, unix::ffi::OsStrExt},
    };
    let name = CString::new(name.as_os_str().as_bytes())?;
    let next = CString::new(next.as_os_str().as_bytes())?;
    // SAFETY: both directory handles stay alive through the call; each C
    // string is a validated single component with its own terminating NUL.
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            from.as_raw_fd(),
            name.as_ptr(),
            to.as_raw_fd(),
            next.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            from.as_raw_fd(),
            name.as_ptr(),
            to.as_raw_fd(),
            next.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

// Keep the existing path on other platforms. It has no verified atomic
// no-replacement guarantee; never fall back here after a native syscall error.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn publish(from: &Dir, name: &Path, to: &Dir, next: &Path) -> std::io::Result<()> {
    match to.symlink_metadata(next) {
        Ok(_) => return Err(std::io::ErrorKind::AlreadyExists.into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    from.rename(name, to, next)
}

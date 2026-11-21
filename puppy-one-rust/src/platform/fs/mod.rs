//! Cross-platform filesystem primitives for capability-confined workspace I/O
//! (`code-layout.md`, `capabilities.md`).
//!
//! Absorbs OS-specific `sync_dir`, exclusive no-replace rename (`renameatx_np` /
//! `SYS_renameat2`), `O_NOFOLLOW` opens, extended attributes / macOS creation
//! time preservation, Windows lock-tolerant atomic replace retry, and Windows
//! reserved device-name validation so `po-workspace` stays free of `libc`.
use cap_std::fs::{Dir, File, Metadata};
use std::{io, path::Path};

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(test)]
mod tests;

/// Flushes directory metadata to durable storage.
pub fn sync_dir(dir: &Dir) -> io::Result<()> {
    #[cfg(unix)]
    {
        unix::sync_dir(dir)
    }
    #[cfg(windows)]
    {
        windows::sync_dir(dir)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = dir;
        Ok(())
    }
}

/// Opens a regular file for reading without following symlinks (`O_NOFOLLOW` on Unix).
pub fn open_nofollow_read(dir: &Dir, name: &Path) -> io::Result<File> {
    #[cfg(unix)]
    {
        unix::open_nofollow_read(dir, name)
    }
    #[cfg(not(unix))]
    {
        let mut options = cap_std::fs::OpenOptions::new();
        options.read(true);
        dir.open_with(name, &options)
    }
}

/// Opens a regular file for reading and writing without following symlinks.
pub fn open_nofollow_read_write(dir: &Dir, name: &Path) -> io::Result<File> {
    #[cfg(unix)]
    {
        unix::open_nofollow_read_write(dir, name)
    }
    #[cfg(not(unix))]
    {
        let mut options = cap_std::fs::OpenOptions::new();
        options.read(true).write(true);
        dir.open_with(name, &options)
    }
}

/// Opens a child directory without following symlinks (`O_DIRECTORY | O_NOFOLLOW` on Unix).
pub fn open_directory_nofollow(parent: &Dir, name: &Path) -> io::Result<Dir> {
    #[cfg(unix)]
    {
        unix::open_directory_nofollow(parent, name)
    }
    #[cfg(not(unix))]
    {
        parent.open_dir(name)
    }
}

/// Copies OS-specific file metadata (Unix owner/xattrs, macOS creation time,
/// and permissions) from `src` to `dst` prior to atomic replacement (`DP-30`).
pub fn copy_file_metadata(src: &File, src_meta: &Metadata, dst: &File) -> io::Result<()> {
    #[cfg(unix)]
    unix::copy_file_metadata(src, src_meta, dst);
    #[cfg(not(unix))]
    let _ = src;

    dst.set_permissions(src_meta.permissions())
}

/// Renames `name` in `from` to `next` in `to` without replacing an existing target.
pub fn exclusive_rename(from: &Dir, name: &Path, to: &Dir, next: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        unix::exclusive_rename(from, name, to, next)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        match to.symlink_metadata(next) {
            Ok(_) => return Err(io::ErrorKind::AlreadyExists.into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        rename_with_retry(from, name, to, next)
    }
}

/// Renames `from`/`name` onto `to`/`next`, retrying briefly on Windows sharing
/// violations (antivirus / indexer locks) without ever falling back to copy-truncate.
pub fn rename_with_retry(from: &Dir, name: &Path, to: &Dir, next: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        windows::rename_with_retry(from, name, to, next)
    }
    #[cfg(not(windows))]
    {
        from.rename(name, to, next)
    }
}

/// Sets owner-only file permissions (`0o600` on Unix; no-op on Windows where
/// user profile ACLs already restrict access).
pub fn set_private_file_permissions(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// Sets owner-only directory permissions (`0o700` on Unix; no-op on Windows).
pub fn set_private_dir_permissions(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// Returns `true` when `metadata` does not expose group/other permissions on Unix.
pub fn is_private_metadata(metadata: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o077 == 0
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        true
    }
}

/// Atomically creates a new owner-only file (`O_CREAT | O_EXCL`, `0o600` on Unix).
pub fn open_private_create_new(path: &Path) -> io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Returns `true` if `component` is a Windows reserved DOS device name
/// (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with or without an extension)
/// or ends with a trailing dot or space.
pub fn is_invalid_windows_filename(component: &str) -> bool {
    if component.is_empty() || component.ends_with('.') || component.ends_with(' ') {
        return true;
    }
    if component
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c < '\x20')
    {
        return true;
    }
    let stem = component.split('.').next().unwrap_or(component);
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

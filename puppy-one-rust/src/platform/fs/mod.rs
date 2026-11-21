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
    #[cfg(target_os = "windows")]
    {
        windows::exclusive_rename(from, name, to, next)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        match to.symlink_metadata(next) {
            Ok(_) => return Err(io::ErrorKind::AlreadyExists.into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        rename_with_retry(from, name, to, next)
    }
}

/// Stable `(device/volume, inode/file_index)` identity of an open file.
pub fn file_identity(file: &File) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        let meta = file.metadata().ok()?;
        Some((meta.dev(), meta.ino()))
    }
    #[cfg(windows)]
    {
        windows::file_identity(file)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = file;
        None
    }
}

/// Stable `(device/volume, inode/file_index)` identity of `name` inside `dir`.
pub fn dir_entry_identity(dir: &Dir, name: &Path) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        let meta = dir.symlink_metadata(name).ok()?;
        Some((meta.dev(), meta.ino()))
    }
    #[cfg(windows)]
    {
        windows::dir_entry_identity(dir, name)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (dir, name);
        None
    }
}

/// Stable `(device/volume, inode/file_index)` identity of a filesystem path.
pub fn path_identity(path: &Path) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::symlink_metadata(path).ok()?;
        Some((meta.dev(), meta.ino()))
    }
    #[cfg(windows)]
    {
        windows::path_identity(path)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        None
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

/// Opens a file for writing, creating or truncating it with owner-only permissions (`0o600` on Unix).
pub fn open_private_truncate(path: &Path) -> io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Opens a filesystem path for reading without following symbolic links (`O_NOFOLLOW` on Unix).
pub fn open_path_nofollow_read(path: &Path) -> io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        unix::open_path_nofollow_read(path)
    }
    #[cfg(not(unix))]
    {
        std::fs::OpenOptions::new().read(true).open(path)
    }
}

/// Opens a filesystem path for writing (creating if absent, without truncating)
/// without following symbolic links and with owner-only permissions (`O_NOFOLLOW`, `0o600` on Unix).
pub fn open_path_nofollow_private_write(path: &Path) -> io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        unix::open_path_nofollow_private_write(path)
    }
    #[cfg(not(unix))]
    {
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(path)
    }
}

/// Creates a single new directory with owner-only permissions (`0o700` on Unix).
pub fn create_private_dir(path: &Path) -> io::Result<()> {
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

/// Recursively creates `path` and enforces owner-only permissions (`0o700` on Unix).
pub fn create_private_dir_all(path: &Path) -> io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        builder.mode(0o700);
        builder.create(path)?;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
        Ok(())
    }
    #[cfg(not(unix))]
    {
        builder.create(path)
    }
}

/// Returns whether `path` is a regular file with execute permission (`0o111` on Unix; regular file on non-Unix).
pub fn is_executable_file(path: &Path) -> io::Result<bool> {
    let metadata = match path.metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Ok(metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        Ok(metadata.is_file())
    }
}

/// Checks whether the current process has read access to `path` (`access(R_OK)` on Unix).
pub fn can_access_read(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        unix::can_access_read(path)
    }
    #[cfg(not(unix))]
    {
        std::fs::metadata(path).map(|_| ())
    }
}

/// Checks whether the current process has execute access to `path` (`access(X_OK)` on Unix).
pub fn can_access_execute(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        unix::can_access_execute(path)
    }
    #[cfg(not(unix))]
    {
        let meta = std::fs::metadata(path)?;
        if meta.is_file() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Path is not a regular file.",
            ))
        }
    }
}

/// Returns `(device, inode)` from `std::fs::Metadata` (`(0, 0)` on non-Unix).
pub fn metadata_device_inode(metadata: &std::fs::Metadata) -> (u64, u64) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (metadata.dev(), metadata.ino())
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        (0, 0)
    }
}

/// Returns whether two `std::fs::Metadata` snapshots identify the same file.
pub fn same_metadata_identity(expected: &std::fs::Metadata, actual: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        expected.dev() == actual.dev() && expected.ino() == actual.ino()
    }
    #[cfg(not(unix))]
    {
        let millis = |m: &std::fs::Metadata| {
            m.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
        };
        expected.len() == actual.len() && millis(expected) == millis(actual)
    }
}

/// Cross-platform stat summary extracted from a `cap_std::fs::Metadata`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapStatSummary {
    pub len: u64,
    pub mtime_ns: i128,
    pub ctime_ns: i128,
    pub ino: u64,
    pub dev: u64,
    pub mode: u32,
    pub nlink: u64,
    pub readonly: bool,
}

/// Extracts a [`CapStatSummary`] from a `cap_std::fs::Metadata`.
pub fn cap_stat_summary(meta: &Metadata) -> CapStatSummary {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        CapStatSummary {
            len: meta.len(),
            mtime_ns: i128::from(meta.mtime()) * 1_000_000_000 + i128::from(meta.mtime_nsec()),
            ctime_ns: i128::from(meta.ctime()) * 1_000_000_000 + i128::from(meta.ctime_nsec()),
            ino: meta.ino(),
            dev: meta.dev(),
            mode: meta.mode(),
            nlink: meta.nlink(),
            readonly: meta.permissions().readonly(),
        }
    }
    #[cfg(not(unix))]
    {
        let mtime_ns = meta
            .modified()
            .ok()
            .and_then(|t| t.into_std().duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_nanos() as i128);
        CapStatSummary {
            len: meta.len(),
            mtime_ns,
            ctime_ns: 0,
            ino: 0,
            dev: 0,
            mode: 0,
            nlink: 1,
            readonly: meta.permissions().readonly(),
        }
    }
}

/// Builds a change-detection version token from `cap_std::fs::Metadata`.
pub fn cap_version_token(meta: &Metadata) -> String {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}:{}.{}:{}.{}",
            meta.dev(),
            meta.ino(),
            meta.mode(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        )
    }
    #[cfg(not(unix))]
    {
        let modified_ns = meta
            .modified()
            .ok()
            .and_then(|t| t.into_std().duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0u128, |d| d.as_nanos());
        format!("{}:{modified_ns}", meta.len())
    }
}

/// Returns `true` when `meta` reports more than one hard link (`nlink != 1` on Unix).
pub fn cap_has_multiple_links(meta: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        meta.nlink() != 1
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        false
    }
}

/// Makes a copied capability-confined directory writable/removable (`| 0o700` on Unix; clears readonly on non-Unix).
pub fn make_dir_removable(dir: &Dir, meta: &Metadata) -> io::Result<()> {
    let mut permissions = meta.permissions();
    #[cfg(unix)]
    {
        use cap_std::fs::PermissionsExt;
        permissions.set_mode(permissions.mode() | 0o700);
    }
    #[cfg(not(unix))]
    permissions.set_readonly(false);
    dir.set_permissions(".", permissions)
}

/// Normalizes a path-derived lookup key for platform filename case sensitivity
/// (lowercasing on Windows, preserving case elsewhere).
pub fn fold_path_key(value: String) -> String {
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
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

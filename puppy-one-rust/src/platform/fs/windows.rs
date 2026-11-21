//! Windows filesystem primitives (lock-tolerant atomic replace retry,
//! atomic no-replace rename via `MoveFileExW`, and NTFS file identity).
use cap_std::fs::{Dir, File};
use std::{
    ffi::OsString,
    io,
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::AsRawHandle,
    },
    path::{Path, PathBuf},
    time::Duration,
};
use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_FLAG_BACKUP_SEMANTICS,
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_NAME_NORMALIZED, FILE_SHARE_DELETE, FILE_SHARE_READ,
            FILE_SHARE_WRITE, GetFileInformationByHandle, GetFinalPathNameByHandleW,
            MOVE_FILE_FLAGS, MoveFileExW, OPEN_EXISTING,
        },
    },
    core::PCWSTR,
};

const ERROR_SHARING_VIOLATION: i32 = 32;
const ERROR_ACCESS_DENIED: i32 = 5;

pub(super) fn sync_dir(_dir: &Dir) -> io::Result<()> {
    // Windows does not expose POSIX directory fsync on handle-confined dirs;
    // durability is established by `File::sync_all()` on the replaced file.
    Ok(())
}

fn dir_final_path(dir: &Dir) -> io::Result<PathBuf> {
    let handle = HANDLE(dir.as_raw_handle());
    let mut buf = vec![0u16; 512];
    loop {
        // SAFETY: `handle` is a live `cap_std::fs::Dir` handle; `buf` is writable.
        let len =
            unsafe { GetFinalPathNameByHandleW(handle, &mut buf, FILE_NAME_NORMALIZED) } as usize;
        if len == 0 {
            return Err(io::Error::last_os_error());
        }
        if len < buf.len() {
            buf.truncate(len);
            return Ok(PathBuf::from(OsString::from_wide(&buf)));
        }
        buf.resize(len + 1, 0);
    }
}

fn extended_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if raw.starts_with(r"\\?\") || raw.starts_with(r"\\.\") {
        return PathBuf::from(raw.replace('/', r"\"));
    }
    let abs = std::path::absolute(path).unwrap_or_else(|_| crate::platform::paths::absolute(path));
    let normalized = abs.to_string_lossy().replace('/', r"\");
    if normalized.starts_with(r"\\?\") || normalized.starts_with(r"\\.\") {
        return PathBuf::from(normalized);
    }
    if let Some(unc_tail) = normalized.strip_prefix(r"\\") {
        PathBuf::from(format!(r"\\?\UNC\{unc_tail}"))
    } else {
        PathBuf::from(format!(r"\\?\{normalized}"))
    }
}

fn wide_nul(path: &Path) -> Vec<u16> {
    extended_path(path)
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn hresult_to_io(error: windows::core::Error) -> io::Error {
    let hr = error.code().0 as u32;
    if (hr & 0xFFFF_0000) == 0x8007_0000 {
        io::Error::from_raw_os_error((hr & 0xFFFF) as i32)
    } else {
        io::Error::other(error)
    }
}

/// Atomically renames `from`/`name` to `to`/`next` without replacing an
/// existing distinct entry (allowing NTFS case-only renames of the same file).
pub(super) fn exclusive_rename(from: &Dir, name: &Path, to: &Dir, next: &Path) -> io::Result<()> {
    let src = wide_nul(&dir_final_path(from)?.join(name));
    let dst = wide_nul(&dir_final_path(to)?.join(next));
    // SAFETY: both slices are NUL-terminated UTF-16 paths; flags=0 translates to
    // `ReplaceIfExists = FALSE`, atomically rejecting collisions while allowing
    // case-only renames of the same file on NTFS.
    let result = unsafe {
        MoveFileExW(
            PCWSTR(src.as_ptr()),
            PCWSTR(dst.as_ptr()),
            MOVE_FILE_FLAGS(0),
        )
    };
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            let io_error = hresult_to_io(error);
            if matches!(
                io_error.raw_os_error(),
                Some(ERROR_ACCESS_DENIED | ERROR_SHARING_VIOLATION)
            ) && to.symlink_metadata(next).is_ok()
            {
                Err(io::ErrorKind::AlreadyExists.into())
            } else {
                Err(io_error)
            }
        }
    }
}

/// Queries the stable NTFS `(volume_serial, file_index)` for an open file handle.
pub(super) fn file_identity(file: &File) -> Option<(u64, u64)> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    let handle = HANDLE(file.as_raw_handle());
    // SAFETY: `handle` is live for the duration of the call; `info` is valid.
    unsafe { GetFileInformationByHandle(handle, &mut info) }.ok()?;
    let index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    Some((u64::from(info.dwVolumeSerialNumber), index))
}

/// Queries the stable NTFS `(volume_serial, file_index)` for a path without
/// following symlinks or taking read/write locks.
pub(super) fn path_identity(path: &Path) -> Option<(u64, u64)> {
    let wide = wide_nul(path);
    // SAFETY: `wide` is NUL-terminated; `dwDesiredAccess = 0` queries identity
    // metadata without locking the entry against renames or deletions.
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            None,
        )
    }
    .ok()?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    let ok = unsafe { GetFileInformationByHandle(handle, &mut info) }.is_ok();
    unsafe {
        let _ = CloseHandle(handle);
    }
    if !ok {
        return None;
    }
    let index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    Some((u64::from(info.dwVolumeSerialNumber), index))
}

/// Queries the stable NTFS `(volume_serial, file_index)` for `name` inside `dir`.
pub(super) fn dir_entry_identity(dir: &Dir, name: &Path) -> Option<(u64, u64)> {
    let path = dir_final_path(dir).ok()?.join(name);
    path_identity(&path)
}

/// Retries `from.rename(name, to, next)` over a bounded backoff window when a
/// transient Windows sharing violation or antivirus/indexer lock occurs.
pub(super) fn rename_with_retry(from: &Dir, name: &Path, to: &Dir, next: &Path) -> io::Result<()> {
    const DELAYS_MS: [u64; 6] = [10, 20, 40, 80, 120, 200];
    let mut last_err = None;
    for delay in std::iter::once(0).chain(DELAYS_MS) {
        if delay > 0 {
            std::thread::sleep(Duration::from_millis(delay));
        }
        match from.rename(name, to, next) {
            Ok(()) => return Ok(()),
            Err(err)
                if matches!(
                    err.raw_os_error(),
                    Some(ERROR_SHARING_VIOLATION | ERROR_ACCESS_DENIED)
                ) =>
            {
                last_err = Some(err);
            }
            Err(err) => return Err(err),
        }
    }
    Err(last_err.unwrap_or_else(|| io::Error::other("rename failed")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extended_path_applies_verbatim_prefixes_for_drive_and_unc_paths() {
        assert_eq!(
            extended_path(Path::new(r"C:\Users\dev\docs\file.txt")),
            PathBuf::from(r"\\?\C:\Users\dev\docs\file.txt")
        );
        assert_eq!(
            extended_path(Path::new("C:/Users/dev/docs/file.txt")),
            PathBuf::from(r"\\?\C:\Users\dev\docs\file.txt")
        );
        assert_eq!(
            extended_path(Path::new(r"\\fileserver\share\dir\file.txt")),
            PathBuf::from(r"\\?\UNC\fileserver\share\dir\file.txt")
        );
        assert_eq!(
            extended_path(Path::new(r"\\?\C:\already\verbatim.txt")),
            PathBuf::from(r"\\?\C:\already\verbatim.txt")
        );
    }
}

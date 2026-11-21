//! Windows filesystem primitives (lock-tolerant atomic replace retry).
use cap_std::fs::Dir;
use std::{io, path::Path, time::Duration};

const ERROR_SHARING_VIOLATION: i32 = 32;
const ERROR_ACCESS_DENIED: i32 = 5;

pub(super) fn sync_dir(_dir: &Dir) -> io::Result<()> {
    // Windows does not expose POSIX directory fsync on handle-confined dirs;
    // durability is established by `File::sync_all()` on the replaced file.
    Ok(())
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

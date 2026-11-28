//! Bounded update preferences with private, atomic replacement. The GPUI service
//! calls writes synchronously, so mutations settle in caller order without a queue.
use serde_json::Value;
use std::{
    fs,
    io::{self, Read, Write},
    path::Path,
};

const NAME: &str = "desktop-update-preferences.json";
const MAX_BYTES: u64 = 64 * 1024;

fn validate_directory(data: &Path) -> io::Result<()> {
    if data.as_os_str().is_empty() || data.to_str().is_some_and(|s| s.trim().is_empty()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "A Desktop update preference directory is required.",
        ));
    }
    Ok(())
}

fn regular_bounded(metadata: &fs::Metadata) -> io::Result<()> {
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Desktop update preferences are unsafe or oversized.",
        ));
    }
    Ok(())
}

fn read(data: &Path) -> io::Result<bool> {
    validate_directory(data)?;
    let path = data.join(NAME);
    regular_bounded(&fs::symlink_metadata(&path)?)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Check the opened object too: a replacement between lstat and open
        // must neither follow a link nor block on a named pipe.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path)?;
    regular_bounded(&file.metadata()?)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Desktop update preferences exceed their limit.",
        ));
    }
    let value: Value = serde_json::from_slice(&bytes)?;
    // The first native writer omitted schemaVersion. Preserve only its exact
    // single-boolean document; the next successful write migrates it to v1.
    let legacy = value.as_object().is_some_and(|v| {
        v.len() == 1
            && v.get("automaticallyDownloadUpdates")
                .is_some_and(Value::is_boolean)
    });
    let supported = value.get("schemaVersion").and_then(Value::as_f64) == Some(1.0);
    Ok(!(supported || legacy)
        || value.get("automaticallyDownloadUpdates") != Some(&Value::Bool(false)))
}

fn read_with_warning(data: &Path, warn: impl FnOnce(&io::Error)) -> bool {
    match read(data) {
        Ok(enabled) => enabled,
        Err(error) => {
            if error.kind() != io::ErrorKind::NotFound {
                warn(&error);
            }
            true
        }
    }
}

/// Missing or unusable preferences default to automatic downloads. Invalid
/// documents warn once per read; a profile with no preference is quiet.
pub fn read_automatic_download(data: &Path) -> bool {
    read_with_warning(data, |error| {
        crate::diagnosticln!(
            "Unable to read Desktop update preferences; using automatic downloads: {error}"
        );
    })
}

pub fn write_automatic_download(data: &Path, enabled: bool) -> io::Result<()> {
    validate_directory(data)?;
    let mut directory = fs::DirBuilder::new();
    directory.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory.create(data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(data, fs::Permissions::from_mode(0o700));
    }
    // tempfile uses exclusive creation and private permissions. Its guard
    // removes the unique sibling on any failure, including failed replacement.
    let mut temporary = tempfile::Builder::new()
        .prefix(".desktop-update-preferences.")
        .suffix(".tmp")
        .tempfile_in(data)?;
    serde_json::to_writer(
        &mut temporary,
        &serde_json::json!({"schemaVersion": 1, "automaticallyDownloadUpdates": enabled}),
    )?;
    temporary.write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    let target = data.join(NAME);
    #[cfg(windows)]
    {
        let mut file = temporary;
        for attempt in 0..25 {
            match file.persist(&target) {
                Ok(_) => return Ok(()),
                Err(error)
                    if attempt < 24
                        && (error.error.kind() == io::ErrorKind::PermissionDenied
                            || error.error.raw_os_error() == Some(32)) =>
                {
                    file = error.file;
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(error) => return Err(error.error),
            }
        }
        unreachable!()
    }
    #[cfg(not(windows))]
    {
        temporary.persist(&target).map_err(|error| error.error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;

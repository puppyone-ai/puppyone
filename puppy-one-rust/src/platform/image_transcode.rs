//! AVIF decoding through the platform codec, using an admitted immutable
//! snapshot, private files, bounded output, and an owned cancellable process.
use std::{
    io::Read,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_OUTPUT_BYTES: usize = 128 * 1024 * 1024;
const CANCELLED: &str = "Image decoding was cancelled";

pub fn needs_transcode(name: &str) -> bool {
    name.rsplit('.')
        .next()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("avif"))
}

pub fn bytes_to_png(bytes: &[u8], max_bytes: u64) -> Result<Vec<u8>, String> {
    bytes_to_png_cancellable(bytes, max_bytes, &AtomicBool::new(false))
}

pub fn bytes_to_png_cancellable(
    bytes: &[u8],
    max_bytes: u64,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    if !cfg!(target_os = "macos") {
        return Err("AVIF decoding needs the platform image codec".into());
    }
    transcode_with(
        bytes,
        max_bytes,
        cancel,
        Path::new("/usr/bin/sips"),
        TIMEOUT,
        MAX_OUTPUT_BYTES,
    )
}

fn transcode_with(
    bytes: &[u8],
    max_bytes: u64,
    cancel: &AtomicBool,
    converter: &Path,
    timeout: Duration,
    max_output: usize,
) -> Result<Vec<u8>, String> {
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    if bytes.len() as u64 > max_bytes {
        return Err("image exceeds its preview budget".into());
    }
    let dir = tempfile::Builder::new()
        .prefix("puppyone-image-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let input = dir.path().join("source.avif");
    crate::platform::webview::write_private(&input, bytes).map_err(|e| e.to_string())?;
    // Relative, fixed names make the child independent of the provider's path.
    super::process::run_output(
        converter,
        &["-s", "format", "png", "source.avif", "--out", "preview.png"],
        dir.path(),
        None,
        timeout,
        cancel,
        super::process::OutputLimits {
            stdout: 64 * 1024,
            stderr: 64 * 1024,
        },
    )?;
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    let bytes = read_regular(&dir.path().join("preview.png"), max_output as u64)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Image codec returned no PNG".into());
    }
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    Ok(bytes)
}

/// Explicit path callers (native fixtures) also admit once and then decode a
/// private snapshot. Workspace viewers must use the provider byte entry point.
pub fn to_png(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    bytes_to_png(&read_regular(path, max_bytes)?, max_bytes)
}

fn read_regular(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err("Image file is not regular or exceeds its budget".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || opened.len() > max_bytes {
        return Err("Image file changed or exceeds its budget".into());
    }
    let bytes = super::process::bounded_read(
        (&file).take(max_bytes.saturating_add(1)),
        usize::try_from(max_bytes).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    if bytes.len() as u64 != opened.len()
        || opened.len() != after.len()
        || opened.modified().ok() != after.modified().ok()
    {
        return Err("Image file changed while reading".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn converter(root: &Path, script: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join("codec");
        std::fs::write(&path, format!("#!/bin/sh\nset -eu\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn conversion_admits_before_spawning_and_bounds_its_private_output() {
        let dir = tempfile::tempdir().unwrap();
        let codec = converter(
            dir.path(),
            "printf '\\211PNG\\r\\n\\032\\n' > preview.png\nprintf '0123456789' >> preview.png",
        );
        let cancel = AtomicBool::new(false);
        let convert = |input: &[u8], max, cap| {
            transcode_with(input, max, &cancel, &codec, Duration::from_secs(2), cap)
        };
        assert!(convert(b"input", 4, 18).is_err());
        assert_eq!(convert(b"input", 5, 18).unwrap().len(), 18);
        assert!(convert(b"input", 5, 17).is_err());
        cancel.store(true, Ordering::Release);
        let absent = dir.path().join("must-not-execute");
        assert_eq!(
            transcode_with(b"input", 5, &cancel, &absent, Duration::from_secs(2), 18).unwrap_err(),
            CANCELLED
        );
    }

    #[cfg(unix)]
    #[test]
    fn codec_output_rejects_links_missing_files_and_invalid_pngs() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        for script in [
            "exit 0",
            "printf invalid > preview.png",
            "ln -s source.avif preview.png",
            "mkdir preview.png",
            "exit 7",
        ] {
            let codec = converter(dir.path(), script);
            assert!(
                transcode_with(
                    b"\x89PNG\r\n\x1a\n",
                    8,
                    &cancel,
                    &codec,
                    Duration::from_secs(2),
                    128
                )
                .is_err(),
                "{script}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_or_timing_out_image_conversion_reaps_the_codec_and_removes_its_files() {
        use std::time::Instant;
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("started");
        // Fixed test-owned temp paths, with no provider/user path interpolation.
        let codec = converter(
            dir.path(),
            &format!(
                "printf '%s\\n%s\\n' \"$$\" \"$PWD\" > '{}'\nexec /bin/sleep 30",
                marker.display()
            ),
        );
        for timeout in [false, true] {
            let cancel = AtomicBool::new(false);
            let started = Instant::now();
            std::thread::scope(|scope| {
                let job = scope.spawn(|| {
                    transcode_with(
                        b"input",
                        5,
                        &cancel,
                        &codec,
                        if timeout {
                            Duration::from_millis(250)
                        } else {
                            Duration::from_secs(5)
                        },
                        128,
                    )
                });
                while !marker.exists()
                    || std::fs::read_to_string(&marker).unwrap().lines().count() < 2
                {
                    assert!(started.elapsed() < Duration::from_secs(3));
                    std::thread::sleep(Duration::from_millis(1));
                }
                let info = std::fs::read_to_string(&marker).unwrap();
                let mut lines = info.lines();
                let pid: i32 = lines.next().unwrap().parse().unwrap();
                let temporary = Path::new(lines.next().unwrap());
                assert!(temporary.join("source.avif").is_file());
                if !timeout {
                    cancel.store(true, Ordering::Release);
                }
                assert!(job.join().unwrap().is_err());
                assert!(!temporary.exists());
                assert_eq!(
                    unsafe { libc::kill(pid, 0) },
                    -1,
                    "codec survived its owner"
                );
            });
            assert!(started.elapsed() < Duration::from_secs(3));
            std::fs::remove_file(&marker).unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hosted_avif_uses_the_same_codec_and_rejects_oversized_or_invalid_bytes() {
        let avif = include_bytes!("../../fixtures/media/red.avif");
        let png = bytes_to_png(avif, avif.len() as u64).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(bytes_to_png(avif, avif.len() as u64 - 1).is_err());
        assert!(bytes_to_png(b"not an image", 1024).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn avif_is_transcoded_to_png_through_imageio() {
        assert!(needs_transcode("photo.AVIF"));
        assert!(!needs_transcode("photo.png"));
        let fixture = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("fixtures/media/red.avif");
        let png = to_png(&fixture, 1 << 20).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(to_png(&fixture, 10).is_err());
    }
}

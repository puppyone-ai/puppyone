//! Image formats the product shows (Chromium decodes them) but GPUI's
//! decoder does not: AVIF. macOS ImageIO decodes them (via `sips`, which
//! wraps it) into PNG for the native image preview. Bounded input, a private
//! temporary output and a deadline; the source file is never modified.
use std::{path::Path, process::Command, time::Duration};

/// Whether GPUI needs an ImageIO transcode for `name`.
pub fn needs_transcode(name: &str) -> bool {
    name.rsplit('.')
        .next()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("avif"))
}

/// Decode an immutable hosted snapshot with the same codec and input budget.
/// The temporary file belongs to this call; neither its name nor its location
/// comes from the remote provider.
pub fn bytes_to_png(bytes: &[u8], max_bytes: u64) -> Result<Vec<u8>, String> {
    if bytes.len() as u64 > max_bytes {
        return Err("image exceeds its preview budget".into());
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input = dir.path().join("source.avif");
    crate::platform::webview::write_private(&input, bytes).map_err(|e| e.to_string())?;
    to_png(&input, max_bytes)
}

/// PNG bytes of `path` (an AVIF), or why it could not be decoded.
pub fn to_png(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > max_bytes {
        return Err("image exceeds its preview budget".into());
    }
    if !cfg!(target_os = "macos") {
        return Err("AVIF decoding needs the platform image codec".into());
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let out = dir.path().join("preview.png");
    let mut child = Command::new("/usr/bin/sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(path)
        .arg("--out")
        .arg(&out)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err(format!("image decoder exited with {status}"));
            }
            break;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("image decoding timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    std::fs::read(&out).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_avif_uses_the_same_codec_and_rejects_oversized_or_invalid_bytes() {
        let avif = include_bytes!("../../fixtures/media/red.avif");
        let png = bytes_to_png(avif, avif.len() as u64).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(bytes_to_png(avif, avif.len() as u64 - 1).is_err());
        assert!(bytes_to_png(b"not an image", 1024).is_err());
    }

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

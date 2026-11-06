//! `convertMacosOfficeDocumentToDocx` (`electron/main/platform/macos/
//! office-document-converter.mjs`): legacy Word (.doc) and RTF become DOCX
//! through macOS `textutil` in a private temporary folder, under the product's
//! input, output and time limits; the Office preview renders the result like
//! any DOCX. The source file is only read.
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const MAX_INPUT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_millis(8000);

/// The converted document and `textutil`'s warnings.
#[derive(Debug)]
pub struct Converted {
    pub bytes: Vec<u8>,
    pub warnings: Vec<String>,
}

/// `formatFileSize`.
fn size(bytes: u64) -> String {
    format!("{} MB", bytes / (1024 * 1024))
}

pub fn convert_to_docx(path: &Path) -> Result<Converted, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Unable to read file metadata: {e}"))?;
    if metadata.is_dir() {
        return Err("Selected path is a folder.".into());
    }
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "File is larger than the {} Office preview limit.",
            size(MAX_INPUT_BYTES)
        ));
    }
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if extension != "doc" && extension != "rtf" {
        return Err("Only .doc and .rtf files can be converted by this preview bridge.".into());
    }
    if !cfg!(target_os = "macos") {
        return Err("Office conversion is unavailable for this provider.".into());
    }
    let dir = tempfile::Builder::new()
        .prefix("puppyone-office-")
        .tempdir()
        .map_err(|e| format!("Office conversion failed: {e}"))?;
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".into());
    let output = dir.path().join(format!("{stem}.docx"));
    let mut child = Command::new("/usr/bin/textutil")
        .args(["-convert", "docx"])
        .arg(path)
        .arg("-output")
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Office conversion failed: {e}"))?;
    let mut stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut text = Vec::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr
                .take(MAX_OUTPUT_BYTES as u64 + 1)
                .read_to_end(&mut text);
        }
        text
    });
    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Office conversion failed: {e}"))?
        {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Office conversion timed out.".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let stderr = reader.join().unwrap_or_default();
    if stderr.len() > MAX_OUTPUT_BYTES {
        return Err(format!(
            "Office conversion output exceeded the {} process output limit.",
            size(MAX_OUTPUT_BYTES as u64)
        ));
    }
    let stderr = String::from_utf8_lossy(&stderr);
    if !status.success() {
        return Err(format!(
            "Office conversion failed: {}",
            stderr
                .trim()
                .lines()
                .next()
                .unwrap_or("textutil exited unsuccessfully")
        ));
    }
    let produced = std::fs::metadata(&output)
        .map_err(|e| format!("Office conversion did not produce a DOCX file: {e}"))?;
    if !produced.is_file() {
        return Err("Office conversion did not produce a DOCX file.".into());
    }
    if produced.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "Converted DOCX is larger than the {} Office preview limit.",
            size(MAX_INPUT_BYTES)
        ));
    }
    let bytes = std::fs::read(&output)
        .map_err(|e| format!("Office conversion did not produce a DOCX file: {e}"))?;
    Ok(Converted {
        bytes,
        warnings: stderr
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rtf_converts_to_a_docx_package_and_other_inputs_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let rtf = dir.path().join("a.rtf");
        std::fs::write(
            &rtf,
            r"{\rtf1\ansi{\fonttbl\f0 Helvetica;}\f0 Hello \b world\b0.}",
        )
        .unwrap();
        let converted = convert_to_docx(&rtf).unwrap();
        // A DOCX is a ZIP package.
        assert!(converted.bytes.starts_with(b"PK\x03\x04"));
        let odt = dir.path().join("a.odt");
        std::fs::write(&odt, b"x").unwrap();
        assert!(
            convert_to_docx(&odt)
                .unwrap_err()
                .starts_with("Only .doc and .rtf")
        );
    }
}

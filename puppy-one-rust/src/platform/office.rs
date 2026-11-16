//! `convertMacosOfficeDocumentToDocx` (`electron/main/platform/macos/
//! office-document-converter.mjs`): legacy Word (.doc) and RTF become DOCX
//! through macOS `textutil` in a private temporary folder, under the product's
//! input, output and time limits; the Office preview renders the result like
//! any DOCX. The source file is only read.
use std::{
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
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

const CANCELLED: &str = "Office conversion was cancelled.";

pub fn convert_to_docx(path: &Path) -> Result<Converted, String> {
    convert_to_docx_cancellable(path, &AtomicBool::new(false))
}

pub fn convert_to_docx_cancellable(path: &Path, cancel: &AtomicBool) -> Result<Converted, String> {
    convert_with(path, cancel, Path::new("/usr/bin/textutil"), TIMEOUT)
}

fn convert_with(
    path: &Path,
    cancel: &AtomicBool,
    converter: &Path,
    timeout: Duration,
) -> Result<Converted, String> {
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Unable to read file metadata: {e}"))?;
    if !metadata.is_file() {
        return Err(
            "Office conversion requires a regular file, not a folder or symbolic link.".into(),
        );
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
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut source = options
        .open(path)
        .map_err(|e| format!("Unable to read Office source: {e}"))?;
    let opened = source.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || opened.len() > MAX_INPUT_BYTES {
        return Err("Office source changed or exceeded its size limit.".into());
    }
    let dir = tempfile::Builder::new()
        .prefix("puppyone-office-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    // Convert an immutable private snapshot. textutil never follows the source
    // path again after the no-follow admission above.
    let input_name = format!("source.{extension}");
    let mut input =
        std::fs::File::create(dir.path().join(&input_name)).map_err(|e| e.to_string())?;
    let mut read = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(CANCELLED.into());
        }
        let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        read += n as u64;
        if read > MAX_INPUT_BYTES {
            return Err("Office source exceeded its size limit.".into());
        }
        input.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
    }
    let after = source.metadata().map_err(|e| e.to_string())?;
    if opened.len() != after.len() || opened.modified().ok() != after.modified().ok() {
        return Err("Office source changed while it was being read.".into());
    }
    drop(input);
    let started = Instant::now();
    let result = super::process::run_output(
        converter,
        &["-convert", "docx", &input_name, "-output", "converted.docx"],
        dir.path(),
        None,
        timeout,
        cancel,
        super::process::OutputLimits {
            stdout: MAX_OUTPUT_BYTES,
            stderr: MAX_OUTPUT_BYTES,
        },
    )
    .map_err(|e| {
        if cancel.load(Ordering::Acquire) {
            CANCELLED.to_owned()
        } else if started.elapsed() >= timeout {
            "Office conversion timed out.".into()
        } else {
            format!("Office conversion failed: {e}")
        }
    })?;
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    let output = dir.path().join("converted.docx");
    let produced = std::fs::symlink_metadata(&output)
        .map_err(|e| format!("Office conversion did not produce a DOCX file: {e}"))?;
    if !produced.is_file() {
        return Err("Office conversion did not produce a regular DOCX file.".into());
    }
    if produced.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "Converted DOCX is larger than the {} Office preview limit.",
            size(MAX_INPUT_BYTES)
        ));
    }
    let bytes = super::process::bounded_read(
        options.open(output).map_err(|e| e.to_string())?,
        MAX_INPUT_BYTES as usize,
    )
    .map_err(|e| e.to_string())?;
    Ok(Converted {
        bytes,
        warnings: String::from_utf8_lossy(&result.stderr)
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

#[cfg(all(test, target_os = "macos"))]
mod lifetime_tests {
    use super::*;
    use std::{
        os::unix::fs::{PermissionsExt, symlink},
        sync::Arc,
        thread,
    };

    fn fixture(dir: &Path, body: &str) -> std::path::PathBuf {
        let script = dir.join("converter.sh");
        std::fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }
    fn input(dir: &Path) -> std::path::PathBuf {
        let input = dir.join("private source.rtf");
        std::fs::write(&input, r"{\rtf1 original}").unwrap();
        input
    }
    fn wait_ready(path: &Path) -> String {
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            if let Ok(s) = std::fs::read_to_string(path)
                && !s.trim().is_empty()
            {
                return s;
            }
            assert!(
                Instant::now() < deadline,
                "conversion did not announce its private directory"
            );
            thread::sleep(Duration::from_millis(2));
        }
    }
    #[test]
    fn precancellation_precedes_source_and_converter_lookup() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            convert_with(
                &dir.path().join("missing.rtf"),
                &AtomicBool::new(true),
                &dir.path().join("missing-program"),
                TIMEOUT
            )
            .unwrap_err(),
            CANCELLED
        );
    }
    #[test]
    fn source_links_directories_and_oversize_files_never_reach_the_converter() {
        let dir = tempfile::tempdir().unwrap();
        let original = input(dir.path());
        let link = dir.path().join("link.rtf");
        symlink(&original, &link).unwrap();
        let oversized = dir.path().join("large.rtf");
        std::fs::File::create(&oversized)
            .unwrap()
            .set_len(MAX_INPUT_BYTES + 1)
            .unwrap();
        for path in [&link, dir.path(), &oversized] {
            assert!(
                convert_with(
                    path,
                    &AtomicBool::new(false),
                    &dir.path().join("must-not-run"),
                    TIMEOUT
                )
                .is_err()
            );
        }
        assert_eq!(
            std::fs::read_to_string(&original).unwrap(),
            r"{\rtf1 original}"
        );
    }
    #[test]
    fn successful_conversion_returns_warnings_and_removes_its_private_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let original = input(dir.path());
        let receipt = dir.path().join("private-directory");
        let script = fixture(
            dir.path(),
            &format!(
                "printf '%s' \"$PWD\" > '{}'\nprintf 'PK\\003\\004converted' > \"$5\"\nprintf '  first warning  \\n\\nsecond warning\\n' >&2",
                receipt.display()
            ),
        );
        let converted = convert_with(&original, &AtomicBool::new(false), &script, TIMEOUT).unwrap();
        assert_eq!(converted.bytes, b"PK\x03\x04converted");
        assert_eq!(converted.warnings, ["first warning", "second warning"]);
        assert!(!Path::new(&wait_ready(&receipt)).exists());
        assert_eq!(
            std::fs::read_to_string(original).unwrap(),
            r"{\rtf1 original}"
        );
    }
    #[test]
    fn cancellation_keeps_temporary_files_until_the_owned_child_has_exited() {
        let dir = tempfile::tempdir().unwrap();
        let original = input(dir.path());
        let receipt = dir.path().join("private-directory");
        let alive_on_term = dir.path().join("alive-on-term");
        let script = fixture(
            dir.path(),
            &format!(
                "trap '[ -d \"$PWD\" ] && printf alive > \"{}\"' TERM\nprintf '%s' \"$PWD\" > '{}'\nwhile :; do /bin/sleep 1; done",
                alive_on_term.display(),
                receipt.display()
            ),
        );
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_cancel = cancel.clone();
        let worker =
            thread::spawn(move || convert_with(&original, &worker_cancel, &script, TIMEOUT));
        let private = wait_ready(&receipt);
        assert!(Path::new(&private).join("source.rtf").is_file());
        cancel.store(true, Ordering::Release);
        assert_eq!(worker.join().unwrap().unwrap_err(), CANCELLED);
        assert_eq!(std::fs::read_to_string(alive_on_term).unwrap(), "alive");
        assert!(!Path::new(&private).exists());
    }
    #[test]
    fn deadlines_and_full_stderr_are_bounded_and_clean_the_conversion_directory() {
        for overflow in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let original = input(dir.path());
            let receipt = dir.path().join("private-directory");
            let body = if overflow {
                "/bin/dd if=/dev/zero bs=65536 count=129 >&2\nexec /bin/sleep 30"
            } else {
                "exec /bin/sleep 30"
            };
            let script = fixture(
                dir.path(),
                &format!("printf '%s' \"$PWD\" > '{}'\n{body}", receipt.display()),
            );
            let started = Instant::now();
            let result = convert_with(
                &original,
                &AtomicBool::new(false),
                &script,
                if overflow {
                    TIMEOUT
                } else {
                    Duration::from_millis(100)
                },
            );
            assert!(started.elapsed() < Duration::from_secs(4));
            let error = result.unwrap_err();
            assert!(
                error.contains(if overflow {
                    "output limit"
                } else {
                    "timed out"
                }),
                "{error}"
            );
            // A deadline may expire during OS process startup, before the
            // script can write its receipt. If it ran, its directory is gone.
            if let Ok(private) = std::fs::read_to_string(&receipt) {
                assert!(!Path::new(&private).exists());
            } else {
                assert!(!overflow, "output overflow requires an executed converter");
            }
        }
    }
    #[test]
    fn missing_or_symlinked_outputs_are_never_returned_as_converted_bytes() {
        for linked in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let original = input(dir.path());
            let body = if linked {
                "ln -s \"$3\" \"$5\""
            } else {
                "exit 0"
            };
            let script = fixture(dir.path(), body);
            assert!(
                convert_with(&original, &AtomicBool::new(false), &script, TIMEOUT)
                    .unwrap_err()
                    .contains("DOCX")
            );
            assert_eq!(
                std::fs::read_to_string(original).unwrap(),
                r"{\rtf1 original}"
            );
        }
    }
}

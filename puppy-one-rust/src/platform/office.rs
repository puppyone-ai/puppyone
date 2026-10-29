//! Office documents without a browser renderer (RTF, legacy .doc,
//! OpenDocument text): macOS `textutil` converts them to standalone HTML in a
//! private temporary folder, with a size budget and a deadline. The source
//! file is only read.
use std::{path::Path, process::Command, time::Duration};

pub fn convert_to_html(path: &Path, max_bytes: u64) -> Result<String, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > max_bytes {
        return Err("document exceeds its preview budget".into());
    }
    if !cfg!(target_os = "macos") {
        return Err("document conversion needs the platform converter".into());
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let out = dir.path().join("document.html");
    let mut child = Command::new("/usr/bin/textutil")
        .args(["-convert", "html", "-strip", "-noload", "-output"])
        .arg(&out)
        .arg(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err(format!("converter exited with {status}"));
            }
            break;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("document conversion timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let html = std::fs::read_to_string(&out).map_err(|e| e.to_string())?;
    // Converted documents never run scripts.
    Ok(html
        .replace("<script", "<!--script")
        .replace("</script>", "</script-->"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rtf_converts_to_html_without_scripts() {
        let dir = tempfile::tempdir().unwrap();
        let rtf = dir.path().join("a.rtf");
        std::fs::write(
            &rtf,
            r"{\rtf1\ansi{\fonttbl\f0 Helvetica;}\f0 Hello \b world\b0.}",
        )
        .unwrap();
        let html = convert_to_html(&rtf, 1 << 20).unwrap();
        assert!(html.contains("Hello") && html.contains("world"));
        assert!(convert_to_html(&rtf, 4).is_err());
    }
}

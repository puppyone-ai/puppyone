//! Hand an entry to the operating system (Reveal in Finder / Open in default
//! app). Paths come from `Workspace::absolute`, never from Web content.
use std::path::Path;
fn spawn(args: &[&std::ffi::OsStr]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = args;
        Err(crate::localization::t("native.desktop.openUnsupported").into())
    }
}
pub fn reveal(path: &Path) -> Result<(), String> {
    spawn(&["-R".as_ref(), path.as_os_str()])
}
/// Show a folder in Finder (`shell.openPath` on a directory).
pub fn open_directory(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("Not a folder".into());
    }
    spawn(&[path.as_os_str()])
}
pub fn open(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(crate::localization::t("native.desktop.openFilesOnly").into());
    }
    spawn(&[path.as_os_str()])
}
/// Open an http(s) URL in the system browser (validated; nothing else).
pub fn open_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only http(s) links open in the browser".into());
    }
    spawn(&[parsed.as_str().as_ref()])
}

//! Cross-platform desktop shell integration: reveal in file manager, open a
//! regular file or folder with the OS default handler, open validated `http(s)`
//! URLs in the system browser, and show the standard About dialog (`capabilities.md`).
//!
//! Paths always come from `Workspace::absolute`, never from untrusted Web content.
use std::path::Path;

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod imp;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod imp;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod imp;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use std::path::Path;
    pub(super) fn reveal(_: &Path) -> Result<(), String> {
        Err(crate::localization::t("native.desktop.openUnsupported").into())
    }
    pub(super) fn open_directory(_: &Path) -> Result<(), String> {
        Err(crate::localization::t("native.desktop.openUnsupported").into())
    }
    pub(super) fn open_file(_: &Path) -> Result<(), String> {
        Err(crate::localization::t("native.desktop.openUnsupported").into())
    }
    pub(super) fn open_url(_: &str) -> Result<(), String> {
        Err(crate::localization::t("native.desktop.openUnsupported").into())
    }
    pub(super) fn show_about_panel() {}
}

/// Reveals `path` in the OS file manager (Finder / Explorer / FileManager1).
pub fn reveal(path: &Path) -> Result<(), String> {
    imp::reveal(path)
}

/// Opens a folder in the OS file manager (`shell.openPath` on a directory).
pub fn open_directory(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("Not a folder".into());
    }
    imp::open_directory(path)
}

/// Opens a regular file in its default application. Symlinks are refused rather
/// than followed because their target may have changed since inspection.
pub fn open(path: &Path) -> Result<(), String> {
    if !std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file()) {
        return Err(crate::localization::t("native.desktop.openFilesOnly").into());
    }
    #[cfg(any(test, feature = "test-support"))]
    if let Some(opened) = OPENED.with(|o| o.borrow().clone()) {
        opened.borrow_mut().push(path.to_path_buf());
        return Ok(());
    }
    imp::open_file(path)
}

/// `isPotentiallyExecutableFile`: a file the system may run rather than show,
/// by its extension or (on Unix) an execute bit. Opening one prompts first.
pub fn potentially_executable(path: &Path) -> bool {
    const RUNS: &[&str] = &[
        "apk",
        "app",
        "application",
        "appimage",
        "bat",
        "cmd",
        "com",
        "command",
        "cpl",
        "deb",
        "desktop",
        "dmg",
        "exe",
        "gadget",
        "hta",
        "jar",
        "js",
        "jse",
        "lnk",
        "msi",
        "msp",
        "mst",
        "pif",
        "pl",
        "pkg",
        "ps1",
        "py",
        "pyw",
        "rb",
        "reg",
        "rpm",
        "run",
        "scpt",
        "scr",
        "sh",
        "tool",
        "url",
        "vbe",
        "vbs",
        "workflow",
        "wsf",
        "wsh",
    ];
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if extension.is_some_and(|e| RUNS.contains(&e.as_str())) {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    false
}

#[cfg(any(test, feature = "test-support"))]
type Opened = std::rc::Rc<std::cell::RefCell<Vec<std::path::PathBuf>>>;
#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static OPENED: std::cell::RefCell<Option<Opened>> = const { std::cell::RefCell::new(None) };
}
/// Tests: this thread's `open` calls are recorded instead of launching apps.
#[cfg(any(test, feature = "test-support"))]
pub fn record_opens() -> Opened {
    let opened = Opened::default();
    OPENED.with(|o| *o.borrow_mut() = Some(opened.clone()));
    opened
}

/// Opens a validated credential-free `http(s)` URL in the system browser.
pub fn open_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only http(s) links open in the browser".into());
    }
    imp::open_url(parsed.as_str())
}

/// `role: "about"`: shows the platform's standard About panel (macOS AppKit).
pub fn show_about_panel() {
    imp::show_about_panel();
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn scripts_and_executable_files_ask_and_links_are_never_opened() {
        let dir = tempfile::tempdir().unwrap();
        let file = |name: &str, mode: u32| {
            let path = dir.path().join(name);
            std::fs::write(&path, "echo").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
            }
            #[cfg(not(unix))]
            let _ = mode;
            path
        };
        for name in [
            "run.command",
            "install.SH",
            "tool.py",
            "setup.pkg",
            "start.cmd",
            "installer.exe",
            "launch.ps1",
        ] {
            assert!(potentially_executable(&file(name, 0o644)), "{name}");
        }
        #[cfg(unix)]
        assert!(potentially_executable(&file("binary", 0o755)));
        assert!(!potentially_executable(&file("note.md", 0o644)));
        let opened = record_opens();
        let note = dir.path().join("note.md");
        open(&note).unwrap();
        #[cfg(unix)]
        {
            let link = dir.path().join("link.md");
            std::os::unix::fs::symlink(&note, &link).unwrap();
            assert!(open(&link).is_err());
        }
        assert!(open(dir.path()).is_err());
        assert_eq!(*opened.borrow(), [note]);
    }

    #[test]
    fn open_url_rejects_non_http_and_credentialed_urls() {
        assert!(open_url("file:///etc/passwd").is_err());
        assert!(open_url("javascript:alert(1)").is_err());
        assert!(open_url("https://user:pass@example.com/").is_err());
        assert!(open_url("not a url").is_err());
    }
}

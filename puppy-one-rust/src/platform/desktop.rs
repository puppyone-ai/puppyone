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
/// Open a regular file in its default app. A link is refused rather than
/// followed: what it names may have changed since it was checked.
pub fn open(path: &Path) -> Result<(), String> {
    if !std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file()) {
        return Err(crate::localization::t("native.desktop.openFilesOnly").into());
    }
    #[cfg(any(test, feature = "test-support"))]
    if let Some(opened) = OPENED.with(|o| o.borrow().clone()) {
        opened.borrow_mut().push(path.to_path_buf());
        return Ok(());
    }
    spawn(&[path.as_os_str()])
}

/// `isPotentiallyExecutableFile`: a file the system may run rather than
/// show, by its type or (on Unix) an execute bit. Opening one asks first.
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
/// Tests: this thread's `open` calls are recorded instead of launching
/// apps.
#[cfg(any(test, feature = "test-support"))]
pub fn record_opens() -> Opened {
    let opened = Opened::default();
    OPENED.with(|o| *o.borrow_mut() = Some(opened.clone()));
    opened
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

/// `role: "about"`: the system's standard About panel (the bundle's name,
/// version, copyright and icon).
pub fn show_about_panel() {
    #[cfg(target_os = "macos")]
    if let Some(mtm) = objc2::MainThreadMarker::new() {
        objc2_app_kit::NSApplication::sharedApplication(mtm).orderFrontStandardAboutPanel(None);
    }
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
}

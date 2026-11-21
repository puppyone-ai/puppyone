//! macOS desktop shell adapter (`/usr/bin/open` + AppKit About panel).
use std::{ffi::OsStr, path::Path, process::Stdio};

fn spawn(args: &[&OsStr]) -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(super) fn reveal(path: &Path) -> Result<(), String> {
    spawn(&["-R".as_ref(), path.as_os_str()])
}

pub(super) fn open_directory(path: &Path) -> Result<(), String> {
    spawn(&[path.as_os_str()])
}

pub(super) fn open_file(path: &Path) -> Result<(), String> {
    spawn(&[path.as_os_str()])
}

pub(super) fn open_url(url: &str) -> Result<(), String> {
    spawn(&[url.as_ref()])
}

pub(super) fn show_about_panel() {
    if let Some(mtm) = objc2::MainThreadMarker::new() {
        objc2_app_kit::NSApplication::sharedApplication(mtm).orderFrontStandardAboutPanel(None);
    }
}

//! Linux desktop shell adapter (`org.freedesktop.FileManager1` over `zbus` + `xdg-open`).
use std::{ffi::OsStr, path::Path, process::Stdio};

fn xdg_open(target: &OsStr) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch xdg-open: {e}"))
}

fn reveal_via_file_manager_dbus(path: &Path) -> Result<(), String> {
    let uri = url::Url::from_file_path(path)
        .map_err(|()| "Path must be absolute to reveal via FileManager1".to_owned())?;
    let uri_str = uri.to_string();
    futures_lite::future::block_on(async move {
        let connection = zbus::Connection::session()
            .await
            .map_err(|e| e.to_string())?;
        let uris: [&str; 1] = [uri_str.as_str()];
        connection
            .call_method(
                Some("org.freedesktop.FileManager1"),
                "/org/freedesktop/FileManager1",
                Some("org.freedesktop.FileManager1"),
                "ShowItems",
                &(&uris[..], ""),
            )
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}

pub(super) fn reveal(path: &Path) -> Result<(), String> {
    if reveal_via_file_manager_dbus(path).is_ok() {
        return Ok(());
    }
    let dir = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    xdg_open(dir.as_os_str())
}

pub(super) fn open_directory(path: &Path) -> Result<(), String> {
    xdg_open(path.as_os_str())
}

pub(super) fn open_file(path: &Path) -> Result<(), String> {
    xdg_open(path.as_os_str())
}

pub(super) fn open_url(url: &str) -> Result<(), String> {
    xdg_open(OsStr::new(url))
}

pub(super) fn show_about_panel() {}

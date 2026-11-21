//! Linux file clipboard (`text/uri-list` via `wl-copy` or `xclip`).
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

fn build_uri_list(paths: &[PathBuf]) -> Option<String> {
    let mut out = String::new();
    for path in paths {
        let url = url::Url::from_file_path(path).ok()?;
        out.push_str(url.as_str());
        out.push_str("\r\n");
    }
    (!out.is_empty()).then_some(out)
}

fn pipe_to(program: &str, args: &[&str], payload: &[u8]) -> bool {
    let Ok(mut child) = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    if let Some(mut stdin) = child.stdin.take()
        && stdin.write_all(payload).is_err()
    {
        return false;
    }
    child.wait().is_ok_and(|s| s.success())
}

#[cfg_attr(any(test, feature = "test-support"), allow(dead_code))]
pub(super) fn write_files(paths: &[PathBuf]) -> bool {
    let Some(uris) = build_uri_list(paths) else {
        return false;
    };
    let bytes = uris.as_bytes();
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && pipe_to("wl-copy", &["--type", "text/uri-list"], bytes)
    {
        return true;
    }
    pipe_to(
        "xclip",
        &["-selection", "clipboard", "-t", "text/uri-list"],
        bytes,
    )
}

pub(super) fn begin_text_drag(
    _window: &impl raw_window_handle::HasWindowHandle,
    _text: &str,
    _icon_path: &str,
    _ended: impl FnOnce() + 'static,
) -> bool {
    false
}

pub(super) fn begin_file_drag(
    _window: &impl raw_window_handle::HasWindowHandle,
    _files: &[PathBuf],
    _ended: impl FnOnce() + 'static,
) -> bool {
    false
}

pub(super) fn own_drag_files() -> Option<Vec<PathBuf>> {
    None
}

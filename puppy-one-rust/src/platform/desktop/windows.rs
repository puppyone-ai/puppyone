//! Windows desktop shell adapter (`SHOpenFolderAndSelectItems` + `ShellExecuteW`).
use std::{
    ffi::OsStr,
    os::windows::ffi::OsStrExt,
    path::Path,
    process::{Command, Stdio},
};
use windows::{
    Win32::{
        System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx},
        UI::{
            Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems, ShellExecuteW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    },
    core::PCWSTR,
};

fn wide_nul(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn shell_execute(target: &OsStr) -> Result<(), String> {
    let verb = wide_nul(OsStr::new("open"));
    let file = wide_nul(target);
    // SAFETY: `verb` and `file` are NUL-terminated UTF-16 buffers valid for the call.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result.0 as isize) > 32 {
        Ok(())
    } else {
        Err(format!(
            "ShellExecuteW failed with code {}",
            result.0 as isize
        ))
    }
}

pub(super) fn reveal(path: &Path) -> Result<(), String> {
    let wide = wide_nul(path.as_os_str());
    // SAFETY: STA COM init (ok if already initialized) and PIDL allocation/free.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let pidl = ILCreateFromPathW(PCWSTR(wide.as_ptr()));
        if !pidl.is_null() {
            let outcome = SHOpenFolderAndSelectItems(pidl, None, 0);
            ILFree(Some(pidl));
            if outcome.is_ok() {
                return Ok(());
            }
        }
    }
    // Fallback: invoke Explorer with `/select,<path>`.
    let mut arg = std::ffi::OsString::from("/select,");
    arg.push(path.as_os_str());
    Command::new("explorer.exe")
        .arg(arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(super) fn open_directory(path: &Path) -> Result<(), String> {
    shell_execute(path.as_os_str())
}

pub(super) fn open_file(path: &Path) -> Result<(), String> {
    shell_execute(path.as_os_str())
}

pub(super) fn open_url(url: &str) -> Result<(), String> {
    shell_execute(OsStr::new(url))
}

pub(super) fn show_about_panel() {}

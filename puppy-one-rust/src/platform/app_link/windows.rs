//! Windows single-instance handoff (Named Mutex + Named Pipe), CLI control
//! Named Pipe server, and per-user `HKCU\Software\Classes\<scheme>` registration.
use super::{SingleInstance, data_dir_token};
use crate::platform::cli_control::{self, AppInfo, Incoming};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
};
use windows::{
    Win32::{
        Foundation::{
            CloseHandle, ERROR_ALREADY_EXISTS, ERROR_PIPE_CONNECTED, GENERIC_READ, GENERIC_WRITE,
            GetLastError, HANDLE, INVALID_HANDLE_VALUE,
        },
        Storage::FileSystem::{
            CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_NONE, FlushFileBuffers,
            OPEN_EXISTING, PIPE_ACCESS_DUPLEX, ReadFile, WriteFile,
        },
        System::{
            Pipes::{
                ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
                PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT, WaitNamedPipeW,
            },
            Registry::{
                HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ, RegCloseKey,
                RegCreateKeyExW, RegSetValueExW,
            },
            Threading::CreateMutexW,
        },
    },
    core::PCWSTR,
};

#[derive(Serialize, Deserialize)]
struct Handoff {
    args: Vec<Vec<u16>>,
    cwd: Vec<u16>,
}

fn wide_nul(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn instance_pipe_name(data_dir: &Path) -> String {
    format!(r"\\.\pipe\puppyone-instance-{}", data_dir_token(data_dir))
}

fn cli_pipe_name(data_dir: &Path) -> String {
    format!(r"\\.\pipe\puppyone-cli-{}", data_dir_token(data_dir))
}

fn mutex_name(data_dir: &Path) -> String {
    format!(r"Local\PuppyOne-Instance-{}", data_dir_token(data_dir))
}

fn write_all_handle(handle: HANDLE, mut bytes: &[u8]) -> std::io::Result<()> {
    while !bytes.is_empty() {
        let mut written = 0u32;
        // SAFETY: `handle` is an open pipe handle and `bytes` is a valid slice.
        unsafe { WriteFile(handle, Some(bytes), Some(&mut written), None) }
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        if written == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "pipe write returned 0 bytes",
            ));
        }
        bytes = &bytes[written as usize..];
    }
    // SAFETY: `handle` is open.
    let _ = unsafe { FlushFileBuffers(handle) };
    Ok(())
}

fn read_line_handle(handle: HANDLE, max_bytes: usize) -> std::io::Result<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let mut read = 0u32;
        // SAFETY: `handle` is an open pipe handle and `chunk` is writable.
        if unsafe { ReadFile(handle, Some(&mut chunk), Some(&mut read), None) }.is_err() {
            break;
        }
        if read == 0 {
            break;
        }
        let slice = &chunk[..read as usize];
        if let Some(pos) = slice.iter().position(|&b| b == b'\n') {
            buf.extend_from_slice(&slice[..pos]);
            break;
        }
        buf.extend_from_slice(slice);
        if buf.len() > max_bytes {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "pipe line exceeded limit",
            ));
        }
    }
    String::from_utf8(buf).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

fn forward_to_primary(pipe_name: &str, args: &[OsString], cwd: &Path) -> bool {
    let wide = wide_nul(pipe_name);
    // SAFETY: `wide` is NUL-terminated UTF-16.
    let _ = unsafe { WaitNamedPipeW(PCWSTR(wide.as_ptr()), 1500) };
    // SAFETY: opening existing named pipe for read/write.
    let Ok(handle) = (unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            GENERIC_READ.0 | GENERIC_WRITE.0,
            FILE_SHARE_NONE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    }) else {
        return false;
    };
    if handle == INVALID_HANDLE_VALUE {
        return false;
    }
    let handoff = Handoff {
        args: args
            .iter()
            .map(|a| a.encode_wide().collect::<Vec<u16>>())
            .collect(),
        cwd: cwd.as_os_str().encode_wide().collect(),
    };
    let ok = serde_json::to_vec(&handoff)
        .ok()
        .map(|mut line| {
            line.push(b'\n');
            write_all_handle(handle, &line).is_ok()
                && read_line_handle(handle, 128)
                    .map(|ack| ack.trim() == "ok")
                    .unwrap_or(false)
        })
        .unwrap_or(false);
    // SAFETY: `handle` is owned by this function.
    let _ = unsafe { CloseHandle(handle) };
    ok
}

pub(super) fn acquire_single_instance(
    data_dir: &Path,
    args: &[OsString],
    cwd: &Path,
) -> Option<SingleInstance> {
    let pipe = instance_pipe_name(data_dir);
    let mname = wide_nul(&mutex_name(data_dir));
    // SAFETY: `mname` is NUL-terminated UTF-16.
    let mutex = unsafe { CreateMutexW(None, false, PCWSTR(mname.as_ptr())) }.ok()?;
    let already_exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    if already_exists {
        let forwarded = forward_to_primary(&pipe, args, cwd);
        let _ = unsafe { CloseHandle(mutex) };
        if forwarded {
            return Some(SingleInstance::Forwarded);
        }
        return None;
    }

    let (tx, rx) = async_channel::unbounded();
    let raw_mutex = mutex.0 as usize;
    let _ = std::thread::Builder::new()
        .name("single-instance-win".into())
        .spawn(move || {
            // Keep the named mutex alive for the lifetime of the primary listener.
            let _keep_mutex = raw_mutex;
            let wide_pipe = wide_nul(&pipe);
            loop {
                // SAFETY: creates a server-side byte-stream named pipe instance.
                let handle = unsafe {
                    CreateNamedPipeW(
                        PCWSTR(wide_pipe.as_ptr()),
                        PIPE_ACCESS_DUPLEX,
                        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                        PIPE_UNLIMITED_INSTANCES,
                        64 * 1024,
                        64 * 1024,
                        0,
                        None,
                    )
                };
                if handle == INVALID_HANDLE_VALUE {
                    break;
                }
                let connected = unsafe { ConnectNamedPipe(handle, None) }.is_ok()
                    || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
                if connected
                    && let Ok(line) = read_line_handle(handle, 256 * 1024)
                    && let Ok(handoff) = serde_json::from_str::<Handoff>(line.trim())
                {
                    let args = handoff
                        .args
                        .into_iter()
                        .map(|w| OsString::from_wide(&w))
                        .collect();
                    let cwd = PathBuf::from(OsString::from_wide(&handoff.cwd));
                    if tx.send_blocking((args, cwd)).is_err() {
                        let _ = unsafe { DisconnectNamedPipe(handle) };
                        let _ = unsafe { CloseHandle(handle) };
                        break;
                    }
                    let _ = write_all_handle(handle, b"ok\n");
                }
                let _ = unsafe { DisconnectNamedPipe(handle) };
                let _ = unsafe { CloseHandle(handle) };
            }
            let _ = unsafe { CloseHandle(HANDLE(raw_mutex as *mut _)) };
        });
    Some(SingleInstance::Primary(rx))
}

pub(super) fn serve_control(
    data_dir: &Path,
    info: AppInfo,
) -> std::io::Result<async_channel::Receiver<Incoming>> {
    let pipe = cli_pipe_name(data_dir);
    cli_control::set_serving(PathBuf::from(&pipe));
    let (tx, rx) = async_channel::unbounded();
    std::thread::Builder::new()
        .name("puppyone-cli-control-win".into())
        .spawn(move || {
            let wide_pipe = wide_nul(&pipe);
            loop {
                // SAFETY: creates a named pipe instance for CLI control JSON lines.
                let handle = unsafe {
                    CreateNamedPipeW(
                        PCWSTR(wide_pipe.as_ptr()),
                        PIPE_ACCESS_DUPLEX,
                        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                        PIPE_UNLIMITED_INSTANCES,
                        cli_control::REQUEST_BYTES as u32,
                        cli_control::REQUEST_BYTES as u32,
                        0,
                        None,
                    )
                };
                if handle == INVALID_HANDLE_VALUE {
                    break;
                }
                let connected = unsafe { ConnectNamedPipe(handle, None) }.is_ok()
                    || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
                if !connected {
                    let _ = unsafe { CloseHandle(handle) };
                    continue;
                }
                let raw_handle = handle.0 as usize;
                let (tx, info) = (tx.clone(), info.clone());
                let _ = std::thread::Builder::new()
                    .name("puppyone-cli-request-win".into())
                    .spawn(move || {
                        let handle = HANDLE(raw_handle as *mut _);
                        let response = match read_line_handle(handle, cli_control::REQUEST_BYTES) {
                            Ok(line) => {
                                let parsed = cli_control::parse(line.trim(), &info);
                                let (reply_tx, reply_rx) = async_channel::bounded(1);
                                if tx
                                    .send_blocking(Incoming {
                                        request: parsed,
                                        reply: reply_tx,
                                    })
                                    .is_ok()
                                {
                                    reply_rx.recv_blocking().unwrap_or_else(|_| {
                                        cli_control::failure(
                                            "OPEN_FAILED",
                                            "The app closed before answering.",
                                        )
                                    })
                                } else {
                                    cli_control::failure("OPEN_FAILED", "The app is closing.")
                                }
                            }
                            Err(_) => cli_control::failure(
                                "BAD_REQUEST",
                                "The request could not be read.",
                            ),
                        };
                        if let Ok(mut encoded) = serde_json::to_vec(&response) {
                            encoded.push(b'\n');
                            let _ = write_all_handle(handle, &encoded);
                        }
                        let _ = unsafe { DisconnectNamedPipe(handle) };
                        let _ = unsafe { CloseHandle(handle) };
                    });
            }
        })?;
    Ok(rx)
}

fn set_reg_sz(subkey: &str, name: Option<&str>, value: &str) -> Result<(), String> {
    let subkey_w = wide_nul(subkey);
    let mut hkey = HKEY::default();
    // SAFETY: writes under HKCU (current user, no elevation required).
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_w.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut hkey,
            None,
        )
    };
    if status.0 != 0 {
        return Err(format!("RegCreateKeyExW({subkey}) failed: {}", status.0));
    }
    let val_w = wide_nul(value);
    let bytes: &[u8] =
        unsafe { std::slice::from_raw_parts(val_w.as_ptr().cast::<u8>(), val_w.len() * 2) };
    let name_w = name.map(wide_nul);
    let name_ptr = name_w
        .as_ref()
        .map_or(PCWSTR::null(), |w| PCWSTR(w.as_ptr()));
    let write_status = unsafe { RegSetValueExW(hkey, name_ptr, None, REG_SZ, Some(bytes)) };
    let _ = unsafe { RegCloseKey(hkey) };
    if write_status.0 != 0 {
        return Err(format!(
            "RegSetValueExW({subkey}) failed: {}",
            write_status.0
        ));
    }
    Ok(())
}

/// Registers `HKCU\Software\Classes\<scheme>` for packaged builds so `puppyone://`
/// links open this executable without admin privileges.
pub(super) fn register_scheme(scheme: &str) -> Result<(), String> {
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return Err(format!("Invalid URL scheme: {scheme}"));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Skip dev builds running directly out of Cargo's target directory.
    if exe.components().any(|c| c.as_os_str() == "target") {
        return Ok(());
    }
    let exe_str = exe.to_string_lossy();
    let root = format!(r"Software\Classes\{scheme}");
    set_reg_sz(&root, None, &format!("URL:{scheme} Protocol"))?;
    set_reg_sz(&root, Some("URL Protocol"), "")?;
    set_reg_sz(
        &format!(r"{root}\shell\open\command"),
        None,
        &format!("\"{exe_str}\" \"%1\""),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::cli_control::{self, AppInfo, Incoming, Request};

    #[test]
    fn cli_control_named_pipe_answers_hello() {
        let dir = tempfile::tempdir().unwrap();
        let info = AppInfo {
            name: "PuppyOne".into(),
            version: "0.4.90".into(),
            channel: "stable".into(),
        };
        let incoming = serve_control(dir.path(), info.clone()).unwrap();
        let responder_info = info.clone();
        std::thread::spawn(move || {
            if let Ok(Incoming { request, reply }) = incoming.recv_blocking() {
                let answer = match request {
                    Ok(Request::Hello) => {
                        cli_control::hello(&responder_info, &[".md".into()], 1024)
                    }
                    Ok(Request::Open { .. }) => cli_control::opened(&responder_info, vec![]),
                    Err(err) => err,
                };
                let _ = reply.send_blocking(answer);
            }
        });

        let pipe = cli_pipe_name(dir.path());
        let wide = wide_nul(&pipe);
        let mut handle = INVALID_HANDLE_VALUE;
        for _ in 0..50 {
            let _ = unsafe { WaitNamedPipeW(PCWSTR(wide.as_ptr()), 200) };
            if let Ok(opened) = unsafe {
                CreateFileW(
                    PCWSTR(wide.as_ptr()),
                    GENERIC_READ.0 | GENERIC_WRITE.0,
                    FILE_SHARE_NONE,
                    None,
                    OPEN_EXISTING,
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    None,
                )
            } && opened != INVALID_HANDLE_VALUE
            {
                handle = opened;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_ne!(handle, INVALID_HANDLE_VALUE, "failed to connect to {pipe}");
        write_all_handle(handle, b"{\"protocol\":1,\"type\":\"hello\"}\n").unwrap();
        let reply_line = read_line_handle(handle, 16 * 1024).unwrap();
        let _ = unsafe { CloseHandle(handle) };
        let reply: serde_json::Value = serde_json::from_str(reply_line.trim()).unwrap();
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["protocol"], 1);
        assert_eq!(reply["app"]["version"], "0.4.90");
    }
}

//! Windows system file clipboard (`CF_HDROP`) and drag-out hooks.
use std::{os::windows::ffi::OsStrExt, path::PathBuf};
use windows::{
    Win32::{
        Foundation::{GlobalFree, HANDLE, POINT},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalUnlock},
        },
        UI::Shell::DROPFILES,
    },
    core::BOOL,
};

const CF_HDROP_FORMAT: u32 = 15;

/// Encodes `paths` into a `DROPFILES` + UTF-16 double-NUL buffer and places it on
/// the Windows clipboard under `CF_HDROP` so Explorer can paste the files directly.
#[cfg_attr(any(test, feature = "test-support"), allow(dead_code))]
pub(super) fn write_files(paths: &[PathBuf]) -> bool {
    let mut wide_paths: Vec<u16> = Vec::new();
    for path in paths {
        wide_paths.extend(path.as_os_str().encode_wide());
        wide_paths.push(0);
    }
    wide_paths.push(0); // final double-NUL terminator

    let header_size = std::mem::size_of::<DROPFILES>();
    let data_bytes = wide_paths.len() * std::mem::size_of::<u16>();
    let total_bytes = header_size + data_bytes;

    // SAFETY: Win32 clipboard ownership transfers the HGLOBAL to the OS on successful
    // `SetClipboardData`; on failure we explicitly free the allocation.
    unsafe {
        let Ok(hmem) = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_bytes) else {
            return false;
        };
        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            let _ = GlobalFree(Some(hmem));
            return false;
        }
        let header = DROPFILES {
            pFiles: header_size as u32,
            pt: POINT { x: 0, y: 0 },
            fNC: BOOL(0),
            fWide: BOOL(1),
        };
        std::ptr::write_unaligned(ptr.cast::<DROPFILES>(), header);
        std::ptr::copy_nonoverlapping(
            wide_paths.as_ptr().cast::<u8>(),
            ptr.cast::<u8>().add(header_size),
            data_bytes,
        );
        let _ = GlobalUnlock(hmem);

        if OpenClipboard(None).is_err() {
            let _ = GlobalFree(Some(hmem));
            return false;
        }
        let ok = EmptyClipboard().is_ok()
            && SetClipboardData(CF_HDROP_FORMAT, Some(HANDLE(hmem.0))).is_ok();
        let _ = CloseClipboard();
        if !ok {
            let _ = GlobalFree(Some(hmem));
        }
        ok
    }
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

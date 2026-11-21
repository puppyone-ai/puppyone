use raw_window_handle::HasWindowHandle;
use windows::Win32::{
    Foundation::BOOL,
    UI::{
        Input::Ime::{
            CPS_CANCEL, ImmGetContext, ImmNotifyIME, ImmReleaseContext, NI_COMPOSITIONSTR,
        },
        WindowsAndMessaging::{
            GetForegroundWindow, SPI_GETCLIENTAREAANIMATION, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
            SystemParametersInfoW,
        },
    },
};

pub(super) fn set_content_min_size(_window: &impl HasWindowHandle, _width: f32, _height: f32) {
    // GPUI applies `WindowOptions::window_min_size` on Win32 creation via
    // `WM_GETMINMAXINFO`; dynamic post-creation updates stay bounded by that floor.
}

#[cfg_attr(test, allow(dead_code))]
pub(super) fn discard_marked_text() {
    // SAFETY: standard Win32 IMM32 cancellation on the foreground HWND.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return;
        }
        let himc = ImmGetContext(hwnd);
        if !himc.0.is_null() {
            let _ = ImmNotifyIME(himc, NI_COMPOSITIONSTR, CPS_CANCEL, 0);
            let _ = ImmReleaseContext(hwnd, himc);
        }
    }
}

pub(super) fn reduce_motion() -> bool {
    let mut animations_enabled = BOOL(1);
    // SAFETY: `animations_enabled` is a valid out-pointer for `SPI_GETCLIENTAREAANIMATION`.
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some((&mut animations_enabled as *mut BOOL).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    ok.is_ok() && !animations_enabled.as_bool()
}

pub(super) fn match_product_font_smoothing() {}

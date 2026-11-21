use raw_window_handle::HasWindowHandle;
use windows::{
    Win32::UI::{
        Input::Ime::{
            CPS_CANCEL, ImmGetContext, ImmNotifyIME, ImmReleaseContext, NI_COMPOSITIONSTR,
        },
        WindowsAndMessaging::{
            GetForegroundWindow, SPI_GETCLIENTAREAANIMATION, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
            SystemParametersInfoW,
        },
    },
    core::BOOL,
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

#[cfg(feature = "dev-capture")]
pub mod probe_window {
    //! Offscreen Win32 parent HWND + Win32 message pump for isolated WebView2
    //! integration probes (`dev-capture` only, never part of the packaged app).
    use raw_window_handle::{
        HandleError, HasWindowHandle, RawWindowHandle, Win32WindowHandle, WindowHandle,
    };
    use std::num::NonZeroIsize;
    use windows::{
        Win32::{
            Foundation::HWND,
            System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx},
            UI::WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, DispatchMessageW, MSG, PM_REMOVE, PeekMessageW,
                SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER, SetWindowPos,
                ShowWindow, TranslateMessage, WINDOW_EX_STYLE, WS_CLIPCHILDREN, WS_POPUP,
            },
        },
        core::w,
    };

    /// An offscreen Win32 window hosting one WebView2 child for native probes.
    pub struct NativeWindow {
        hwnd: HWND,
    }

    impl Default for NativeWindow {
        fn default() -> Self {
            Self::new()
        }
    }

    impl NativeWindow {
        pub fn new() -> Self {
            // SAFETY: initializes COM STA on the probe's UI thread and creates
            // an offscreen top-level Win32 host window using the built-in STATIC class.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                let hwnd = CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("STATIC"),
                    w!("PuppyOneWebView2Probe"),
                    WS_POPUP | WS_CLIPCHILDREN,
                    -10_000,
                    -10_000,
                    1100,
                    800,
                    None,
                    None,
                    None,
                    None,
                )
                .expect("create offscreen Win32 probe window");
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                Self { hwnd }
            }
        }

        pub fn resize(&self, width: i32, height: i32) {
            // SAFETY: `self.hwnd` is a live window owned by this thread.
            unsafe {
                let _ = SetWindowPos(
                    self.hwnd,
                    None,
                    0,
                    0,
                    width,
                    height,
                    SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }

        /// Pumps pending Win32 messages on the current UI thread so WebView2
        /// callbacks and `ExecuteScript` completions advance.
        pub fn tick() {
            let mut msg = MSG::default();
            let mut processed = false;
            // SAFETY: standard Win32 non-blocking message loop on the UI thread.
            unsafe {
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    processed = true;
                    let _ = TranslateMessage(&msg);
                    let _ = DispatchMessageW(&msg);
                }
            }
            if !processed {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    }

    impl HasWindowHandle for NativeWindow {
        fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
            let raw = NonZeroIsize::new(self.hwnd.0 as isize).ok_or(HandleError::Unavailable)?;
            // SAFETY: the handle stays valid until `Drop` destroys `self.hwnd`.
            Ok(unsafe {
                WindowHandle::borrow_raw(RawWindowHandle::Win32(Win32WindowHandle::new(raw)))
            })
        }
    }

    impl Drop for NativeWindow {
        fn drop(&mut self) {
            // SAFETY: destroys the offscreen probe HWND after its child WebView drops.
            unsafe {
                let _ = DestroyWindow(self.hwnd);
            }
        }
    }
}

use raw_window_handle::{HasWindowHandle, RawWindowHandle};

pub(super) fn set_content_min_size(window: &impl HasWindowHandle, width: f32, height: f32) {
    use objc2_foundation::NSSize;
    let Ok(handle) = window.window_handle() else {
        return;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return;
    };
    // SAFETY: GPUI owns this live NSView; only accessed on AppKit's main thread.
    let view = unsafe { &*handle.ns_view.as_ptr().cast::<objc2_app_kit::NSView>() };
    if let Some(window) = view.window() {
        window.setContentMinSize(NSSize::new(f64::from(width), f64::from(height)));
    }
}

#[cfg_attr(test, allow(dead_code))]
pub(super) fn discard_marked_text() {
    // SAFETY: main thread (GPUI foreground executor); `currentInputContext`
    // returns an autoreleased context or nil, and `discardMarkedText` takes
    // no arguments and returns nothing.
    unsafe {
        use objc2::{class, msg_send, runtime::AnyObject};
        let context: *mut AnyObject = msg_send![class!(NSTextInputContext), currentInputContext];
        if let Some(context) = context.as_ref() {
            let _: () = msg_send![context, discardMarkedText];
        }
    }
}

pub(super) fn reduce_motion() -> bool {
    use objc2::{class, msg_send, runtime::AnyObject};
    // SAFETY: NSWorkspace's shared singleton and read-only BOOL property;
    // called on GPUI's main thread, retained by AppKit for the process.
    unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        msg_send![workspace, accessibilityDisplayShouldReduceMotion]
    }
}

pub(super) fn match_product_font_smoothing() {
    use std::ffi::c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFPreferencesCurrentApplication: *const c_void;
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            s: *const std::ffi::c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFNumberCreate(
            alloc: *const c_void,
            number_type: isize,
            value: *const c_void,
        ) -> *const c_void;
        fn CFPreferencesSetAppValue(
            key: *const c_void,
            value: *const c_void,
            application: *const c_void,
        );
        fn CFRelease(value: *const c_void);
    }
    const UTF8: u32 = 0x0800_0100;
    const SINT32: isize = 3;
    // SAFETY: plain CoreFoundation calls on objects created and released here.
    unsafe {
        let key = CFStringCreateWithCString(std::ptr::null(), c"AppleFontSmoothing".as_ptr(), UTF8);
        let zero: i32 = 0;
        let value = CFNumberCreate(std::ptr::null(), SINT32, (&zero as *const i32).cast());
        if !key.is_null() && !value.is_null() {
            CFPreferencesSetAppValue(key, value, kCFPreferencesCurrentApplication);
        }
        if !value.is_null() {
            CFRelease(value);
        }
        if !key.is_null() {
            CFRelease(key);
        }
    }
}

//! Text rasterization that matches the product. The product renders every
//! surface with `-webkit-font-smoothing: antialiased` (styles/base.css,
//! markdown-editor.css): greyscale anti-aliasing without CoreGraphics' font
//! smoothing, which thickens light-on-dark strokes. GPUI applies that
//! thickening unless the application's `AppleFontSmoothing` preference is 0,
//! so set it for this process (in memory, this application's domain only)
//! before the first glyph is drawn.

#[cfg(target_os = "macos")]
pub fn match_product_font_smoothing() {
    use std::ffi::c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFPreferencesCurrentApplication: *const c_void;
        fn CFStringCreateWithCString(alloc: *const c_void, s: *const std::ffi::c_char, encoding: u32) -> *const c_void;
        fn CFNumberCreate(alloc: *const c_void, number_type: isize, value: *const c_void) -> *const c_void;
        fn CFPreferencesSetAppValue(key: *const c_void, value: *const c_void, application: *const c_void);
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

#[cfg(not(target_os = "macos"))]
pub fn match_product_font_smoothing() {}

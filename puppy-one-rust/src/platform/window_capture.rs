//! A small bitmap of part of one of this app's own windows
//! (`pane-preview:capture`): the window server's composited pixels, native
//! web views included, scaled down for a drag preview. macOS only; other
//! systems have none and their previews stay a plain shell.

/// The window server's id of the window `window` belongs to.
pub fn window_id(window: &impl raw_window_handle::HasWindowHandle) -> Option<u32> {
    imp::window_id(window)
}

/// `rect` (`x`, `y`, `width`, `height` in points of the window's content,
/// whose size is `content`) of window `id`, scaled to `target` pixels, as
/// PNG. `None` when the window cannot be captured.
pub fn capture(
    id: u32,
    content: (f64, f64),
    rect: (f64, f64, f64, f64),
    target: (u32, u32),
) -> Option<Vec<u8>> {
    imp::capture(id, content, rect, target)
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;

    type CGImageRef = *const c_void;
    type CGColorSpaceRef = *const c_void;
    type CGContextRef = *const c_void;

    /// `CGRect`, flattened as the other CoreGraphics bindings declare it.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CgRect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    const LIST_INCLUDING_WINDOW: u32 = 1 << 3;
    const IMAGE_BOUNDS_IGNORE_FRAMING: u32 = 1 << 0;
    const ALPHA_PREMULTIPLIED_LAST: u32 = 1;
    const BYTE_ORDER_32_BIG: u32 = 4 << 12;
    const INTERPOLATION_HIGH: i32 = 3;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCreateImage(
            bounds: CgRect,
            list: u32,
            window: u32,
            image: u32,
        ) -> CGImageRef;
        fn CGImageCreateWithImageInRect(image: CGImageRef, rect: CgRect) -> CGImageRef;
        fn CGImageGetWidth(image: CGImageRef) -> usize;
        fn CGColorSpaceCreateDeviceRGB() -> CGColorSpaceRef;
        fn CGBitmapContextCreate(
            data: *mut c_void,
            width: usize,
            height: usize,
            bits_per_component: usize,
            bytes_per_row: usize,
            space: CGColorSpaceRef,
            bitmap_info: u32,
        ) -> CGContextRef;
        fn CGContextSetInterpolationQuality(c: CGContextRef, quality: i32);
        fn CGContextDrawImage(c: CGContextRef, rect: CgRect, image: CGImageRef);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: *const c_void);
    }

    pub(super) fn window_id(window: &impl raw_window_handle::HasWindowHandle) -> Option<u32> {
        use raw_window_handle::RawWindowHandle;
        let RawWindowHandle::AppKit(handle) = window.window_handle().ok()?.as_raw() else {
            return None;
        };
        // SAFETY: GPUI owns this live NSView; read on AppKit's main thread.
        let view = unsafe { &*handle.ns_view.as_ptr().cast::<objc2_app_kit::NSView>() };
        u32::try_from(view.window()?.windowNumber()).ok()
    }

    pub(super) fn capture(
        id: u32,
        content: (f64, f64),
        rect: (f64, f64, f64, f64),
        target: (u32, u32),
    ) -> Option<Vec<u8>> {
        let (tw, th) = (target.0 as usize, target.1 as usize);
        if tw == 0 || th == 0 || content.0 <= 0. || content.1 <= 0. {
            return None;
        }
        let rect_of = |x, y, width, height| CgRect {
            x,
            y,
            width,
            height,
        };
        let mut pixels = vec![0u8; tw * th * 4];
        // SAFETY: every CoreGraphics object created here is released before
        // returning, and the bitmap context draws into `pixels`, which
        // outlives it.
        unsafe {
            let null = rect_of(f64::INFINITY, f64::INFINITY, 0., 0.);
            let window = CGWindowListCreateImage(
                null,
                LIST_INCLUDING_WINDOW,
                id,
                IMAGE_BOUNDS_IGNORE_FRAMING,
            );
            if window.is_null() {
                return None;
            }
            let scale = CGImageGetWidth(window) as f64 / content.0;
            let crop = rect_of(
                rect.0 * scale,
                rect.1 * scale,
                rect.2 * scale,
                rect.3 * scale,
            );
            let part = CGImageCreateWithImageInRect(window, crop);
            CFRelease(window);
            if part.is_null() {
                return None;
            }
            let space = CGColorSpaceCreateDeviceRGB();
            let context = CGBitmapContextCreate(
                pixels.as_mut_ptr().cast(),
                tw,
                th,
                8,
                tw * 4,
                space,
                ALPHA_PREMULTIPLIED_LAST | BYTE_ORDER_32_BIG,
            );
            CFRelease(space);
            if context.is_null() {
                CFRelease(part);
                return None;
            }
            CGContextSetInterpolationQuality(context, INTERPOLATION_HIGH);
            CGContextDrawImage(context, rect_of(0., 0., tw as f64, th as f64), part);
            CFRelease(context);
            CFRelease(part);
        }
        let image = image::RgbaImage::from_raw(target.0, target.1, pixels)?;
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).ok()?;
        Some(png.into_inner())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub(super) fn window_id(_: &impl raw_window_handle::HasWindowHandle) -> Option<u32> {
        None
    }

    pub(super) fn capture(
        _: u32,
        _: (f64, f64),
        _: (f64, f64, f64, f64),
        _: (u32, u32),
    ) -> Option<Vec<u8>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `pane-preview-ipc` #1: a window that is gone, an empty target or a
    /// window without content gives no bitmap.
    #[test]
    fn unavailable_windows_give_no_bitmap() {
        assert_eq!(
            capture(u32::MAX, (400., 240.), (0., 0., 20., 20.), (8, 8)),
            None
        );
        assert_eq!(capture(1, (400., 240.), (0., 0., 20., 20.), (0, 8)), None);
        assert_eq!(capture(1, (0., 0.), (0., 0., 20., 20.), (8, 8)), None);
    }
}

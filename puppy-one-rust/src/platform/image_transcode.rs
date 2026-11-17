//! Platform image decoding (`ImageIO` in-process display-size thumbnails, EXIF
//! orientation, sRGB colour conversion, bounded animation frames) and Quick Look
//! / system thumbnail previews (`VW-01`–`VW-03`, `VW-30`).
//!
//! Supported formats (including AVIF, HEIC, PNG, JPEG, WebP, GIF, TIFF, BMP)
//! decode in-process through macOS `ImageIO` without spawning `/usr/bin/sips`
//! or writing temporary files; `image` crate and `/usr/bin/sips` remain last-resort
//! fallbacks when `ImageIO` cannot read an input.
use std::{
    io::Read,
    path::Path,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    sync::mpsc,
    time::{Duration, Instant},
};

/// Maximum resident BGRA byte budget for a decoded image (including animated frames).
pub const MAX_DECODE_BYTES: usize = 64 * 1024 * 1024;
/// Maximum number of frames decoded for animated images (`VW-02`).
pub const MAX_ANIMATION_FRAMES: usize = 120;
/// Default display decode dimension when the viewport has not been measured yet.
pub const DEFAULT_DISPLAY_MAX_PX: u32 = 2048;
/// Strict upper bound on Quick Look / system thumbnail generation (`VW-30`).
pub const QUICK_LOOK_TIMEOUT: Duration = Duration::from_millis(350);
const HARD_MAX_THUMB_TIMEOUT: Duration = Duration::from_millis(400);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// Input exceeds the viewer's `maxSourceBytes` admission budget (`VW-01`).
    BudgetExceeded { size: u64, limit: u64 },
    /// Input could not be read or decoded.
    Failed(String),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BudgetExceeded { size, limit } => {
                write!(f, "image size ({size} B) exceeds budget ({limit} B)")
            }
            Self::Failed(reason) => f.write_str(reason),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ImageInput<'a> {
    File(&'a Path),
    Bytes {
        mime: Option<&'a str>,
        bytes: &'a [u8],
    },
}

/// One decoded frame in premultiplied BGRA byte order (native GPUI pixel format).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedFrame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    pub delay_ms: u32,
}

impl DecodedFrame {
    pub fn byte_len(&self) -> usize {
        self.bgra.len()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedImage {
    pub natural_width: u32,
    pub natural_height: u32,
    pub decoded_max_px: u32,
    pub frames: Vec<DecodedFrame>,
}

impl DecodedImage {
    pub fn total_bytes(&self) -> usize {
        self.frames.iter().map(DecodedFrame::byte_len).sum()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThumbnailKind {
    QuickLook,
    SystemIcon,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileThumbnail {
    pub frame: DecodedFrame,
    pub kind: ThumbnailKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FilePreviewInfo {
    pub byte_size: Option<u64>,
    pub thumbnail: Option<FileThumbnail>,
}

/// Whether GPUI's built-in byte decoder lacks support for `name` (e.g. AVIF).
pub fn needs_transcode(name: &str) -> bool {
    name.rsplit('.')
        .next()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("avif"))
}

/// Pre-checks the byte size of `input` against `max_source_bytes` (`VW-01`).
pub fn precheck_size(input: ImageInput<'_>, max_source_bytes: u64) -> Result<u64, DecodeError> {
    let size = match input {
        ImageInput::File(path) => std::fs::metadata(path)
            .map_err(|e| DecodeError::Failed(e.to_string()))?
            .len(),
        ImageInput::Bytes { bytes, .. } => bytes.len() as u64,
    };
    if size > max_source_bytes {
        return Err(DecodeError::BudgetExceeded {
            size,
            limit: max_source_bytes,
        });
    }
    Ok(size)
}

/// Computes the safe max pixel dimension for a single frame given natural
/// dimensions so one BGRA frame never exceeds `MAX_DECODE_BYTES` (`64 MiB`).
pub fn clamp_decode_max_px(target_max_px: u32, natural_w: u32, natural_h: u32) -> u32 {
    let requested = target_max_px.clamp(64, 8192);
    let max_pixels = (MAX_DECODE_BYTES / 4) as f64;
    let (nw, nh) = (natural_w.max(1) as f64, natural_h.max(1) as f64);
    let (long, short) = if nw >= nh { (nw, nh) } else { (nh, nw) };
    let mem_cap = ((max_pixels * (long / short)).sqrt().floor() as u32).clamp(64, 8192);
    let mut out = requested.min(mem_cap);
    let natural_long = natural_w.max(natural_h);
    if natural_long > 0 {
        out = out.min(natural_long);
    }
    out.max(1)
}

/// Decodes `input` at display resolution (`target_max_px`) after checking
/// `max_source_bytes`. Uses macOS `ImageIO` in-process first (`VW-01`, `VW-03`),
/// then falls back to `image` crate or `/usr/bin/sips`.
pub fn decode(
    input: ImageInput<'_>,
    max_source_bytes: u64,
    target_max_px: u32,
) -> Result<DecodedImage, DecodeError> {
    precheck_size(input, max_source_bytes)?;

    #[cfg(target_os = "macos")]
    if let Ok(decoded) = mac::decode_imageio(input, target_max_px) {
        return Ok(decoded);
    }

    if let Ok(decoded) = decode_with_image_crate(input, max_source_bytes, target_max_px) {
        return Ok(decoded);
    }

    if let ImageInput::File(path) = input
        && let Ok(png) = sips_to_png(path)
        && let Ok(decoded) = decode_with_image_crate(
            ImageInput::Bytes {
                mime: Some("image/png"),
                bytes: &png,
            },
            u64::MAX,
            target_max_px,
        )
    {
        return Ok(decoded);
    }

    Err(DecodeError::Failed("unsupported or corrupt image".into()))
}

/// PNG bytes of `path` (such as AVIF), decoded & encoded in-process via macOS
/// `ImageIO`, falling back to `image` crate or `/usr/bin/sips` only if needed.
pub fn to_png(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    precheck_size(ImageInput::File(path), max_bytes).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    if let Ok(png) = mac::transcode_to_png_in_process(path, 4096) {
        return Ok(png);
    }

    if let Ok(bytes) = read_regular(path, max_bytes)
        && let Ok(img) = decode_fallback_pixels(&bytes, MAX_DECODE_BYTES as u64)
    {
        let mut cursor = std::io::Cursor::new(Vec::new());
        if img.write_to(&mut cursor, image::ImageFormat::Png).is_ok() {
            return Ok(cursor.into_inner());
        }
    }

    if !cfg!(target_os = "macos") {
        return Err("AVIF decoding needs the platform image codec".into());
    }
    sips_to_png(path)
}

/// Bounded, timeout-protected Quick Look / system thumbnail preview (`VW-30`).
/// Never blocks longer than `<= 400ms`.
pub fn quick_look_preview(path: &Path, max_px: u32, timeout: Duration) -> FilePreviewInfo {
    let meta = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => {
            return FilePreviewInfo {
                byte_size: None,
                thumbnail: None,
            };
        }
    };
    let byte_size = Some(meta.len());
    let budget = timeout.min(HARD_MAX_THUMB_TIMEOUT);
    let max_px = max_px.clamp(64, 1024);

    #[cfg(target_os = "macos")]
    {
        let thumbnail = mac::quick_look_or_icon(path, max_px, budget);
        FilePreviewInfo {
            byte_size,
            thumbnail,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (max_px, budget);
        FilePreviewInfo {
            byte_size,
            thumbnail: None,
        }
    }
}

fn rgba_to_premultiplied_bgra(mut rgba: Vec<u8>) -> Vec<u8> {
    for px in rgba.chunks_exact_mut(4) {
        let (r, g, b, a) = (px[0], px[1], px[2], px[3]);
        if a == 255 {
            px[0] = b;
            px[1] = g;
            px[2] = r;
        } else if a == 0 {
            px[0] = 0;
            px[1] = 0;
            px[2] = 0;
        } else {
            let af = a as u16;
            px[0] = ((b as u16 * af + 127) / 255) as u8;
            px[1] = ((g as u16 * af + 127) / 255) as u8;
            px[2] = ((r as u16 * af + 127) / 255) as u8;
        }
    }
    rgba
}

fn decode_with_image_crate(
    input: ImageInput<'_>,
    max_source_bytes: u64,
    target_max_px: u32,
) -> Result<DecodedImage, DecodeError> {
    precheck_size(input, max_source_bytes)?;
    let owned;
    let bytes: &[u8] = match input {
        ImageInput::Bytes { bytes, .. } => bytes,
        ImageInput::File(path) => {
            owned = read_regular(path, max_source_bytes).map_err(DecodeError::Failed)?;
            &owned
        }
    };
    let dynamic = decode_fallback_pixels(bytes, MAX_DECODE_BYTES as u64)
        .map_err(|e| DecodeError::Failed(e.to_string()))?;
    let (nw, nh) = (dynamic.width().max(1), dynamic.height().max(1));
    let cap = clamp_decode_max_px(target_max_px, nw, nh);
    let resized = if nw.max(nh) > cap {
        dynamic.thumbnail(cap, cap)
    } else {
        dynamic
    };
    let rgba = resized.into_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let bgra = rgba_to_premultiplied_bgra(rgba.into_raw());
    Ok(DecodedImage {
        natural_width: nw,
        natural_height: nh,
        decoded_max_px: w.max(h),
        frames: vec![DecodedFrame {
            width: w,
            height: h,
            bgra,
            delay_ms: 100,
        }],
    })
}

/// Unlike ImageIO thumbnails, these codecs expand the original raster first.
/// Admit that raster before allocating it, including later RGBA expansion of
/// grayscale/RGB inputs and the original depth of 16-bit inputs. The codec's
/// allocation limit is best-effort: this is not a process RSS ceiling.
fn decode_fallback_pixels(
    bytes: &[u8],
    pixel_budget: u64,
) -> image::ImageResult<image::DynamicImage> {
    use image::ImageDecoder;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES as u64);
    reader.limits(limits.clone());
    let mut decoder = reader.into_decoder()?;
    let (width, height) = decoder.dimensions();
    let native_bytes = decoder.total_bytes();
    let rgba_bytes = u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(4);
    if native_bytes.max(rgba_bytes) > pixel_budget {
        return Err(image::ImageError::Limits(
            image::error::LimitError::from_kind(image::error::LimitErrorKind::InsufficientMemory),
        ));
    }
    // Include the destination raster in the codec's own allocation accounting.
    limits.reserve(native_bytes)?;
    decoder.set_limits(limits)?;
    image::DynamicImage::from_decoder(decoder)
}

#[cfg(test)]
#[path = "image_fallback_tests.rs"]
mod fallback_tests;

fn sips_to_png(path: &Path) -> Result<Vec<u8>, String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let out = dir.path().join("preview.png");
    let mut child = Command::new("/usr/bin/sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg("--resampleHeightWidthMax")
        .arg("4096")
        .arg(path)
        .arg("--out")
        .arg(&out)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err(format!("image decoder exited with {status}"));
            }
            break;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("image decoding timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    read_regular(&out, MAX_OUTPUT_BYTES as u64)
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use core_foundation_sys::{
        base::{CFGetTypeID, CFIndex, CFRelease, CFTypeRef, kCFAllocatorDefault},
        data::{CFDataCreate, CFDataRef},
        dictionary::{
            CFDictionaryCreate, CFDictionaryGetTypeID, CFDictionaryGetValue, CFDictionaryRef,
            kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks,
        },
        number::{
            CFNumberCreate, CFNumberGetTypeID, CFNumberGetValue, CFNumberRef, kCFBooleanTrue,
            kCFNumberFloat64Type, kCFNumberSInt32Type,
        },
        string::CFStringRef,
        url::{CFURLCreateFromFileSystemRepresentation, CFURLRef},
    };
    use std::{ffi::c_void, os::unix::ffi::OsStrExt, ptr};

    type CGImageSourceRef = *const c_void;
    type CGImageRef = *const c_void;
    type CGColorSpaceRef = *const c_void;
    type CGContextRef = *const c_void;

    /// `kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst` -> BGRA8888.
    const BITMAP_INFO_BGRA_PREMUL: u32 = (2 << 12) | 2;
    const INTERPOLATION_HIGH: i32 = 3;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CgSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CgRect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    #[link(name = "ImageIO", kind = "framework")]
    unsafe extern "C" {
        fn CGImageSourceCreateWithData(
            data: CFDataRef,
            options: CFDictionaryRef,
        ) -> CGImageSourceRef;
        fn CGImageSourceCreateWithURL(url: CFURLRef, options: CFDictionaryRef) -> CGImageSourceRef;
        fn CGImageSourceGetCount(isrc: CGImageSourceRef) -> usize;
        fn CGImageSourceCopyPropertiesAtIndex(
            isrc: CGImageSourceRef,
            index: usize,
            options: CFDictionaryRef,
        ) -> CFDictionaryRef;
        fn CGImageSourceCreateThumbnailAtIndex(
            isrc: CGImageSourceRef,
            index: usize,
            options: CFDictionaryRef,
        ) -> CGImageRef;

        static kCGImageSourceCreateThumbnailFromImageAlways: CFStringRef;
        static kCGImageSourceCreateThumbnailWithTransform: CFStringRef;
        static kCGImageSourceThumbnailMaxPixelSize: CFStringRef;
        static kCGImageSourceShouldCacheImmediately: CFStringRef;
        static kCGImagePropertyPixelWidth: CFStringRef;
        static kCGImagePropertyPixelHeight: CFStringRef;
        static kCGImagePropertyOrientation: CFStringRef;
        static kCGImagePropertyGIFDictionary: CFStringRef;
        static kCGImagePropertyGIFUnclampedDelayTime: CFStringRef;
        static kCGImagePropertyGIFDelayTime: CFStringRef;
        static kCGImagePropertyPNGDictionary: CFStringRef;
        static kCGImagePropertyAPNGUnclampedDelayTime: CFStringRef;
        static kCGImagePropertyAPNGDelayTime: CFStringRef;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGImageGetWidth(image: CGImageRef) -> usize;
        fn CGImageGetHeight(image: CGImageRef) -> usize;
        fn CGColorSpaceCreateWithName(name: CFStringRef) -> CGColorSpaceRef;
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

        static kCGColorSpaceSRGB: CFStringRef;
    }

    #[link(name = "QuickLook", kind = "framework")]
    unsafe extern "C" {
        fn QLThumbnailImageCreate(
            allocator: CFTypeRef,
            url: CFURLRef,
            max_thumbnail_size: CgSize,
            options: CFDictionaryRef,
        ) -> CGImageRef;
    }

    struct CfOwned(CFTypeRef);
    impl Drop for CfOwned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: owned +1 CoreFoundation / CoreGraphics object.
                unsafe { CFRelease(self.0) };
            }
        }
    }

    fn cf_url_from_path(path: &Path) -> Option<CfOwned> {
        let bytes = path.as_os_str().as_bytes();
        if bytes.is_empty() {
            return None;
        }
        // SAFETY: valid POSIX path byte slice.
        let url = unsafe {
            CFURLCreateFromFileSystemRepresentation(
                kCFAllocatorDefault,
                bytes.as_ptr(),
                bytes.len() as CFIndex,
                0,
            )
        };
        (!url.is_null()).then(|| CfOwned(url.cast()))
    }

    fn create_source(input: ImageInput<'_>) -> Option<CfOwned> {
        match input {
            ImageInput::File(path) => {
                let url = cf_url_from_path(path)?;
                // SAFETY: `url` is a valid CFURLRef.
                let src = unsafe { CGImageSourceCreateWithURL(url.0.cast(), ptr::null()) };
                (!src.is_null()).then(|| CfOwned(src.cast()))
            }
            ImageInput::Bytes { bytes, .. } => {
                if bytes.is_empty() {
                    return None;
                }
                // SAFETY: `bytes` is live for the duration of `CFDataCreate` (which copies it).
                let data = unsafe {
                    CFDataCreate(kCFAllocatorDefault, bytes.as_ptr(), bytes.len() as CFIndex)
                };
                if data.is_null() {
                    return None;
                }
                let data = CfOwned(data.cast());
                // SAFETY: `data` is a valid CFDataRef.
                let src = unsafe { CGImageSourceCreateWithData(data.0.cast(), ptr::null()) };
                (!src.is_null()).then(|| CfOwned(src.cast()))
            }
        }
    }

    unsafe fn dict_i32(dict: CFDictionaryRef, key: CFStringRef) -> Option<i32> {
        if dict.is_null() {
            return None;
        }
        // SAFETY: `dict` is a valid CFDictionaryRef.
        let val = unsafe { CFDictionaryGetValue(dict, key.cast()) };
        if val.is_null() || unsafe { CFGetTypeID(val) != CFNumberGetTypeID() } {
            return None;
        }
        let mut out: i32 = 0;
        // SAFETY: `val` is verified as CFNumber.
        let ok = unsafe {
            CFNumberGetValue(
                val as CFNumberRef,
                kCFNumberSInt32Type,
                (&mut out as *mut i32).cast(),
            )
        };
        ok.then_some(out)
    }

    unsafe fn dict_f64(dict: CFDictionaryRef, key: CFStringRef) -> Option<f64> {
        if dict.is_null() {
            return None;
        }
        // SAFETY: `dict` is a valid CFDictionaryRef.
        let val = unsafe { CFDictionaryGetValue(dict, key.cast()) };
        if val.is_null() || unsafe { CFGetTypeID(val) != CFNumberGetTypeID() } {
            return None;
        }
        let mut out: f64 = 0.0;
        // SAFETY: `val` is verified as CFNumber.
        let ok = unsafe {
            CFNumberGetValue(
                val as CFNumberRef,
                kCFNumberFloat64Type,
                (&mut out as *mut f64).cast(),
            )
        };
        ok.then_some(out)
    }

    fn oriented_dimensions_and_delay(src: CGImageSourceRef, index: usize) -> ((u32, u32), u32) {
        // SAFETY: `src` is a valid CGImageSourceRef.
        let props_raw = unsafe { CGImageSourceCopyPropertiesAtIndex(src, index, ptr::null()) };
        if props_raw.is_null() {
            return ((0, 0), 100);
        }
        let props = CfOwned(props_raw.cast());
        let dict: CFDictionaryRef = props.0.cast();
        // SAFETY: `dict` is a live CFDictionaryRef.
        unsafe {
            let w = dict_i32(dict, kCGImagePropertyPixelWidth)
                .unwrap_or(0)
                .max(0) as u32;
            let h = dict_i32(dict, kCGImagePropertyPixelHeight)
                .unwrap_or(0)
                .max(0) as u32;
            let orientation = dict_i32(dict, kCGImagePropertyOrientation).unwrap_or(1);
            let dims = if (5..=8).contains(&orientation) {
                (h, w)
            } else {
                (w, h)
            };

            let mut delay_sec = None;
            let gif_sub = CFDictionaryGetValue(dict, kCGImagePropertyGIFDictionary.cast());
            if !gif_sub.is_null() && CFGetTypeID(gif_sub) == CFDictionaryGetTypeID() {
                let sub: CFDictionaryRef = gif_sub.cast();
                delay_sec = dict_f64(sub, kCGImagePropertyGIFUnclampedDelayTime)
                    .filter(|&d| d > 0.0)
                    .or_else(|| dict_f64(sub, kCGImagePropertyGIFDelayTime).filter(|&d| d > 0.0));
            }
            if delay_sec.is_none() {
                let png_sub = CFDictionaryGetValue(dict, kCGImagePropertyPNGDictionary.cast());
                if !png_sub.is_null() && CFGetTypeID(png_sub) == CFDictionaryGetTypeID() {
                    let sub: CFDictionaryRef = png_sub.cast();
                    delay_sec = dict_f64(sub, kCGImagePropertyAPNGUnclampedDelayTime)
                        .filter(|&d| d > 0.0)
                        .or_else(|| {
                            dict_f64(sub, kCGImagePropertyAPNGDelayTime).filter(|&d| d > 0.0)
                        });
                }
            }
            let delay_ms = delay_sec
                .map(|s| (s * 1000.0).round() as u32)
                .map(|ms| if ms <= 10 { 100 } else { ms.min(10_000) })
                .unwrap_or(100);
            (dims, delay_ms)
        }
    }

    fn thumbnail_options(max_px: u32) -> Option<(CfOwned, CfOwned)> {
        let size = max_px.clamp(1, 8192) as i32;
        // SAFETY: stack i32 pointer valid for CFNumberCreate.
        let num = unsafe {
            CFNumberCreate(
                kCFAllocatorDefault,
                kCFNumberSInt32Type,
                (&size as *const i32).cast(),
            )
        };
        if num.is_null() {
            return None;
        }
        let num = CfOwned(num.cast());
        // SAFETY: ImageIO/CoreFoundation static keys and valid CF values.
        unsafe {
            let keys: [*const c_void; 4] = [
                kCGImageSourceCreateThumbnailFromImageAlways.cast(),
                kCGImageSourceCreateThumbnailWithTransform.cast(),
                kCGImageSourceShouldCacheImmediately.cast(),
                kCGImageSourceThumbnailMaxPixelSize.cast(),
            ];
            let values: [*const c_void; 4] = [
                kCFBooleanTrue.cast(),
                kCFBooleanTrue.cast(),
                kCFBooleanTrue.cast(),
                num.0,
            ];
            let dict = CFDictionaryCreate(
                kCFAllocatorDefault,
                keys.as_ptr(),
                values.as_ptr(),
                keys.len() as CFIndex,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            (!dict.is_null()).then(|| (num, CfOwned(dict.cast())))
        }
    }

    pub(super) fn rasterize_cgimage(image: CGImageRef, delay_ms: u32) -> Option<DecodedFrame> {
        if image.is_null() {
            return None;
        }
        // SAFETY: `image` is a valid CGImageRef.
        let width = unsafe { CGImageGetWidth(image) };
        let height = unsafe { CGImageGetHeight(image) };
        if width == 0 || height == 0 {
            return None;
        }
        let byte_len = width.checked_mul(height)?.checked_mul(4)?;
        if byte_len > MAX_DECODE_BYTES {
            return None;
        }
        let mut bgra = vec![0u8; byte_len];
        // SAFETY: CoreGraphics sRGB color space + BGRA premultiplied context over `bgra`.
        unsafe {
            let mut space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            if space.is_null() {
                space = CGColorSpaceCreateDeviceRGB();
            }
            if space.is_null() {
                return None;
            }
            let space = CfOwned(space.cast());
            let ctx = CGBitmapContextCreate(
                bgra.as_mut_ptr().cast(),
                width,
                height,
                8,
                width * 4,
                space.0.cast(),
                BITMAP_INFO_BGRA_PREMUL,
            );
            if ctx.is_null() {
                return None;
            }
            let ctx = CfOwned(ctx.cast());
            CGContextSetInterpolationQuality(ctx.0.cast(), INTERPOLATION_HIGH);
            CGContextDrawImage(
                ctx.0.cast(),
                CgRect {
                    x: 0.0,
                    y: 0.0,
                    width: width as f64,
                    height: height as f64,
                },
                image,
            );
        }
        Some(DecodedFrame {
            width: width as u32,
            height: height as u32,
            bgra,
            delay_ms,
        })
    }

    pub(super) fn decode_imageio(
        input: ImageInput<'_>,
        target_max_px: u32,
    ) -> Result<DecodedImage, String> {
        let src = create_source(input).ok_or_else(|| "ImageIO rejected input".to_owned())?;
        // SAFETY: `src` is a valid CGImageSourceRef.
        let count = unsafe { CGImageSourceGetCount(src.0.cast()) };
        if count == 0 {
            return Err("image has no frames".into());
        }
        let ((mut nat_w, mut nat_h), first_delay) = oriented_dimensions_and_delay(src.0.cast(), 0);
        let max_px = clamp_decode_max_px(target_max_px, nat_w, nat_h);
        let (_num_guard, opts) = thumbnail_options(max_px)
            .ok_or_else(|| "failed to build ImageIO options".to_owned())?;

        // Decode frame 0 first.
        // SAFETY: `src` and `opts` are valid CoreFoundation objects.
        let first_cg =
            unsafe { CGImageSourceCreateThumbnailAtIndex(src.0.cast(), 0, opts.0.cast()) };
        if first_cg.is_null() {
            return Err("ImageIO failed to decode thumbnail".into());
        }
        let first_cg = CfOwned(first_cg.cast());
        let first_frame = rasterize_cgimage(first_cg.0.cast(), first_delay)
            .ok_or_else(|| "failed to rasterize CGImage".to_owned())?;
        if nat_w == 0 || nat_h == 0 {
            nat_w = first_frame.width;
            nat_h = first_frame.height;
        }
        let decoded_max_px = first_frame.width.max(first_frame.height);
        let mut total_bytes = first_frame.byte_len();
        let mut frames = vec![first_frame];

        let max_frames = count.min(MAX_ANIMATION_FRAMES);
        for idx in 1..max_frames {
            let (_, delay) = oriented_dimensions_and_delay(src.0.cast(), idx);
            // SAFETY: `src` and `opts` are valid CoreFoundation objects.
            let cg =
                unsafe { CGImageSourceCreateThumbnailAtIndex(src.0.cast(), idx, opts.0.cast()) };
            if cg.is_null() {
                break;
            }
            let cg = CfOwned(cg.cast());
            let Some(frame) = rasterize_cgimage(cg.0.cast(), delay) else {
                break;
            };
            if total_bytes.saturating_add(frame.byte_len()) > MAX_DECODE_BYTES {
                break;
            }
            total_bytes += frame.byte_len();
            frames.push(frame);
        }

        Ok(DecodedImage {
            natural_width: nat_w,
            natural_height: nat_h,
            decoded_max_px,
            frames,
        })
    }

    pub(super) fn transcode_to_png_in_process(path: &Path, max_px: u32) -> Result<Vec<u8>, String> {
        let decoded = decode_imageio(ImageInput::File(path), max_px)?;
        let frame = decoded
            .frames
            .into_iter()
            .next()
            .ok_or_else(|| "no frame decoded".to_owned())?;
        let mut rgba = frame.bgra;
        for px in rgba.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        let img = image::RgbaImage::from_raw(frame.width, frame.height, rgba)
            .ok_or_else(|| "invalid frame dimensions".to_owned())?;
        let mut cursor = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(cursor.into_inner())
    }

    pub(super) fn quick_look_or_icon(
        path: &Path,
        max_px: u32,
        timeout: Duration,
    ) -> Option<FileThumbnail> {
        let started = Instant::now();

        // 1. In-process ImageIO check first: fast (< 5 ms), works inside strict sandboxes
        //    for PSD, ICNS, HEIC, TIFF, EXR, RAW, PDF thumbnails, etc.
        if let Ok(decoded) = decode_imageio(ImageInput::File(path), max_px)
            && let Some(frame) = decoded.frames.into_iter().next()
        {
            return Some(FileThumbnail {
                frame,
                kind: ThumbnailKind::QuickLook,
            });
        }

        // 2. QuickLookThumbnailing (`QLThumbnailGenerator`) with strict timeout.
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining >= Duration::from_millis(20)
            && let Some(frame) = ql_thumbnail_with_timeout(path, max_px, remaining)
        {
            return Some(FileThumbnail {
                frame,
                kind: ThumbnailKind::QuickLook,
            });
        }

        // 3. System file icon fallback (`NSWorkspace::iconForFile:`) within remaining budget.
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining >= Duration::from_millis(15)
            && let Some(frame) = workspace_icon_with_timeout(path, remaining)
        {
            return Some(FileThumbnail {
                frame,
                kind: ThumbnailKind::SystemIcon,
            });
        }

        None
    }

    fn ql_thumbnail_with_timeout(
        path: &Path,
        max_px: u32,
        timeout: Duration,
    ) -> Option<DecodedFrame> {
        let path_buf = path.to_path_buf();
        let (tx, rx) = mpsc::sync_channel::<Option<DecodedFrame>>(1);
        std::thread::spawn(move || {
            let frame = cf_url_from_path(&path_buf).and_then(|url| {
                // SAFETY: `url` is a valid CFURLRef; `QLThumbnailImageCreate` returns +1 CGImageRef or null.
                let cg = unsafe {
                    QLThumbnailImageCreate(
                        kCFAllocatorDefault,
                        url.0.cast(),
                        CgSize {
                            width: max_px as f64,
                            height: max_px as f64,
                        },
                        ptr::null(),
                    )
                };
                if cg.is_null() {
                    return None;
                }
                let guard = CfOwned(cg.cast());
                rasterize_cgimage(guard.0.cast(), 100)
            });
            let _ = tx.send(frame);
        });
        rx.recv_timeout(timeout).ok().flatten()
    }

    fn workspace_icon_with_timeout(path: &Path, timeout: Duration) -> Option<DecodedFrame> {
        let path_buf = path.to_path_buf();
        let (tx, rx) = mpsc::sync_channel::<Option<DecodedFrame>>(1);
        std::thread::spawn(move || {
            let res = render_workspace_icon(&path_buf, 128);
            let _ = tx.send(res);
        });
        rx.recv_timeout(timeout).ok().flatten()
    }

    fn render_workspace_icon(path: &Path, px_size: u32) -> Option<DecodedFrame> {
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_app_kit::NSWorkspace;
        use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

        let path_str = path.to_str()?;
        let ns_path = NSString::from_str(path_str);
        let workspace = NSWorkspace::sharedWorkspace();
        let icon = workspace.iconForFile(&ns_path);
        let mut proposed = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(px_size as f64, px_size as f64),
        );
        // SAFETY: `icon` is a live retained `NSImage`; `CGImageForProposedRect:context:hints:`
        // returns an autoreleased/unowned `CGImageRef` valid while `icon` is alive.
        unsafe {
            let icon_ptr: *const AnyObject = objc2::rc::Retained::as_ptr(&icon).cast();
            let cg: CGImageRef = msg_send![
                icon_ptr,
                CGImageForProposedRect: &mut proposed,
                context: ptr::null::<AnyObject>(),
                hints: ptr::null::<AnyObject>()
            ];
            rasterize_cgimage(cg, 100)
        }
    }
}

#[cfg(test)]
mod decoding_tests {
    use super::*;

    #[test]
    fn avif_is_transcoded_to_png_through_imageio() {
        assert!(needs_transcode("photo.AVIF"));
        assert!(!needs_transcode("photo.png"));
        let fixture = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("fixtures/media/red.avif");
        let png = to_png(&fixture, 1 << 20).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(to_png(&fixture, 10).is_err());
    }

    #[test]
    fn display_size_decode_scales_down_and_enforces_source_and_memory_budgets() {
        // Generate a synthetic 1200x800 PNG in memory and decode at target_max_px = 300.
        let mut img = image::RgbaImage::new(1200, 800);
        for p in img.pixels_mut() {
            *p = image::Rgba([220, 40, 20, 255]);
        }
        let mut raw_png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut raw_png, image::ImageFormat::Png)
            .unwrap();
        let bytes = raw_png.into_inner();

        // Budget pre-check rejects oversized input before decoding.
        assert!(matches!(
            decode(
                ImageInput::Bytes {
                    mime: Some("image/png"),
                    bytes: &bytes
                },
                16,
                300,
            ),
            Err(DecodeError::BudgetExceeded { .. })
        ));

        let decoded = decode(
            ImageInput::Bytes {
                mime: Some("image/png"),
                bytes: &bytes,
            },
            128 * 1024 * 1024,
            300,
        )
        .unwrap();
        assert_eq!((decoded.natural_width, decoded.natural_height), (1200, 800));
        assert!(decoded.decoded_max_px <= 300, "{}", decoded.decoded_max_px);
        assert_eq!(decoded.frames.len(), 1);
        let frame = &decoded.frames[0];
        assert!(frame.width <= 300 && frame.height <= 200);
        // Verify BGRA channel order: red (220) is at index 2, blue (20) is at index 0.
        assert!(frame.bgra[2] > 180 && frame.bgra[0] < 60);
        assert!(decoded.total_bytes() <= MAX_DECODE_BYTES);

        // Clamp helper never lets a single frame exceed MAX_DECODE_BYTES (64 MiB -> 4096x4096).
        let clamped = clamp_decode_max_px(8192, 10_000, 10_000);
        assert!(
            (clamped as usize) * (clamped as usize) * 4 <= MAX_DECODE_BYTES,
            "clamped={clamped}"
        );
    }

    #[test]
    fn avif_decodes_in_process_to_bgra_frames() {
        let fixture = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("fixtures/media/red.avif");
        let decoded = decode(ImageInput::File(&fixture), 1 << 20, 512).unwrap();
        assert!(!decoded.frames.is_empty());
        let f = &decoded.frames[0];
        assert_eq!((f.width, f.height), (4, 3));
        assert_eq!(f.bgra.len(), 4 * 3 * 4);
        // Outside a restricted sandbox VTDecoderXPCService decodes the red AV1 plane;
        // when opaque pixels are present, verify BGRA ordering (R > B).
        if let Some(opaque) = f.bgra.chunks_exact(4).find(|px| px[3] > 0) {
            assert!(
                opaque[2] > opaque[0],
                "expected red in BGRA, got {opaque:?}"
            );
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn exif_orientation_rotates_thumbnail_dimensions_in_imageio() {
        // Minimal uncompressed 40x20 RGB TIFF with Orientation tag (274 / 0x0112) = 6 (90° CW).
        let (w, h): (u32, u32) = (40, 20);
        let pixel_bytes = (w * h * 3) as usize;
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II");
        tiff.extend_from_slice(&42u16.to_le_bytes());
        tiff.extend_from_slice(&8u32.to_le_bytes()); // IFD at offset 8
        let entries: u16 = 9;
        tiff.extend_from_slice(&entries.to_le_bytes());
        let strip_offset = 8 + 2 + (entries as u32) * 12 + 4 + 6;
        let bps_offset = strip_offset - 6;
        let mut entry = |tag: u16, ty: u16, count: u32, val: u32| {
            tiff.extend_from_slice(&tag.to_le_bytes());
            tiff.extend_from_slice(&ty.to_le_bytes());
            tiff.extend_from_slice(&count.to_le_bytes());
            tiff.extend_from_slice(&val.to_le_bytes());
        };
        entry(256, 4, 1, w); // ImageWidth = 40
        entry(257, 4, 1, h); // ImageLength = 20
        entry(258, 3, 3, bps_offset); // BitsPerSample = [8, 8, 8]
        entry(259, 3, 1, 1); // Compression = None
        entry(262, 3, 1, 2); // PhotometricInterpretation = RGB
        entry(273, 4, 1, strip_offset); // StripOffsets
        entry(274, 3, 1, 6); // Orientation = 6 (Rotate 90 CW)
        entry(277, 3, 1, 3); // SamplesPerPixel = 3
        entry(279, 4, 1, pixel_bytes as u32); // StripByteCounts
        tiff.extend_from_slice(&0u32.to_le_bytes()); // next IFD
        tiff.extend_from_slice(&8u16.to_le_bytes());
        tiff.extend_from_slice(&8u16.to_le_bytes());
        tiff.extend_from_slice(&8u16.to_le_bytes());
        tiff.extend(std::iter::repeat_n(200u8, pixel_bytes));

        let decoded = decode(
            ImageInput::Bytes {
                mime: Some("image/tiff"),
                bytes: &tiff,
            },
            1 << 20,
            512,
        )
        .unwrap();
        assert_eq!((decoded.natural_width, decoded.natural_height), (20, 40));
        assert_eq!(
            (decoded.frames[0].width, decoded.frames[0].height),
            (20, 40)
        );
    }

    #[test]
    fn quick_look_preview_respects_timeout_and_returns_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("sample.glb");
        std::fs::write(&bin, b"glTF\x02\x00\x00\x00\x0c\x00\x00\x00").unwrap();
        let start = Instant::now();
        let info = quick_look_preview(&bin, 256, QUICK_LOOK_TIMEOUT);
        assert!(start.elapsed() < Duration::from_secs(1));
        assert_eq!(info.byte_size, Some(12));
    }
}

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_OUTPUT_BYTES: usize = 128 * 1024 * 1024;
const CANCELLED: &str = "Image decoding was cancelled";

pub fn bytes_to_png(bytes: &[u8], max_bytes: u64) -> Result<Vec<u8>, String> {
    bytes_to_png_cancellable(bytes, max_bytes, &AtomicBool::new(false))
}

pub fn bytes_to_png_cancellable(
    bytes: &[u8],
    max_bytes: u64,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    if !cfg!(target_os = "macos") {
        return Err("AVIF decoding needs the platform image codec".into());
    }
    transcode_with(
        bytes,
        max_bytes,
        cancel,
        Path::new("/usr/bin/sips"),
        TIMEOUT,
        MAX_OUTPUT_BYTES,
    )
}

fn transcode_with(
    bytes: &[u8],
    max_bytes: u64,
    cancel: &AtomicBool,
    converter: &Path,
    timeout: Duration,
    max_output: usize,
) -> Result<Vec<u8>, String> {
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    if bytes.len() as u64 > max_bytes {
        return Err("image exceeds its preview budget".into());
    }
    let dir = tempfile::Builder::new()
        .prefix("puppyone-image-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let input = dir.path().join("source.avif");
    crate::platform::webview::write_private(&input, bytes).map_err(|e| e.to_string())?;
    // Relative, fixed names make the child independent of the provider's path.
    super::process::run_output(
        converter,
        &["-s", "format", "png", "source.avif", "--out", "preview.png"],
        dir.path(),
        None,
        timeout,
        cancel,
        super::process::OutputLimits {
            stdout: 64 * 1024,
            stderr: 64 * 1024,
        },
    )?;
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    let bytes = read_regular(&dir.path().join("preview.png"), max_output as u64)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Image codec returned no PNG".into());
    }
    if cancel.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    Ok(bytes)
}

fn read_regular(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err("Image file is not regular or exceeds its budget".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || opened.len() > max_bytes {
        return Err("Image file changed or exceeds its budget".into());
    }
    let bytes = super::process::bounded_read(
        (&file).take(max_bytes.saturating_add(1)),
        usize::try_from(max_bytes).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    if bytes.len() as u64 != opened.len()
        || opened.len() != after.len()
        || opened.modified().ok() != after.modified().ok()
    {
        return Err("Image file changed while reading".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn converter(root: &Path, script: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join("codec");
        std::fs::write(&path, format!("#!/bin/sh\nset -eu\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn conversion_admits_before_spawning_and_bounds_its_private_output() {
        let dir = tempfile::tempdir().unwrap();
        let codec = converter(
            dir.path(),
            "printf '\\211PNG\\r\\n\\032\\n' > preview.png\nprintf '0123456789' >> preview.png",
        );
        let cancel = AtomicBool::new(false);
        let convert = |input: &[u8], max, cap| {
            // Admission/output checks use the production liveness budget; the
            // dedicated test below owns the short timeout/cancellation contract.
            transcode_with(input, max, &cancel, &codec, TIMEOUT, cap)
        };
        assert_eq!(
            convert(b"input", 4, 18).unwrap_err(),
            "image exceeds its preview budget"
        );
        assert_eq!(convert(b"input", 5, 18).unwrap().len(), 18);
        assert_eq!(
            convert(b"input", 5, 17).unwrap_err(),
            "Image file is not regular or exceeds its budget"
        );
        cancel.store(true, Ordering::Release);
        let absent = dir.path().join("must-not-execute");
        assert_eq!(
            transcode_with(b"input", 5, &cancel, &absent, Duration::from_secs(2), 18).unwrap_err(),
            CANCELLED
        );
    }

    #[cfg(unix)]
    #[test]
    fn codec_output_rejects_links_missing_files_and_invalid_pngs() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        for (script, expected) in [
            ("exit 0", "No such file or directory"),
            (
                "printf invalid > preview.png",
                "Image codec returned no PNG",
            ),
            (
                "ln -s source.avif preview.png",
                "Image file is not regular or exceeds its budget",
            ),
            (
                "mkdir preview.png",
                "Image file is not regular or exceeds its budget",
            ),
            ("exit 7", ""),
        ] {
            let codec = converter(dir.path(), script);
            let error =
                transcode_with(b"\x89PNG\r\n\x1a\n", 8, &cancel, &codec, TIMEOUT, 128).unwrap_err();
            if expected.is_empty() {
                assert_eq!(error, expected, "{script}");
            } else {
                assert!(error.contains(expected), "{script}: {error}");
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_or_timing_out_image_conversion_reaps_the_codec_and_removes_its_files() {
        use std::time::Instant;
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("started");
        // Fixed test-owned temp paths, with no provider/user path interpolation.
        let codec = converter(
            dir.path(),
            &format!(
                "printf '%s\\n%s\\n' \"$$\" \"$PWD\" > '{}'\nexec /bin/sleep 30",
                marker.display()
            ),
        );
        for timeout in [false, true] {
            let cancel = AtomicBool::new(false);
            let started = Instant::now();
            std::thread::scope(|scope| {
                let job = scope.spawn(|| {
                    transcode_with(
                        b"input",
                        5,
                        &cancel,
                        &codec,
                        if timeout {
                            Duration::from_millis(250)
                        } else {
                            Duration::from_secs(5)
                        },
                        128,
                    )
                });
                while !marker.exists()
                    || std::fs::read_to_string(&marker).unwrap().lines().count() < 2
                {
                    assert!(started.elapsed() < Duration::from_secs(3));
                    std::thread::sleep(Duration::from_millis(1));
                }
                let info = std::fs::read_to_string(&marker).unwrap();
                let mut lines = info.lines();
                let pid: i32 = lines.next().unwrap().parse().unwrap();
                let temporary = Path::new(lines.next().unwrap());
                assert!(temporary.join("source.avif").is_file());
                if !timeout {
                    cancel.store(true, Ordering::Release);
                }
                assert!(job.join().unwrap().is_err());
                assert!(!temporary.exists());
                assert_eq!(
                    unsafe { libc::kill(pid, 0) },
                    -1,
                    "codec survived its owner"
                );
            });
            assert!(started.elapsed() < Duration::from_secs(3));
            std::fs::remove_file(&marker).unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hosted_avif_uses_the_same_codec_and_rejects_oversized_or_invalid_bytes() {
        let avif = include_bytes!("../../fixtures/media/red.avif");
        let png = bytes_to_png(avif, avif.len() as u64).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(bytes_to_png(avif, avif.len() as u64 - 1).is_err());
        assert!(bytes_to_png(b"not an image", 1024).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn avif_is_transcoded_to_png_through_imageio() {
        assert!(needs_transcode("photo.AVIF"));
        assert!(!needs_transcode("photo.png"));
        let fixture = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("fixtures/media/red.avif");
        let png = to_png(&fixture, 1 << 20).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(to_png(&fixture, 10).is_err());
    }
}

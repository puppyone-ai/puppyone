//! `app.setAsDefaultProtocolClient` (`main.mjs`): a packaged app makes itself
//! the handler of its channel's return scheme (`puppyone://`,
//! `puppyone-internal://`, …), so template links and the return-to-app link
//! reach it. Its Info.plist declares the scheme (`CFBundleURLTypes`).

/// Claims `scheme` for this bundle unless it already handles it; a
/// development build run from `target/` has no bundle and claims nothing.
pub fn claim(scheme: &str) {
    #[cfg(target_os = "macos")]
    if let Err(error) = macos::claim(scheme) {
        crate::diagnosticln!("Unable to register the PuppyOne return link: {error}");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = scheme;
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_foundation::{NSBundle, NSString};
    use std::ffi::c_void;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSCopyDefaultHandlerForURLScheme(scheme: *const c_void) -> *const c_void;
        fn LSSetDefaultHandlerForURLScheme(scheme: *const c_void, handler: *const c_void) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: *const c_void);
    }

    pub(super) fn claim(scheme: &str) -> Result<(), String> {
        let Some(bundle) = NSBundle::mainBundle().bundleIdentifier() else {
            return Ok(());
        };
        let scheme = NSString::from_str(scheme);
        // NSString is toll-free bridged with CFStringRef.
        let scheme_ref = (&*scheme as *const NSString).cast::<c_void>();
        // SAFETY: a live CFString; the copied handler is ours to release.
        let current = unsafe { LSCopyDefaultHandlerForURLScheme(scheme_ref) };
        if !current.is_null() {
            // SAFETY: a CFString returned under the Copy rule.
            let handler = unsafe { &*current.cast::<NSString>() }.to_string();
            unsafe { CFRelease(current) };
            if handler.eq_ignore_ascii_case(&bundle.to_string()) {
                return Ok(());
            }
        }
        let bundle_ref = (&*bundle as *const NSString).cast::<c_void>();
        // SAFETY: two live CFStrings.
        match unsafe { LSSetDefaultHandlerForURLScheme(scheme_ref, bundle_ref) } {
            0 => Ok(()),
            status => Err(format!("LaunchServices status {status}")),
        }
    }
}

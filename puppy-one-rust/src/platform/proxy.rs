//! The system's proxy for each request, the way Chromium (and so the
//! product's Electron network stack) resolves it on macOS: a proxy
//! auto-configuration script (PAC, by URL or found by WPAD) is evaluated
//! per URL through CFNetwork. reqwest's own system support reads only the
//! fixed HTTP and HTTPS proxies, so a client adds [`system`] to its builder;
//! without a PAC it changes nothing.
#[cfg(target_os = "macos")]
use std::time::Duration;

/// How long a URL's answer is reused (by scheme, host and port).
#[cfg(target_os = "macos")]
const CACHE_FOR: Duration = Duration::from_secs(60);
/// The longest one PAC evaluation may take; past it, the request goes
/// direct.
#[cfg(target_os = "macos")]
const PAC_TIMEOUT: Duration = Duration::from_secs(5);

/// `builder` with the system's PAC proxy, when the system uses one.
pub fn system(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    #[cfg(target_os = "macos")]
    if mac::uses_pac() {
        // A proxy of our own replaces reqwest's system proxies: CFNetwork
        // answers for the fixed ones and their exceptions too.
        return builder.proxy(reqwest::Proxy::custom(|url| {
            // Like Chromium, a loopback endpoint never goes through a proxy.
            if matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) {
                return None;
            }
            cached(url, || mac::proxy_for(url.as_str()))
        }));
    }
    builder
}

/// What a resolution says: a proxy's URL, or direct.
#[cfg(target_os = "macos")]
type Answer = Option<String>;

#[cfg(target_os = "macos")]
fn cached(url: &reqwest::Url, resolve: impl FnOnce() -> Answer) -> Answer {
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
        time::Instant,
    };
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Answer)>>> = OnceLock::new();
    let key = format!(
        "{}://{}:{}",
        url.scheme(),
        url.host_str().unwrap_or_default(),
        url.port_or_known_default().unwrap_or_default()
    );
    let cache = CACHE.get_or_init(Default::default);
    if let Some((at, answer)) = cache.lock().ok().and_then(|c| c.get(&key).cloned())
        && at.elapsed() < CACHE_FOR
    {
        return answer;
    }
    let answer = resolve();
    if let Ok(mut cache) = cache.lock() {
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_FOR);
        cache.insert(key, (Instant::now(), answer.clone()));
    }
    answer
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{Answer, PAC_TIMEOUT};
    use core_foundation_sys::{
        array::{CFArrayGetCount, CFArrayGetValueAtIndex, CFArrayRef},
        base::{CFGetTypeID, CFIndex, CFRelease, CFTypeRef, kCFAllocatorDefault},
        dictionary::{CFDictionaryGetValue, CFDictionaryRef},
        error::CFErrorRef,
        number::{CFNumberGetTypeID, CFNumberGetValue, CFNumberRef, kCFNumberSInt64Type},
        runloop::{
            CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRemoveSource, CFRunLoopRunInMode,
            CFRunLoopSourceRef, CFRunLoopStop,
        },
        string::{CFStringCreateWithBytes, CFStringGetCString, CFStringRef, kCFStringEncodingUTF8},
        url::{CFURLCreateWithString, CFURLRef},
    };
    use std::{ffi::c_void, ptr};

    #[repr(C)]
    struct StreamClientContext {
        version: CFIndex,
        info: *mut c_void,
        retain: *const c_void,
        release: *const c_void,
        copy_description: *const c_void,
    }
    type PacCallback = extern "C" fn(*mut c_void, CFArrayRef, CFErrorRef);

    #[link(name = "CFNetwork", kind = "framework")]
    unsafe extern "C" {
        fn CFNetworkCopySystemProxySettings() -> CFDictionaryRef;
        fn CFNetworkCopyProxiesForURL(url: CFURLRef, settings: CFDictionaryRef) -> CFArrayRef;
        fn CFNetworkExecuteProxyAutoConfigurationURL(
            script_url: CFURLRef,
            target: CFURLRef,
            callback: PacCallback,
            context: *mut StreamClientContext,
        ) -> CFRunLoopSourceRef;
        fn CFNetworkExecuteProxyAutoConfigurationScript(
            script: CFStringRef,
            target: CFURLRef,
            callback: PacCallback,
            context: *mut StreamClientContext,
        ) -> CFRunLoopSourceRef;
        static kCFProxyTypeKey: CFStringRef;
        static kCFProxyHostNameKey: CFStringRef;
        static kCFProxyPortNumberKey: CFStringRef;
        static kCFProxyAutoConfigurationURLKey: CFStringRef;
        static kCFProxyAutoConfigurationJavaScriptKey: CFStringRef;
        static kCFProxyTypeNone: CFStringRef;
        static kCFProxyTypeHTTP: CFStringRef;
        static kCFProxyTypeHTTPS: CFStringRef;
        static kCFProxyTypeAutoConfigurationURL: CFStringRef;
        static kCFProxyTypeAutoConfigurationJavaScript: CFStringRef;
        static kCFNetworkProxiesProxyAutoConfigEnable: CFStringRef;
        static kCFNetworkProxiesProxyAutoDiscoveryEnable: CFStringRef;
    }

    /// An owned Core Foundation object, released once.
    struct Owned(CFTypeRef);
    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: a +1 reference this value owns.
                unsafe { CFRelease(self.0) }
            }
        }
    }

    fn cf_string(text: &str) -> Owned {
        // SAFETY: valid UTF-8 bytes and their length.
        Owned(
            unsafe {
                CFStringCreateWithBytes(
                    kCFAllocatorDefault,
                    text.as_ptr(),
                    text.len() as CFIndex,
                    kCFStringEncodingUTF8,
                    0,
                )
            }
            .cast(),
        )
    }
    fn cf_url(text: &str) -> Owned {
        let string = cf_string(text);
        // SAFETY: a live CFString.
        Owned(
            unsafe { CFURLCreateWithString(kCFAllocatorDefault, string.0.cast(), ptr::null()) }
                .cast(),
        )
    }
    /// SAFETY: `value` is null or a CFString.
    unsafe fn rust_string(value: CFTypeRef) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let mut buffer = [0 as std::ffi::c_char; 2048];
        // SAFETY: the buffer's own length.
        let ok = unsafe {
            CFStringGetCString(
                value.cast(),
                buffer.as_mut_ptr(),
                buffer.len() as CFIndex,
                kCFStringEncodingUTF8,
            )
        };
        (ok != 0).then(|| {
            // SAFETY: CFStringGetCString wrote a NUL-terminated string.
            unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) }
                .to_string_lossy()
                .into_owned()
        })
    }
    /// SAFETY: `dictionary` is a live CFDictionary.
    unsafe fn get(dictionary: CFDictionaryRef, key: CFStringRef) -> CFTypeRef {
        unsafe { CFDictionaryGetValue(dictionary, key.cast()) }
    }
    /// SAFETY: `value` is null or a live Core Foundation object.
    unsafe fn number(value: CFTypeRef) -> Option<i64> {
        if value.is_null() || unsafe { CFGetTypeID(value) != CFNumberGetTypeID() } {
            return None;
        }
        let mut number: i64 = 0;
        // SAFETY: a CFNumber, read into an i64.
        let ok = unsafe {
            CFNumberGetValue(
                value as CFNumberRef,
                kCFNumberSInt64Type,
                (&mut number as *mut i64).cast(),
            )
        };
        ok.then_some(number)
    }

    /// Whether the system proxy settings name a PAC script or WPAD.
    pub(super) fn uses_pac() -> bool {
        // SAFETY: a +1 dictionary, released by `Owned`.
        let settings = Owned(unsafe { CFNetworkCopySystemProxySettings() }.cast());
        if settings.0.is_null() {
            return false;
        }
        let dictionary: CFDictionaryRef = settings.0.cast();
        // SAFETY: the live settings dictionary and CFNetwork's keys.
        unsafe {
            number(get(dictionary, kCFNetworkProxiesProxyAutoConfigEnable)).unwrap_or(0) != 0
                || number(get(dictionary, kCFNetworkProxiesProxyAutoDiscoveryEnable)).unwrap_or(0)
                    != 0
        }
    }

    /// The proxy CFNetwork chooses for `url` under the system settings.
    pub(super) fn proxy_for(url: &str) -> Answer {
        let target = cf_url(url);
        if target.0.is_null() {
            return None;
        }
        // SAFETY: +1 objects owned by `Owned`; the target URL is live.
        let settings = Owned(unsafe { CFNetworkCopySystemProxySettings() }.cast());
        if settings.0.is_null() {
            return None;
        }
        let proxies =
            Owned(unsafe { CFNetworkCopyProxiesForURL(target.0.cast(), settings.0.cast()) }.cast());
        choose(proxies.0.cast(), target.0.cast(), 0)
    }

    /// The first usable entry of a CFNetwork proxy list: direct, an HTTP(S)
    /// proxy, or a PAC script's own answer (one level deep).
    fn choose(list: CFArrayRef, target: CFURLRef, depth: u8) -> Answer {
        if list.is_null() {
            return None;
        }
        // SAFETY: a live CFArray of CFDictionaries (CFNetwork's proxy list).
        unsafe {
            for index in 0..CFArrayGetCount(list) {
                let entry: CFDictionaryRef = CFArrayGetValueAtIndex(list, index).cast();
                let kind = get(entry, kCFProxyTypeKey);
                let is = |other: CFStringRef| {
                    core_foundation_sys::base::CFEqual(kind, other.cast()) != 0
                };
                if is(kCFProxyTypeNone) {
                    return None;
                }
                if is(kCFProxyTypeHTTP) || is(kCFProxyTypeHTTPS) {
                    let Some(host) = rust_string(get(entry, kCFProxyHostNameKey)) else {
                        continue;
                    };
                    let Some(port) = number(get(entry, kCFProxyPortNumberKey)) else {
                        continue;
                    };
                    return Some(format!("http://{host}:{port}"));
                }
                if depth > 0 {
                    continue;
                }
                let script = if is(kCFProxyTypeAutoConfigurationURL) {
                    Script::Url(get(entry, kCFProxyAutoConfigurationURLKey).cast())
                } else if is(kCFProxyTypeAutoConfigurationJavaScript) {
                    Script::Source(get(entry, kCFProxyAutoConfigurationJavaScriptKey).cast())
                } else {
                    // SOCKS and FTP proxies: reqwest here speaks HTTP proxies only.
                    continue;
                };
                if let Some(answer) = evaluate(script, target) {
                    return answer;
                }
            }
        }
        None
    }

    pub(super) enum Script {
        Url(CFURLRef),
        Source(CFStringRef),
    }

    struct Pending {
        result: Option<Owned>,
        done: bool,
    }
    extern "C" fn finished(info: *mut c_void, proxies: CFArrayRef, _: CFErrorRef) {
        // SAFETY: `info` is `evaluate`'s boxed `Pending`, alive until its
        // source is removed.
        let pending = unsafe { &mut *info.cast::<Pending>() };
        if !proxies.is_null() {
            // SAFETY: retained for after the callback returns.
            pending.result = Some(Owned(unsafe {
                core_foundation_sys::base::CFRetain(proxies.cast())
            }));
        }
        pending.done = true;
        // SAFETY: the current thread's run loop, running in `evaluate`.
        unsafe { CFRunLoopStop(CFRunLoopGetCurrent()) };
    }

    /// Runs a PAC script for `target` on this thread's run loop: `None`
    /// when it fails or times out, else the script's choice.
    pub(super) fn evaluate(script: Script, target: CFURLRef) -> Option<Answer> {
        if matches!(script, Script::Url(p) if p.is_null())
            || matches!(script, Script::Source(p) if p.is_null())
        {
            return None;
        }
        // Shared with the callback: read and written through this pointer
        // only, and freed below.
        let pending = Box::into_raw(Box::new(Pending {
            result: None,
            done: false,
        }));
        let mut context = StreamClientContext {
            version: 0,
            info: pending.cast(),
            retain: ptr::null(),
            release: ptr::null(),
            copy_description: ptr::null(),
        };
        let mode = cf_string("ai.puppyone.pac");
        // SAFETY: CFNetwork's documented asynchronous evaluation: a run
        // loop source in a private mode, run here until the callback stops
        // it or the time runs out, then removed.
        unsafe {
            let source = match script {
                Script::Url(url) => {
                    CFNetworkExecuteProxyAutoConfigurationURL(url, target, finished, &mut context)
                }
                Script::Source(text) => CFNetworkExecuteProxyAutoConfigurationScript(
                    text,
                    target,
                    finished,
                    &mut context,
                ),
            };
            if source.is_null() {
                drop(Box::from_raw(pending));
                return None;
            }
            let run_loop = CFRunLoopGetCurrent();
            CFRunLoopAddSource(run_loop, source, mode.0.cast());
            let deadline = std::time::Instant::now() + PAC_TIMEOUT;
            // The callback sets `done` from inside the run loop.
            while !ptr::read_volatile(&raw const (*pending).done) {
                let left = deadline.saturating_duration_since(std::time::Instant::now());
                if left.is_zero() {
                    break;
                }
                CFRunLoopRunInMode(mode.0.cast(), left.as_secs_f64(), 0);
            }
            CFRunLoopRemoveSource(run_loop, source, mode.0.cast());
            CFRelease(source.cast());
        }
        // SAFETY: the source is gone, so the callback can no longer run.
        let pending = unsafe { Box::from_raw(pending) };
        let list = pending.result?;
        Some(choose(list.0.cast(), target, 1))
    }

    #[cfg(test)]
    pub(super) fn evaluate_source(source: &str, url: &str) -> Option<Answer> {
        let script = cf_string(source);
        let target = cf_url(url);
        evaluate(Script::Source(script.0.cast()), target.0.cast())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_pac_script_chooses_a_proxy_per_host() {
        let script = r#"function FindProxyForURL(url, host) {
            if (host == "example.com") return "PROXY 10.0.0.1:3128; DIRECT";
            return "DIRECT";
        }"#;
        assert_eq!(
            mac::evaluate_source(script, "https://example.com/a"),
            Some(Some("http://10.0.0.1:3128".into()))
        );
        assert_eq!(
            mac::evaluate_source(script, "https://other.test/"),
            Some(None)
        );
    }

    #[test]
    fn answers_are_reused_per_origin() {
        let url = reqwest::Url::parse("https://cache.test:8443/a").unwrap();
        assert_eq!(
            cached(&url, || Some("http://p:1".into())),
            Some("http://p:1".into())
        );
        let again = reqwest::Url::parse("https://cache.test:8443/b").unwrap();
        assert_eq!(cached(&again, || None), Some("http://p:1".into()));
    }
}

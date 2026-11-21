//! Native embedded WebView backend abstraction (`embedded-web-content.md`).
//!
//! All OS-specific WebView bindings (`wry`, `objc2`, WebView2, WKWebView) live
//! inside this directory so `src/web_host/mod.rs` remains 100% OS-agnostic.
#[cfg(target_os = "macos")]
pub(super) mod macos;
#[cfg(target_os = "macos")]
pub(super) mod macos_stream;
#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
#[path = "../protocol_tests.rs"]
mod protocol_tests;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

use crate::platform::webview::Content;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::platform::webview::{
    ENTRY_ORIGIN, PreparedContent, PreparedResponse, ProtocolResponse, prepare_request,
};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::borrow::Cow;

#[cfg(target_os = "macos")]
use macos as imp;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use unsupported as imp;
#[cfg(target_os = "windows")]
use windows as imp;

/// Platform-owned native WebView instance.
pub(super) struct NativeBackend(imp::BackendHost);

impl NativeBackend {
    /// Whether this target OS supports an embedded native WebView.
    pub(super) const fn is_supported() -> bool {
        imp::SUPPORTED
    }

    pub(super) fn build(
        window: &impl raw_window_handle::HasWindowHandle,
        content: Content,
        dark: bool,
    ) -> Result<Self, String> {
        imp::BackendHost::build(window, content, dark).map(Self)
    }

    pub(super) fn place(&self, bounds: (f32, f32, f32, f32)) {
        self.0.place(bounds);
    }

    pub(super) fn place_clipped(
        &self,
        bounds: (f32, f32, f32, f32),
        visible: (f32, f32, f32, f32),
        radius: f32,
    ) {
        self.0.place_clipped(bounds, visible, radius);
    }

    pub(super) fn showing_rect(&self, fallback: (f32, f32, f32, f32)) -> (f32, f32, f32, f32) {
        self.0.showing_rect(fallback)
    }

    pub(super) fn set_visible(&self, show: bool) {
        self.0.set_visible(show);
    }

    /// Applies floating-surface cutouts to the native view. Returns `false` if
    /// the platform cannot mask holes and at least one hole intersects the view
    /// (causing the host to hide while overlapped).
    pub(super) fn apply_cutouts(&self, holes: &[[f32; 5]], size: (f32, f32)) -> bool {
        self.0.apply_cutouts(holes, size)
    }

    pub(super) fn yield_focus_to_window(&self) {
        self.0.yield_focus_to_window();
    }

    pub(super) fn reload(&self) {
        self.0.reload();
    }

    pub(super) fn evaluate(&self, script: &str) {
        self.0.evaluate(script);
    }

    pub(super) fn resize_hidden(&self, width: f32, height: f32) {
        self.0.resize_hidden(width, height);
    }

    pub(super) fn has_native_capture(&self) -> bool {
        self.0.has_native_capture()
    }

    pub(super) fn snapshot(
        &self,
        rect: (f32, f32, f32, f32),
        width: f32,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        self.0.snapshot(rect, width, done);
    }

    pub(super) fn capture_png(
        &self,
        crop: Option<(f32, f32, f32, f32)>,
        viewport: Option<(f32, f32)>,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        self.0.capture_png(crop, viewport, done);
    }

    #[cfg(all(target_os = "macos", feature = "dev-capture"))]
    pub(crate) fn macos_host(&self) -> &macos::BackendHost {
        &self.0
    }
}

#[cfg(all(target_os = "macos", feature = "dev-capture"))]
impl std::ops::Deref for NativeBackend {
    type Target = macos::BackendHost;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[cfg(feature = "dev-capture")]
pub(super) fn run_stream_probe() {
    #[cfg(target_os = "macos")]
    macos_stream::run_probe();
}

#[cfg(feature = "dev-capture")]
pub(super) fn run_whiteboard_probe(root: &std::path::Path) {
    #[cfg(target_os = "macos")]
    macos_stream::run_whiteboard_probe(root);
    #[cfg(not(target_os = "macos"))]
    let _ = root;
}

#[cfg(feature = "dev-capture")]
pub(super) fn run_document_pages_probe() {
    #[cfg(target_os = "macos")]
    macos_stream::run_document_pages_probe();
}

/// Shared by the Wry handlers on macOS and Windows so method/origin/range checks
/// cannot drift across platforms.
#[cfg(any(target_os = "windows", all(test, target_os = "macos")))]
pub(super) fn protocol_response(
    content: &PreparedContent,
    local: bool,
    request: &wry::http::Request<Vec<u8>>,
) -> wry::http::Response<Cow<'static, [u8]>> {
    let mut reply = prepare_protocol_response(content, local, request).collect();
    if request.method() == "HEAD" {
        reply.body.clear();
    }
    response(reply, content.policy)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) fn prepare_protocol_response(
    content: &PreparedContent,
    local: bool,
    request: &wry::http::Request<Vec<u8>>,
) -> PreparedResponse {
    let header = |name| {
        let mut values = request.headers().get_all(name).iter();
        let first = values.next()?;
        Some(if values.next().is_some() {
            "\0"
        } else {
            first.to_str().unwrap_or("\0")
        })
    };
    prepare_request(
        content,
        local,
        request.method().as_str(),
        &request.uri().to_string(),
        header("origin"),
        header("range"),
    )
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) fn response(
    reply: ProtocolResponse,
    policy: Option<&'static str>,
) -> wry::http::Response<Cow<'static, [u8]>> {
    let mut builder = wry::http::Response::builder()
        .status(reply.status)
        .header("Content-Type", reply.mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if let Some(length) = reply.length {
        builder = builder.header("Content-Length", length);
    }
    if let Some(range) = reply.content_range {
        builder = builder.header("Content-Range", range);
    }
    if reply.accept_ranges {
        builder = builder.header("Accept-Ranges", "bytes");
    }
    if reply.status == 405 {
        builder = builder.header("Allow", "GET, HEAD, OPTIONS");
    }
    if reply.cors {
        builder = builder
            .header("Access-Control-Allow-Origin", ENTRY_ORIGIN)
            .header("Vary", "Origin")
            .header("Access-Control-Allow-Headers", "range")
            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            .header(
                "Access-Control-Expose-Headers",
                "Content-Range, Content-Length, Accept-Ranges",
            );
    }
    if let Some(policy) = policy {
        builder = builder.header("Content-Security-Policy", policy);
    }
    builder
        .body(Cow::<'static, [u8]>::Owned(reply.body))
        .unwrap_or_else(|_| wry::http::Response::new(Cow::Borrowed(&[][..])))
}

/// Shared navigation allowlist for both WKWebView and WebView2.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) fn allow_navigation(
    url: &str,
    locked: bool,
    frames: &Option<crate::platform::webview::Frames>,
) -> bool {
    use crate::platform::webview::{is_entry_navigation_url, is_protocol_url};
    if locked {
        return is_entry_navigation_url(url)
            || url == "about:blank"
            || frames.as_ref().is_some_and(|frames| frames.allows(url));
    }
    if is_protocol_url(url) || url == "about:blank" || url == "about:srcdoc" {
        return true;
    }
    if frames.as_ref().is_some_and(|frames| frames.allows(url)) {
        return true;
    }
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = crate::platform::desktop::open_url(url);
    }
    false
}

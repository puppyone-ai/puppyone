//! Native web content hosts (`wry` child WebViews) for viewers; the
//! protocol, path policy and MIME table live in `platform::webview`.
#![cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
use crate::platform::webview::{
    Content, LOCAL_SCHEME, SCHEME, entry_url, probe_local, respond, respond_local,
};
use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    rc::{Rc, Weak},
};

/// Shared visibility state of one host (main thread only).
struct HostState {
    window: u64,
    painted: Cell<bool>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    view: wry::WebView,
    visible: Cell<bool>,
    bounds: Cell<(f32, f32, f32, f32)>,
}
thread_local! {
    static HOSTS: RefCell<Vec<Weak<HostState>>> = const { RefCell::new(Vec::new()) };
    static OVERLAY: RefCell<std::collections::HashMap<u64, bool>> = RefCell::new(Default::default());
}

/// A live WebView. Dropping it destroys the native view.
pub struct WebHost {
    state: Rc<HostState>,
}
fn window_key(window: &gpui::Window) -> u64 {
    window.window_handle().window_id().as_u64()
}
impl WebHost {
    /// Creates the WebView hidden; it shows once its element paints.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn new(window: &gpui::Window, content: Content, dark: bool) -> Result<Self, String> {
        let served = content.clone();
        let local = content.clone();
        let background = if dark {
            (24, 24, 27, 255)
        } else {
            (255, 255, 255, 255)
        };
        let mut builder = wry::WebViewBuilder::new();
        if let Some(ipc) = content.ipc.clone() {
            builder = builder.with_ipc_handler(move |request: wry::http::Request<String>| {
                let url = request.uri().to_string();
                ipc.accept(&url, request.into_body());
            });
        }
        let view = builder
            .with_url(entry_url())
            .with_incognito(true)
            .with_devtools(false)
            .with_clipboard(true)
            .with_visible(false)
            .with_background_color(background)
            // Resources are read off the main thread: a folder read or a
            // Cloud provider request never stalls drawing.
            .with_asynchronous_custom_protocol(SCHEME.into(), move |_, request, responder| {
                let served = served.clone();
                let path = request.uri().path().to_owned();
                std::thread::spawn(move || {
                    let (status, mime, body) = respond(&served, &path);
                    responder.respond(response(status, mime, body, served.policy));
                });
            })
            .with_asynchronous_custom_protocol(LOCAL_SCHEME.into(), move |_, request, responder| {
                let served = local.clone();
                let path = request.uri().path().to_owned();
                let probe = request
                    .headers()
                    .get("range")
                    .is_some_and(|range| range.as_bytes() == b"bytes=0-0");
                // The entry page reads granted resources with `fetch` (the
                // Office loader's size probe and body); no other origin may.
                let cors = request
                    .headers()
                    .get("origin")
                    .is_some_and(|origin| origin.as_bytes() == ENTRY_ORIGIN.as_bytes());
                if request.method() == wry::http::Method::OPTIONS {
                    let mut preflight = response(204, "text/plain", Vec::new(), served.policy);
                    if cors {
                        allow(&mut preflight);
                    }
                    responder.respond(preflight);
                    return;
                }
                std::thread::spawn(move || {
                    let mut reply = match probe.then(|| probe_local(&served, &path)).flatten() {
                        Some((size, first)) => partial(size, first, served.policy),
                        None => {
                            let (status, mime, body) = respond_local(&served, &path);
                            response(status, mime, body, served.policy)
                        }
                    };
                    if cors {
                        allow(&mut reply);
                    }
                    responder.respond(reply);
                });
            })
            // OS file drags over web content never load the file into the
            // page (`acquireNativeSurfaceOcclusionLease` keeps them for the
            // pane in the product).
            .with_drag_drop_handler(|_| true)
            .with_navigation_handler(|url| {
                // `about:srcdoc` is inline content the page already holds
                // (the HTML visual editor's sandboxed projection frame).
                if url.starts_with(SCHEME) || url == "about:blank" || url == "about:srcdoc" {
                    return true;
                }
                if url.starts_with("https://") || url.starts_with("http://") {
                    let _ = crate::platform::desktop::open_url(&url);
                }
                false
            })
            .with_new_window_req_handler(|url, _| {
                if url.starts_with("https://") || url.starts_with("http://") {
                    let _ = crate::platform::desktop::open_url(&url);
                }
                wry::NewWindowResponse::Deny
            })
            .build_as_child(window)
            .map_err(|e| e.to_string())?;
        let state = Rc::new(HostState {
            window: window_key(window),
            painted: Cell::new(false),
            view,
            visible: Cell::new(false),
            bounds: Cell::new((0., 0., 0., 0.)),
        });
        HOSTS.with(|h| h.borrow_mut().push(Rc::downgrade(&state)));
        Ok(Self { state })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn new(_window: &gpui::Window, _content: Content, _dark: bool) -> Result<Self, String> {
        Err("Web content is not available on this platform yet.".into())
    }
    /// Called from the element's paint: place the view over `bounds`.
    pub fn place(&self, bounds: gpui::Bounds<gpui::Pixels>) {
        let rect = (
            f32::from(bounds.origin.x),
            f32::from(bounds.origin.y),
            f32::from(bounds.size.width).max(1.),
            f32::from(bounds.size.height).max(1.),
        );
        self.state.painted.set(true);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if self.state.bounds.get() != rect {
            self.state.bounds.set(rect);
            let _ = self.state.view.set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(rect.0, rect.1).into(),
                size: wry::dpi::LogicalSize::new(rect.2, rect.3).into(),
            });
        }
    }
    pub fn reload(&self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let _ = self.state.view.load_url(&entry_url());
    }
    /// Runs trusted host script in the entry document (a message to the
    /// page's own receiver; never document content).
    pub fn evaluate(&self, script: &str) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let _ = self.state.view.evaluate_script(script);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = script;
    }
}

/// Shell overlays (menus, dialogs) over this window hide its web content.
pub fn set_overlay(window: &gpui::Window, open: bool) {
    OVERLAY.with(|o| o.borrow_mut().insert(window_key(window), open));
}
/// Called once per drawn frame by the window's shell: after the frame,
/// hosts that painted show, the rest hide.
pub fn frame_drawn(window: &mut gpui::Window) {
    let key = window_key(window);
    let any = HOSTS.with(|h| {
        h.borrow_mut().retain(|w| w.strong_count() > 0);
        h.borrow()
            .iter()
            .filter_map(Weak::upgrade)
            .any(|s| s.window == key)
    });
    if !any {
        return;
    }
    window.on_next_frame(move |_, _| reconcile(key));
}
fn reconcile(key: u64) {
    let overlay = OVERLAY.with(|o| o.borrow().get(&key).copied().unwrap_or(false));
    HOSTS.with(|h| {
        for state in h.borrow().iter().filter_map(Weak::upgrade) {
            if state.window != key {
                continue;
            }
            let show = state.painted.replace(false) && !overlay;
            if state.visible.get() != show {
                state.visible.set(show);
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                let _ = state.view.set_visible(show);
            }
        }
    });
}

/// A protocol response; `policy` travels with every one of a host's
/// responses (`local-file-protocol.mjs` security headers).
#[cfg(any(target_os = "macos", target_os = "windows"))]
/// The entry document's origin (`puppyone-preview://local`).
const ENTRY_ORIGIN: &str = "puppyone-preview://local";
/// CORS for the entry page's own reads of granted resources.
fn allow(response: &mut wry::http::Response<Cow<'static, [u8]>>) {
    let headers = response.headers_mut();
    headers.insert(
        "Access-Control-Allow-Origin",
        wry::http::HeaderValue::from_static(ENTRY_ORIGIN),
    );
    headers.insert(
        "Access-Control-Allow-Headers",
        wry::http::HeaderValue::from_static("range"),
    );
    headers.insert(
        "Access-Control-Allow-Methods",
        wry::http::HeaderValue::from_static("GET"),
    );
    headers.insert(
        "Access-Control-Expose-Headers",
        wry::http::HeaderValue::from_static("Content-Range, Content-Length"),
    );
}
/// `206 Partial Content` for a size probe: the first byte and the total.
fn partial(
    size: u64,
    first: Vec<u8>,
    policy: Option<&'static str>,
) -> wry::http::Response<Cow<'static, [u8]>> {
    let mut builder = wry::http::Response::builder()
        .status(206)
        .header("Content-Type", "application/octet-stream")
        .header("Content-Range", format!("bytes 0-0/{size}"))
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if let Some(policy) = policy {
        builder = builder.header("Content-Security-Policy", policy);
    }
    builder
        .body(Cow::<'static, [u8]>::Owned(first))
        .unwrap_or_else(|_| wry::http::Response::new(Cow::Borrowed(&[][..])))
}
fn response(
    status: u16,
    mime: &str,
    body: Vec<u8>,
    policy: Option<&'static str>,
) -> wry::http::Response<Cow<'static, [u8]>> {
    let mut builder = wry::http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if let Some(policy) = policy {
        builder = builder.header("Content-Security-Policy", policy);
    }
    builder
        .body(Cow::<'static, [u8]>::Owned(body))
        .unwrap_or_else(|_| wry::http::Response::new(Cow::Borrowed(&[][..])))
}

/// A snapshot of one host's web content and where it sits in the window
/// (logical pixels), filled in on the main thread when WebKit answers.
#[cfg(all(target_os = "macos", feature = "dev-capture"))]
pub struct Snapshot {
    pub bounds: (f32, f32, f32, f32),
    pub png: Rc<RefCell<Option<Option<Vec<u8>>>>>,
}
/// Dev-capture: snapshots of this window's visible web content, so an
/// offscreen capture (GPUI's frame alone) can show it in place.
#[cfg(all(target_os = "macos", feature = "dev-capture"))]
pub fn snapshots(window: &gpui::Window) -> Vec<Snapshot> {
    use objc2::{class, msg_send, runtime::AnyObject};
    use wry::WebViewExtMacOS;
    let key = window_key(window);
    let states: Vec<Rc<HostState>> = HOSTS.with(|h| {
        h.borrow()
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|s| s.window == key && s.visible.get())
            .collect()
    });
    states
        .into_iter()
        .map(|state| {
            let png: Rc<RefCell<Option<Option<Vec<u8>>>>> = Rc::default();
            let slot = png.clone();
            let handler = block2::RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
                // SAFETY: WebKit hands back an NSImage (or nil) on the main
                // thread; every object is used only inside this call.
                let bytes = unsafe {
                    (!image.is_null())
                        .then(|| {
                            let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
                            let rep: *mut AnyObject =
                                msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
                            if rep.is_null() {
                                return None;
                            }
                            let properties: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
                            // NSBitmapImageFileTypePNG
                            let data: *mut AnyObject = msg_send![rep, representationUsingType: 4usize, properties: properties];
                            if data.is_null() {
                                return None;
                            }
                            let length: usize = msg_send![data, length];
                            let bytes: *const u8 = msg_send![data, bytes];
                            Some(std::slice::from_raw_parts(bytes, length).to_vec())
                        })
                        .flatten()
                };
                *slot.borrow_mut() = Some(bytes);
            });
            let view = state.view.webview();
            let view: *const AnyObject = objc2::rc::Retained::as_ptr(&view).cast();
            // SAFETY: a live WKWebView on the main thread; a nil
            // configuration snapshots its visible bounds.
            unsafe {
                let _: () = msg_send![view, takeSnapshotWithConfiguration: std::ptr::null::<AnyObject>(), completionHandler: &*handler];
            }
            Snapshot {
                bounds: state.bounds.get(),
                png,
            }
        })
        .collect()
}

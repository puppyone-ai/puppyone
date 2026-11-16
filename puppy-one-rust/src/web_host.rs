//! Native web content hosts (`wry` child WebViews) for viewers; the
//! protocol, path policy and MIME table live in `platform::webview`.
#![cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
use crate::platform::webview::{
    Content, ENTRY_ORIGIN, LOCAL_SCHEME, PreparedContent, ProtocolResponse, SCHEME, entry_url,
    respond_request,
};
use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    rc::{Rc, Weak},
};
#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
#[path = "web_host/protocol_tests.rs"]
mod protocol_tests;

/// Floating surfaces cut out of a view, in its own coordinates
/// (`x, y, w, h, radius`), and the size they were cut from.
#[derive(Default, PartialEq)]
struct Cut {
    holes: Vec<[f32; 5]>,
    size: (f32, f32),
}
/// Shared visibility state of one host (main thread only).
struct HostState {
    resources: PreparedContent,
    window: u64,
    painted: Cell<bool>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    view: wry::WebView,
    visible: Cell<bool>,
    bounds: Cell<(f32, f32, f32, f32)>,
    /// The floating surfaces cut out of the view.
    cutouts: RefCell<Cut>,
    /// The clipping view a host inside scrolling content sits in
    /// (`place_clipped`); it, not the WebView, shows and hides.
    #[cfg(target_os = "macos")]
    clip: RefCell<Option<objc2::rc::Retained<objc2::runtime::AnyObject>>>,
    /// The part of the view the clipping view shows (window coordinates).
    #[cfg(target_os = "macos")]
    shown: Cell<(f32, f32, f32, f32)>,
}
impl HostState {
    /// The window rectangle the view shows in: the clipping view's when it
    /// has one.
    fn showing(&self) -> (f32, f32, f32, f32) {
        #[cfg(target_os = "macos")]
        if self.clip.borrow().is_some() {
            return self.shown.get();
        }
        self.bounds.get()
    }
    /// Cuts `cutouts` (window coordinates) out of the view where they
    /// cross it: floating surfaces over the page show through. `false`
    /// where the platform cannot cut and one crosses it: the view hides.
    fn cut(&self, cutouts: &[crate::ui::native_cover::Cutout]) -> bool {
        let (x, y, w, h) = self.showing();
        let local: Vec<[f32; 5]> = cutouts
            .iter()
            .filter_map(|c| {
                let cx = f32::from(c.bounds.origin.x).max(x);
                let cy = f32::from(c.bounds.origin.y).max(y);
                let right = f32::from(c.bounds.origin.x + c.bounds.size.width).min(x + w);
                let bottom = f32::from(c.bounds.origin.y + c.bounds.size.height).min(y + h);
                (right - cx >= 1. && bottom - cy >= 1.).then(|| {
                    // A shape the view's edge crops keeps its own corners.
                    [
                        f32::from(c.bounds.origin.x) - x,
                        f32::from(c.bounds.origin.y) - y,
                        f32::from(c.bounds.size.width),
                        f32::from(c.bounds.size.height),
                        c.radius,
                    ]
                })
            })
            .collect();
        if !cfg!(target_os = "macos") {
            return local.is_empty();
        }
        let mut applied = self.cutouts.borrow_mut();
        if applied.holes == local && (local.is_empty() || applied.size == (w, h)) {
            return true;
        }
        *applied = Cut {
            holes: local,
            size: (w, h),
        };
        #[cfg(target_os = "macos")]
        self.mask(&applied.holes, applied.size);
        true
    }
    /// The view's layer mask: its whole rectangle less `holes`
    /// (top-left origin), or none.
    #[cfg(target_os = "macos")]
    fn mask(&self, holes: &[[f32; 5]], (w, h): (f32, f32)) {
        use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
        use wry::WebViewExtMacOS;
        let web = self.view.webview();
        let target: *mut AnyObject = match self.clip.borrow().as_ref() {
            Some(clip) => Retained::as_ptr(clip).cast_mut(),
            None => Retained::as_ptr(&web).cast_mut().cast(),
        };
        // SAFETY: a live, layer-backed AppKit view on the main thread; the
        // path is released once the shape layer has copied it.
        unsafe {
            let _: () = msg_send![target, setWantsLayer: true];
            let layer: *mut AnyObject = msg_send![target, layer];
            if layer.is_null() {
                return;
            }
            let _: () = msg_send![class!(CATransaction), begin];
            let _: () = msg_send![class!(CATransaction), setDisableActions: true];
            if holes.is_empty() {
                let none: *mut AnyObject = std::ptr::null_mut();
                let _: () = msg_send![layer, setMask: none];
            } else {
                let flipped: bool = msg_send![layer, contentsAreFlipped];
                let path = cg::CGPathCreateMutable();
                let whole = CgRect {
                    x: 0.,
                    y: 0.,
                    width: w as f64,
                    height: h as f64,
                };
                cg::CGPathAddRect(path, std::ptr::null(), whole);
                for &[x, y, hw, hh, r] in holes {
                    let top = if flipped { y } else { h - y - hh };
                    let r = r.clamp(0., (hw.min(hh) / 2. - 0.5).max(0.)) as f64;
                    let rect = CgRect {
                        x: x as f64,
                        y: top as f64,
                        width: hw as f64,
                        height: hh as f64,
                    };
                    cg::CGPathAddRoundedRect(path, std::ptr::null(), rect, r, r);
                }
                let mask: *mut AnyObject = msg_send![class!(CAShapeLayer), layer];
                let _: () = msg_send![mask, setFrame: whole];
                let _: () = msg_send![mask, setPath: path.cast_const()];
                let rule: *mut AnyObject = msg_send![
                    class!(NSString),
                    stringWithUTF8String: c"even-odd".as_ptr()
                ];
                let _: () = msg_send![mask, setFillRule: rule];
                let _: () = msg_send![layer, setMask: mask];
                cg::CGPathRelease(path);
            }
            let _: () = msg_send![class!(CATransaction), commit];
        }
    }
    fn set_visible(&self, show: bool) {
        #[cfg(target_os = "macos")]
        if let Some(clip) = self.clip.borrow().as_ref() {
            // SAFETY: a live NSView on the main thread.
            unsafe {
                let _: () = objc2::msg_send![&**clip, setHidden: !show];
            }
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let _ = self.view.set_visible(show);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = show;
    }
}
impl Drop for HostState {
    fn drop(&mut self) {
        self.resources.revoke();
        #[cfg(target_os = "macos")]
        if let Some(clip) = self.clip.borrow_mut().take() {
            // SAFETY: a live NSView on the main thread.
            unsafe {
                let _: () = objc2::msg_send![&*clip, removeFromSuperview];
            }
        }
    }
}
/// CGRect's layout and Objective-C encoding.
#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct CgRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
// SAFETY: the same layout as CGRect.
#[cfg(target_os = "macos")]
unsafe impl objc2::Encode for CgRect {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct(
        "CGRect",
        &[
            objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]),
            objc2::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]),
        ],
    );
}
/// The CoreGraphics path calls a layer mask is drawn with.
#[cfg(target_os = "macos")]
mod cg {
    use super::CgRect;
    /// `CGPath`, opaque.
    #[repr(C)]
    pub struct CgPath {
        _private: [u8; 0],
    }
    // SAFETY: `CGPathRef` is a pointer to the opaque `CGPath` struct.
    unsafe impl objc2::RefEncode for CgPath {
        const ENCODING_REF: objc2::Encoding =
            objc2::Encoding::Pointer(&objc2::Encoding::Struct("CGPath", &[]));
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        pub fn CGPathCreateMutable() -> *mut CgPath;
        pub fn CGPathAddRect(path: *mut CgPath, transform: *const std::ffi::c_void, rect: CgRect);
        pub fn CGPathAddRoundedRect(
            path: *mut CgPath,
            transform: *const std::ffi::c_void,
            rect: CgRect,
            corner_width: f64,
            corner_height: f64,
        );
        pub fn CGPathRelease(path: *mut CgPath);
    }
}
thread_local! {
    static HOSTS: RefCell<Vec<Weak<HostState>>> = const { RefCell::new(Vec::new()) };
    static OVERLAY: RefCell<std::collections::HashMap<u64, bool>> = RefCell::new(Default::default());
    static SCHEDULED: RefCell<std::collections::HashSet<u64>> = RefCell::new(Default::default());
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
        let served = content.clone().prepare();
        let local = served.clone();
        let resources = served.clone();
        #[cfg(target_os = "macos")]
        let _ = dark;
        let frames = content.frames.clone();
        let locked = content.locked;
        let mut builder = wry::WebViewBuilder::new();
        if let Some(ipc) = content.ipc.clone() {
            builder = builder.with_ipc_handler(move |request: wry::http::Request<String>| {
                let url = request.uri().to_string();
                ipc.accept(&url, request.into_body());
            });
        }
        #[cfg(target_os = "windows")]
        {
            let background = if dark {
                (24, 24, 27, 255)
            } else {
                (255, 255, 255, 255)
            };
            builder = builder.with_background_color(background);
        }
        let view = builder
            .with_url(entry_url())
            .with_incognito(true)
            .with_devtools(false)
            .with_clipboard(true)
            .with_visible(false)
            // Resources are read off the main thread: a folder read or a
            // Cloud provider request never stalls drawing.
            .with_asynchronous_custom_protocol(SCHEME.into(), move |_, request, responder| {
                let served = served.clone();
                std::thread::spawn(move || {
                    responder.respond(protocol_response(&served, false, &request));
                });
            })
            .with_asynchronous_custom_protocol(LOCAL_SCHEME.into(), move |_, request, responder| {
                let served = local.clone();
                std::thread::spawn(move || {
                    responder.respond(protocol_response(&served, true, &request));
                });
            })
            // OS file drags over web content never load the file into the
            // page (`acquireNativeSurfaceOcclusionLease` keeps them for the
            // pane in the product): the view takes no drags (below), and
            // swallows any it is still handed.
            .with_drag_drop_handler(|_| true)
            .with_navigation_handler(move |url| {
                // A locked page stays its entry document (its fragments
                // only move within it) or its frames' origins, and hands
                // nothing to the browser.
                if locked {
                    let entry = entry_url();
                    return url == entry
                        || url.strip_prefix(&entry).is_some_and(|r| r.starts_with('#'))
                        || url == "about:blank"
                        || frames.as_ref().is_some_and(|frames| frames.allows(&url));
                }
                // `about:srcdoc` is inline content the page already holds
                // (the HTML visual editor's sandboxed projection frame).
                if url.starts_with(SCHEME) || url == "about:blank" || url == "about:srcdoc" {
                    return true;
                }
                if frames.as_ref().is_some_and(|frames| frames.allows(&url)) {
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
        #[cfg(target_os = "macos")]
        {
            use objc2::{msg_send, rc::Retained, runtime::AnyObject};
            use wry::WebViewExtMacOS;
            let web = view.webview();
            let web: *mut AnyObject = Retained::as_ptr(&web).cast_mut().cast();
            // SAFETY: the live WebView, on the main thread. Unregistered, it
            // is no drag destination: AppKit hands a drag over it to the
            // window's own view, whose panes take it.
            unsafe {
                let _: () = msg_send![web, unregisterDraggedTypes];
            }
            // Dev captures run behind every other window: WebKit would stop
            // drawing an occluded page, and the screenshot would show none.
            #[cfg(feature = "dev-capture")]
            // SAFETY: as above; the private setter is called only where
            // WebKit answers to it.
            unsafe {
                let selector = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
                let answers: bool = msg_send![web, respondsToSelector: selector];
                if answers {
                    let _: () = msg_send![web, _setWindowOcclusionDetectionEnabled: false];
                }
            }
        }
        let state = Rc::new(HostState {
            resources,
            window: window_key(window),
            painted: Cell::new(false),
            view,
            visible: Cell::new(false),
            bounds: Cell::new((0., 0., 0., 0.)),
            cutouts: RefCell::new(Cut::default()),
            #[cfg(target_os = "macos")]
            clip: RefCell::new(None),
            #[cfg(target_os = "macos")]
            shown: Cell::new((0., 0., 0., 0.)),
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
    /// Called from the element's paint inside scrolling content: place the
    /// view over `bounds`, showing only its part within `clip` (the
    /// content mask), with `radius` corners while it shows whole. Nothing
    /// within `clip`, and the view hides.
    pub fn place_clipped(
        &self,
        bounds: gpui::Bounds<gpui::Pixels>,
        clip: gpui::Bounds<gpui::Pixels>,
        radius: f32,
    ) {
        let visible = bounds.intersect(&clip);
        if f32::from(visible.size.width) < 1. || f32::from(visible.size.height) < 1. {
            return;
        }
        self.state.painted.set(true);
        let rect = |b: gpui::Bounds<gpui::Pixels>| {
            (
                f32::from(b.origin.x),
                f32::from(b.origin.y),
                f32::from(b.size.width),
                f32::from(b.size.height),
            )
        };
        #[cfg(target_os = "macos")]
        self.clip_to(
            rect(bounds),
            rect(visible),
            if visible == bounds { radius } else { 0. },
        );
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (rect, radius);
            self.place(bounds);
        }
    }
    #[cfg(target_os = "macos")]
    fn clip_to(&self, view: (f32, f32, f32, f32), shown: (f32, f32, f32, f32), radius: f32) {
        use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
        use wry::WebViewExtMacOS;
        self.state.bounds.set(view);
        self.state.shown.set(shown);
        let web = self.state.view.webview();
        let web: *mut AnyObject = Retained::as_ptr(&web).cast_mut().cast();
        let mut slot = self.state.clip.borrow_mut();
        // SAFETY: live AppKit views on the main thread; the WebView moves
        // into a plain layer-backed NSView that clips its subviews.
        unsafe {
            if slot.is_none() {
                let parent: *mut AnyObject = msg_send![web, superview];
                if parent.is_null() {
                    return;
                }
                let clip: Retained<AnyObject> = msg_send![class!(NSView), new];
                let _: () = msg_send![&*clip, setWantsLayer: true];
                let layer: *mut AnyObject = msg_send![&*clip, layer];
                let _: () = msg_send![layer, setMasksToBounds: true];
                let _: () = msg_send![&*clip, setHidden: !self.state.visible.get()];
                let _: () = msg_send![parent, addSubview: &*clip];
                let _: () = msg_send![&*clip, addSubview: web];
                let _: () = msg_send![web, setHidden: false];
                *slot = Some(clip);
            }
            let Some(clip) = slot.as_ref() else { return };
            let parent: *mut AnyObject = msg_send![&**clip, superview];
            if parent.is_null() {
                return;
            }
            let flipped: bool = msg_send![parent, isFlipped];
            let outer: CgRect = msg_send![parent, bounds];
            let (x, y, w, h) = shown;
            let top = if flipped {
                y as f64
            } else {
                outer.height - (y + h) as f64
            };
            let _: () = msg_send![&**clip, setFrame: CgRect {
                x: x as f64,
                y: top,
                width: w as f64,
                height: h as f64,
            }];
            // The clip view is not flipped: its origin is bottom-left.
            let (vx, vy, vw, vh) = view;
            let _: () = msg_send![web, setFrame: CgRect {
                x: (vx - x) as f64,
                y: (h - (vy - y) - vh) as f64,
                width: vw as f64,
                height: vh as f64,
            }];
            let layer: *mut AnyObject = msg_send![&**clip, layer];
            let _: () = msg_send![layer, setCornerRadius: radius as f64];
        }
    }
    /// Whether the view showed after the window's last drawn frame.
    pub fn is_visible(&self) -> bool {
        self.state.visible.get()
    }
    pub fn reload(&self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let _ = self.state.view.load_url(&entry_url());
    }
    /// Runs trusted host script in the entry document (a message to the
    /// page's own receiver; never document content).
    /// A host that never paints (the render service's page) laid out at
    /// `width` × `height` logical pixels; it stays hidden.
    #[cfg(target_os = "macos")]
    pub fn resize_hidden(&self, width: f32, height: f32) {
        let _ = self.state.view.set_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0., 0.).into(),
            size: wry::dpi::LogicalSize::new(width.max(1.), height.max(1.)).into(),
        });
    }
    /// `takeSnapshotWithConfiguration`: the page's `rect` (logical pixels)
    /// drawn `width` logical pixels wide at the window's backing scale, as
    /// PNG. WebKit draws a hidden view's snapshot as well, after its next
    /// layout. `done` runs on the main thread.
    #[cfg(target_os = "macos")]
    pub fn snapshot(
        &self,
        rect: (f32, f32, f32, f32),
        width: f32,
        done: impl FnOnce(Option<Vec<u8>>) + 'static,
    ) {
        use objc2::{class, msg_send, runtime::AnyObject};
        use wry::WebViewExtMacOS;
        let done = RefCell::new(Some(done));
        let handler = block2::RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
            // SAFETY: WebKit hands back an NSImage (or nil) on the main
            // thread; every object is used only inside this call.
            let png = unsafe {
                (!image.is_null())
                    .then(|| {
                        let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
                        let rep: *mut AnyObject =
                            msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
                        if rep.is_null() {
                            return None;
                        }
                        let properties: *mut AnyObject =
                            msg_send![class!(NSDictionary), dictionary];
                        // NSBitmapImageFileTypePNG
                        let data: *mut AnyObject =
                            msg_send![rep, representationUsingType: 4usize, properties: properties];
                        if data.is_null() {
                            return None;
                        }
                        let length: usize = msg_send![data, length];
                        let bytes: *const u8 = msg_send![data, bytes];
                        Some(std::slice::from_raw_parts(bytes, length).to_vec())
                    })
                    .flatten()
            };
            if let Some(done) = done.borrow_mut().take() {
                done(png);
            }
        });
        let view = self.state.view.webview();
        let view: *const AnyObject = objc2::rc::Retained::as_ptr(&view).cast();
        let (x, y, w, h) = rect;
        // SAFETY: a live WKWebView and a fresh configuration on the main thread.
        unsafe {
            let configuration: *mut AnyObject = msg_send![class!(WKSnapshotConfiguration), new];
            let _: () = msg_send![configuration, setRect: CgRect {
                x: x as f64,
                y: y as f64,
                width: w as f64,
                height: h as f64,
            }];
            let number: *mut AnyObject =
                msg_send![class!(NSNumber), numberWithDouble: width as f64];
            let _: () = msg_send![configuration, setSnapshotWidth: number];
            let _: () = msg_send![configuration, setAfterScreenUpdates: true];
            let _: () = msg_send![view, takeSnapshotWithConfiguration: configuration, completionHandler: &*handler];
            let _: () = msg_send![configuration, release];
        }
    }
    #[cfg(not(target_os = "macos"))]
    pub fn resize_hidden(&self, _width: f32, _height: f32) {}
    #[cfg(not(target_os = "macos"))]
    pub fn snapshot(
        &self,
        _rect: (f32, f32, f32, f32),
        _width: f32,
        done: impl FnOnce(Option<Vec<u8>>) + 'static,
    ) {
        done(None);
    }
    pub fn evaluate(&self, script: &str) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let _ = self.state.view.evaluate_script(script);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = script;
    }
    /// Captures the live WebView viewport as Retina PNG bytes on the main
    /// thread, optionally cropping to `crop` (`(x, y, w, h)` in CSS viewport
    /// pixels over `viewport` `(vw, vh)`).
    pub fn capture_png(
        &self,
        crop: Option<(f32, f32, f32, f32)>,
        viewport: Option<(f32, f32)>,
        done: impl FnOnce(Option<Vec<u8>>) + 'static,
    ) {
        #[cfg(target_os = "macos")]
        {
            use objc2::{msg_send, runtime::AnyObject};
            use wry::WebViewExtMacOS;
            let (_, _, bw, bh) = self.state.bounds.get();
            let vp = viewport.unwrap_or((bw.max(1.), bh.max(1.)));
            type SnapshotCallback = Box<dyn FnOnce(Option<Vec<u8>>)>;
            let callback: Rc<RefCell<Option<SnapshotCallback>>> =
                Rc::new(RefCell::new(Some(Box::new(done))));
            let slot = callback.clone();
            let handler =
                block2::RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
                    let mut bytes = unsafe { nsimage_to_png(image) };
                    if let (Some(raw), Some(rect)) = (&bytes, crop) {
                        bytes = crop_png_bytes(raw, rect, vp).or(bytes);
                    }
                    if let Some(cb) = slot.borrow_mut().take() {
                        cb(bytes);
                    }
                });
            let view = self.state.view.webview();
            let view: *const AnyObject = objc2::rc::Retained::as_ptr(&view).cast();
            // SAFETY: a live WKWebView on the main thread; nil configuration
            // snapshots its visible bounds at backing-store scale.
            unsafe {
                let _: () = msg_send![
                    view,
                    takeSnapshotWithConfiguration: std::ptr::null::<AnyObject>(),
                    completionHandler: &*handler
                ];
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (crop, viewport);
            done(None);
        }
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
    let first = SCHEDULED.with(|s| s.borrow_mut().insert(key));
    if first {
        // A new frame: its floating surfaces report afresh.
        crate::ui::native_cover::take(key);
        window.on_next_frame(move |_, _| {
            SCHEDULED.with(|s| s.borrow_mut().remove(&key));
            reconcile(key);
        });
    }
}
fn reconcile(key: u64) {
    let overlay = OVERLAY.with(|o| o.borrow().get(&key).copied().unwrap_or(false));
    let cutouts = crate::ui::native_cover::take(key);
    HOSTS.with(|h| {
        for state in h.borrow().iter().filter_map(Weak::upgrade) {
            if state.window != key {
                continue;
            }
            let show = state.painted.replace(false) && !overlay && state.cut(&cutouts);
            if state.visible.get() != show {
                state.visible.set(show);
                state.set_visible(show);
            }
        }
    });
}

/// Shared by the two Wry handlers, so method/origin/range checks cannot drift.
fn protocol_response(
    content: &PreparedContent,
    local: bool,
    request: &wry::http::Request<Vec<u8>>,
) -> wry::http::Response<Cow<'static, [u8]>> {
    let header = |name| {
        let mut values = request.headers().get_all(name).iter();
        let first = values.next()?;
        Some(if values.next().is_some() {
            "\0"
        } else {
            first.to_str().unwrap_or("\0")
        })
    };
    let reply = respond_request(
        content,
        local,
        request.method().as_str(),
        &request.uri().to_string(),
        header("origin"),
        header("range"),
    );
    response(reply, content.policy)
}

fn response(
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

/// Converts a WebKit snapshot `NSImage` pointer to PNG bytes.
///
/// # Safety
/// `image` must be either null or a valid `NSImage` instance on the main thread.
#[cfg(target_os = "macos")]
unsafe fn nsimage_to_png(image: *mut objc2::runtime::AnyObject) -> Option<Vec<u8>> {
    use objc2::{class, msg_send, runtime::AnyObject};
    if image.is_null() {
        return None;
    }
    unsafe {
        let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
        if tiff.is_null() {
            return None;
        }
        let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
        if rep.is_null() {
            return None;
        }
        let properties: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
        // NSBitmapImageFileTypePNG
        let data: *mut AnyObject =
            msg_send![rep, representationUsingType: 4usize, properties: properties];
        if data.is_null() {
            return None;
        }
        let length: usize = msg_send![data, length];
        let bytes: *const u8 = msg_send![data, bytes];
        Some(std::slice::from_raw_parts(bytes, length).to_vec())
    }
}

/// Crops `png` to logical CSS rectangle `crop` `(x, y, w, h)` within `viewport` `(vw, vh)`,
/// preserving Retina backing-store resolution.
pub fn crop_png_bytes(
    png: &[u8],
    crop: (f32, f32, f32, f32),
    viewport: (f32, f32),
) -> Option<Vec<u8>> {
    let decoded = image::load_from_memory(png).ok()?;
    let (img_w, img_h) = (decoded.width(), decoded.height());
    if img_w == 0 || img_h == 0 {
        return None;
    }
    let scale_x = img_w as f32 / viewport.0.max(1.);
    let scale_y = img_h as f32 / viewport.1.max(1.);
    let x = (crop.0.max(0.) * scale_x).round() as u32;
    let y = (crop.1.max(0.) * scale_y).round() as u32;
    if x >= img_w || y >= img_h {
        return None;
    }
    let w = ((crop.2.max(1.) * scale_x).round() as u32)
        .max(1)
        .min(img_w - x);
    let h = ((crop.3.max(1.) * scale_y).round() as u32)
        .max(1)
        .min(img_h - y);
    let sub = decoded.crop_imm(x, y, w, h);
    let mut out = std::io::Cursor::new(Vec::new());
    sub.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// Vertically stitches viewport PNG slices `(scroll_y, png_bytes)` into one
/// full-page Retina PNG of `total_logical_h` over `viewport_h`.
pub fn stitch_png_slices(
    slices: &[(f32, Vec<u8>)],
    total_logical_h: f32,
    viewport_h: f32,
) -> Option<Vec<u8>> {
    let first = image::load_from_memory(&slices.first()?.1).ok()?.to_rgba8();
    let (slice_w, slice_h) = (first.width(), first.height());
    if slice_w == 0 || slice_h == 0 {
        return None;
    }
    if slices.len() == 1 && total_logical_h <= viewport_h + 1. {
        return Some(slices[0].1.clone());
    }
    let scale_y = slice_h as f32 / viewport_h.max(1.);
    let out_h = ((total_logical_h.max(viewport_h) * scale_y).round() as u32)
        .max(slice_h)
        .min(slice_h.saturating_mul(8));
    let mut canvas = image::RgbaImage::new(slice_w, out_h);
    for (scroll_y, raw) in slices {
        let Ok(img) = image::load_from_memory(raw) else {
            continue;
        };
        let rgba = img.to_rgba8();
        let dest_y = ((*scroll_y).max(0.) * scale_y).round() as u32;
        for py in 0..rgba.height() {
            let cy = dest_y.saturating_add(py);
            if cy >= out_h {
                break;
            }
            for px in 0..rgba.width().min(slice_w) {
                canvas.put_pixel(px, cy, *rgba.get_pixel(px, py));
            }
        }
    }
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(canvas)
        .write_to(&mut out, image::ImageFormat::Png)
        .ok()?;
    Some(out.into_inner())
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
    use objc2::{msg_send, runtime::AnyObject};
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
                let bytes = unsafe { nsimage_to_png(image) };
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn sample_png(w: u32, h: u32, r: u8, g: u8, b: u8) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([r, g, b, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn crop_and_stitch_preserve_retina_scale() {
        let retina = sample_png(800, 600, 69, 153, 223);
        let cropped = crop_png_bytes(&retina, (50., 40., 120., 80.), (400., 300.)).unwrap();
        let decoded = image::load_from_memory(&cropped).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (240, 160));

        let top = sample_png(400, 300, 20, 30, 40);
        let bottom = sample_png(400, 300, 200, 100, 50);
        let stitched = stitch_png_slices(&[(0., top), (150., bottom)], 450., 300.).unwrap();
        let full = image::load_from_memory(&stitched).unwrap().to_rgba8();
        assert_eq!((full.width(), full.height()), (400, 450));
        assert_eq!(full.get_pixel(10, 10).0, [20, 30, 40, 255]);
        assert_eq!(full.get_pixel(10, 440).0, [200, 100, 50, 255]);
    }
}

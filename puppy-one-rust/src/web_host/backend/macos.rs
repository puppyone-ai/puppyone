//! macOS WKWebView backend (`wry` + `objc2` streaming scheme handler,
//! `CAShapeLayer` floating-surface cutouts, `PuppyOneWebContentClip` hit-test
//! view, and `WKSnapshotConfiguration` capture).
use super::{allow_navigation, macos_stream};
use crate::{
    platform::webview::{Content, PreparedContent, entry_url},
    web_host::{crop_png_bytes, in_holes},
};
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ClassBuilder, Sel},
};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};
use wry::{WebViewBuilderExtMacos, WebViewExtMacOS};

pub(super) const SUPPORTED: bool = true;

thread_local! {
    /// Where each clipping view lets the pointer through (`x, y, w, h` from
    /// its top-left), by [`clip_key`].
    static HOLES: RefCell<HashMap<usize, Vec<[f32; 4]>>> = RefCell::new(Default::default());
}

pub(super) struct BackendHost {
    pub(super) view: wry::WebView,
    resources: PreparedContent,
    pub(super) protocol: macos_stream::Owner,
    clip: RefCell<Option<Retained<AnyObject>>>,
    shown: Cell<(f32, f32, f32, f32)>,
    bounds: Cell<(f32, f32, f32, f32)>,
    visible: Cell<bool>,
}

impl std::ops::Deref for BackendHost {
    type Target = wry::WebView;
    fn deref(&self) -> &Self::Target {
        &self.view
    }
}

impl Drop for BackendHost {
    fn drop(&mut self) {
        self.yield_focus_to_window();
        if let Some(clip) = self.clip.borrow_mut().take() {
            HOLES.with(|all| all.borrow_mut().remove(&clip_key(&clip)));
            // SAFETY: a live NSView on the main thread.
            unsafe {
                let _: () = msg_send![&*clip, removeFromSuperview];
            }
        }
        self.resources.revoke();
        self.protocol.retire();
    }
}

impl BackendHost {
    pub(super) fn build(
        window: &impl raw_window_handle::HasWindowHandle,
        content: Content,
        _dark: bool,
    ) -> Result<Self, String> {
        let served = content.clone().prepare();
        let resources = served.clone();
        let frames = content.frames.clone();
        let locked = content.locked;
        let mut builder = wry::WebViewBuilder::new();
        if let Some(ipc) = content.ipc.clone() {
            builder = builder.with_ipc_handler(move |request: wry::http::Request<String>| {
                let url = request.uri().to_string();
                ipc.accept(&url, request.into_body());
            });
        }
        let (configuration, protocol) = macos_stream::configuration(served)?;
        builder = builder.with_webview_configuration(configuration);
        let view = builder
            .with_url(entry_url())
            .with_incognito(true)
            .with_devtools(false)
            .with_clipboard(true)
            .with_visible(false)
            .with_drag_drop_handler(|_| true)
            .with_navigation_handler(move |url| allow_navigation(&url, locked, &frames))
            .with_new_window_req_handler(|url, _| {
                if url.starts_with("https://") || url.starts_with("http://") {
                    let _ = crate::platform::desktop::open_url(&url);
                }
                wry::NewWindowResponse::Deny
            })
            .build_as_child(window)
            .map_err(|e| e.to_string())?;

        let web = view.webview();
        let web_ptr: *mut AnyObject = Retained::as_ptr(&web).cast_mut().cast();
        // SAFETY: live WKWebView on the main thread. Unregister drag types so
        // AppKit routes OS file drags to the GPUI window pane underneath.
        unsafe {
            let _: () = msg_send![web_ptr, unregisterDraggedTypes];
        }
        #[cfg(feature = "dev-capture")]
        unsafe {
            let selector = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
            let answers: bool = msg_send![web_ptr, respondsToSelector: selector];
            if answers {
                let _: () = msg_send![web_ptr, _setWindowOcclusionDetectionEnabled: false];
            }
        }

        Ok(Self {
            view,
            resources,
            protocol,
            clip: RefCell::new(None),
            shown: Cell::new((0., 0., 0., 0.)),
            bounds: Cell::new((0., 0., 0., 0.)),
            visible: Cell::new(false),
        })
    }

    pub(super) fn webview_ptr(&self) -> *mut AnyObject {
        let web = self.view.webview();
        Retained::as_ptr(&web).cast_mut().cast()
    }

    pub(super) fn yield_focus_to_window(&self) {
        let web = self.webview_ptr();
        // SAFETY: `web` is a live `WKWebView` on the main thread.
        unsafe {
            let ns_window: *mut AnyObject = msg_send![web, window];
            if ns_window.is_null() {
                return;
            }
            let responder: *mut AnyObject = msg_send![ns_window, firstResponder];
            if responder.is_null() {
                return;
            }
            let is_view: bool = msg_send![responder, isKindOfClass: class!(NSView)];
            if !is_view {
                return;
            }
            let inside: bool = msg_send![responder, isDescendantOf: web];
            if inside {
                let target: *mut AnyObject = match self.clip.borrow().as_ref() {
                    Some(clip) => msg_send![&**clip, superview],
                    None => msg_send![web, superview],
                };
                if !target.is_null() {
                    let _: bool = msg_send![ns_window, makeFirstResponder: target];
                }
            }
        }
    }

    pub(super) fn place(&self, bounds: (f32, f32, f32, f32)) {
        self.clip_to(bounds, bounds, 0.);
    }

    pub(super) fn place_clipped(
        &self,
        bounds: (f32, f32, f32, f32),
        visible: (f32, f32, f32, f32),
        radius: f32,
    ) {
        self.clip_to(bounds, visible, radius);
    }

    pub(super) fn showing_rect(&self, fallback: (f32, f32, f32, f32)) -> (f32, f32, f32, f32) {
        if self.clip.borrow().is_some() {
            self.shown.get()
        } else {
            fallback
        }
    }

    pub(super) fn set_visible(&self, show: bool) {
        self.visible.set(show);
        if let Some(clip) = self.clip.borrow().as_ref() {
            // SAFETY: a live NSView on the main thread.
            unsafe {
                let _: () = msg_send![&**clip, setHidden: !show];
            }
            return;
        }
        let _ = self.view.set_visible(show);
    }

    pub(super) fn apply_cutouts(&self, holes: &[[f32; 5]], size: (f32, f32)) -> bool {
        self.mask(holes, size);
        self.let_through(holes);
        true
    }

    pub(super) fn reload(&self) {
        let _ = self.view.load_url(&entry_url());
    }

    pub(super) fn evaluate(&self, script: &str) {
        let _ = self.view.evaluate_script(script);
    }

    pub(super) fn resize_hidden(&self, width: f32, height: f32) {
        let _ = self.view.set_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0., 0.).into(),
            size: wry::dpi::LogicalSize::new(width.max(1.), height.max(1.)).into(),
        });
    }

    pub(super) fn has_native_capture(&self) -> bool {
        true
    }

    pub(super) fn snapshot(
        &self,
        rect: (f32, f32, f32, f32),
        width: f32,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        let view: *const AnyObject = self.webview_ptr().cast();
        let done = RefCell::new(Some(done));
        let handler = block2::RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
            let png = unsafe { nsimage_to_png(image) };
            if let Some(done) = done.borrow_mut().take() {
                done(png);
            }
        });
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

    pub(super) fn capture_png(
        &self,
        crop: Option<(f32, f32, f32, f32)>,
        viewport: Option<(f32, f32)>,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        let view: *const AnyObject = self.webview_ptr().cast();
        let (_, _, bw, bh) = self.bounds.get();
        let vp = viewport.unwrap_or((bw.max(1.), bh.max(1.)));
        let callback: Rc<RefCell<Option<Box<dyn FnOnce(Option<Vec<u8>>)>>>> =
            Rc::new(RefCell::new(Some(done)));
        let slot = callback.clone();
        let handler = block2::RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
            let mut bytes = unsafe { nsimage_to_png(image) };
            if let (Some(raw), Some(rect)) = (&bytes, crop) {
                bytes = crop_png_bytes(raw, rect, vp).or(bytes);
            }
            if let Some(cb) = slot.borrow_mut().take() {
                cb(bytes);
            }
        });
        // SAFETY: a live WKWebView on the main thread.
        unsafe {
            let _: () = msg_send![
                view,
                takeSnapshotWithConfiguration: std::ptr::null::<AnyObject>(),
                completionHandler: &*handler
            ];
        }
    }

    fn let_through(&self, holes: &[[f32; 5]]) {
        let Some(clip) = self.clip.borrow().as_ref().map(clip_key) else {
            return;
        };
        let holes: Vec<[f32; 4]> = holes.iter().map(|&[x, y, w, h, _]| [x, y, w, h]).collect();
        HOLES.with(|all| {
            let mut all = all.borrow_mut();
            if holes.is_empty() {
                all.remove(&clip);
            } else {
                all.insert(clip, holes);
            }
        });
    }

    fn mask(&self, holes: &[[f32; 5]], (w, h): (f32, f32)) {
        let web = self.webview_ptr();
        let target: *mut AnyObject = match self.clip.borrow().as_ref() {
            Some(clip) => Retained::as_ptr(clip).cast_mut(),
            None => web,
        };
        // SAFETY: a live, layer-backed AppKit view on the main thread.
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

    fn clip_to(&self, view: (f32, f32, f32, f32), shown: (f32, f32, f32, f32), radius: f32) {
        self.bounds.set(view);
        self.shown.set(shown);
        let web = self.webview_ptr();
        let mut slot = self.clip.borrow_mut();
        // SAFETY: live AppKit views on the main thread.
        unsafe {
            if slot.is_none() {
                let parent: *mut AnyObject = msg_send![web, superview];
                if parent.is_null() {
                    return;
                }
                let clip: Retained<AnyObject> = msg_send![clip_class(), new];
                let _: () = msg_send![&*clip, setWantsLayer: true];
                let layer: *mut AnyObject = msg_send![&*clip, layer];
                let _: () = msg_send![layer, setMasksToBounds: true];
                let _: () = msg_send![&*clip, setHidden: !self.visible.get()];
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
}

fn clip_key(clip: &Retained<AnyObject>) -> usize {
    Retained::as_ptr(clip) as usize
}

pub(crate) fn clip_class() -> &'static AnyClass {
    const NAME: &std::ffi::CStr = c"PuppyOneWebContentClip";
    if let Some(class) = AnyClass::get(NAME) {
        return class;
    }
    unsafe extern "C-unwind" fn hit_test(
        this: &AnyObject,
        _: Sel,
        point: CgPoint,
    ) -> *mut AnyObject {
        // SAFETY: AppKit hit-tests on the main thread, `point` in superview coordinates.
        unsafe {
            let superview: *mut AnyObject = msg_send![this, superview];
            let local: CgPoint = msg_send![this, convertPoint: point, fromView: superview];
            let bounds: CgRect = msg_send![this, bounds];
            let (x, y) = (local.x as f32, (bounds.height - local.y) as f32);
            let key = std::ptr::from_ref(this) as usize;
            let through =
                HOLES.with(|all| all.borrow().get(&key).is_some_and(|h| in_holes(h, x, y)));
            if through {
                return std::ptr::null_mut();
            }
            msg_send![super(this, class!(NSView)), hitTest: point]
        }
    }
    let mut builder = ClassBuilder::new(NAME, class!(NSView))
        .expect("the clipping view's class is registered once");
    // SAFETY: the signature of `-[NSView hitTest:]`.
    unsafe {
        builder.add_method(
            objc2::sel!(hitTest:),
            hit_test as unsafe extern "C-unwind" fn(_, _, _) -> _,
        );
    }
    builder.register()
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct CgPoint {
    x: f64,
    y: f64,
}
// SAFETY: identical layout to CGPoint.
unsafe impl objc2::Encode for CgPoint {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct CgRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
// SAFETY: identical layout to CGRect.
unsafe impl objc2::Encode for CgRect {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct(
        "CGRect",
        &[
            objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]),
            objc2::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]),
        ],
    );
}

mod cg {
    use super::CgRect;
    #[repr(C)]
    pub struct CgPath {
        _private: [u8; 0],
    }
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

/// Converts a WebKit snapshot `NSImage` pointer to PNG bytes.
///
/// # Safety
/// `image` must be either null or a valid `NSImage` instance on the main thread.
pub(super) unsafe fn nsimage_to_png(image: *mut AnyObject) -> Option<Vec<u8>> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_clipping_view_has_its_own_hit_test() {
        let class = clip_class();
        assert!(std::ptr::eq(class, clip_class()));
        let hit_test = objc2::sel!(hitTest:);
        let own = class.instance_method(hit_test).unwrap();
        let view = objc2::class!(NSView).instance_method(hit_test).unwrap();
        assert!(!std::ptr::eq(own, view));
        assert!(std::ptr::eq(
            class.superclass().unwrap(),
            objc2::class!(NSView)
        ));
    }
}

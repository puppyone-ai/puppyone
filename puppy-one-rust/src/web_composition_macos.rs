//! macOS composition: the live WKWebView is a sibling BELOW the transparent
//! GPUI/Metal view. Rust paints its shell and overlays above it, leaving only
//! the editor rectangle transparent. No snapshots, hiding, or DOM remounts.
//!
//! GPUI keeps its content container and GPU view. A per-instance, no-ivar
//! subclass routes only hitTest; GPUI still owns its event and text handlers.
use crate::geometry::{HitMap, Rect, native_y};
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ClassBuilder, Sel},
    sel,
};
use objc2_app_kit::{NSApplication, NSEventType, NSView, NSWindowOrderingMode};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};
use std::{cell::RefCell, collections::HashMap, ffi::CString, rc::Rc};
use wry::WebViewExtMacOS;

struct Routing {
    hits: Rc<RefCell<HitMap>>,
    web: Retained<NSView>,
    original: &'static AnyClass,
}
thread_local! {
    static ROUTES: RefCell<HashMap<usize, Rc<Routing>>> = RefCell::new(HashMap::new());
}

pub struct Composition {
    shell: Retained<NSView>,
    web: Retained<NSView>,
}

fn parent(view: &NSView) -> Option<Retained<NSView>> {
    // SAFETY: AppKit main thread, retained live NSView; no hierarchy mutation
    // occurs while reading its superview.
    unsafe { view.superview() }
}

// NSView.hitTest: takes a point in the receiver's SUPERVIEW coordinates.
// Return ownership follows Objective-C's autoreleased getter convention.
extern "C-unwind" fn hit_test(this: &NSView, _: Sel, point: NSPoint) -> *mut NSView {
    let route = ROUTES.with(|routes| {
        routes
            .borrow()
            .get(&(this as *const NSView as usize))
            .cloned()
    });
    let original = route
        .as_ref()
        .map(|r| r.original)
        .unwrap_or_else(|| this.class().superclass().expect("composition superclass"));
    if let Some(route) = route {
        let local = this.convertPoint_fromView(point, parent(this).as_deref());
        let y = native_y(this.isFlipped(), this.bounds().size.height, local.y, 0.);
        let native_layer = route.hits.borrow().native((local.x as f32, y as f32));
        if !native_layer
            && !route.web.isHidden()
            && let Some(hit) = route.web.hitTest(point)
        {
            return Retained::autorelease_return(hit);
        }
        // Native controls must become first responder on a real press, but
        // pointer movement and layout changes must never steal editor focus.
        if let Some(mtm) = MainThreadMarker::new()
            && NSApplication::sharedApplication(mtm)
                .currentEvent()
                .is_some_and(|e| {
                    matches!(
                        e.r#type(),
                        NSEventType::LeftMouseDown | NSEventType::RightMouseDown
                    )
                })
            && let Some(window) = this.window()
        {
            window.makeFirstResponder(Some(this));
        }
    }
    // SAFETY: original is this instance's unchanged superclass. Signature is
    // exactly NSView.hitTest:. No GPUI methods/ivars or other instances change.
    let result: Option<Retained<NSView>> =
        unsafe { msg_send![super(this, original), hitTest: point] };
    result
        .map(Retained::autorelease_return)
        .unwrap_or(std::ptr::null_mut())
}

impl Composition {
    pub fn install(view: &wry::WebView, hits: Rc<RefCell<HitMap>>) -> Result<Self, String> {
        MainThreadMarker::new().ok_or("Web composition must run on the AppKit main thread")?;
        let native = view.webview();
        let web: Retained<NSView> = native.into_super().into_super();
        let shell = parent(&web).ok_or("Missing GPUI parent view")?;
        let parent = parent(&shell).ok_or("Missing native composition parent")?;
        let original = shell.class();
        if !original.name().to_string_lossy().contains("GPUIView") {
            return Err("Unrecognized native view; refusing to replace its input routing".into());
        }
        let name = CString::new(format!(
            "PuppyOneComposed_{}",
            original.name().to_string_lossy()
        ))
        .unwrap();
        let class = if let Some(class) = AnyClass::get(&name) {
            class
        } else {
            let mut builder = ClassBuilder::new(&name, original)
                .ok_or("Unable to register native input routing")?;
            // SAFETY: the selector and ABI match NSView.hitTest:. This subclass
            // adds NO ivars and inherits all of GPUI's input/accessibility state.
            unsafe {
                builder.add_method(
                    sel!(hitTest:),
                    hit_test as extern "C-unwind" fn(_, _, _) -> _,
                );
            }
            builder.register()
        };
        if class.instance_size() != original.instance_size() {
            return Err("Native view layout mismatch".into());
        }
        ROUTES.with(|routes| {
            routes.borrow_mut().insert(
                Retained::as_ptr(&shell) as usize,
                Rc::new(Routing {
                    hits,
                    web: web.clone(),
                    original,
                }),
            )
        });
        // SAFETY: same-size subclass of this instance's class; AppKit main
        // thread only; no other instance or class implementation is modified.
        let previous = unsafe { AnyObject::set_class(&shell, class) };
        assert_eq!(previous, original);
        web.removeFromSuperview();
        parent.addSubview_positioned_relativeTo(&web, NSWindowOrderingMode::Below, Some(&shell));
        Ok(Self { shell, web })
    }
    pub fn bounds(&self, bounds: Rect) {
        let Some(parent) = parent(&self.web) else {
            return;
        };
        let r = NSRect::new(
            NSPoint::new(
                bounds.x as f64,
                native_y(
                    self.shell.isFlipped(),
                    self.shell.bounds().size.height,
                    bounds.y as f64,
                    bounds.h as f64,
                ),
            ),
            NSSize::new(bounds.w.max(1.) as f64, bounds.h.max(1.) as f64),
        );
        let frame = self.shell.convertRect_toView(r, Some(&parent));
        if self.web.frame() != frame {
            self.web.setFrame(frame);
        }
    }
    #[cfg(feature = "webview-smoke")]
    pub fn editor_hit_is_native(&self, position: (f32, f32)) -> bool {
        let local = NSPoint::new(
            position.0 as f64,
            native_y(
                self.shell.isFlipped(),
                self.shell.bounds().size.height,
                position.1 as f64,
                0.,
            ),
        );
        let point = self
            .shell
            .convertPoint_toView(local, parent(&self.shell).as_deref());
        self.shell
            .hitTest(point)
            .is_some_and(|hit| hit.isDescendantOf(&self.shell))
    }
}
impl Drop for Composition {
    fn drop(&mut self) {
        ROUTES.with(|routes| {
            routes
                .borrow_mut()
                .remove(&(Retained::as_ptr(&self.shell) as usize))
        });
        // Do not change isa back to a superclass. The no-ivar subclass keeps a
        // safe superclass fallback after unregistering and during destruction.
    }
}

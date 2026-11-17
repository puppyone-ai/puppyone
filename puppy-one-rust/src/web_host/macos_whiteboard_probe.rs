//! Actual installed SDK, Wry IPC and native AppKit pointer events. No SDK/model
//! test doubles and no user profile, clipboard, network fixture or visible window.
use super::probe::{eval, tick, wait};
use crate::platform::{viewer_packs, webview::Ipc};
use objc2::{MainThreadMarker, class, msg_send, rc::Retained, runtime::AnyObject};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    path::Path,
    ptr::NonNull,
    rc::Rc,
    sync::atomic::{AtomicUsize, Ordering},
};
use wry::{
    WebViewExtMacOS,
    raw_window_handle::{
        AppKitWindowHandle, HandleError, HasWindowHandle, RawWindowHandle, WindowHandle,
    },
};

// NSEvent-created events do not change the physical mouse state. WebKit's
// own WebAutomationSessionMac.mm supplies pressedMouseButtons while sending
// native events too. This adapter runs only in this isolated fixture process;
// it neither moves the user's pointer nor changes page/SDK event handlers.
// https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Automation/mac/WebAutomationSessionMac.mm
static BUTTONS: AtomicUsize = AtomicUsize::new(0);
unsafe extern "C-unwind" fn pressed_buttons(_: &AnyObject, _: objc2::runtime::Sel) -> usize {
    BUTTONS.load(Ordering::Relaxed)
}
struct InputState {
    method: &'static objc2::runtime::Method,
    original: objc2::runtime::Imp,
}
impl InputState {
    fn new() -> Self {
        let method = class!(NSEvent)
            .class_method(objc2::sel!(pressedMouseButtons))
            .unwrap();
        // SAFETY: matching Objective-C method ABI (class receiver, selector -> NSUInteger).
        let original = unsafe {
            method.set_implementation(std::mem::transmute::<
                unsafe extern "C-unwind" fn(&AnyObject, objc2::runtime::Sel) -> usize,
                objc2::runtime::Imp,
            >(pressed_buttons))
        };
        Self { method, original }
    }
}
impl Drop for InputState {
    fn drop(&mut self) {
        // SAFETY: restore the implementation from this exact method.
        unsafe {
            self.method.set_implementation(self.original);
        }
    }
}
struct NativeWindow {
    window: Retained<AnyObject>,
    view: Retained<AnyObject>,
}
impl HasWindowHandle for NativeWindow {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let view = NonNull::from(&*self.view).cast();
        // SAFETY: the returned borrow cannot outlive this retained NSView.
        Ok(unsafe {
            WindowHandle::borrow_raw(RawWindowHandle::AppKit(AppKitWindowHandle::new(view)))
        })
    }
}
impl NativeWindow {
    fn new() -> Self {
        // SAFETY: the isolated process initializes and uses AppKit on its main thread.
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: bool = msg_send![app, setActivationPolicy: 2_isize];
            let allocated: objc2::rc::Allocated<AnyObject> = msg_send![class!(NSWindow), alloc];
            let window: Retained<AnyObject> = msg_send![allocated,
                initWithContentRect: NSRect::new(NSPoint::new(-10000., -10000.), NSSize::new(1100., 800.)),
                styleMask: 0_usize, backing: 2_usize, defer: false];
            let _: () = msg_send![&*window, setReleasedWhenClosed: false];
            let view: Retained<AnyObject> = msg_send![&*window, contentView];
            let _: () = msg_send![&*window, orderFrontRegardless];
            Self { window, view }
        }
    }
    fn pointer(&self, kind: usize, x: f64, y: f64) {
        // SAFETY: a live offscreen NSWindow; AppKit dispatches real mouse events to
        // its WKWebView child. Coordinates use the window's bottom-left origin.
        unsafe {
            BUTTONS.store(usize::from(kind != 2), Ordering::Relaxed);
            let number: isize = msg_send![&*self.window, windowNumber];
            let context: *mut AnyObject = std::ptr::null_mut();
            let clock: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
            let timestamp: f64 = msg_send![clock, systemUptime];
            let event: Retained<AnyObject> = msg_send![class!(NSEvent), mouseEventWithType: kind,
                location: NSPoint::new(x, 800. - y), modifierFlags: 0_usize, timestamp: timestamp,
                windowNumber: number, context: context, eventNumber: 1_isize, clickCount: 1_isize, pressure: 1_f32];
            let _: () = msg_send![&*self.window, sendEvent: &*event];
        }
        tick();
    }
}
impl Drop for NativeWindow {
    fn drop(&mut self) {
        // SAFETY: main-thread retained window, after its WebView has been dropped.
        unsafe {
            let _: () = msg_send![&*self.window, close];
        }
    }
}

struct Fixture {
    host: super::super::WebHost,
    window: NativeWindow,
    received: async_channel::Receiver<String>,
    messages: Vec<Value>,
    resources: Rc<RefCell<Vec<String>>>,
}
impl Fixture {
    fn new(root: &Path, text: &str) -> Self {
        let window = NativeWindow::new();
        let pack = viewer_packs::load_excalidraw_from(root).expect("verified installed SDK");
        let (tx, received) = async_channel::unbounded();
        let content = crate::editor::viewers::whiteboard::probe_content(pack, text.into(), Ipc(tx));
        let host = super::super::WebHost::new_child(&window, 0, content, false).unwrap();
        host.native()
            .view
            .set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0., 0.).into(),
                size: wry::dpi::LogicalSize::new(1100., 800.).into(),
            })
            .unwrap();
        host.native().view.set_visible(true).unwrap();
        let resources = Rc::new(RefCell::new(Vec::new()));
        let requests = resources.clone();
        host.native().protocol.observe_requests(Rc::new(move |url| {
            let mut requests = requests.borrow_mut();
            assert!(requests.len() < 1024, "unbounded native resource requests");
            requests.push(url.to_string());
        }));
        let mut fixture = Self {
            host,
            window,
            received,
            messages: vec![],
            resources,
        };
        fixture.until("SDK mounted and real IPC ready", |f| {
            f.drain();
            f.messages
                .iter()
                .any(|m| m["type"] == "ready" && m["generation"] == 1)
                && f.js("!!document.querySelector('.excalidraw canvas')") == "1"
        });
        fixture.js("window.__errors=[]; window.addEventListener('error',e=>__errors.push(e.message)); window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason))); 'observing'");
        fixture
    }
    fn js(&self, source: &str) -> String {
        eval(&self.host.native().view.webview(), source)
    }
    fn until(&mut self, label: &str, mut predicate: impl FnMut(&mut Self) -> bool) {
        wait(label, || predicate(self));
    }
    fn drain(&mut self) {
        while let Ok(body) = self.received.try_recv() {
            self.messages
                .push(serde_json::from_str(&body).expect("typed whiteboard IPC"));
        }
    }
    fn command(&self, message: Value) {
        self.js(&format!("window.__puppyoneWhiteboard({message}); 'sent'"));
    }
    fn settle(&mut self) {
        self.js("window.__settled=false; requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__settled=true})); 'waiting'");
        self.until("two painted frames", |f| f.js("window.__settled") == "1");
        self.drain();
        assert_eq!(
            self.js("JSON.stringify(window.__errors)"),
            "[]",
            "whiteboard page errors"
        );
    }
    fn edits(&self) -> Vec<&Value> {
        self.messages
            .iter()
            .filter(|m| m["type"] == "content")
            .collect()
    }
    fn history(&mut self, direction: &str, expected: usize) {
        self.messages.clear();
        self.command(json!({"type":"history", "direction":direction}));
        self.until("history command changed the actual SDK scene", |f| {
            f.drain();
            f.edits().last().is_some_and(|m| {
                let scene: Value = serde_json::from_str(m["text"].as_str().unwrap()).unwrap();
                scene["elements"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|e| e["isDeleted"] != true)
                    .count()
                    == expected
            })
        });
        self.settle();
    }
    fn resize(&mut self, width: f64, mobile: bool) {
        // SAFETY: the fixture owns this main-thread window; the height is stable
        // so native pointer coordinates continue to use the same conversion.
        unsafe {
            let _: () = msg_send![&*self.window.window, setContentSize: NSSize::new(width, 800.)];
        }
        self.host
            .native()
            .view
            .set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0., 0.).into(),
                size: wry::dpi::LogicalSize::new(width, 800.).into(),
            })
            .unwrap();
        self.until("native resize updates the SDK layout", |f| {
            f.js(&format!("window.innerWidth === {width} && document.querySelector('.excalidraw').classList.contains('excalidraw--mobile') === {mobile}")) == "1"
        });
        self.settle();
    }
    fn draw(&mut self) {
        self.js("window.__pointerEvents=[]; window.__recordPointer ??= e=>window.__pointerEvents.push([e.type,e.clientX,e.clientY,e.isTrusted,e.buttons]); for(const type of ['pointerdown','pointermove','pointerup']) document.addEventListener(type,window.__recordPointer,{capture:true}); document.querySelector('.excalidraw').focus(); 'focused'");
        self.settle();
        assert_eq!(
            self.js("!!document.querySelector('[data-testid=toolbar-rectangle]')"),
            "1"
        );
        self.js("document.querySelector('[data-testid=toolbar-rectangle]').click(); 'selected'");
        self.settle();
        self.window.pointer(1, 480., 290.);
        self.settle();
        for i in 1..=10 {
            self.window
                .pointer(6, 480. + f64::from(i) * 15., 290. + f64::from(i) * 9.);
            self.settle();
        }
        self.window.pointer(2, 630., 380.);
        self.settle();
        assert_eq!(self.js("__pointerEvents.length >= 3 && __pointerEvents.every(e=>e[3]===true && e[4]===(e[0]==='pointerup'?0:1))"), "1", "native input was not delivered with the requested button state");
    }
}

pub(super) fn run(root: &Path) {
    let _mtm = MainThreadMarker::new().expect("main-thread whiteboard probe");
    let _input_state = InputState::new();
    let blank = "{\n  \"type\": \"excalidraw\", \"version\": 2, \"elements\": [], \"appState\": {}, \"files\": {}\n}\n";
    let mut fixture = Fixture::new(root, blank);
    // SAFETY: the main-thread native WebView retains its configuration/store.
    assert!(!unsafe {
        fixture
            .host
            .native()
            .view
            .webview()
            .configuration()
            .websiteDataStore()
            .isPersistent()
    });
    fixture.settle();
    assert!(
        fixture.edits().is_empty(),
        "opening normalized the original source: {:?}",
        fixture.messages
    );
    assert_eq!(fixture.js("window.__PUPPYONE_WHITEBOARD.text"), blank);
    fixture.draw();
    fixture.until("native pointer produces a scene through Wry IPC", |f| {
        f.drain();
        f.edits().iter().any(|m| {
            serde_json::from_str::<Value>(m["text"].as_str().unwrap()).unwrap()["elements"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["type"] == "rectangle" && e["width"].as_f64().unwrap_or(0.) > 100.)
        })
    });
    fixture.settle();
    let drawing: Value =
        serde_json::from_str(fixture.edits().last().unwrap()["text"].as_str().unwrap()).unwrap();
    let shape = drawing["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "rectangle")
        .unwrap();
    assert_eq!(
        (
            shape["roughness"].clone(),
            shape["fillStyle"].clone(),
            shape["strokeWidth"].clone(),
            shape["roundness"].clone()
        ),
        (json!(0), json!("solid"), json!(1), Value::Null)
    );
    assert!(fixture.edits().iter().all(|m| m["generation"] == 1));

    fixture.command(json!({"type":"enabled", "value":false, "generation":2}));
    fixture.settle();
    fixture.messages.clear();
    fixture.window.pointer(1, 500., 420.);
    fixture.window.pointer(6, 650., 520.);
    fixture.window.pointer(2, 650., 520.);
    fixture.command(json!({"type":"history", "direction":"undo"}));
    fixture.settle();
    assert!(
        fixture.edits().is_empty(),
        "read-only canvas published content"
    );

    fixture.command(json!({"type":"reset", "text":blank, "generation":3}));
    fixture.command(json!({"type":"enabled", "value":true, "generation":4}));
    fixture.settle();
    fixture.command(json!({"type":"history", "direction":"undo"}));
    fixture.settle();
    assert!(
        fixture.edits().is_empty(),
        "reset or undo resurrected an old scene"
    );
    fixture.draw();
    fixture.until("drawing after external replacement", |f| {
        f.drain();
        !f.edits().is_empty()
    });
    fixture.settle();
    let replacement: Value =
        serde_json::from_str(fixture.edits().last().unwrap()["text"].as_str().unwrap()).unwrap();
    assert_eq!(replacement["elements"].as_array().unwrap().len(), 1);
    assert!(fixture.edits().iter().all(|m| m["generation"] == 4));

    fixture.messages.clear();
    for (dark, expected) in [(true, "1"), (false, "0")] {
        fixture.command(json!({"type":"theme", "dark":dark, "css":format!("html {{color-scheme:{}}}", if dark {"dark"} else {"light"})}));
        fixture.until("live theme", |f| {
            f.js("document.querySelector('.excalidraw').classList.contains('theme--dark')")
                == expected
        });
        fixture.settle();
        assert!(fixture.edits().is_empty(), "theme rewrote the source");
    }
    fixture.history("undo", 0);
    fixture.history("redo", 1);
    fixture.messages.clear();
    for (width, mobile) in [(560., false), (440., true), (1100., false)] {
        fixture.resize(width, mobile);
        assert!(fixture.edits().is_empty(), "resize rewrote the source");
    }
    fixture.js("window.__fontResult=null; document.fonts.load('20px \"Liberation Sans\"', 'hello').then(fonts=>{window.__fontResult=fonts.length}, error=>{window.__fontResult=String(error)}); 'loading'");
    fixture.until("installed SDK font loaded", |f| {
        f.js("window.__fontResult !== null") == "1"
    });
    let loaded: usize = fixture
        .js("window.__fontResult")
        .parse()
        .expect("font load resolved successfully");
    assert!(loaded > 0, "font family is absent");
    assert!(
        fixture
            .resources
            .borrow()
            .iter()
            .any(|u| u.starts_with("puppyone-preview:")
                && u.contains("/fonts/")
                && u.ends_with(".woff2")),
        "no actual offline font request: {:?}",
        fixture.resources.borrow()
    );

    fixture.messages.clear();
    fixture.command(json!({"type":"reset", "text":"{broken", "generation":5}));
    fixture.until("invalid document alert", |f| {
        f.js("!!document.querySelector('.whiteboard-editor [role=alert]')") == "1"
    });
    fixture.settle();
    assert!(fixture.edits().is_empty(), "invalid input was rewritten");
    println!(
        "{}",
        json!({"passed":true,"ephemeral":true,"initialBytes":true,"nativeDrawing":true,"drawingDefaults":true,"readOnly":true,"replacement":true,"theme":true,"undoRedo":true,"resize":true,"invalidPreserved":true,"offlineFonts":true})
    );
}

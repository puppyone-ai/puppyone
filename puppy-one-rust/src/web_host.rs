//! Native web content hosts (`wry` child WebViews) for viewers; the
//! protocol, path policy and MIME table live in `platform::webview`.
#![cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
use crate::platform::webview::{Content, SCHEME, entry_url, respond};
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
        let background = if dark {
            (24, 24, 27, 255)
        } else {
            (255, 255, 255, 255)
        };
        let view = wry::WebViewBuilder::new()
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
                    responder.respond(
                        wry::http::Response::builder()
                            .status(status)
                            .header("Content-Type", mime)
                            .header("Cache-Control", "no-store")
                            .body(Cow::<'static, [u8]>::Owned(body))
                            .unwrap_or_else(|_| wry::http::Response::new(Cow::Borrowed(&[][..]))),
                    );
                });
            })
            .with_navigation_handler(|url| {
                if url.starts_with(SCHEME) || url == "about:blank" {
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

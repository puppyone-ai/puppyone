//! Windows WebView2 backend (`wry` child HWND, per-monitor DPI bounds via
//! `LogicalPosition`/`LogicalSize`, async custom protocol handlers for
//! `puppyone-preview` & `puppyone-local`, and WebView2 runtime detection).
use super::{allow_navigation, protocol_response};
use crate::platform::webview::{Content, LOCAL_SCHEME, PreparedContent, SCHEME, entry_url};
use std::cell::Cell;

pub(super) const SUPPORTED: bool = true;

pub(super) struct BackendHost {
    view: wry::WebView,
    resources: PreparedContent,
    bounds: Cell<(f32, f32, f32, f32)>,
}

impl Drop for BackendHost {
    fn drop(&mut self) {
        self.resources.revoke();
    }
}

impl BackendHost {
    pub(super) fn build(
        window: &impl raw_window_handle::HasWindowHandle,
        content: Content,
        dark: bool,
    ) -> Result<Self, String> {
        if wry::webview_version().is_err() {
            return Err(
                "Microsoft Edge WebView2 Runtime is not installed. Install WebView2 from https://developer.microsoft.com/en-us/microsoft-edge/webview2/ and reopen this document."
                    .to_owned(),
            );
        }

        let served = content.clone().prepare();
        let local = served.clone();
        let resources = served.clone();
        let frames = content.frames.clone();
        let locked = content.locked;

        let background = if dark {
            (24, 24, 27, 255)
        } else {
            (255, 255, 255, 255)
        };

        let mut builder = wry::WebViewBuilder::new()
            .with_background_color(background)
            .with_asynchronous_custom_protocol(SCHEME.into(), move |_, request, responder| {
                let served = served.clone();
                std::thread::spawn(move || {
                    responder.respond(protocol_response(&served, false, &request))
                });
            })
            .with_asynchronous_custom_protocol(
                LOCAL_SCHEME.into(),
                move |_, request, responder| {
                    let served = local.clone();
                    std::thread::spawn(move || {
                        responder.respond(protocol_response(&served, true, &request))
                    });
                },
            );

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
            .with_drag_drop_handler(|_| true)
            .with_navigation_handler(move |url| allow_navigation(&url, locked, &frames))
            .with_new_window_req_handler(|url, _| {
                if url.starts_with("https://") || url.starts_with("http://") {
                    let _ = crate::platform::desktop::open_url(&url);
                }
                wry::NewWindowResponse::Deny
            })
            .build_as_child(window)
            .map_err(|e| format!("WebView2 failed to initialize: {e}"))?;

        Ok(Self {
            view,
            resources,
            bounds: Cell::new((0., 0., 0., 0.)),
        })
    }

    pub(super) fn place(&self, bounds: (f32, f32, f32, f32)) {
        if self.bounds.get() != bounds {
            self.bounds.set(bounds);
            let _ = self.view.set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(bounds.0, bounds.1).into(),
                size: wry::dpi::LogicalSize::new(bounds.2.max(1.), bounds.3.max(1.)).into(),
            });
        }
    }

    pub(super) fn place_clipped(
        &self,
        _bounds: (f32, f32, f32, f32),
        visible: (f32, f32, f32, f32),
        _radius: f32,
    ) {
        // Clamp WebView2 child HWND to the visible scroll viewport so it never
        // overflows header/sidebar chrome on scroll.
        self.place(visible);
    }

    pub(super) fn showing_rect(&self, fallback: (f32, f32, f32, f32)) -> (f32, f32, f32, f32) {
        let current = self.bounds.get();
        if current.2 > 0. && current.3 > 0. {
            current
        } else {
            fallback
        }
    }

    pub(super) fn set_visible(&self, show: bool) {
        let _ = self.view.set_visible(show);
    }

    pub(super) fn apply_cutouts(&self, holes: &[[f32; 5]], _size: (f32, f32)) -> bool {
        // Win32 child HWNDs cannot cut rounded floating-menu holes cleanly;
        // hide the child HWND whenever a floating surface intersects it.
        holes.is_empty()
    }

    pub(super) fn yield_focus_to_window(&self) {}

    pub(super) fn reload(&self) {
        let _ = self.view.load_url(&entry_url());
    }

    pub(super) fn evaluate(&self, script: &str) {
        let _ = self.view.evaluate_script(script);
    }

    pub(super) fn resize_hidden(&self, width: f32, height: f32) {
        let rect = (0., 0., width.max(1.), height.max(1.));
        self.bounds.set(rect);
        let _ = self.view.set_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0., 0.).into(),
            size: wry::dpi::LogicalSize::new(rect.2, rect.3).into(),
        });
    }

    pub(super) fn has_native_capture(&self) -> bool {
        false
    }

    pub(super) fn snapshot(
        &self,
        _rect: (f32, f32, f32, f32),
        _width: f32,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        done(None);
    }

    pub(super) fn capture_png(
        &self,
        _crop: Option<(f32, f32, f32, f32)>,
        _viewport: Option<(f32, f32)>,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        done(None);
    }
}

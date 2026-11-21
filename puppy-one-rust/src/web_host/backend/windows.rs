//! Windows WebView2 backend (`wry` child HWND, per-monitor DPI bounds via
//! `LogicalPosition`/`LogicalSize`, async custom protocol handlers for
//! `puppyone-preview` & `puppyone-local`, and WebView2 runtime detection).
use super::{allow_navigation, prepare_protocol_response, response};
use crate::platform::webview::{Content, LOCAL_SCHEME, PreparedContent, SCHEME, entry_url};
use std::{borrow::Cow, cell::Cell};

pub(super) const SUPPORTED: bool = true;

/// Intercepts `window.fetch` calls targeting PuppyOne's custom schemes inside
/// WebView2 and maps them onto Wry's synthetic `http://<scheme>.local/` hosts
/// so shared viewer bundles work identically across WKWebView and WebView2.
const WEBVIEW2_FETCH_SHIM: &str = r#"(function(){
  if (window.__puppyoneSchemeShim) return;
  window.__puppyoneSchemeShim = true;
  const rewrite = (u) => {
    if (typeof u !== 'string') return u;
    if (u.startsWith('puppyone-preview://local/')) {
      return 'http://puppyone-preview.local/' + u.slice('puppyone-preview://local/'.length);
    }
    if (u.startsWith('puppyone-local://local/')) {
      return 'http://puppyone-local.local/' + u.slice('puppyone-local://local/'.length);
    }
    return u;
  };
  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      return origFetch(rewrite(input), init);
    }
    if (input instanceof URL) {
      const next = rewrite(input.href);
      return origFetch(next === input.href ? input : next, init);
    }
    if (input && typeof input === 'object' && typeof input.url === 'string') {
      const next = rewrite(input.url);
      if (next !== input.url) {
        return origFetch(new Request(next, input), init);
      }
    }
    return origFetch(input, init);
  };
})();"#;

/// Adapts CSP scheme sources (`puppyone-preview:`, `puppyone-local:`) to Wry's
/// exact WebView2 synthetic origins without ever broadening to generic `http:`.
pub(super) fn adapt_csp_for_webview2(policy: &str) -> String {
    policy
        .replace(&format!("{SCHEME}:"), &format!("http://{SCHEME}.local"))
        .replace(
            &format!("{LOCAL_SCHEME}:"),
            &format!("http://{LOCAL_SCHEME}.local"),
        )
}

/// Rewrites entry HTML custom-scheme URLs (`<base href>`, `<script src>`,
/// `<video src>`, inline `<meta http-equiv="Content-Security-Policy">`) for
/// WebView2's `http://<scheme>.local/` custom protocol workaround.
pub(super) fn adapt_html_for_webview2(html: &str) -> String {
    let rewritten = html
        .replace(
            &format!("{SCHEME}://local/"),
            &format!("http://{SCHEME}.local/"),
        )
        .replace(
            &format!("{LOCAL_SCHEME}://local/"),
            &format!("http://{LOCAL_SCHEME}.local/"),
        );
    adapt_csp_for_webview2(&rewritten)
}

fn webview2_protocol_response(
    content: &PreparedContent,
    local: bool,
    request: &wry::http::Request<Vec<u8>>,
) -> wry::http::Response<Cow<'static, [u8]>> {
    let mut reply = prepare_protocol_response(content, local, request).collect();
    if request.method() == "HEAD" {
        reply.body.clear();
    } else if !local
        && reply.status == 200
        && reply.mime.starts_with("text/html")
        && let Ok(html) = String::from_utf8(reply.body.clone())
    {
        let adapted = adapt_html_for_webview2(&html).into_bytes();
        reply.length = Some(adapted.len() as u64);
        reply.body = adapted;
    }
    let mut http_resp = response(reply, None);
    if let Some(policy) = content.policy {
        let adapted_policy = adapt_csp_for_webview2(policy);
        if let Ok(value) = wry::http::HeaderValue::from_str(&adapted_policy) {
            http_resp
                .headers_mut()
                .insert("Content-Security-Policy", value);
        }
    }
    http_resp
}

pub(in crate::web_host) struct BackendHost {
    #[cfg(feature = "dev-capture")]
    pub(super) view: wry::WebView,
    #[cfg(not(feature = "dev-capture"))]
    view: wry::WebView,
    resources: PreparedContent,
    bounds: Cell<(f32, f32, f32, f32)>,
    // Keep WebContext and its temp user-data folder alive until after `view` drops.
    _web_context: wry::WebContext,
    _data_dir: Option<tempfile::TempDir>,
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

        let data_dir = tempfile::Builder::new()
            .prefix("puppyone-webview2-")
            .tempdir()
            .ok();
        let mut web_context =
            wry::WebContext::new(data_dir.as_ref().map(|d| d.path().to_path_buf()));

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

        let mut builder = wry::WebViewBuilder::new_with_web_context(&mut web_context)
            .with_background_color(background)
            .with_initialization_script(WEBVIEW2_FETCH_SHIM)
            .with_asynchronous_custom_protocol(SCHEME.into(), move |_, request, responder| {
                let served = served.clone();
                std::thread::spawn(move || {
                    responder.respond(webview2_protocol_response(&served, false, &request))
                });
            })
            .with_asynchronous_custom_protocol(
                LOCAL_SCHEME.into(),
                move |_, request, responder| {
                    let served = local.clone();
                    std::thread::spawn(move || {
                        responder.respond(webview2_protocol_response(&served, true, &request))
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
            _web_context: web_context,
            _data_dir: data_dir,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webview2_csp_and_html_adaptation_pins_exact_synthetic_origins() {
        let policy = "default-src 'none'; script-src puppyone-preview:; media-src puppyone-local:;";
        assert_eq!(
            adapt_csp_for_webview2(policy),
            "default-src 'none'; script-src http://puppyone-preview.local; media-src http://puppyone-local.local;"
        );

        let html = r#"<!doctype html><head><base href="puppyone-preview://local/"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src puppyone-local:"></head><img src="puppyone-local://local/a.png">"#;
        let adapted = adapt_html_for_webview2(html);
        assert!(adapted.contains(r#"<base href="http://puppyone-preview.local/">"#));
        assert!(adapted.contains(r#"<img src="http://puppyone-local.local/a.png">"#));
        assert!(adapted.contains("img-src http://puppyone-local.local"));
        assert!(!adapted.contains("puppyone-preview://local/"));
        assert!(!adapted.contains("puppyone-local://local/"));
    }
}

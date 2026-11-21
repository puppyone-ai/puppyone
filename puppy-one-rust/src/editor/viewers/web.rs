//! A pane area showing web content through `platform::webview`. The GPUI
//! element reserves the rectangle and places the native view over it each
//! paint; until the engine exists (or where it cannot), the product's
//! pending or failure state shows instead.
//!
//! Managed `WebFrame`s participate in the per-window live `WKWebView` LRU cap
//! (`web_host::MAX_LIVE_WEBVIEWS_PER_WINDOW`, `VW-20`): hidden unpinned frames
//! whose native host was evicted retain their `Content` and restore script so
//! they seamlessly recreate their `WebHost` when rendered again.
//!
//! `WebFrame::find` (`WB-20`) provides a zero-dependency in-page text search
//! adapter using DOM `TreeWalker` + CSS Custom Highlights (`CSS.highlights`) so
//! live DOM nodes are never mutated, posting `{"type":"poFindResult","current":c,"total":t}`
//! back over `window.ipc.postMessage`.
use super::html_visual::script_json;
use crate::{
    editor::workbench::find::FindEvent,
    localization::t,
    platform::{
        capabilities::Capabilities,
        webview::{Content, Entry},
    },
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant},
        loading::LoadingMark,
    },
    web_host::WebHost,
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::{path::PathBuf, rc::Rc};

#[cfg(test)]
type EvaluationRecorder = Rc<dyn Fn(&str)>;
pub type OnRecreated = Rc<dyn Fn(&mut App)>;
pub type OnFallbackClick = Rc<dyn Fn(&mut Window, &mut App)>;

/// Actionable native fallback rendered when embedded web views are unavailable
/// (for example Linux native-first mode or missing Windows WebView2 Runtime).
#[derive(Clone)]
pub struct WebFallbackAction {
    pub id: &'static str,
    pub label_key: &'static str,
    pub on_click: OnFallbackClick,
}

impl WebFallbackAction {
    /// Opens a verified local file in the OS default application (never for Cloud files).
    pub fn open_local_file(path: PathBuf) -> Self {
        Self {
            id: "web-fallback-open-external",
            label_key: "native.web.openExternally",
            on_click: Rc::new(move |_, cx| {
                crate::editor::question::open_external(None, path.clone(), |_, _| {}, cx);
            }),
        }
    }

    /// Opens a verified local HTML document in the OS default browser (never for Cloud files).
    pub fn open_local_in_browser(path: PathBuf) -> Self {
        Self {
            id: "web-fallback-open-browser",
            label_key: "native.web.openInBrowser",
            on_click: Rc::new(move |_, cx| {
                crate::editor::question::open_external(None, path.clone(), |_, _| {}, cx);
            }),
        }
    }

    /// Switches the hosting viewer to its native source editor.
    pub fn view_source(on_click: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        Self {
            id: "web-fallback-view-source",
            label_key: "native.web.viewSource",
            on_click: Rc::new(on_click),
        }
    }

    /// Custom actionable fallback (for example opening an app preview externally).
    pub fn custom(
        id: &'static str,
        label_key: &'static str,
        on_click: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            id,
            label_key,
            on_click: Rc::new(on_click),
        }
    }
}

#[derive(Deserialize)]
struct FindWire {
    #[serde(rename = "type")]
    kind: String,
    current: usize,
    total: usize,
}

/// Parses an inbound IPC payload emitted by [`WebFrame::find`] (`WB-20`).
pub fn parse_find_result(body: &str) -> Option<(usize, usize)> {
    let wire = serde_json::from_str::<FindWire>(body).ok()?;
    (wire.kind == "poFindResult").then_some((wire.current, wire.total))
}

/// Builds the self-contained in-page find script for `event` (`WB-20`).
pub fn web_find_script(event: &FindEvent) -> String {
    let payload = match event {
        FindEvent::Query(query) => {
            serde_json::json!({ "action": "query", "query": query })
        }
        FindEvent::Move { forward } => {
            serde_json::json!({ "action": "move", "forward": forward })
        }
        FindEvent::Close => {
            serde_json::json!({ "action": "close" })
        }
    };
    format!(
        r#"(function(cmd){{
  var H = typeof CSS !== "undefined" && CSS.highlights ? CSS.highlights : null;
  function ensureStyle(){{
    if (!document.head || document.getElementById("po-webview-find-style")) return;
    var s = document.createElement("style");
    s.id = "po-webview-find-style";
    s.textContent = "::highlight(po-find){{background-color:color-mix(in srgb,var(--po-warning,gold) 36%,transparent);color:inherit}}::highlight(po-find-active){{background-color:color-mix(in srgb,var(--po-warning,orange) 76%,transparent);color:inherit}}";
    document.head.appendChild(s);
  }}
  function clearAll(){{
    if (H) {{ H.delete("po-find"); H.delete("po-find-active"); }}
    window.__poWebFind = null;
  }}
  function report(current, total){{
    if (window.ipc && typeof window.ipc.postMessage === "function") {{
      window.ipc.postMessage(JSON.stringify({{ type: "poFindResult", current: current, total: total }}));
    }}
  }}
  function collectRanges(needle){{
    var out = [];
    if (!needle || !document.body) return out;
    var lower = needle.toLowerCase();
    var qLen = lower.length;
    if (!qLen) return out;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {{
      acceptNode: function(node){{
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {{
          return NodeFilter.FILTER_REJECT;
        }}
        return NodeFilter.FILTER_ACCEPT;
      }}
    }});
    var node;
    while ((node = walker.nextNode())) {{
      var text = node.nodeValue;
      if (!text) continue;
      var hay = text.toLowerCase();
      var from = 0;
      while (from <= hay.length - qLen) {{
        var idx = hay.indexOf(lower, from);
        if (idx < 0) break;
        if (idx + qLen <= text.length) {{
          var r = document.createRange();
          r.setStart(node, idx);
          r.setEnd(node, idx + qLen);
          out.push(r);
        }}
        from = idx + qLen;
      }}
    }}
    return out;
  }}
  function applyState(state){{
    if (!state || !state.ranges.length) {{
      if (H) {{ H.delete("po-find"); H.delete("po-find-active"); }}
      report(0, 0);
      return;
    }}
    ensureStyle();
    var idx = ((state.index % state.ranges.length) + state.ranges.length) % state.ranges.length;
    state.index = idx;
    var active = state.ranges[idx];
    if (H && typeof Highlight !== "undefined") {{
      H.set("po-find", new Highlight.apply ? new Highlight() : (function(){{ var hl = new Highlight(); for (var i = 0; i < state.ranges.length; i++) hl.add(state.ranges[i]); return hl; }})());
      var ahl = new Highlight();
      ahl.add(active);
      H.set("po-find-active", ahl);
    }}
    var el = active.startContainer && active.startContainer.parentElement;
    if (el && typeof el.scrollIntoView === "function") {{
      el.scrollIntoView({{ block: "center", inline: "nearest" }});
    }}
    report(idx + 1, state.ranges.length);
  }}
  if (cmd.action === "close") {{
    clearAll();
    return;
  }}
  if (cmd.action === "query") {{
    if (!cmd.query) {{
      clearAll();
      report(0, 0);
      return;
    }}
    var ranges = collectRanges(cmd.query);
    window.__poWebFind = {{ query: cmd.query, ranges: ranges, index: 0 }};
    applyState(window.__poWebFind);
    return;
  }}
  if (cmd.action === "move") {{
    var st = window.__poWebFind;
    if (!st || !st.query) {{
      report(0, 0);
      return;
    }}
    st.ranges = collectRanges(st.query);
    if (!st.ranges.length) {{
      applyState(st);
      return;
    }}
    st.index = st.index + (cmd.forward ? 1 : -1);
    applyState(st);
  }}
}})({payload})"#,
        payload = script_json(&payload),
    )
}

pub struct WebFrame {
    content: Option<Content>,
    host: Option<Rc<WebHost>>,
    failed: Option<String>,
    dark: bool,
    #[cfg(test)]
    evaluation_recorder: Option<EvaluationRecorder>,
    pinned: bool,
    restore_script: Option<String>,
    on_recreated: Option<OnRecreated>,
    fallback_actions: Vec<WebFallbackAction>,
}

impl WebFrame {
    pub fn new(content: Option<Content>, dark: bool) -> Self {
        Self {
            content,
            host: None,
            failed: None,
            dark,
            #[cfg(test)]
            evaluation_recorder: None,
            pinned: false,
            restore_script: None,
            on_recreated: None,
            fallback_actions: Vec::new(),
        }
    }

    /// Sets actionable fallback controls shown if embedded web views are unavailable.
    pub fn set_fallback_actions(&mut self, actions: Vec<WebFallbackAction>) {
        self.fallback_actions = actions;
    }

    #[cfg(test)]
    pub fn fallback_actions(&self) -> &[WebFallbackAction] {
        &self.fallback_actions
    }

    #[cfg(test)]
    pub fn fail_for_test(&mut self, reason: impl Into<String>) {
        self.host = None;
        self.failed = Some(reason.into());
    }

    /// Replaces what the frame shows (a new engine instance).
    pub fn set_content(&mut self, content: Option<Content>, cx: &mut Context<Self>) {
        self.content = content;
        self.host = None;
        self.failed = None;
        cx.notify();
    }

    /// Updates the stored HTML entry in-place without destroying an active
    /// `WebHost` (so future LRU recreations boot with the latest state/theme).
    pub fn update_entry_html(&mut self, html: String) {
        if let Some(content) = &mut self.content {
            content.entry = Entry::Html(html);
        }
    }

    /// Applies an in-place theme update (`VW-21`): updates `dark` and the stored
    /// entry HTML for future restores, and evaluates `script` immediately if a
    /// live `WebHost` is currently mounted without destroying `WebFrame`.
    pub fn apply_theme_in_place(
        &mut self,
        dark: bool,
        script: &str,
        updated_html: Option<String>,
    ) -> bool {
        self.dark = dark;
        if let Some(html) = updated_html {
            self.update_entry_html(html);
        }
        self.evaluate(script)
    }

    /// Marks whether this frame holds uncommitted drafts or active playback and
    /// must never be evicted by the per-window LRU cap (`VW-20`).
    pub fn set_pinned(&mut self, pinned: bool) {
        self.pinned = pinned;
        if let Some(host) = &self.host {
            host.set_pinned(pinned);
        }
    }

    pub fn is_pinned(&self) -> bool {
        self.pinned
    }

    /// Whether a live `WebHost` is currently resident for this frame.
    pub fn is_resident(&self) -> bool {
        self.host.as_ref().is_some_and(|h| h.is_alive())
    }

    /// Stores an optional JS snippet evaluated whenever an evicted `WebHost` is
    /// recreated on re-display (`VW-20`).
    pub fn set_restore_script(&mut self, script: Option<String>) {
        self.restore_script = script;
    }

    /// Registers a callback fired when an LRU-evicted `WebFrame` recreates its
    /// `WebHost` upon becoming visible again.
    pub fn set_on_recreated(&mut self, callback: Option<OnRecreated>) {
        self.on_recreated = callback;
    }

    pub fn reload(&mut self) {
        if let Some(host) = &self.host
            && host.is_alive()
        {
            host.reload();
        }
    }
    /// Records the transport boundary without constructing an OS engine.
    #[cfg(test)]
    pub(super) fn record_evaluations(&mut self, recorder: impl Fn(&str) + 'static) {
        self.evaluation_recorder = Some(Rc::new(recorder));
    }

    /// Runs host script in the page; `false` before the engine exists or while evicted.
    pub fn evaluate(&self, script: &str) -> bool {
        #[cfg(test)]
        if let Some(recorder) = &self.evaluation_recorder {
            recorder(script);
            return true;
        }
        match &self.host {
            Some(host) if host.is_alive() => {
                host.evaluate(script);
                true
            }
            _ => false,
        }
    }

    /// Dispatches an in-page text find command to the WebView (`WB-20`).
    ///
    /// Match counts arrive asynchronously over IPC (`poFindResult` ->
    /// `SurfaceEvent::FindResult`); `Close` returns `None` so the host closes
    /// the find bar, and an empty query returns `Some((0, 0))` immediately.
    pub fn find(&self, event: FindEvent, _cx: &App) -> Option<(usize, usize)> {
        let script = web_find_script(&event);
        let evaluated = self.evaluate(&script);
        match event {
            FindEvent::Close => None,
            FindEvent::Query(q) if q.is_empty() => Some((0, 0)),
            FindEvent::Query(_) | FindEvent::Move { .. } => {
                if !evaluated {
                    Some((0, 0))
                } else {
                    None
                }
            }
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn evaluated_scripts(&self) -> Vec<String> {
        match &self.host {
            Some(host) if host.is_alive() => host.evaluated_scripts(),
            _ => Vec::new(),
        }
    }

    #[cfg(test)]
    pub fn entry_html(&self) -> Option<&str> {
        let Entry::Html(html) = &self.content.as_ref()?.entry;
        Some(html.as_str())
    }

    /// Captures a PNG snapshot of the visible WebView (optionally cropped to
    /// `crop` over `viewport`). Returns `false` if the native engine is not mounted.
    pub fn capture_png(
        &self,
        crop: Option<(f32, f32, f32, f32)>,
        viewport: Option<(f32, f32)>,
        done: impl FnOnce(Option<Vec<u8>>) + 'static,
    ) -> bool {
        if let Some(host) = &self.host
            && host.is_alive()
            && host.has_native_capture()
        {
            host.capture_png(crop, viewport, done);
            return true;
        }
        #[cfg(any(test, feature = "test-support"))]
        {
            let img = image::RgbaImage::from_pixel(160, 120, image::Rgba([69, 153, 223, 255]));
            let mut buf = std::io::Cursor::new(Vec::new());
            let _ =
                image::DynamicImage::ImageRgba8(img).write_to(&mut buf, image::ImageFormat::Png);
            let mut png = buf.into_inner();
            if let Some(rect) = crop {
                let vp = viewport.unwrap_or((160., 120.));
                if let Some(cropped) = crate::web_host::crop_png_bytes(&png, rect, vp) {
                    png = cropped;
                }
            }
            done(Some(png));
            true
        }
        #[cfg(not(any(test, feature = "test-support")))]
        {
            let _ = (crop, viewport, done);
            false
        }
    }
}

impl Render for WebFrame {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let was_evicted = self.host.as_ref().is_some_and(|h| !h.is_alive());
        if (self.host.is_none() || was_evicted)
            && self.failed.is_none()
            && let Some(content) = self.content.clone()
        {
            match WebHost::new_managed(window, content, self.dark, self.pinned) {
                Ok(host) => {
                    if let Some(script) = &self.restore_script {
                        host.evaluate(script);
                    }
                    self.host = Some(Rc::new(host));
                    if was_evicted && let Some(cb) = self.on_recreated.clone() {
                        cx.defer(move |cx| cb(cx));
                    }
                }
                Err(error) => self.failed = Some(error),
            }
        } else if let Some(host) = &self.host {
            host.mark_rendered(window);
        }
        crate::web_host::frame_drawn(window);
        if let Some(error) = self.failed.clone() {
            let native_first = !Capabilities::probe().embedded_web.is_available();
            let headline = t("native.web.embeddedUnavailable").to_owned();
            let detail = (!error.is_empty() && error != headline).then_some(error);
            let actions = self.fallback_actions.clone();
            return div()
                .id("web-fallback-card")
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(12.))
                .p(px(24.))
                .bg(p.canvas)
                .child(
                    div()
                        .max_w(px(460.))
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap(px(10.))
                        .text_center()
                        .child(
                            div()
                                .text_size(px(theme::ty().ui.body))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(if native_first { p.text } else { p.danger })
                                .child(headline),
                        )
                        .when_some(detail, |d, detail| {
                            d.child(
                                div()
                                    .text_size(px(theme::ty().ui.meta))
                                    .text_color(p.subtle)
                                    .child(detail),
                            )
                        })
                        .when(!actions.is_empty(), |d| {
                            d.child(
                                div()
                                    .pt(px(6.))
                                    .flex()
                                    .flex_wrap()
                                    .justify_center()
                                    .gap(px(8.))
                                    .children(actions.into_iter().enumerate().map(
                                        |(idx, action)| {
                                            let on_click = action.on_click.clone();
                                            Button::new(action.id)
                                                .variant(if idx == 0 {
                                                    ButtonVariant::Solid
                                                } else {
                                                    ButtonVariant::Secondary
                                                })
                                                .label(t(action.label_key).to_owned())
                                                .on_click(move |_, window, cx| on_click(window, cx))
                                        },
                                    )),
                            )
                        }),
                )
                .into_any_element();
        }
        let host = self.host.clone();
        div()
            .relative()
            .size_full()
            .bg(p.canvas)
            .when(host.is_none(), |d| {
                d.child(
                    div()
                        .absolute()
                        .size_full()
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .gap(px(8.))
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(p.subtle)
                        .child(LoadingMark::new("web-pending"))
                        .child(t("editor.preview.loading")),
                )
            })
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        if let Some(host) = &host {
                            host.place(bounds);
                            crate::web_host::frame_drawn(window);
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web_host::{MAX_LIVE_WEBVIEWS_PER_WINDOW, live_host_count};
    use core::prelude::v1::test;
    use std::cell::Cell;

    fn dummy_content(label: &str) -> Content {
        Content {
            root: None,
            source: None,
            entry: Entry::Html(format!("<!doctype html><p>{label}</p>")),
            max_bytes: 0,
            assets: vec![],
            ipc: None,
            policy: None,
            frames: None,
            disk_assets: None,
            locked: false,
        }
    }

    struct Switcher {
        frames: Vec<Entity<WebFrame>>,
        active: usize,
    }

    impl Render for Switcher {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .children(self.frames.get(self.active).cloned())
        }
    }

    #[gpui::test]
    fn wb20_webframe_find_evaluates_treewalker_search_and_parses_ipc_results(
        cx: &mut TestAppContext,
    ) {
        let (frame, cx) =
            cx.add_window_view(|_, _| WebFrame::new(Some(dummy_content("hello world")), false));
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        frame.read_with(cx, |f, cx| {
            assert_eq!(f.find(FindEvent::Query("hello".into()), cx), None);
            assert_eq!(f.find(FindEvent::Move { forward: true }, cx), None);
            assert_eq!(f.find(FindEvent::Close, cx), None);
            let scripts = f.evaluated_scripts();
            assert_eq!(scripts.len(), 3);
            assert!(scripts[0].contains(r#""action":"query""#));
            assert!(scripts[0].contains(r#""query":"hello""#));
            assert!(scripts[1].contains(r#""action":"move""#));
            assert!(scripts[2].contains(r#""action":"close""#));
        });
        assert_eq!(
            parse_find_result(r#"{"type":"poFindResult","current":2,"total":5}"#),
            Some((2, 5))
        );
        assert_eq!(parse_find_result(r#"{"type":"ready"}"#), None);
    }

    /// `VW-20` & `VW-40`: Opening > 6 `WebFrame`s in a window caps resident
    /// `WebHost`s at `MAX_LIVE_WEBVIEWS_PER_WINDOW` (`6`), never evicts pinned
    /// frames, and seamlessly recreates evicted frames with restore state when
    /// shown again.
    #[gpui::test]
    fn live_webviews_per_window_stay_within_lru_cap_and_preserve_pinned_frames(
        cx: &mut TestAppContext,
    ) {
        let recreated_zero = Rc::new(Cell::new(0usize));
        let recreated_counter = recreated_zero.clone();

        let (switcher, cx) = cx.add_window_view(|_, cx| {
            let frames: Vec<Entity<WebFrame>> = (0..9)
                .map(|i| {
                    let recreated_counter = recreated_counter.clone();
                    cx.new(|_| {
                        let mut f = WebFrame::new(Some(dummy_content(&format!("page-{i}"))), false);
                        if i == 0 {
                            f.set_restore_script(Some("window.__restored = 42;".into()));
                            f.set_on_recreated(Some(Rc::new(move |_| {
                                recreated_counter.set(recreated_counter.get() + 1);
                            })));
                        }
                        if i == 1 {
                            f.set_pinned(true);
                        }
                        f
                    })
                })
                .collect();
            Switcher { frames, active: 0 }
        });

        for idx in 0..9 {
            switcher.update(cx, |s, cx| {
                s.active = idx;
                cx.notify();
            });
            cx.update(|w, cx| {
                w.draw(cx).clear(cx);
                let live = live_host_count(w);
                assert!(
                    live <= MAX_LIVE_WEBVIEWS_PER_WINDOW,
                    "step {idx}: live={live} exceeded cap {MAX_LIVE_WEBVIEWS_PER_WINDOW}"
                );
            });
            cx.run_until_parked();
        }

        switcher.read_with(cx, |s, cx| {
            assert!(!s.frames[0].read(cx).is_resident());
            assert!(s.frames[1].read(cx).is_resident());
            assert!(!s.frames[2].read(cx).is_resident());
            assert!(s.frames[8].read(cx).is_resident());
        });

        switcher.update(cx, |s, cx| {
            s.active = 0;
            cx.notify();
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
            assert_eq!(live_host_count(w), MAX_LIVE_WEBVIEWS_PER_WINDOW);
        });
        cx.run_until_parked();

        assert_eq!(recreated_zero.get(), 1);
        switcher.read_with(cx, |s, cx| {
            assert!(s.frames[0].read(cx).is_resident());
            assert!(s.frames[1].read(cx).is_resident());
            assert_eq!(
                s.frames[0].read(cx).evaluated_scripts(),
                vec!["window.__restored = 42;".to_string()]
            );
        });
    }

    #[gpui::test]
    fn fallback_card_exposes_actionable_native_controls_when_web_unavailable(
        cx: &mut TestAppContext,
    ) {
        let clicked = Rc::new(Cell::new(false));
        let clicked_cb = clicked.clone();
        let (frame, cx) = cx.add_window_view(|_, _| {
            let mut f = WebFrame::new(None, false);
            f.set_fallback_actions(vec![WebFallbackAction::view_source(move |_, _| {
                clicked_cb.set(true);
            })]);
            f.fail_for_test("Embedded web preview is not available on this platform.");
            f
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        frame.read_with(cx, |f, _| {
            assert_eq!(f.fallback_actions().len(), 1);
            assert_eq!(f.fallback_actions()[0].label_key, "native.web.viewSource");
        });
        let action = frame.read_with(cx, |f, _| f.fallback_actions()[0].on_click.clone());
        cx.update(|w, cx| action(w, cx));
        assert!(clicked.get());
    }
}

//! A pane area showing web content through `platform::webview`. The GPUI
//! element reserves the rectangle and places the native view over it each
//! paint; until the engine exists (or where it cannot), the product's
//! pending or failure state shows instead.
//!
//! Managed `WebFrame`s participate in the per-window live `WKWebView` LRU cap
//! (`web_host::MAX_LIVE_WEBVIEWS_PER_WINDOW`, `VW-20`): hidden unpinned frames
//! whose native host was evicted retain their `Content` and restore script so
//! they seamlessly recreate their `WebHost` when rendered again.
use crate::{
    localization::t,
    platform::webview::{Content, Entry},
    theme,
    ui::{appearance::ActiveAppearance, loading::LoadingMark},
    web_host::WebHost,
};
use gpui::{prelude::*, *};
use std::rc::Rc;

pub type OnRecreated = Rc<dyn Fn(&mut App)>;

pub struct WebFrame {
    content: Option<Content>,
    host: Option<Rc<WebHost>>,
    failed: Option<String>,
    dark: bool,
    pinned: bool,
    restore_script: Option<String>,
    on_recreated: Option<OnRecreated>,
}

impl WebFrame {
    pub fn new(content: Option<Content>, dark: bool) -> Self {
        Self {
            content,
            host: None,
            failed: None,
            dark,
            pinned: false,
            restore_script: None,
            on_recreated: None,
        }
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

    /// Runs host script in the page; `false` before the engine exists or while evicted.
    pub fn evaluate(&self, script: &str) -> bool {
        match &self.host {
            Some(host) if host.is_alive() => {
                host.evaluate(script);
                true
            }
            _ => false,
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
            return div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .p(px(24.))
                .bg(p.canvas)
                .text_size(px(theme::ty().ui.meta))
                .text_color(p.danger)
                .child(error)
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
                            // Frame 1 has uncommitted draft / active playback: must NEVER be evicted.
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
                let _ = w.draw(cx);
                let live = live_host_count(w);
                assert!(
                    live <= MAX_LIVE_WEBVIEWS_PER_WINDOW,
                    "step {idx}: live={live} exceeded cap {MAX_LIVE_WEBVIEWS_PER_WINDOW}"
                );
            });
            cx.run_until_parked();
        }

        // Frame 0 (oldest unpinned) was evicted, while Frame 1 (pinned) stayed resident!
        switcher.read_with(cx, |s, cx| {
            assert!(!s.frames[0].read(cx).is_resident());
            assert!(s.frames[1].read(cx).is_resident());
            assert!(!s.frames[2].read(cx).is_resident());
            assert!(s.frames[8].read(cx).is_resident());
        });

        // Re-showing Frame 0 seamlessly recreates its WebHost and replays its restore script.
        switcher.update(cx, |s, cx| {
            s.active = 0;
            cx.notify();
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
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
}

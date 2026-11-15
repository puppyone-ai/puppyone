//! A pane area showing web content through `platform::webview`. The GPUI
//! element reserves the rectangle and places the native view over it each
//! paint; until the engine exists (or where it cannot), the product's
//! pending or failure state shows instead.
use crate::{
    localization::t,
    platform::webview::Content,
    theme,
    ui::{appearance::ActiveAppearance, loading::LoadingMark},
    web_host::WebHost,
};
use gpui::{prelude::*, *};
use std::rc::Rc;

pub struct WebFrame {
    content: Option<Content>,
    host: Option<Rc<WebHost>>,
    failed: Option<String>,
    dark: bool,
}
impl WebFrame {
    pub fn new(content: Option<Content>, dark: bool) -> Self {
        Self {
            content,
            host: None,
            failed: None,
            dark,
        }
    }
    /// Replaces what the frame shows (a new engine instance).
    pub fn set_content(&mut self, content: Option<Content>, cx: &mut Context<Self>) {
        self.content = content;
        self.host = None;
        self.failed = None;
        cx.notify();
    }
    pub fn reload(&mut self) {
        if let Some(host) = &self.host {
            host.reload();
        }
    }
    /// Runs host script in the page; `false` before the engine exists.
    pub fn evaluate(&self, script: &str) -> bool {
        match &self.host {
            Some(host) => {
                host.evaluate(script);
                true
            }
            None => false,
        }
    }
    /// Captures a PNG snapshot of the visible WebView (optionally cropped to
    /// `crop` over `viewport`). Returns `false` if the native engine is not mounted.
    pub fn capture_png(
        &self,
        crop: Option<(f32, f32, f32, f32)>,
        viewport: Option<(f32, f32)>,
        done: impl FnOnce(Option<Vec<u8>>) + 'static,
    ) -> bool {
        if let Some(host) = &self.host {
            host.capture_png(crop, viewport, done);
            return true;
        }
        #[cfg(any(test, feature = "test-support"))]
        {
            let img = image::RgbaImage::from_pixel(160, 120, image::Rgba([69, 153, 223, 255]));
            let mut buf = std::io::Cursor::new(Vec::new());
            let _ = image::DynamicImage::ImageRgba8(img).write_to(&mut buf, image::ImageFormat::Png);
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
        if self.host.is_none()
            && self.failed.is_none()
            && let Some(content) = self.content.clone()
        {
            match WebHost::new(window, content, self.dark) {
                Ok(host) => self.host = Some(Rc::new(host)),
                Err(error) => self.failed = Some(error),
            }
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

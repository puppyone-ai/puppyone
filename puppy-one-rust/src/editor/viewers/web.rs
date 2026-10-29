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
            .child(
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
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, _, _| {
                        if let Some(host) = &host {
                            host.place(bounds);
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
            .into_any_element()
    }
}

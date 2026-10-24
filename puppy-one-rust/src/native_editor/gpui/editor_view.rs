//! The continuous document surface: composition, focus and input gating only.
use super::actions::EditorAction;
#[cfg(test)]
use super::actions::bind_keys;
use crate::ui::input::presentation;
use crate::{
    documents::ClientMessage,
    native_editor::host::{protocol, session::Session},
    theme::Theme,
    ui::input::TextInput,
};
use gpui::{prelude::*, *};
pub struct NativeEditor {
    pub(super) session: Option<Session>,
    pub(super) input: Option<Entity<TextInput>>,
    pub(super) subscription: Option<Subscription>,
    pub(super) focus: FocusHandle,
    pub(super) dark: bool,
    pub(super) blocked: bool,
}
impl EventEmitter<ClientMessage> for NativeEditor {}
impl NativeEditor {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            session: None,
            input: None,
            subscription: None,
            focus: cx.focus_handle(),
            dark: true,
            blocked: false,
        }
    }
    pub fn receive(
        &mut self,
        message: &serde_json::Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<ClientMessage> {
        let reply = protocol::receive(&mut self.session, message);
        if reply.reset_input {
            self.input = None;
            self.subscription = None;
            self.sync_fields(window, cx);
        }
        if let Some(command) = reply.command {
            self.apply_command(command, window, cx);
        }
        self.gate(self.blocked, self.dark, cx);
        cx.notify();
        reply.messages
    }
    pub fn gate(&mut self, blocked: bool, dark: bool, cx: &mut Context<Self>) {
        self.blocked = blocked;
        self.dark = dark;
        let read_only = blocked || self.session.as_ref().is_some_and(|s| s.frozen);
        if let Some(field) = &self.input
            && (field.read(cx).read_only != read_only
                || field.read(cx).dark != dark
                || field.read(cx).font_size != crate::theme::font_size(15.))
        {
            field.update(cx, |i, cx| {
                i.read_only = read_only;
                i.dark = dark;
                i.font_size = crate::theme::font_size(15.);
                cx.notify();
            });
        }
    }
    pub(super) fn focus_selected(&self, window: &mut Window, cx: &mut App) {
        if let Some(field) = &self.input {
            field.focus_handle(cx).focus(window, cx);
        }
    }
    pub fn focus_document(&self, window: &mut Window, cx: &mut App) {
        self.focus_selected(window, cx);
    }
}
impl Render for NativeEditor {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        let root = div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.canvas)
            .text_color(t.text)
            .font_family("Open Sans")
            .key_context("NativeMarkdown")
            .track_focus(&self.focus)
            .on_action(cx.listener(|s, a: &EditorAction, w, cx| s.command(&a.name, w, cx)));
        root.child(
            div()
                .flex_1()
                .min_h_0()
                .w_full()
                .flex()
                .justify_center()
                .child(
                    div()
                        .h_full()
                        .w_full()
                        // Web reading rail: 724px text plus 48px on each side.
                        .max_w(px(
                            presentation::READING_WIDTH + 2. * presentation::CONTENT_INSET
                        ))
                        .children(self.input.clone()),
                ),
        )
    }
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;

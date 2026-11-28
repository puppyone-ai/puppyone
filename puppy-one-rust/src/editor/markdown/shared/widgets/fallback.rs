//! Shared user-visible fallback UI primitives (`TA-52`, `TODO-37`):
//! every external asset, media clip, or diagram/formula render degrades along
//! `Rendered -> Text/Card Fallback -> Source`, surfacing a clear failure reason
//! alongside `Retry` and `Show Source` controls using product theme tokens.
use crate::theme::{self, Theme};
use gpui::{prelude::*, *};

/// Compact action pill inside a fallback card or error banner (`Retry`,
/// `Source code`, etc.).
pub fn action_pill(
    id: ElementId,
    label: impl Into<SharedString>,
    dark: bool,
    on_activate: impl Fn(&mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let app = Theme::new(dark);
    let ty = theme::ty().ui;
    div()
        .id(id)
        .h(px(22.))
        .px(px(8.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(5.))
        .border_1()
        .border_color(theme::mix(app.divider, app.muted, 0.92))
        .bg(theme::alpha(app.panel_raised, 0.92))
        .text_size(px(ty.caption))
        .font_weight(FontWeight(600.))
        .text_color(app.muted)
        .cursor(theme::clickable_cursor())
        .hover(move |s| s.bg(app.control_hover).text_color(app.text))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            on_activate(window, cx);
        })
        .child(label.into())
}

/// Structured summary of a visible fallback card (`TA-52`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FallbackSummary {
    pub title: String,
    pub reason: String,
    pub retryable: bool,
}

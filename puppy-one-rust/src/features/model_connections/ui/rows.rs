//! The list card and its rows (`.model-connections-list`), shared by the
//! source list, the provider picker and the details page.
use crate::{
    theme::{self, Theme},
    ui::components::Icon,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

/// The bordered list card.
pub(super) fn table(t: Theme, rows: Vec<AnyElement>) -> Div {
    div()
        .flex()
        .flex_col()
        .w_full()
        .p(px(4.))
        .border_1()
        .border_color(t.border_subtle)
        .rounded(px(7.))
        .bg(t.panel)
        .children(rows)
}
/// One 34px list row.
pub(super) fn table_row(t: Theme) -> Div {
    h_flex()
        .w_full()
        .min_w_0()
        .min_h(px(theme::control_large()))
        .p(px(8.))
        .gap(px(10.))
        .rounded(px(6.))
        .text_size(px(theme::ty().ui.label))
        .line_height(px(18.))
        .text_color(t.muted)
}
/// A row's name over a quieter second line.
pub(super) fn identity(t: Theme, name: SharedString, detail: SharedString) -> Div {
    let m = theme::ty();
    v_flex()
        .flex_1()
        .min_w_0()
        .gap(px(3.))
        .child(div().truncate().text_color(t.text).child(name))
        .child(
            div()
                .truncate()
                .text_size(px(m.ui.caption))
                .line_height(px(15.))
                .text_color(t.subtle)
                .child(detail),
        )
}
/// `.model-connections-text-action`: 20px, 4px inline, caption type.
pub(super) fn text_action(
    t: Theme,
    id: impl Into<ElementId>,
    icon: &'static str,
    size: f32,
    label: SharedString,
) -> Stateful<Div> {
    let id: ElementId = id.into();
    // A pending action's loader turns (`.is-spinning`).
    let mut glyph = Icon::new(icon)
        .with_size(px(size))
        .stroke(2.)
        .color(t.subtle);
    if icon == "loader-circle" {
        glyph = glyph.spinning(id.clone());
    }
    div()
        .id(id)
        .h(px(theme::control_micro()))
        .px(px(4.))
        .flex()
        .items_center()
        .gap(px(5.))
        .rounded(px(6.))
        .text_size(px(theme::ty().ui.caption))
        .text_color(t.subtle)
        .cursor(theme::clickable_cursor())
        .hover(move |s| s.bg(t.hover).text_color(t.text))
        .child(glyph)
        .child(label)
}
/// A caption status at a row's end.
pub(super) fn status(t: Theme, text: SharedString) -> Div {
    div()
        .flex_none()
        .max_w(relative(0.32))
        .truncate()
        .text_size(px(theme::ty().ui.caption))
        .text_color(t.muted)
        .child(text)
}
pub(super) fn chevron(t: Theme) -> Icon {
    Icon::new("chevron-right").small().stroke(2.).color(t.muted)
}

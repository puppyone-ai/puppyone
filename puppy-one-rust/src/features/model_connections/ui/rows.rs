//! The list card and its rows (`.model-connections-list`), shared by the
//! source list, the provider picker and the details page.
use super::super::infrastructure::SourceKind;
use crate::agent::model_connections::providers::Provider;
use crate::{
    theme::{self, Theme},
    ui::components::{Button, ButtonVariant, Icon},
    ui::form_input::TextInput,
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
/// `.model-connections-text-action`: 20px, 4px inline, caption type; a
/// ghost `Button`, so it takes focus and the keyboard.
pub(super) fn text_action(
    t: Theme,
    id: impl Into<ElementId>,
    icon: &'static str,
    size: f32,
    label: SharedString,
) -> Button {
    let id: ElementId = id.into();
    // A pending action's loader turns (`.is-spinning`).
    let mut glyph = Icon::new(icon)
        .with_size(px(size))
        .stroke(2.)
        .color(t.subtle);
    if icon == "loader-circle" {
        glyph = glyph.spinning(id.clone());
    }
    Button::new(id)
        .variant(ButtonVariant::Ghost)
        .with_size(px(theme::control_micro()))
        .leading(glyph)
        .label(label)
        .px(px(4.))
        .gap(px(5.))
        .rounded(px(6.))
        .text_size(px(theme::ty().ui.caption))
        .text_color(t.subtle)
}
/// A row that opens a page: the hover backplate, a trailing chevron and
/// `open` on click.
pub(super) fn link_row(
    t: Theme,
    row: Stateful<Div>,
    open: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    row.cursor(theme::clickable_cursor())
        .hover(move |s| s.bg(t.hover))
        .child(chevron(t))
        .on_click(open)
}
/// A row's 18px brand mark (a local service's falls back to the server
/// glyph).
pub(super) fn row_mark(t: Theme, provider: Option<&Provider>, source: SourceKind) -> AnyElement {
    super::mark(provider, source, 18., t.text.into())
}
/// `.desktop-settings-text-input`'s shell around `input`, which draws only
/// its text (meta type on a 17px line).
pub(super) fn text_field(t: Theme, input: &Entity<TextInput>, cx: &mut App) -> Div {
    let m = theme::ty();
    input.update(cx, |i, _| {
        i.appearance = false;
        i.prompt_text = Some((m.ui.meta, 17.));
        i.placeholder_color = Some(|t| t.subtle);
        i.min_height = 17.;
    });
    div()
        .h(px(theme::control_compact()))
        // The value starts where a `Select`'s does (12px in, after the
        // input's own 4px inset).
        .pl(px(8.))
        .pr(px(5.))
        .flex()
        .items_center()
        .border_1()
        .border_color(t.divider)
        .rounded(px(6.))
        .bg(t.input)
        .child(div().w_full().child(input.clone()))
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

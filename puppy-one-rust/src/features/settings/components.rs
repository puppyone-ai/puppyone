//! Equivalent of `components/SettingsControls.tsx` + `styles/settings.css`.
//! Layout only: no persistence, no platform access.
use crate::{
    theme::{self, Theme},
    ui::{column, row},
};
use gpui::{prelude::*, *};
use gpui_kit::component::{
    Disableable, Sizable,
    button::Button,
    menu::{DropdownMenu, PopupMenuItem},
};

/// `.desktop-settings-section` with its `SettingsSectionHeader`.
pub fn section(title: impl Into<SharedString>, t: Theme) -> Div {
    section_with_action(title, None, t)
}
/// `.desktop-settings-heading-row`: title with a trailing action (Refresh…).
pub fn section_with_action(
    title: impl Into<SharedString>,
    action: Option<AnyElement>,
    t: Theme,
) -> Div {
    let gap = match theme::scale() {
        crate::typography::Scale::Small => 10.,
        crate::typography::Scale::Medium => 12.,
        crate::typography::Scale::Large => 14.,
    };
    let heading = div()
        .text_size(px(theme::ty().ui.page_title))
        // `line-height: 1.25` of the page title (26.25px at Medium).
        .line_height(px(theme::ty().ui.page_title * 1.25))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.text)
        .child(title.into());
    column()
        .w_full()
        .max_w(px(theme::metric::READING_CONTENT_WIDTH))
        .mx_auto()
        .gap(px(16.))
        .child(
            row()
                .w_full()
                .min_w_0()
                .mb(px(gap))
                .justify_between()
                .gap(px(12.))
                .px(px(10.))
                .child(heading)
                .children(action),
        )
}
fn lead_row_height() -> f32 {
    match theme::scale() {
        crate::typography::Scale::Small => 50.,
        crate::typography::Scale::Medium => 54.,
        crate::typography::Scale::Large => 58.,
    }
}
/// `.desktop-settings-list.desktop-settings-lead-list`: the first row uses
/// the lead rhythm, later rows their own control height.
pub fn lead_list(rows: Vec<AnyElement>) -> Div {
    let mut list = column().w_full().gap(px(2.));
    for (index, item) in rows.into_iter().enumerate() {
        list = list.child(
            div()
                .w_full()
                .flex()
                .flex_col()
                .justify_center()
                .when(index == 0, |d| d.min_h(px(lead_row_height())))
                .child(item),
        );
    }
    list
}
/// `.desktop-settings-list` without the lead rhythm.
pub fn list(rows: Vec<AnyElement>) -> Div {
    column().w_full().gap(px(2.)).children(rows)
}
/// `SettingsSubsection`: optional title/detail; `leading` adds the lead-group gap.
pub fn subsection(
    title: Option<SharedString>,
    detail: Option<SharedString>,
    leading: bool,
    rows: Vec<AnyElement>,
    t: Theme,
) -> Div {
    let top = match theme::scale() {
        crate::typography::Scale::Small => 16.,
        crate::typography::Scale::Medium => 18.,
        crate::typography::Scale::Large => 20.,
    };
    let untitled = title.is_none();
    column()
        .w_full()
        .min_w_0()
        .gap(px(4.))
        .when(leading && title.is_some(), |d| d.pt(px(top)))
        .when_some(title, |d, title| {
            d.child(
                div()
                    .min_h(px(18.))
                    .px(px(10.))
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(18.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.subtle)
                    .child(title),
            )
        })
        .when_some(detail, |d, detail| {
            d.child(
                div()
                    .px(px(10.))
                    .mb(px(2.))
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(t.subtle)
                    .child(detail),
            )
        })
        // A titled lead subsection (`.desktop-settings-lead-group`) only adds
        // top space; an untitled one (`.desktop-settings-lead-rows`) gives its
        // first row the lead height.
        .child(if leading && untitled && !rows.is_empty() {
            lead_list(rows)
        } else {
            list(rows)
        })
}
/// `.desktop-settings-category` with header title and optional action.
pub fn category(
    title: impl Into<SharedString>,
    action: Option<AnyElement>,
    rows: Vec<AnyElement>,
    t: Theme,
) -> Div {
    let height = match theme::scale() {
        crate::typography::Scale::Small => 36.,
        crate::typography::Scale::Medium => 40.,
        crate::typography::Scale::Large => 44.,
    };
    column()
        .w_full()
        .min_w_0()
        .gap(px(7.))
        .child(
            row()
                .min_h(px(height))
                .justify_between()
                .gap(px(10.))
                .child(
                    div()
                        .text_size(px(theme::ty().ui.label))
                        .line_height(px(18.))
                        .text_color(t.muted)
                        .child(title.into()),
                )
                .children(action),
        )
        .child(list(rows))
}
/// `.desktop-settings-category-list`: categories 20px apart, inset 10px.
pub fn category_list(categories: Vec<Div>) -> Div {
    column()
        .w_full()
        .max_w(px(720.))
        .gap(px(20.))
        .px(px(10.))
        .pt(px(7.))
        .children(categories)
}
/// `.desktop-settings-row.desktop-settings-row-control`.
pub fn setting_row(label: impl Into<SharedString>, control: impl IntoElement, t: Theme) -> Div {
    row()
        .w_full()
        .min_w_0()
        .min_h(px(42.))
        .justify_between()
        .gap(px(18.))
        .px(px(10.))
        .rounded(px(theme::metric::CONTROL_RADIUS))
        .text_size(px(theme::ty().ui.label))
        .child(
            // `.desktop-settings-row > span`: 14px at `line-height: normal`.
            div()
                .flex_shrink_0()
                .max_w(px(320.))
                .line_height(px(18.))
                .text_color(t.subtle)
                .child(label.into()),
        )
        .child(control)
}
/// A control row whose label carries a second line (detail/error).
pub fn setting_row_detail(
    label: impl Into<SharedString>,
    detail: Option<(SharedString, Rgba)>,
    control: impl IntoElement,
    t: Theme,
) -> Div {
    row()
        .w_full()
        .min_w_0()
        .min_h(px(42.))
        .justify_between()
        .gap(px(18.))
        .px(px(10.))
        .text_size(px(theme::ty().ui.label))
        .child(
            column()
                .min_w_0()
                .flex_1()
                .gap(px(2.))
                .child(div().text_color(t.subtle).child(label.into()))
                .when_some(detail, |d, (detail, color)| {
                    d.child(
                        div()
                            .text_size(px(theme::ty().ui.caption))
                            .text_color(color)
                            .child(detail),
                    )
                }),
        )
        .child(control)
}
/// `SettingsValueRow`.
pub fn value_row(
    label: impl Into<SharedString>,
    value: impl Into<SharedString>,
    monospace: bool,
    action: Option<AnyElement>,
    t: Theme,
) -> Div {
    row()
        .w_full()
        .min_w_0()
        .min_h(px(theme::control()))
        .when(action.is_some(), |d| d.min_h(px(42.)))
        .justify_between()
        .gap(px(18.))
        .px(px(10.))
        .text_size(px(theme::ty().ui.label))
        .child(
            div()
                .flex_shrink_0()
                .text_color(t.subtle)
                .child(label.into()),
        )
        .child(
            row()
                .min_w_0()
                .gap(px(8.))
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_color(t.text)
                        .when(monospace, |d| {
                            d.font_family("Menlo").text_size(px(theme::ty().ui.meta))
                        })
                        .child(value.into()),
                )
                .children(action),
        )
}
/// `.desktop-settings-muted-row` / `.desktop-utility-empty`.
pub fn muted_row(text: impl Into<SharedString>, t: Theme) -> Div {
    row()
        .w_full()
        .min_h(px(theme::control()))
        .px(px(10.))
        .text_size(px(theme::ty().ui.meta))
        .text_color(t.subtle)
        .child(text.into())
}
pub fn danger_row(text: impl Into<SharedString>, t: Theme) -> Div {
    muted_row(text, t).text_color(t.danger)
}
pub fn notice(message: impl Into<SharedString>, t: Theme) -> Div {
    div()
        .px(px(10.))
        .text_size(px(theme::ty().ui.meta))
        .text_color(t.muted)
        .child(message.into())
}
/// `.desktop-settings-select`: a native `<select>` (220px max, 8px inline
/// padding). Chromium's macOS menu list adds 4px before the label and draws
/// its arrow as an 8.5×5 chevron of about 0.85px in the text colour, ending
/// at the inner border; Lucide's chevron at 16px/1.3 traces the same stroke.
pub fn select(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    disabled: bool,
    t: Theme,
    items: impl Fn() -> Vec<PopupMenuItem> + 'static,
) -> impl IntoElement {
    select_sized(id, label, disabled, (0., 220.), t, items)
}
/// `select` with the call site's `(min-width, max-width)`.
pub fn select_sized(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    disabled: bool,
    (min_width, max_width): (f32, f32),
    t: Theme,
    items: impl Fn() -> Vec<PopupMenuItem> + 'static,
) -> impl IntoElement {
    let size = theme::ty().ui.meta;
    Button::new(id)
        .small()
        .h(px(theme::control_compact()))
        .min_w(px(min_width))
        .max_w(px(max_width))
        .justify_between()
        .pl(px(12.))
        .pr(px(0.))
        .border_1()
        .border_color(t.divider)
        .rounded(px(theme::metric::CONTROL_RADIUS))
        .bg(t.input)
        .text_color(t.text)
        .when(disabled, |b| b.opacity(0.62))
        .disabled(disabled)
        // Kit's small button sizes its content layer; the label keeps 13px.
        // The label takes any width past its content (`min-width`), so the
        // arrow stays at the end as in a native select.
        .child(
            div()
                .flex_1()
                .truncate()
                .text_size(px(size))
                .line_height(px(size * 1.3))
                .child(label.into()),
        )
        // Kit's content layer owns the gap; the arrow sits 13.5px after the label.
        .child(crate::ui::icon_stroke("chevron-down", 16., 1.3, t.text).ml(px(4.5)))
        .dropdown_menu(move |mut menu, _, _| {
            for entry in items() {
                menu = menu.item(entry)
            }
            menu
        })
}

//! Product presentation primitives. Each mirrors a Web class so features
//! compose the same geometry instead of choosing their own.
use crate::theme::{self, Theme, metric};
use gpui::{prelude::*, *};
use gpui_kit::base::Button;
pub fn row() -> Div {
    div().flex().items_center()
}
pub fn column() -> Div {
    div().flex().flex_col()
}
/// Attach a product tooltip (Kit tooltip on the shared overlay layer).
pub fn tooltip(
    text: impl Into<SharedString>,
) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
    let text = text.into();
    move |window, cx| gpui_kit::component::tooltip::Tooltip::new(text.clone()).build(window, cx)
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Default,
    Primary,
    Danger,
}
/// Bordered command (`.desktop-settings-action`, `.primary`, `.danger`).
pub fn action_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    icon_name: Option<&str>,
    tone: Tone,
    disabled: bool,
    t: Theme,
) -> Button {
    action_button_sized(
        id,
        label,
        icon_name.map(|name| (name, 13.)),
        tone,
        disabled,
        t,
    )
}
/// `action_button` with the call site's Lucide icon size.
pub fn action_button_sized(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    icon: Option<(&str, f32)>,
    tone: Tone,
    disabled: bool,
    t: Theme,
) -> Button {
    let label = label.into();
    let (border, bg, fg, hover) = match tone {
        Tone::Default => (t.divider, theme::alpha(t.text, 0.), t.muted, t.hover),
        Tone::Primary => (
            theme::alpha(t.accent, 0.28),
            theme::alpha(t.accent, 0.09),
            t.accent,
            theme::alpha(t.accent, 0.14),
        ),
        Tone::Danger => (
            theme::alpha(t.danger, 0.22),
            theme::alpha(t.danger, 0.07),
            t.danger,
            theme::alpha(t.danger, 0.12),
        ),
    };
    let mut b = Button::new(id)
        .accessibility_label(label.clone())
        .disabled(disabled)
        .flex()
        .items_center()
        .justify_center()
        .flex_shrink_0()
        .gap(px(6.))
        .h(px(theme::control_compact()))
        .px(px(9.))
        .border_1()
        .border_color(border)
        .rounded(px(metric::CONTROL_RADIUS))
        .bg(bg)
        .text_color(fg)
        .text_size(px(theme::ty().ui.meta))
        .font_weight(FontWeight::MEDIUM)
        .when(disabled, |b| b.opacity(0.62))
        .when(!disabled, |b| {
            b.cursor(theme::clickable_cursor()).hover(move |s| {
                s.bg(hover)
                    .text_color(if tone == Tone::Default { t.text } else { fg })
            })
        });
    if let Some((name, size)) = icon {
        b = b.child(icon_stroke(name, size, 2., fg));
    }
    b.child(label)
}
pub fn icon_sized(name: &str, size: f32, color: Rgba) -> Svg {
    svg()
        .path(format!("icons/{name}.svg"))
        .size(px(size))
        .flex_shrink_0()
        .text_color(color)
}
/// Lucide icon at the product call site's `strokeWidth` (`icons/<name>@<stroke>.svg`).
pub fn icon_stroke(name: &str, size: f32, stroke: f32, color: Rgba) -> Svg {
    svg()
        .path(format!("icons/{name}@{stroke}.svg"))
        .size(px(size))
        .flex_shrink_0()
        .text_color(color)
}
/// `.desktop-terminal-launcher-discovery-spinner`: a ring in `track` whose top
/// arc in `color` turns once every 900ms.
pub fn spinner_ring(id: impl Into<ElementId>, size: f32, track: Rgba, color: Rgba) -> Div {
    div()
        .relative()
        .size(px(size))
        .child(
            svg()
                .path("icons/spinner-track.svg")
                .absolute()
                .size(px(size))
                .text_color(track),
        )
        .child(
            svg()
                .path("icons/spinner-arc.svg")
                .absolute()
                .size(px(size))
                .text_color(color)
                .with_animation(
                    id,
                    Animation::new(std::time::Duration::from_millis(900)).repeat(),
                    |arc, delta| {
                        arc.with_transformation(Transformation::rotate(radians(
                            delta * std::f32::consts::TAU,
                        )))
                    },
                ),
        )
}
/// Kit menu icon from the product asset set.
pub fn menu_icon(name: &str) -> gpui_kit::component::Icon {
    gpui_kit::component::Icon::empty().path(format!("icons/{name}.svg"))
}
/// Compact square icon command (`.po-sidebar-icon-button`, titlebar actions).
pub fn icon_button(id: impl Into<ElementId>, name: &str, t: Theme) -> Button {
    Button::new(id)
        .accessibility_label(name.replace('-', " "))
        .flex()
        .items_center()
        .justify_center()
        .flex_shrink_0()
        .size(px(theme::control_compact()))
        .rounded(px(metric::CONTROL_RADIUS))
        .cursor(theme::clickable_cursor())
        .text_color(t.muted)
        .hover(move |s| s.bg(t.hover).text_color(t.text))
        .child(icon_sized(name, 15., t.utility))
}
/// Labelled icon button with an explicit accessible label and tooltip.
pub fn labelled_icon_button(
    id: impl Into<ElementId>,
    name: &str,
    label: impl Into<SharedString>,
    t: Theme,
) -> Button {
    let label = label.into();
    icon_button(id, name, t)
        .accessibility_label(label.clone())
        .tooltip(tooltip(label))
}

/// `.desktop-settings-switch`: 34×20 track, 14px thumb, accent when on.
pub fn switch(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    checked: bool,
    disabled: bool,
    t: Theme,
    on_change: impl Fn(bool, &mut Window, &mut App) + 'static,
) -> Button {
    let track_border = if checked {
        theme::mix(t.accent, t.divider, 0.52)
    } else {
        t.divider
    };
    let track = if checked {
        theme::mix(t.accent, t.control, 0.18)
    } else {
        t.control
    };
    let thumb = if checked { t.accent } else { t.subtle };
    Button::new(id)
        .accessibility_label(label.into())
        .disabled(disabled)
        .relative()
        .flex_shrink_0()
        .w(px(metric::SWITCH_WIDTH))
        .h(px(metric::SWITCH_HEIGHT))
        .rounded_full()
        .border_1()
        .border_color(track_border)
        .bg(track)
        // A disabled product switch only loses its pointer cursor.
        .when(!disabled, |b| b.cursor(theme::clickable_cursor()))
        .child(
            div()
                .absolute()
                .top(px(2.))
                .left(px(if checked { 16. } else { 2. }))
                .size(px(metric::SWITCH_THUMB))
                .rounded_full()
                .bg(thumb),
        )
        .on_click(move |_, window, cx| {
            if !disabled {
                on_change(!checked, window, cx)
            }
        })
}

/// One option in a `.desktop-theme-segment`.
pub struct SegmentOption {
    pub label: SharedString,
    pub leading: Option<AnyElement>,
    pub active: bool,
    pub disabled: bool,
    pub on_select: SelectHandler,
}
pub type SelectHandler = Box<dyn Fn(&mut Window, &mut App)>;
/// How a `.desktop-theme-segment` sizes its options.
#[derive(Clone, Copy, PartialEq)]
pub enum SegmentLayout {
    /// Content-sized options, 8px inline padding.
    Plain,
    /// `.desktop-appearance-option-segment`: `min(100%, width)` split into
    /// equal columns; 6px padding and truncated labels.
    Grid(f32),
    /// `.desktop-appearance-hug-segment`: content-sized, 6px padding.
    Hug,
    /// Content-sized with a minimum option width (`.desktop-interface-style-segment`).
    MinWidth(f32),
}
/// `.desktop-theme-segment`: 2px inset group of quiet options.
pub fn segment(id: impl Into<SharedString>, options: Vec<SegmentOption>, t: Theme) -> Div {
    segment_with(id, options, SegmentLayout::Plain, t)
}
pub fn segment_with(
    id: impl Into<SharedString>,
    options: Vec<SegmentOption>,
    layout: SegmentLayout,
    t: Theme,
) -> Div {
    let id = id.into();
    let size = theme::ty().ui.meta;
    let grid = matches!(layout, SegmentLayout::Grid(_));
    row()
        .flex_shrink_0()
        .gap(px(2.))
        .p(px(2.))
        .rounded(px(7.))
        .bg(t.control)
        .when_some(
            match layout {
                SegmentLayout::Grid(width) => Some(width),
                _ => None,
            },
            |d, width| d.w(px(width)).max_w_full().min_w_0().flex_shrink(1.),
        )
        .children(options.into_iter().enumerate().map(|(index, option)| {
            let active = option.active;
            let disabled = option.disabled;
            let select = option.on_select;
            let padding = match layout {
                SegmentLayout::Grid(_) | SegmentLayout::Hug => 6.,
                _ => 8.,
            };
            let mut b = Button::new(SharedString::from(format!("{id}-{index}")))
                .accessibility_label(option.label.clone())
                .selected(active)
                .disabled(disabled)
                .flex()
                .items_center()
                .justify_center()
                .gap(px(5.))
                .h(px(theme::control_small()))
                .px(px(padding))
                .rounded(px(5.))
                .text_size(px(size))
                .line_height(px(17.))
                .text_color(if active { t.text } else { t.muted })
                .when(grid, |b| b.flex_1().flex_basis(px(0.)).min_w_0())
                .when_some(
                    match layout {
                        SegmentLayout::MinWidth(width) => Some(width),
                        _ => None,
                    },
                    |b, width| b.min_w(px(width)),
                )
                .when(active, |b| b.bg(t.selected).font_weight(FontWeight::MEDIUM))
                .when(disabled, |b| b.opacity(0.5))
                .when(!disabled, |b| {
                    b.cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(t.selected).text_color(t.text))
                })
                .on_click(move |_, window, cx| {
                    if !disabled {
                        select(window, cx)
                    }
                });
            if let Some(leading) = option.leading {
                b = b.child(div().flex_shrink_0().child(leading));
            }
            b.child(
                div()
                    .min_w_0()
                    .when(grid, |d| d.truncate())
                    .child(option.label),
            )
        }))
}

/// `.po-desktop-sidebar-group`: optional title row; groups after the first
/// get a full-bleed divider 5px into their 12px top gap.
pub fn sidebar_group(title: Option<SharedString>, first: bool, t: Theme) -> Div {
    let mut group = column().relative().min_w_0();
    if !first {
        group = group.pt(px(metric::SIDEBAR_GROUP_GAP)).child(
            div()
                .absolute()
                .top(px(metric::SIDEBAR_GROUP_DIVIDER_TOP))
                .left(px(-metric::SIDEBAR_ROW_LEFT_GAP))
                .right(px(-metric::SIDEBAR_ROW_RIGHT_GAP))
                .h(px(1.))
                .bg(t.sidebar_divider),
        );
    }
    if let Some(title) = title {
        group = group.child(
            row()
                .w_full()
                .h(px(theme::control()))
                .flex_shrink_0()
                .px(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
                .text_size(px(theme::ty().left.meta))
                .line_height(px(theme::ty().left.line_height))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.subtle)
                .child(title),
        );
    }
    group
}
/// `.po-sidebar-row`.
pub fn sidebar_row(
    id: impl Into<ElementId>,
    icon_name: Option<&str>,
    label: impl Into<SharedString>,
    active: bool,
    disabled: bool,
    t: Theme,
) -> Button {
    let label = label.into();
    let fg = if active { t.text } else { t.muted };
    let mut b = Button::new(id)
        .accessibility_label(label.clone())
        .selected(active)
        .disabled(disabled)
        .flex()
        .items_center()
        .w_full()
        .min_w_0()
        .flex_shrink_0()
        .gap(px(6.))
        .h(px(theme::control()))
        .my(px(1.))
        .pl(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
        .pr(px(metric::SIDEBAR_ROW_CONTENT_RIGHT))
        .rounded(px(metric::SIDEBAR_ROW_RADIUS))
        .text_size(px(theme::ty().left.content))
        .line_height(px(theme::ty().left.line_height))
        .text_color(fg)
        .when(active, |b| b.bg(t.selected))
        .when(disabled, |b| b.opacity(0.42))
        .when(!disabled, |b| {
            b.cursor(theme::clickable_cursor()).hover(move |s| {
                s.bg(if active { t.selected } else { t.hover })
                    .text_color(t.text)
            })
        });
    if let Some(name) = icon_name {
        b = b.child(icon_sized(name, 15., fg));
    }
    b.child(div().flex_1().min_w_0().truncate().child(label))
}

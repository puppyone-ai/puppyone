//! `.desktop-theme-segment`: a 2px-inset group of quiet options, on GPUI
//! Kit's headless toggle group (each option is a pressed/unpressed toggle).
use crate::{theme, ui::appearance::ActiveAppearance};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable, StyledExt as _, Toggle, ToggleGroup};
use std::rc::Rc;

type SelectHandler = Rc<dyn Fn(&mut Window, &mut App)>;

/// How a segmented control sizes its options.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum SegmentLayout {
    /// Content-sized options, 8px inline padding.
    #[default]
    Plain,
    /// `min(100%, width)` split into equal, truncating columns.
    Equal(f32),
    /// Content-sized, 6px padding.
    Hug,
    /// Hug, but the first option has its own inline padding.
    HugFirst(f32),
    /// Content-sized with a minimum option width.
    MinWidth(f32),
}

/// One option of a [`SegmentedControl`].
pub struct Segment {
    label: SharedString,
    leading: Option<AnyElement>,
    selected: bool,
    disabled: bool,
    on_select: Option<SelectHandler>,
}
impl Segment {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            leading: None,
            selected: false,
            disabled: false,
            on_select: None,
        }
    }
    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    pub fn on_select(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(handler));
        self
    }
}
impl Disableable for Segment {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

#[derive(IntoElement)]
pub struct SegmentedControl {
    id: SharedString,
    layout: SegmentLayout,
    segments: Vec<Segment>,
    tooltip: Option<SharedString>,
    style: StyleRefinement,
}
impl SegmentedControl {
    pub fn new(id: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            layout: SegmentLayout::Plain,
            segments: vec![],
            tooltip: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn layout(mut self, layout: SegmentLayout) -> Self {
        self.layout = layout;
        self
    }
    pub fn tooltip(mut self, text: impl Into<SharedString>) -> Self {
        self.tooltip = Some(text.into());
        self
    }
    pub fn segment(mut self, segment: Segment) -> Self {
        self.segments.push(segment);
        self
    }
    pub fn segments(mut self, segments: impl IntoIterator<Item = Segment>) -> Self {
        self.segments.extend(segments);
        self
    }
}
impl Styled for SegmentedControl {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for SegmentedControl {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let layout = self.layout;
        let equal = matches!(layout, SegmentLayout::Equal(_));
        let id = self.id.clone();
        ToggleGroup::new(self.id)
            .flex()
            .items_center()
            .flex_shrink_0()
            .gap(px(2.))
            .p(px(2.))
            .rounded(px(7.))
            .bg(t.control)
            .when_some(self.tooltip, |d, text| d.tooltip(super::tooltip(text)))
            .when_some(
                match layout {
                    SegmentLayout::Equal(width) => Some(width),
                    _ => None,
                },
                |d, width| d.w(px(width)).max_w_full().min_w_0().flex_shrink(1.),
            )
            .children(
                self.segments
                    .into_iter()
                    .enumerate()
                    .map(|(index, segment)| {
                        let active = segment.selected;
                        let disabled = segment.disabled;
                        let padding = match layout {
                            SegmentLayout::HugFirst(first) if index == 0 => first,
                            SegmentLayout::Equal(_)
                            | SegmentLayout::Hug
                            | SegmentLayout::HugFirst(_) => 6.,
                            _ => 8.,
                        };
                        Toggle::new(SharedString::from(format!("{id}-{index}")))
                            .accessibility_label(segment.label.clone())
                            .pressed(active)
                            .disabled(disabled)
                            .flex()
                            .items_center()
                            .justify_center()
                            .gap(px(5.))
                            .h(px(theme::control_small()))
                            .px(px(padding))
                            .rounded(px(5.))
                            .text_size(px(theme::ty().ui.meta))
                            .line_height(px(17.))
                            .text_color(if active { t.text } else { t.muted })
                            .when(equal, |b| b.flex_1().flex_basis(px(0.)).min_w_0())
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
                            .when_some(segment.on_select.filter(|_| !disabled), |b, select| {
                                b.on_change(move |_, _, window, cx| select(window, cx))
                            })
                            .children(
                                segment
                                    .leading
                                    .map(|leading| div().flex_shrink_0().child(leading)),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .when(equal, |d| d.truncate())
                                    .child(segment.label),
                            )
                    }),
            )
            .refine_style(&self.style)
    }
}

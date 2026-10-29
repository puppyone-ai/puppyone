//! A native `<input type="checkbox">` as the product shows it (Chromium's
//! 13px box in a 14px slot), optionally with its label. [`Checkbox`] is
//! presentational: unchecked, with a tooltip saying why it is inert.
//! [`native_checkbox`] draws the box alone, checked or not, for a row that
//! owns the interaction (the row is the `<label>`).
use super::tooltip;
use crate::{theme, ui::appearance::ActiveAppearance};
use gpui::{prelude::*, *};
use gpui_kit::base::StyledExt as _;

#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    label: Option<SharedString>,
    tooltip: Option<SharedString>,
    style: StyleRefinement,
}
impl Checkbox {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            label: None,
            tooltip: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    pub fn tooltip(mut self, text: impl Into<SharedString>) -> Self {
        self.tooltip = Some(text.into());
        self
    }
}
impl Styled for Checkbox {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
/// A native checkbox's box alone. `accent` is the `accent-color`
/// (`var(--po-accent)`) of a 14px box sized in CSS; without it the default
/// 13px box takes Chromium's own colours.
pub fn native_checkbox(checked: bool, accent: bool, cx: &App) -> Div {
    let t = cx.palette();
    let size = if accent { 14. } else { 13. };
    let (fill, mark) = theme::native_checkbox_checked(t.dark, accent.then_some(t.accent));
    let (unchecked, border) = theme::native_checkbox(t.dark);
    div()
        .flex()
        .flex_shrink_0()
        .size(px(size))
        .items_center()
        .justify_center()
        .rounded(px(2.))
        .when(checked, |d| {
            d.bg(fill).child(
                svg()
                    .path("icons/native-check.svg")
                    .size(px(size))
                    .text_color(mark),
            )
        })
        .when(!checked, |d| {
            d.border(px(0.5)).border_color(border).bg(unchecked)
        })
}
impl RenderOnce for Checkbox {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let (fill, border) = theme::native_checkbox(t.dark);
        // Inline with an 18px label line, the box's 3px margins sit on the
        // text baseline and lift the line box to 20px: the box lands 3px
        // from the top, the text 2px.
        div()
            .id(self.id)
            .flex()
            .items_start()
            .gap(px(5.))
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .size(px(14.))
                    .mt(px(2.5))
                    .ml(px(4.))
                    .items_center()
                    .justify_center()
                    .child(
                        div()
                            .size(px(13.))
                            .rounded(px(2.))
                            .border(px(0.5))
                            .border_color(border)
                            .bg(fill),
                    ),
            )
            .children(self.label.map(|label| div().mt(px(2.)).child(label)))
            .when_some(self.tooltip, |d, text| d.tooltip(tooltip(text)))
            .refine_style(&self.style)
    }
}

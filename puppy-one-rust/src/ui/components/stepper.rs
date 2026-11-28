//! `Stepper`: a whole number moved one at a time, fewer and more either side
//! of it, in the frame the product's inputs and selects share (compact
//! control height, divider border, control radius, input fill, meta size).
//! The number stands alone; what it counts is said by the label beside it.
use super::{Icon, IconButton};
use crate::{
    localization::format_number,
    theme::{self, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable, h_flex},
    component::Sizable as _,
};
use std::rc::Rc;

type ChangeHandler = Rc<dyn Fn(u64, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Stepper {
    id: SharedString,
    value: u64,
    minimum: u64,
    maximum: u64,
    fewer: SharedString,
    more: SharedString,
    disabled: bool,
    on_change: Option<ChangeHandler>,
}
impl Stepper {
    /// Its buttons are `{id}-less` and `{id}-more`.
    pub fn new(id: impl Into<SharedString>, value: u64) -> Self {
        Self {
            id: id.into(),
            value,
            minimum: 0,
            maximum: u64::MAX,
            fewer: SharedString::default(),
            more: SharedString::default(),
            disabled: false,
            on_change: None,
        }
    }
    pub fn range(mut self, minimum: u64, maximum: u64) -> Self {
        self.minimum = minimum;
        self.maximum = maximum.max(minimum);
        self
    }
    /// The accessible names of its two buttons ("Fewer: People").
    pub fn labels(mut self, fewer: impl Into<SharedString>, more: impl Into<SharedString>) -> Self {
        self.fewer = fewer.into();
        self.more = more.into();
        self
    }
    pub fn on_change(mut self, handler: impl Fn(u64, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}
impl Disableable for Stepper {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl RenderOnce for Stepper {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let meta = theme::ty().ui.meta;
        let value = self.value.clamp(self.minimum, self.maximum);
        let step = |suffix: &str, icon: &str, label: SharedString, to: u64, enabled: bool| {
            let handler = self.on_change.clone();
            IconButton::new(
                SharedString::from(format!("{}-{suffix}", self.id)),
                Icon::new(SharedString::from(icon.to_owned()))
                    .with_size(px(14.))
                    .stroke(1.6),
            )
            .xsmall()
            .label(label)
            .no_tooltip()
            .disabled(self.disabled || !enabled)
            .on_click(move |_, window, cx| {
                if let Some(handler) = &handler {
                    handler(to, window, cx);
                }
            })
        };
        h_flex()
            .id(self.id.clone())
            .flex_none()
            .h(px(theme::control_compact()))
            .px(px(2.))
            .gap(px(2.))
            .border_1()
            .border_color(t.divider)
            .rounded(px(metric::CONTROL_RADIUS))
            .bg(t.input)
            .text_color(t.text)
            .text_size(px(meta))
            .line_height(px(meta * 1.3))
            .when(self.disabled, |d| d.opacity(0.62))
            .child(step(
                "less",
                "minus",
                self.fewer.clone(),
                value.saturating_sub(1).max(self.minimum),
                value > self.minimum,
            ))
            .child(
                div()
                    .min_w(px(28.))
                    .px(px(2.))
                    .text_center()
                    .whitespace_nowrap()
                    .child(format_number(value as i64)),
            )
            .child(step(
                "more",
                "plus",
                self.more.clone(),
                value.saturating_add(1).min(self.maximum),
                value < self.maximum,
            ))
    }
}

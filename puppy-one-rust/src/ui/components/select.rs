//! `.desktop-settings-select`: a field-like trigger showing the current
//! value, opening a menu of options with the current one checked.
use super::{Icon, Menu, MenuItem, PopoverMenu};
use crate::{
    theme::{self, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Button as BaseButton, Disableable, Selectable},
    component::Sizable as _,
};
use std::rc::Rc;

type SelectHandler = Rc<dyn Fn(&mut Window, &mut App)>;

/// One option of a [`Select`].
pub struct SelectOption {
    label: SharedString,
    selected: bool,
    disabled: bool,
    on_select: Option<SelectHandler>,
}
impl SelectOption {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            selected: false,
            disabled: false,
            on_select: None,
        }
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
impl Disableable for SelectOption {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

/// Options are built when the menu opens, so they always reflect current state.
type Options = Rc<dyn Fn(&mut App) -> Vec<SelectOption>>;

#[derive(IntoElement)]
pub struct Select {
    id: ElementId,
    value: SharedString,
    disabled: bool,
    min_width: f32,
    max_width: f32,
    options: Options,
}
impl Select {
    pub fn new(
        id: impl Into<ElementId>,
        value: impl Into<SharedString>,
        options: impl Fn(&mut App) -> Vec<SelectOption> + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            value: value.into(),
            disabled: false,
            min_width: 0.,
            max_width: 220.,
            options: Rc::new(options),
        }
    }
    /// The trigger's `(min-width, max-width)`.
    pub fn width_range(mut self, min: f32, max: f32) -> Self {
        self.min_width = min;
        self.max_width = max;
        self
    }
}
impl Disableable for Select {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl RenderOnce for Select {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let trigger = SelectTrigger {
            id: super::menu::child_id(&self.id, "trigger"),
            value: self.value,
            disabled: self.disabled,
            open: false,
            min_width: self.min_width,
            max_width: self.max_width,
        };
        let options = self.options;
        let width = self.max_width;
        PopoverMenu::new(self.id)
            .trigger(trigger)
            .menu(move |menu: Menu, _, cx| {
                menu.min_w(px(width.min(180.)))
                    .items(options(cx).into_iter().map(|option| {
                        let handler = option.on_select.clone();
                        MenuItem::new(option.label)
                            .checked(option.selected)
                            .disabled(option.disabled)
                            .on_click(move |window, cx| {
                                if let Some(handler) = &handler {
                                    handler(window, cx)
                                }
                            })
                    }))
            })
    }
}
#[derive(IntoElement)]
struct SelectTrigger {
    id: ElementId,
    value: SharedString,
    disabled: bool,
    open: bool,
    min_width: f32,
    max_width: f32,
}
impl Selectable for SelectTrigger {
    fn selected(mut self, selected: bool) -> Self {
        self.open = selected;
        self
    }
    fn is_selected(&self) -> bool {
        self.open
    }
}
impl RenderOnce for SelectTrigger {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let size = theme::ty().ui.meta;
        BaseButton::new(self.id)
            .accessibility_label(self.value.clone())
            .disabled(self.disabled)
            .flex()
            .items_center()
            .justify_between()
            .gap(px(8.))
            .h(px(theme::control_compact()))
            .min_w(px(self.min_width))
            .max_w(px(self.max_width))
            // A native menu list: its arrow ends at the inner border.
            .pl(px(12.))
            .pr(px(0.))
            .border_1()
            .border_color(if self.open { t.focus_ring } else { t.divider })
            .rounded(px(metric::CONTROL_RADIUS))
            .bg(t.input)
            .text_color(t.text)
            .when(self.disabled, |b| b.opacity(0.62))
            .when(!self.disabled, |b| b.cursor(theme::clickable_cursor()))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(size))
                    .line_height(px(size * 1.3))
                    .child(self.value),
            )
            .child(
                Icon::new("chevron-down")
                    .with_size(px(16.))
                    .stroke(1.3)
                    .color(t.text),
            )
    }
}

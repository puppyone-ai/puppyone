//! `.desktop-settings-switch` on GPUI Kit's headless switch: 34×20 track,
//! 14px thumb, accent when on.
use crate::{
    theme::{self, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable, StyledExt as _, Switch as BaseSwitch};
use std::rc::Rc;

type ChangeHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Switch {
    id: ElementId,
    label: SharedString,
    checked: bool,
    disabled: bool,
    on_change: Option<ChangeHandler>,
    style: StyleRefinement,
}
impl Switch {
    /// `label` is the accessible name.
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            checked: false,
            disabled: false,
            on_change: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }
    pub fn on_change(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}
impl Disableable for Switch {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl Styled for Switch {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for Switch {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let checked = self.checked;
        let (border, track, thumb) = if checked {
            (
                theme::mix(t.accent, t.divider, 0.52),
                theme::mix(t.accent, t.control, 0.18),
                t.accent,
            )
        } else {
            (t.divider, t.control, t.subtle)
        };
        BaseSwitch::new(self.id)
            .accessibility_label(self.label)
            .checked(checked)
            .disabled(self.disabled)
            .relative()
            .flex_shrink_0()
            .w(px(metric::SWITCH_WIDTH))
            .h(px(metric::SWITCH_HEIGHT))
            .rounded_full()
            .border_1()
            .border_color(border)
            .bg(track)
            // A disabled product switch only loses its pointer cursor.
            .when(!self.disabled, |s| s.cursor(theme::clickable_cursor()))
            .when_some(self.on_change, |s, handler| {
                s.on_change(move |checked, _, window, cx| handler(checked, window, cx))
            })
            .child(
                div()
                    .absolute()
                    .top(px(2.))
                    .left(px(if checked { 16. } else { 2. }))
                    .size(px(metric::SWITCH_THUMB))
                    .rounded_full()
                    .bg(thumb),
            )
            .refine_style(&self.style)
    }
}

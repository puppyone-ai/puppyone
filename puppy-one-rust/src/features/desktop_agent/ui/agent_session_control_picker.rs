//! Kit owns picker focus, keyboard navigation and popup dismissal.
use super::*;
use gpui_kit::component::{
    Disableable,
    button::{Button, ButtonVariants},
    menu::{DropdownMenu, PopupMenuItem},
};
#[derive(Clone)]
pub(super) enum Selection {
    Model(Option<String>),
    Mode(String),
    Effort(String),
}
impl AgentChat {
    pub(super) fn picker(
        &self,
        id: &'static str,
        label: String,
        choices: Vec<(String, Selection, bool)>,
        width: f32,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let host = cx.weak_entity();
        let t = Theme::new(self.dark);
        let a = super::agent_theme::AgentTheme::new(&t);
        let disabled = self.session.busy();
        // `.desktop-agent-composer-picker .desktop-agent-picker-trigger`:
        // quiet 14px label, no indicator, bounded width, row hover.
        let variant = gpui_kit::component::button::ButtonCustomVariant::new(cx)
            .color(crate::theme::alpha(a.row_hover, 0.).into())
            .foreground(a.text_subtle.into())
            .hover(a.row_hover.into())
            .active(a.row_hover.into());
        Button::new(id)
            .custom(variant)
            .h(px(crate::theme::control()))
            .px(px(8.))
            .py_0()
            .rounded(px(crate::theme::metric::CONTROL_RADIUS))
            .text_color(a.text_subtle)
            .text_size(px(crate::theme::ty().left.content))
            .font_weight(FontWeight::NORMAL)
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(crate::theme::ty().left.content))
                    .line_height(px(crate::theme::ty().left.line_height))
                    .child(label),
            )
            .flex_shrink(1.)
            .min_w_0()
            .max_w(px(width))
            .overflow_hidden()
            .when(disabled, |b| b.opacity(0.45))
            .disabled(disabled)
            .dropdown_menu(move |mut menu, _, _| {
                for (label, selection, checked) in &choices {
                    let host = host.clone();
                    let selection = selection.clone();
                    menu = menu.item(
                        PopupMenuItem::new(label.clone())
                            .checked(*checked)
                            .on_click(move |_, _, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    match &selection {
                                        Selection::Model(id) => s.session.select_model(id.clone()),
                                        Selection::Mode(id) => s.session.select_mode(id.clone()),
                                        Selection::Effort(id) => {
                                            s.session.select_effort(id.clone())
                                        }
                                    }
                                    cx.notify()
                                });
                            }),
                    );
                }
                menu
            })
            .into_any_element()
    }
}

//! Kit owns picker focus, keyboard navigation and popup dismissal.
use super::*;
use gpui_kit::component::{
    Disableable, IconName, Sizable,
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
        // `.desktop-agent-picker` in the composer: quiet label, chevron, bounded width.
        Button::new(id)
            .ghost()
            .small()
            .compact()
            .px(px(8.))
            .gap(px(4.))
            .text_color(t.subtle)
            .text_size(px(crate::theme::ty().left.meta))
            .child(div().min_w_0().truncate().child(label))
            .child(gpui_kit::component::Icon::new(IconName::ChevronDown).size(px(12.)))
            .flex_shrink(1.)
            .min_w_0()
            .max_w(px(width))
            .overflow_hidden()
            .disabled(self.session.busy())
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

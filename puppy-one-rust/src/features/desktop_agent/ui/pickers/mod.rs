//! `AgentSessionControlPicker`: the model, effort and mode pickers of the
//! composer toolbar and of `BuiltInAgentCompute`. One picker is open at a
//! time; a choice leaves as [`PickerEvent::Select`].
use super::agent_theme::AgentTheme;
use super::elements::effort_label;
use crate::features::desktop_agent::domain::agent_session_controls::{
    AgentSessionControl, AgentSessionControlId,
};
use crate::localization::{Arg, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, Menu, MenuItem, MenuVariant};
use crate::ui::form_input::TextInput;
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;
use gpui_kit::component::Sizable as _;

/// `agentPickerLimits.maxRenderedOptions`.
const MAX_RENDERED: usize = 120;
const PICKER_MAX_HEIGHT: f32 = 360.;
const PICKER_OFFSET: f32 = 8.;

/// A picker's choice.
pub enum PickerEvent {
    Select {
        id: AgentSessionControlId,
        value: String,
    },
}
impl EventEmitter<PickerEvent> for SessionPickers {}

pub struct SessionPickers {
    open: Option<AgentSessionControlId>,
    /// The option the keyboard moved to.
    active: Option<usize>,
    query: Entity<TextInput>,
    focus: FocusHandle,
    scroll: ScrollHandle,
}

impl SessionPickers {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let query = cx.new(|cx| {
            let mut input = TextInput::new("", false, 200, window, cx);
            input.appearance = false;
            input
        });
        cx.observe(&query, |s: &mut Self, _, cx| {
            s.active = None;
            cx.notify()
        })
        .detach();
        Self {
            open: None,
            active: None,
            query,
            focus: cx.focus_handle(),
            scroll: ScrollHandle::new(),
        }
    }
    /// Dev captures: `id`'s picker shows open.
    #[cfg(feature = "dev-capture")]
    pub fn lab_open(&mut self, id: AgentSessionControlId, cx: &mut Context<Self>) {
        self.open = Some(id);
        cx.notify();
    }
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.open = None;
        self.active = None;
        self.query.update(cx, |q, cx| q.clear(cx));
        cx.notify();
    }

    /// `AgentSessionControlPicker`: `control`'s trigger, and its options
    /// while open.
    pub fn picker(
        &self,
        control: &AgentSessionControl,
        width: f32,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let id = control.id;
        let label = control
            .value
            .as_ref()
            .and_then(|value| control.options.iter().find(|o| &o.value == value))
            .map(|option| {
                if id == AgentSessionControlId::Effort {
                    effort_label(&option.value)
                } else {
                    option.label.clone()
                }
            })
            .unwrap_or_else(|| {
                t(match id {
                    AgentSessionControlId::Model => "agent.model.placeholder",
                    AgentSessionControlId::Effort => "agent.effort.placeholder",
                    AgentSessionControlId::Mode => "agent.mode.placeholder",
                })
                .to_string()
            });
        let open = self.open == Some(id);
        let searchable = control.options.len() > 6;
        let trigger = div()
            .id(SharedString::from(format!("agent-picker-{id:?}")))
            .h(px(theme::control_compact()))
            .px(px(6.))
            .flex()
            .items_center()
            .min_w_0()
            .max_w(px(width))
            .overflow_hidden()
            .rounded(px(theme::metric::CONTROL_RADIUS))
            .text_color(a.text_subtle)
            .when(disabled, |d| d.opacity(0.45))
            .when(!disabled, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(a.row_hover))
                    .on_click(cx.listener(move |s, _, window, cx| {
                        if s.open == Some(id) {
                            s.close(cx);
                            return;
                        }
                        s.open = Some(id);
                        s.active = None;
                        s.query.update(cx, |q, cx| q.clear(cx));
                        if searchable {
                            s.query.read(cx).focus_handle(cx).focus(window, cx);
                        } else {
                            s.focus.focus(window, cx);
                        }
                        cx.notify();
                    }))
            })
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(theme::ty().left.content))
                    .line_height(px(theme::ty().left.line_height))
                    .child(label),
            );
        let mut root = div().relative().flex_shrink(1.).min_w_0().child(trigger);
        if open {
            root = root.child(
                div().absolute().top_0().left_0().child(
                    deferred(
                        anchored()
                            .anchor(Anchor::BottomLeft)
                            .offset(point(px(0.), px(-PICKER_OFFSET)))
                            .snap_to_window_with_margin(px(8.))
                            .child(self.popover(control, cx)),
                    )
                    .with_priority(1),
                ),
            );
        }
        root.into_any_element()
    }

    fn popover(&self, control: &AgentSessionControl, cx: &mut Context<Self>) -> Menu {
        let t_ = cx.palette();
        let m = theme::ty();
        let id = control.id;
        let width = if id == AgentSessionControlId::Model {
            248.
        } else {
            148.
        };
        let searchable = control.options.len() > 6;
        let query = self.query.read(cx).text().trim().to_lowercase();
        let matched: Vec<(String, String, bool)> = control
            .options
            .iter()
            .filter(|option| {
                query.is_empty()
                    || option.label.to_lowercase().contains(&query)
                    || option
                        .keywords
                        .as_deref()
                        .is_some_and(|k| k.to_lowercase().contains(&query))
            })
            .map(|option| {
                let label = if id == AgentSessionControlId::Effort {
                    effort_label(&option.value)
                } else {
                    option.label.clone()
                };
                (
                    label,
                    option.value.clone(),
                    control.value.as_deref() == Some(option.value.as_str()),
                )
            })
            .collect();
        let total = matched.len();
        let shown: Vec<(String, String, bool)> = matched.into_iter().take(MAX_RENDERED).collect();
        let active = self
            .active
            .or_else(|| shown.iter().position(|(_, _, selected)| *selected))
            .unwrap_or(0);
        let count = shown.len();
        let keyed = shown.clone();
        let host = cx.weak_entity();
        let mut menu = Menu::new(SharedString::from(format!("agent-picker-{id:?}-popover")))
            .variant(MenuVariant::RightRail)
            .w(px(width))
            .max_h(px(PICKER_MAX_HEIGHT))
            .scroll_handle(self.scroll.clone())
            .track_focus(&self.focus)
            .on_mouse_down_out(cx.listener(|s, _, _, cx| s.close(cx)))
            .on_key_down(cx.listener(move |s, event: &KeyDownEvent, _, cx| {
                let next = match event.keystroke.key.as_str() {
                    "escape" => {
                        s.close(cx);
                        cx.stop_propagation();
                        return;
                    }
                    "enter" => {
                        if let Some((_, value, _)) = keyed.get(active) {
                            cx.emit(PickerEvent::Select {
                                id,
                                value: value.clone(),
                            });
                            s.close(cx);
                        }
                        cx.stop_propagation();
                        return;
                    }
                    "down" => (active + 1).min(count.saturating_sub(1)),
                    "up" => active.saturating_sub(1),
                    "home" => 0,
                    "end" => count.saturating_sub(1),
                    _ => return,
                };
                s.active = Some(next);
                cx.stop_propagation();
                cx.notify();
            }));
        if searchable {
            menu = menu.header(
                h_flex()
                    .min_h(px(36.))
                    .px(px(8.))
                    .gap(px(7.))
                    .border_b_1()
                    .border_color(t_.divider)
                    .child(
                        Icon::new("search")
                            .with_size(px(13.))
                            .stroke(2.)
                            .color(t_.subtle),
                    )
                    .child(div().flex_1().min_w_0().child(self.query.clone())),
            );
        }
        for (index, (label, value, selected)) in shown.into_iter().enumerate() {
            let highlighted = selected || self.active == Some(index);
            let host = host.clone();
            let mut item = MenuItem::new(label)
                .id(("agent-panel-picker-option", index))
                .selected(highlighted)
                .on_click(move |_, cx| {
                    let _ = host.update(cx, |s, cx| {
                        cx.emit(PickerEvent::Select {
                            id,
                            value: value.clone(),
                        });
                        s.close(cx);
                    });
                });
            if selected {
                item = item.trailing(
                    Icon::new("check")
                        .with_size(px(14.))
                        .stroke(2.)
                        .color(t_.muted),
                );
            }
            menu = menu.item(item);
        }
        if count == 0 {
            menu = menu.child_element(
                div()
                    .px(px(12.))
                    .py(px(22.))
                    .text_center()
                    .text_color(t_.muted)
                    .text_size(px(m.right.meta))
                    .child(t("agent.picker.noMatches")),
            );
        }
        if total > count {
            menu = menu.footer(
                div()
                    .min_h(px(theme::control()))
                    .px(px(8.))
                    .flex()
                    .items_center()
                    .border_t_1()
                    .border_color(t_.divider)
                    .text_color(t_.muted)
                    .text_size(px(m.right.meta))
                    .child(tf(
                        "agent.picker.showing",
                        &[
                            ("visible", Arg::Number(count as i64)),
                            ("total", Arg::Number(total as i64)),
                        ],
                    )),
            );
        }
        menu
    }
}

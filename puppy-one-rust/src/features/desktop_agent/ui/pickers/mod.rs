//! `AgentSessionControlPicker`: the model, effort and mode pickers of the
//! composer toolbar and of `BuiltInAgentCompute`. One picker is open at a
//! time; a choice leaves as [`PickerEvent::Select`].
use super::agent_theme::AgentTheme;
use super::elements::effort_label;
use crate::features::desktop_agent::domain::agent_session_controls::{
    AgentSessionControl, AgentSessionControlId, AgentSessionControlOption,
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
    /// The keyboard is in the active option's submenu, on this child.
    sub: Option<usize>,
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
            s.sub = None;
            cx.notify()
        })
        .detach();
        Self {
            open: None,
            active: None,
            sub: None,
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
        self.sub = None;
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
                    AgentSessionControlId::Source => "agent.compute.title",
                })
                .to_string()
            });
        let open = self.open == Some(id);
        let searchable = control.options.len() > 6;
        let trigger_selector = format!("agent-picker-{id:?}");
        let label_selector = format!("agent-picker-{id:?}:{label}");
        let trigger = div()
            .id(SharedString::from(format!("agent-picker-{id:?}")))
            .debug_selector(move || trigger_selector)
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
                        s.sub = None;
                        s.query.update(cx, |q, cx| q.clear(cx));
                        if searchable {
                            s.query.read(cx).focus_handle(cx).focus(window, cx);
                        } else {
                            s.focus.focus(window, cx);
                        }
                        cx.notify();
                    }))
            })
            .gap(px(3.))
            .child(
                div()
                    .debug_selector(move || label_selector)
                    .min_w_0()
                    .truncate()
                    .text_size(px(theme::ty().left.content))
                    .line_height(px(theme::ty().left.line_height))
                    .child(label),
            )
            // The picker's affordance: it switches between choices.
            .child(
                Icon::new("chevrons-up-down")
                    .with_size(px(11.))
                    .stroke(1.8)
                    .color(a.text_subtle)
                    .flex_none(),
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
        let width = match id {
            AgentSessionControlId::Model => 248.,
            AgentSessionControlId::Source => 232.,
            _ => 148.,
        };
        let searchable = control.options.len() > 6;
        let query = self.query.read(cx).text().trim().to_lowercase();
        let decoration = |value: &str| {
            control
                .options
                .iter()
                .find(|o| o.value == value)
                .map(|o| {
                    (
                        o.icon,
                        o.mark,
                        o.description
                            .clone()
                            .filter(|_| id == AgentSessionControlId::Source),
                    )
                })
                .unwrap_or_default()
        };
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
        // Each shown option's value, its submenu rows' values and the row
        // the keyboard enters on (the current one, else the first).
        let keyed: Vec<(String, Vec<String>, usize)> = shown
            .iter()
            .map(|(_, value, _)| {
                let children = control
                    .options
                    .iter()
                    .find(|o| &o.value == value)
                    .map_or(&[][..], |o| o.children.as_slice());
                (
                    value.clone(),
                    children.iter().map(|c| c.value.clone()).collect(),
                    children.iter().position(|c| c.current).unwrap_or(0),
                )
            })
            .collect();
        let sub = self.sub;
        let host = cx.weak_entity();
        let mut menu = Menu::new(SharedString::from(format!("agent-picker-{id:?}-popover")))
            .variant(MenuVariant::RightRail)
            .w(px(width))
            .max_h(px(PICKER_MAX_HEIGHT))
            .scroll_handle(self.scroll.clone())
            .track_focus(&self.focus)
            .on_mouse_down_out(cx.listener(|s, _, _, cx| s.close(cx)))
            .on_key_down(cx.listener(move |s, event: &KeyDownEvent, _, cx| {
                let (children, entry) = keyed
                    .get(active)
                    .map_or((&[][..], 0), |(_, c, entry)| (c.as_slice(), *entry));
                let key = event.keystroke.key.as_str();
                // In a submenu (a source's providers): Up and Down move in
                // it, Enter picks the row (its Model), Left or Escape go back.
                if let Some(row) = sub {
                    match key {
                        "escape" | "left" => s.sub = None,
                        "enter" => {
                            if let Some(value) = children.get(row) {
                                cx.emit(PickerEvent::Select {
                                    id: AgentSessionControlId::Model,
                                    value: value.clone(),
                                });
                                s.close(cx);
                            }
                        }
                        "down" => s.sub = Some((row + 1).min(children.len().saturating_sub(1))),
                        "up" => s.sub = Some(row.saturating_sub(1)),
                        "home" => s.sub = Some(0),
                        "end" => s.sub = Some(children.len().saturating_sub(1)),
                        _ => return,
                    }
                    cx.stop_propagation();
                    cx.notify();
                    return;
                }
                let next = match key {
                    "escape" => {
                        s.close(cx);
                        cx.stop_propagation();
                        return;
                    }
                    // An option with a submenu is entered, not chosen.
                    "right" | "enter" if !children.is_empty() => {
                        s.active = Some(active);
                        s.sub = Some(entry);
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "enter" => {
                        if let Some((value, _, _)) = keyed.get(active) {
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
            // An option with a submenu (a source and its providers).
            if let Some(option) = control
                .options
                .iter()
                .find(|o| o.value == value && !o.children.is_empty())
            {
                let sub = sub.filter(|_| self.active == Some(index));
                let item = level_item(
                    option,
                    host.clone(),
                    ("agent-panel-picker-option", index).into(),
                    highlighted,
                    sub,
                    cx,
                );
                menu = menu.item(item);
                continue;
            }
            let host = host.clone();
            let (icon, mark, detail) = decoration(&value);
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
            if let Some(mark) = mark {
                item = item.icon_element(crate::ui::provider_marks::provider_mark(
                    Some(mark),
                    false,
                    16.,
                    t_.text,
                ));
            } else if let Some(icon) = icon {
                item = item.icon(icon);
            }
            if let Some(detail) = detail {
                item = item.detail_below(detail);
            }
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
            let showing = tf(
                "agent.picker.showing",
                &[
                    ("visible", Arg::Number(count as i64)),
                    ("total", Arg::Number(total as i64)),
                ],
            );
            let selector = format!("agent-picker-showing:{showing}");
            menu = menu.footer(
                div()
                    .debug_selector(move || selector)
                    .min_h(px(theme::control()))
                    .px(px(8.))
                    .flex()
                    .items_center()
                    .border_t_1()
                    .border_color(t_.divider)
                    .text_color(t_.muted)
                    .text_size(px(m.right.meta))
                    .child(showing),
            );
        }
        menu
    }
}

/// An option with a submenu (a source and its providers): its row opens
/// the submenu on hover, or when the keyboard enters it (`sub`, the child
/// the keyboard is on); each row of the submenu sets the Model control to
/// its value and closes the picker.
fn level_item(
    option: &AgentSessionControlOption,
    host: WeakEntity<SessionPickers>,
    key: ElementId,
    highlighted: bool,
    sub: Option<usize>,
    cx: &mut Context<SessionPickers>,
) -> MenuItem {
    let t_ = cx.palette();
    let item = MenuItem::new(option.label.clone())
        .id(key)
        .selected(highlighted)
        .trailing(
            Icon::new("chevron-right")
                .small()
                .stroke(2.)
                .color(t_.muted),
        )
        .open_submenu(sub.is_some());
    decorate(item, option, &t_).submenu(level_menu(option, host, sub))
}

/// The submenu of `option`'s children, with the keyboard on `sub`.
fn level_menu(
    option: &AgentSessionControlOption,
    host: WeakEntity<SessionPickers>,
    sub: Option<usize>,
) -> impl Fn(&mut Window, &mut App) -> Menu + 'static {
    let children = option.children.clone();
    let menu_id = SharedString::from(format!("agent-picker-level-{}", option.value));
    move |_, cx| {
        let t_ = cx.palette();
        let mut menu = Menu::new(menu_id.clone())
            .variant(MenuVariant::RightRail)
            .min_w(px(200.))
            .max_w(px(280.))
            .max_h(px(PICKER_MAX_HEIGHT));
        for (index, child) in children.iter().enumerate() {
            let host = host.clone();
            let value = child.value.clone();
            let mut row = MenuItem::new(child.label.clone())
                .id((menu_id.clone(), index))
                .selected(child.current || sub == Some(index))
                .on_click(move |_, cx| {
                    let _ = host.update(cx, |s, cx| {
                        cx.emit(PickerEvent::Select {
                            id: AgentSessionControlId::Model,
                            value: value.clone(),
                        });
                        s.close(cx);
                    });
                });
            row = decorate(row, child, &t_);
            if child.current {
                row = row.trailing(
                    Icon::new("check")
                        .with_size(px(14.))
                        .stroke(2.)
                        .color(t_.muted),
                );
            }
            menu = menu.item(row);
        }
        menu
    }
}

/// An option's brand mark or icon, and its second line.
fn decorate(
    mut item: MenuItem,
    option: &AgentSessionControlOption,
    t_: &crate::theme::Theme,
) -> MenuItem {
    if let Some(mark) = option.mark {
        item = item.icon_element(crate::ui::provider_marks::provider_mark(
            Some(mark),
            false,
            16.,
            t_.text,
        ));
    } else if let Some(icon) = option.icon {
        item = item.icon(icon);
    }
    if let Some(detail) = option.description.clone() {
        item = item.detail_below(detail);
    }
    item
}

#[cfg(test)]
mod tests;

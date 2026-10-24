//! Port of `AgentSessionControlPicker` over `AgentPickerPopover`
//! (`styles/pickers.css`, `DesktopMenuSurface elevation="compact"
//! tone="quiet" typographySurface="right-sidebar"`): a quiet trigger and a
//! popover above it with search past six options, the selected row marked,
//! "no matches" and the `showing` footer past `maxRenderedOptions`.
use super::*;
use crate::localization::{t as tr, tf};

/// `agentPickerLimits.maxRenderedOptions`.
const MAX_RENDERED: usize = 120;
/// `agentPickerMaxHeightPixels`.
const MAX_HEIGHT: f32 = 360.;
/// Gap between trigger and popover (`useAnchoredOverlayPosition`).
const OFFSET: f32 = 8.;

#[derive(Clone)]
pub(super) enum Selection {
    Model(Option<String>),
    Mode(String),
    Effort(String),
}

/// `presentationById`: aria label key and `agentPickerWidthPixels` role.
fn presentation(id: &str) -> (&'static str, f32) {
    match id {
        "model-picker" => ("agent.model.ariaLabel", 248.),
        "effort-picker" => ("agent.effort.ariaLabel", 148.),
        _ => ("agent.mode.ariaLabel", 148.),
    }
}

impl AgentChat {
    fn close_picker(&mut self, cx: &mut Context<Self>) {
        self.picker_open = None;
        self.picker_active = None;
        self.picker_query.update(cx, |q, cx| q.clear(cx));
        cx.notify();
    }
    fn choose(&mut self, selection: Selection, cx: &mut Context<Self>) {
        match selection {
            Selection::Model(id) => self.session.select_model(id),
            Selection::Mode(id) => self.session.select_mode(id),
            Selection::Effort(id) => self.session.select_effort(id),
        }
        self.close_picker(cx);
    }
    pub(super) fn picker(
        &self,
        id: &'static str,
        label: String,
        choices: Vec<(String, Selection, bool)>,
        width: f32,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = Theme::new(self.dark);
        let a = super::agent_theme::AgentTheme::new(&t);
        let disabled = self.session.busy();
        let open = self.picker_open == Some(id);
        // `searchable`: the search field takes focus (`autoFocus`).
        let searchable = choices.len() > 6;
        // `.desktop-agent-composer-picker .desktop-agent-picker-trigger`:
        // quiet 14px label, no indicator, bounded width, row hover.
        let trigger = div()
            .id(id)
            .h(px(crate::theme::control()))
            .px(px(8.))
            .flex()
            .items_center()
            .min_w_0()
            .max_w(px(width))
            .overflow_hidden()
            .rounded(px(crate::theme::metric::CONTROL_RADIUS))
            .text_color(a.text_subtle)
            .when(disabled, |d| d.opacity(0.45))
            .when(!disabled, |d| {
                d.cursor(crate::theme::clickable_cursor())
                    .hover(move |s| s.bg(a.row_hover))
                    .on_click(cx.listener(move |s, _, window, cx| {
                        if s.picker_open == Some(id) {
                            s.close_picker(cx);
                            return;
                        }
                        s.picker_open = Some(id);
                        s.picker_query.update(cx, |q, cx| q.clear(cx));
                        s.picker_active = None;
                        if searchable {
                            s.picker_query.read(cx).focus_handle(cx).focus(window, cx);
                        } else {
                            s.picker_focus.focus(window, cx);
                        }
                        cx.notify();
                    }))
            })
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(crate::theme::ty().left.content))
                    .line_height(px(crate::theme::ty().left.line_height))
                    .child(label),
            );
        let mut root = div().relative().flex_shrink(1.).min_w_0().child(trigger);
        if open {
            root = root.child(
                div().absolute().top_0().left_0().child(
                    deferred(
                        anchored()
                            .anchor(Anchor::BottomLeft)
                            .offset(point(px(0.), px(-OFFSET)))
                            .snap_to_window_with_margin(px(8.))
                            .child(self.picker_popover(id, choices, cx)),
                    )
                    .with_priority(1),
                ),
            );
        }
        root.into_any_element()
    }
    fn picker_popover(
        &self,
        id: &'static str,
        choices: Vec<(String, Selection, bool)>,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t = Theme::new(self.dark);
        let m = crate::theme::ty();
        let (_, width) = presentation(id);
        let searchable = choices.len() > 6;
        let query = self.picker_query.read(cx).text().trim().to_lowercase();
        let matched: Vec<(String, Selection, bool)> = choices
            .into_iter()
            .filter(|(label, _, _)| query.is_empty() || label.to_lowercase().contains(&query))
            .collect();
        let total = matched.len();
        let shown: Vec<(String, Selection, bool)> =
            matched.into_iter().take(MAX_RENDERED).collect();
        let active = self
            .picker_active
            .or_else(|| shown.iter().position(|(_, _, selected)| *selected))
            .unwrap_or(0);
        let mut list = div()
            .id("agent-picker-list")
            .min_h_0()
            .flex_shrink(1.)
            .overflow_y_scroll()
            .p(px(crate::theme::metric::MENU_PADDING));
        for (index, (label, selection, selected)) in shown.iter().cloned().enumerate() {
            let highlighted = selected || (self.picker_active == Some(index));
            list = list.child(
                div()
                    .id(("agent-picker-option", index))
                    .h(px(crate::theme::control()))
                    .px(px(8.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .rounded(px(crate::theme::metric::CONTROL_RADIUS))
                    .text_size(px(m.right.content))
                    .line_height(px(m.right.control_line_height))
                    .text_color(if highlighted { t.text } else { t.muted })
                    .when(highlighted, |d| d.bg(t.hover))
                    .hover(move |s| s.bg(t.hover).text_color(t.text))
                    .cursor(crate::theme::clickable_cursor())
                    .on_click(cx.listener(move |s, _, _, cx| s.choose(selection.clone(), cx)))
                    .child(div().flex_1().min_w_0().truncate().child(label))
                    .when(selected, |d| {
                        d.child(crate::ui::icon_stroke("check", 14., 2., t.muted))
                    }),
            );
        }
        if shown.is_empty() {
            list = list.child(
                div()
                    .px(px(12.))
                    .py(px(22.))
                    .text_center()
                    .text_color(t.muted)
                    .text_size(px(m.right.meta))
                    .line_height(px(m.right.meta_line_height))
                    .child(tr("agent.picker.noMatches")),
            );
        }
        let count = shown.len();
        let choices_for_keys = shown.clone();
        div()
            .id(SharedString::from(format!("{id}-popover")))
            .track_focus(&self.picker_focus)
            .w(px(width))
            .max_h(px(MAX_HEIGHT))
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(px(crate::theme::metric::MENU_RADIUS))
            .border_1()
            .border_color(t.border)
            .bg(t.menu_bg)
            .shadow(vec![BoxShadow {
                inset: false,
                color: crate::theme::alpha(t.shadow, if t.dark { 0.28 } else { 0.32 }).into(),
                offset: point(px(0.), px(2.)),
                blur_radius: px(4.),
                spread_radius: px(-2.),
            }])
            .occlude()
            .font_family("Geist")
            .on_mouse_down_out(cx.listener(|s, _, _, cx| s.close_picker(cx)))
            .on_key_down(cx.listener(move |s, e: &KeyDownEvent, _, cx| {
                let key = e.keystroke.key.as_str();
                let next = match key {
                    "escape" => {
                        s.close_picker(cx);
                        cx.stop_propagation();
                        return;
                    }
                    "enter" => {
                        if let Some((_, selection, _)) = choices_for_keys.get(active) {
                            s.choose(selection.clone(), cx);
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
                s.picker_active = Some(next);
                cx.stop_propagation();
                cx.notify();
            }))
            .when(searchable, |d| {
                // `.desktop-agent-picker-search`.
                d.child(
                    div()
                        .min_h(px(36.))
                        .px(px(8.))
                        .py(px(4.))
                        .flex()
                        .items_center()
                        .gap(px(7.))
                        .border_b_1()
                        .border_color(t.divider)
                        .child(crate::ui::icon_stroke("search", 13., 2., t.subtle))
                        .child(
                            // Kit's xsmall editor insets 4px; the product input has none.
                            div()
                                .flex_1()
                                .min_w_0()
                                .ml(px(-4.))
                                .h(px(crate::theme::control_compact()))
                                .flex()
                                .items_center()
                                .child(self.picker_query.clone()),
                        ),
                )
            })
            .child(list)
            .when(total > count, |d| {
                d.child(
                    div()
                        .min_h(px(crate::theme::control()))
                        .px(px(8.))
                        .py(px(4.))
                        .flex()
                        .items_center()
                        .border_t_1()
                        .border_color(t.divider)
                        .text_color(t.muted)
                        .text_size(px(m.right.meta))
                        .child(tf(
                            "agent.picker.showing",
                            &[("visible", count.into()), ("total", total.into())],
                        )),
                )
            })
    }
    /// `agent.picker.search` placeholder for the open picker.
    pub(super) fn picker_search_placeholder(&self) -> Option<String> {
        let id = self.picker_open?;
        Some(tf(
            "agent.picker.search",
            &[("name", tr(presentation(id).0).into())],
        ))
    }
}

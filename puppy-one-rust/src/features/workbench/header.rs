//! Port of `AuxiliaryWorkbenchHeader`, `AuxiliaryWorkbenchTab`,
//! `AuxiliaryWorkbenchStatus` and `AuxiliaryWorkbenchOverflowMenu` with
//! `auxiliary-workbench-header.css`. Geometry comes from `header_layout`.
use super::drag::{self, DropIntent};
use super::header_layout::{self as metrics, Mode};
use super::*;
use crate::features::desktop_agent::ui::agent_brand_mark::{LauncherIdentity, launcher_icon};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui_kit::component::Sizable as _;

/// `--desktop-toolbar-action-radius`.
const RADIUS: f32 = theme::metric::TOOLBAR_ACTION_RADIUS;
/// `.desktop-terminal-tab-close`: 22px menu icon button, 1px from the tab end.
const CLOSE: f32 = 22.;
/// Layout key of the insertion slot while a tab is dragged over the bar.
const SLOT: Id = Id::MAX;

impl Workbench {
    /// `AuxiliaryWorkbenchStatus`: the item's own icon in a 14px slot; a running
    /// chat adds the pulsing 5px accent dot at its corner.
    pub(super) fn tab_status(&self, tab: Id, content: &Content, fg: Rgba, cx: &App) -> AnyElement {
        let t = cx.palette();
        let identity = |runtime: Option<Runtime>| {
            runtime.map_or(LauncherIdentity::Shell, LauncherIdentity::Runtime)
        };
        match content {
            Content::Launcher if self.history_open(tab) => Icon::new("history")
                .small()
                .stroke(2.)
                .color(fg)
                .into_any_element(),
            Content::Launcher | Content::Retained(RetainedItem::Launcher) => {
                Icon::new("square-dashed")
                    .small()
                    .stroke(2.)
                    .color(fg)
                    .into_any_element()
            }
            Content::Retained(RetainedItem::Chat { runtime, .. }) => {
                launcher_icon(LauncherIdentity::Runtime(*runtime), true, t.dark, t.muted)
                    .into_any_element()
            }
            Content::Retained(RetainedItem::Terminal { runtime, .. }) => {
                launcher_icon(identity(*runtime), true, t.dark, t.muted).into_any_element()
            }
            Content::Terminal(view, _, runtime) => {
                let terminal = view.read(cx);
                let running = terminal.running;
                // `TerminalSessionHeaderStatus`: a busy Agent CLI swaps its mark
                // for the activity grid in the tab's own colour.
                let active = runtime.is_some() && terminal.agent_active();
                // `[data-status="exited"] .desktop-terminal-tab-status { opacity: 0.42 }`
                div()
                    .size(px(14.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .when(!running, |d| d.opacity(0.42))
                    .map(|d| {
                        if active {
                            d.child(activity_grid(tab, fg))
                        } else {
                            d.child(launcher_icon(identity(*runtime), true, t.dark, t.muted))
                        }
                    })
                    .into_any_element()
            }
            Content::Chat(view) => {
                let view = view.read(cx);
                let running = view.busy();
                div()
                    .relative()
                    .size(px(14.))
                    .child(launcher_icon(
                        LauncherIdentity::Runtime(view.runtime()),
                        true,
                        t.dark,
                        t.muted,
                    ))
                    .when(running, |d| d.child(running_dot(tab, t)))
                    .into_any_element()
            }
        }
    }

    pub(super) fn render_header(
        &mut self,
        group: Id,
        width: f32,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t = cx.palette();
        let root = self.root.clone().unwrap();
        let focus = self
            .header_focus
            .entry((root.clone(), group))
            .or_insert_with(|| cx.focus_handle())
            .clone();
        let g = self.project().unwrap().layout.groups[&group].clone();
        let key = (root.clone(), group);
        let preferred = self.header_windows.get(&key).cloned().unwrap_or_default();
        let available = metrics::available_width(width);
        // `projectWorkbenchTabInsertionPreview`: the dragged tab leaves its
        // place and a slot (laid out as the active tab) opens at the target.
        let source = self.dragging;
        let insert = match self.drop_intent {
            Some(DropIntent::Insert {
                group: target,
                index,
                allowed,
            }) if target == group => Some((index, allowed)),
            _ => None,
        };
        let layout = match insert {
            Some((index, _)) => {
                let mut ids: Vec<Id> = g
                    .tabs
                    .iter()
                    .copied()
                    .filter(|t| Some(*t) != source)
                    .collect();
                ids.insert(index.min(ids.len()), SLOT);
                metrics::resolve(&ids, Some(SLOT), available, &[])
            }
            None => {
                let layout = metrics::resolve(&g.tabs, g.active, available, &preferred);
                if layout.visible != preferred {
                    self.header_windows.insert(key, layout.visible.clone());
                }
                layout
            }
        };
        if layout.hidden.is_empty() && self.overflow == Some(group) {
            self.overflow = None;
        }
        self.overflow_hidden.insert(group, layout.hidden.clone());
        let m = theme::ty();
        let mut rail = div().relative().w_full().h(px(metrics::COMPACT));
        for bounds in &layout.tabs {
            let tab = bounds.id;
            if tab == SLOT {
                // `.desktop-terminal-tab-drop-slot`.
                let allowed = insert.is_some_and(|(_, allowed)| allowed);
                let tone = if allowed { t.accent } else { t.danger };
                rail = rail.child(
                    div()
                        .absolute()
                        .top_0()
                        .left(px(bounds.inline_start))
                        .w(px(bounds.width))
                        .h(px(metrics::COMPACT))
                        .rounded(px(RADIUS))
                        .border_1()
                        .border_dashed()
                        .border_color(theme::alpha(tone, 0.76))
                        .bg(theme::alpha(tone, 0.09)),
                );
                continue;
            }
            let moving = source == Some(tab);
            let project = self.project().unwrap();
            let Some(content) = project.content.get(&tab) else {
                continue;
            };
            let label: SharedString = self.tab_title(tab, content, cx).into();
            let active = g.active == Some(tab);
            let compact = !active && layout.mode != Mode::Full;
            let fg = if active { t.text } else { t.muted };
            let status = self.tab_status(tab, content, fg, cx);
            let group_name = SharedString::from(format!("workbench-tab-{tab}"));
            let drag = DragTab {
                root: root.clone(),
                tab,
                title: label.to_string(),
            };
            let close_label: SharedString = crate::localization::tf(
                "terminal.closeSession",
                &[("title", label.to_string().into())],
            )
            .into();
            let focus = focus.clone();
            let select = gpui_kit::base::Tab::new(("tab", tab))
                .selected(active)
                .accessibility_label(label.clone())
                .size_full()
                .flex()
                .items_center()
                .justify_start()
                .rounded(px(RADIUS))
                .overflow_hidden()
                .text_size(px(m.header.content))
                .line_height(px(m.header.line_height))
                .text_color(fg)
                .cursor(theme::clickable_cursor())
                .when(active, |d| d.bg(t.control))
                .when(!active, |d| {
                    d.group_hover(group_name.clone(), |s| {
                        s.bg(t.control_hover).text_color(t.text)
                    })
                })
                .when(compact, |d| d.tooltip(crate::ui::tooltip(label.clone())))
                .child(
                    div()
                        .w(px(metrics::COMPACT))
                        .h_full()
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(status),
                )
                .when(!compact, |d| {
                    d.child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .pr(px(24.))
                            .truncate()
                            .child(label.clone()),
                    )
                })
                .on_click(cx.listener(move |s, _, w, cx| {
                    if let Some(p) = s.project_mut() {
                        p.layout.activate(group, tab);
                    }
                    focus.focus(w, cx);
                    cx.notify();
                }))
                .on_drag(drag, |drag, _, _, cx| cx.new(|_| drag.clone()))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        s.open_context_menu(
                            super::menus::ContextMenu::Tab {
                                tab,
                                at: e.position,
                            },
                            cx,
                        );
                    }),
                );
            let close = (!compact).then(|| {
                gpui_kit::base::Button::new(("close-tab", tab))
                    .accessibility_label(close_label.clone())
                    .absolute()
                    .right(px(1.))
                    .top(px((metrics::COMPACT - CLOSE) / 2.))
                    .size(px(CLOSE))
                    .rounded(px(RADIUS))
                    .border_1()
                    .border_color(theme::alpha(t.border, 0.))
                    .text_color(t.subtle)
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| {
                        s.bg(t.control_hover)
                            .border_color(theme::alpha(t.border, 0.72))
                            .text_color(t.text)
                    })
                    .when(!active, |b| {
                        b.invisible()
                            .group_hover(group_name.clone(), |s| s.visible())
                    })
                    .tooltip(crate::ui::tooltip(close_label.clone()))
                    .child(Icon::new("x").xsmall().stroke(1.8).color(t.subtle))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        cx.stop_propagation();
                        s.close(tab, false, cx);
                    }))
            });
            rail = rail.child(
                div()
                    .id(("tab-frame", tab))
                    .group(group_name.clone())
                    .absolute()
                    .left(px(bounds.inline_start))
                    .top_0()
                    .w(px(bounds.width))
                    .h(px(metrics::COMPACT))
                    // `[data-move-source="true"]`.
                    .when(moving, |d| d.opacity(0.56))
                    .child(select)
                    .children(close),
            );
        }
        let square = |id: ElementId, name: &'static str, label: SharedString, open: bool| {
            gpui_kit::base::Button::new(id)
                .accessibility_label(label.clone())
                .absolute()
                .top_0()
                .size(px(metrics::COMPACT))
                .rounded(px(RADIUS))
                .border_1()
                .border_color(theme::alpha(t.border, if open { 0.72 } else { 0. }))
                .when(open, |b| b.bg(t.control_hover))
                .text_color(t.muted)
                .cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(t.control_hover).text_color(t.text))
                .tooltip(crate::ui::tooltip(label))
                .child(Icon::new(name).small().stroke(1.9).color(if open {
                    t.text
                } else {
                    t.muted
                }))
        };
        let mut create_start = layout.tabs_width + metrics::GAP;
        if !layout.hidden.is_empty() {
            let label: SharedString = crate::localization::tf(
                "terminal.tabs.more",
                &[("count", layout.hidden.len().into())],
            )
            .into();
            rail = rail.child(
                self.overflow_menu(group, label, width, cx)
                    .absolute()
                    .top_0()
                    .left(px(create_start)),
            );
            create_start += metrics::OVERFLOW_CONTROL + metrics::GAP;
        }
        rail = rail.child(
            square(
                ElementId::NamedInteger("new-tab".into(), group),
                "plus",
                crate::localization::t("workspace.workbench.newTab").into(),
                false,
            )
            .left(px(create_start))
            .on_click(cx.listener(move |s, _, _, cx| s.add(group, cx))),
        );
        if g.tabs.is_empty() && self.project().unwrap().layout.groups.len() > 1 {
            rail = rail.child(
                square(
                    ElementId::NamedInteger("close-group".into(), group),
                    "x",
                    crate::localization::t("common.action.close").into(),
                    false,
                )
                .left(px(create_start + metrics::CREATE_CONTROL + metrics::GAP))
                .on_click(cx.listener(move |s, _, _, cx| {
                    if let Some(p) = s.project_mut() {
                        p.layout.remove_empty_group(group);
                    }
                    cx.notify();
                })),
            );
        }
        // The bar is an insertion target (`resolveWorkbenchTabBarDropTarget`).
        let base: Vec<(f32, f32)> = {
            let ids: Vec<Id> = g
                .tabs
                .iter()
                .copied()
                .filter(|t| Some(*t) != source)
                .collect();
            let active = g
                .active
                .filter(|a| Some(*a) != source)
                .or(ids.first().copied());
            metrics::resolve(&ids, active, available, &[])
                .tabs
                .iter()
                .map(|b| (b.inline_start, b.width))
                .collect()
        };
        let original = g.tabs.clone();
        rail = rail
            .on_drag_move::<DragTab>(cx.listener(move |s, e: &DragMoveEvent<DragTab>, _, cx| {
                let drag = e.drag(cx).clone();
                if s.root.as_ref() != Some(&drag.root) {
                    return;
                }
                let here = matches!(
                    s.drop_intent,
                    Some(DropIntent::Insert { group: target, .. }) if target == group
                );
                if !e.bounds.contains(&e.event.position) {
                    if here {
                        s.drop_intent = None;
                        cx.notify();
                    }
                    return;
                }
                let x = f32::from(e.event.position.x - e.bounds.origin.x);
                let index = drag::insertion_index(&base, x);
                // `canInsertAuxiliaryWorkbenchItem`: a no-op move is refused.
                let unchanged = original.iter().position(|t| *t == drag.tab) == Some(index);
                let next = Some(DropIntent::Insert {
                    group,
                    index,
                    allowed: !unchanged,
                });
                s.dragging = Some(drag.tab);
                if s.drop_intent != next {
                    s.drop_intent = next;
                    cx.notify();
                }
            }))
            .on_drop(cx.listener(move |s, drag: &DragTab, _, cx| {
                if s.root.as_ref() == Some(&drag.root)
                    && let Some(DropIntent::Insert {
                        group: target,
                        index,
                        allowed: true,
                    }) = s.drop_intent
                    && target == group
                    && let Some(p) = s.project_mut()
                {
                    p.layout.move_tab(drag.tab, group, index);
                }
                s.drop_intent = None;
                s.dragging = None;
                cx.notify();
            }));
        div()
            .id(("workbench-header", group))
            .track_focus(&focus)
            .on_key_down(cx.listener(move |s, e: &KeyDownEvent, _, cx| {
                // `moveEdgeFromKeyboard`: Alt+Shift+Arrow splits the active tab
                // to that edge of its group when the split fits.
                let m = e.keystroke.modifiers;
                if m.alt && m.shift && !m.control && !m.platform {
                    let edge = match e.keystroke.key.as_str() {
                        "left" => Some(drag::Edge::Left),
                        "right" => Some(drag::Edge::Right),
                        "up" => Some(drag::Edge::Top),
                        "down" => Some(drag::Edge::Bottom),
                        _ => None,
                    };
                    if let Some(edge) = edge {
                        s.move_active_to_edge(group, edge, cx);
                        cx.stop_propagation();
                        return;
                    }
                }
                if ["left", "right", "home", "end"].contains(&e.keystroke.key.as_str()) {
                    if let Some(p) = s.project_mut() {
                        p.layout.navigate(group, &e.keystroke.key);
                    }
                    cx.notify();
                    cx.stop_propagation();
                }
            }))
            .h(px(metrics::HEADER_HEIGHT))
            .flex_shrink_0()
            .pt(px(metrics::HEADER_PADDING_TOP))
            .px(px(metrics::HEADER_PADDING_INLINE))
            .bg(t.auxiliary())
            .text_color(t.muted)
            .child(rail)
    }
}

/// `.desktop-terminal-chat-tab-status > i`: 5px accent dot, 1px surface ring,
/// pulsing between 48% and 100% opacity and 0.82–1 scale every 1.4s.
/// `TerminalActivityGrid`: four 3px cells, 2px apart, at 22% ink; one cell at
/// a time lights clockwise from the top left (`steps(1, end)`, 0.8s cycle,
/// each lit for the first 24% of its 0.2s-staggered period).
fn activity_grid(tab: Id, color: Rgba) -> AnyElement {
    const CELL: f32 = 3.;
    const GAP: f32 = 2.;
    div()
        .relative()
        .size(px(CELL * 2. + GAP))
        .with_animation(
            ElementId::NamedInteger("terminal-activity".into(), tab),
            Animation::new(std::time::Duration::from_millis(800)).repeat(),
            move |grid, delta| {
                let t = delta * 0.8;
                let slot = ((t / 0.2) as usize).min(3);
                let lit = (t - slot as f32 * 0.2) < 0.192;
                // Clockwise: top left, top right, bottom right, bottom left.
                let order = [(0., 0.), (1., 0.), (1., 1.), (0., 1.)];
                grid.children(order.iter().enumerate().map(|(i, (x, y))| {
                    div()
                        .absolute()
                        .left(px(x * (CELL + GAP)))
                        .top(px(y * (CELL + GAP)))
                        .size(px(CELL))
                        .bg(color)
                        .opacity(if lit && i == slot { 1. } else { 0.22 })
                }))
            },
        )
        .into_any_element()
}

fn running_dot(tab: Id, t: Theme) -> AnyElement {
    div()
        .absolute()
        .right(px(-1.))
        .bottom(px(-1.))
        .size(px(5.))
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .size(px(5.))
                .rounded_full()
                .border_1()
                .border_color(t.auxiliary())
                .bg(t.accent)
                .with_animation(
                    ElementId::NamedInteger("tab-running".into(), tab),
                    Animation::new(std::time::Duration::from_millis(1400))
                        .repeat()
                        .with_easing(ease_in_out),
                    |dot, delta| {
                        let wave = 1. - (delta * 2. - 1.).abs();
                        dot.opacity(0.48 + 0.52 * wave)
                            .size(px(5. * (0.82 + 0.18 * wave)))
                    },
                ),
        )
        .into_any_element()
}

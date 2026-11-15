//! `OnboardingProjectGroups`: the projects grouped by place over one shared
//! scroller, with Space/Computer headings, focus scroll, and drag-drop zones.
use super::*;
use std::rc::Rc;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// `.onboarding-project-groups-note`: shown when Cloud spaces could not be read.
#[derive(IntoElement)]
pub(in crate::app::home) struct SpacesUnavailableNote {
    on_retry: ClickHandler,
}

impl SpacesUnavailableNote {
    pub fn new(on_retry: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        Self {
            on_retry: Rc::new(on_retry),
        }
    }
}

impl RenderOnce for SpacesUnavailableNote {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let on_retry = self.on_retry;
        h_flex()
            .gap(px(4.))
            .px(px(8.))
            .pt(px(2.))
            .pb(px(6.))
            .text_size(px(theme::ty().ui.caption))
            .line_height(px(18.))
            .text_color(t.subtle)
            .child(tr("onboarding.spaces.unavailable"))
            .child(
                div()
                    .id("home-spaces-retry")
                    .cursor(theme::clickable_cursor())
                    .underline()
                    .hover(move |s| s.text_color(t.text))
                    .on_click(move |ev, w, cx| on_retry(ev, w, cx))
                    .child(tr("onboarding.spaces.retry")),
            )
    }
}

impl Homepage {
    /// `OnboardingProjectGroups`: the projects by place over one scroll,
    /// so no group scrolls on its own or cuts off its last row.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn project_groups(
        &mut self,
        groups: Vec<super::super::groups::Group>,
        note: Option<AnyElement>,
        held: bool,
        width: f32,
        viewport_w: f32,
        narrow: bool,
        busy: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if held {
            // `.onboarding-project-list-wait`: the mark at the area's centre,
            // revealed after 120ms.
            let since = self.list_held_since.or(self.spaces_wait);
            let shown =
                since.is_some_and(|since| since.elapsed() >= std::time::Duration::from_millis(120));
            if !shown {
                window.request_animation_frame();
            }
            return div()
                .size_full()
                .min_h_0()
                .flex()
                .items_center()
                .justify_center()
                .when(shown, |d| {
                    d.child(
                        crate::ui::loading::LoadingMark::new("home-projects-loading")
                            .area()
                            .size(crate::ui::loading::LoaderSize::Md)
                            .tone(crate::ui::loading::Tone::Neutral),
                    )
                })
                .into_any_element();
        }
        let t = cx.palette();
        let layout = self.preferences.read(cx).state.homepage_project_layout;
        let grid = layout == HomepageLayout::Grid;
        let columns = if grid { GRID_COLUMNS } else { 1 };
        let col_gap = grid_column_gap(viewport_w);
        let cell_w = grid_cell_width(width, col_gap);
        let inset = if grid { 0. } else { 8. };
        let dragging = groups.iter().any(|g| g.drop.is_some());
        let focused = self.settle_place_focus(&groups, cx);
        let mut views = Vec::with_capacity(groups.len());
        for (index, group) in groups.into_iter().enumerate() {
            let lit = focused.as_ref() == Some(&group.id);
            let view = self.project_group(
                index, group, columns, col_gap, cell_w, inset, dragging, lit, narrow, busy, window,
                cx,
            );
            views.push(view);
        }
        let list = div()
            .id("home-projects")
            .w(px(width + SCROLLBAR_SIZE))
            .min_h_0()
            .flex_shrink(1.)
            .pt(px(4.))
            .pb(px(40.))
            .pr(px(SCROLLBAR_SIZE))
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                if !*hovered && s.hovered.take().is_some() {
                    cx.notify();
                }
            }))
            .flex()
            .flex_col()
            .gap(px(20.))
            .children(views.into_iter().map(|view| div().w(px(width)).child(view)))
            .children(note.map(|note| div().w(px(width)).child(note)));

        let fade = |top: bool| {
            div()
                .absolute()
                .left_0()
                .w(px(width))
                .h(px(if top { 8. } else { 16. }))
                .when(top, |d| d.top_0())
                .when(!top, |d| d.bottom_0())
                .bg(linear_gradient(
                    if top { 180. } else { 0. },
                    linear_color_stop(t.canvas, 0.),
                    linear_color_stop(theme::alpha(t.canvas, 0.), 1.),
                ))
        };
        div()
            .relative()
            .min_h_0()
            .flex()
            .flex_col()
            .child(list)
            .child(fade(true))
            .child(fade(false))
            .child(crate::ui::scrollbar::vertical(
                "home-projects-scrollbar",
                &self.scroll,
            ))
            .into_any_element()
    }

    /// One audience: its head (a quiet label under a hairline, what it
    /// offers at its end) and its projects as the Grid or the List.
    #[allow(clippy::too_many_arguments)]
    fn project_group(
        &mut self,
        index: usize,
        group: super::super::groups::Group,
        columns: usize,
        col_gap: f32,
        cell_w: f32,
        inset: f32,
        dragging: bool,
        lit: bool,
        narrow: bool,
        busy: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use super::super::groups::DropAction;
        let t = cx.palette();
        let layout = self.preferences.read(cx).state.homepage_project_layout;
        let grid = layout == HomepageLayout::Grid;
        let id = group.id.clone();
        let available = group.drop.as_ref().is_some_and(|d| d.enabled);
        let over = available && self.drop_over.as_ref() == Some(&id);
        let marks = id.marks_places();
        let ids: Vec<String> = group.items.iter().map(|i| i.id.clone()).collect();
        let stop = self.project_stop(&group.items);
        let mut cells = Vec::with_capacity(group.items.len());
        for (position, item) in group.items.iter().enumerate() {
            let index = self.cell_index(&item.id);
            self.action_bounds.entry(item.id.clone()).or_default();
            let focus = self.project_focus(&item.id, cx);
            let lit = self.project_lit(item, window, cx);
            let is_stop = stop.as_deref() == Some(item.id.as_str());
            focus.clone().tab_stop(is_stop);
            let keys = {
                let host = self.weak.clone();
                let ids = ids.clone();
                let open = item.clone();
                move |event: &KeyDownEvent, window: &mut Window, cx: &mut App| {
                    let key = event.keystroke.key.as_str();
                    let key = match key {
                        "up" | "down" | "left" | "right" | "home" | "end" => key,
                        "enter" | "space" => {
                            let _ = host.update(cx, |s, cx| s.open_item(&open, cx));
                            cx.stop_propagation();
                            return;
                        }
                        _ => return,
                    };
                    cx.stop_propagation();
                    let Some(target) =
                        key_target(key, position, ids.len().saturating_sub(1), columns, false)
                    else {
                        return;
                    };
                    let _ = host.update(cx, |s, cx| {
                        let id = ids[target].clone();
                        s.stop = Some(id.clone());
                        if let Some(handle) = s.focus.get(&id) {
                            handle.focus(window, cx);
                        }
                        cx.notify();
                    });
                }
            };
            cells.push(if grid {
                self.project_tile(
                    index, item, focus, cell_w, lit, is_stop, marks, busy, keys, cx,
                )
            } else {
                self.project_row(
                    index, item, focus, lit, is_stop, marks, narrow, busy, keys, cx,
                )
            });
        }
        let content = if let Some(text) = group.empty_text.clone().filter(|_| cells.is_empty()) {
            div()
                .min_h(px(32.))
                .flex()
                .items_center()
                .py(px(8.))
                .px(px(inset))
                .text_size(px(theme::ty().ui.caption))
                .text_color(t.subtle)
                .child(text)
                .into_any_element()
        } else if grid {
            let mut cells = cells.into_iter().peekable();
            let mut rows = Vec::new();
            while cells.peek().is_some() {
                rows.push(
                    h_flex().items_start().gap(px(col_gap)).children(
                        cells
                            .by_ref()
                            .take(columns)
                            .map(|cell| div().w(px(cell_w)).flex_none().child(cell)),
                    ),
                );
            }
            v_flex()
                .gap(px(CELL_ROW_GAP))
                .children(rows)
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .children(cells)
                .into_any_element()
        };
        let head_end: Option<AnyElement> = match &group.drop {
            Some(drop) if drop.enabled => Some(
                div()
                    .flex_none()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if over { t.text } else { t.muted })
                    .child(drop.hint.clone())
                    .into_any_element(),
            ),
            _ => None,
        };
        let presence = group.presence.clone().map(|(text, resume)| {
            h_flex()
                .debug_selector(|| "home-this-computer".into())
                .flex_none()
                .gap(px(6.))
                .items_center()
                .text_color(t.subtle)
                .child(text)
                .when(resume, |d| {
                    d.child(
                        Button::new("home-sharing-resume")
                            .variant(ButtonVariant::GitAction)
                            .label(tr("hosts.sharing.resume"))
                            .on_click(|_, _, cx| {
                                crate::features::hosts::host_link(cx)
                                    .update(cx, |l, cx| l.set_paused(false, cx));
                            }),
                    )
                })
        });
        let mark: Option<AnyElement> = group.mark.as_ref().map(|mark| match mark {
            super::super::groups::Mark::Space(space) => {
                crate::features::cloud::space_mark(space).into_any_element()
            }
            super::super::groups::Mark::Computer => Icon::product(ProductIcon::Local)
                .with_size(px(16.))
                .stroke(1.75)
                .color(t.subtle)
                .into_any_element(),
        });
        let badge = group.plan.as_deref().and_then(|plan| {
            group.mark.as_ref().and_then(|m| match m {
                super::super::groups::Mark::Space(space) => {
                    let mut space = space.clone();
                    space.plan_id = Some(plan.to_owned());
                    crate::features::cloud::space_plan_badge(&space)
                }
                _ => None,
            })
        });
        let owner = group.owner.then(|| {
            div()
                .text_color(t.subtle)
                .child(tr("settings.space.role.owner"))
        });
        let manage = group
            .manage
            .clone()
            .filter(|_| head_end.is_none())
            .map(|space| {
                Button::new(SharedString::from(format!("home-manage-{space}")))
                    .variant(ButtonVariant::Ghost)
                    .label(tr("settings.space.manage"))
                    .h(px(18.))
                    .px(px(6.))
                    .text_size(px(theme::ty().ui.caption))
                    .text_color(t.subtle)
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(HomeEvent::ManageSpace(space.clone()))
                    }))
            });
        let caption = theme::ty().ui.caption;
        let head = h_flex()
            .min_w_0()
            .items_center()
            .gap(px(8.))
            .mx(px(inset))
            .pb(px(4.))
            .when(index > 0, |d| {
                d.pt(px(20.)).border_t_1().border_color(t.divider)
            })
            .text_size(px(caption))
            .line_height(px(18.))
            .text_color(if over || lit { t.text } else { t.subtle })
            .children(mark)
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .font_weight(FontWeight::MEDIUM)
                    .child(group.title.clone()),
            )
            .children(badge)
            .children(owner)
            .children(presence)
            .child(div().flex_1())
            .children(head_end)
            .children(manage);
        let drop_action = group.drop.clone().filter(|d| d.enabled).map(|d| d.action);
        div()
            .id(("home-group", index))
            .debug_selector({
                let key = id.key();
                move || format!("home-group:{key}")
            })
            .relative()
            .flex()
            .flex_col()
            .gap(px(2.))
            .when(dragging && !available, |d| d.opacity(0.38))
            .when(available || lit, |d| {
                d.child(
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .right_0()
                        .bottom(px(-6.))
                        .rounded(px(10.))
                        .bg(theme::alpha(
                            t.text,
                            if over {
                                0.09
                            } else if available {
                                0.04
                            } else {
                                0.06
                            },
                        )),
                )
            })
            .child(head)
            .child(content)
            .on_drag_move::<ProjectDrag>(cx.listener(
                move |s, event: &DragMoveEvent<ProjectDrag>, _, cx| {
                    let inside = event.bounds.contains(&event.event.position);
                    if inside && available && s.drop_over.as_ref() != Some(&id) {
                        s.drop_over = Some(id.clone());
                        cx.notify();
                    } else if !inside && s.drop_over.as_ref() == Some(&id) {
                        s.drop_over = None;
                        cx.notify();
                    }
                },
            ))
            .when_some(drop_action, |d, action| {
                d.on_drop(cx.listener(move |s, drag: &ProjectDrag, _, cx| {
                    s.drop_over = None;
                    s.dragging_path = None;
                    match &action {
                        DropAction::Publish { space } => cx.emit(HomeEvent::PublishToSpace {
                            path: PathBuf::from(&drag.path),
                            space: space.clone(),
                        }),
                        DropAction::ShareDevices => cx.emit(HomeEvent::ShareFolder {
                            path: PathBuf::from(&drag.path),
                        }),
                    }
                    cx.notify();
                }))
            })
            .into_any_element()
    }
}

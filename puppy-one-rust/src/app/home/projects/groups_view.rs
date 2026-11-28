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
                            .tone(crate::ui::loading::Tone::Neutral)
                            .label(tr("common.status.loading")),
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
            .gap(px(24.))
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

    /// One audience: its heading (the place's mark and name, its plan said
    /// quietly, who works there and what it offers at its end), set off from
    /// the one before by a hairline, and its projects as the Grid or the List.
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
        use super::super::{
            folder::ComputerKind,
            groups::{DropAction, GroupId},
        };
        let t = cx.palette();
        let layout = self.preferences.read(cx).state.homepage_project_layout;
        let grid = layout == HomepageLayout::Grid;
        let id = group.id.clone();
        // Computer Mode: the spaces' projects are Cloud computers, this
        // computer's computers its own, and the plain folders quiet.
        let computer_mode = crate::features::flags::computer_mode_enabled(&self.preferences, cx);
        let plain = id == GroupId::PlainFolders;
        let look = match &id {
            GroupId::Space(_) | GroupId::SharedUnresolved if computer_mode => {
                Look::Computer(ComputerKind::Cloud)
            }
            GroupId::LocalComputers => Look::Computer(ComputerKind::OnDevice),
            GroupId::PlainFolders if grid => Look::Plain,
            _ => Look::Folder,
        };
        // The quiet grid fills its row with cells at least 190px wide, 8px apart.
        let (columns, col_gap, cell_w, row_gap) = if plain && grid {
            let width = cell_w * columns as f32 + col_gap * (columns as f32 - 1.);
            let count = (((width + 8.) / 198.).floor() as usize).max(1);
            let cell = (width - 8. * (count as f32 - 1.)) / count as f32;
            (count, 8., cell, 8.)
        } else {
            (columns, col_gap, cell_w, CELL_ROW_GAP)
        };
        let closed = plain && self.plain_folders_closed;
        let available = group.drop.as_ref().is_some_and(|d| d.enabled);
        let over = available && self.drop_over.as_ref() == Some(&id);
        let ids: Vec<String> = group.items.iter().map(|i| i.id.clone()).collect();
        let list = std::rc::Rc::new(ids.clone());
        let stop = self.project_stop(&group.items);
        let mut cells = Vec::with_capacity(group.items.len());
        for (position, item) in group.items.iter().enumerate() {
            let index = self.cell_index(&item.id);
            self.action_bounds.entry(item.id.clone()).or_default();
            self.list_of.insert(item.id.clone(), list.clone());
            let lit = self.project_lit(item, window, cx);
            // One stop for Tab: this project, and its actions, which show
            // only while it is reached for (roving).
            let is_stop = stop.as_deref() == Some(item.id.as_str());
            let focus = self.project_focus(&item.id, window, cx).tab_stop(is_stop);
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
                    index, item, focus, cell_w, lit, is_stop, busy, look, keys, cx,
                )
            } else {
                self.project_row(
                    index, item, focus, lit, is_stop, narrow, busy, look, keys, cx,
                )
            });
        }
        let new_computer = |id: &'static str, cx: &mut Context<Self>| {
            Button::new(id)
                .variant(ButtonVariant::Outline)
                .icon(Icon::new("plus").small().stroke(2.))
                .label(tr("onboarding.computerMode.createAction"))
                .disabled(busy)
                .h(px(24.))
                .px(px(10.))
                .text_size(px(theme::ty().ui.meta))
                .font_weight(FontWeight::MEDIUM)
                .on_click(cx.listener(|s, _, w, cx| s.begin_create_project(w, cx)))
        };
        let content = if closed {
            div().into_any_element()
        } else if let Some(text) = group
            .empty_text
            .clone()
            .filter(|_| cells.is_empty() && id == GroupId::LocalComputers)
        {
            // `.computer-mode-empty-computers`: why the group is empty, and
            // the way to fill it.
            h_flex()
                .justify_between()
                .gap(px(12.))
                .px(px(14.))
                .py(px(12.))
                .mx(px(inset))
                .rounded(px(10.))
                .border_1()
                .border_dashed()
                .border_color(theme::alpha(t.border, 0.85))
                .bg(theme::alpha(t.panel, 0.5))
                .text_size(px(theme::ty().ui.meta))
                .text_color(t.muted)
                .child(div().min_w_0().child(text))
                .when(group.create, |d| {
                    d.child(new_computer("home-new-computer-empty", cx))
                })
                .into_any_element()
        } else if let Some(text) = group.empty_text.clone().filter(|_| cells.is_empty()) {
            div()
                .min_h(px(32.))
                .flex()
                .items_center()
                .py(px(8.))
                .px(px(inset))
                .text_size(px(theme::ty().ui.meta))
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
            v_flex().gap(px(row_gap)).children(rows).into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .children(cells)
                .into_any_element()
        };
        let ty = theme::ty().ui;
        let head_end: Option<AnyElement> = match &group.drop {
            Some(drop) if drop.enabled => Some(
                div()
                    .flex_none()
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
        let space = group.mark.as_ref().and_then(|mark| match mark {
            super::super::groups::Mark::Space(space) => Some(space),
            _ => None,
        });
        let mark: Option<AnyElement> = group.mark.as_ref().map(|mark| match mark {
            super::super::groups::Mark::Space(space) => {
                crate::features::cloud::space_mark(space).into_any_element()
            }
            super::super::groups::Mark::Computer => Icon::product(ProductIcon::Local)
                .with_size(px(16.))
                .stroke(1.75)
                .color(t.muted)
                .into_any_element(),
            super::super::groups::Mark::Computers => Icon::new("cpu")
                .with_size(px(15.))
                .stroke(1.75)
                .color(t.muted)
                .into_any_element(),
        });
        // New computer beside the computers' heading, while it has any.
        let create = (group.create && !group.items.is_empty()).then(|| {
            div()
                .debug_selector(|| "home-new-computer".into())
                .flex_none()
                .child(new_computer("home-new-computer", cx))
        });
        // The plan and whether this account owns a shared space, said
        // quietly after the name rather than as badges.
        let plan = group.plan.as_deref().map(|plan| {
            let key = crate::workspace::cloud::spaces::PlanKey::of(plan).key();
            tr(&format!("onboarding.spaces.plan.{key}")).to_owned()
        });
        let owner = group
            .owner
            .then(|| tr("settings.space.role.owner").to_owned());
        let detail = [plan, owner]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ");
        let detail =
            (!detail.is_empty()).then(|| div().flex_none().text_color(t.subtle).child(detail));
        // The Cloud Agents that work in the personal space stand with it.
        let agents = space
            .filter(|space| space.is_default)
            .map(|_| self.discovery.cloud_agents.clone())
            .filter(|agents| !agents.is_empty())
            .map(super::super::components::SpaceAgents::new);
        let manage = group
            .manage
            .clone()
            .filter(|_| head_end.is_none())
            .map(|space| {
                Button::new(SharedString::from(format!("home-manage-{space}")))
                    .variant(ButtonVariant::Ghost)
                    .label(tr("settings.space.manage"))
                    .h(px(22.))
                    .px(px(6.))
                    .mr(px(-6.))
                    .text_size(px(ty.body))
                    .text_color(t.subtle)
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(HomeEvent::ManageSpace(space.clone()))
                    }))
            });
        let head = if plain {
            self.plain_folders_head(group.title.clone(), group.items.len(), inset, cx)
        } else {
            h_flex()
                .min_w_0()
                .h(px(24.))
                .items_center()
                .gap(px(8.))
                .mx(px(inset))
                .text_size(px(ty.body))
                .line_height(px(20.))
                .text_color(t.text)
                .children(mark)
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .font_weight(FontWeight::MEDIUM)
                        .child(group.title.clone()),
                )
                .children(detail)
                .children(presence)
                .child(div().flex_1())
                .children(agents)
                .children(head_end)
                .children(manage)
                .children(create)
                .into_any_element()
        };
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
            .gap(px(if grid { 6. } else { 4. }))
            .when(index > 0, |d| {
                d.pt(px(24.)).border_t_1().border_color(t.divider)
            })
            // `.computer-mode-muted-folders`: set off by a dashed rule, quiet
            // until the pointer comes.
            .when(plain, |d| {
                d.border_dashed()
                    .border_color(theme::alpha(t.border, 0.8))
                    .opacity(0.76)
                    .hover(|s| s.opacity(0.96))
            })
            .when(dragging && !available, |d| d.opacity(0.38))
            .when(available || lit, |d| {
                // Under the hairline, around the heading and its projects.
                d.child(
                    div()
                        .absolute()
                        .top(px(if index > 0 { 14. } else { -8. }))
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

impl Homepage {
    /// `.computer-mode-muted-folders-head`: the plain folders' toggle, their
    /// count and what they are.
    fn plain_folders_head(
        &self,
        title: String,
        count: usize,
        inset: f32,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let open = !self.plain_folders_closed;
        h_flex()
            .id("home-plain-folders-toggle")
            .debug_selector(|| "home-plain-folders-toggle".into())
            .min_w_0()
            .h(px(26.))
            .mx(px(inset - 6.))
            .px(px(6.))
            .items_center()
            .gap(px(7.))
            .rounded(px(7.))
            .text_size(px(ty.body))
            .line_height(px(20.))
            .text_color(t.muted)
            .cursor(theme::clickable_cursor())
            .hover(|s| s.bg(theme::alpha(t.text, 0.04)).text_color(t.text))
            .on_click(cx.listener(|s, _, _, cx| {
                s.plain_folders_closed = !s.plain_folders_closed;
                cx.notify();
            }))
            .child(
                Icon::new(if open {
                    "chevron-down"
                } else {
                    "chevron-right"
                })
                .with_size(px(14.))
                .stroke(1.8)
                .color(t.muted),
            )
            .child(
                Icon::product(ProductIcon::Folder)
                    .with_size(px(15.))
                    .stroke(1.75)
                    .color(t.muted),
            )
            .child(
                div()
                    .flex_none()
                    .font_weight(FontWeight::MEDIUM)
                    .child(title),
            )
            .child(
                div()
                    .flex_none()
                    .min_w(px(18.))
                    .h(px(17.))
                    .px(px(5.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(theme::alpha(t.text, 0.07))
                    .text_size(px(ty.caption))
                    .font_weight(FontWeight::MEDIUM)
                    .child(count.to_string()),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_color(t.subtle)
                    .child(tr("onboarding.computerMode.plainFolders.hint")),
            )
            .into_any_element()
    }
}

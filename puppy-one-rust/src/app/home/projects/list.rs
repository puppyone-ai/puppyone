//! `OnboardingProjectList`: the List's rows and the Grid's tiles, their Open
//! control, `LinkedCloudProjectButton` and the actions trigger.
use super::*;

impl Homepage {
    // -------------------------------------------------------- the groups
    /// `OnboardingProjectGroups`: the projects by audience over one scroll,
    /// so no group scrolls on its own or cuts off its last row. While a
    /// project is dragged, each group that takes it is filled faintly in
    /// its own bounds (more deeply under the pointer) and says what letting
    /// go does; the groups that cannot take it step back.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn project_groups(
        &mut self,
        groups: Vec<super::super::groups::Group>,
        note: Option<AnyElement>,
        held: bool,
        width: f32,
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
        let columns = if grid { grid_columns(width) } else { 1 };
        // On the Grid a group's edges are its folders' edges.
        let inset = if grid {
            (TILE_WIDTH - FOLDER_WIDTH) / 2.
        } else {
            8.
        };
        let dragging = groups.iter().any(|g| g.drop.is_some());
        let mut views = Vec::with_capacity(groups.len());
        for (index, group) in groups.into_iter().enumerate() {
            let view = self.project_group(
                index, group, columns, inset, dragging, narrow, busy, window, cx,
            );
            views.push(view);
        }
        let list = div()
            .id("home-projects")
            .w(px(width + SCROLLBAR_SIZE))
            .min_h_0()
            .flex_shrink(1.)
            .pt(px(4.))
            .pb(px(24.))
            .pr(px(SCROLLBAR_SIZE))
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                if !*hovered && s.hovered.take().is_some() {
                    cx.notify();
                }
            }))
            .child(
                v_flex()
                    .w(px(width))
                    .gap(px(20.))
                    .children(views)
                    .children(note),
            );
        // `mask-image`: the page fades over 8px at its top and 20px at its end.
        let fade = |top: bool| {
            div()
                .absolute()
                .left_0()
                .w(px(width))
                .h(px(if top { 8. } else { 20. }))
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
        inset: f32,
        dragging: bool,
        narrow: bool,
        busy: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use super::super::groups::DropAction;
        let t = cx.palette();
        let layout = self.preferences.read(cx).state.homepage_project_layout;
        let grid = layout == HomepageLayout::Grid;
        let id = group.id;
        let available = group.drop.as_ref().is_some_and(|d| d.enabled);
        let over = available && self.drop_over == Some(id);
        let marks = id.marks_places();
        // The group's own keyboard: its projects, one Tab stop.
        let ids: Vec<String> = group.items.iter().map(|i| i.id.clone()).collect();
        let stop = self.project_stop(&group.items);
        let mut cells = Vec::with_capacity(group.items.len());
        for (position, item) in group.items.iter().enumerate() {
            let index = self.cell_index(&item.id);
            self.action_bounds.entry(item.id.clone()).or_default();
            let focus = self.project_focus(&item.id, cx);
            let lit = self.project_lit(item, window, cx);
            let rise = if grid {
                self.sheet_rise(&item.id, lit, window, cx)
            } else {
                0.
            };
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
                    index, item, focus, rise, lit, is_stop, marks, busy, keys, cx,
                )
            } else {
                self.project_row(
                    index, item, focus, lit, is_stop, marks, narrow, busy, keys, cx,
                )
            });
        }
        let content = if let Some(text) = group.empty_text.clone().filter(|_| cells.is_empty()) {
            // `.onboarding-cloud-space-empty`.
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
                    h_flex().items_start().children(
                        cells
                            .by_ref()
                            .take(columns)
                            .map(|cell| div().w(px(TILE_WIDTH)).flex_none().child(cell)),
                    ),
                );
            }
            v_flex().gap(px(CELL_GAP)).children(rows).into_any_element()
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
        let detail = group
            .teams
            .clone()
            .map(|(teams, chosen)| self.team_selector(teams, chosen, busy, cx));
        let head = h_flex()
            .min_w_0()
            .items_center()
            .gap(px(8.))
            .mx(px(inset))
            .pb(px(4.))
            .when(index > 0, |d| {
                d.pt(px(12.)).border_t_1().border_color(t.divider)
            })
            .text_size(px(11.))
            .line_height(px(16.))
            .text_color(if over { t.text } else { t.subtle })
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .font_weight(FontWeight::MEDIUM)
                    .child(group.title.clone()),
            )
            .children(detail)
            .child(div().flex_1())
            .children(head_end);
        let drop_action = group.drop.clone().filter(|d| d.enabled).map(|d| d.action);
        div()
            .id(("home-group", index))
            .debug_selector(move || format!("home-group:{}", id.key()))
            .relative()
            .flex()
            .flex_col()
            .gap(px(2.))
            .when(dragging && !available, |d| d.opacity(0.38))
            // `::before`: the fill of a group that takes the drag.
            .when(available, |d| {
                d.child(
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .right_0()
                        .bottom(px(-6.))
                        .rounded(px(10.))
                        .bg(theme::alpha(t.text, if over { 0.09 } else { 0.04 })),
                )
            })
            .child(head)
            .child(content)
            .on_drag_move::<ProjectDrag>(cx.listener(
                move |s, event: &DragMoveEvent<ProjectDrag>, _, cx| {
                    let inside = event.bounds.contains(&event.event.position);
                    if inside && available && s.drop_over != Some(id) {
                        s.drop_over = Some(id);
                        cx.notify();
                    } else if !inside && s.drop_over == Some(id) {
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
    /// `.onboarding-team-selector`: several teams are chosen between inside
    /// the team group, never set out as headings of their own.
    fn team_selector(
        &self,
        teams: Vec<(String, String)>,
        chosen: String,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let open = self.menu == Some(HomeMenu::Team) && !busy;
        let name = teams
            .iter()
            .find(|(id, _)| *id == chosen)
            .map(|(_, name)| name.clone())
            .unwrap_or_default();
        let host = self.weak.clone();
        let trigger = Button::new("home-team-selector")
            .variant(ButtonVariant::Ghost)
            .label(name)
            .trailing(Icon::new("chevron-down").with_size(px(11.)).stroke(1.85))
            .accessibility_label(tr("onboarding.sharing.selectTeam"))
            .disabled(busy)
            .h(px(18.))
            .px(px(4.))
            .text_size(px(11.))
            .text_color(t.subtle);
        PopoverMenu::new("home-team-selector-menu")
            .anchor(Anchor::TopLeft)
            .offset(px(metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let is = s.menu == Some(HomeMenu::Team);
                    if *opened != is {
                        s.menu = opened.then_some(HomeMenu::Team);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu({
                let host = self.weak.clone();
                move |surface, _, _| {
                    surface.items(teams.iter().map(|(id, name)| {
                        let host = host.clone();
                        let id = id.clone();
                        checked_item(MenuItem::new(name.clone()), id == chosen).on_click(
                            move |_, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    s.chosen_team = Some(id.clone());
                                    s.dragging_path = None;
                                    cx.notify();
                                });
                            },
                        )
                    }))
                }
            })
            .into_any_element()
    }
    /// A stable index for a project's element ids across groups.
    fn cell_index(&self, id: &str) -> usize {
        let mut hash: usize = 5381;
        for byte in id.bytes() {
            hash = hash.wrapping_mul(33) ^ byte as usize;
        }
        hash
    }
    /// The parts every project has: its open control and what it reacts to.
    /// A local project drags out as its absolute path, which also goes to
    /// the clipboard (`startProjectDrag`).
    pub(in crate::app::home) fn open_control(
        &self,
        id: impl Into<ElementId>,
        item: &Item,
        focus: FocusHandle,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let hover_id = item.id.clone();
        let focus_id = item.id.clone();
        let open = item.clone();
        let drag = item
            .local_path
            .clone()
            .filter(|path| !busy && !path.trim().is_empty())
            .map(|path| ProjectDrag {
                path: path.trim().to_owned(),
                label: item_name(item).into(),
                native: Default::default(),
            });
        let selector = format!("home-project:{}", item.id);
        // `data-inactive`: an offline or paused computer's folder.
        let inactive = item.remote.as_ref().is_some_and(|r| !r.available());
        div()
            .id(id)
            .when(inactive, |d| d.opacity(0.5))
            .debug_selector(move || selector.clone())
            .track_focus(&focus)
            .on_key_down(keys)
            .on_hover(cx.listener(move |s, hovered: &bool, _, cx| {
                let next = hovered.then(|| hover_id.clone());
                if s.hovered != next && (*hovered || s.hovered.as_ref() == Some(&hover_id)) {
                    s.hovered = next;
                    cx.notify();
                }
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |s, _, _, cx| {
                    s.stop = Some(focus_id.clone());
                    cx.notify();
                }),
            )
            .when(!busy && !inactive, |d| {
                d.cursor(theme::clickable_cursor())
                    .on_click(cx.listener(move |s, _, _, cx| s.open_item(&open, cx)))
            })
            .when_some(drag, |d, drag| {
                let host = cx.weak_entity();
                d.on_drag(drag, move |drag, _, _, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(drag.path.clone()));
                    let path = drag.path.clone();
                    let _ = host.update(cx, |s, cx| {
                        s.dragging_path = Some(path);
                        cx.notify();
                    });
                    cx.new(|_| drag.clone())
                })
            })
    }
    /// `startProjectDrag` past the window's edge: the system's own drag
    /// session takes over with the path as text, and when it ends wherever
    /// it is dropped, so does the drag here.
    pub(in crate::app::home) fn drag_left_window(
        &mut self,
        drag: &ProjectDrag,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if drag.native.get() {
            return;
        }
        let (ended, end) = async_channel::bounded(1);
        let native = crate::platform::drag_out::begin_text(window, &drag.path, &drag.path, {
            move || {
                let _ = ended.try_send(());
            }
        });
        if !native {
            return;
        }
        drag.native.set(true);
        self.drop_over = None;
        let handle = window.window_handle();
        let host = cx.weak_entity();
        cx.spawn(async move |_, cx| {
            if end.recv().await.is_ok() {
                let _ = handle.update(cx, |_, window, cx| cx.stop_active_drag(window));
                let _ = host.update(cx, |s, cx| {
                    s.dragging_path = None;
                    cx.notify();
                });
            }
        })
        .detach();
        cx.notify();
    }
    /// One project as a row (`DesktopMenuItem.onboarding-project-row`).
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn project_row(
        &self,
        index: usize,
        item: &Item,
        focus: FocusHandle,
        lit: bool,
        is_stop: bool,
        marks: bool,
        narrow: bool,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let name = item_name(item);
        let linked = item.linked.is_some();
        let detail = match &item.local_path {
            Some(path) => parent_for_display(Path::new(path)),
            None => item_caption(item),
        };
        let modified = item.modified.filter(|m| *m > 0).map(|ms| {
            modification_time(
                UNIX_EPOCH + Duration::from_millis(ms as u64),
                SystemTime::now(),
            )
        });
        let dragging = self.dragging_item(item, cx);
        // `.has-cloud-project` rests quieter: the Cloud project is where
        // people and agents work.
        let name_color = if linked && !lit { t.subtle } else { t.text };
        let actions = self.project_actions_trigger(index, item, is_stop, busy, cx);
        let cloud_link = item
            .linked
            .clone()
            .map(|linked| self.linked_cloud_button(index, linked, false, is_stop, busy, cx));
        let reserve = if cloud_link.is_some() && lit {
            132.
        } else {
            0.
        };
        let row = self
            .open_control(("home-project", index), item, focus, busy, keys, cx)
            .w_full()
            .min_w_0()
            .h(px(theme::control()))
            .flex()
            .items_center()
            .gap(px(metric::MENU_ITEM_GAP))
            .pl(px(metric::MENU_ITEM_PADDING_INLINE))
            .pr(px(metric::MENU_ITEM_PADDING_INLINE.max(reserve)))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(ty.body))
            .line_height(px(18.))
            .text_color(t.text)
            .when(lit && !busy, |d| d.bg(t.hover))
            .when(busy, |d| d.opacity(0.58))
            .when(dragging, |d| d.bg(t.hover).opacity(0.62))
            .child(
                div()
                    .size(px(metric::MENU_ICON_SLOT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(super::folder::list_folder(lit, t)),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_baseline()
                    .gap(px(7.))
                    .child(
                        h_flex()
                            .min_w_0()
                            .items_center()
                            .when(!narrow, |d| d.flex_none().max_w(relative(0.65)))
                            .when(narrow, |d| d.flex_1())
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(name_color)
                                    .child(name),
                            )
                            .when(marks, |d| d.child(place_mark(item, t).ml(px(6.)))),
                    )
                    .when(!narrow, |d| {
                        d.child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(px(ty.caption))
                                .text_color(t.subtle)
                                .child(detail),
                        )
                    }),
            )
            .children(modified.map(|time| {
                div()
                    .flex_none()
                    .max_w(px(if narrow { 76. } else { 112. }))
                    .truncate()
                    .text_size(px(ty.caption))
                    .text_color(t.subtle)
                    .when(lit, |d| d.invisible())
                    .child(time)
            }));
        div()
            .relative()
            .min_w_0()
            .child(row)
            .children(cloud_link.map(|link| {
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(34.))
                    .flex()
                    .items_center()
                    .when(!lit, |d| d.invisible())
                    .child(link)
            }))
            .children(actions.map(|actions| {
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(6.))
                    .flex()
                    .items_center()
                    .when(!lit, |d| d.invisible())
                    .child(actions)
            }))
            .into_any_element()
    }
    /// One project on the Grid: a folder and one line of name. The tooltip
    /// adds where it lives and when it last changed (and the name when the
    /// line cuts it).
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn project_tile(
        &self,
        index: usize,
        item: &Item,
        focus: FocusHandle,
        rise: f32,
        lit: bool,
        is_stop: bool,
        marks: bool,
        busy: bool,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let name = item_name(item);
        let place = match &item.local_path {
            Some(path) => parent_for_display(Path::new(path)),
            None => item_caption(item),
        };
        let modified = item.modified.filter(|m| *m > 0).map(|ms| {
            modification_time(
                UNIX_EPOCH + Duration::from_millis(ms as u64),
                SystemTime::now(),
            )
        });
        let linked = item.linked.is_some();
        // A cut name joins the tooltip; the tile is about 112px, so the
        // estimate uses the caption's average advance.
        let cut = name.chars().count() as f32 * theme::ty().ui.caption * 0.56
            > TILE_WIDTH - 8. - if marks { 16. } else { 0. };
        let tooltip = [cut.then(|| name.clone()), Some(place), modified]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        let tile = self
            .open_control(("home-tile", index), item, focus, busy, keys, cx)
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(8.))
            .pt(px(12.))
            .px(px(4.))
            .pb(px(8.))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_color(t.text)
            .when(lit && !busy, |d| d.bg(t.hover))
            .when(busy, |d| d.opacity(0.58))
            .when(self.dragging_item(item, cx), |d| d.opacity(0.62))
            .tooltip(crate::ui::components::tooltip(tooltip))
            .child(super::folder::grid_folder(rise, lit, t))
            .child(
                // `.onboarding-project-tile-label`: the name, and in a shared
                // group the small mark of where it lives.
                h_flex()
                    .max_w_full()
                    .min_w_0()
                    .items_center()
                    .justify_center()
                    .gap(px(4.))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(theme::ty().ui.caption))
                            .line_height(px(16.))
                            .text_color(if linked && !lit { t.subtle } else { t.text })
                            .child(name),
                    )
                    .when(marks, |d| d.child(place_mark(item, t))),
            );
        let actions = self.project_actions_trigger(index, item, is_stop, busy, cx);
        let cloud_link = item
            .linked
            .clone()
            .map(|linked| self.linked_cloud_button(index, linked, true, is_stop, busy, cx));
        div()
            .relative()
            .min_w_0()
            .child(tile)
            .children(cloud_link.map(|link| {
                div()
                    .absolute()
                    .top(px(4.))
                    .left(px(4.))
                    .when(!lit, |d| d.invisible())
                    .child(link)
            }))
            .children(actions.map(|actions| {
                div()
                    .absolute()
                    .top(px(4.))
                    .right(px(4.))
                    .when(!lit, |d| d.invisible())
                    .child(actions)
            }))
            .into_any_element()
    }
    /// `LinkedCloudProjectButton`: opens the folder's own Cloud project, the
    /// other project of the pair. On a tile only its cloud shows.
    pub(in crate::app::home) fn linked_cloud_button(
        &self,
        index: usize,
        linked: crate::workspace::cloud::catalog::Linked,
        compact: bool,
        is_stop: bool,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let label = tf(
            "cloud.home.openLinkedCloudProject",
            &[("project", linked.name.clone().into())],
        );
        let hint = tf(
            "cloud.home.linkedCloudProjectHint",
            &[("project", linked.name.clone().into())],
        );
        let project = linked.id.clone();
        div()
            .id(("home-project-cloud-link", index))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(4.))
            .when(!compact, |d| d.px(px(6.)).py(px(4.)))
            .when(compact, |d| d.size(px(24.)))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(theme::ty().ui.caption))
            .text_color(t.muted)
            .tooltip(crate::ui::components::tooltip(hint))
            .debug_selector(move || format!("cloud-link:{label}"))
            .when(!busy, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(t.text))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(cx.listener(move |s, _, _, cx| {
                        cx.stop_propagation();
                        s.open_cloud(project.clone(), cx);
                    }))
            })
            .when(!is_stop, |d| d)
            .child(
                Icon::product(ProductIcon::Cloud)
                    .with_size(px(12.))
                    .color(t.brand_blue),
            )
            .when(!compact, |d| d.child(tr("cloud.home.location.cloud")))
            .into_any_element()
    }
    /// `ProjectRowActions`' trigger, only where the account may change the
    /// project; an entry with nothing to offer has none.
    pub(in crate::app::home) fn project_actions_trigger(
        &self,
        index: usize,
        item: &Item,
        _is_stop: bool,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let target = crate::app::project_actions::Target::of(item)?;
        let t = cx.palette();
        let name = item_name(item);
        let open = self.actions.read(cx).item() == Some(item.id.as_str());
        let id = item.id.clone();
        let label = tf(
            "shell.workspaceSwitcher.projectActionsFor",
            &[("project", name.into())],
        );
        let bounds = self
            .action_bounds
            .get(&item.id)
            .cloned()
            .unwrap_or_default();
        let measured = bounds.clone();
        Some(
            div()
                .relative()
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(
                    IconButton::new(
                        ("home-project-actions", index),
                        Icon::new("ellipsis-vertical").small(),
                    )
                    .label(label)
                    .tooltip(tr("shell.workspaceSwitcher.projectActions"))
                    .with_size(px(22.))
                    .when(open, |b| b.color(t.text))
                    .disabled(busy)
                    .on_click(cx.listener(move |s, _, w, cx| {
                        cx.stop_propagation();
                        let actions = s.actions.clone();
                        if actions.read(cx).item() == Some(id.as_str()) {
                            actions.update(cx, |a, cx| a.close(cx));
                            return;
                        }
                        let (target, at, viewport) =
                            (target.clone(), bounds.get(), w.viewport_size());
                        let item = Some(id.clone());
                        let audience = s.audience_of_id(&id, cx);
                        actions.update(cx, |a, cx| {
                            a.open(target, at, true, viewport, item, cx);
                            a.set_audience(audience, cx);
                        });
                    })),
                )
                .child(
                    canvas(move |b, _, _| measured.set(b), |_, _, _, _| {})
                        .absolute()
                        .inset_0(),
                )
                .into_any_element(),
        )
    }
}

/// `ProjectPlaceMark`: where a shared project lives, as one small mark after
/// its name: the Cloud, or a computer.
fn place_mark(item: &Item, t: Theme) -> Div {
    let meaning = if item.local_path.is_some() || item.remote.is_some() {
        ProductIcon::Local
    } else {
        ProductIcon::Cloud
    };
    div()
        .flex_none()
        .flex()
        .items_center()
        .text_color(t.subtle)
        .child(Icon::product(meaning).with_size(px(12.)).stroke(1.85))
}

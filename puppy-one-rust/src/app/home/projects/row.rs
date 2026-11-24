//! List row rendering (`DesktopMenuItem.onboarding-project-row`), shared open
//! and drag-out controls, `LinkedCloudProjectButton`, and `ProjectRowActions`.
use super::{
    super::{
        display::{item_caption, item_name, parent_for_display},
        folder::ProjectFolderGlyph,
    },
    *,
};

impl Homepage {
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
        let unavailable = item
            .local_path
            .as_deref()
            .filter(|path| self.folder_status(Path::new(path)).is_some())
            .map(PathBuf::from);
        let drag = item
            .local_path
            .clone()
            .filter(|path| !busy && !path.trim().is_empty() && unavailable.is_none())
            .map(|path| ProjectDrag {
                path: path.trim().to_owned(),
                label: item_name(item).into(),
                native: Default::default(),
            });
        let selector = format!("home-project:{}", item.id);
        let inactive = item.remote.as_ref().is_some_and(|r| !r.available());
        div()
            .id(id)
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
                    .on_click(cx.listener(move |s, _, _, cx| match &unavailable {
                        Some(path) => s.open_unavailable(path.clone(), cx),
                        None => s.open_item(&open, cx),
                    }))
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
        narrow: bool,
        busy: bool,
        look: Look,
        keys: impl Fn(&KeyDownEvent, &mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let name = item_name(item);
        let linked = item.linked.is_some();
        let status = item
            .local_path
            .as_deref()
            .and_then(|path| self.folder_status(Path::new(path)));
        // The group heading says where a project lives: a Cloud project
        // needs no place of its own here.
        let detail = match (&item.local_path, status) {
            (Some(_), Some(status)) => {
                Some(tr(super::super::folder_status::status_caption(status)).into())
            }
            (Some(path), None) => Some(super::super::compact_display_path(
                &parent_for_display(Path::new(path)),
                2,
            )),
            (None, _) => item.remote.is_some().then(|| item_caption(item)),
        };
        let modified = super::tile::modified_ago(item);
        let dragging = self.dragging_item(item, cx);
        let inactive = item.remote.as_ref().is_some_and(|r| !r.available());
        let fade = if inactive {
            Some(0.5 * 0.58)
        } else {
            status.map(|_| 0.4)
        };
        let name_color = if inactive { t.text_disabled } else { t.text };
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
            .h(px(44.))
            .flex()
            .items_center()
            .gap(px(12.))
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
                    .w(px(34.))
                    .h(px(26.))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(match look {
                        Look::Computer(kind) => {
                            let power = match kind {
                                super::super::folder::ComputerKind::OnDevice => {
                                    self.item_power(item, cx)
                                }
                                super::super::folder::ComputerKind::Cloud => {
                                    super::super::folder::ComputerPower::Running
                                }
                            };
                            super::super::folder::ProjectComputerGlyph::compact(
                                kind,
                                power,
                                self.item_previews(item),
                            )
                            .lit(lit)
                            .fade(fade)
                            .into_any_element()
                        }
                        _ => ProjectFolderGlyph::compact(self.item_previews(item))
                            .lit(lit)
                            .fade(fade)
                            .into_any_element(),
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_baseline()
                    .gap(px(7.))
                    .when(inactive, |d| d.opacity(0.5 * 0.58))
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
                            .when(linked, |d| d.child(linked_mark(t).ml(px(6.)))),
                    )
                    .children(detail.filter(|_| !narrow).map(|detail| {
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(ty.meta))
                            .text_color(if status.is_some() { t.muted } else { t.subtle })
                            .child(detail)
                    })),
            )
            .children(modified.map(|time| {
                div()
                    .flex_none()
                    .max_w(px(if narrow { 76. } else { 112. }))
                    .truncate()
                    .text_size(px(ty.meta))
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
        let focus = self.action_focus.get(&item.id).cloned();
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
                    .when_some(focus, |b, focus| b.track_focus(&focus))
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
                            a.open(target, at, true, viewport, item, w, cx);
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

/// A folder on this computer that also has its own Cloud project says so
/// with one small cloud after its name.
pub(super) fn linked_mark(t: Theme) -> Div {
    div()
        .flex_none()
        .flex()
        .items_center()
        .text_color(t.subtle)
        .child(
            Icon::product(ProductIcon::Cloud)
                .with_size(px(12.))
                .stroke(1.85),
        )
}

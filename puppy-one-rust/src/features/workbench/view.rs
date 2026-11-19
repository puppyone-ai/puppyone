//! `AuxiliaryWorkbenchPanel`: groups and their splits, the launcher or item
//! each shows, drag and split previews, and the creation-failure notice.
use super::*;

impl Workbench {
    pub(super) fn group(&mut self, id: Id, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let g = self.project().unwrap().layout.groups[&id].clone();
        let width = self
            .bounds
            .get(&id)
            .map(|b| f32::from(b.size.width))
            .unwrap_or(360.);
        // `AuxiliaryWorkbenchPanel`: with no items at all the launcher fills
        // the panel and there is no tab header.
        let empty = self
            .project()
            .unwrap()
            .layout
            .groups
            .values()
            .all(|g| g.tabs.is_empty());
        let header = (!empty).then(|| self.render_header(id, width, cx));
        let split_preview = match self.drop_intent {
            Some(DropIntent::Split {
                group,
                edge,
                allowed,
            }) if group == id => Some((edge, allowed)),
            _ => None,
        };
        let content = match g
            .active
            .and_then(|tab| self.project().unwrap().content.get(&tab))
        {
            Some(Content::Retained(item)) => {
                let item = item.clone();
                let tab = g.active.unwrap();
                let title = item.title();
                v_flex()
                    .p(px(20.))
                    .gap(px(12.))
                    .child(title)
                    .child(
                        div()
                            .text_color(t.muted)
                            .child(crate::localization::t("native.agent.retainedDetail")),
                    )
                    .child(
                        h_flex().child(
                            Button::new(("resume-retained", tab))
                                .variant(ButtonVariant::OutlinePrimary)
                                .icon("rotate-ccw")
                                .label(crate::localization::t(
                                    if matches!(item, RetainedItem::Terminal { .. }) {
                                        "terminal.launcher.shell.action"
                                    } else {
                                        "agent.readiness.reconnect"
                                    },
                                ))
                                .on_click(cx.listener(move |s, _, w, cx| {
                                    s.reopen(id, tab, item.clone(), w, cx)
                                })),
                        ),
                    )
                    .into_any_element()
            }
            Some(Content::Item { item, .. }) => {
                div().size_full().child(item.view()).into_any_element()
            }
            _ => match self.host.clone() {
                Some(host) => {
                    let context = LauncherContext {
                        group: id,
                        tab: g.active,
                        width,
                        can_chat: self.can_create(ItemKind::Chat),
                        can_terminal: self.can_create(ItemKind::Terminal),
                    };
                    host.launcher(context, cx)
                }
                None => div().into_any_element(),
            },
        };
        let group = v_flex()
            .id(("group", id))
            .size_full()
            .min_w_0()
            .min_h_0()
            .relative()
            .overflow_hidden()
            .bg(t.auxiliary())
            .children(header);
        let entity = cx.entity();
        group
            .child(
                div()
                    .id(("group-content", id))
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .child(content)
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                entity.update(cx, |s, cx| {
                                    // Header density follows the measured group width.
                                    if s.bounds.insert(id, bounds) != Some(bounds) {
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .when_some(split_preview, |d, (edge, allowed)| {
                        // `.desktop-terminal-drop-preview`: the half the tab would take.
                        // Refused drops stripe 10% / 18% danger at 135deg, 5px each.
                        let preview = div()
                            .absolute()
                            .bg(if allowed { theme::alpha(t.accent, 0.14) } else { theme::alpha(t.danger, 0.10) })
                            .when(!allowed, |d| {
                                d.child(
                                    div()
                                        .size_full()
                                        .bg(pattern_slash(theme::alpha(t.danger, 0.089), 5., 5.)),
                                )
                            });
                        d.child(match edge {
                            Edge::Left => preview.top_0().bottom_0().left_0().w(relative(0.5)),
                            Edge::Right => preview.top_0().bottom_0().right_0().w(relative(0.5)),
                            Edge::Top => preview.left_0().right_0().top_0().h(relative(0.5)),
                            Edge::Bottom => preview.left_0().right_0().bottom_0().h(relative(0.5)),
                        })
                    })
                    .on_drag_move::<DragTab>(cx.listener(move |s, e: &DragMoveEvent<DragTab>, _, cx| {
                        let drag = e.drag(cx).clone();
                        if s.root.as_ref() != Some(&drag.root) {
                            return;
                        }
                        let b = e.bounds;
                        let p = e.event.position;
                        let here = matches!(s.drop_intent, Some(DropIntent::Split { group, .. }) if group == id);
                        if !b.contains(&p) {
                            if here {
                                s.drop_intent = None;
                                cx.notify();
                            }
                            return;
                        }
                        let edge = drag::closest_edge(
                            f32::from(b.origin.x),
                            f32::from(b.origin.y),
                            f32::from(b.size.width),
                            f32::from(b.size.height),
                            f32::from(p.x),
                            f32::from(p.y),
                        );
                        let allowed = s.can_split(drag.tab, id, edge.split().0, b);
                        let next = Some(DropIntent::Split { group: id, edge, allowed });
                        s.dragging = Some(drag.tab);
                        if s.drop_intent != next {
                            s.drop_intent = next;
                            cx.notify();
                        }
                    }))
                    .on_drop(cx.listener(move |s, drag: &DragTab, _, cx| {
                        if s.root.as_ref() != Some(&drag.root) {
                            return;
                        }
                        if let Some(DropIntent::Split { group, edge, allowed: true }) = s.drop_intent
                            && group == id
                        {
                            let (axis, after) = edge.split();
                            s.split(id, axis, Some(drag.tab), after, cx);
                        }
                        s.drop_intent = None;
                        s.dragging = None;
                        cx.notify();
                    })),
            )
            .into_any_element()
    }

    pub(super) fn node(&mut self, node: &Node, cx: &mut Context<Self>) -> AnyElement {
        match node {
            Node::Group(id) => self.group(*id, cx),
            Node::Split {
                id,
                axis,
                ratio,
                first,
                second,
            } => {
                let id = *id;
                let axis = *axis;
                let t = cx.palette();
                let a = self.node(first, cx);
                let b = self.node(second, cx);
                let entity = cx.entity();
                let horizontal = axis == Axis::Horizontal;
                // `grid-template-*: (100% - 1px) × ratio | 1px | rest`.
                let total = self.bounds.get(&id).map(|b| {
                    f32::from(if horizontal {
                        b.size.width
                    } else {
                        b.size.height
                    })
                });
                let first_size = total.map(|total| (total - layout::DIVIDER).max(0.) * ratio);
                let resizing = self.drag_split.map(|d| d.0) == Some(id);
                // `.desktop-terminal-splitter`: the 1px painter in the flow and
                // an 8px hit lane centred on it, above both panes, whose stroke
                // paints the hover and drag states over the painter.
                let painter = div()
                    .flex_shrink_0()
                    .when(horizontal, |d| d.w(px(layout::DIVIDER)).h_full())
                    .when(!horizontal, |d| d.h(px(layout::DIVIDER)).w_full())
                    .bg(t.divider);
                let hit = theme::metric::PANE_SASH;
                let offset = (hit - layout::DIVIDER) / 2.;
                let start = first_size.map(px).unwrap_or(px(0.)) - px(offset);
                let lane = ResizeHandle::new(
                    ("split-sash", id),
                    if horizontal {
                        gpui::Axis::Horizontal
                    } else {
                        gpui::Axis::Vertical
                    },
                )
                .stroke_at(offset)
                .resizing(resizing)
                .on_drag_start(cx.listener(move |s, _, _, cx| {
                    if let Some(bounds) = s.bounds.get(&id) {
                        s.drag_split = Some((id, axis, *bounds));
                    }
                    cx.notify();
                }))
                .absolute()
                .occlude()
                .when(horizontal, |d| d.top_0().bottom_0().left(start).w(px(hit)))
                .when(!horizontal, |d| d.left_0().right_0().top(start).h(px(hit)));
                div()
                    .relative()
                    .flex()
                    .when(!horizontal, |d| d.flex_col())
                    .size_full()
                    .min_h_0()
                    .min_w_0()
                    .child(
                        div()
                            .min_w_0()
                            .min_h_0()
                            .flex_shrink_0()
                            .overflow_hidden()
                            .map(|d| match (horizontal, first_size) {
                                (true, Some(size)) => d.w(px(size)).h_full(),
                                (true, None) => d.w(relative(*ratio)).h_full(),
                                (false, Some(size)) => d.h(px(size)).w_full(),
                                (false, None) => d.h(relative(*ratio)).w_full(),
                            })
                            .child(a),
                    )
                    .child(painter)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .overflow_hidden()
                            .child(b),
                    )
                    .when(first_size.is_some(), |d| d.child(lane))
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                entity.update(cx, |s, cx| {
                                    if s.bounds.insert(id, bounds) != Some(bounds) {
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .into_any_element()
            }
        }
    }

    /// `onMoveByKeyboard`: split `group`'s active tab to `edge` if `canDrop`.
    pub(super) fn move_active_to_edge(&mut self, group: Id, edge: Edge, cx: &mut Context<Self>) {
        let Some(tab) = self
            .project()
            .and_then(|p| p.layout.groups.get(&group))
            .and_then(|g| g.active)
        else {
            return;
        };
        let Some(bounds) = self.bounds.get(&group).copied() else {
            return;
        };
        let (axis, after) = edge.split();
        if self.can_split(tab, group, axis, bounds) {
            self.split(group, axis, Some(tab), after, cx);
        }
    }

    /// `retryCreation`: the contribution tries the same creation again.
    pub(super) fn retry_creation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.shown_failure().is_none() {
            return;
        }
        let Some(failure) = self.creation_failure.take() else {
            return;
        };
        cx.notify();
        // The contribution reads the workbench: it retries after this update.
        if let Some(retry) = failure.retry {
            window.defer(cx, move |window, cx| retry(window, cx));
        }
    }

    /// `AuxiliaryWorkbenchCreationFailure` in the panel's top notice stack.
    pub(super) fn creation_notice(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::ui::components::{
            FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone,
        };
        let failure = self.shown_failure()?;
        let ty = theme::ty();
        let entity = cx.entity();
        let retry = entity.clone();
        let mut notice = FloatingNotice::new("workbench-creation-failure", failure.message.clone())
            .tone(NoticeTone::Danger)
            .text(ty.right.meta, ty.right.meta_line_height);
        // Only a failure that says so is worth another try.
        if failure.retry.is_some() {
            notice = notice.action(NoticeAction::new(
                "workbench-creation-retry",
                crate::localization::t("common.action.retry"),
                move |window, cx| retry.update(cx, |s, cx| s.retry_creation(window, cx)),
            ));
        }
        Some(
            // `.desktop-auxiliary-workbench-notice-stack`: under the tab strip,
            // 8px from both edges.
            NoticeStack::new(NoticePlacement::Top, 46., 8., 0.)
                .child(
                    notice
                        .dismiss_label(crate::localization::t("terminal.workbench.dismissError"))
                        .on_dismiss(move |_, cx| {
                            entity.update(cx, |s, cx| {
                                s.creation_failure = None;
                                cx.notify();
                            })
                        }),
                )
                .into_any_element(),
        )
    }

    pub(super) fn end_drag(&mut self, cx: &mut Context<Self>) {
        if self.drag_split.is_some() || self.drop_intent.is_some() || self.dragging.is_some() {
            self.drag_split = None;
            self.drop_intent = None;
            self.dragging = None;
            cx.notify();
        }
    }

    /// Minimum size of a group: the largest of its items'
    /// (`AuxiliaryWorkbenchContribution.minimumSize`; chat 280×260, terminal
    /// `terminalLeafMinimumSize` 188×196).
    pub(super) fn group_minimum(&self, group: Id) -> (f32, f32) {
        let Some(project) = self.project() else {
            return (280., 260.);
        };
        let tabs = project
            .layout
            .groups
            .get(&group)
            .map(|g| g.tabs.clone())
            .unwrap_or_default();
        tabs.iter()
            .map(|tab| {
                project
                    .content
                    .get(tab)
                    .map_or(ItemKind::Chat.minimum_size(), Content::minimum_size)
            })
            .fold(None, |acc: Option<(f32, f32)>, (w, h)| {
                Some(acc.map_or((w, h), |(aw, ah)| (aw.max(w), ah.max(h))))
            })
            .unwrap_or((280., 260.))
    }

    /// `canPlaceWorkbenchSplit` for dropping `source` on `target`'s `edge`.
    pub(super) fn can_split(
        &self,
        source: Id,
        target: Id,
        axis: Axis,
        bounds: Bounds<Pixels>,
    ) -> bool {
        let Some(project) = self.project() else {
            return false;
        };
        let Some(source_group) = project
            .layout
            .groups
            .iter()
            .find(|(_, g)| g.tabs.contains(&source))
            .map(|(id, _)| *id)
        else {
            return false;
        };
        let remaining: Vec<Id> = project.layout.groups[&target]
            .tabs
            .iter()
            .copied()
            .filter(|t| *t != source)
            .collect();
        if remaining.is_empty() {
            return false;
        }
        if source_group != target && project.layout.groups[&source_group].tabs.len() == 1 {
            return true;
        }
        let minimum = |tab: &Id| {
            project
                .content
                .get(tab)
                .map_or(ItemKind::Chat.minimum_size(), Content::minimum_size)
        };
        let source_min = minimum(&source);
        let target_min = remaining
            .iter()
            .map(minimum)
            .fold((1f32, 1f32), |(w, h), (a, b)| (w.max(a), h.max(b)));
        let size = (f32::from(bounds.size.width), f32::from(bounds.size.height));
        Layout::fits(axis, size, source_min, target_min)
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::platform::watchdog::activity("workbench.render");
        let t = cx.palette();
        let close_dialog = self.render_close_dialog(window, cx);
        let loading = self.project().is_some_and(|p| p.loading);
        let error = self.project().and_then(|p| p.storage_error.clone());
        let tree = self.project().map(|p| p.layout.tree.clone());
        let content = if loading {
            div()
                .p(px(20.))
                .child(crate::localization::t("workspace.restoring.message"))
                .into_any_element()
        } else if let Some(tree) = tree {
            self.node(&tree, cx)
        } else {
            div()
                .p(px(24.))
                .text_color(t.muted)
                .child(crate::localization::t("agent.launcher.title"))
                .into_any_element()
        };
        let context_menu = self.render_context_menu(cx);
        div()
            .size_full()
            .bg(t.auxiliary())
            .text_color(t.text)
            .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                if let Some((id, axis, b)) = s.drag_split {
                    let horizontal = axis == Axis::Horizontal;
                    let total = f32::from(if horizontal {
                        b.size.width
                    } else {
                        b.size.height
                    });
                    let offset = f32::from(if horizontal {
                        e.position.x - b.origin.x
                    } else {
                        e.position.y - b.origin.y
                    });
                    let ratio = offset / (total - layout::DIVIDER).max(1.);
                    // `clampWorkbenchRatioToBounds` with both sides' minimum sizes.
                    let bounds = s.project().and_then(|p| {
                        let Node::Split { first, second, .. } = p.layout.find(id)? else {
                            return None;
                        };
                        let leaf = |group: Id| s.group_minimum(group);
                        Some(Layout::ratio_bounds(
                            axis,
                            total,
                            Layout::min_size(first, &leaf),
                            Layout::min_size(second, &leaf),
                        ))
                    });
                    let ratio = bounds.map_or(ratio, |(min, max)| ratio.clamp(min, max));
                    if let Some(p) = s.project_mut() {
                        p.layout.resize(id, ratio);
                    }
                    cx.notify();
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|s, _, _, cx| s.end_drag(cx)))
            // A tab released over the sidebar or editor still ends the move.
            .on_mouse_up_out(MouseButton::Left, cx.listener(|s, _, _, cx| s.end_drag(cx)))
            .children(close_dialog)
            .children(context_menu)
            .child(
                v_flex()
                    .size_full()
                    .when_some(error, |d, e| {
                        d.child(div().p(px(8.)).text_color(t.focus).child(e))
                    })
                    .child(div().flex_1().min_h_0().child(content)),
            )
            .children(self.creation_notice(cx))
    }
}

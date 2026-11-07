//! Shell wiring for the retained Editor workbench. No file reads or saves here.
use super::*;
use crate::editor::workbench::layout::{Direction, Node, Placement};
use crate::ui::components::{Icon, ResizeHandle, tooltip};
use gpui_kit::{base::h_flex, component::Sizable as _};

pub(super) struct EditorResize {
    pub workspace: String,
    pub split: String,
    pub rect: Rect,
    pub direction: Direction,
    pub original: f64,
}
#[derive(Clone, PartialEq)]
pub(super) struct EditorDrop {
    pane: String,
    direction: Direction,
    placement: Placement,
}
#[derive(Clone)]
struct TabDrag {
    owner: EntityId,
    key: String,
    label: String,
}
impl Render for TabDrag {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().px_2().child(self.label.clone())
    }
}
impl Shell {
    /// A Finder drop that names one file of this window's local workspace,
    /// as a workspace path (folders and anything outside are not admitted).
    pub(super) fn external_document(&self, paths: &ExternalPaths, cx: &App) -> Option<PathBuf> {
        let [path] = paths.paths() else {
            return None;
        };
        let root = self.workspace_root()?;
        let relative = path.strip_prefix(&root).ok()?;
        let normal = relative
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)));
        (normal
            && !relative.as_os_str().is_empty()
            && !self.explorer_session.read(cx).is_folder(relative))
        .then(|| relative.to_path_buf())
    }
    /// `.editor-save-overlay` / `EditorSaveButton`: a failed save offers
    /// Retry everywhere; hosted documents and file windows also show
    /// Saving… and Saved (`showSaveStatus`), and a file window's unsaved
    /// edits offer Save (`saveMode === "manual"`). Clean documents show
    /// nothing.
    pub(super) fn save_chip(&self, slot: u64, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::documents::SaveStatus;
        let files = self.session.files.slot(slot)?;
        let hosted = files
            .workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root().is_none());
        let show_status = hosted || files.file_window;
        let status = files.save_status();
        if status == SaveStatus::Saved && self.editor.saved_refresh.is_none() {
            let weak = cx.weak_entity();
            let task = cx.spawn(async move |_, cx| {
                cx.background_executor()
                    .timer(crate::documents::SAVED_STATUS_DURATION)
                    .await;
                let _ = weak.update(cx, |s, cx| {
                    s.editor.saved_refresh = None;
                    cx.notify();
                });
            });
            // Rendering cannot mutate; the timer is kept by the next update.
            let weak = cx.weak_entity();
            cx.defer(move |cx| {
                let _ = weak.update(cx, |s, _| {
                    if s.editor.saved_refresh.is_none() {
                        s.editor.saved_refresh = Some(task);
                    }
                });
            });
        }
        let t = cx.palette();
        // `.editor-save-chip`, fading in over 180ms (`editor-save-fade-in`).
        let chip = |id: &'static str| {
            h_flex()
                .id(SharedString::from(format!("{id}-{slot}")))
                .h(px(theme::control()))
                .px(px(10.))
                .gap(px(6.))
                .rounded(px(6.))
                .text_size(px(theme::ty().ui.body))
                .font_weight(FontWeight::MEDIUM)
                .whitespace_nowrap()
        };
        let glyph =
            |name: &'static str, color: Rgba| Icon::new(name).with_size(px(14.)).color(color);
        // `dirty` outranks `saved`: typing after a save asks to save again.
        let unsaved = files.file_window && files.dirty && status != SaveStatus::Saving;
        let (key, body) = match status {
            SaveStatus::Failed => (
                "failed",
                chip("editor-save-failed")
                    .bg(theme::alpha(t.danger, 0.16))
                    .text_color(t.danger)
                    .hover(|d| d.bg(theme::alpha(t.danger, 0.24)))
                    .child(glyph("editor-save-alert", t.danger))
                    .child(crate::localization::t("editor.save.failed"))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.session.files.retry_slot_save(slot, &s.session.wake);
                        cx.notify();
                    }))
                    .into_any_element(),
            ),
            _ if unsaved => (
                "action",
                chip("editor-save-action")
                    .bg(t.warning)
                    .text_color(t.text_inverse)
                    .hover(|d| d.bg(theme::mix(t.warning, t.text, 0.88)))
                    .child(glyph("editor-save", t.text_inverse))
                    .child(crate::localization::t("editor.save.action"))
                    .on_click(cx.listener(|s, _, window, cx| s.command(Command::Save, window, cx)))
                    .into_any_element(),
            ),
            SaveStatus::Saving if show_status => (
                "saving",
                chip("editor-save-saving")
                    .bg(t.border_subtle)
                    .text_color(t.muted)
                    .child(
                        div()
                            .size(px(7.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(
                                div()
                                    .size(px(7.))
                                    .rounded_full()
                                    .bg(t.muted)
                                    .with_animation(
                                        ElementId::NamedInteger("editor-save-pulse".into(), slot),
                                        Animation::new(std::time::Duration::from_millis(820))
                                            .repeat(),
                                        |d, delta| {
                                            // `tree-loading-pulse`: 0.35 → 0.9 → 0.35
                                            // opacity, 0.86 → 1 scale.
                                            let wave = 1. - (delta * 2. - 1.).abs();
                                            d.opacity(0.35 + 0.55 * wave)
                                                .size(px(7. * (0.86 + 0.14 * wave)))
                                        },
                                    ),
                            ),
                    )
                    .child(crate::localization::t("editor.save.saving"))
                    .into_any_element(),
            ),
            SaveStatus::Saved if show_status => (
                "saved",
                chip("editor-save-saved")
                    .bg(theme::alpha(t.success, 0.14))
                    .text_color(t.success)
                    .child(glyph("editor-save-check", t.success))
                    .child(crate::localization::t("editor.save.saved"))
                    .into_any_element(),
            ),
            _ => return None,
        };
        Some(
            div()
                .absolute()
                .top(px(10.))
                .right(px(12.))
                .child(
                    div().child(body).with_animation(
                        SharedString::from(format!("editor-save-fade-{key}-{slot}")),
                        Animation::new(std::time::Duration::from_millis(180))
                            .with_easing(|t| crate::ui::motion::cubic_bezier(0., 0., 0.58, 1., t)),
                        |d, delta| d.opacity(delta).mt(px(-2. * (1. - delta))),
                    ),
                )
                .into_any_element(),
        )
    }
    /// `AgentFilePresence` over a local document's pane (top 8px, 38px from
    /// the end, clear of the pane handle).
    fn file_presence(&self, slot: u64, cx: &App) -> Option<AnyElement> {
        use crate::ui::components::{FilePresence, PresenceVariant};
        if !self
            .preferences
            .read(cx)
            .state
            .agent_file_activity_indicators
        {
            return None;
        }
        let files = self.session.files.slot(slot)?;
        let root = files.workspace.as_ref()?.local_root()?;
        let relative = match (&files.document, &files.resource) {
            (Some(document), _) => document.relative.as_path(),
            (None, Some(resource)) => resource.relative.as_path(),
            (None, None) => return None,
        };
        let store = crate::features::agent_presence::store(cx)?;
        let projection = store
            .read(cx)
            .projection(&self.session.key, root, relative)?;
        Some(
            div()
                .absolute()
                .top(px(8.))
                .right(px(38.))
                .child(
                    FilePresence::new(
                        ("editor-presence", slot as usize),
                        PresenceVariant::Editor,
                        projection.primary.provider,
                    )
                    .reading(projection.primary.reading)
                    .active(projection.primary.active)
                    .more(projection.additional),
                )
                .into_any_element(),
        )
    }
    pub(super) fn focus_editor_slot(&mut self, slot: u64) {
        let pane = self.session.files.state().and_then(|state| {
            state
                .layout
                .root
                .panes()
                .into_iter()
                .find(|(_, key)| {
                    key.and_then(|key| self.session.files.slot_for_key(key)) == Some(slot)
                })
                .map(|(pane, _)| pane.to_owned())
        });
        if let Some(pane) = pane {
            self.session.files.focus(&pane);
        }
    }
    pub(super) fn editor_tabs(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(state) = self.session.files.state() else {
            return div().into_any_element();
        };
        let palette = cx.palette();
        let mut tabs = div()
            .id("editor-tabs")
            .flex()
            .items_center()
            .h_full()
            .min_w_0()
            .overflow_x_scroll();
        let ids: Vec<_> = state.catalog.editors.iter().map(|e| e.id.clone()).collect();
        for (index, input) in state.catalog.editors.iter().enumerate() {
            let key = input.id.clone();
            let active = state.layout.active_editor() == Some(key.as_str());
            let slot = self.session.files.slot_for_key(&key).unwrap();
            let status = self.session.files.slot(slot);
            let dirty = status.is_some_and(|f| f.dirty);
            let saving = status.is_some_and(|f| f.saving() || f.busy());
            let focus = self.editor.tab_focus.get(&slot).cloned();
            let error = status.is_some_and(|f| f.error.is_some());
            let close = crate::localization::tf(
                "shell.editorTabs.close",
                &[("name", input.label.clone().into())],
            );
            let select = key.clone();
            let target = key.clone();
            let keyboard_ids = ids.clone();
            let tab = div()
                .id(SharedString::from(format!("editor-tab-{slot}")))
                .flex()
                .items_center()
                .group("editor-tab")
                .min_w(px(76.))
                .max_w(px(220.))
                .flex_grow(1.)
                .flex_shrink(1.)
                .flex_basis(px(168.))
                .h_full()
                .overflow_hidden()
                .border_l_1()
                .when(index + 1 == ids.len(), |d| d.border_r_1())
                .border_color(palette.shell_divider)
                .text_color(if active { palette.text } else { palette.muted })
                .bg(if active {
                    palette.canvas
                } else {
                    Rgba::default()
                })
                .hover(move |s| s.bg(palette.hover).text_color(palette.text))
                .on_mouse_down(
                    MouseButton::Middle,
                    cx.listener(move |s, _, w, cx| {
                        s.session.files.close_slot(slot, &s.session.wake);
                        s.receive(w, cx);
                        cx.notify();
                    }),
                )
                .on_drag(
                    TabDrag {
                        owner: cx.entity_id(),
                        key: key.clone(),
                        label: input.label.clone(),
                    },
                    |drag, _, _, cx| cx.new(|_| drag.clone()),
                )
                .on_drop(cx.listener(move |s, drag: &TabDrag, _, cx| {
                    if drag.owner != cx.entity_id() {
                        return;
                    }
                    if let Some(mut state) = s.session.files.state_mut() {
                        state.catalog.move_before(&drag.key, &target);
                    }
                    cx.notify();
                }))
                .child(
                    div()
                        .id(SharedString::from(format!("editor-tab-select-{slot}")))
                        .when_some(focus, |d, focus| d.track_focus(&focus).tab_stop(active))
                        .flex()
                        .items_center()
                        .flex_1()
                        .min_w_0()
                        .gap(px(7.))
                        .pl(px(10.))
                        .pr(px(4.))
                        .h_full()
                        .cursor(theme::clickable_cursor())
                        .text_size(px(theme::ty().header.content))
                        .on_click(cx.listener(move |s, _, w, cx| {
                            s.session.files.activate(&select);
                            s.sync_editor(w, cx);
                            cx.notify();
                        }))
                        .on_key_down(cx.listener(move |s, e: &KeyDownEvent, w, cx| {
                            let next = match e.keystroke.key.as_str() {
                                "left" => (index + keyboard_ids.len() - 1) % keyboard_ids.len(),
                                "right" => (index + 1) % keyboard_ids.len(),
                                "home" => 0,
                                "end" => keyboard_ids.len() - 1,
                                _ => return,
                            };
                            s.session.files.activate(&keyboard_ids[next]);
                            s.sync_editor(w, cx);
                            if let Some(focus) =
                                s.editor.tab_focus.get(&s.session.files.active_slot())
                            {
                                focus.focus(w, cx);
                            }
                            cx.stop_propagation();
                            cx.notify();
                        }))
                        .child(
                            crate::ui::components::FileIcon::file(
                                input.label.clone(),
                                self.preferences.read(cx).state.file_icon_theme.clone(),
                            )
                            .size_px(15.),
                        )
                        .child(
                            div()
                                .min_w_0()
                                .text_ellipsis()
                                .whitespace_nowrap()
                                .child(input.label.clone()),
                        ),
                )
                .child(
                    div()
                        .size(px(24.))
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when(active, |d| d.hidden())
                        .group_hover("editor-tab", |s| s.hidden())
                        .when(saving, |d| {
                            d.child(crate::ui::components::Spinner::new(
                                SharedString::from(format!("tab-saving-{slot}")),
                                palette.divider,
                                palette.muted,
                            ))
                        })
                        .when(error && !saving, |d| {
                            d.child(Icon::new("circle-alert").small().color(palette.danger))
                        })
                        .when(dirty && !error && !saving, |d| {
                            d.child(div().size(px(6.)).rounded_full().bg(palette.muted))
                        }),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("editor-tab-close-{slot}")))
                        .size(px(24.))
                        .flex_shrink_0()
                        .mr(px(3.))
                        .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                        .flex()
                        .when(!active, |d| d.hidden())
                        .group_hover("editor-tab", |s| s.flex())
                        .items_center()
                        .justify_center()
                        .cursor(theme::clickable_cursor())
                        .tooltip(tooltip(close))
                        .on_click(cx.listener(move |s, _, w, cx| {
                            cx.stop_propagation();
                            s.session.files.close_slot(slot, &s.session.wake);
                            s.receive(w, cx);
                            cx.notify();
                        }))
                        .child(Icon::new("x").small()),
                );
            tabs = tabs.child(tab);
        }
        tabs.into_any_element()
    }
    pub(super) fn editor_node(
        &self,
        node: &Node,
        rect: Rect,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match node {
            Node::Pane { id, editor } => {
                let pane = id.clone();
                let target = id.clone();
                let file_target = id.clone();
                let external_target = id.clone();
                let preview_target = id.clone();
                let external_preview = id.clone();
                let mut view = at(rect)
                    .id(SharedString::from(id.clone()))
                    .overflow_hidden()
                    .capture_any_mouse_down(cx.listener(move |s, _, window, cx| {
                        s.session.files.focus(&pane);
                        s.sync_editor(window, cx);
                        cx.notify();
                    }))
                    .on_drag_move(cx.listener(
                        move |s, event: &DragMoveEvent<explorer::DragNodes>, _, cx| {
                            let drag = event.drag(cx);
                            let inside = event.bounds.contains(&event.event.position)
                                && drag.single_file
                                && drag.belongs_to(&s.session.files.workspace)
                                && !s.modal();
                            if inside {
                                let point = event.event.position - event.bounds.origin;
                                let (direction, placement) =
                                    crate::editor::workbench::layout::drop_edge(
                                        f32::from(point.x),
                                        f32::from(point.y),
                                        f32::from(event.bounds.size.width),
                                        f32::from(event.bounds.size.height),
                                    );
                                let preview = Some(EditorDrop {
                                    pane: preview_target.clone(),
                                    direction,
                                    placement,
                                });
                                if s.editor.drop != preview {
                                    s.editor.drop = preview;
                                    cx.notify();
                                }
                            } else if s
                                .editor
                                .drop
                                .as_ref()
                                .is_some_and(|p| p.pane == preview_target)
                            {
                                s.editor.drop = None;
                                cx.notify();
                            }
                        },
                    ))
                    .on_drag_move(cx.listener(
                        move |s, event: &DragMoveEvent<ExternalPaths>, _, cx| {
                            let inside = event.bounds.contains(&event.event.position)
                                && !s.modal()
                                && s.external_document(event.drag(cx), cx).is_some();
                            let preview = inside.then(|| {
                                let point = event.event.position - event.bounds.origin;
                                let (direction, placement) =
                                    crate::editor::workbench::layout::drop_edge(
                                        f32::from(point.x),
                                        f32::from(point.y),
                                        f32::from(event.bounds.size.width),
                                        f32::from(event.bounds.size.height),
                                    );
                                EditorDrop {
                                    pane: external_preview.clone(),
                                    direction,
                                    placement,
                                }
                            });
                            let ours = s
                                .editor
                                .drop
                                .as_ref()
                                .is_some_and(|p| p.pane == external_preview);
                            if preview.is_some() && s.editor.drop != preview
                                || preview.is_none() && ours
                            {
                                s.editor.drop = preview;
                                cx.notify();
                            }
                        },
                    ))
                    .on_drop(cx.listener(move |s, paths: &ExternalPaths, w, cx| {
                        // `claimEditorDropDocument`: one file of this local
                        // workspace opens; anything else is not admitted.
                        s.editor.drop = None;
                        let Some(path) = s.external_document(paths, cx).filter(|_| !s.modal())
                        else {
                            return;
                        };
                        let p = w.mouse_position();
                        let (direction, placement) = crate::editor::workbench::layout::drop_edge(
                            f32::from(p.x) - s.layout.editor.x - rect.x,
                            f32::from(p.y) - s.layout.editor.y - rect.y,
                            rect.w,
                            rect.h,
                        );
                        s.session.files.open_at_edge(
                            path,
                            &external_target,
                            direction,
                            placement,
                            &s.session.wake,
                        );
                        s.receive(w, cx);
                        cx.stop_propagation();
                        cx.notify();
                    }))
                    .on_drop(cx.listener(move |s, drag: &explorer::DragNodes, w, cx| {
                        s.editor.drop = None;
                        if !drag.single_file
                            || !drag.belongs_to(&s.session.files.workspace)
                            || s.modal()
                        {
                            return;
                        }
                        let Some(path) = drag.paths.first() else {
                            return;
                        };
                        let p = w.mouse_position();
                        let (direction, placement) = crate::editor::workbench::layout::drop_edge(
                            f32::from(p.x) - s.layout.editor.x - rect.x,
                            f32::from(p.y) - s.layout.editor.y - rect.y,
                            rect.w,
                            rect.h,
                        );
                        s.session.files.open_at_edge(
                            path.clone(),
                            &file_target,
                            direction,
                            placement,
                            &s.session.wake,
                        );
                        s.receive(w, cx);
                        cx.stop_propagation();
                        cx.notify();
                    }))
                    .on_drop(cx.listener(
                        move |s, drag: &crate::editor::workbench::pane::PaneDrag, w, cx| {
                            if drag.owner != cx.entity_id()
                                || !s.session.files.visible_slots().contains(&drag.slot)
                                || s.modal()
                            {
                                return;
                            }
                            let source = s.session.files.state().and_then(|state| {
                                state
                                    .layout
                                    .root
                                    .panes()
                                    .into_iter()
                                    .find(|(_, key)| {
                                        key.and_then(|key| s.session.files.slot_for_key(key))
                                            == Some(drag.slot)
                                    })
                                    .map(|(pane, _)| pane.to_owned())
                            });
                            let Some(source) = source else {
                                return;
                            };
                            let p = w.mouse_position();
                            let x = f32::from(p.x) - s.layout.editor.x - rect.x;
                            let y = f32::from(p.y) - s.layout.editor.y - rect.y;
                            let (direction, placement) =
                                crate::editor::workbench::layout::drop_edge(x, y, rect.w, rect.h);
                            if let Some(mut state) = s.session.files.state_mut() {
                                state
                                    .layout
                                    .move_pane(&source, &target, direction, placement);
                                state.focus(&source);
                            }
                            s.sync_editor(w, cx);
                            cx.notify();
                        },
                    ));
                let slot = editor
                    .as_deref()
                    .and_then(|key| self.session.files.slot_for_key(key));
                if let Some(editor) = slot.and_then(|slot| self.editor.hosts.get(&slot)) {
                    view = view.child(editor.clone());
                    if let Some(chip) = slot.and_then(|slot| self.save_chip(slot, cx)) {
                        view = view.child(chip);
                    }
                    if let Some(presence) = slot.and_then(|slot| self.file_presence(slot, cx)) {
                        view = view.child(presence);
                    }
                } else {
                    let close = id.clone();
                    view = view.child(
                        div().absolute().top(px(4.)).right(px(4.)).child(
                            IconButton::new(SharedString::from(format!("close-empty-{id}")), "x")
                                .label(crate::localization::t("editor.panes.closePane"))
                                .on_click(cx.listener(move |s, _, w, cx| {
                                    if let Some(mut state) = s.session.files.state_mut() {
                                        state.close_pane(&close);
                                    }
                                    s.sync_editor(w, cx);
                                    cx.notify();
                                })),
                        ),
                    );
                }
                if cx.has_active_drag()
                    && let Some(drop) = self.editor.drop.as_ref().filter(|d| d.pane == *id)
                {
                    let horizontal = drop.direction == Direction::Horizontal;
                    let first = drop.placement == Placement::First;
                    let preview = if horizontal {
                        Rect::new(
                            if first { 0. } else { rect.w / 2. },
                            0.,
                            rect.w / 2.,
                            rect.h,
                        )
                    } else {
                        Rect::new(
                            0.,
                            if first { 0. } else { rect.h / 2. },
                            rect.w,
                            rect.h / 2.,
                        )
                    };
                    let t = cx.palette();
                    view = view.child(
                        at(preview)
                            .bg(theme::alpha(t.accent, 0.12))
                            .border_1()
                            .border_color(t.accent),
                    );
                }
                view.into_any_element()
            }
            Node::Split {
                id,
                direction,
                ratio,
                first,
                second,
            } => {
                let horizontal = *direction == Direction::Horizontal;
                let size = if horizontal { rect.w } else { rect.h };
                let edge = size * *ratio as f32;
                let (a, b, lane) = if horizontal {
                    (
                        Rect::new(rect.x, rect.y, edge, rect.h),
                        Rect::new(rect.x + edge, rect.y, rect.w - edge, rect.h),
                        Rect::new(rect.x + edge - 3., rect.y, 6., rect.h),
                    )
                } else {
                    (
                        Rect::new(rect.x, rect.y, rect.w, edge),
                        Rect::new(rect.x, rect.y + edge, rect.w, rect.h - edge),
                        Rect::new(rect.x, rect.y + edge - 3., rect.w, 6.),
                    )
                };
                let split = id.clone();
                let direction = *direction;
                let original = *ratio;
                let global = Rect::new(
                    rect.x + self.layout.editor.x,
                    rect.y + self.layout.editor.y,
                    rect.w,
                    rect.h,
                );
                let handle = ResizeHandle::new(
                    SharedString::from(format!("editor-resize-{id}")),
                    if horizontal {
                        Axis::Horizontal
                    } else {
                        Axis::Vertical
                    },
                )
                .absolute()
                .left(px(lane.x))
                .top(px(lane.y))
                .w(px(lane.w))
                .h(px(lane.h))
                .stroke_at(3.)
                .rest(cx.palette().divider)
                .resizing(self.editor.resize.as_ref().is_some_and(|r| r.split == *id))
                .on_drag_start(cx.listener(move |s, _, _, cx| {
                    s.end_editor_resize(false, cx);
                    let Some(workspace) = s.session.files.workspace_key().map(str::to_owned) else {
                        return;
                    };
                    s.session.files.metadata_suspended = true;
                    s.editor.resize = Some(EditorResize {
                        workspace,
                        split: split.clone(),
                        rect: global,
                        direction,
                        original,
                    });
                    cx.stop_propagation();
                    cx.notify();
                }));
                div()
                    .size_full()
                    .child(self.editor_node(first, a, cx))
                    .child(self.editor_node(second, b, cx))
                    .child(handle)
                    .into_any_element()
            }
        }
    }
    pub(super) fn move_editor_resize(&mut self, point: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(resize) = &self.editor.resize else {
            return;
        };
        if self.session.files.workspace_key() != Some(resize.workspace.as_str()) {
            self.end_editor_resize(false, cx);
            return;
        }
        let position = if resize.direction == Direction::Horizontal {
            (f32::from(point.x) - resize.rect.x) / resize.rect.w.max(1.)
        } else {
            (f32::from(point.y) - resize.rect.y) / resize.rect.h.max(1.)
        };
        let split = resize.split.clone();
        if let Some(mut state) = self.session.files.state_mut() {
            state.layout.resize(&split, position.into());
        }
        cx.notify();
    }
    pub(super) fn end_editor_resize(&mut self, commit: bool, cx: &mut Context<Self>) {
        if let Some(resize) = self.editor.resize.take() {
            if !commit || self.session.files.workspace_key() != Some(resize.workspace.as_str()) {
                self.session
                    .files
                    .cancel_resize(&resize.workspace, &resize.split, resize.original);
            }
            self.session.files.metadata_suspended = false;
            self.session.wake.notify();
            cx.notify();
        }
    }
}

//! The editor workbench's panes, tabs and splits as the editor area paints
//! them. No file reads or saves here: the runtime does those.
//!
//! The panes are laid out in fractions of the area (each split by its
//! ratio), so they need no measure of their own; what the pointer does over
//! them is read against the bounds each pane and split was painted at.
use super::{
    editor_area::{EditorArea, EditorEvent},
    explorer,
};
use crate::{
    editor::workbench::layout::{Direction, Node, Placement},
    geometry::Rect,
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Icon, IconButton, ResizeHandle, tooltip},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{base::h_flex, component::Sizable as _};
use std::path::PathBuf;

pub(super) struct EditorResize {
    pub workspace: String,
    pub split: String,
    /// Where the split was painted when the drag began.
    pub bounds: Bounds<Pixels>,
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
/// `rect`, a fraction of the area, as an absolute frame in it.
fn fraction(rect: Rect) -> Div {
    div()
        .absolute()
        .left(relative(rect.x))
        .top(relative(rect.y))
        .w(relative(rect.w))
        .h(relative(rect.h))
}
/// Which edge of `bounds` the pointer at `position` drops on.
fn drop_edge(position: Point<Pixels>, bounds: Bounds<Pixels>) -> (Direction, Placement) {
    let point = position - bounds.origin;
    crate::editor::workbench::layout::drop_edge(
        f32::from(point.x),
        f32::from(point.y),
        f32::from(bounds.size.width),
        f32::from(bounds.size.height),
    )
}

impl EditorArea {
    /// A handler for a part drawn from a read (the Header's tabs, a file
    /// window's save chip).
    pub(super) fn listener<E: ?Sized>(
        &self,
        f: impl Fn(&mut Self, &E, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl Fn(&E, &mut Window, &mut App) + 'static {
        crate::ui::listener(&self.weak, f)
    }
    /// A Finder drop that names one file of this window's local workspace,
    /// as a workspace path (folders and anything outside are not admitted).
    pub(super) fn external_document(&self, paths: &ExternalPaths, cx: &App) -> Option<PathBuf> {
        let [path] = paths.paths() else {
            return None;
        };
        let root = self
            .docs
            .read(cx)
            .workspace
            .as_ref()
            .and_then(|ws| ws.local_root().map(PathBuf::from))?;
        let relative = path.strip_prefix(&root).ok()?;
        let normal = relative
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)));
        (normal && !relative.as_os_str().is_empty() && !self.explorer.read(cx).is_folder(relative))
            .then(|| relative.to_path_buf())
    }
    /// A "Saved" status lapses on its own: the area draws again then.
    pub(super) fn schedule_saved_refresh(&mut self, cx: &mut Context<Self>) {
        use crate::documents::SaveStatus;
        if self.saved_refresh.is_some() {
            return;
        }
        let docs = self.docs.read(cx);
        let saved = docs.retained_slots().into_iter().any(|slot| {
            docs.slot(slot)
                .is_some_and(|f| f.save_status() == SaveStatus::Saved)
        });
        if saved {
            self.saved_refresh = Some(cx.spawn(async move |this, cx| {
                cx.background_executor()
                    .timer(crate::documents::SAVED_STATUS_DURATION)
                    .await;
                let _ = this.update(cx, |s, cx| {
                    s.saved_refresh = None;
                    cx.notify();
                });
            }));
        }
    }
    /// `.editor-save-overlay` / `EditorSaveButton`: a failed save offers
    /// Retry everywhere; hosted documents also show Saving… and Saved
    /// (`showSaveStatus`). Clean documents show nothing.
    pub(super) fn save_chip(&self, slot: u64, cx: &App) -> Option<AnyElement> {
        use crate::documents::SaveStatus;
        let files = self.docs.read(cx).slot(slot)?;
        let hosted = files
            .workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root().is_none());
        let show_status = hosted;
        let status = files.save_status();
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
        let (key, body) = match status {
            SaveStatus::Failed => (
                "failed",
                chip("editor-save-failed")
                    .bg(theme::alpha(t.danger, 0.16))
                    .text_color(t.danger)
                    .hover(|d| d.bg(theme::alpha(t.danger, 0.24)))
                    .child(glyph("editor-save-alert", t.danger))
                    .child(crate::localization::t("editor.save.failed"))
                    .on_click(self.listener(move |s, _, _, cx| {
                        s.docs.update(cx, |d, _| d.retry_slot_save(slot));
                        cx.notify();
                    }))
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
        let files = self.docs.read(cx).slot(slot)?;
        let root = files.workspace.as_ref()?.local_root()?;
        let relative = match (&files.document, &files.resource) {
            (Some(document), _) => document.relative.as_path(),
            (None, Some(resource)) => resource.relative.as_path(),
            (None, None) => return None,
        };
        let store = crate::features::agent_presence::store(cx)?;
        let projection = store.read(cx).projection(&self.owner, root, relative)?;
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
    /// The pane showing `slot` takes the focus.
    pub(super) fn focus_slot(&mut self, slot: u64, cx: &mut Context<Self>) {
        self.docs.update(cx, |d, _| {
            let pane = d.state().and_then(|state| {
                state
                    .layout
                    .root
                    .panes()
                    .into_iter()
                    .find(|(_, key)| key.and_then(|key| d.slot_for_key(key)) == Some(slot))
                    .map(|(pane, _)| pane.to_owned())
            });
            if let Some(pane) = pane {
                d.focus(&pane);
            }
        });
    }
    /// `enableEditorTabsInHeader`: the editor's tabs, drawn into the
    /// Header from a read.
    pub(super) fn tabs(&self, cx: &App) -> AnyElement {
        let docs = self.docs.read(cx);
        let Some(state) = docs.state() else {
            return div().into_any_element();
        };
        let owner = self.weak.entity_id();
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
            let slot = docs.slot_for_key(&key).unwrap();
            let status = docs.slot(slot);
            let dirty = status.is_some_and(|f| f.dirty);
            let saving = status.is_some_and(|f| f.saving() || f.busy());
            let focus = self.tab_focus.get(&slot).cloned();
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
                    self.listener(move |s, _, _, cx| {
                        s.docs.update(cx, |d, _| d.close_slot(slot));
                        cx.emit(EditorEvent::Pump);
                        cx.notify();
                    }),
                )
                .on_drag(
                    TabDrag {
                        owner,
                        key: key.clone(),
                        label: input.label.clone(),
                    },
                    |drag, _, _, cx| cx.new(|_| drag.clone()),
                )
                .on_drop(self.listener(move |s, drag: &TabDrag, _, cx| {
                    if drag.owner != cx.entity_id() {
                        return;
                    }
                    s.docs.update(cx, |d, _| {
                        if let Some(mut state) = d.state_mut() {
                            state.catalog.move_before(&drag.key, &target);
                        }
                    });
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
                        .on_click(self.listener(move |s, _, w, cx| {
                            s.docs.update(cx, |d, _| d.activate(&select));
                            s.sync(w, cx);
                        }))
                        .on_key_down(self.listener(move |s, e: &KeyDownEvent, w, cx| {
                            let next = match e.keystroke.key.as_str() {
                                "left" => (index + keyboard_ids.len() - 1) % keyboard_ids.len(),
                                "right" => (index + 1) % keyboard_ids.len(),
                                "home" => 0,
                                "end" => keyboard_ids.len() - 1,
                                _ => return,
                            };
                            s.docs.update(cx, |d, _| d.activate(&keyboard_ids[next]));
                            s.sync(w, cx);
                            let active = s.docs.read(cx).active_slot();
                            if let Some(focus) = s.tab_focus.get(&active) {
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
                        .on_click(self.listener(move |s, _, _, cx| {
                            cx.stop_propagation();
                            s.docs.update(cx, |d, _| d.close_slot(slot));
                            cx.emit(EditorEvent::Pump);
                            cx.notify();
                        }))
                        .child(Icon::new("x").small()),
                );
            tabs = tabs.child(tab);
        }
        tabs.into_any_element()
    }
    /// One node of the workbench layout at `rect`, a fraction of the area.
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
                let measured = self.pane_bounds.clone();
                let painted = id.clone();
                let mut view = fraction(rect)
                    .id(SharedString::from(id.clone()))
                    .overflow_hidden()
                    .child(
                        gpui::canvas(
                            move |b, _, _| {
                                measured.borrow_mut().insert(painted.clone(), b);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .capture_any_mouse_down(cx.listener(move |s, _, window, cx| {
                        s.docs.update(cx, |d, _| d.focus(&pane));
                        s.sync(window, cx);
                    }))
                    .on_drag_move(cx.listener(
                        move |s, event: &DragMoveEvent<explorer::DragNodes>, _, cx| {
                            let drag = event.drag(cx);
                            let inside = event.bounds.contains(&event.event.position)
                                && drag.single_file
                                && drag.belongs_to(&s.docs.read(cx).workspace)
                                && !s.gate.modal;
                            if inside {
                                let (direction, placement) =
                                    drop_edge(event.event.position, event.bounds);
                                let preview = Some(EditorDrop {
                                    pane: preview_target.clone(),
                                    direction,
                                    placement,
                                });
                                if s.drop != preview {
                                    s.drop = preview;
                                    cx.notify();
                                }
                            } else if s.drop.as_ref().is_some_and(|p| p.pane == preview_target) {
                                s.drop = None;
                                cx.notify();
                            }
                        },
                    ))
                    .on_drag_move(cx.listener(
                        move |s, event: &DragMoveEvent<ExternalPaths>, _, cx| {
                            let inside = event.bounds.contains(&event.event.position)
                                && !s.gate.modal
                                && s.external_document(event.drag(cx), cx).is_some();
                            let preview = inside.then(|| {
                                let (direction, placement) =
                                    drop_edge(event.event.position, event.bounds);
                                EditorDrop {
                                    pane: external_preview.clone(),
                                    direction,
                                    placement,
                                }
                            });
                            let ours = s.drop.as_ref().is_some_and(|p| p.pane == external_preview);
                            if preview.is_some() && s.drop != preview || preview.is_none() && ours {
                                s.drop = preview;
                                cx.notify();
                            }
                        },
                    ))
                    .on_drop(cx.listener(move |s, paths: &ExternalPaths, w, cx| {
                        // `claimEditorDropDocument`: one file of this local
                        // workspace opens; anything else is not admitted.
                        s.drop = None;
                        let Some(path) = s.external_document(paths, cx).filter(|_| !s.gate.modal)
                        else {
                            return;
                        };
                        let Some(bounds) = s.pane_bounds.borrow().get(&external_target).copied()
                        else {
                            return;
                        };
                        let (direction, placement) = drop_edge(w.mouse_position(), bounds);
                        let target = external_target.clone();
                        s.docs.update(cx, |d, _| {
                            d.open_at_edge(path, &target, direction, placement)
                        });
                        cx.emit(EditorEvent::Pump);
                        cx.stop_propagation();
                        cx.notify();
                    }))
                    .on_drop(cx.listener(move |s, drag: &explorer::DragNodes, w, cx| {
                        s.drop = None;
                        if !drag.single_file
                            || !drag.belongs_to(&s.docs.read(cx).workspace)
                            || s.gate.modal
                        {
                            return;
                        }
                        let Some(path) = drag.paths.first().cloned() else {
                            return;
                        };
                        let Some(bounds) = s.pane_bounds.borrow().get(&file_target).copied() else {
                            return;
                        };
                        let (direction, placement) = drop_edge(w.mouse_position(), bounds);
                        let target = file_target.clone();
                        s.docs.update(cx, |d, _| {
                            d.open_at_edge(path, &target, direction, placement)
                        });
                        cx.emit(EditorEvent::Pump);
                        cx.stop_propagation();
                        cx.notify();
                    }))
                    .on_drop(cx.listener(
                        move |s, drag: &crate::editor::workbench::pane::PaneDrag, w, cx| {
                            if drag.owner != cx.entity_id()
                                || !s.docs.read(cx).visible_slots().contains(&drag.slot)
                                || s.gate.modal
                            {
                                return;
                            }
                            let Some(bounds) = s.pane_bounds.borrow().get(&target).copied() else {
                                return;
                            };
                            let (direction, placement) = drop_edge(w.mouse_position(), bounds);
                            let (slot, target) = (drag.slot, target.clone());
                            s.docs.update(cx, |d, _| {
                                let source = d.state().and_then(|state| {
                                    state
                                        .layout
                                        .root
                                        .panes()
                                        .into_iter()
                                        .find(|(_, key)| {
                                            key.and_then(|key| d.slot_for_key(key)) == Some(slot)
                                        })
                                        .map(|(pane, _)| pane.to_owned())
                                });
                                if let Some(source) = source
                                    && let Some(mut state) = d.state_mut()
                                {
                                    state
                                        .layout
                                        .move_pane(&source, &target, direction, placement);
                                    state.focus(&source);
                                }
                            });
                            s.sync(w, cx);
                        },
                    ));
                let slot = editor
                    .as_deref()
                    .and_then(|key| self.docs.read(cx).slot_for_key(key));
                if let Some(editor) = slot.and_then(|slot| self.hosts.get(&slot)) {
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
                                    s.docs.update(cx, |d, _| {
                                        if let Some(mut state) = d.state_mut() {
                                            state.close_pane(&close);
                                        }
                                    });
                                    s.sync(w, cx);
                                })),
                        ),
                    );
                }
                if cx.has_active_drag()
                    && let Some(drop) = self.drop.as_ref().filter(|d| d.pane == *id)
                {
                    let horizontal = drop.direction == Direction::Horizontal;
                    let first = drop.placement == Placement::First;
                    let preview = if horizontal {
                        Rect::new(if first { 0. } else { 0.5 }, 0., 0.5, 1.)
                    } else {
                        Rect::new(0., if first { 0. } else { 0.5 }, 1., 0.5)
                    };
                    let t = cx.palette();
                    view = view.child(
                        fraction(preview)
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
                let edge = *ratio as f32;
                let (a, b) = if horizontal {
                    (
                        Rect::new(rect.x, rect.y, rect.w * edge, rect.h),
                        Rect::new(rect.x + rect.w * edge, rect.y, rect.w * (1. - edge), rect.h),
                    )
                } else {
                    (
                        Rect::new(rect.x, rect.y, rect.w, rect.h * edge),
                        Rect::new(rect.x, rect.y + rect.h * edge, rect.w, rect.h * (1. - edge)),
                    )
                };
                let split = id.clone();
                let direction = *direction;
                let original = *ratio;
                // The 6px lane straddles the split's edge.
                let lane = if horizontal {
                    div()
                        .absolute()
                        .left(relative(rect.x + rect.w * edge))
                        .top(relative(rect.y))
                        .h(relative(rect.h))
                        .w(px(6.))
                        .ml(px(-3.))
                } else {
                    div()
                        .absolute()
                        .top(relative(rect.y + rect.h * edge))
                        .left(relative(rect.x))
                        .w(relative(rect.w))
                        .h(px(6.))
                        .mt(px(-3.))
                };
                let handle = ResizeHandle::new(
                    SharedString::from(format!("editor-resize-{id}")),
                    if horizontal {
                        Axis::Horizontal
                    } else {
                        Axis::Vertical
                    },
                )
                .size_full()
                .stroke_at(3.)
                .rest(cx.palette().divider)
                .resizing(self.resize.as_ref().is_some_and(|r| r.split == *id))
                .on_drag_start(cx.listener(move |s, _, _, cx| {
                    s.end_resize(false, cx);
                    let Some(workspace) = s.docs.read(cx).workspace_key().map(str::to_owned) else {
                        return;
                    };
                    let Some(bounds) = s.split_bounds.borrow().get(&split).copied() else {
                        return;
                    };
                    s.docs.update(cx, |d, _| d.metadata_suspended = true);
                    s.resize = Some(EditorResize {
                        workspace,
                        split: split.clone(),
                        bounds,
                        direction,
                        original,
                    });
                    cx.stop_propagation();
                    cx.notify();
                }));
                let measured = self.split_bounds.clone();
                let painted = id.clone();
                div()
                    .absolute()
                    .size_full()
                    .child(
                        fraction(rect).child(
                            gpui::canvas(
                                move |b, _, _| {
                                    measured.borrow_mut().insert(painted.clone(), b);
                                },
                                |_, _, _, _| {},
                            )
                            .size_full(),
                        ),
                    )
                    .child(self.editor_node(first, a, cx))
                    .child(self.editor_node(second, b, cx))
                    .child(lane.child(handle))
                    .into_any_element()
            }
        }
    }
    pub(super) fn move_resize(&mut self, point: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(resize) = &self.resize else {
            return;
        };
        if self.docs.read(cx).workspace_key() != Some(resize.workspace.as_str()) {
            self.end_resize(false, cx);
            return;
        }
        let bounds = resize.bounds;
        let position = if resize.direction == Direction::Horizontal {
            f32::from(point.x - bounds.origin.x) / f32::from(bounds.size.width).max(1.)
        } else {
            f32::from(point.y - bounds.origin.y) / f32::from(bounds.size.height).max(1.)
        };
        let split = resize.split.clone();
        self.docs.update(cx, |d, _| {
            if let Some(mut state) = d.state_mut() {
                state.layout.resize(&split, position.into());
            }
        });
        cx.notify();
    }
    pub(super) fn end_resize(&mut self, commit: bool, cx: &mut Context<Self>) {
        if let Some(resize) = self.resize.take() {
            self.docs.update(cx, |d, _| {
                if !commit || d.workspace_key() != Some(resize.workspace.as_str()) {
                    d.cancel_resize(&resize.workspace, &resize.split, resize.original);
                }
                d.metadata_suspended = false;
                d.wake().notify();
            });
            cx.notify();
        }
    }
}

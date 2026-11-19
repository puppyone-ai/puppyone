//! The editor workbench's panes, tabs and splits as the editor area paints
//! them. No file reads or saves here: the runtime does those.
//!
//! The panes are laid out in fractions of the area (each split by its
//! ratio), so they need no measure of their own; what the pointer does over
//! them is read against the bounds each pane and split was painted at.
use super::{
    editor_area::{EditorArea, EditorEvent, PendingExternalDrop},
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
    pub(super) pane: String,
    pub(super) direction: Direction,
    pub(super) placement: Placement,
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
    /// A Finder drop that names one regular file outside this window's local
    /// workspace (`WB-21`), eligible for "Copy to Workspace" or "Open in File Window".
    pub(super) fn external_outside_file(&self, paths: &ExternalPaths, cx: &App) -> Option<PathBuf> {
        if self.file_mode {
            return None;
        }
        let [path] = paths.paths() else {
            return None;
        };
        let root = self
            .docs
            .read(cx)
            .workspace
            .as_ref()
            .and_then(|ws| ws.local_root().map(PathBuf::from))?;
        if path.strip_prefix(&root).is_ok() {
            return None;
        }
        path.is_file().then(|| path.clone())
    }
    /// Routes a Finder drop onto `target` pane edge (`WB-21`): in-workspace single
    /// files open directly; outside single regular files open the delivery prompt.
    pub(super) fn handle_external_paths_drop(
        &mut self,
        paths: &ExternalPaths,
        target: &str,
        direction: Direction,
        placement: Placement,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.gate.modal {
            return false;
        }
        if let Some(path) = self.external_document(paths, cx) {
            self.docs.update(cx, |d, _| {
                d.open_at_edge(path, target, direction, placement)
            });
            cx.emit(EditorEvent::Pump);
            cx.notify();
            return true;
        }
        if let Some(outside_path) = self.external_outside_file(paths, cx) {
            self.pending_external_drop = Some(PendingExternalDrop {
                path: outside_path,
                pane: target.to_owned(),
                direction,
                placement,
            });
            cx.notify();
            return true;
        }
        false
    }
    /// A "Saved" status lapses on its own: the area draws again then.
    pub(super) fn schedule_saved_refresh(&mut self, cx: &mut Context<Self>) {
        let docs = self.docs.read(cx);
        let expires = docs
            .retained_slots()
            .into_iter()
            .filter_map(|slot| docs.slot(slot).and_then(|f| f.save_status_expiry()))
            .min();
        if self.saved_refresh.as_ref().map(|(at, _)| *at) == expires {
            return;
        }
        // Dropping the previous task retires its deadline. After the earliest
        // confirmation expires, arrange the next retained document's repaint.
        self.saved_refresh = expires.map(|at| {
            let task = cx.spawn(async move |this, cx| {
                cx.background_executor()
                    .timer(at.saturating_duration_since(std::time::Instant::now()))
                    .await;
                let _ = this.update(cx, |s, cx| {
                    s.saved_refresh = None;
                    s.schedule_saved_refresh(cx);
                    cx.notify();
                });
            });
            (at, task)
        });
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
                .debug_selector(move || format!("{id}-{slot}"))
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
            let slot = docs.slot_for_key(&key);
            let status = slot.and_then(|id| docs.slot(id));
            let dirty = status.is_some_and(|f| f.dirty);
            let saving = status.is_some_and(|f| f.saving() || f.busy());
            let focus = slot.and_then(|id| self.tab_focus.get(&id).cloned());
            let error = status.is_some_and(|f| f.error.is_some());
            let tab_suffix = match slot {
                Some(id) => id.to_string(),
                None => format!("hib-{index}"),
            };
            let close = crate::localization::tf(
                "shell.editorTabs.close",
                &[("name", input.label.clone().into())],
            );
            let select = key.clone();
            let target = key.clone();
            let middle_close_key = key.clone();
            let button_close_key = key.clone();
            let keyboard_ids = ids.clone();
            let tab = div()
                .id(SharedString::from(format!("editor-tab-{tab_suffix}")))
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
                        s.docs.update(cx, |d, _| match slot {
                            Some(slot_id) => d.close_slot(slot_id),
                            None => {
                                let wake = d.wake().clone();
                                d.close_editor_key(&middle_close_key, &wake);
                            }
                        });
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
                        .id(SharedString::from(format!(
                            "editor-tab-select-{tab_suffix}"
                        )))
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
                            s.docs.update(cx, |d, _| {
                                let wake = d.wake().clone();
                                d.activate_with_wake(&select, &wake);
                            });
                            s.sync(w, cx);
                            cx.emit(EditorEvent::Pump);
                        }))
                        .on_key_down(self.listener(move |s, e: &KeyDownEvent, w, cx| {
                            let next = match e.keystroke.key.as_str() {
                                "left" => (index + keyboard_ids.len() - 1) % keyboard_ids.len(),
                                "right" => (index + 1) % keyboard_ids.len(),
                                "home" => 0,
                                "end" => keyboard_ids.len() - 1,
                                _ => return,
                            };
                            s.docs.update(cx, |d, _| {
                                let wake = d.wake().clone();
                                d.activate_with_wake(&keyboard_ids[next], &wake);
                            });
                            s.sync(w, cx);
                            cx.emit(EditorEvent::Pump);
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
                                SharedString::from(format!("tab-saving-{tab_suffix}")),
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
                        .id(SharedString::from(format!("editor-tab-close-{tab_suffix}")))
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
                            s.docs.update(cx, |d, _| match slot {
                                Some(slot_id) => d.close_slot(slot_id),
                                None => {
                                    let wake = d.wake().clone();
                                    d.close_editor_key(&button_close_key, &wake);
                                }
                            });
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
                let move_preview = id.clone();
                let shows = editor.clone();
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
                    // `pane move`: the edge a moved pane would land on, never
                    // its own.
                    .on_drag_move(cx.listener(
                        move |s,
                              event: &DragMoveEvent<crate::editor::workbench::pane::PaneDrag>,
                              _,
                              cx| {
                            let drag = event.drag(cx);
                            let docs = s.docs.read(cx);
                            let own = shows.as_deref().and_then(|key| docs.slot_for_key(key))
                                == Some(drag.slot);
                            let inside = event.bounds.contains(&event.event.position)
                                && drag.owner == cx.entity_id()
                                && docs.visible_slots().contains(&drag.slot)
                                && !own
                                && !s.gate.modal;
                            let preview = inside.then(|| {
                                let (direction, placement) =
                                    drop_edge(event.event.position, event.bounds);
                                EditorDrop {
                                    pane: move_preview.clone(),
                                    direction,
                                    placement,
                                }
                            });
                            let ours = s.drop.as_ref().is_some_and(|p| p.pane == move_preview);
                            if preview.is_some() && s.drop != preview || preview.is_none() && ours {
                                s.drop = preview;
                                cx.notify();
                            }
                        },
                    ))
                    .on_drag_move(cx.listener(
                        move |s, event: &DragMoveEvent<ExternalPaths>, _, cx| {
                            let drag = event.drag(cx);
                            let inside = event.bounds.contains(&event.event.position)
                                && !s.gate.modal
                                && (s.external_document(drag, cx).is_some()
                                    || s.external_outside_file(drag, cx).is_some());
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
                        // `claimEditorDropDocument` + `WB-21`: in-workspace files open
                        // directly; outside regular files prompt "Copy to Workspace" or
                        // "Open in File Window".
                        s.drop = None;
                        let Some(bounds) = s.pane_bounds.borrow().get(&external_target).copied()
                        else {
                            return;
                        };
                        let (direction, placement) = drop_edge(w.mouse_position(), bounds);
                        let target = external_target.clone();
                        if s.handle_external_paths_drop(paths, &target, direction, placement, cx) {
                            cx.stop_propagation();
                        }
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
                            s.drop = None;
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
                                    s.docs.update(cx, |d, _| d.close_pane(&close));
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
                let lane = lane.debug_selector({
                    let split = split.clone();
                    move || format!("editor-resize-{split}")
                });
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

    /// Read-only comparison modal (`DP-05` Exit 1: `Compare`) showing `ours` vs
    /// `theirs` unified diff rows and all resolution exits.
    pub(super) fn conflict_comparison_dialog(&self, cx: &App) -> Option<AnyElement> {
        use crate::{
            app::Command,
            documents::reconcile::{DiffRow, unified_diff_rows},
            localization::t as tr,
            ui::components::{Button, ButtonVariant, Dialog},
        };
        if !self.comparing_conflict {
            return None;
        }
        let docs = self.docs.read(cx);
        let conflict = docs.conflict_state()?;
        let path_label = docs
            .opened()
            .map(|(_, p)| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let rows = unified_diff_rows(conflict.ours.as_str(), conflict.theirs.as_str());
        let t = cx.palette();

        let close_area = self.weak.clone();
        let keep_area = self.weak.clone();
        let accept_area = self.weak.clone();
        let copy_area = self.weak.clone();

        let mut diff_list = div()
            .id("cloud-conflict-diff-view")
            .w_full()
            .max_h(px(320.))
            .overflow_y_scroll()
            .rounded(px(6.))
            .border_1()
            .border_color(t.divider)
            .bg(t.canvas)
            .py(px(4.));

        let mut line_counter = 0usize;
        for (idx, row) in rows.into_iter().take(240).enumerate() {
            let (prefix, bg, fg, text, show_line) = match row {
                DiffRow::Context(text) => {
                    line_counter += 1;
                    (" ", Rgba::default(), t.muted, text, Some(line_counter))
                }
                DiffRow::Ours(text) => ("-", theme::alpha(t.danger, 0.12), t.danger, text, None),
                DiffRow::Theirs(text) => {
                    line_counter += 1;
                    (
                        "+",
                        theme::alpha(t.success, 0.12),
                        t.success,
                        text,
                        Some(line_counter),
                    )
                }
            };
            let line_no = show_line
                .map(|n| format!("{n:>4}"))
                .unwrap_or_else(|| "    ".into());
            diff_list = diff_list.child(
                div()
                    .id(ElementId::NamedInteger(
                        "conflict-diff-row".into(),
                        idx as u64,
                    ))
                    .w_full()
                    .px(px(10.))
                    .py(px(1.))
                    .bg(bg)
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .font(crate::ui::fonts::font(
                        crate::typography::fonts::Role::Code,
                        cx,
                    ))
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(18.))
                    .child(
                        div()
                            .flex_none()
                            .text_color(t.muted)
                            .child(format!("{line_no} {prefix}")),
                    )
                    .child(div().min_w_0().flex_1().text_color(fg).child(text)),
            );
        }

        let legend = h_flex()
            .w_full()
            .justify_between()
            .gap(px(12.))
            .text_size(px(theme::ty().ui.meta))
            .child(
                div()
                    .text_color(t.danger)
                    .child(format!("− {}", tr("native.editor.conflictMineHeader"))),
            )
            .child(
                div()
                    .text_color(t.success)
                    .child(format!("+ {}", tr("native.editor.conflictRemoteHeader"))),
            );

        Some(
            Dialog::new("cloud-conflict-compare-dialog")
                .width(660.)
                .title(tr("native.editor.conflictTitle"))
                .on_close(move |_, cx| {
                    let _ = close_area.update(cx, |e, cx| e.close_conflict_comparison(cx));
                })
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.))
                        .when(!path_label.is_empty(), |d| {
                            d.child(
                                div()
                                    .text_size(px(theme::ty().ui.meta))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(path_label),
                            )
                        })
                        .child(
                            div()
                                .text_size(px(theme::ty().ui.meta))
                                .text_color(t.muted)
                                .child(tr("native.editor.conflictMessage")),
                        )
                        .child(legend)
                        .child(diff_list),
                )
                .footer(
                    Button::new("conflict-dialog-save-copy")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("native.editor.conflictSaveCopy"))
                        .on_click(move |_, _, cx| {
                            let _ = copy_area.update(cx, |_, cx| {
                                cx.emit(EditorEvent::Command(Command::SaveConflictCopy))
                            });
                        }),
                )
                .footer(
                    Button::new("conflict-dialog-accept-remote")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("native.editor.conflictAcceptRemote"))
                        .on_click(move |_, _, cx| {
                            let _ = accept_area.update(cx, |_, cx| {
                                cx.emit(EditorEvent::Command(Command::ReloadCloudBaseline))
                            });
                        }),
                )
                .footer(
                    Button::new("conflict-dialog-keep-mine")
                        .variant(ButtonVariant::Solid)
                        .label(tr("native.editor.conflictKeepMine"))
                        .on_click(move |_, _, cx| {
                            let _ = keep_area.update(cx, |_, cx| {
                                cx.emit(EditorEvent::Command(Command::KeepLocalCloudDraft))
                            });
                        }),
                )
                .into_any_element(),
        )
    }

    /// Delivery prompt for a single external Finder file dropped onto an editor
    /// pane from outside this window's local workspace (`WB-21`).
    pub(super) fn external_drop_dialog(&self, cx: &App) -> Option<AnyElement> {
        use crate::ui::components::{Button, ButtonVariant, Dialog};
        let pending = self.pending_external_drop.as_ref()?;
        let file_name = pending
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let t = cx.palette();

        let close_area = self.weak.clone();
        let cancel_area = self.weak.clone();
        let file_win_area = self.weak.clone();
        let copy_area = self.weak.clone();

        Some(
            Dialog::new("external-file-drop-dialog")
                .width(460.)
                .title("Open External File")
                .on_close(move |_, cx| {
                    let _ = close_area.update(cx, |e, cx| e.dismiss_external_drop(cx));
                })
                .child(
                    div()
                        .debug_selector(|| "external-file-drop-body".into())
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(theme::ty().ui.body))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.text)
                                .child(file_name),
                        )
                        .child(
                            div()
                                .text_size(px(theme::ty().ui.meta))
                                .text_color(t.muted)
                                .child(
                                    "This file is outside the current workspace. Choose how to open it:",
                                ),
                        ),
                )
                .footer(
                    Button::new("external-drop-cancel")
                        .variant(ButtonVariant::Ghost)
                        .label("Cancel")
                        .on_click(move |_, _, cx| {
                            let _ = cancel_area.update(cx, |e, cx| e.dismiss_external_drop(cx));
                        }),
                )
                .footer(
                    Button::new("external-drop-open-file-window")
                        .variant(ButtonVariant::Secondary)
                        .label("Open in File Window")
                        .on_click(move |_, _, cx| {
                            let _ = file_win_area.update(cx, |e, cx| {
                                e.confirm_external_drop_open_file_window(cx)
                            });
                        }),
                )
                .footer(
                    Button::new("external-drop-copy-workspace")
                        .variant(ButtonVariant::Solid)
                        .label("Copy to Workspace")
                        .on_click(move |_, w, cx| {
                            let _ = copy_area.update(cx, |e, cx| {
                                e.confirm_external_drop_copy_to_workspace(w, cx)
                            });
                        }),
                )
                .into_any_element(),
        )
    }
}

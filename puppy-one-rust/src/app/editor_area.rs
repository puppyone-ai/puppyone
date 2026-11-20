//! The editor area (`EditorWorkbench` as the window paints it): one editor
//! host per open document slot, the one in front, a split being resized, a
//! drop being previewed, each tab's focus, and the save notices.
//!
//! [`EditorArea`] is an entity over the window's [`DocumentSession`]: it
//! delivers the runtime's messages to the hosts and the hosts' answers back
//! ([`EditorArea::sync`]), and changes the workbench layout itself (tabs,
//! panes, splits, drops). What the window decides about it — a dialog over
//! it, the Homepage, the appearance — arrives as an [`EditorGate`]; pane
//! menu commands go back to the window ([`EditorEvent`]).
use super::{
    Command,
    editor_workbench::{EditorDrop, EditorResize},
    explorer::ExplorerSession,
    session::DocumentSession,
};
use crate::documents::ClientMessage;
use crate::documents::HostMessage;
use crate::editor::host::DocumentEditor;
use crate::features::settings::PreferencesStore;
use gpui::{prelude::*, *};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    rc::Rc,
};

/// Where each pane (or split) was painted, by its id.
pub(super) type Painted = Rc<RefCell<HashMap<String, Bounds<Pixels>>>>;

/// What the window holds over the editors.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct EditorGate {
    /// A dialog takes the window (or the Agent workbench has one open).
    pub modal: bool,
    /// The Homepage shows instead of the project.
    pub home: bool,
    pub dark: bool,
    /// The Sub Theme the editors' tokens follow (`tokens::theme_key`).
    pub theme: u64,
}

/// What the editor area asks of the window.
pub(super) enum EditorEvent {
    /// A pane menu command (open in the default app, close the file, …).
    Command(Command),
    /// User picked a handler from a pane's "Open with…" submenu.
    OpenWith {
        slot: u64,
        format_id: String,
        handler: crate::plugin_contract::HandlerId,
        always: bool,
    },
    /// The runtime was asked for something: the window pumps it now.
    Pump,
}

/// Pending external Finder file drop outside the active local workspace (`WB-21`).
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PendingExternalDrop {
    pub path: std::path::PathBuf,
    pub pane: String,
    pub direction: crate::editor::workbench::layout::Direction,
    pub placement: crate::editor::workbench::layout::Placement,
}

pub(super) struct EditorArea {
    pub(super) docs: Entity<DocumentSession>,
    pub(super) explorer: Entity<ExplorerSession>,
    pub(super) preferences: Entity<PreferencesStore>,
    /// The window's own focus: it keeps the keyboard while no document does.
    window_focus: FocusHandle,
    /// This window's presence owner (`ownerId`).
    pub(super) owner: String,
    pub(super) weak: WeakEntity<Self>,
    /// A file window: one document, no workspace around it.
    pub(super) file_mode: bool,
    pub(super) gate: EditorGate,
    /// The front document's host (the active slot's, once it has one).
    pub front: Entity<DocumentEditor>,
    /// Every slot's host, by slot id.
    pub hosts: BTreeMap<u64, Entity<DocumentEditor>>,
    /// A split being resized.
    pub resize: Option<EditorResize>,
    /// A drop being previewed over a pane.
    pub drop: Option<EditorDrop>,
    /// Each tab's own focus handle, by slot id.
    pub tab_focus: BTreeMap<u64, FocusHandle>,
    /// The save failure whose notice the person dismissed
    /// (`useDismissibleNotice`).
    pub dismissed_save_error: Option<String>,
    /// Whether the read-only Cloud conflict comparison dialog is open (`DP-05`).
    pub comparing_conflict: bool,
    /// Pending prompt for a Finder file dropped from outside this workspace (`WB-21`).
    pub pending_external_drop: Option<PendingExternalDrop>,
    /// Re-renders once a transient "Saved" status lapses.
    pub saved_refresh: Option<(std::time::Instant, Task<()>)>,
    /// Where each pane and split was painted, in window coordinates: what
    /// a drop or a split resize is measured against.
    pub(super) pane_bounds: Painted,
    pub(super) split_bounds: Painted,
}
impl EventEmitter<EditorEvent> for EditorArea {}

impl EditorArea {
    /// The editor whose pane menu is open, if any.
    pub fn open_pane_menu(&self, cx: &App) -> Option<Entity<DocumentEditor>> {
        self.hosts
            .values()
            .find(|editor| editor.read(cx).pane_menu_open())
            .cloned()
    }
    pub fn new(
        docs: Entity<DocumentSession>,
        explorer: Entity<ExplorerSession>,
        preferences: Entity<PreferencesStore>,
        window_focus: FocusHandle,
        owner: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let front = cx.new(DocumentEditor::new);
        // The front host before the workbench has panes: pane menu commands
        // are the window's, everything else the runtime's.
        cx.subscribe_in(&front, window, |s, _, event: &ClientMessage, window, cx| {
            if let ClientMessage::OpenWith {
                format_id,
                handler,
                always,
                ..
            } = event
            {
                if s.docs.read(cx).state().is_none() {
                    cx.emit(EditorEvent::OpenWith {
                        slot: 0,
                        format_id: format_id.clone(),
                        handler: handler.clone(),
                        always: *always,
                    });
                }
                return;
            }
            if let ClientMessage::Action { action } = event {
                if s.docs.read(cx).state().is_none()
                    && let Some(command) = Command::from_protocol(action)
                {
                    cx.emit(EditorEvent::Command(command));
                }
                return;
            }
            let normalized = matches!(event, ClientMessage::NormalizeLineEndings { .. });
            let event = event.clone();
            s.docs.update(cx, |d, _| d.client_for(0, event));
            if normalized {
                s.sync(window, cx);
                cx.emit(EditorEvent::Pump);
            }
            cx.notify();
        })
        .detach();
        // Escape rolls a drag or a split resize back wherever focus is (TS
        // listens on `window` in the capture phase): before any binding.
        let area = cx.weak_entity();
        let own = window.window_handle();
        cx.intercept_keystrokes(move |event, window, cx| {
            if window.window_handle() != own || event.keystroke.key != "escape" {
                return;
            }
            let _ = area.update(cx, |s, cx| {
                if s.drop.take().is_some() {
                    cx.stop_active_drag(window);
                    cx.stop_propagation();
                    cx.notify();
                }
                if s.resize.is_some() {
                    s.end_resize(false, cx);
                    cx.stop_propagation();
                }
            });
        })
        .detach();
        // The presence marks over the panes.
        if let Some(presence) = crate::features::agent_presence::store(cx) {
            cx.observe(&presence, |_, _, cx| cx.notify()).detach();
        }
        cx.observe(&preferences, |_, _, cx| cx.notify()).detach();
        let mut hosts = BTreeMap::new();
        hosts.insert(0, front.clone());
        Self {
            docs,
            explorer,
            preferences,
            window_focus,
            owner,
            weak: cx.weak_entity(),
            file_mode: false,
            gate: EditorGate::default(),
            front,
            hosts,
            resize: None,
            drop: None,
            tab_focus: Default::default(),
            dismissed_save_error: None,
            comparing_conflict: false,
            pending_external_drop: None,
            saved_refresh: None,
            pane_bounds: Default::default(),
            split_bounds: Default::default(),
        }
    }
    /// A file window's editors have no workspace around them.
    pub fn set_file_mode(&mut self, file_mode: bool) {
        self.file_mode = file_mode;
    }
    /// What the window holds over the editors changed.
    pub fn set_gate(&mut self, gate: EditorGate, window: &mut Window, cx: &mut Context<Self>) {
        if self.gate != gate {
            self.gate = gate;
            self.apply_gate(window, cx);
        }
    }
    /// The window left: a drag or a split resize in flight ends.
    pub fn cancel_gestures(&mut self, cx: &mut Context<Self>) {
        if self.drop.take().is_some() {
            cx.notify();
        }
        self.end_resize(false, cx);
    }
    /// Standalone files decoded from a legacy encoding remain read-only;
    /// project documents use their separate lossless round-trip policy.
    pub fn read_only(&self, cx: &App) -> bool {
        self.file_mode
            && self
                .docs
                .read(cx)
                .document
                .as_ref()
                .is_some_and(|d| d.encoding != crate::workspace::TextEncoding::Utf8)
    }
    pub fn open_conflict_comparison(&mut self, cx: &mut Context<Self>) {
        if self.docs.read(cx).cloud_conflict() && !self.comparing_conflict {
            self.comparing_conflict = true;
            cx.notify();
        }
    }
    pub fn close_conflict_comparison(&mut self, cx: &mut Context<Self>) {
        if self.comparing_conflict {
            self.comparing_conflict = false;
            cx.notify();
        }
    }
    pub fn dismiss_external_drop(&mut self, cx: &mut Context<Self>) {
        if self.pending_external_drop.take().is_some() {
            cx.notify();
        }
    }
    /// `WB-21` choice 1: copy the dropped external file into the workspace root and open it.
    pub fn confirm_external_drop_copy_to_workspace(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(drop) = self.pending_external_drop.take() else {
            return;
        };
        let Some(ws) = self.docs.read(cx).workspace.clone() else {
            cx.notify();
            return;
        };
        match ws.import_external(&drop.path, std::path::Path::new("")) {
            Ok(imported) => {
                let listing = ws.list(std::path::Path::new("")).ok();
                self.explorer.update(cx, |e, cx| {
                    e.entry_created(std::path::Path::new(""), listing, &imported, cx);
                });
                self.docs.update(cx, |d, _| {
                    d.open_at_edge(imported, &drop.pane, drop.direction, drop.placement);
                });
                self.sync(window, cx);
                cx.emit(EditorEvent::Pump);
            }
            Err(err) => {
                self.docs.update(cx, |d, _| d.error = Some(err.to_string()));
                cx.emit(EditorEvent::Pump);
            }
        }
        cx.notify();
    }
    /// `WB-21` choice 2: open the dropped external file in a standalone File Window.
    pub fn confirm_external_drop_open_file_window(&mut self, cx: &mut Context<Self>) {
        let Some(drop) = self.pending_external_drop.take() else {
            return;
        };
        let docs = self.docs.downgrade();
        let area = self.weak.clone();
        cx.defer(move |cx| {
            if let Err(err) = super::windows::open_file(drop.path, cx) {
                let _ = docs.update(cx, |d, _| d.error = Some(err.to_string()));
                let _ = area.update(cx, |_, cx| cx.emit(EditorEvent::Pump));
            }
        });
        cx.notify();
    }
    /// Refreshes workspace link reference contexts across all open editor hosts (`TODO-48`).
    pub fn refresh_references(&mut self, cx: &mut Context<Self>) {
        let hosts: Vec<_> = self.hosts.iter().map(|(s, e)| (*s, e.clone())).collect();
        for (slot, editor) in hosts {
            let references = self.references(slot, cx);
            editor.update(cx, |s, cx| {
                s.set_reference_context(references, cx);
            });
        }
        cx.notify();
    }
    /// `slot`'s host, once its document has one.
    pub fn host(&self, slot: u64) -> Option<&Entity<DocumentEditor>> {
        self.hosts.get(&slot)
    }
    /// The references a document's links resolve against; a lone file has
    /// no neighbours (`EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT`).
    fn references(
        &self,
        slot: u64,
        cx: &mut App,
    ) -> Option<crate::editor::navigation::ReferenceContext> {
        if self.file_mode {
            return None;
        }
        let (workspace, path) = {
            let files = self.docs.read(cx).slot(slot)?;
            let (_, path) = files.opened()?;
            (files.workspace.clone()?, path.to_path_buf())
        };
        self.explorer.update(cx, |session, _| {
            session.reference_context(&workspace, &path)
        })
    }

    /// Delivers the runtime's messages to the hosts (making a host for a
    /// new slot) and their answers back, drops the hosts of closed slots,
    /// and holds the editors behind the gate.
    pub fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let type_defaults = self.preferences.read(cx).state.file_type_defaults.clone();
        self.docs.update(cx, |d, _| {
            d.set_file_type_defaults(type_defaults);
        });
        let sampled: Vec<(
            u64,
            bool,
            bool,
            Option<crate::editor::workbench::view_state::SurfaceViewState>,
        )> = self
            .hosts
            .iter()
            .filter(|(slot, _)| **slot != 0)
            .map(|(slot, editor)| {
                let s = editor.read(cx);
                (
                    *slot,
                    s.composing(cx),
                    s.holds_page_history(cx),
                    s.view_state(cx),
                )
            })
            .collect();
        self.docs.update(cx, |d, _| {
            for (slot, composing, page_history, vs) in sampled {
                d.set_slot_composing(slot, composing);
                d.set_slot_page_history(slot, page_history);
                if let Some(vs) = vs {
                    d.record_view_state(slot, vs);
                }
            }
            d.persist_metadata(false);
        });
        let active = self.docs.read(cx).active_slot();
        let mut focus_native = self.hosts.get(&active).is_some_and(|e| e != &self.front);
        for _ in 0..4 {
            let messages = self.docs.update(cx, |d, _| d.take_outgoing());
            if messages.is_empty() {
                break;
            }
            for (slot, message) in messages {
                if !self.hosts.contains_key(&slot) {
                    let editor = self.new_host(slot, window, cx);
                    self.hosts.insert(slot, editor);
                }
                let opened_fresh = matches!(
                    message,
                    HostMessage::Open {
                        external: false,
                        ..
                    } | HostMessage::OpenResource { .. }
                );
                focus_native |= slot == active
                    && matches!(
                        message,
                        HostMessage::Open { .. }
                            | HostMessage::OpenResource { .. }
                            | HostMessage::Oversized { .. }
                    );
                let references = self.references(slot, cx);
                let (workspace, open_prefs, resource_key, preferred_handler) = {
                    let docs = self.docs.read(cx);
                    (
                        docs.slot(slot).and_then(|s| s.workspace.clone()),
                        docs.active_open_preferences(),
                        docs.slot_resource_key(slot).map(str::to_owned),
                        docs.slot_handler(slot).cloned(),
                    )
                };
                let (replies, active_handler) = self.hosts[&slot].update(cx, |s, cx| {
                    s.set_reference_context(references, cx);
                    s.set_workspace(workspace);
                    s.set_open_preferences(open_prefs);
                    s.set_resource_key(resource_key);
                    s.set_preferred_handler(preferred_handler);
                    let replies = s.receive(&message, window, cx);
                    (replies, s.active_handler().cloned())
                });
                if let Some(handler) = active_handler {
                    self.docs
                        .update(cx, |d, _| d.set_slot_handler(slot, handler));
                }
                if opened_fresh
                    && let Some(saved_vs) = self
                        .docs
                        .update(cx, |d, _| d.take_pending_view_restore(slot))
                {
                    self.hosts[&slot]
                        .update(cx, |s, cx| s.restore_view_state(&saved_vs, window, cx));
                }
                self.docs.update(cx, |d, _| {
                    for reply in replies {
                        d.client_for(slot, reply);
                    }
                });
            }
        }
        let retained = self.docs.read(cx).retained_slots();
        let evicted_final: Vec<(
            u64,
            Option<crate::editor::workbench::view_state::SurfaceViewState>,
        )> = self
            .hosts
            .iter()
            .filter(|(id, _)| **id != 0 && !retained.contains(id))
            .map(|(id, editor)| (*id, editor.read(cx).view_state(cx)))
            .collect();
        if !evicted_final.is_empty() {
            self.docs.update(cx, |d, _| {
                for (id, vs) in evicted_final {
                    d.set_slot_composing(id, false);
                    d.set_slot_page_history(id, false);
                    if let Some(vs) = vs {
                        d.record_view_state(id, vs);
                    }
                }
            });
        }
        self.hosts.retain(|id, _| retained.contains(id));
        self.tab_focus.retain(|id, _| retained.contains(id));
        if let Some(editor) = self.hosts.get(&active) {
            self.front = editor.clone();
        }
        self.apply_gate(window, cx);
        self.schedule_saved_refresh(cx);
        if self.gate.home || (active == 0 && self.docs.read(cx).state().is_some()) {
            self.window_focus.focus(window, cx);
            focus_native = false;
        }
        #[cfg(feature = "dev-capture")]
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
            && std::env::var("PUPPYONE_EDITOR_FOCUS").as_deref() == Ok("0")
        {
            focus_native = false;
        }
        if focus_native && !self.gate.modal && !self.docs.read(cx).busy() {
            self.front
                .update(cx, |editor, cx| editor.focus_document(window, cx));
        }
        cx.notify();
    }
    /// A host for `slot`: its pane menu answers here, its messages go to
    /// the runtime.
    fn new_host(
        &mut self,
        slot: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<DocumentEditor> {
        self.tab_focus.insert(slot, cx.focus_handle());
        let owner = cx.entity_id();
        let file_mode = self.file_mode;
        let editor = cx.new(|cx| {
            let mut editor = DocumentEditor::new(cx);
            editor.workbench = true;
            editor.file_mode = file_mode;
            editor.pane_drag = Some(crate::editor::workbench::pane::PaneDrag { owner, slot });
            editor
        });
        cx.subscribe_in(
            &editor,
            window,
            move |s, _, event: &ClientMessage, window, cx| {
                if let ClientMessage::OpenWith {
                    format_id,
                    handler,
                    always,
                    ..
                } = event
                {
                    if s.docs.read(cx).visible_slots().contains(&slot) && !s.gate.modal {
                        s.focus_slot(slot, cx);
                        cx.emit(EditorEvent::OpenWith {
                            slot,
                            format_id: format_id.clone(),
                            handler: handler.clone(),
                            always: *always,
                        });
                    }
                    cx.notify();
                    return;
                }
                if let ClientMessage::Action { action } = event {
                    if s.docs.read(cx).visible_slots().contains(&slot) && !s.gate.modal {
                        s.focus_slot(slot, cx);
                        let close = action == "close-file";
                        if close {
                            s.docs.update(cx, |d, _| {
                                if let Some(active) = d.state().map(|s| s.layout.active.clone()) {
                                    d.close_pane(&active);
                                }
                            });
                        } else if let Some(command) = Command::from_protocol(action) {
                            cx.emit(EditorEvent::Command(command));
                        }
                        s.sync(window, cx);
                        // The closed pane held the focus (its menu): the
                        // pane that becomes active takes it.
                        if close && s.docs.read(cx).active_slot() != 0 {
                            s.front
                                .update(cx, |editor, cx| editor.focus_document(window, cx));
                        }
                    }
                } else {
                    let normalized = matches!(event, ClientMessage::NormalizeLineEndings { .. });
                    let event = event.clone();
                    s.docs.update(cx, |d, _| d.client_for(slot, event));
                    if normalized {
                        s.sync(window, cx);
                        cx.emit(EditorEvent::Pump);
                    }
                }
                cx.notify();
            },
        )
        .detach();
        if file_mode {
            cx.observe(&editor, |_, _, cx| cx.notify()).detach();
        }
        editor
    }
    /// Holds each editor behind the gate: a dialog, the Homepage, a slot
    /// out of sight, or a document still on its way.
    fn apply_gate(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let visible = self.docs.read(cx).visible_slots();
        let read_only = self.read_only(cx);
        let gate = self.gate;
        let hosts: Vec<_> = self.hosts.iter().map(|(s, e)| (*s, e.clone())).collect();
        for (slot, editor) in hosts {
            let references = self.references(slot, cx);
            let blocked = gate.modal
                || gate.home
                || !visible.contains(&slot)
                || self
                    .docs
                    .read(cx)
                    .slot(slot)
                    .is_none_or(|f| f.busy() || f.allow_quit);
            editor.update(cx, |s, cx| {
                s.set_reference_context(references, cx);
                s.read_only = read_only;
                s.gate(blocked, gate.dark, window, cx);
            });
        }
    }
}

impl Render for EditorArea {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // A drop preview outlives no drag.
        if self.drop.is_some() && !cx.has_active_drag() {
            cx.defer_in(window, |s, _, cx| {
                if !cx.has_active_drag() && s.drop.take().is_some() {
                    cx.notify();
                }
            });
        }
        let t = cx.palette();
        // A project with no open document shows the quiet editor canvas.
        let mut canvas = div().relative().size_full().bg(t.canvas);
        let root = self
            .docs
            .read(cx)
            .state()
            .map(|state| state.layout.root.clone());
        if let Some(root) = root {
            let whole = crate::geometry::Rect::new(0., 0., 1., 1.);
            canvas = canvas.child(self.editor_node(&root, whole, cx));
        } else if self.docs.read(cx).opened().is_some() {
            canvas = canvas.child(div().absolute().size_full().child(self.front.clone()));
        }
        // A split resize follows the pointer wherever it goes.
        if self.resize.is_some() {
            let area = self.weak.clone();
            canvas = canvas.child(
                gpui::canvas(
                    |_, _, _| {},
                    move |_, _, window, _| {
                        let moved = area.clone();
                        window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                            if phase == DispatchPhase::Capture {
                                let _ = moved.update(cx, |s, cx| s.move_resize(e.position, cx));
                            }
                        });
                        let released = area.clone();
                        window.on_mouse_event(move |e: &MouseUpEvent, phase, _, cx| {
                            if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                                let _ = released.update(cx, |s, cx| {
                                    s.move_resize(e.position, cx);
                                    s.end_resize(true, cx);
                                });
                            }
                        });
                    },
                )
                .absolute()
                .size_full(),
            );
        }
        if let Some(dialog) = self.conflict_comparison_dialog(cx) {
            canvas = canvas.child(dialog);
        }
        if let Some(dialog) = self.external_drop_dialog(cx) {
            canvas = canvas.child(dialog);
        }
        canvas
    }
}
use crate::ui::appearance::ActiveAppearance as _;

impl EditorArea {
    /// `.editor-notice-stack`, 48px below the top of the editor region
    /// `editor`, 12px in from its end (`end` from the window's): the active
    /// document's 4-exit Cloud conflict, local overwrite undo notice, draft
    /// recovery notice, or typed save failure (`DP-04`, `DP-05`, `DP-11`, `DP-43`).
    pub(super) fn notices(
        &self,
        editor: crate::geometry::Rect,
        end: f32,
        cx: &App,
    ) -> Option<AnyElement> {
        use crate::{
            localization::t as tr,
            ui::components::{
                FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone,
            },
        };
        let docs = self.docs.read(cx);
        if docs.cloud_conflict() {
            let compare_area = self.weak.clone();
            let keep_area = self.weak.clone();
            let accept_area = self.weak.clone();
            let copy_area = self.weak.clone();
            return Some(
                NoticeStack::new(
                    NoticePlacement::TopEnd,
                    editor.y + 48.,
                    end + 12.,
                    (editor.w - 24.).min(620.),
                )
                .child(
                    FloatingNotice::new(
                        "editor-session-notice",
                        tr("editor.session.cloudConflict"),
                    )
                    .tone(NoticeTone::Danger)
                    .action(NoticeAction::new(
                        "editor-conflict-compare",
                        tr("native.editor.conflictCompare"),
                        move |_, cx| {
                            let _ = compare_area.update(cx, |_, cx| {
                                cx.emit(EditorEvent::Command(Command::CompareCloudConflict))
                            });
                        },
                    ))
                    .action(
                        NoticeAction::new(
                            "editor-conflict-keep-mine",
                            tr("native.editor.conflictKeepMine"),
                            move |_, cx| {
                                let _ = keep_area.update(cx, |_, cx| {
                                    cx.emit(EditorEvent::Command(Command::KeepLocalCloudDraft))
                                });
                            },
                        )
                        .emphasis(),
                    )
                    .action(NoticeAction::new(
                        "editor-session-reload",
                        tr("native.editor.conflictAcceptRemote"),
                        move |_, cx| {
                            let _ = accept_area.update(cx, |_, cx| {
                                cx.emit(EditorEvent::Command(Command::ReloadCloudBaseline))
                            });
                        },
                    ))
                    .action(NoticeAction::new(
                        "editor-conflict-save-copy",
                        tr("native.editor.conflictSaveCopy"),
                        move |_, cx| {
                            let _ = copy_area.update(cx, |_, cx| {
                                cx.emit(EditorEvent::Command(Command::SaveConflictCopy))
                            });
                        },
                    )),
                )
                .into_any_element(),
            );
        }

        let mut items = Vec::new();

        if docs.local_overwrite_notice.is_some() {
            let undo_area = self.weak.clone();
            let dismiss_area = self.weak.clone();
            items.push(
                FloatingNotice::new(
                    "editor-local-overwrite-notice",
                    tr("native.editor.updatedFromDiskUndo"),
                )
                .tone(NoticeTone::Neutral)
                .action(NoticeAction::new(
                    "editor-local-overwrite-undo",
                    tr("native.editor.undo"),
                    move |_, cx| {
                        let _ = undo_area
                            .update(cx, |_, cx| cx.emit(EditorEvent::Command(Command::Undo)));
                    },
                ))
                .on_dismiss(move |_, cx| {
                    let _ = dismiss_area.update(cx, |e, cx| {
                        e.docs.update(cx, |d, _| d.dismiss_local_overwrite_notice());
                        cx.notify();
                    });
                }),
            );
        }

        if docs.recovered_draft_notice.is_some() {
            let dismiss_area = self.weak.clone();
            items.push(
                FloatingNotice::new(
                    "editor-draft-recovered-notice",
                    tr("native.editor.draftRecovered"),
                )
                .tone(NoticeTone::Info)
                .on_dismiss(move |_, cx| {
                    let _ = dismiss_area.update(cx, |e, cx| {
                        e.docs.update(cx, |d, _| d.dismiss_recovered_draft_notice());
                        cx.notify();
                    });
                }),
            );
        }

        if let Some(detail) = docs
            .save_error
            .clone()
            .filter(|e| self.dismissed_save_error.as_ref() != Some(e))
        {
            let area = self.weak.clone();
            let dismissed = detail.clone();
            let message = crate::documents::localized_save_error(docs.save_error_kind, &detail);
            items.push(
                FloatingNotice::new("editor-save-failure", message)
                    .tone(NoticeTone::Danger)
                    .on_dismiss(move |_, cx| {
                        let _ = area.update(cx, |e, cx| {
                            e.dismissed_save_error = Some(dismissed.clone());
                            cx.notify();
                        });
                    }),
            );
        }

        if items.is_empty() {
            return None;
        }
        Some(
            NoticeStack::new(
                NoticePlacement::TopEnd,
                editor.y + 48.,
                end + 12.,
                (editor.w - 24.).min(420.),
            )
            .children(items)
            .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        app::{Shell, bind_keys},
        documents::Intent,
        editor::workbench::runtime::Runtime,
        workspace::{Workspace, testing::Memory},
    };
    use core::prelude::v1::test;
    use std::sync::Arc;

    fn setup_shell(cx: &mut TestAppContext) -> (Entity<Shell>, &mut VisualTestContext) {
        cx.executor().allow_parking();
        cx.update(|cx| {
            bind_keys(cx);
            crate::ui::input::bind_keys(cx);
            crate::editor::view::bind_keys(cx);
            crate::editor::csv::bind_keys(cx);
            crate::editor::host::bind_keys(cx);
        });
        let mut content = None;
        let (_, cx) = cx.add_window_view(|w, cx| {
            let view = cx.new(|cx| Shell::new(w, cx));
            content = Some(view.clone());
            gpui_kit::base::Root::new(view, w, cx)
        });
        let view = content.unwrap();
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        (view, cx)
    }

    fn settle(
        view: &Entity<Shell>,
        cx: &mut VisualTestContext,
        ready: impl Fn(&Shell, &App) -> bool,
    ) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            if view.read_with(cx, |s, cx| ready(s, cx)) {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "shell did not settle");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    }

    #[gpui::test]
    fn dp05_hosted_conflict_renders_four_exits_and_compare_modal_and_keep_mine(
        cx: &mut TestAppContext,
    ) {
        let memory = Arc::new(Memory::new("memory://actor/project/"));
        let ws = Workspace::from_provider(memory.clone()).unwrap();
        let (view, cx) = setup_shell(cx);
        view.update_in(cx, |s, w, cx| {
            s.session.project.update(cx, |p, _| {
                p.record.fixture = false;
                p.home = false;
            });
            s.session.docs.update(cx, |d, _| {
                let mut rt = Runtime::default();
                rt.workspace = Some(ws);
                d.replace(rt);
                d.begin(Intent::OpenFile("note.md".into()));
            });
            s.receive(w, cx);
        });
        settle(&view, cx, |s, cx| s.files(cx).opened().is_some());

        // Remote changes while user types locally and saves -> overlapping Cloud conflict!
        *memory.text.lock().unwrap() = "remote version\n".into();
        cx.simulate_input("my draft ");
        view.update_in(cx, |s, w, cx| s.command(Command::Save, w, cx));
        settle(&view, cx, |s, cx| s.files(cx).cloud_conflict());

        // Verify EditorArea::notices builds the 4-exit notice cleanly.
        view.read_with(cx, |s, cx| {
            let rect = crate::geometry::Rect::new(0., 38., 800., 560.);
            assert!(s.editor.read(cx).notices(rect, 0., cx).is_some());
        });

        // Exit 1: Compare opens the read-only conflict comparison dialog.
        view.update_in(cx, |s, w, cx| {
            s.command(Command::CompareCloudConflict, w, cx);
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.read_with(cx, |s, cx| {
            assert!(s.editor.read(cx).comparing_conflict);
            assert!(s.editor.read(cx).conflict_comparison_dialog(cx).is_some());
        });

        // Exit 2: Keep Mine closes comparison, rebases onto remote, and writes local draft!
        view.update_in(cx, |s, w, cx| {
            s.command(Command::KeepLocalCloudDraft, w, cx);
        });
        settle(&view, cx, |s, cx| {
            !s.files(cx).cloud_conflict() && !s.files(cx).saving()
        });
        view.read_with(cx, |s, cx| {
            assert!(!s.editor.read(cx).comparing_conflict);
        });
        assert!(memory.text.lock().unwrap().contains("my draft "));
    }

    #[gpui::test]
    fn dp04_and_dp31_local_overwrite_undo_and_mixed_line_ending_normalize_in_shell(
        cx: &mut TestAppContext,
    ) {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("mixed.md"), b"one\r\ntwo\nthree\r").unwrap();
        std::fs::write(folder.path().join("note.md"), b"alpha\nbeta\n").unwrap();
        let (view, cx) = setup_shell(cx);
        view.update(cx, |s, cx| {
            s.session.project.update(cx, |p, _| {
                p.record.fixture = false;
                p.home = false;
            });
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFolder(folder.path().into())));
        });
        settle(&view, cx, |s, cx| s.files(cx).state().is_some());

        // 1. DP-31: Mixed line endings open read-only with banner; NormalizeLineEndings thaws & writes.
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile("mixed.md".into())));
        });
        settle(&view, cx, |s, cx| {
            s.files(cx)
                .opened()
                .is_some_and(|(_, p)| p == std::path::Path::new("mixed.md"))
        });
        assert!(cx.debug_bounds("document-readonly-banner").is_some());
        assert!(cx.debug_bounds("normalize-line-endings-button").is_some());
        view.update(cx, |s, cx| {
            let id = s.files(cx).document.as_ref().unwrap().id.clone();
            let front = s.editor.read(cx).front.clone();
            front.update(cx, |_, cx| {
                cx.emit(ClientMessage::NormalizeLineEndings { id });
            });
        });
        cx.run_until_parked();
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.flush_pending_auto_save());
        });
        settle(&view, cx, |s, cx| !s.files(cx).saving());
        assert!(cx.debug_bounds("document-readonly-banner").is_none());
        assert_eq!(
            std::fs::read(folder.path().join("mixed.md")).unwrap(),
            b"one\ntwo\nthree\n"
        );
        // TODO-48: ReferencesChanged refreshes open hosts cleanly without panicking or dropping state.
        view.update_in(cx, |s, w, cx| {
            s.explorer_session_event(
                &crate::app::explorer::SessionEvent::ReferencesChanged,
                w,
                cx,
            );
        });

        // 2. DP-04: Overlapping disk overwrite surfaces neutral notice and Command::Undo restores local draft.
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile("note.md".into())));
        });
        settle(&view, cx, |s, cx| {
            s.files(cx)
                .opened()
                .is_some_and(|(_, p)| p == std::path::Path::new("note.md"))
        });
        cx.simulate_input("MINE ");
        std::fs::write(folder.path().join("note.md"), "DISK\nbeta\n").unwrap();
        view.update_in(cx, |s, w, cx| {
            s.command(Command::Save, w, cx);
        });
        settle(&view, cx, |s, cx| {
            s.files(cx).local_overwrite_notice.is_some()
        });
        view.update_in(cx, |s, w, cx| {
            s.command(Command::Undo, w, cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |s, cx| {
            assert!(s.files(cx).local_overwrite_notice.is_none());
            assert!(
                s.editor
                    .read(cx)
                    .front
                    .read(cx)
                    .text(cx)
                    .unwrap_or_default()
                    .contains("MINE ")
            );
        });
    }

    #[gpui::test]
    fn wb21_external_finder_drop_prompts_and_executes_copy_to_workspace_and_open_file_window(
        cx: &mut TestAppContext,
    ) {
        use crate::editor::workbench::layout::{Direction, Placement};
        let folder = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("inside.md"), "inside\n").unwrap();
        let ext_a = outside.path().join("external_a.md");
        let ext_b = outside.path().join("external_b.md");
        std::fs::write(&ext_a, "outside alpha\n").unwrap();
        std::fs::write(&ext_b, "outside beta\n").unwrap();

        let (view, cx) = setup_shell(cx);
        view.update(cx, |s, cx| {
            s.session.project.update(cx, |p, _| {
                p.record.fixture = false;
                p.home = false;
            });
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFolder(folder.path().into())));
        });
        settle(&view, cx, |s, cx| s.files(cx).state().is_some());

        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile("inside.md".into())));
        });
        settle(&view, cx, |s, cx| {
            s.files(cx)
                .opened()
                .is_some_and(|(_, p)| p == std::path::Path::new("inside.md"))
        });

        let active_pane = view.read_with(cx, |s, cx| {
            s.files(cx).state().unwrap().layout.active.clone()
        });

        // 1. Drop outside file `external_a.md` -> opens WB-21 delivery prompt dialog.
        view.update(cx, |s, cx| {
            let paths = ExternalPaths(vec![ext_a.clone()].into());
            let handled = s.editor.update(cx, |e, cx| {
                e.handle_external_paths_drop(
                    &paths,
                    &active_pane,
                    Direction::Horizontal,
                    Placement::Second,
                    cx,
                )
            });
            assert!(handled);
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        cx.run_until_parked();
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.read_with(cx, |s, cx| {
            assert!(s.editor.read(cx).pending_external_drop.is_some());
            assert!(s.editor.read(cx).external_drop_dialog(cx).is_some());
        });
        assert!(cx.debug_bounds("external-file-drop-body").is_some());

        // Choice A: "Copy to Workspace" imports into workspace root and opens in pane!
        view.update_in(cx, |s, w, cx| {
            s.editor.update(cx, |e, cx| {
                e.confirm_external_drop_copy_to_workspace(w, cx);
            });
        });
        settle(&view, cx, |s, cx| {
            s.files(cx)
                .opened()
                .is_some_and(|(_, p)| p == std::path::Path::new("external_a.md"))
        });
        assert_eq!(
            std::fs::read_to_string(folder.path().join("external_a.md")).unwrap(),
            "outside alpha\n"
        );
        view.read_with(cx, |s, cx| {
            assert!(s.editor.read(cx).pending_external_drop.is_none());
        });

        // 2. Drop outside file `external_b.md` -> Choice B: "Open in File Window".
        let initial_windows = cx.read(|app| app.windows().len());
        view.update(cx, |s, cx| {
            let paths = ExternalPaths(vec![ext_b.clone()].into());
            let handled = s.editor.update(cx, |e, cx| {
                e.handle_external_paths_drop(
                    &paths,
                    &active_pane,
                    Direction::Horizontal,
                    Placement::Second,
                    cx,
                )
            });
            assert!(handled);
        });
        view.update(cx, |s, cx| {
            s.editor.update(cx, |e, cx| {
                e.confirm_external_drop_open_file_window(cx);
            });
        });
        cx.run_until_parked();
        assert!(!folder.path().join("external_b.md").exists());
        assert_eq!(cx.read(|app| app.windows().len()), initial_windows + 1);
    }
}

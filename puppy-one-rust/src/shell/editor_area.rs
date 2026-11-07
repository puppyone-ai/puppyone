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
use crate::{
    documents::{ClientMessage, HostMessage},
    editor::host::DocumentEditor,
    features::settings::preferences_store::PreferencesStore,
};
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
}

/// What the editor area asks of the window.
pub(super) enum EditorEvent {
    /// A pane menu command (open in the default app, close the file, …).
    Command(Command),
    /// The runtime was asked for something: the window pumps it now.
    Pump,
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
    /// Re-renders once a transient "Saved" status lapses.
    pub saved_refresh: Option<Task<()>>,
    /// Where each pane and split was painted, in window coordinates: what
    /// a drop or a split resize is measured against.
    pub(super) pane_bounds: Painted,
    pub(super) split_bounds: Painted,
}
impl EventEmitter<EditorEvent> for EditorArea {}

impl EditorArea {
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
        cx.subscribe_in(&front, window, |s, _, event: &ClientMessage, _, cx| {
            if let ClientMessage::Action { action } = event {
                if s.docs.read(cx).state().is_none()
                    && let Some(command) = Command::from_protocol(action)
                {
                    cx.emit(EditorEvent::Command(command));
                }
                return;
            }
            let event = event.clone();
            s.docs.update(cx, |d, _| d.client_for(0, event));
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
        self.drop = None;
        self.end_resize(false, cx);
    }
    /// The file's text is not UTF-8: it reads, and never writes
    /// (`editor.fileMode.readOnlyEncoding`).
    pub fn read_only(&self, cx: &App) -> bool {
        self.file_mode
            && self
                .docs
                .read(cx)
                .document
                .as_ref()
                .is_some_and(|d| d.encoding != crate::workspace::TextEncoding::Utf8)
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
        self.docs.update(cx, |d, _| d.persist_metadata(false));
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
                focus_native |= slot == active
                    && matches!(
                        message,
                        HostMessage::Open { .. } | HostMessage::OpenResource { .. }
                    );
                let references = self.references(slot, cx);
                let workspace = (!self.file_mode)
                    .then(|| self.docs.read(cx).slot(slot)?.workspace.clone())
                    .flatten();
                let replies = self.hosts[&slot].update(cx, |s, cx| {
                    s.set_reference_context(references, cx);
                    s.set_workspace(workspace);
                    s.receive(&message, window, cx)
                });
                self.docs.update(cx, |d, _| {
                    for reply in replies {
                        d.client_for(slot, reply);
                    }
                });
            }
        }
        let retained = self.docs.read(cx).retained_slots();
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
                if let ClientMessage::Action { action } = event {
                    if s.docs.read(cx).visible_slots().contains(&slot) && !s.gate.modal {
                        s.focus_slot(slot, cx);
                        if action == "close-file" {
                            s.docs.update(cx, |d, _| {
                                if let Some(mut state) = d.state_mut() {
                                    let active = state.layout.active.clone();
                                    state.close_pane(&active);
                                }
                            });
                        } else if let Some(command) = Command::from_protocol(action) {
                            cx.emit(EditorEvent::Command(command));
                        }
                        s.sync(window, cx);
                    }
                } else {
                    let event = event.clone();
                    s.docs.update(cx, |d, _| d.client_for(slot, event));
                }
                cx.notify();
            },
        )
        .detach();
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
        canvas
    }
}
use crate::ui::appearance::ActiveAppearance as _;

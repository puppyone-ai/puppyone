//! Translate platform events into one session's commands and input transactions.
use super::editor_view::NativeEditor;
use crate::{
    documents::ClientMessage,
    native_editor::core::{
        document::Kind,
        projection::Projection,
        selection::Selection,
        text::{Mark, Text},
        transaction::{Command, InputEdit},
    },
    ui::input::{InputEvent, InputSnapshot, TextInput},
};
use gpui::{prelude::*, *};
impl NativeEditor {
    pub(super) fn sync_fields(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(session) = &self.session else { return };
        let projection = Projection::new(&session.state.document);
        let snapshot = InputSnapshot {
            text: projection.text.text.clone(),
            marks: projection
                .text
                .marks
                .iter()
                .map(|m| crate::ui::input::Mark {
                    bold: m.bold,
                    italic: m.italic,
                })
                .collect(),
            anchor: session
                .state
                .selection
                .anchor
                .min(projection.text.text.len()),
            cursor: session
                .state
                .selection
                .cursor
                .min(projection.text.text.len()),
        };
        let regions = super::projection::regions(session, &projection);
        let key = projection.at(snapshot.cursor).key;
        let table = matches!(
            session.state.document.blocks[key.0].kind,
            Kind::Table { .. }
        );
        let read_only = self.blocked || session.frozen;
        let field = if let Some(field) = &self.input {
            field.clone()
        } else {
            let field = cx.new(|cx| {
                let mut input =
                    TextInput::new("Start writing…", true, crate::workspace::MAX_TEXT_BYTES, cx);
                input.external_history = true;
                input.document_mode = true;
                input.font_size =
                    crate::theme::font_size(crate::ui::input::presentation::BODY_SIZE);
                input
            });
            self.subscription = Some(cx.subscribe_in(&field, window, |s, field, event, w, cx| {
                s.input_event(field.clone(), event, w, cx)
            }));
            self.input = Some(field.clone());
            field
        };
        field.update(cx, |i, cx| {
            i.regions = regions;
            i.table_cell = table;
            i.dark = self.dark;
            i.read_only = read_only;
            // Never reset the platform marked range while IME owns composition.
            if !i.composing() && i.snapshot() != snapshot {
                i.restore(snapshot, cx);
            }
            cx.notify();
        });
    }
    fn emit_dirty(&self, cx: &mut Context<Self>) {
        if let Some(s) = &self.session {
            cx.emit(ClientMessage::Dirty {
                id: s.id.clone(),
                revision: s.revision,
                dirty: s.dirty(),
            });
        }
    }
    pub fn command(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(command) = Command::from_name(name) {
            self.apply_command(command, window, cx);
        }
    }
    pub(super) fn apply_command(
        &mut self,
        command: Command,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(session) = &mut self.session else {
            return;
        };
        if self.blocked || session.frozen || session.pending_ime.is_some() {
            return;
        }
        let effect = session.execute(command);
        if let Some(bold) = effect.typing_mark
            && let Some(input) = &self.input
        {
            input.update(cx, |i, cx| i.toggle_typing_mark(bold, cx));
        }
        self.sync_fields(window, cx);
        self.focus_selected(window, cx);
        self.emit_dirty(cx);
        cx.notify();
    }
    pub(super) fn input_event(
        &mut self,
        field: Entity<TextInput>,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(session) = &mut self.session else {
            return;
        };
        if (self.blocked || session.frozen)
            && !(matches!(event, InputEvent::Changed)
                && session.pending_ime.is_some()
                && !field.read(cx).composing())
        {
            return;
        }
        if matches!(event, InputEvent::Selection) && field.read(cx).last_replacement.is_some() {
            return;
        }
        match event {
            InputEvent::Changed | InputEvent::Selection => {
                let value = field.read(cx).snapshot();
                let selection = Selection {
                    anchor: value.anchor,
                    cursor: value.cursor,
                };
                if matches!(event, InputEvent::Selection) {
                    session.state.selection = selection;
                } else {
                    let composing = field.read(cx).composing();
                    let (replacement, soft) =
                        field.update(cx, |i, _| (i.last_replacement.take(), i.soft_break));
                    let replacement = replacement.map(|(range, len)| {
                        let a = value.text[..range.start].chars().count();
                        let b = a + value.text[range.start..range.start + len].chars().count();
                        let inserted = Text {
                            text: value.text[range.start..range.start + len].into(),
                            marks: value.marks[a..b]
                                .iter()
                                .map(|m| Mark {
                                    bold: m.bold,
                                    italic: m.italic,
                                })
                                .collect(),
                        };
                        (range, inserted)
                    });
                    session.edit(InputEdit {
                        selection,
                        replacement,
                        soft,
                        composing,
                    });
                    self.emit_dirty(cx);
                }
            }
            InputEvent::Undo => {
                self.apply_command(Command::Undo, window, cx);
                return;
            }
            InputEvent::Redo => {
                self.apply_command(Command::Redo, window, cx);
                return;
            }
            InputEvent::Next {
                backwards,
                vertical,
            } => {
                let revision = session.revision;
                session.navigate_table(*backwards, *vertical);
                if session.revision != revision {
                    self.emit_dirty(cx);
                }
            }
            InputEvent::PasteTable(text) => {
                if session.pending_ime.is_some() {
                    return;
                }
                if session.paste_table(text) {
                    self.emit_dirty(cx);
                } else {
                    cx.emit(ClientMessage::Fault {
                        message:
                            "Table paste exceeds 128 rows / 24 columns / 64 KiB; nothing changed."
                                .into(),
                    });
                }
            }
            InputEvent::Adornment(offset) => {
                if session.toggle_task_at(*offset) {
                    self.emit_dirty(cx);
                }
            }
        }
        self.sync_fields(window, cx);
        cx.notify();
    }
}

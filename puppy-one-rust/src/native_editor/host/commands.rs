//! The only commit path for explicit feature commands.
use super::session::Session;
use crate::native_editor::{
    core::{
        projection::Projection,
        selection::Selection,
        transaction::{Command, InsertKind},
    },
    features::{code_block, heading, list, paragraph, table},
};
#[derive(Default)]
pub struct CommandEffect {
    pub typing_mark: Option<bool>,
}
impl Session {
    pub fn execute(&mut self, command: Command) -> CommandEffect {
        let mut effect = CommandEffect::default();
        if self.frozen || self.pending_ime.is_some() {
            return effect;
        }
        let before = self.state.clone();
        let projection = Projection::new(&self.state.document);
        let key = projection.at(self.state.selection.cursor).key;
        let mut target = None;
        match command {
            Command::Undo => self.history(false),
            Command::Redo => self.history(true),
            Command::Source => self.source_mode(),
            Command::ToggleMark { bold } => {
                let selection = &self.state.selection;
                if selection.anchor == selection.cursor
                    && self.state.document.blocks[key.0].kind.rich()
                {
                    effect.typing_mark = Some(bold);
                }
                self.state.document.toggle_visible(
                    selection.anchor.min(selection.cursor)..selection.anchor.max(selection.cursor),
                    bold,
                );
            }
            Command::SetStyle(style) => heading::set_style(&mut self.state.document, key.0, style),
            Command::ToggleTask => list::toggle_task(&mut self.state.document, key),
            Command::Table(op) => {
                target = table::commands::apply(&mut self.state.document, key, op)
            }
            Command::Insert(kind) => {
                if self.state.source_mode {
                    return effect;
                }
                let kind = match kind {
                    InsertKind::Paragraph => paragraph::new_paragraph(),
                    InsertKind::Table => table::commands::new_table(),
                    InsertKind::List => list::new_task_list(),
                    InsertKind::Code => code_block::new_code(),
                };
                target = Some(paragraph::insert_after(
                    &mut self.state.document,
                    key.0,
                    kind,
                ));
            }
            Command::AddItem => target = list::add_item(&mut self.state.document, key),
            Command::DeleteBlock => {
                if self.state.source_mode {
                    return effect;
                }
                self.state.document.remove_block(key.0);
                self.state.selection = Selection::default();
            }
        }
        if let Some(key) = target {
            let offset = Projection::new(&self.state.document).offset(key);
            self.state.selection = Selection {
                anchor: offset,
                cursor: offset,
            };
        }
        if !matches!(command, Command::Undo | Command::Redo | Command::Source) {
            self.changed(before);
        }
        effect
    }
    pub fn navigate_table(&mut self, backwards: bool, vertical: bool) {
        if self.frozen || self.pending_ime.is_some() {
            return;
        }
        match table::navigation::next(
            &self.state.document,
            self.state.selection.cursor,
            backwards,
            vertical,
        ) {
            table::navigation::Navigation::None => {}
            table::navigation::Navigation::Caret(offset) => {
                self.state.selection = Selection {
                    anchor: offset,
                    cursor: offset,
                }
            }
            table::navigation::Navigation::Edit(command) => {
                self.execute(command);
            }
        }
    }
    pub fn paste_table(&mut self, text: &str) -> bool {
        if self.frozen || self.pending_ime.is_some() {
            return false;
        }
        let before = self.state.clone();
        let key = Projection::new(&self.state.document)
            .at(self.state.selection.cursor)
            .key;
        if !self.state.document.paste_table(key, text) {
            return false;
        }
        self.changed(before);
        true
    }
    pub fn toggle_task_at(&mut self, offset: usize) -> bool {
        if self.frozen || self.pending_ime.is_some() {
            return false;
        }
        self.state.selection = Selection {
            anchor: offset,
            cursor: offset,
        };
        let key = Projection::new(&self.state.document).at(offset).key;
        if !list::is_task(&self.state.document, key) {
            return false;
        }
        self.execute(Command::ToggleTask);
        true
    }
}

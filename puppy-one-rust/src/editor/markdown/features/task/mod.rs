//! Tasks (product features of list items, core/commands/markdownTaskCommands.ts):
//! a task's `[ ]` / `[x]` is an inline atom shown as a checkbox in the list
//! marker slot; pressing it toggles the source.
mod paint;
pub mod style;

use crate::editor::{
    markdown::core::{
        decorations::LineDecoration,
        feature::{CommandCx, CompileCx, MarkdownFeature},
        plans::{Atom, Plan, Presentation},
        syntax::{Element, Kind},
    },
    text::{
        change::ChangeSet,
        state::{Transaction, UserEvent},
    },
    view::command::Command,
};

pub struct TaskFeature;
pub static FEATURE: TaskFeature = TaskFeature;
pub const ID: &str = "task";

/// Toggle the task on a source line.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct Toggle {
    pub line: usize,
}

pub fn toggle_command(line: usize) -> Command {
    Command::new(ID, Toggle { line })
}

impl MarkdownFeature for TaskFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn semantic_kinds(&self) -> &'static [Kind] {
        &[Kind::Task]
    }

    /// The checkbox atom over `[ ]`, deleted as one unit.
    fn compile_element(&self, index: usize, e: &Element, _: &CompileCx) -> Option<Plan> {
        let source = e.markers.get(1).cloned().unwrap_or(e.range.clone());
        Some(Plan { element: Some(index), source: source.clone(), presentation: Presentation::InlineAtom(Atom::TaskCheckbox { checked: e.checked }), delete_units: vec![source] })
    }

    fn decorate_line(&self, cx: &mut LineDecoration) {
        let checked = cx.plans.iter().find_map(|p| match p.presentation {
            Presentation::InlineAtom(Atom::TaskCheckbox { checked }) if p.source.start >= cx.range.start && p.source.start <= cx.range.end => Some(checked),
            _ => None,
        });
        let (Some(checked), Some(slot)) = (checked, cx.context.marker) else { return };
        let (paints, hit) = paint::checkbox(&cx.theme.task, checked, slot, cx.context.text_top, cx.context.line_height, cx.context.font_size);
        cx.style.overlays.extend(paints);
        cx.style.hotspots.push((hit, toggle_command(cx.line)));
    }

    fn command(&self, command: &Command, cx: &CommandCx) -> Option<Transaction> {
        let Toggle { line } = *command.payload::<Toggle>()?;
        let state = cx.state;
        if line >= state.doc.line_count() {
            return None;
        }
        let range = state.doc.line_range(line);
        let task = cx.syntax.elements.iter().find(|e| e.kind == Kind::Task && e.line.as_ref().is_some_and(|l| l.start == range.start))?;
        let start = task.markers.get(1)?.start;
        let checkbox = start..start + 3;
        let insert = match state.doc.slice(checkbox.clone()) {
            "[ ]" => "[x]",
            "[x]" | "[X]" => "[ ]",
            _ => return None,
        };
        let mut tr = Transaction::edit(ChangeSet::replace(checkbox, insert), None, UserEvent::Command);
        tr.scroll_into_view = false;
        Some(tr)
    }
}

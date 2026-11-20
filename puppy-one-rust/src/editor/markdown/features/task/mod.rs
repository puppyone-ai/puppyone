//! Tasks (product features of list items, core/commands/markdownTaskCommands.ts):
//! a task's `[ ]` / `[x]` is an inline atom shown as a checkbox in the list
//! marker slot; pressing it toggles the source. Completed task lines render
//! their strikethrough in `TaskStyle.completed_decoration`
//! (`--po-md-task-completed-decoration-color`, `TODO-46`).
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
    fn compile_blocks(&self, _: &CompileCx, _: &mut Vec<Plan>) {}

    fn compile_element(&self, index: usize, e: &Element, _: &CompileCx) -> Option<Plan> {
        let source = e.markers.get(1).cloned().unwrap_or(e.range.clone());
        Some(Plan {
            element: Some(index),
            source: source.clone(),
            presentation: Presentation::InlineAtom(Atom::TaskCheckbox { checked: e.checked }),
            delete_units: vec![source],
        })
    }

    fn decorate_line(&self, cx: &mut LineDecoration) {
        if cx.style.strike && cx.style.embed.is_none() {
            cx.style.strike = false;
            cx.style.embed = Some(paint::completed_strike_embed(
                &cx.range,
                &cx.style.text,
                cx.style.nowrap,
                &cx.theme.task,
            ));
        }
        let checked = cx.plans.iter().find_map(|p| match p.presentation {
            Presentation::InlineAtom(Atom::TaskCheckbox { checked })
                if p.source.start >= cx.range.start && p.source.start <= cx.range.end =>
            {
                Some(checked)
            }
            _ => None,
        });
        let (Some(checked), Some(slot)) = (checked, cx.context.marker) else {
            return;
        };
        let (paints, hit) = paint::checkbox(
            &cx.theme.task,
            checked,
            slot,
            cx.context.text_top,
            cx.context.line_height,
            cx.context.font_size,
        );
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
        let task = cx.syntax.elements.iter().find(|e| {
            e.kind == Kind::Task && e.line.as_ref().is_some_and(|l| l.start == range.start)
        })?;
        let start = task.markers.get(1)?.start;
        let checkbox = start..start + 3;
        let insert = match state.doc.slice(checkbox.clone()) {
            "[ ]" => "[x]",
            "[x]" | "[X]" => "[ ]",
            _ => return None,
        };
        let mut tr = Transaction::edit(
            ChangeSet::replace(checkbox, insert),
            None,
            UserEvent::Command,
        );
        tr.scroll_into_view = false;
        Some(tr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        editor::{
            markdown::{
                MarkdownExtension,
                composition::FEATURES,
                core::{
                    decorations::{self, DecorateCx},
                    plans, presentation,
                    state::PreviewState,
                    syntax::Syntax,
                },
                style::MarkdownTheme,
            },
            text::buffer::Buffer,
            tokens::Tokens,
            view::{EditorView, bind_keys, decoration::Block, style as view_style},
        },
        typography::Scale,
    };
    use core::prelude::v1::test;

    #[test]
    fn completed_tasks_wire_completed_decoration_color_onto_strikethrough() {
        let tokens = Tokens::get(true, Scale::Medium);
        let theme = MarkdownTheme::resolve(true, Scale::Medium);
        assert_eq!(
            theme.task.completed_decoration,
            tokens.color("--po-md-task-completed-decoration-color")
        );
        assert_ne!(
            theme.task.completed_color, theme.task.completed_decoration,
            "completed text colour and strikethrough decoration colour are distinct tokens"
        );

        let doc = Buffer::new("- [x] Done item\n- [ ] Open item\n");
        let syntax = Syntax::parse(&doc);
        let folds = Default::default();
        let compiled = plans::compile(&doc, &syntax, &folds, FEATURES);
        let rhythm = presentation::block_rhythm(&doc, &syntax, None);
        let preview = PreviewState::default();
        let decos = decorations::decorate(&DecorateCx {
            doc: &doc,
            syntax: &syntax,
            plans: &compiled,
            rhythm: &rhythm,
            theme: &theme,
            preview: &preview,
            live: true,
            features: FEATURES,
            assets: None,
            references: None,
        });
        let Block::Line {
            style: checked_line,
            ..
        } = &decos.blocks[0]
        else {
            panic!("expected line block for checked task");
        };
        assert_eq!(checked_line.text.color, theme.task.completed_color);
        assert!(
            !checked_line.strike,
            "generic text-colour strike is replaced by completed_decoration strike embed"
        );
        assert!(
            checked_line.embed.is_some(),
            "completed_decoration strike embed must be wired on checked task line"
        );

        let Block::Line {
            style: open_line, ..
        } = &decos.blocks[1]
        else {
            panic!("expected line block for open task");
        };
        assert!(!open_line.strike);
        assert!(open_line.embed.is_none());
    }

    #[gpui::test]
    fn checked_task_draws_and_toggles_in_live_editor(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            if cx.try_global::<gpui_kit::component::Theme>().is_none() {
                gpui_kit::init(cx);
            }
            cx.text_system()
                .add_fonts(view_style::font_bytes())
                .unwrap();
            bind_keys(cx);
        });
        let (view, cx) = cx.add_window_view(|_, cx| {
            EditorView::new(
                "- [x] Ship release\n- [ ] Write docs\n",
                Box::new(MarkdownExtension::new(true, Scale::Medium)),
                cx,
            )
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.update_in(cx, |v, w, cx| {
            v.run_command(&toggle_command(0), w, cx);
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.update(cx, |v, _| {
            assert_eq!(v.text(), "- [ ] Ship release\n- [ ] Write docs\n");
        });
    }

    /// `toggles the parser's exact checkbox span`: wide and tab spacing and
    /// a nested task toggle exactly their `[ ]` and back.
    #[test]
    fn a_toggle_flips_exactly_the_parsers_checkbox() {
        use crate::editor::{markdown::core::feature::CommandCx, text::state::EditorState};
        for text in ["-   [ ] task", "-\t[ ] task", "- parent\n    - [ ] task"] {
            let mut state = EditorState::new(text);
            let line = state.doc.line_count() - 1;
            for expected in [text.replace("[ ]", "[x]"), text.to_owned()] {
                let syntax = Syntax::parse(&state.doc);
                let tr = FEATURE
                    .command(
                        &toggle_command(line),
                        &CommandCx {
                            state: &state,
                            syntax: &syntax,
                            plans: &[],
                        },
                    )
                    .unwrap_or_else(|| panic!("{text:?}"));
                state.apply(tr);
                assert_eq!(state.doc.as_str(), expected);
            }
        }
    }
}

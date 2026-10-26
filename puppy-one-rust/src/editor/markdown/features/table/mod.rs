//! Markdown tables (product features/table): the model of rows and cells
//! over the source, its block plan, the cell decorations (each cell's inline
//! Markdown; pipes and the delimiter row are not caret positions) and the
//! table widget.
mod commands;
mod interaction;
mod layout;
pub mod model;
mod operation;
pub mod style;
#[cfg(test)]
mod tests;
mod widget;

use crate::editor::{
    markdown::{
        core::{
            decorations::BlockDecoration,
            feature::{CommandCx, CompileCx, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan, Presentation},
        },
        style::cascade::LineContext,
    },
    text::state::Transaction,
    view::{command::Command, widget::BlockWidget},
};
use model::Table;
use std::rc::Rc;
use widget::TableWidget;

pub struct TableFeature;
pub static FEATURE: TableFeature = TableFeature;
pub const ID: &str = "table";

impl MarkdownFeature for TableFeature {
    fn id(&self) -> &'static str {
        ID
    }

    /// `tableFeature` collectBlock: the model narrows the parser's table.
    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        for range in &cx.syntax.tables {
            if let Some(table) = model::table_block(cx.doc, range) {
                out.push(Plan {
                    element: None,
                    source: table.range.clone(),
                    presentation: Presentation::BlockAtom(BlockEmbed::new(ID, table)),
                    delete_units: Vec::new(),
                });
            }
        }
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        Some(Rc::new(TableWidget::new(
            embed.model::<Table>()?,
            &cx.theme.table,
            cx.theme.body.text.weight,
            cx.theme.dark,
        )))
    }

    /// Structure operations from the widget's rails, grips and menu.
    fn command(&self, command: &Command, cx: &CommandCx) -> Option<Transaction> {
        commands::transaction(command, cx)
    }

    /// Cells render their inline Markdown (header cells inherit the header
    /// weight, `th strong { font-weight: inherit }`); the pipes, cell padding
    /// and delimiter row are not caret positions.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        let Some(table) = embed.model::<Table>() else {
            return;
        };
        let (header_weight, body_weight) =
            (cx.theme().table.header_weight, cx.theme().body.text.weight);
        for line in table.lines.clone() {
            let range = cx.doc().line_range(line);
            match table.rows.iter().find(|r| r.line == line) {
                Some(row) => {
                    let context = LineContext {
                        weight: if row.header {
                            header_weight
                        } else {
                            body_weight
                        },
                        heading: row.header,
                        ..Default::default()
                    };
                    cx.inline_line(line, context);
                    let mut at = range.start;
                    for cell in row.cells.iter().filter(|c| c.editable) {
                        cx.atomic(at..cell.range.start);
                        at = cell.range.end;
                    }
                    cx.atomic(at..range.end);
                }
                // The delimiter row (and its line break).
                None => {
                    let end = (range.end + 1).min(cx.doc().len());
                    cx.atomic(range.start..end);
                }
            }
        }
    }
}

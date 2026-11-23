//! Markdown table block plan compilation (`tablePlan.ts`, `MA-04`: zero `gpui`).
use super::{ID, model};
use crate::editor::markdown::core::{
    features::CompileCx,
    plans::{BlockEmbed, Plan, Presentation},
};

/// `tableFeature` collectBlock: the model narrows the parser's table.
pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
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

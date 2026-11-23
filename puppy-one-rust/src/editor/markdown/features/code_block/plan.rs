//! Fenced code block plan compilation (`codeBlockPlan.ts`, `MA-04`: zero `gpui`).
use super::{ID, model::CodeBlock};
use crate::editor::markdown::core::{
    features::CompileCx,
    plans::{BlockEmbed, Plan, Presentation},
};

/// `codeBlockPlan.ts`: every fence compiles to a code block widget plan.
pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    for fence in &cx.syntax.fences {
        let block = CodeBlock {
            range: fence.range.clone(),
            code: fence.code.clone(),
            language: fence.language.clone(),
        };
        out.push(Plan {
            element: None,
            source: fence.range.clone(),
            presentation: Presentation::BlockAtom(BlockEmbed::new(ID, block)),
            delete_units: Vec::new(),
        });
    }
}

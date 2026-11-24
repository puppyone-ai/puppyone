//! Fenced code block plan compilation (`codeBlockPlan.ts`, `MA-04`: zero `gpui`).
use super::{ID, model::CodeBlock};
use crate::editor::markdown::core::{
    features::CompileCx,
    plans::{
        BlockEmbed, DocumentProfile, Plan, Presentation,
        execution::{CODE_RICH_BYTES, CODE_RICH_LINES},
    },
};

/// `codeBlockPlan.ts`: every fence within the code budget compiles to a code
/// block widget plan; a longer one stays source (`decide("codeBlock")`).
pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    let profile =
        DocumentProfile::classify(cx.doc.byte_to_utf16(cx.doc.len()), cx.doc.line_count()).index();
    for fence in &cx.syntax.fences {
        let lines = cx
            .doc
            .line_index(fence.range.end.saturating_sub(1).max(fence.range.start))
            - cx.doc.line_index(fence.range.start)
            + 1;
        if lines > CODE_RICH_LINES[profile] || fence.range.len() > CODE_RICH_BYTES[profile] {
            out.push(Plan {
                element: None,
                source: fence.range.clone(),
                presentation: Presentation::SourceFallback {
                    code: "codeBlock.render-budget",
                },
                delete_units: Vec::new(),
            });
            continue;
        }
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

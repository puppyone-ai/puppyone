//! Mermaid block plan compilation (`MA-04`: zero `gpui`).
use super::{
    ID,
    model::{MermaidBlock, execution, is_mermaid},
};
use crate::editor::markdown::core::{
    features::{CommandCx, CompileCx},
    plans::{BlockEmbed, DocumentProfile, Plan, Presentation},
};

pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    // O(1) rope summary UTF-16 length — never materialises `doc.flat`!
    let units = cx.doc.len_utf16();
    let profile = DocumentProfile::classify(units, cx.doc.line_count());
    for fence in &cx.syntax.fences {
        if !is_mermaid(&fence.language) {
            continue;
        }
        let source = cx.doc.slice_cow(fence.code.clone()).into_owned();
        let Some(deferred) = execution(&source, profile) else {
            continue;
        };
        out.push(Plan {
            element: None,
            source: fence.range.clone(),
            presentation: Presentation::BlockAtom(BlockEmbed::new(
                ID,
                MermaidBlock {
                    range: fence.range.clone(),
                    code: fence.code.clone(),
                    source,
                    deferred,
                },
            )),
            delete_units: Vec::new(),
        });
    }
}

pub fn block_at(cx: &CommandCx, at: usize) -> Option<MermaidBlock> {
    cx.plans
        .iter()
        .filter_map(|p| p.embed()?.model::<MermaidBlock>())
        .find(|b| b.range.start == at)
        .cloned()
}

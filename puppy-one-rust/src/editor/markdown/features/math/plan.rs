//! Math inline and display plan compilation (`mathPlan.ts`, `MA-04`: zero `gpui`).
use super::{
    ID,
    model::{MathBlock, source_diagnostic},
    syntax, tex,
};
use crate::editor::markdown::core::{
    features::CompileCx,
    plans::{Atom, BlockEmbed, Plan, Presentation},
    syntax::Element,
};

/// Compiles one inline `$formula$` element into an inline atom or source fallback.
pub fn compile_element(index: usize, element: &Element, cx: &CompileCx) -> Option<Plan> {
    let source = cx.doc.slice_cow(element.content.clone()?);
    let presentation = match source_diagnostic(&source) {
        Some(code) => Presentation::SourceFallback { code },
        None => Presentation::InlineAtom(Atom::Text(element.text.clone()?)),
    };
    Some(Plan {
        element: Some(index),
        source: element.range.clone(),
        presentation,
        delete_units: Vec::new(),
    })
}

/// Compiles display `$$` blocks and `math` fences within the current block window.
pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    let line_bounds = match (cx.syntax.top_blocks.first(), cx.syntax.top_blocks.last()) {
        (Some(first), Some(last)) => {
            cx.doc.line_index(first.start)..cx.doc.line_index(last.end) + 1
        }
        _ => 0..0,
    };
    let mut found = syntax::blocks_in_range(cx.doc, &cx.syntax.code_lines, line_bounds);
    for fence in &cx.syntax.fences {
        if fence.language.eq_ignore_ascii_case("math")
            && fence.info.trim().eq_ignore_ascii_case("math")
        {
            let code_cow = cx.doc.slice_cow(fence.code.clone());
            if !code_cow.trim().is_empty() {
                found.push(MathBlock {
                    range: fence.range.clone(),
                    content: fence.code.clone(),
                    text: tex::convert(&code_cow),
                    source: code_cow.into_owned(),
                });
            }
        }
    }
    for block in found {
        out.push(Plan {
            element: None,
            source: block.range.clone(),
            presentation: match source_diagnostic(&block.source) {
                Some(code) => Presentation::SourceFallback { code },
                None => Presentation::BlockAtom(BlockEmbed::new(ID, block)),
            },
            delete_units: Vec::new(),
        });
    }
}

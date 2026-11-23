//! MDX component block plan compilation (`mdxComponentPlan.ts`, `MA-04`: zero `gpui`).
use super::{
    ID,
    model::{TabsBlock, tabs},
    syntax::blocks,
};
use crate::editor::markdown::core::{
    features::CompileCx,
    plans::{BlockEmbed, Plan, Presentation},
};

pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    let (Some(first), Some(last)) = (cx.syntax.top_blocks.first(), cx.syntax.top_blocks.last())
    else {
        return;
    };
    let base = cx.doc.line_range(cx.doc.line_index(first.start)).start;
    let limit = cx
        .doc
        .line_range(cx.doc.line_index(last.end.min(cx.doc.len())))
        .end;
    let slice_cow = cx.doc.slice_cow(base..limit);
    let slice = slice_cow.as_ref();
    for rel_block in blocks(slice) {
        let abs_start = base + rel_block.start;
        let abs_end = (base + rel_block.end).min(limit);
        let line = cx.doc.line_range(cx.doc.line_index(abs_start)).start;
        let source = slice[rel_block.start..abs_end - base].trim_end_matches(['\n', '\r']);
        let range = line..abs_start + source.len();
        let presentation = match tabs(source) {
            Ok(tabs) => Presentation::BlockAtom(BlockEmbed::new(
                ID,
                TabsBlock {
                    range: range.clone(),
                    tabs,
                },
            )),
            // Unsupported, malformed or self-closing MDX components stay
            // literal source, every line of them, rather than falling
            // through to HTML blocks or rendering their Markdown.
            Err(code) => Presentation::SourceFallback { code },
        };
        out.push(Plan {
            element: None,
            source: range,
            presentation,
            delete_units: Vec::new(),
        });
    }
}

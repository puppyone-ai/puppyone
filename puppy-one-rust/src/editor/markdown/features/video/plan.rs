//! Video block plan compilation (`videoPlan.ts`, `MA-04`: zero `gpui`).
use super::{ID, model::VideoBlock};
use crate::editor::markdown::core::{
    features::CompileCx,
    plans::{BlockEmbed, Plan, Presentation},
    syntax::Kind,
};

/// `collectBlock`: a video embed that owns its whole line.
pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    for e in &cx.syntax.elements {
        if e.kind != Kind::VideoEmbed {
            continue;
        }
        let line = cx.doc.line_range(cx.doc.line_index(e.range.start));
        if !cx.doc.slice(line.start..e.range.start).trim().is_empty()
            || !cx.doc.slice(e.range.end..line.end).trim().is_empty()
        {
            continue;
        }
        let Some(href) = e.href.clone() else { continue };
        out.push(Plan {
            element: None,
            source: line.clone(),
            presentation: Presentation::BlockAtom(BlockEmbed::new(
                ID,
                VideoBlock::new(line, href, e.text.as_deref()),
            )),
            delete_units: Vec::new(),
        });
    }
}

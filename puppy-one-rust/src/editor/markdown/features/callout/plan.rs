//! Callout block plan compilation (`features/callout/plan.rs`, `MA-04`: zero `gpui`).
use super::{
    ID,
    model::{self, FoldedBody},
    state::{self, CalloutFoldState},
};
use crate::editor::markdown::core::{
    features::CompileCx,
    plans::{BlockEmbed, Plan, Presentation},
};

/// Emits folded-body placeholder plans for callouts folded in the current pane.
pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    let fold_state = cx.state::<CalloutFoldState>(ID);
    for callout in model::collect_callouts(cx.doc, cx.syntax) {
        if state::is_folded(&callout, fold_state) && callout.last_line > callout.first_line {
            let range = cx.doc.line_range(callout.first_line + 1).start
                ..cx.doc.line_range(callout.last_line).end;
            out.push(Plan {
                element: None,
                source: range.clone(),
                presentation: Presentation::BlockAtom(BlockEmbed::new(ID, FoldedBody { range })),
                delete_units: Vec::new(),
            });
        }
    }
}

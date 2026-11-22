//! Incremental plan splicing, tail re-attachment, and on-demand refresh of
//! shifted block plans (`TA-13`, `TA-32`, `TA-81`).
use super::{
    compiler::{compile, compile_blocks_in_window, compile_one_element},
    index::PlanCache,
    primitives::shift_plans_slice,
    types::Plan,
};
use crate::editor::{
    markdown::core::{
        features::{CompileCx, Features},
        state::FeatureStateStore,
        syntax::{Span, Syntax, SyntaxSplice},
    },
    text::buffer::Buffer,
};

/// Incrementally splice compiled `Plan`s across `splice` (`TA-32`), recompiling
/// ONLY elements and feature blocks inside `splice.new_bytes` and shifting
/// suffix plans in place.
#[allow(clippy::too_many_arguments)]
pub fn compile_incremental(
    doc: &Buffer,
    syntax: &Syntax,
    prev_plans: &[Plan],
    prev_element_count: usize,
    splice: &SyntaxSplice,
    folds: &FeatureStateStore,
    features: Features,
    cache: &mut PlanCache,
) -> Vec<Plan> {
    let mut next = prev_plans.to_vec();
    compile_incremental_in_place(
        doc,
        syntax,
        &mut next,
        prev_element_count,
        splice,
        folds,
        features,
        cache,
    );
    next
}

/// In-place variant of [`compile_incremental`] (`TA-32`, `TA-13`), splicing and
/// shifting `plans` without cloning suffix `Vec<Range<usize>>` heap allocations.
#[allow(clippy::too_many_arguments)]
pub fn compile_incremental_in_place(
    doc: &Buffer,
    syntax: &Syntax,
    plans: &mut Vec<Plan>,
    prev_element_count: usize,
    splice: &SyntaxSplice,
    folds: &FeatureStateStore,
    features: Features,
    cache: &mut PlanCache,
) {
    let ob = &splice.old_bytes;
    let nb = &splice.new_bytes;
    let bd = splice.byte_delta;
    let elem_delta = syntax.elements.len() as isize - prev_element_count as isize;

    // Fall back to full compilation if any prior plan straddles the splice
    // boundaries, or if multi-block feature delimiters occur inside/unpaired
    // before the splice window.
    let pre_delims = syntax.block_delimiters.partition_point(|&p| p < nb.start);
    let end_delims = syntax.block_delimiters.partition_point(|&p| p < nb.end);
    if splice.old_had_delimiters
        || end_delims > pre_delims
        || pre_delims % 2 == 1
        || cache.any_straddles(plans, ob.start)
        || cache.any_straddles(plans, ob.end)
    {
        *plans = compile(doc, syntax, folds, features);
        cache.rebuild_index(plans);
        return;
    }

    let full_cx = CompileCx { doc, syntax, folds };
    let el_start = syntax
        .elements
        .partition_point(|e| e.range.start < nb.start);
    let el_end = syntax
        .elements
        .partition_point(|e| e.range.start < nb.end)
        .max(el_start);

    let mut win_plans: Vec<Plan> = (el_start..el_end)
        .map(|i| compile_one_element(i, &syntax.elements[i], &full_cx, features))
        .collect();
    win_plans.extend(compile_blocks_in_window(
        doc,
        syntax,
        folds,
        features,
        nb.clone(),
        splice.new_lines.clone(),
    ));
    if win_plans
        .iter()
        .any(|p| p.source.start < nb.start || p.source.end > nb.end)
    {
        *plans = compile(doc, syntax, folds, features);
        cache.rebuild_index(plans);
        return;
    }
    win_plans.sort_by(|a, b| {
        a.source
            .start
            .cmp(&b.source.start)
            .then(a.source.end.cmp(&b.source.end))
    });
    cache.block_compiles += 1;
    cache.splice_indexes(ob, &win_plans, bd);

    let p_pre = plans.partition_point(|p| p.source.start < ob.start);
    let p_suf = plans
        .partition_point(|p| p.source.start < ob.end)
        .max(p_pre);
    let win_len = win_plans.len();
    plans.splice(p_pre..p_suf, win_plans);

    if bd != 0 || elem_delta != 0 {
        shift_plans_slice(&mut plans[p_pre + win_len..], bd, elem_delta);
    }
}

/// Re-attach a previously detached suffix tail of plans after shifting byte and
/// element indices by their accumulated deltas (`TA-81`).
pub fn append_shifted_tail(
    plans: &mut Vec<Plan>,
    mut tail: Vec<Plan>,
    bd: isize,
    elem_delta: isize,
) {
    if bd != 0 || elem_delta != 0 {
        shift_plans_slice(&mut tail, bd, elem_delta);
    }
    plans.append(&mut tail);
}

/// Ensure any `BlockAtom` plan intersecting `byte_range` has a fresh `model`
/// compiled at its current `source.start` (used before running commands on a
/// block that was previously byte-shifted).
pub fn refresh_shifted_block_plans(
    doc: &Buffer,
    syntax: &Syntax,
    folds: &FeatureStateStore,
    features: Features,
    plans: &mut [Plan],
    byte_range: Span,
) {
    let needs_refresh = plans.iter().any(|p| {
        p.source.end >= byte_range.start
            && p.source.start <= byte_range.end
            && p.embed().is_some_and(|e| !e.built_for(doc, p.source.start))
    });
    if !needs_refresh {
        return;
    }
    let start_line = doc.line_index(byte_range.start);
    let end_line = (doc.line_index(byte_range.end) + 1).min(doc.line_count());
    let fresh = compile_blocks_in_window(
        doc,
        syntax,
        folds,
        features,
        byte_range,
        start_line..end_line,
    );
    for p in plans.iter_mut() {
        if let Some(embed) = p.embed()
            && !embed.built_for(doc, p.source.start)
            && let Some(replacement) = fresh.iter().find(|f| {
                f.source == p.source && f.embed().is_some_and(|fe| fe.feature == embed.feature)
            })
        {
            *p = replacement.clone();
        }
    }
}

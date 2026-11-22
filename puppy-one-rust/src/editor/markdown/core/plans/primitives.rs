//! Shared plan-ownership and range-shifting primitives
//! (product `core/plans/planPrimitives.ts`).
use super::types::{Plan, Presentation};
use crate::editor::markdown::core::features::MarkdownFeature;
use std::ops::Range;

/// Composition order decides which feature owns an identical block range,
/// including a feature's explicit source fallback. Stable source sorting
/// preserves that order. Inline plans remain independent.
pub(super) fn retain_first_block_owner(plans: &mut Vec<Plan>) {
    let mut claimed = std::collections::HashSet::new();
    plans.retain(|plan| !owns_block(plan) || claimed.insert((plan.source.start, plan.source.end)));
}

pub(super) fn owns_block(plan: &Plan) -> bool {
    plan.embed().is_some() || (plan.element.is_none() && plan.is_visible_source())
}

/// A [`MarkdownFeature::owns_block_lines`] feature's block plans claim
/// their lines from the features composed after it.
pub(super) fn claim_lines(
    f: &dyn MarkdownFeature,
    stage: &mut Vec<Plan>,
    owned: &mut Vec<Range<usize>>,
) {
    stage.retain(|p| {
        !owns_block(p)
            || !owned
                .iter()
                .any(|o| o.start <= p.source.start && p.source.end <= o.end)
    });
    if f.owns_block_lines() {
        owned.extend(
            stage
                .iter()
                .filter(|p| owns_block(p))
                .map(|p| p.source.clone()),
        );
    }
}

pub(super) fn shift_signed(v: usize, delta: isize) -> usize {
    (v as isize + delta) as usize
}

pub(super) fn shift_range(r: &Range<usize>, delta: isize) -> Range<usize> {
    shift_signed(r.start, delta)..shift_signed(r.end, delta)
}

pub(super) fn shift_plans_slice(plans: &mut [Plan], bd: isize, elem_delta: isize) {
    for m in plans {
        m.source = shift_range(&m.source, bd);
        if let Some(el) = &mut m.element {
            *el = shift_signed(*el, elem_delta);
        }
        if bd != 0 {
            for du in &mut m.delete_units {
                *du = shift_range(du, bd);
            }
            if let Presentation::InlineMark { content, markers } = &mut m.presentation {
                *content = shift_range(content, bd);
                for mk in markers {
                    *mk = shift_range(mk, bd);
                }
            }
        }
    }
}

//! Range straddle and `SourceFallback` plan indexes (`TA-32`, `TA-81`,
//! product `core/plans/markdownPlanIndex.ts`).
use super::{
    primitives::shift_range,
    types::{Plan, Presentation},
};
use std::{collections::HashMap, ops::Range};

/// Lookback byte window for `O(log N)` plan boundary straddle checks; plans
/// longer than this threshold are indexed separately in `PlanCache::large_plans`.
const PLAN_STRADDLE_LOOKBACK: usize = 4096;

/// Per-block compiled `Plan` cache (`TA-32`), keyed by `(block_start,
/// block_content_hash, state_hash)` so unchanged blocks skip recompilation,
/// plus incremental straddle and `SourceFallback` indexes (`TA-81`).
#[derive(Clone, Default)]
pub struct PlanCache {
    entries: HashMap<(usize, u64, u64), Vec<Plan>>,
    pub block_compiles: u64,
    large_plans: Vec<Range<usize>>,
    source_fallbacks: Vec<(bool, Range<usize>)>,
    indexed: bool,
}

impl PlanCache {
    pub fn clear(&mut self) {
        self.entries.clear();
        self.large_plans.clear();
        self.source_fallbacks.clear();
        self.indexed = false;
    }

    pub fn rebuild_index(&mut self, plans: &[Plan]) {
        self.large_plans.clear();
        self.source_fallbacks.clear();
        for p in plans {
            if p.source.len() > PLAN_STRADDLE_LOOKBACK {
                self.large_plans.push(p.source.clone());
            }
            if matches!(p.presentation, Presentation::SourceFallback { .. }) {
                self.source_fallbacks
                    .push((p.element.is_none(), p.source.clone()));
            }
        }
        self.indexed = true;
    }

    pub fn source_fallbacks(&self) -> Option<&[(bool, Range<usize>)]> {
        self.indexed.then_some(self.source_fallbacks.as_slice())
    }

    /// Exact `O(log N)` check whether any plan in `plans` strictly straddles
    /// `pos` (`p.source.start < pos && p.source.end > pos`).
    pub fn any_straddles(&mut self, plans: &[Plan], pos: usize) -> bool {
        if !self.indexed {
            self.rebuild_index(plans);
        }
        if self
            .large_plans
            .iter()
            .any(|r| r.start < pos && r.end > pos)
        {
            return true;
        }
        let lo =
            plans.partition_point(|p| p.source.start < pos.saturating_sub(PLAN_STRADDLE_LOOKBACK));
        let hi = plans.partition_point(|p| p.source.start < pos).max(lo);
        plans[lo..hi].iter().any(|p| p.source.end > pos)
    }

    /// Drop indexed entries at/after `split_byte` when detaching a deferred tail.
    pub fn truncate_at(&mut self, split_byte: usize) {
        if !self.indexed {
            return;
        }
        let lp = self.large_plans.partition_point(|r| r.start < split_byte);
        self.large_plans.truncate(lp);
        let sf = self
            .source_fallbacks
            .partition_point(|(_, r)| r.start < split_byte);
        self.source_fallbacks.truncate(sf);
    }

    pub(super) fn splice_indexes(&mut self, ob: &Range<usize>, win_plans: &[Plan], bd: isize) {
        if !self.indexed {
            return;
        }
        let lp_pre = self.large_plans.partition_point(|r| r.start < ob.start);
        let lp_suf = self
            .large_plans
            .partition_point(|r| r.start < ob.end)
            .max(lp_pre);
        let new_large: Vec<Range<usize>> = win_plans
            .iter()
            .filter(|p| p.source.len() > PLAN_STRADDLE_LOOKBACK)
            .map(|p| p.source.clone())
            .collect();
        let new_large_len = new_large.len();
        self.large_plans.splice(lp_pre..lp_suf, new_large);
        if bd != 0 {
            for r in &mut self.large_plans[lp_pre + new_large_len..] {
                *r = shift_range(r, bd);
            }
        }

        let sf_pre = self
            .source_fallbacks
            .partition_point(|(_, r)| r.start < ob.start);
        let sf_suf = self
            .source_fallbacks
            .partition_point(|(_, r)| r.start < ob.end)
            .max(sf_pre);
        let new_sf: Vec<(bool, Range<usize>)> = win_plans
            .iter()
            .filter(|p| matches!(p.presentation, Presentation::SourceFallback { .. }))
            .map(|p| (p.element.is_none(), p.source.clone()))
            .collect();
        let new_sf_len = new_sf.len();
        self.source_fallbacks.splice(sf_pre..sf_suf, new_sf);
        if bd != 0 {
            for (_, r) in &mut self.source_fallbacks[sf_pre + new_sf_len..] {
                *r = shift_range(r, bd);
            }
        }
    }
}

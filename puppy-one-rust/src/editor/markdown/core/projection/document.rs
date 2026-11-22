//! Parsed document projection state and deferred suffix tail lifecycle
//! (product `core/projection/markdownDocumentProjection.ts`, `TA-81`).
//!
//! Pure, `gpui`-free (`R10`): owns the cached `Syntax`, `Vec<Plan>`,
//! `PlanCache`, lazy `Headings`, and optional detached `DeferredTail` so edits
//! in the document prefix avoid shifting untouched suffix elements/plans.
use super::super::{
    links::Headings,
    plans::{self, Plan, PlanCache},
    state::FeatureStateStore,
    syntax::{Syntax, SyntaxSplice},
};
use crate::editor::text::buffer::Buffer;
use std::{cell::OnceCell, rc::Rc};

pub struct DeferredTail {
    pub split_byte: usize,
    pub split_line: usize,
    pub byte_delta: isize,
    pub line_delta: isize,
    pub elem_delta: isize,
    pub list_delta: isize,
    pub item_delta: isize,
    pub syntax: Syntax,
    pub plans: Vec<Plan>,
}

pub struct Parsed {
    pub revision: u64,
    pub len: usize,
    pub syntax: Rc<Syntax>,
    pub folds: FeatureStateStore,
    pub plan_cache: PlanCache,
    pub plans: Rc<Vec<Plan>>,
    pub headings: OnceCell<Headings>,
    pub last_splice: Option<(u64, SyntaxSplice)>,
    pub tail: Option<DeferredTail>,
}

impl Parsed {
    pub fn from_syntax(
        revision: u64,
        doc: &Buffer,
        syntax: Rc<Syntax>,
        folds: &FeatureStateStore,
        features: super::super::features::Features,
    ) -> Self {
        let compiled = plans::compile(doc, &syntax, folds, features);
        let mut plan_cache = PlanCache::default();
        plan_cache.rebuild_index(&compiled);
        Self {
            revision,
            len: doc.len(),
            syntax,
            folds: folds.clone(),
            plan_cache,
            plans: Rc::new(compiled),
            headings: OnceCell::new(),
            last_splice: None,
            tail: None,
        }
    }

    /// Whether an edit ending at `max_old` lies strictly inside the prefix with
    /// at least two guard top-level blocks before the detached tail split.
    pub fn tail_fits_head(&self, max_old: usize) -> bool {
        let Some(tail) = &self.tail else {
            return true;
        };
        self.syntax.top_blocks.len() >= 6
            && max_old < self.syntax.top_blocks[self.syntax.top_blocks.len() - 2].start
            && max_old < tail.split_byte
    }

    pub fn materialize_tail(&mut self) {
        let Some(tail) = self.tail.take() else {
            return;
        };
        Rc::make_mut(&mut self.syntax).append_shifted_tail(
            tail.syntax,
            tail.byte_delta,
            tail.line_delta,
            tail.list_delta,
            tail.item_delta,
        );
        plans::append_shifted_tail(
            Rc::make_mut(&mut self.plans),
            tail.plans,
            tail.byte_delta,
            tail.elem_delta,
        );
        self.plan_cache.rebuild_index(&self.plans);
    }

    /// Detach the untouched suffix starting `+4` top-level blocks past
    /// `splice_new_end` so subsequent edits in the prefix shift only a small
    /// guard window instead of the entire remainder of the document (`TA-81`).
    /// Not while anything pairs across the document (definitions, footnotes,
    /// multi-block delimiters, HTML flows): the head alone could not pair it.
    pub fn maybe_detach_tail(&mut self, doc: &Buffer, splice_new_end: usize) {
        if self.tail.is_some()
            || self.syntax.top_blocks.len() < 16
            || !self.syntax.link_defs.is_empty()
            || !self.syntax.footnotes.is_empty()
            || !self.syntax.block_delimiters.is_empty()
            || self.syntax.has_unbalanced_html(doc)
        {
            return;
        }
        let edit_end_block = self
            .syntax
            .top_blocks
            .partition_point(|b| b.start < splice_new_end);
        let split_block = edit_end_block + 4;
        if split_block + 8 > self.syntax.top_blocks.len() {
            return;
        }
        let split_byte = self.syntax.top_blocks[split_block].start;
        if split_byte >= doc.len() {
            return;
        }
        let split_line = doc.line_index(split_byte);
        if doc.line_range(split_line).start != split_byte {
            return;
        }
        if self.plan_cache.any_straddles(&self.plans, split_byte) {
            return;
        }
        let p_idx = self.plans.partition_point(|p| p.source.start < split_byte);
        let Some(tail_syntax) =
            Rc::make_mut(&mut self.syntax).split_off_tail(split_byte, split_line)
        else {
            return;
        };
        let tail_plans = Rc::make_mut(&mut self.plans).split_off(p_idx);
        self.plan_cache.truncate_at(split_byte);
        self.tail = Some(DeferredTail {
            split_byte,
            split_line,
            byte_delta: 0,
            line_delta: 0,
            elem_delta: 0,
            list_delta: 0,
            item_delta: 0,
            syntax: tail_syntax,
            plans: tail_plans,
        });
    }
}

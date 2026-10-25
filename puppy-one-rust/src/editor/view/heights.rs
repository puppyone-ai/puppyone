//! Block heights for laying out only what is near the viewport (the role of
//! CodeMirror's HeightMap). Every frame builds the blocks around the scroll
//! position; the rest of the document is space of a known or estimated
//! height:
//!
//! - a block the view has laid out keeps its measured height, keyed by what
//!   decides it (its kind, source text and line box metrics) and the column
//!   width it was measured at;
//! - at another width (a resize) the last measured height is the estimate
//!   until the block is laid out again;
//! - a block never laid out is estimated from its text and line style.
//!
//! Estimates only place blocks the frame does not show. The element corrects
//! them as blocks come into view and keeps the block at the top of the
//! viewport where it was (scroll anchoring), so a correction never moves
//! what the person is looking at.
use super::decoration::{Block, Decorations};
use crate::editor::text::buffer::Buffer;
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

/// The block heights of one decoration set at one column width, top to
/// bottom, and their running tops.
struct Plan {
    decorations: *const Decorations,
    width: u32,
    keys: Vec<u64>,
    /// Blocks that cover their source lines in order (the element skips any
    /// other, as before).
    valid: Vec<bool>,
    heights: Vec<f32>,
    /// `tops[i]` is block `i`'s top in document coordinates; the last entry
    /// is the bottom of the last block.
    tops: Vec<f32>,
    dirty: bool,
}

impl Plan {
    fn refresh(&mut self) {
        if !self.dirty {
            return;
        }
        let mut y = self.tops.first().copied().unwrap_or(0.);
        for (i, h) in self.heights.iter().enumerate() {
            self.tops[i] = y;
            y += h;
        }
        if let Some(last) = self.tops.last_mut() {
            *last = y;
        }
        self.dirty = false;
    }
}

#[derive(Default)]
pub struct HeightMap {
    /// Last measured height per block key, with the column width (bits) it
    /// was measured at.
    known: HashMap<u64, (u32, f32)>,
    plan: Option<Plan>,
}

/// What decides a block's height besides the column width.
fn block_key(block: &Block, doc: &Buffer, source: Range<usize>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    doc.slice(source).hash(&mut h);
    match block {
        Block::Line { style, .. } => {
            0u8.hash(&mut h);
            let t = &style.text;
            for v in [
                t.size,
                t.line_height_px(),
                t.weight,
                style.padding.top,
                style.padding.bottom,
                style.padding.left,
                style.padding.right,
                style.border.top,
                style.border.bottom,
                style.border.left,
                style.border.right,
            ] {
                v.to_bits().hash(&mut h);
            }
            (t.mono, t.italic, style.nowrap).hash(&mut h);
        }
        Block::Widget { lines, .. } => {
            1u8.hash(&mut h);
            lines.len().hash(&mut h);
        }
    }
    h.finish()
}

/// A height for a block never laid out at any width.
fn estimate(block: &Block, doc: &Buffer, source: Range<usize>, width: f32) -> f32 {
    match block {
        Block::Line { style, .. } => {
            let (p, b) = (style.padding, style.border);
            let line = style.text.line_height_px();
            let wrap = (width - p.left - p.right - b.left - b.right).max(1.);
            let chars = doc.slice(source).chars().count() as f32;
            let rows = if style.nowrap {
                1.
            } else {
                (chars * style.text.ch() / wrap).ceil().max(1.)
            };
            p.top + p.bottom + b.top + b.bottom + rows * line
        }
        // Panels (code, tables) run about a row per source line plus their
        // frame.
        Block::Widget { lines, .. } => lines.len() as f32 * 24. + 24.,
    }
}

impl HeightMap {
    /// Plans `decorations` at `width`, rebuilt when either changed. `top`
    /// is the document y of the first block (the content inset).
    pub fn prepare(&mut self, decorations: &Rc<Decorations>, doc: &Buffer, width: f32, top: f32) {
        let id = Rc::as_ptr(decorations);
        let bits = width.to_bits();
        if self
            .plan
            .as_ref()
            .is_some_and(|p| p.decorations == id && p.width == bits && p.tops.first() == Some(&top))
        {
            return;
        }
        let line_count = doc.line_count();
        let n = decorations.blocks.len();
        let mut plan = Plan {
            decorations: id,
            width: bits,
            keys: Vec::with_capacity(n),
            valid: Vec::with_capacity(n),
            heights: Vec::with_capacity(n),
            tops: vec![top; n + 1],
            dirty: true,
        };
        let mut next_line = 0;
        for block in &decorations.blocks {
            let lines = block.lines();
            if lines.start != next_line || lines.end > line_count || lines.is_empty() {
                plan.keys.push(0);
                plan.valid.push(false);
                plan.heights.push(0.);
                continue;
            }
            next_line = lines.end;
            let source = doc.line_range(lines.start).start..doc.line_range(lines.end - 1).end;
            let key = block_key(block, doc, source.clone());
            let height = match self.known.get(&key) {
                Some((_, h)) => *h,
                None => estimate(block, doc, source, width),
            };
            plan.keys.push(key);
            plan.valid.push(true);
            plan.heights.push(height);
        }
        // Forget blocks that no longer exist once the table outgrows the
        // document.
        if self.known.len() > 4 * n + 1024 {
            let live: std::collections::HashSet<u64> = plan.keys.iter().copied().collect();
            self.known.retain(|k, _| live.contains(k));
        }
        self.plan = Some(plan);
    }

    /// Whether a frame has planned the document yet.
    pub fn planned(&self) -> bool {
        self.plan.is_some()
    }

    fn plan(&mut self) -> &mut Plan {
        let plan = self.plan.as_mut().expect("HeightMap::prepare first");
        plan.refresh();
        plan
    }

    pub fn len(&mut self) -> usize {
        self.plan().heights.len()
    }

    /// Whether block `index` covers its source lines in order (the element
    /// lays out no other).
    pub fn valid(&mut self, index: usize) -> bool {
        self.plan().valid[index]
    }

    pub fn top(&mut self, index: usize) -> f32 {
        let plan = self.plan();
        plan.tops[index.min(plan.heights.len())]
    }

    pub fn height(&mut self, index: usize) -> f32 {
        self.plan().heights[index]
    }

    /// The bottom of the last block.
    pub fn bottom(&mut self) -> f32 {
        self.plan().tops.last().copied().unwrap_or(0.)
    }

    /// The block at document y `y`: the first whose bottom is below it.
    pub fn index_at(&mut self, y: f32) -> usize {
        let plan = self.plan();
        let n = plan.heights.len();
        plan.tops[1..]
            .partition_point(|bottom| *bottom <= y)
            .min(n.saturating_sub(1))
    }

    /// Records the height block `index` was laid out at; returns how much
    /// it differs from what the plan assumed.
    pub fn measured(&mut self, index: usize, height: f32) -> f32 {
        let Some(plan) = self.plan.as_mut() else {
            return 0.;
        };
        let delta = height - plan.heights[index];
        self.known.insert(plan.keys[index], (plan.width, height));
        if delta != 0. {
            plan.heights[index] = height;
            plan.dirty = true;
        }
        delta
    }
}
